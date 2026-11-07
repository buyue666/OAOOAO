import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, pagination, string, transaction, type Context } from './core.js';
import { lockTeam, projectVisibilitySql, requireTeam, requireTeamProject, teamEvent, type TeamDb, type TeamRow } from './team-access.js';

export async function teamProjectView(db: TeamDb, row: TeamRow) {
  const members = (await db.query('SELECT user_id FROM oaooao_team_project_members WHERE project_id=$1', [row.id])).rows;
  const count = (await db.query("SELECT count(*) n FROM oaooao_team_assets WHERE project_id=$1 AND team_id=$2 AND status='ready'", [row.id, row.team_id])).rows[0].n;
  return { id: row.id, teamId: row.team_id, title: row.title, description: row.description, visibility: row.visibility, memberIds: members.map(member => member.user_id), version: row.version, updatedAt: row.updated_at.toISOString(), createdBy: row.created_by, assetCount: Number(count) };
}

async function assignMembers(db: PoolClient, teamId: string, projectId: string, input: unknown) {
  if (!Array.isArray(input) || input.length > 600 || input.some(id => typeof id !== 'string' || id.length > 200)) throw httpError(400, '项目成员列表无效');
  const ids = [...new Set(input as string[])];
  const valid = await db.query('SELECT user_id FROM oaooao_team_members WHERE team_id=$1 AND user_id=ANY($2::text[])', [teamId, ids]);
  if (valid.rowCount !== ids.length) throw httpError(400, '项目只能授权给当前团队成员');
  await db.query('DELETE FROM oaooao_team_project_members WHERE project_id=$1', [projectId]);
  if (ids.length) await db.query('INSERT INTO oaooao_team_project_members(project_id,team_id,user_id) SELECT $1,$2,unnest($3::text[])', [projectId, teamId, ids]);
}

export async function registerTeamProjects(app: FastifyInstance, ctx: Context) {
  const root = '/api/teams/:teamId/projects';
  app.get(root, async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string }, page = pagination(request.query);
    await requireTeam(ctx.db, teamId, user.id);
    const rows = (await ctx.db.query(`SELECT p.*,count(*) OVER() total FROM oaooao_team_projects p JOIN oaooao_team_members m ON m.team_id=p.team_id AND m.user_id=$2 WHERE p.team_id=$1 AND ${projectVisibilitySql} ORDER BY p.updated_at DESC,p.id LIMIT $3 OFFSET $4`, [teamId, user.id, page.pageSize, page.offset])).rows;
    return { projects: await Promise.all(rows.map(row => teamProjectView(ctx.db, row))), total: Number(rows[0]?.total ?? 0) };
  });
  app.post(root, async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string }, body = object(request.body);
    const title = string(body.title, '项目名称', 120), description = string(body.description ?? '', '项目说明', 4000, true), visibility = body.visibility ?? 'restricted';
    if (!['team','restricted'].includes(visibility)) throw httpError(400, '可见范围无效');
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); await requireTeam(db, teamId, user.id, 'write');
      const row = (await db.query('INSERT INTO oaooao_team_projects(id,team_id,created_by,title,description,visibility) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [randomUUID(), teamId, user.id, title, description, visibility])).rows[0];
      await assignMembers(db, teamId, row.id, [...new Set([user.id, ...(Array.isArray(body.memberIds) ? body.memberIds : [])])]);
      await teamEvent(db, teamId, user.id, 'project.created', { projectId: row.id, visibility });
      return { project: await teamProjectView(db, row) };
    });
  });
  app.get(root + '/:projectId', async request => {
    const user = await ctx.requireUser(request), { teamId, projectId } = request.params as { teamId: string; projectId: string };
    const row = await requireTeamProject(ctx.db, teamId, user.id, projectId);
    return { project: await teamProjectView(ctx.db, row) };
  });
  app.patch(root + '/:projectId', async request => {
    const user = await ctx.requireUser(request), { teamId, projectId } = request.params as { teamId: string; projectId: string }, body = object(request.body);
    if (!Number.isSafeInteger(body.version)) throw httpError(428, '请携带当前项目版本后保存');
    if (Object.keys(body).some(key => !['version','title','description','visibility','memberIds'].includes(key))) throw httpError(400, '不支持的项目字段');
    if (body.visibility !== undefined && !['team','restricted'].includes(body.visibility)) throw httpError(400, '可见范围无效');
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId);
      const permissionsChanged = body.visibility !== undefined || body.memberIds !== undefined;
      const current = await requireTeamProject(db, teamId, user.id, projectId, permissionsChanged ? 'manage' : 'write');
      if (current.version !== body.version) throw httpError(409, '项目已被其他成员更新，请刷新后再保存');
      const row = (await db.query('UPDATE oaooao_team_projects SET title=$3,description=$4,visibility=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND team_id=$2 RETURNING *', [projectId, teamId, body.title === undefined ? current.title : string(body.title, '项目名称', 120), body.description === undefined ? current.description : string(body.description, '项目说明', 4000, true), body.visibility ?? current.visibility])).rows[0];
      if (body.memberIds !== undefined) await assignMembers(db, teamId, projectId, body.memberIds);
      await teamEvent(db, teamId, user.id, permissionsChanged ? 'project.permissions' : 'project.updated', { projectId });
      return { project: await teamProjectView(db, row) };
    });
  });
}
