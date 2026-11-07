import type { FastifyInstance } from 'fastify';
import { httpError, object, string, transaction, type Context } from './core.js';
import { creditDecimal, creditUnits } from './wallet.js';
import { assertTeamSeats, lockTeam, teamEvent, teamView, type TeamRow } from './team-access.js';
import { grantTeamCredits } from './team-wallet.js';

function integer(value: unknown, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw httpError(400, `${name}必须是 ${min} 至 ${max} 的整数`);
  return Number(value);
}
export function teamPlanView(row: TeamRow) {
  return { id: row.id, name: row.name, description: row.description, enabled: row.enabled, priceCents: row.price_cents === null ? null : Number(row.price_cents), minSeats: row.min_seats, maxSeats: row.max_seats, reviewerLimit: row.reviewer_limit, pointsPerSeat: Number(row.points_per_seat), creditValidityDays: row.credit_validity_days, storageBytes: Number(row.storage_bytes), teamConcurrency: row.team_concurrency, memberConcurrency: row.member_concurrency, taskLimit: Number(row.task_limit), modelIds: row.model_ids };
}

export async function registerTeamPlans(app: FastifyInstance, ctx: Context) {
  app.get('/api/team-plans', async () => {
    const rows = (await ctx.db.query('SELECT * FROM oaooao_team_plans ORDER BY id DESC')).rows;
    return { plans: rows.map(row => teamPlanView(row.enabled ? row : { ...row, price_cents: null })), purchaseEnabled: false };
  });
  app.get('/api/admin/team-plans', async request => {
    await ctx.requireUser(request, 'commerce.manage');
    return { plans: (await ctx.db.query('SELECT * FROM oaooao_team_plans ORDER BY id DESC')).rows.map(teamPlanView) };
  });
  app.patch('/api/admin/team-plans/:id', async request => {
    const user = await ctx.requireUser(request, 'commerce.manage'), { id } = request.params as { id: string }, body = object(request.body);
    const allowed = ['name','description','enabled','priceCents','minSeats','maxSeats','reviewerLimit','pointsPerSeat','creditValidityDays','storageBytes','teamConcurrency','memberConcurrency','taskLimit','modelIds'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw httpError(400, '不支持的团队套餐字段');
    return transaction(ctx.db, async db => {
      const old = (await db.query('SELECT * FROM oaooao_team_plans WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!old) throw httpError(404, '套餐不存在');
      const value = { ...teamPlanView(old), ...body };
      if (typeof value.enabled !== 'boolean') throw httpError(400, '套餐启用状态无效');
      const price = value.priceCents === null ? null : integer(value.priceCents, 1, 100000000, '每席价格（分）');
      if (value.enabled && price === null) throw httpError(400, '请先完成定价再发布套餐');
      const min = integer(value.minSeats, 2, 100, '最低席位'), max = integer(value.maxSeats, min, 100, '最多席位');
      const reviewers = integer(value.reviewerLimit, 0, 500, '审阅名额'), validity = integer(value.creditValidityDays, 1, 365, '积分有效天数');
      const storage = integer(value.storageBytes, 1, 1024 ** 5, '团队总容量'), concurrent = integer(value.teamConcurrency, 1, 100, '团队并发'), perMember = integer(value.memberConcurrency, 1, concurrent, '成员并发');
      const points = creditUnits(value.pointsPerSeat), taskLimit = creditUnits(value.taskLimit);
      if (points < 0n || taskLimit <= 0n) throw httpError(400, '积分额度或单次上限无效');
      if (!Array.isArray(value.modelIds) || value.modelIds.length > 200 || value.modelIds.some((item: unknown) => typeof item !== 'string' || item.length > 200)) throw httpError(400, '模型范围无效');
      const modelIds = [...new Set(value.modelIds as string[])];
      if (modelIds.length) {
        const configured = (await db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0]?.value?.logicalModels ?? [];
        if (modelIds.some(modelId => !configured.some((model: TeamRow) => model.id === modelId && model.enabled))) throw httpError(400, '请使用站点中已启用的逻辑模型 ID');
      }
      const row = (await db.query('UPDATE oaooao_team_plans SET name=$2,description=$3,enabled=$4,price_cents=$5,min_seats=$6,max_seats=$7,reviewer_limit=$8,points_per_seat=$9,credit_validity_days=$10,storage_bytes=$11,team_concurrency=$12,member_concurrency=$13,task_limit=$14,model_ids=$15,updated_at=now() WHERE id=$1 RETURNING *', [id, string(value.name, '套餐名称', 80), string(value.description, '套餐说明', 2000, true), value.enabled, price, min, max, reviewers, creditDecimal(points), validity, storage, concurrent, perMember, creditDecimal(taskLimit), JSON.stringify(modelIds)])).rows[0];
      await ctx.audit({ actorId: user.id, action: 'team.plan.updated', targetType: 'team-plan', targetId: id, metadata: { enabled: value.enabled } }, db);
      return { plan: teamPlanView(row) };
    });
  });
  app.get('/api/admin/teams', async request => {
    await ctx.requireUser(request, 'billing.manage');
    const rows = (await ctx.db.query("SELECT *, 'owner' AS role FROM oaooao_teams ORDER BY created_at DESC LIMIT 100")).rows;
    return { teams: await Promise.all(rows.map(row => teamView(ctx.db, row))) };
  });
  app.post('/api/admin/teams/:teamId/subscription', async request => {
    const actor = await ctx.requireUser(request, 'billing.manage'), { teamId } = request.params as { teamId: string }, body = object(request.body);
    const planId = string(body.planId, '套餐 ID', 100), seats = integer(body.seats, 2, 100, '创作席位'), reason = string(body.reason, '开通依据', 1000), key = string(body.operationId, '幂等标识', 100);
    if (reason.length < 5 || !/^[\w-]{8,100}$/.test(key) || body.confirmManualGrant !== true) throw httpError(400, '请确认人工开通，并填写至少 5 字的依据和有效幂等标识');
    return transaction(ctx.db, async db => {
      const team = await lockTeam(db, teamId);
      const previous = (await db.query("SELECT details FROM oaooao_team_events WHERE team_id=$1 AND action='subscription.assigned' AND details->>'operationId'=$2", [teamId, key])).rows[0];
      if (previous) { if (previous.details.planId !== planId || previous.details.seats !== seats) throw httpError(409, '此操作标识已用于不同的团队权益'); return { ok: true } }
      const now = (await db.query('SELECT clock_timestamp() at')).rows[0].at as Date;
      if (team.subscription_expires_at && team.subscription_expires_at > now) throw httpError(409, '当前团队权益尚未到期。为避免重复发放整期积分，当前不支持周期内重新开通。');
      const plan = (await db.query('SELECT * FROM oaooao_team_plans WHERE id=$1 AND enabled FOR SHARE', [planId])).rows[0];
      if (!plan) throw httpError(404, '请先发布并核定团队套餐');
      if (seats < plan.min_seats || seats > plan.max_seats) throw httpError(400, '席位数不在套餐允许范围内');
      const expires = new Date(now.getTime() + 30 * 86400000);
      const updated = (await db.query('UPDATE oaooao_teams SET seat_limit=$2,reviewer_limit=$3,storage_quota_bytes=$4,team_concurrency=$5,member_concurrency=$6,task_limit=$7,model_ids=$8,plan_id=$9,subscription_expires_at=$10,updated_at=now() WHERE id=$1 RETURNING *', [teamId, seats, plan.reviewer_limit, plan.storage_bytes, plan.team_concurrency, plan.member_concurrency, plan.task_limit, JSON.stringify(plan.model_ids), plan.id, expires])).rows[0];
      await assertTeamSeats(db, updated);
      const credits = creditUnits(plan.points_per_seat) * BigInt(seats);
      if (credits > 0n) await grantTeamCredits(ctx, db, teamId, actor.id, key, creditDecimal(credits), new Date(now.getTime() + plan.credit_validity_days * 86400000), reason, 'subscription');
      await teamEvent(db, teamId, actor.id, 'subscription.assigned', { operationId: key, planId, seats, expiresAt: expires.toISOString(), reason });
      await ctx.audit({ actorId: actor.id, action: 'team.subscription.manual_grant', targetType: 'team', targetId: teamId, metadata: { planId, seats, reason, paymentRecorded: false } }, db);
      return { ok: true };
    });
  });
  app.post('/api/admin/teams/:teamId/credits', async request => {
    const actor = await ctx.requireUser(request, 'billing.manage'), { teamId } = request.params as { teamId: string }, body = object(request.body);
    const reason = string(body.reason, '发放依据', 1000), key = string(body.operationId, '幂等标识', 100);
    if (reason.length < 5) throw httpError(400, '请填写至少 5 字的发放依据');
    const expiry = body.expiresAt === null ? null : new Date(string(body.expiresAt, '到期时间', 40));
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() > Date.now() + 3650 * 86400000)) throw httpError(400, '积分到期时间无效');
    return transaction(ctx.db, async db => { await grantTeamCredits(ctx, db, teamId, actor.id, key, body.amount, expiry, reason); return { ok: true } });
  });
}
