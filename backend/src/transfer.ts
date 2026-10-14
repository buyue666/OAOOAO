/** Independent, initial-data transfer. Only normalized records enter this module.
 * It never imports an old application's modules or executes a source database function.
 */
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from './core.js';
import {creditUnits,creditDecimal} from './wallet.js';

type Row=Record<string,unknown>;
const mapping={
  users:{table:'oaooao_users',key:'id',columns:'id username email display_name bio avatar_url role admin_permissions enabled password_hash email_verified plan_id created_at updated_at last_login_at policy_accepted_at'},
  wallets:{table:'oaooao_wallets',key:'user_id',columns:'user_id permanent_balance daily_balance daily_allowance daily_spent daily_expires_at daily_refresh_date updated_at'},
  ledger:{table:'oaooao_wallet_operations',key:'operation_id',columns:'operation_id user_id requested_delta permanent_delta daily_delta permanent_after daily_after daily_expires_at refund_of metadata created_at'},
  products:{table:'oaooao_products',key:'id',columns:'id product_kind plan_id name description amount_cents currency points_amount daily_points period_days enabled sort_order metadata created_at updated_at'},
  orders:{table:'oaooao_orders',key:'id',columns:'id order_no user_id product_id product_kind plan_id subject status quantity list_amount_cents promotion_discount_cents coupon_discount_cents amount_cents currency points_amount daily_points period_days provider provider_order_id request_key request_fingerprint expires_at closed_at paid_at refunded_at pricing_snapshot metadata created_at updated_at'},
  payments:{table:'oaooao_payments',key:'id',columns:'id order_id provider provider_payment_id amount_cents currency status confirmation created_at refunded_at'},
  projects:{table:'oaooao_projects',key:'id',columns:'id user_id kind title source_handoff_id document created_at updated_at'},
  history:{table:'oaooao_generation_history',key:'id',columns:'id user_id document created_at'},
  referralCodes:{table:'oaooao_referral_codes',key:'user_id',columns:'user_id code clicks'},
  settings:{table:'oaooao_settings',key:'id',columns:'id value updated_at'},
  announcements:{table:'oaooao_announcements',key:'id',columns:'id title content enabled popup_home popup_after_login starts_at ends_at created_at updated_at'},
  audit:{table:'oaooao_audit_logs',key:'id',columns:'id actor_id action target_type target_id status metadata created_at'},
} as const;
export type TransferKind=keyof typeof mapping;
export interface TransferBundle {
  format:'oaooao-normalized-transfer-v1'; id:string; sourceDigest:string; capturedAt:string;
  records:Partial<Record<TransferKind,Row[]>>;
  archive:{entityType:string;entityId:string;document:Row}[];
}
export interface TransferSummary {counts:Record<string,number>;archiveRows:number;permanentPoints:string;dailyPoints:string;}
const creditColumns=new Set('permanent_balance daily_balance daily_allowance daily_spent requested_delta permanent_delta daily_delta permanent_after daily_after points_amount daily_points'.split(' '));
const integerColumns=new Set('amount_cents list_amount_cents promotion_discount_cents coupon_discount_cents clicks'.split(' '));
function canonical(value:unknown):unknown {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
function serialized(value:unknown){return JSON.stringify(canonical(value));}
function equivalent(column:string,value:unknown):unknown {
  if(value===null||value===undefined)return null;
  if(creditColumns.has(column))return creditDecimal(creditUnits(String(value)));
  if(integerColumns.has(column))return BigInt(String(value)).toString();
  if(column.endsWith('_at'))return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
  if(column==='daily_refresh_date')return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
  return canonical(value);
}
function validate(bundle:TransferBundle){
  if(bundle.format!=='oaooao-normalized-transfer-v1'||!/^[-A-Za-z0-9_.]{1,120}$/.test(bundle.id)||!/^[a-f0-9]{64}$/.test(bundle.sourceDigest)||!Number.isFinite(Date.parse(bundle.capturedAt)))throw new Error('Invalid transfer manifest');
  if(!Array.isArray(bundle.archive)||!bundle.records||typeof bundle.records!=='object')throw new Error('Invalid transfer records');
  for(const [kind,rows] of Object.entries(bundle.records)){
    if(!(kind in mapping)||!Array.isArray(rows))throw new Error('Unknown transfer entity');
    const spec=mapping[kind as TransferKind],allowed=new Set(spec.columns.split(' ')),seen=new Set<string>();
    for(const row of rows){
      if(!row||typeof row!=='object'||Array.isArray(row)||typeof row[spec.key]!=='string'||!row[spec.key]||Object.keys(row).some(key=>!allowed.has(key)))throw new Error(`Invalid ${kind} record`);
      const key=String(row[spec.key]);if(seen.has(key))throw new Error(`Duplicate ${kind} transfer identifier`);seen.add(key);
      for(const [column,value]of Object.entries(row))equivalent(column,value);
      if(kind==='wallets'&&row.daily_spent===undefined&&creditUnits(String(row.daily_allowance??0))>creditUnits(String(row.daily_balance??0)))throw new Error('An authoritative daily-spend snapshot is required');
    }
  }
  const seen=new Set<string>();
  for(const item of bundle.archive){
    if(!item||typeof item.entityType!=='string'||!item.entityType||typeof item.entityId!=='string'||!item.entityId||!item.document||typeof item.document!=='object')throw new Error('Invalid archive entry');
    const key=serialized([item.entityType,item.entityId]);if(seen.has(key))throw new Error('Duplicate archive identifier');seen.add(key);
  }
}
function summarize(bundle:TransferBundle):TransferSummary {
  const wallets=bundle.records.wallets||[];
  return {counts:Object.fromEntries(Object.keys(mapping).map(kind=>[kind,bundle.records[kind as TransferKind]?.length||0])),archiveRows:bundle.archive.length,
    permanentPoints:creditDecimal(wallets.reduce((sum,row)=>sum+creditUnits(String(row.permanent_balance)),0n)),
    dailyPoints:creditDecimal(wallets.reduce((sum,row)=>sum+creditUnits(String(row.daily_balance??0)),0n))};
}
async function verifyRows(db:Pool|PoolClient,bundle:TransferBundle){
  for(const [kind,spec]of Object.entries(mapping)){
    const rows=bundle.records[kind as TransferKind]||[];
    const current=(await db.query(`SELECT * FROM ${spec.table}`)).rows as Row[];
    const lookup=new Map(current.map(row=>[String(row[spec.key]),row]));
    if(kind!=='settings'&&current.length!==rows.length)throw new Error(`Reconciliation failed: ${kind} count differs`);
    for(const expected of rows){
      const actual=lookup.get(String(expected[spec.key]));if(!actual)throw new Error(`Reconciliation failed: missing ${kind} record`);
      for(const [column,value]of Object.entries(expected))if(serialized(equivalent(column,value))!==serialized(equivalent(column,actual[column])))throw new Error(`Reconciliation failed: ${kind}.${column} differs`);
    }
  }
  const archives=(await db.query('SELECT entity_type,entity_id,document FROM oaooao_transfer_archive WHERE transfer_id=$1',[bundle.id])).rows;
  if(archives.length!==bundle.archive.length)throw new Error('Reconciliation failed: archive count differs');
  const lookup=new Map(archives.map(row=>[serialized([row.entity_type,row.entity_id]),row.document]));
  for(const row of bundle.archive)if(serialized(lookup.get(serialized([row.entityType,row.entityId])))!==serialized(row.document))throw new Error('Reconciliation failed: archive content differs');
}
export async function verifyTransfer(db:Pool,bundle:TransferBundle):Promise<TransferSummary>{
  validate(bundle);await transaction(db,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await verifyRows(client,bundle);});return summarize(bundle);
}
/** Entire transfer is atomic. A completed replay is a no-op, never a second grant. */
export async function importTransfer(db:Pool,bundle:TransferBundle):Promise<{replayed:boolean;summary:TransferSummary}>{
  validate(bundle);const digest=createHash('sha256').update(serialized(bundle)).digest('hex'),summary=summarize(bundle);
  return transaction(db,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('oaooao-initial-transfer',0))");
    const existing=(await client.query('SELECT payload_digest,summary FROM oaooao_transfer_runs WHERE id=$1',[bundle.id])).rows[0];
    if(existing){if(existing.payload_digest!==digest)throw new Error('Transfer identifier already has different data');return {replayed:true,summary:existing.summary};}
    if((await client.query('SELECT 1 FROM oaooao_transfer_runs LIMIT 1')).rowCount)throw new Error('This database already received an initial transfer');
    for(const [kind,spec]of Object.entries(mapping))if(kind!=='settings'&&(await client.query(`SELECT 1 FROM ${spec.table} LIMIT 1`)).rowCount)throw new Error('Transfer requires a fresh destination database');
    await client.query('INSERT INTO oaooao_transfer_runs(id,source_digest,payload_digest,captured_at,summary) VALUES($1,$2,$3,$4,$5)',[bundle.id,bundle.sourceDigest,digest,bundle.capturedAt,summary]);
    for(const [kind,spec]of Object.entries(mapping)){
      const groups=new Map<string,Row[]>();
      for(const row of bundle.records[kind as TransferKind]||[]){const key=Object.keys(row).sort().join(',');groups.set(key,[...(groups.get(key)||[]),row]);}
      for(const [fieldList,rows]of groups){
        const fields=fieldList.split(',');
        // Names come only from the fixed mapping checked above, never from a source SQL script.
        const updates=fields.filter(name=>name!=='id').map(name=>`${name}=EXCLUDED.${name}`).join(',');
        const conflict=kind==='settings'?` ON CONFLICT(id) DO ${updates?'UPDATE SET '+updates:'NOTHING'}`:'';
        for(let i=0;i<rows.length;i+=100){
          const batch=rows.slice(i,i+100).map(row=>Object.fromEntries(Object.entries(row).map(([column,value])=>[column,column.endsWith('_at')||column==='daily_refresh_date'?equivalent(column,value):value])));
          await client.query(`INSERT INTO ${spec.table}(${fieldList}) SELECT ${fieldList} FROM jsonb_populate_recordset(NULL::${spec.table},$1::jsonb)${conflict}`,[JSON.stringify(batch)]);
        }
      }
    }
    for(let i=0;i<bundle.archive.length;i+=100){
      const batch=bundle.archive.slice(i,i+100).map(row=>({entity_type:row.entityType,entity_id:row.entityId,document:row.document}));
      await client.query(`INSERT INTO oaooao_transfer_archive(transfer_id,entity_type,entity_id,document) SELECT $1,entity_type,entity_id,document FROM jsonb_to_recordset($2::jsonb) AS a(entity_type text,entity_id text,document jsonb)`,[bundle.id,JSON.stringify(batch)]);
    }
    await verifyRows(client,bundle);
    return {replayed:false,summary};
  });
}
