import type { FastifyInstance } from 'fastify';
import { httpError, object, transaction, type Context } from './core.js';
import { getSettings, publicSettings } from './settings.js';
import { adultContentPreference, ADULT_CONTENT_AGREEMENT, ADULT_CONTENT_POLICY_VERSION } from './content-policy.js';

export async function registerContentPreferences(app: FastifyInstance, ctx: Context) {
  async function response(userId: string) {
    const models = publicSettings(await getSettings(ctx)).logicalModels;
    return { adultContent: await adultContentPreference(ctx, userId), agreement: ADULT_CONTENT_AGREEMENT,
      models: { allowed: models.filter((m: any) => m.allowAdultContent === true).map((m: any) => ({ id: m.id, name: m.name })),
        blocked: models.filter((m: any) => m.allowAdultContent !== true).map((m: any) => ({ id: m.id, name: m.name })) } };
  }
  app.get('/api/account/content-preference', async request => response((await ctx.requireUser(request)).id));
  app.patch('/api/account/content-preference', async request => {
    const user = await ctx.requireUser(request), body = object(request.body);
    if (Object.keys(body).some(key => !['enabled', 'adultConfirmed', 'acknowledgedPolicyVersion'].includes(key)) || typeof body.enabled !== 'boolean')
      throw httpError(400, '成人内容设置无效');
    if (body.enabled && (body.adultConfirmed !== true || body.acknowledgedPolicyVersion !== ADULT_CONTENT_POLICY_VERSION))
      throw httpError(400, '请先声明已满 18 周岁，并同意当前版本的成人内容使用约定');
    await transaction(ctx.db, async client => {
      await client.query('SELECT id FROM oaooao_users WHERE id=$1 FOR UPDATE', [user.id]);
      await client.query(`INSERT INTO oaooao_content_preferences(user_id,adult_enabled,acknowledged_policy_version,age_declared_at)
        VALUES($1,$2,$3,CASE WHEN $2 THEN now() ELSE NULL END)
        ON CONFLICT(user_id) DO UPDATE SET adult_enabled=$2,
          acknowledged_policy_version=CASE WHEN $2 THEN $3 ELSE oaooao_content_preferences.acknowledged_policy_version END,
          age_declared_at=CASE WHEN $2 THEN now() ELSE oaooao_content_preferences.age_declared_at END,updated_at=now()`,
      [user.id, body.enabled, body.enabled ? ADULT_CONTENT_POLICY_VERSION : null]);
      await ctx.audit({ actorId: user.id, action: 'account.adult_content', targetType: 'user', targetId: user.id,
        metadata: { enabled: body.enabled, policyVersion: ADULT_CONTENT_POLICY_VERSION, adultDeclared: body.enabled } }, client);
    });
    return response(user.id);
  });
}
