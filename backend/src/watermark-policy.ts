import type { PoolClient } from 'pg';
import type { Context } from './core.js';

export const DEFAULT_WATERMARK_POLICY = { enabled: true, confirmationRequired: true };
export async function watermarkPolicy(ctx: Context, client?: PoolClient) {
  const raw = (await (client || ctx.db).query('SELECT value FROM oaooao_settings WHERE id=$1', ['global'])).rows[0]?.value?.watermarkPolicy;
  return { enabled: raw?.enabled !== false, confirmationRequired: raw?.confirmationRequired !== false };
}
