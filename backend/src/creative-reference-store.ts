import type { PoolClient } from 'pg';
import { httpError, type Context } from './core.js';
import { getObject } from './object-storage.js';

export const creativeReferenceId = /^[a-z0-9][a-z0-9_-]{0,127}$/;
export function creativeReferencePath(path: string): string | undefined {
  return /^\/api\/creative-references\/([a-z0-9][a-z0-9_-]{0,127})\/content$/.exec(path)?.[1];
}
export async function creativeReferenceRow(ctx: Context, id: string, client?: PoolClient) {
  if (!creativeReferenceId.test(id)) throw httpError(404, '图库素材不存在');
  const row = (await (client || ctx.db).query('SELECT * FROM oaooao_creative_references WHERE id=$1 AND enabled', [id])).rows[0];
  if (!row) throw httpError(404, '图库素材不存在或已停用');
  return row;
}
export async function readCreativeReference(ctx: Context, id: string) {
  const row = await creativeReferenceRow(ctx, id);
  return { bytes: await getObject(ctx, row.storage_location), mimeType: String(row.mime_type) };
}
