import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, transaction, type Context } from './core.js';
import { getSettings, publicSettings } from './settings.js';
import { personalGenerationPlan } from './entitlements.js';
import { accountInstalledPlugins, registerCreativePlugins } from './creative-plugins.js';

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
  let personalModelIds: string[] | undefined;
  try { personalModelIds = (await personalGenerationPlan(ctx, settings, userId))?.allowedModelIds }
  catch (error) { if ((error as { statusCode?: number }).statusCode === 403) personalModelIds = []; else throw error }
  const visible = publicSettings(settings);
  const available = { ...settings, logicalModels: settings.logicalModels.filter((model: any) => personalModelIds === undefined || personalModelIds.includes(model.id)) };
  const defaults = { ...settings.defaultModels };
  for (const [key,id] of Object.entries(chosen)) if (availableDefault(available, key, id)) defaults[key] = id;
  for (const kind of capabilities) {
    const key = kind + 'Model';
    if (!availableDefault(available, key, defaults[key] || '')) defaults[key] = publicSettings(available).logicalModels.find((model: any) => model.capability === kind)?.id || '';
  }
  return { ...visible, defaultModels: defaults, userDefaultModels: chosen, installedPlugins: await accountInstalledPlugins(ctx, userId), ...(personalModelIds !== undefined ? { personalModelIds } : {}) };
}
export async function registerAccountPreferences(app: FastifyInstance, ctx: Context) {
  await registerCreativePlugins(app, ctx);
  app.get('/api/account/model-defaults', async request => {
    const user = await ctx.requireUser(request);
    return { defaultModels: await accountModelDefaults(ctx, user.id) };
  });
  app.patch('/api/account/model-defaults', async request => {
    const user = await ctx.requireUser(request), patch = object(request.body);
    const result = await transaction(ctx.db, async client => {
      const settings = await getSettings(ctx, client);
      const plan = await personalGenerationPlan(ctx, settings, user.id, client);
      for (const [key,id] of Object.entries(patch)) {
        if (!capabilities.some(c => c + 'Model' === key) || typeof id !== 'string' || id.length > 250)
          throw httpError(400, '默认模型设置无效');
        if (id && !availableDefault(settings,key,id)) throw httpError(400, '所选模型不可用，请刷新后重新选择');
        if (id && Array.isArray(plan?.allowedModelIds) && !settings.logicalModels.some((model: any) => plan.allowedModelIds.includes(model.id) && (model.id === id || model.bindings.some((binding: any) => binding.requestAlias === id)))) throw httpError(403, '当前个人套餐未开放此模型');
      }
      await client.query('INSERT INTO oaooao_account_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING', [user.id]);
      return (await client.query('UPDATE oaooao_account_preferences SET default_models=default_models || $2::jsonb,updated_at=now() WHERE user_id=$1 RETURNING default_models', [user.id, JSON.stringify(patch)])).rows[0].default_models;
    });
    return { defaultModels: result };
  });
}
