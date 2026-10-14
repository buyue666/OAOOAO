import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Context } from './core.js';
import { httpError } from './core.js';

export type CreditAmount = string | number;
type Meta = Record<string, unknown>;
const SCALE = 10000n;
const MAX_UNITS = 9007199254740991n;

/** Integer arithmetic is authoritative; numeric JSON values are presentation only. */
export function creditUnits(value: CreditAmount): bigint {
  const input = String(value);
  if (!/^-?\d{1,16}(?:\.\d{1,4})?$/.test(input)) throw httpError(400, 'Credits must be a finite decimal with at most four decimal places');
  const negative = input.startsWith('-');
  const [whole = '0', fraction = ''] = input.replace(/^-/, '').split('.');
  const amount = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
  if (amount > MAX_UNITS) throw httpError(400, 'Credit amount exceeds the supported range');
  return negative ? -amount : amount;
}
export function creditDecimal(units: bigint): string {
  if (units < -MAX_UNITS || units > MAX_UNITS) throw httpError(400, 'Credit amount exceeds the supported range');
  const positive = units < 0n ? -units : units;
  return `${units < 0n ? '-' : ''}${positive / SCALE}.${String(positive % SCALE).padStart(4, '0')}`;
}
export interface WalletBalance {
  pointsBalance: number;
  permanentPointsBalance: number;
  dailyPointsBalance: number;
  dailyPointsExpiresAt: string | null;
  timedPointsBalance: number;
  timedPointsExpiresAt: string | null;
  exact: { pointsBalance: string; permanentPointsBalance: string; dailyPointsBalance: string; timedPointsBalance: string };
}
/** Internal test clock only; HTTP clients cannot supply it. One instant is captured after the wallet lock. */
export type WalletClock = () => Date;
interface CreditBatch { id:string; remaining_amount:string; expires_at:Date; expired_at:Date|null; }
interface WalletRow {
  user_id: string; permanent_balance: string; daily_balance: string;
  daily_allowance: string; daily_spent: string; daily_expires_at: Date | null; daily_refresh_date: string | Date | null;
  batches?:CreditBatch[];
}
function timedUnits(row:WalletRow):bigint{return (row.batches ?? []).reduce((sum,batch)=>sum+creditUnits(batch.remaining_amount),0n);}
function balances(row: WalletRow): WalletBalance {
  const permanent = creditUnits(row.permanent_balance);
  const daily = creditUnits(row.daily_balance);
  const timed=timedUnits(row);
  const nearest=(row.batches ?? []).find(batch=>creditUnits(batch.remaining_amount)>0n)?.expires_at;
  return {
    pointsBalance: Number(creditDecimal(permanent + daily + timed)),
    permanentPointsBalance: Number(row.permanent_balance),
    dailyPointsBalance: Number(row.daily_balance),
    dailyPointsExpiresAt: row.daily_expires_at?.toISOString() ?? null,
    timedPointsBalance:Number(creditDecimal(timed)),timedPointsExpiresAt:nearest?.toISOString() ?? null,
    exact: { pointsBalance: creditDecimal(permanent + daily + timed), permanentPointsBalance: creditDecimal(permanent), dailyPointsBalance: creditDecimal(daily), timedPointsBalance:creditDecimal(timed) },
  };
}
export async function walletTransaction<T>(ctx: Context, client: PoolClient | undefined, task: (db: PoolClient) => Promise<T>): Promise<T> {
  if (client) return task(client);
  const db = await ctx.db.connect();
  try { await db.query('BEGIN'); const value = await task(db); await db.query('COMMIT'); return value; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
async function lockWallet(db: PoolClient, userId: string): Promise<WalletRow> {
  const user=await db.query('SELECT id FROM oaooao_users WHERE id=$1 FOR NO KEY UPDATE',[userId]);
  if(!user.rowCount)throw httpError(404,'Wallet owner not found');
  await db.query('INSERT INTO oaooao_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
  const result = await db.query<WalletRow>('SELECT * FROM oaooao_wallets WHERE user_id=$1 FOR UPDATE', [userId]);
  return result.rows[0]!;
}
// All callers hold the account lock. Preserve event order even when several entries
// share a millisecond or a transaction began before another transaction completed.
async function operationTime(db:PoolClient,userId:string,at:Date):Promise<string>{
  return (await db.query<{at:string}>("SELECT greatest($2::timestamptz,coalesce(max(created_at)+interval '1 microsecond',$2::timestamptz))::text AS at FROM oaooao_wallet_operations WHERE user_id=$1",[userId,at])).rows[0]!.at;
}
async function dailyEntitlement(db: PoolClient, userId: string, at?:Date): Promise<bigint> {
  const settings = (await db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0]?.value ?? {};
  const free = settings.freeDailyPointsEnabled === true ? creditUnits(settings.freeDailyPoints ?? 0) : 0n;
  const paid = creditUnits((await db.query("SELECT coalesce(sum(daily_points),0)::text AS amount FROM oaooao_plan_grants WHERE user_id=$1 AND revoked_at IS NULL AND starts_at<=coalesce($2,clock_timestamp()) AND expires_at>coalesce($2,clock_timestamp())", [userId,at ?? null])).rows[0]!.amount);
  const assignment = (await db.query('SELECT plan_id FROM oaooao_admin_plan_assignments WHERE user_id=$1',[userId])).rows[0];
  const plan = settings.entitlements?.enabled === true && assignment ? settings.entitlements.plans?.find((item:Record<string,unknown>)=>item.id===assignment.plan_id && item.enabled===true) : null;
  const administrative = plan ? creditUnits(plan.dailyPoints ?? 0) : 0n;
  return [free,paid,administrative].reduce((largest,current)=>current>largest?current:largest,0n);
}
async function refreshDaily(db: PoolClient, row: WalletRow, at:Date): Promise<WalletRow> {
  const clock = (await db.query<{ today: string; expires: Date; now: Date }>("SELECT to_char($1::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD') AS today, ((date_trunc('day',$1::timestamptz AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC') AS expires, $1::timestamptz AS now",[at])).rows[0]!;
  const date = row.daily_refresh_date instanceof Date ? row.daily_refresh_date.toISOString().slice(0, 10) : String(row.daily_refresh_date ?? '').slice(0, 10);
  if (date === clock.today && (!row.daily_expires_at || row.daily_expires_at > clock.now)) return row;
  const grant = await dailyEntitlement(db,row.user_id,at);
  const previous = creditUnits(row.daily_balance);
  // Imported, still-valid daily credits are preserved until their explicit expiry.
  if (row.daily_expires_at && row.daily_expires_at > clock.now && date !== clock.today) {
    const result = await db.query<WalletRow>('UPDATE oaooao_wallets SET daily_refresh_date=$2,updated_at=now() WHERE user_id=$1 RETURNING *', [row.user_id, clock.today]);
    return {...result.rows[0]!,batches:row.batches};
  }
  const result = await db.query<WalletRow>('UPDATE oaooao_wallets SET daily_balance=$2,daily_allowance=$2,daily_spent=0,daily_expires_at=$3,daily_refresh_date=$4,updated_at=now() WHERE user_id=$1 RETURNING *', [row.user_id, creditDecimal(grant), clock.expires, clock.today]);
  const updated = {...result.rows[0]!,batches:row.batches};
  const timed=creditDecimal(timedUnits(row));
  if (previous !== 0n) await db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after,daily_expires_at,metadata,timed_after,created_at) VALUES($1,$2,$3,0,$3,$4,0,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [`daily:${row.user_id}:${clock.today}:expire`, row.user_id, creditDecimal(-previous), row.permanent_balance, row.daily_expires_at, { kind: 'daily_expiration' },timed,await operationTime(db,row.user_id,at)]);
  if (grant !== 0n) await db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after,daily_expires_at,metadata,timed_after,created_at) VALUES($1,$2,$3,0,$3,$4,$3,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [`daily:${row.user_id}:${clock.today}:grant`, row.user_id, creditDecimal(grant), row.permanent_balance, updated.daily_expires_at, { kind: 'daily_grant' },timed,await operationTime(db,row.user_id,at)]);
  return updated;
}
async function walletNow(db:PoolClient,clock?:WalletClock):Promise<Date>{
  const at=clock?.() ?? (await db.query<{at:Date}>('SELECT clock_timestamp() AS at')).rows[0]!.at;
  if(!Number.isFinite(at.getTime()))throw httpError(500,'Invalid wallet clock');return at;
}
async function prepareWallet(db:PoolClient,userId:string,clock?:WalletClock):Promise<{row:WalletRow;at:Date}>{
  const row=await lockWallet(db,userId);const at=await walletNow(db,clock);
  const all=(await db.query<CreditBatch>('SELECT id,remaining_amount,expires_at,expired_at FROM oaooao_credit_batches WHERE user_id=$1 AND expired_at IS NULL ORDER BY expires_at,id FOR UPDATE',[userId])).rows;
  let total=all.reduce((sum,batch)=>sum+creditUnits(batch.remaining_amount),0n);
  for(const batch of all.filter(item=>item.expires_at<=at)){
    const remainder=creditUnits(batch.remaining_amount);total-=remainder;
    await db.query('UPDATE oaooao_credit_batches SET remaining_amount=0,expired_at=$2 WHERE id=$1',[batch.id,at]);
    if(remainder===0n)continue;
    const operationId=`timed-expire:${batch.id}`;
    await db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,timed_delta,permanent_after,daily_after,timed_after,daily_expires_at,metadata,created_at) VALUES($1,$2,$3,0,0,$3,$4,$5,$6,$7,$8,$9)`,[operationId,userId,creditDecimal(-remainder),row.permanent_balance,row.daily_balance,creditDecimal(total),row.daily_expires_at,{kind:'timed_expiration',type:'expire',description:'限时签到积分到期',batchId:batch.id,expiresAt:batch.expires_at.toISOString()},await operationTime(db,userId,at)]);
    await db.query('INSERT INTO oaooao_wallet_batch_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)',[operationId,batch.id,creditDecimal(-remainder)]);
  }
  row.batches=all.filter(batch=>batch.expires_at>at);
  // First settle all expired batches against the original daily balance. Only then
  // expire/refresh the daily bucket, so each ledger snapshot follows its delta.
  return {row:await refreshDaily(db,row,at),at};
}
export async function getWallet(ctx: Context, userId: string, client?: PoolClient,clock?:WalletClock): Promise<WalletBalance> {
  return walletTransaction(ctx, client, async db => balances((await prepareWallet(db,userId,clock)).row));
}
interface OperationRow {
  user_id: string; requested_delta: string; permanent_delta: string; daily_delta: string;
  permanent_after: string; daily_after: string; daily_expires_at: Date | null; metadata: Meta;
  refund_of: string | null;timed_delta:string;timed_after:string;
}
function checkId(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) throw httpError(400, 'A stable operation identifier is required');
}
/** Positive adjustments grant permanent credit. Refunds must name the debit with metadata.refundOf. */
export async function adjustWallet(ctx: Context, userId: string, operationId: string, delta: CreditAmount, metadata: Meta = {}, client?: PoolClient,clock?:WalletClock): Promise<WalletBalance> {
  checkId(operationId);
  const amount = creditUnits(delta);
  const refundOf = typeof metadata.refundOf === 'string' ? metadata.refundOf : null;
  return walletTransaction(ctx, client, async db => {
    // Serializes both same-account and cross-account reuse of an operation key.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [operationId]);
    const {row,at}=await prepareWallet(db,userId,clock);
    const previous = (await db.query<OperationRow>('SELECT * FROM oaooao_wallet_operations WHERE operation_id=$1', [operationId])).rows[0];
    if (previous) {
      if (previous.user_id !== userId || creditUnits(previous.requested_delta) !== amount || previous.refund_of !== refundOf || previous.metadata.bucket !== metadata.bucket) throw httpError(409, 'Operation identifier has already been used for different credit instructions');
      return balances(row);
    }
    let permanentDelta = amount;
    let dailyDelta = 0n;
    let timedDelta=0n;
    const allocations:{batchId:string;delta:bigint}[]=[];
    let dailySpent = creditUnits(row.daily_spent);
    if (refundOf) {
      if (amount <= 0n) throw httpError(400, 'Refund amount must be positive');
      const original = (await db.query<OperationRow>('SELECT * FROM oaooao_wallet_operations WHERE operation_id=$1 AND user_id=$2', [refundOf, userId])).rows[0];
      if (!original || creditUnits(original.requested_delta) >= 0n || -creditUnits(original.requested_delta) !== amount) throw httpError(409, 'Refund must match an existing debit in full');
      const already = await db.query('SELECT operation_id FROM oaooao_wallet_operations WHERE refund_of=$1', [refundOf]);
      if (already.rowCount) return balances(row);
      permanentDelta = -creditUnits(original.permanent_delta);
      if(original.daily_expires_at && row.daily_expires_at && original.daily_expires_at.getTime()===row.daily_expires_at.getTime()) {
        dailySpent += creditUnits(original.daily_delta);
        if(dailySpent<0n)dailySpent=0n;
        const entitlementRemaining=creditUnits(row.daily_allowance)-dailySpent;
        dailyDelta=(entitlementRemaining>0n?entitlementRemaining:0n)-creditUnits(row.daily_balance);
      }
      const spent=(await db.query<{batch_id:string;delta:string}>('SELECT batch_id,delta FROM oaooao_wallet_batch_allocations WHERE operation_id=$1 AND delta<0',[refundOf])).rows;
      for(const allocation of spent){
        const batch=row.batches?.find(item=>item.id===allocation.batch_id);
        // Missing from active batches means the original expiry has passed. Never create a replacement.
        if(!batch || batch.expires_at<=at)continue;
        const restore=-creditUnits(allocation.delta);timedDelta+=restore;
        batch.remaining_amount=creditDecimal(creditUnits(batch.remaining_amount)+restore);
        allocations.push({batchId:batch.id,delta:restore});
      }
    } else if (amount < 0n) {
      if(metadata.bucket!=='permanent'){
        let remaining=-amount;
        const slots=[{id:null as string|null,available:creditUnits(row.daily_balance),expires:row.daily_expires_at?.getTime() ?? Number.POSITIVE_INFINITY},...(row.batches ?? []).map(batch=>({id:batch.id,available:creditUnits(batch.remaining_amount),expires:batch.expires_at.getTime()}))].sort((a,b)=>a.expires-b.expires || String(a.id ?? '').localeCompare(String(b.id ?? '')));
        for(const slot of slots){
          const take=remaining<slot.available?remaining:slot.available;if(take===0n)continue;remaining-=take;
          if(slot.id===null)dailyDelta-=take;
          else{const batch=row.batches!.find(item=>item.id===slot.id)!;batch.remaining_amount=creditDecimal(creditUnits(batch.remaining_amount)-take);timedDelta-=take;allocations.push({batchId:slot.id,delta:-take});}
          if(remaining===0n)break;
        }
        permanentDelta=-remaining;
      }
      dailySpent -= dailyDelta;
    }
    const permanent = creditUnits(row.permanent_balance) + permanentDelta;
    const daily = creditUnits(row.daily_balance) + dailyDelta;
    if (permanent < 0n || daily < 0n) throw httpError(402, 'Insufficient points balance');
    creditDecimal(permanent + daily + timedUnits(row));
    const updated = {...(await db.query<WalletRow>('UPDATE oaooao_wallets SET permanent_balance=$2,daily_balance=$3,daily_spent=$4,updated_at=now() WHERE user_id=$1 RETURNING *', [userId, creditDecimal(permanent), creditDecimal(daily),creditDecimal(dailySpent)])).rows[0]!,batches:row.batches};
    for(const allocation of allocations){
      await db.query('UPDATE oaooao_credit_batches SET remaining_amount=remaining_amount+$2 WHERE id=$1',[allocation.batchId,creditDecimal(allocation.delta)]);
      await db.query('INSERT INTO oaooao_wallet_batch_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)',[operationId,allocation.batchId,creditDecimal(allocation.delta)]);
    }
    const details=refundOf?{...metadata,expiredRefundPoints:creditDecimal(amount-permanentDelta-dailyDelta-timedDelta)}:metadata;
    await db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after,daily_expires_at,refund_of,metadata,timed_delta,timed_after,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [operationId, userId, creditDecimal(amount), creditDecimal(permanentDelta), creditDecimal(dailyDelta), updated.permanent_balance, updated.daily_balance, updated.daily_expires_at, refundOf, details,creditDecimal(timedDelta),creditDecimal(timedUnits(updated)),await operationTime(db,userId,at)]);
    return balances(updated);
  });
}
/** Dedicated grant path: ordinary positive adjustments, purchases and imported credits stay permanent. */
export async function grantTimedCredits(ctx:Context,userId:string,operationId:string,amount:CreditAmount,expiresAt:Date,metadata:Meta={},client?:PoolClient,clock?:WalletClock):Promise<WalletBalance>{
  checkId(operationId);const units=creditUnits(amount);
  if(units<=0n || !Number.isFinite(expiresAt.getTime()))throw httpError(400,'Invalid timed credit grant');
  return walletTransaction(ctx,client,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[operationId]);
    const {row,at}=await prepareWallet(db,userId,clock);
    const previous=(await db.query<OperationRow>('SELECT * FROM oaooao_wallet_operations WHERE operation_id=$1',[operationId])).rows[0];
    if(previous){if(previous.user_id!==userId || creditUnits(previous.requested_delta)!==units || previous.metadata.bucket!=='timed' || previous.metadata.expiresAt!==expiresAt.toISOString())throw httpError(409,'Operation identifier already used');return balances(row);}
    if(expiresAt<=at)throw httpError(400,'Timed credits must expire in the future');
    const id=randomUUID();const batch:CreditBatch={id,remaining_amount:creditDecimal(units),expires_at:expiresAt,expired_at:null};
    row.batches=[...(row.batches ?? []),batch].sort((a,b)=>a.expires_at.getTime()-b.expires_at.getTime() || a.id.localeCompare(b.id));
    balances(row); // Check the full supported balance range before any write.
    await db.query('INSERT INTO oaooao_credit_batches(id,user_id,grant_operation_id,original_amount,remaining_amount,created_at,expires_at) VALUES($1,$2,$3,$4,$4,$5,$6)',[id,userId,operationId,creditDecimal(units),at,expiresAt]);
    await db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,timed_delta,permanent_after,daily_after,timed_after,daily_expires_at,metadata,created_at) VALUES($1,$2,$3,0,0,$3,$4,$5,$6,$7,$8,$9)`,[operationId,userId,creditDecimal(units),row.permanent_balance,row.daily_balance,creditDecimal(timedUnits(row)),row.daily_expires_at,{...metadata,bucket:'timed',expiresAt:expiresAt.toISOString(),batchId:id},await operationTime(db,userId,at)]);
    await db.query('INSERT INTO oaooao_wallet_batch_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)',[operationId,id,creditDecimal(units)]);
    return balances(row);
  });
}
/** Bounded maintenance, using the same per-account lock and idempotent expiry ledger as reads/debits. */
export async function expireCreditBatches(ctx:Context,limit=100):Promise<number>{
  const users=(await ctx.db.query('SELECT user_id FROM oaooao_credit_batches WHERE expired_at IS NULL AND expires_at<=clock_timestamp() GROUP BY user_id ORDER BY min(expires_at),user_id LIMIT $1',[Math.max(1,Math.min(100,Math.trunc(limit)))])).rows;
  for(const row of users)await getWallet(ctx,row.user_id);return users.length;
}
export async function setPermanentBalance(ctx: Context, userId: string, operationId: string, targetBalance: CreditAmount, metadata: Meta = {}, client?: PoolClient): Promise<WalletBalance> {
  checkId(operationId);
  const target = creditUnits(targetBalance);
  if (target < 0n) throw httpError(400, 'Permanent balance cannot be negative');
  return walletTransaction(ctx, client, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [operationId]);
    const {row}=await prepareWallet(db,userId);
    const prior = (await db.query<OperationRow>('SELECT * FROM oaooao_wallet_operations WHERE operation_id=$1', [operationId])).rows[0];
    if (prior) {
      if (prior.user_id !== userId || prior.metadata.targetBalance !== creditDecimal(target)) throw httpError(409, 'Operation identifier already used');
      return balances(row);
    }
    return adjustWallet(ctx, userId, operationId, creditDecimal(target - creditUnits(row.permanent_balance)), { ...metadata, kind: 'set_permanent', bucket: 'permanent', targetBalance: creditDecimal(target) }, db);
  });
}
/** Transfer-only entrypoint. Existing economic history cannot be overwritten. */
export async function importWallet(ctx: Context, userId: string, transferId: string, input: { permanentPointsBalance: CreditAmount; dailyPointsBalance?: CreditAmount; dailyPointsExpiresAt?: string | null }, client?: PoolClient): Promise<WalletBalance> {
  checkId(transferId);
  const permanent = creditUnits(input.permanentPointsBalance);
  const daily = creditUnits(input.dailyPointsBalance ?? 0);
  const expiry = input.dailyPointsExpiresAt ? new Date(input.dailyPointsExpiresAt) : null;
  if (permanent < 0n || daily < 0n || (expiry && !Number.isFinite(expiry.getTime())) || (daily > 0n && !expiry)) throw httpError(400, 'Invalid normalized wallet transfer');
  const operationId = `import:${transferId}:${userId}`;
  checkId(operationId);
  return walletTransaction(ctx, client, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [operationId]);
    const row = await lockWallet(db, userId);
    const prior = (await db.query<OperationRow>('SELECT * FROM oaooao_wallet_operations WHERE operation_id=$1', [operationId])).rows[0];
    if (prior) {
      if (prior.user_id !== userId || prior.permanent_after !== creditDecimal(permanent) || prior.daily_after !== creditDecimal(daily) || (prior.daily_expires_at?.toISOString() ?? null) !== (expiry?.toISOString() ?? null)) throw httpError(409, 'Transfer identifier already used for different balances');
      return getWallet(ctx,userId,db);
    }
    if (creditUnits(row.permanent_balance) !== 0n || creditUnits(row.daily_balance) !== 0n || (await db.query('SELECT 1 FROM oaooao_wallet_operations WHERE user_id=$1 LIMIT 1', [userId])).rowCount) throw httpError(409, 'Wallet already has financial history; transfer refused');
    const updated = (await db.query<WalletRow>('UPDATE oaooao_wallets SET permanent_balance=$2,daily_balance=$3,daily_allowance=$3,daily_spent=0,daily_expires_at=$4,updated_at=now() WHERE user_id=$1 RETURNING *', [userId, creditDecimal(permanent), creditDecimal(daily), expiry])).rows[0]!;
    await db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after,daily_expires_at,metadata) VALUES($1,$2,$3,$4,$5,$4,$5,$6,$7)`, [operationId, userId, creditDecimal(permanent + daily), creditDecimal(permanent), creditDecimal(daily), expiry, { kind: 'normalized_transfer', transferId }]);
    return balances(updated);
  });
}
/** Recompute today's entitlement after a plan change without replenishing credits already spent. */
export async function syncDailyEntitlement(ctx: Context, userId: string, operationId: string, client?: PoolClient): Promise<WalletBalance> {
  checkId(operationId);
  return walletTransaction(ctx,client,async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[operationId]);
    const {row,at}=await prepareWallet(db,userId);
    const previous = (await db.query('SELECT user_id FROM oaooao_wallet_operations WHERE operation_id=$1',[operationId])).rows[0];
    if (previous) { if (previous.user_id !== userId) throw httpError(409,'Operation identifier already used'); return balances(row); }
    const allowance = await dailyEntitlement(db,userId,at);
    const newBalance = allowance - creditUnits(row.daily_spent);
    const daily = newBalance > 0n ? newBalance : 0n;
    const delta = daily - creditUnits(row.daily_balance);
    const updated = {...(await db.query<WalletRow>('UPDATE oaooao_wallets SET daily_balance=$2,daily_allowance=$3,updated_at=now() WHERE user_id=$1 RETURNING *',[userId,creditDecimal(daily),creditDecimal(allowance)])).rows[0]!,batches:row.batches};
    await db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after,daily_expires_at,metadata,timed_after,created_at) VALUES($1,$2,$3,0,$3,$4,$5,$6,$7,$8,$9)`,[operationId,userId,creditDecimal(delta),row.permanent_balance,updated.daily_balance,updated.daily_expires_at,{kind:'daily_entitlement_change',allowance:creditDecimal(allowance)},creditDecimal(timedUnits(row)),await operationTime(db,userId,at)]);
    return balances(updated);
  });
}
/** Explicit administrative assignments are distinct from archived or purchased plan labels. */
export async function assignAdminPlan(ctx: Context, userId: string, operationId: string, planId: string | null, client?: PoolClient): Promise<WalletBalance> {
  checkId(operationId);
  return walletTransaction(ctx,client,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[operationId]);
    const previous=(await db.query('SELECT user_id,metadata FROM oaooao_wallet_operations WHERE operation_id=$1',[operationId])).rows[0];
    if(previous){if(previous.user_id!==userId || previous.metadata.planId!==planId)throw httpError(409,'Plan assignment identifier already used');return getWallet(ctx,userId,db);}
    const settings=(await db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0]?.value ?? {};
    if(planId && (settings.entitlements?.enabled!==true || !settings.entitlements.plans?.some((plan:Record<string,unknown>)=>plan.id===planId && plan.enabled===true)))throw httpError(400,'Administrative plan must refer to an enabled entitlement plan');
    await adjustWallet(ctx,userId,operationId,0,{kind:'admin_plan_assignment',planId},db);
    if(planId)await db.query('INSERT INTO oaooao_admin_plan_assignments(user_id,plan_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,assigned_at=now()',[userId,planId]);
    else await db.query('DELETE FROM oaooao_admin_plan_assignments WHERE user_id=$1',[userId]);
    await db.query('UPDATE oaooao_users SET plan_id=$2,updated_at=now() WHERE id=$1',[userId,planId]);
    return syncDailyEntitlement(ctx,userId,`${operationId}:daily`,db);
  });
}
export async function getPlanSummary(ctx: Context, userId: string, client?: PoolClient,at?:Date): Promise<{planId?:string;planName?:string;hasActivePlan:boolean;planExpiresAt?:string}> {
  const db=client ?? ctx.db;
  const row=(await db.query(`SELECT u.plan_id AS label,a.plan_id AS administrative,p.plan_id AS purchased,p.expires_at,s.value FROM oaooao_users u LEFT JOIN oaooao_admin_plan_assignments a ON a.user_id=u.id LEFT JOIN LATERAL(SELECT plan_id,expires_at FROM oaooao_plan_grants WHERE user_id=u.id AND revoked_at IS NULL AND starts_at<=coalesce($2::timestamptz,clock_timestamp()) AND expires_at>coalesce($2::timestamptz,clock_timestamp()) ORDER BY starts_at DESC,id DESC LIMIT 1)p ON true LEFT JOIN oaooao_settings s ON s.id='global' WHERE u.id=$1`,[userId,at ?? null])).rows[0];
  if(!row)return {hasActivePlan:false};
  const entitlements=row.value?.entitlements;const administrative=entitlements?.enabled===true && entitlements.plans?.some((plan:Record<string,unknown>)=>plan.id===row.administrative && plan.enabled===true)?row.administrative:undefined;
  const planId=administrative || row.purchased || row.label || undefined;
  const definition=entitlements?.plans?.find((plan:Record<string,unknown>)=>plan.id===planId);
  return {planId,planName:definition?.name,hasActivePlan:Boolean(administrative || row.purchased),planExpiresAt:!administrative && row.purchased?row.expires_at?.toISOString():undefined};
}
