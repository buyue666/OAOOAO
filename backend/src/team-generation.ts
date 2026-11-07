import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, string, transaction, type Context } from './core.js';
import { generationInput, inputHash, taskView } from './creative.js';
import { creditUnits } from './wallet.js';
import { getSettings } from './settings.js';
import { resolveProvider, type GenerationKind, type Json } from './providers.js';
import { lockTeam, requireTeam, requireTeamProject, teamEvent, teamManager } from './team-access.js';
import { debitTeamCredits } from './team-wallet.js';
import { cancelJob } from './worker.js';
import type { TeamWorkspace } from './team-assets.js';

function parseInput(body: Json, workspace: TeamWorkspace) {
  if (!['text','image','video','audio'].includes(body.kind)) throw httpError(400, '生成类型无效');
  const kind = body.kind as GenerationKind;
  const input = generationInput(kind, { ...body, kind: undefined, context: { teamId: workspace.teamId, projectId: workspace.projectId }, source: 'team' });
  return { kind, input };
}

async function prepareTeamGeneration(ctx: Context, db: PoolClient, workspace: TeamWorkspace, userId: string, kind: GenerationKind, input: Json) {
  const team = await requireTeam(db, workspace.teamId, userId, 'write');
  await requireTeamProject(db, workspace.teamId, userId, workspace.projectId, 'write');
  const now = (await db.query('SELECT clock_timestamp() at')).rows[0].at;
  if (!team.subscription_expires_at || team.subscription_expires_at <= now) throw httpError(402, '团队套餐尚未开通或已到期，现有项目仍可按权限查看');
  const references = [...(input.references || []), ...(input.edit?.mask ? [input.edit.mask] : [])];
  for (const ref of references) {
    if (typeof ref.url !== 'string') continue;
    let url: URL; try { url = new URL(ref.url, ctx.config.origin) } catch { throw httpError(400, '参考素材链接无效') }
    if (url.origin !== new URL(ctx.config.origin).origin) throw httpError(400, '请将参考素材上传或复制到当前团队项目');
    const match = /^\/api\/teams\/([^/]+)\/assets\/([a-f0-9-]{36})\/content$/i.exec(url.pathname);
    if (!match || match[1] !== workspace.teamId || url.search) throw httpError(403, '不能使用其他空间的参考素材');
    const found = await db.query("SELECT id FROM oaooao_team_assets WHERE id=$1 AND team_id=$2 AND project_id=$3 AND status='ready'", [match[2], workspace.teamId, workspace.projectId]);
    if (!found.rowCount) throw httpError(404, '参考素材不属于当前团队项目');
  }
  const provider = await resolveProvider({ ...ctx, workspace }, kind, input, db, userId);
  if (team.model_ids.length && !team.model_ids.includes(provider.model)) throw httpError(403, '此模型不在团队可用范围内');
  return { team, provider };
}

