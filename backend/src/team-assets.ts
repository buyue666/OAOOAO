import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { httpError, object, pagination, string, transaction, type Context } from './core.js';
import { decodeDataUrl, mediaPath, ownedMedia, sniffMedia, MAX_MEDIA_BYTES, MAX_VIDEO_BYTES } from './media.js';
import { storageConfig, assertStorageConfigured, objectLocation, putObject, getObject, deleteObject, type ObjectLocation } from './object-storage.js';
import { assertTeamStorage, lockTeam, projectVisibilitySql, requireTeam, requireTeamProject, teamEvent, type TeamRow } from './team-access.js';

export type TeamWorkspace = { teamId: string; projectId: string };
export const teamAssetUrl = (teamId: string, id: string) => `/api/teams/${teamId}/assets/${id}/content`;
export function teamAssetView(row: TeamRow) {
  return { id: row.id, projectId: row.project_id, title: row.title, kind: row.kind, bytes: Number(row.byte_count), url: teamAssetUrl(row.team_id, row.id), createdBy: row.created_by, creatorName: row.display_name || row.username || '', createdAt: row.created_at.toISOString() };
}

export async function saveTeamAsset(ctx: Context, workspace: TeamWorkspace, actorId: string, input: { title: string; bytes?: Buffer; text?: string; sourceAssetId?: string }, trustedJob = false) {
  const bytes = input.bytes, mime = bytes ? sniffMedia(bytes) : 'text/plain', size = bytes?.length ?? Buffer.byteLength(input.text ?? '');
  const limit = mime.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_MEDIA_BYTES;
  if (!size || size > limit || !bytes && size > 1024 * 1024) throw httpError(413, '素材为空或超过大小限制');
  const id = randomUUID(), title = string(input.title, '素材名称', 200), { teamId, projectId } = workspace;
  const prepared = await transaction(ctx.db, async db => {
    await lockTeam(db, teamId);
    if (!trustedJob) await requireTeamProject(db, teamId, actorId, projectId, 'write');
    await assertTeamStorage(ctx, teamId, size, db);
    const storage = await storageConfig(ctx, db), backend = bytes ? storage.enabled ? 's3' : 'local' : 'text';
    if (backend === 's3') assertStorageConfigured(storage);
    const location = backend === 's3' ? objectLocation(storage, `team-${teamId}`, id) : {};
    await db.query('INSERT INTO oaooao_team_assets(id,team_id,project_id,created_by,title,kind,text_content,mime_type,byte_count,sha256,storage_backend,storage_location,source_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [id, teamId, projectId, actorId, title, mime.split('/')[0], input.text ?? null, mime, size, bytes ? createHash('sha256').update(bytes).digest('hex') : null, backend, location, input.sourceAssetId ?? null]);
    return { storage, backend, location };
  });
  try {
    if (bytes && prepared.backend === 's3') await putObject(ctx, prepared.storage, prepared.location as ObjectLocation, bytes, mime);
    if (bytes && prepared.backend === 'local') { await mkdir(ctx.config.mediaRoot, { recursive: true }); const file = mediaPath(ctx.config.mediaRoot, id); await writeFile(file + '.tmp', bytes, { flag: 'wx' }); await rename(file + '.tmp', file) }
    const row = await transaction(ctx.db, async db => {
      await lockTeam(db, teamId);
      const result = (await db.query("UPDATE oaooao_team_assets SET status='ready' WHERE id=$1 AND status='pending' RETURNING *", [id])).rows[0];
      if (!result) throw httpError(409, '素材保存状态已变化，请刷新后核对');
      await teamEvent(db, teamId, actorId, input.sourceAssetId ? 'asset.copied' : 'asset.created', { assetId: id, projectId }); return result;
    });
    return teamAssetView(row);
  } catch (error) { await ctx.db.query("UPDATE oaooao_team_assets SET status='deleting' WHERE id=$1", [id]); throw error }
}

export async function readTeamAsset(ctx: Context, workspace: TeamWorkspace, id: string) {
  const row = (await ctx.db.query("SELECT * FROM oaooao_team_assets WHERE id=$1 AND team_id=$2 AND project_id=$3 AND status='ready'", [id, workspace.teamId, workspace.projectId])).rows[0];
  if (!row) throw httpError(404, '参考素材不属于当前团队项目，或已被删除');
  const bytes = row.storage_backend === 'text' ? Buffer.from(row.text_content ?? '') : row.storage_backend === 's3' ? await getObject(ctx, row.storage_location) : await readFile(mediaPath(ctx.config.mediaRoot, id));
  if (bytes.length !== Number(row.byte_count) || row.sha256 && createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw httpError(422, '团队素材文件校验失败');
  return { bytes, mimeType: row.mime_type as string, row };
}

export async function cleanupTeamAssets(ctx: Context) {
  const rows = (await ctx.db.query("SELECT id FROM oaooao_team_assets WHERE status='deleting' OR status='pending' AND created_at<clock_timestamp()-interval '1 hour' ORDER BY created_at LIMIT 50")).rows;
  for (const item of rows) {
    try {
      await transaction(ctx.db, async db => {
        const row = (await db.query("SELECT * FROM oaooao_team_assets WHERE id=$1 AND (status='deleting' OR status='pending' AND created_at<clock_timestamp()-interval '1 hour') FOR UPDATE", [item.id])).rows[0];
        if (!row) return;
        if (row.storage_backend === 's3') await deleteObject(ctx, row.storage_location);
        else if (row.storage_backend === 'local') { await rm(mediaPath(ctx.config.mediaRoot, row.id), { force: true }); await rm(mediaPath(ctx.config.mediaRoot, row.id) + '.tmp', { force: true }) }
        await db.query('DELETE FROM oaooao_team_assets WHERE id=$1', [row.id]);
      });
    } catch { /* Failed storage deletions retain their quota reservation for the next pass. */ }
  }
}

export async function registerTeamAssets(app: FastifyInstance, ctx: Context) {
  app.get('/api/teams/:teamId/assets', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string }, query = (request.query ?? {}) as Record<string, string>, page = pagination(query);
    await requireTeam(ctx.db, teamId, user.id);
    if (query.projectId) await requireTeamProject(ctx.db, teamId, user.id, query.projectId);
    const rows = (await ctx.db.query(`SELECT a.*,u.display_name,u.username,count(*) OVER() total FROM oaooao_team_assets a JOIN oaooao_team_projects p ON p.id=a.project_id JOIN oaooao_team_members m ON m.team_id=p.team_id AND m.user_id=$2 JOIN oaooao_users u ON u.id=a.created_by WHERE a.team_id=$1 AND a.status='ready' AND ($3='' OR a.project_id=$3) AND ${projectVisibilitySql} ORDER BY a.created_at DESC,a.id LIMIT $4 OFFSET $5`, [teamId, user.id, query.projectId || '', page.pageSize, page.offset])).rows;
    return { assets: rows.map(teamAssetView), total: Number(rows[0]?.total ?? 0) };
  });
  app.post('/api/teams/:teamId/projects/:projectId/assets', { bodyLimit: 34 * 1024 * 1024 }, async request => {
    const user = await ctx.requireUser(request), workspace = request.params as TeamWorkspace;
    await requireTeamProject(ctx.db, workspace.teamId, user.id, workspace.projectId, 'write');
    if (request.isMultipart()) {
      let bytes: Buffer | undefined, title = '团队素材';
      for await (const part of request.parts({ limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 2 } })) { if (part.type === 'file') { bytes = await part.toBuffer(); title = part.filename.slice(0, 200) || title } }
      if (!bytes) throw httpError(400, '请选择要上传的文件');
      return { asset: await saveTeamAsset(ctx, workspace, user.id, { title, bytes }) };
    }
    const body = object(request.body), title = string(body.title, '素材名称', 200);
    return { asset: await saveTeamAsset(ctx, workspace, user.id, body.dataUrl ? { title, bytes: decodeDataUrl(string(body.dataUrl, '素材', 34 * 1024 * 1024)) } : { title, text: string(body.text, '文本素材', 1000000) }) };
  });
  app.post('/api/teams/:teamId/projects/:projectId/assets/copy', async request => {
    const user = await ctx.requireUser(request), workspace = request.params as TeamWorkspace, id = string(object(request.body).assetId, '个人素材标识', 200);
    await requireTeamProject(ctx.db, workspace.teamId, user.id, workspace.projectId, 'write');
    const row = (await ctx.db.query('SELECT * FROM oaooao_library_assets WHERE id=$1 AND user_id=$2', [id, user.id])).rows[0];
    if (!row) throw httpError(404, '只能复制你自己的个人素材');
    const document = row.document, title = String(document.title || '复制的个人素材').slice(0, 200);
    if (row.kind === 'text') { const text = document.data?.text || document.data?.content || document.note; if (typeof text !== 'string') throw httpError(422, '个人文本素材缺少正文'); return { asset: await saveTeamAsset(ctx, workspace, user.id, { title, text, sourceAssetId: id }) } }
    const url = new URL(String(document.data?.serverUrl || document.data?.url || ''), ctx.config.origin);
    const mediaId = /^\/api\/(?:media|reference-assets|generation-log-assets)\/([a-f0-9-]{36})$/i.exec(url.pathname)?.[1];
    if (url.origin !== new URL(ctx.config.origin).origin || !mediaId) throw httpError(409, '请先将此上游结果保存到个人素材存储，再复制到团队');
    const media = await ownedMedia(ctx, user.id, mediaId);
    return { asset: await saveTeamAsset(ctx, workspace, user.id, { title, bytes: media.bytes, sourceAssetId: id }) };
  });
  app.get('/api/teams/:teamId/assets/:id/content', async (request, reply) => {
    const user = await ctx.requireUser(request), { teamId, id } = request.params as { teamId: string; id: string }, download = (request.query as Record<string, string>)?.download === '1';
    const row = (await ctx.db.query("SELECT project_id,title FROM oaooao_team_assets WHERE id=$1 AND team_id=$2 AND status='ready'", [id, teamId])).rows[0];
    if (!row) throw httpError(404, '素材不存在');
    await requireTeamProject(ctx.db, teamId, user.id, row.project_id, download ? 'download' : 'read');
    const media = await readTeamAsset(ctx, { teamId, projectId: row.project_id }, id);
    reply.header('Cache-Control', 'private, no-store').header('Content-Type', media.mimeType).header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.title).replaceAll("'", '%27')}`);
    return reply.send(media.bytes);
  });
  app.delete('/api/teams/:teamId/assets/:id', async request => {
    const user = await ctx.requireUser(request), { teamId, id } = request.params as { teamId: string; id: string };
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId);
      const row = (await db.query("SELECT * FROM oaooao_team_assets WHERE id=$1 AND team_id=$2 AND status='ready' FOR UPDATE", [id, teamId])).rows[0];
      if (!row) throw httpError(404, '素材不存在');
      const project = await requireTeamProject(db, teamId, user.id, row.project_id, 'write');
      if (!['owner','admin'].includes(project.role) && row.created_by !== user.id) throw httpError(403, '只有管理员或创建者可以删除此素材');
      const reference = await db.query("SELECT id FROM oaooao_team_projects WHERE team_id=$1 AND document::text LIKE '%'||$2||'%' UNION ALL SELECT id FROM oaooao_generation_jobs WHERE team_id=$1 AND status IN ('pending','running','paused') AND input::text LIKE '%'||$2||'%' LIMIT 1", [teamId, id]);
      if (reference.rowCount) throw httpError(409, '素材正在被项目或未完成任务引用，暂不能删除');
      await db.query("UPDATE oaooao_team_assets SET status='deleting' WHERE id=$1", [id]);
      await teamEvent(db, teamId, user.id, 'asset.deleted', { assetId: id, projectId: row.project_id }); return { ok: true };
    });
  });
}
