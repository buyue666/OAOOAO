import type { PoolClient } from 'pg';
import { httpError, type Context } from './core.js';
import { getPlanSummary } from './wallet.js';

export const DEFAULT_STORAGE_QUOTA = 10 * 1024 ** 3;
export function validStorageQuota(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value)>=0 && Number(value)<=1024**5; }
export async function lockStorage(client: PoolClient, userId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`media-quota:${userId}`]);
}
/** Serialize creation of saved references with deletion of the referenced bytes. */
export async function lockDocumentMedia(client:PoolClient,userId:string,document:unknown) {
  await lockStorage(client,userId);
  const keys=[...new Set([...JSON.stringify(document).matchAll(/\/api\/(?:media|reference-assets|generation-log-assets)\/([a-f0-9-]{36})/gi)].map(match=>match[1]))];
  if(!keys.length)return;
  const found=await client.query('SELECT id FROM oaooao_media WHERE user_id=$1 AND id=ANY($2::text[]) AND delete_requested_at IS NULL AND (persistent OR expires_at>now())',[userId,keys]);
  if(found.rowCount!==keys.length)throw httpError(409,'部分引用素材已删除、已过期或不属于此账户，请更新素材后保存');
}
export async function storageUsage(ctx: Context,userId: string,client?: PoolClient) {
  const db=client||ctx.db;
  const settings=(await db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0]?.value||{};
  const summary=await getPlanSummary(ctx,userId,client),ent=settings.entitlements;
  const planId=summary.hasActivePlan?summary.planId:ent?.defaultPlanId;
  const plan=ent?.enabled===true?ent.plans?.find((p:any)=>p.id===planId&&p.enabled):undefined;
  const personal=(await db.query('SELECT storage_quota_bytes FROM oaooao_users WHERE id=$1',[userId])).rows[0]?.storage_quota_bytes;
  const candidate=personal==null?(plan?.storageQuotaBytes??ent?.defaultStorageQuotaBytes??DEFAULT_STORAGE_QUOTA):Number(personal);
  const quotaBytes=validStorageQuota(candidate)?Number(candidate):DEFAULT_STORAGE_QUOTA;
  const rows=await db.query('SELECT coalesce(sum(byte_count),0) used,count(*) files,coalesce(sum(byte_count) FILTER(WHERE delete_requested_at IS NOT NULL),0) pending FROM oaooao_media WHERE user_id=$1',[userId]);
  const usedBytes=Number(rows.rows[0].used),pendingDeletionBytes=Number(rows.rows[0].pending);
  return {usedBytes,quotaBytes,remainingBytes:quotaBytes===0?null:Math.max(0,quotaBytes-usedBytes),unlimited:quotaBytes===0,files:Number(rows.rows[0].files),pendingDeletionBytes,planName:plan?.name||null};
}
export async function assertStorageAvailable(ctx: Context,userId: string,bytes: number,client?: PoolClient) {
  const usage=await storageUsage(ctx,userId,client);
  if(!usage.unlimited&&usage.usedBytes+bytes>usage.quotaBytes)throw httpError(413,'存储空间不足，请到创作资产删除不再需要的素材，或联系管理员调整容量');
  return usage;
}
