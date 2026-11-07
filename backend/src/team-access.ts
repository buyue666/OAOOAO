import type { Pool, PoolClient } from 'pg';
import { httpError, redact, type Context } from './core.js';

export type TeamRole = 'owner' | 'admin' | 'creator' | 'reviewer';
export type TeamRow = Record<string, any>;
export type TeamDb = Pool | PoolClient;
export const teamManager = (role: string) => role === 'owner' || role === 'admin';
export const projectVisibilitySql = "(p.visibility='team' OR m.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM oaooao_team_project_members pm WHERE pm.project_id=p.id AND pm.user_id=m.user_id))";

export async function lockTeam(db: PoolClient, teamId: string) {
  const row = (await db.query('SELECT * FROM oaooao_teams WHERE id=$1 FOR UPDATE', [teamId])).rows[0];
  if (!row) throw httpError(404, '团队不存在或已不可用');
  return row;
}

export async function requireTeam(db: TeamDb, teamId: string, userId: string, permission: 'read' | 'manage' | 'owner' | 'write' = 'read') {
  const row = (await db.query('SELECT t.*,m.role,m.monthly_limit,m.can_download FROM oaooao_teams t JOIN oaooao_team_members m ON m.team_id=t.id WHERE t.id=$1 AND m.user_id=$2', [teamId, userId])).rows[0];
  if (!row) throw httpError(404, '团队不存在或你已没有访问权限');
  if (permission === 'owner' && row.role !== 'owner' || permission === 'manage' && !teamManager(row.role) || permission === 'write' && row.role === 'reviewer') throw httpError(403, '当前团队角色不能执行此操作');
  return row;
}

export async function requireTeamProject(db: TeamDb, teamId: string, userId: string, projectId: string, permission: 'read' | 'write' | 'manage' | 'download' = 'read') {
  const row = (await db.query(`SELECT p.*,m.role,m.can_download FROM oaooao_team_projects p JOIN oaooao_team_members m ON m.team_id=p.team_id AND m.user_id=$2 WHERE p.team_id=$1 AND p.id=$3 AND ${projectVisibilitySql}`, [teamId, userId, projectId])).rows[0];
  if (!row) throw httpError(404, '项目不存在或未向你授权');
  if (permission === 'write' && row.role === 'reviewer' || permission === 'manage' && !teamManager(row.role) || permission === 'download' && row.role === 'reviewer' && !row.can_download) throw httpError(403, permission === 'download' ? '尚未获得下载权限' : '当前角色不能编辑此项目');
  return row;
}

export async function teamSeatCounts(db: TeamDb, teamId: string) {
  const row = (await db.query(`SELECT
    (SELECT count(*) FROM oaooao_team_members WHERE team_id=$1 AND role<>'reviewer') seats,
    (SELECT count(*) FROM oaooao_team_members WHERE team_id=$1 AND role='reviewer') reviewers,
    (SELECT count(*) FROM oaooao_team_invitations WHERE team_id=$1 AND role<>'reviewer' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()) reserved,
    (SELECT count(*) FROM oaooao_team_invitations WHERE team_id=$1 AND role='reviewer' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()) reserved_reviewers`, [teamId])).rows[0];
  return { occupiedSeats: Number(row.seats), reviewers: Number(row.reviewers), reservedSeats: Number(row.reserved), reservedReviewers: Number(row.reserved_reviewers) };
}

export async function assertTeamSeats(db: TeamDb, team: TeamRow) {
  const counts = await teamSeatCounts(db, team.id);
  if (counts.occupiedSeats + counts.reservedSeats > team.seat_limit) throw httpError(409, '创作席位已满，请释放待接受邀请或增加席位');
  if (counts.reviewers + counts.reservedReviewers > team.reviewer_limit) throw httpError(409, '审阅成员名额已满');
}

export async function teamView(db: TeamDb, row: TeamRow) {
  const plan = row.plan_id ? (await db.query('SELECT name FROM oaooao_team_plans WHERE id=$1', [row.plan_id])).rows[0] : null;
  return { id: row.id, name: row.name, role: row.role, ownerId: row.owner_id, seatLimit: row.seat_limit, reviewerLimit: row.reviewer_limit,
    ...await teamSeatCounts(db, row.id), canDownload: row.role !== 'reviewer' || row.can_download,
    planName: plan?.name ?? null, subscriptionExpiresAt: row.subscription_expires_at?.toISOString() ?? null,
    transferTo: row.transfer_to ?? null, transferExpiresAt: row.transfer_expires_at?.toISOString() ?? null };
}

export async function teamEvent(db: TeamDb, teamId: string, actorId: string, action: string, details: Record<string, unknown> = {}) {
  await db.query('INSERT INTO oaooao_team_events(team_id,actor_id,action,details) VALUES($1,$2,$3,$4)', [teamId, actorId, action, redact(details)]);
}

export async function teamStorageUsage(ctx: Context, teamId: string, db: TeamDb = ctx.db) {
  const row = (await db.query('SELECT t.storage_quota_bytes,coalesce(sum(a.byte_count),0) used,count(a.id) assets FROM oaooao_teams t LEFT JOIN oaooao_team_assets a ON a.team_id=t.id WHERE t.id=$1 GROUP BY t.id', [teamId])).rows[0];
  if (!row) throw httpError(404, '团队不存在');
  return { usedBytes: Number(row.used), quotaBytes: Number(row.storage_quota_bytes), assets: Number(row.assets) };
}

export async function assertTeamStorage(ctx: Context, teamId: string, bytes: number, db: TeamDb = ctx.db) {
  const usage = await teamStorageUsage(ctx, teamId, db);
  if (usage.usedBytes + bytes > usage.quotaBytes) throw httpError(413, '团队存储容量不足，请先清理素材或联系管理员扩容');
  return usage;
}
