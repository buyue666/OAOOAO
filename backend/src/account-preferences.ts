import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, transaction, type Context } from './core.js';
import { getSettings, publicSettings } from './settings.js';

const capabilities = ['image', 'video', 'text', 'audio'] as const;
export async function accountModelDefaults(ctx: Context, userId: string, client?: PoolClient): Promise<Record<string,string>> {
  return (await (client || ctx.db).query('SELECT default_models FROM oaooao_account_preferences WHERE user_id=$1', [userId])).rows[0]?.default_models || {};
}
export function availableDefault(settings: Record<string,any>, key: string, id: string): boolean {
  return publicSettings(settings).logicalModels.some((m: any) => m.capability + 'Model' === key
    && (m.id === id || m.bindings.some((b: any) => b.requestAlias === id)));
}
export async function userSessionSettings(ctx: Context, userId: string, settings: Record<string,any>) {
  const chosen = await accountModelDefaults(ctx, userId);
  const defaults = { ...settings.defaultModels };
  for (const [key,id] of Object.entries(chosen)) if (availableDefault(settings, key, id)) defaults[key] = id;
  return { ...publicSettings(settings), defaultModels: defaults, userDefaultModels: chosen };
}
export async function registerAccountPreferences(app: FastifyInstance, ctx: Context) {
  app.get('/api/account/model-defaults', async request => {
    const user = await ctx.requireUser(request);
    return { defaultModels: await accountModelDefaults(ctx, user.id) };
  });
  app.patch('/api/account/model-defaults', async request => {
    const user = await ctx.requireUser(request), patch = object(request.body);
    const result = await transaction(ctx.db, async client => {
      const settings = await getSettings(ctx, client);
      for (const [key,id] of Object.entries(patch)) {
        if (!capabilities.some(c => c + 'Model' === key) || typeof id !== 'string' || id.length > 250)
          throw httpError(400, '默认模型设置无效');
        if (id && !availableDefault(settings,key,id)) throw httpError(400, '所选模型不可用，请刷新后重新选择');
      }
      await client.query('INSERT INTO oaooao_account_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING', [user.id]);
      return (await client.query('UPDATE oaooao_account_preferences SET default_models=default_models || $2::jsonb,updated_at=now() WHERE user_id=$1 RETURNING default_models', [user.id, JSON.stringify(patch)])).rows[0].default_models;
    });
    return { defaultModels: result };
  });
}
