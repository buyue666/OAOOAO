import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, transaction, type Context } from './core.js';
import { DIRECTOR_LATEST, directorPreference, validDirectorVersion, type PluginPreference } from './creative-plugin-versions.js';

// Only reviewed, bundled tools are installable; no remote executable code.
export const CREATIVE_PLUGIN_IDS = ['remix', 'tryon', 'agent', 'drama', 'canvas', 'director'] as const;
export type CreativePluginId = typeof CREATIVE_PLUGIN_IDS[number];

export function pluginChangeIds(id: CreativePluginId, installed: boolean): CreativePluginId[] {
  if (id === 'director' && installed) return ['canvas', 'director'];
  if (id === 'canvas' && !installed) return ['director', 'canvas'];
  return [id];
}

export async function accountInstalledPlugins(ctx: Context, userId: string, client?: PoolClient): Promise<CreativePluginId[]> {
  const result = await (client || ctx.db).query('SELECT plugin_id FROM oaooao_account_plugins WHERE user_id=$1 AND enabled ORDER BY plugin_id', [userId]);
  return result.rows.map(row => row.plugin_id).filter((id): id is CreativePluginId => CREATIVE_PLUGIN_IDS.includes(id));
}

export async function accountPluginPreferences(ctx: Context, userId: string, client?: PoolClient): Promise<Record<string, PluginPreference>> {
  const result = await (client || ctx.db).query("SELECT plugin_id,plugin_version,auto_update FROM oaooao_account_plugins WHERE user_id=$1 AND plugin_id='director'", [userId]);
  return Object.fromEntries(result.rows.map(row => [row.plugin_id, directorPreference(row.plugin_version, row.auto_update)]));
}

/** Each toggle is serialized per account, including dependent tool changes. */
export async function registerCreativePlugins(app: FastifyInstance, ctx: Context) {
  app.get('/api/account/plugins', async request => {
    const user = await ctx.requireUser(request);
    return { installedPlugins: await accountInstalledPlugins(ctx, user.id), pluginPreferences: await accountPluginPreferences(ctx, user.id) };
  });
  app.patch('/api/account/plugins', async request => {
    const user = await ctx.requireUser(request), body = object(request.body);
    const toggle = typeof body.installed === 'boolean';
    const versionChange = body.pluginId === 'director' && !('installed' in body)
      && ('version' in body || 'autoUpdate' in body)
      && (!('version' in body) || validDirectorVersion(body.version))
      && (!('autoUpdate' in body) || typeof body.autoUpdate === 'boolean');
    if (!CREATIVE_PLUGIN_IDS.includes(body.pluginId) || !(toggle || versionChange)
      || Object.keys(body).some(key => !['pluginId', ...(toggle ? ['installed'] : ['version', 'autoUpdate'])].includes(key)))
      throw httpError(400, '功能设置无效');
    return transaction(ctx.db, async client => {
      await client.query('SELECT id FROM oaooao_users WHERE id=$1 FOR UPDATE', [user.id]);
      if (versionChange) {
        const current = (await client.query('SELECT plugin_version,auto_update,enabled FROM oaooao_account_plugins WHERE user_id=$1 AND plugin_id=$2', [user.id, body.pluginId])).rows[0];
        const autoUpdate = body.autoUpdate ?? (body.version ? false : (current?.auto_update ?? false));
        const version = autoUpdate ? DIRECTOR_LATEST : body.version ?? directorPreference(current?.plugin_version ?? DIRECTOR_LATEST, current?.auto_update ?? false).version;
        await client.query('INSERT INTO oaooao_account_plugins(user_id,plugin_id,plugin_version,auto_update,enabled) VALUES($1,$2,$3,$4,false) ON CONFLICT(user_id,plugin_id) DO UPDATE SET plugin_version=EXCLUDED.plugin_version,auto_update=EXCLUDED.auto_update', [user.id, body.pluginId, version, autoUpdate]);
      } else {
        const ids = pluginChangeIds(body.pluginId, body.installed);
        if (body.installed) {
          for (const id of ids) await client.query('INSERT INTO oaooao_account_plugins(user_id,plugin_id,plugin_version) VALUES($1,$2,$3) ON CONFLICT(user_id,plugin_id) DO UPDATE SET enabled=true', [user.id, id, id === 'director' ? DIRECTOR_LATEST : '']);
        } else {
          await client.query('UPDATE oaooao_account_plugins SET enabled=false WHERE user_id=$1 AND plugin_id=ANY($2::text[])', [user.id, ids]);
        }
      }
      return { installedPlugins: await accountInstalledPlugins(ctx, user.id, client), pluginPreferences: await accountPluginPreferences(ctx, user.id, client) };
    });
  });
}
