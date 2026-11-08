import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, string, transaction, type Context } from './core.js';
import { lockTeam, requireTeam, requireTeamProject, type TeamRow } from './team-access.js';

function canvasView(project: TeamRow) {
  return { ...project.document, id: project.id, title: project.title, version: project.version, nodes: project.document?.nodes ?? [], connections: project.document?.connections ?? [], createdAt: project.created_at.toISOString(), updatedAt: project.updated_at.toISOString() };
}

/** Every persisted media/task reference must remain inside this project. */
async function validateDocument(ctx: Context, db: PoolClient, teamId: string, projectId: string, doc: Record<string, any>) {
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.connections) || doc.nodes.length > 2000 || doc.connections.length > 6000) throw httpError(400, '画布节点或连线格式无效');
  const ids = new Set<string>(), assets = new Set<string>(), tasks = new Set<string>();
  const checkUrl = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw) return;
    let url: URL; try { url = new URL(raw, ctx.config.origin) } catch { throw httpError(400, '画布素材地址无效') }
    const match = /^\/api\/teams\/([^/]+)\/assets\/([a-f0-9-]{36})\/content$/i.exec(url.pathname);
    if (url.origin !== new URL(ctx.config.origin).origin || !match || match[1] !== teamId || url.search || url.hash) throw httpError(403, '请先将素材上传或复制到当前团队项目');
    assets.add(match[2]);
  };
  const visit = (value: unknown, depth = 0) => {
    if (depth > 30) throw httpError(400, '画布数据嵌套过深');
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return }
    for (const [key, child] of Object.entries(value)) {
      if (['url','poster','imageUrl','dataUrl','referenceImageDataUrl','src','remoteUrl','posterUrl','coverUrl'].includes(key)) checkUrl(child);
      else if (key === 'referenceUrls' && Array.isArray(child)) child.forEach(checkUrl);
      else visit(child, depth + 1);
    }
  };
  for (const node of doc.nodes) {
    if (!node || typeof node.id !== 'string' || node.id.length > 200 || ids.has(node.id) || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) throw httpError(400, '画布节点无效');
    ids.add(node.id);
    if (node.data?.task?.id) tasks.add(string(node.data.task.id, '任务标识', 200));
    if (node.type === 'agent' || node.data?.kind === 'agent') throw httpError(400, '团队画布暂不支持个人 Agent 节点');
    visit(node.data);
    visit(node.metadata);
  }
  for (const edge of doc.connections) if (!edge || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) throw httpError(400, '画布连线无效');
  if (assets.size) {
    const found = await db.query("SELECT id FROM oaooao_team_assets WHERE team_id=$1 AND project_id=$2 AND id=ANY($3::text[]) AND status='ready' FOR SHARE", [teamId, projectId, [...assets]]);
    if (found.rowCount !== assets.size) throw httpError(403, '画布中包含当前项目以外或已删除的素材');
  }
  if (tasks.size) {
    const found = await db.query('SELECT id FROM oaooao_generation_jobs WHERE team_id=$1 AND team_project_id=$2 AND id::text=ANY($3::text[])', [teamId, projectId, [...tasks]]);
    if (found.rowCount !== tasks.size) throw httpError(403, '画布中包含其他项目的生成任务');
  }
}

export async function registerTeamCanvas(app: FastifyInstance, ctx: Context) {
  const path = '/api/teams/:teamId/projects/:projectId/canvas';
  app.get(path, async request => {
    const user = await ctx.requireUser(request), { teamId, projectId } = request.params as { teamId: string; projectId: string };
    const project = await requireTeamProject(ctx.db, teamId, user.id, projectId), team = await requireTeam(ctx.db, teamId, user.id);
    return { data: { project: canvasView(project), workspace: { teamId, projectId, teamName: team.name, readOnly: project.role === 'reviewer', canDownload: project.role !== 'reviewer' || project.can_download, modelIds: team.model_ids ?? [] } } };
  });
  app.patch(path, { bodyLimit: 3 * 1024 * 1024 }, async request => {
    const user = await ctx.requireUser(request), { teamId, projectId } = request.params as { teamId: string; projectId: string }, body = object(request.body), raw = object(body.project);
    if (typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) throw httpError(428, '请携带当前画布版本后保存');
    if (!Number.isSafeInteger(body.expectedVersion)) throw httpError(428, '请携带当前项目版本后保存');
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId);
      const current = await requireTeamProject(db, teamId, user.id, projectId, 'write');
      if (current.version !== body.expectedVersion || current.updated_at.toISOString() !== new Date(body.expectedUpdatedAt).toISOString()) throw httpError(409, '项目已被其他成员更新，请刷新后再保存');
      const doc = { nodes: raw.nodes, connections: raw.connections, ...(raw.viewport ? { viewport: raw.viewport } : {}) };
      await validateDocument(ctx, db, teamId, projectId, doc);
      const title = string(raw.title, '项目名称', 120);
      const row = (await db.query("UPDATE oaooao_team_projects SET title=$3,document=$4,version=version+1,updated_at=greatest(updated_at+interval '1 millisecond',date_trunc('milliseconds',clock_timestamp())) WHERE id=$1 AND team_id=$2 RETURNING *", [projectId, teamId, title, doc])).rows[0];
      return { data: { ack: { updatedAt: row.updated_at.toISOString(), version: row.version } } };
    });
  });
}