export async function createTeamJob(ctx: Context, workspace: TeamWorkspace, userId: string, raw: Json, requestId: string) {
  if (!/^[\w-]{8,100}$/.test(requestId)) throw httpError(400, '请提供稳定的任务提交标识');
  const { kind, input } = parseInput(raw, workspace), key = `team:${workspace.teamId}:${requestId}`, hash = inputHash(input);
  const approved = creditUnits(raw.approvedCost);
  if (approved < 0n) throw httpError(400, '确认费用无效');
  return transaction(ctx.db, async db => {
    await lockTeam(db, workspace.teamId);
    await requireTeamProject(db, workspace.teamId, userId, workspace.projectId, 'write');
    const existing = (await db.query('SELECT * FROM oaooao_generation_jobs WHERE team_id=$1 AND user_id=$2 AND kind=$3 AND client_request_id=$4 AND attempt_no=1', [workspace.teamId, userId, kind, key])).rows[0];
    if (existing) { if (existing.input_hash !== hash) throw httpError(409, '提交标识已用于不同的任务'); return existing }
    const { team, provider } = await prepareTeamGeneration(ctx, db, workspace, userId, kind, input);
    if (creditUnits(provider.cost) > approved) throw httpError(409, '当前费用高于确认报价，请重新获取报价');
    const active = (await db.query("SELECT count(*) total,count(*) FILTER(WHERE user_id=$2) member FROM oaooao_generation_jobs WHERE team_id=$1 AND status IN ('pending','running','paused')", [workspace.teamId, userId])).rows[0];
    if (Number(active.total) >= team.team_concurrency || Number(active.member) >= team.member_concurrency) throw httpError(429, '团队或当前成员的并发已满，请等待正在执行的任务');
    const settings = await getSettings(ctx, db), totalLimit = settings.generationCostControl?.dailyTotalPointSpend;
    if (Number(totalLimit) > 0) {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('generation:global-budget',0))");
      const total = (await db.query("SELECT coalesce(sum(cost),0)::text amount FROM oaooao_generation_jobs WHERE created_at>=date_trunc('day',now()) AND status NOT IN ('error','cancelled')")).rows[0].amount;
      if (creditUnits(total) + creditUnits(provider.cost) > creditUnits(totalLimit)) throw httpError(429, '站点今日生成消费已达上限');
    }
    const id = randomUUID();
    await debitTeamCredits(db, workspace.teamId, userId, id, provider.cost);
    const row = (await db.query('INSERT INTO oaooao_generation_jobs(id,user_id,team_id,team_project_id,kind,client_request_id,input_hash,input,model,channel_id,upstream_model,provider_config,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *', [id, userId, workspace.teamId, workspace.projectId, kind, key, hash, input, provider.model, provider.channelId, provider.upstreamModel, { ...provider.config, storeGeneratedMedia: true }, provider.cost])).rows[0];
    await teamEvent(db, workspace.teamId, userId, 'generation.created', { taskId: id, projectId: workspace.projectId, cost: provider.cost });
    return row;
  });
}

export async function registerTeamGeneration(app: FastifyInstance, ctx: Context) {
  const root = '/api/teams/:teamId/projects/:projectId/generations';
  app.post(root + '/quote', { bodyLimit: 34 * 1024 * 1024 }, async request => {
    const user = await ctx.requireUser(request), workspace = request.params as TeamWorkspace, { kind, input } = parseInput(object(request.body), workspace);
    return transaction(ctx.db, async db => { const { provider } = await prepareTeamGeneration(ctx, db, workspace, user.id, kind, input); return { points: Number(provider.cost), model: provider.model } });
  });
  app.post(root, { bodyLimit: 34 * 1024 * 1024 }, async (request, reply) => {
    const user = await ctx.requireUser(request), workspace = request.params as TeamWorkspace;
    const row = await createTeamJob(ctx, workspace, user.id, object(request.body), string(request.headers['idempotency-key'], '任务提交标识', 100));
    reply.code(202); return { task: taskView(row) };
  });
  app.get(root, async request => {
    const user = await ctx.requireUser(request), workspace = request.params as TeamWorkspace;
    await requireTeamProject(ctx.db, workspace.teamId, user.id, workspace.projectId);
    const rows = (await ctx.db.query('SELECT * FROM oaooao_generation_jobs WHERE team_id=$1 AND team_project_id=$2 ORDER BY created_at DESC,id LIMIT 50', [workspace.teamId, workspace.projectId])).rows;
    return { tasks: rows.map(row => ({ ...taskView(row), actorId: row.user_id })) };
  });
  app.post(root + '/:id/cancel', async request => {
    const user = await ctx.requireUser(request), { teamId, projectId, id } = request.params as TeamWorkspace & { id: string };
    return transaction(ctx.db, async db => {
      const row = (await db.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1 AND team_id=$2 AND team_project_id=$3 FOR UPDATE', [id, teamId, projectId])).rows[0];
      if (!row) throw httpError(404, '任务不存在');
      await lockTeam(db, teamId);
      const member = await requireTeamProject(db, teamId, user.id, projectId, 'write');
      if (!teamManager(member.role) && row.user_id !== user.id) throw httpError(403, '只能取消自己的任务');
      return { task: taskView(await cancelJob(ctx, db, id, row.user_id)) };
    });
  });
}
