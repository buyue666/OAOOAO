import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, transaction, type Context } from './core.js';

// Only reviewed, bundled tools are installable; no remote executable code.
export const CREATIVE_PLUGIN_IDS = ['remix', 'tryon', 'agent', 'drama', 'canvas', 'director'] as const;
export type CreativePluginId = typeof CREATIVE_PLUGIN_IDS[number];

export function pluginChangeIds(id: CreativePluginId, installed: boolean): CreativePluginId[] {
  if (id === 'director' && installed) return ['canvas', 'director'];
  if (id === 'canvas' && !installed) return ['director', 'canvas'];
  return [id];
}

export async function accountInstalledPlugins(ctx: Context, userId: string, client?: PoolClient): Promise<CreativePluginId[]> {
  const result = await (client || ctx.db).query('SELECT plugin_id FROM oaooao_account_plugins WHERE user_id=$1 ORDER BY plugin_id', [userId]);
  return result.rows.map(row => row.plugin_id).filter((id): id is CreativePluginId => CREATIVE_PLUGIN_IDS.includes(id));
}

/** Each toggle is serialized per account, including dependent tool changes. */
export async function registerCreativePlugins(app: FastifyInstance, ctx: Context) {
  app.get('/api/account/plugins', async request => {
    const user = await ctx.requireUser(request);
    return { installedPlugins: await accountInstalledPlugins(ctx, user.id) };
  });
  app.patch('/api/account/plugins', async request => {
    const user = await ctx.requireUser(request), body = object(request.body);
    if (!CREATIVE_PLUGIN_IDS.includes(body.pluginId) || typeof body.installed !== 'boolean'
      || Object.keys(body).some(key => key !== 'pluginId' && key !== 'installed'))
      throw httpError(400, '插件设置无效');
    const installedPlugins = await transaction(ctx.db, async client => {
      await client.query('SELECT id FROM oaooao_users WHERE id=$1 FOR UPDATE', [user.id]);
      const ids = pluginChangeIds(body.pluginId, body.installed);
      if (body.installed) {
        for (const id of ids) await client.query('INSERT INTO oaooao_account_plugins(user_id,plugin_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [user.id, id]);
      } else {
        await client.query('DELETE FROM oaooao_account_plugins WHERE user_id=$1 AND plugin_id=ANY($2::text[])', [user.id, ids]);
      }
      return accountInstalledPlugins(ctx, user.id, client);
    });
    return { installedPlugins };
  });
}
