import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hashToken, httpError, object, pagination, rateLimit, string, transaction, type Context } from './core.js';
import { creditUnits } from './wallet.js';
import { assertTeamSeats, lockTeam, requireTeam, teamEvent, teamManager, teamStorageUsage, teamView } from './team-access.js';
import { teamBudget, teamWalletBalance } from './team-wallet.js';

function inviteRole(value: unknown) {
  if (!['admin','creator','reviewer'].includes(String(value))) throw httpError(400, '成员角色无效');
  return String(value);
}

export async function registerTeams(app: FastifyInstance, ctx: Context) {
  app.get('/api/teams', async request => {
    const user = await ctx.requireUser(request);
    const rows = (await ctx.db.query('SELECT t.*,m.role,m.can_download FROM oaooao_teams t JOIN oaooao_team_members m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY t.created_at DESC LIMIT 100', [user.id])).rows;
    return { teams: await Promise.all(rows.map(row => teamView(ctx.db, row))) };
  });
  app.post('/api/teams', async request => {
    const user = await ctx.requireUser(request), body = object(request.body), name = string(body.name, '团队名称', 80);
    await rateLimit(ctx, `team-create:${user.id}`, 5, 3600);
    return transaction(ctx.db, async db => {
      await db.query('SELECT id FROM oaooao_users WHERE id=$1 FOR NO KEY UPDATE', [user.id]);
      if (Number((await db.query('SELECT count(*) n FROM oaooao_teams WHERE owner_id=$1', [user.id])).rows[0].n) >= 20) throw httpError(409, '每个账号最多创建 20 个团队');
      const id = randomUUID();
      const row = (await db.query('INSERT INTO oaooao_teams(id,name,owner_id) VALUES($1,$2,$3) RETURNING *', [id, name, user.id])).rows[0];
      await db.query("INSERT INTO oaooao_team_members(team_id,user_id,role,can_download) VALUES($1,$2,'owner',true)", [id, user.id]);
      await teamEvent(db, id, user.id, 'team.created', { name });
      return { team: await teamView(db, { ...row, role: 'owner', can_download: true }) };
    });
  });
  app.get('/api/teams/:teamId', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string };
    return { team: await teamView(ctx.db, await requireTeam(ctx.db, teamId, user.id)) };
  });
  app.patch('/api/teams/:teamId', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string }, body = object(request.body);
    const name = string(body.name, '团队名称', 80);
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); await requireTeam(db, teamId, user.id, 'owner');
      await db.query('UPDATE oaooao_teams SET name=$2,updated_at=now() WHERE id=$1', [teamId, name]);
      await teamEvent(db, teamId, user.id, 'team.renamed', { name }); return { ok: true };
    });
  });
  app.get('/api/teams/:teamId/members', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string };
    const team = await requireTeam(ctx.db, teamId, user.id);
    const rows = (await ctx.db.query(`SELECT m.*,u.display_name,u.username,coalesce((SELECT sum(o.budget_delta) FROM oaooao_team_credit_operations o WHERE o.team_id=m.team_id AND o.actor_id=m.user_id AND o.budget_month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date),0) spent FROM oaooao_team_members m JOIN oaooao_users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'creator' THEN 2 ELSE 3 END,m.joined_at`, [teamId])).rows;
    return { members: rows.map(row => ({ userId: row.user_id, name: row.display_name || row.username, username: row.username, role: row.role, monthlyLimit: teamManager(team.role) || row.user_id === user.id ? row.monthly_limit === null ? null : Number(row.monthly_limit) : null, spent: teamManager(team.role) || row.user_id === user.id ? Number(row.spent) : 0, canDownload: row.can_download, joinedAt: row.joined_at.toISOString() })) };
  });
  app.patch('/api/teams/:teamId/members/:userId', async request => {
    const actor = await ctx.requireUser(request), { teamId, userId } = request.params as { teamId: string; userId: string }, body = object(request.body);
    if (Object.keys(body).some(key => !['role','monthlyLimit','canDownload'].includes(key))) throw httpError(400, '不支持的成员设置');
    if (body.monthlyLimit !== undefined && body.monthlyLimit !== null && creditUnits(body.monthlyLimit) < 0n) throw httpError(400, '成员月预算不能为负数');
    if (body.canDownload !== undefined && typeof body.canDownload !== 'boolean') throw httpError(400, '下载权限无效');
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); const team = await requireTeam(db, teamId, actor.id, 'manage');
      const target = (await db.query('SELECT * FROM oaooao_team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId])).rows[0];
      if (!target) throw httpError(404, '成员不存在');
      if (target.role === 'owner' || actor.id === userId || team.role === 'admin' && target.role === 'admin') throw httpError(403, '不能调整所有者、自己的权限或其他管理员');
      const role = body.role === undefined ? target.role : inviteRole(body.role);
      if (team.role === 'admin' && role === 'admin') throw httpError(403, '只有所有者可以授予管理员角色');
      await db.query('UPDATE oaooao_team_members SET role=$3,monthly_limit=$4,can_download=$5 WHERE team_id=$1 AND user_id=$2', [teamId, userId, role, body.monthlyLimit === undefined ? target.monthly_limit : body.monthlyLimit, body.canDownload ?? target.can_download]);
      await assertTeamSeats(db, team);
      await teamEvent(db, teamId, actor.id, 'member.updated', { userId, role, monthlyLimit: body.monthlyLimit, canDownload: body.canDownload });
      return { ok: true };
    });
  });
  app.delete('/api/teams/:teamId/members/:userId', async request => {
    const actor = await ctx.requireUser(request), { teamId, userId } = request.params as { teamId: string; userId: string };
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); const team = await requireTeam(db, teamId, actor.id);
      const target = (await db.query('SELECT role FROM oaooao_team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId])).rows[0];
      if (!target) throw httpError(404, '成员不存在');
      if (target.role === 'owner') throw httpError(409, '所有者必须先完成所有权交接才能退出');
      if (actor.id !== userId && (!teamManager(team.role) || team.role === 'admin' && target.role === 'admin')) throw httpError(403, '当前角色不能移除此成员');
      await db.query('DELETE FROM oaooao_team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId]);
      await db.query('UPDATE oaooao_teams SET transfer_to=null,transfer_expires_at=null WHERE id=$1 AND transfer_to=$2', [teamId, userId]);
      await teamEvent(db, teamId, actor.id, actor.id === userId ? 'member.left' : 'member.removed', { userId });
      return { ok: true };
    });
  });
  app.get('/api/teams/:teamId/invitations', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string };
    await requireTeam(ctx.db, teamId, user.id, 'manage');
    const rows = (await ctx.db.query('SELECT i.id,i.role,i.email,i.expires_at,i.created_at,u.username FROM oaooao_team_invitations i LEFT JOIN oaooao_users u ON u.id=i.target_user_id WHERE i.team_id=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp() ORDER BY i.created_at DESC LIMIT 600', [teamId])).rows;
    return { invitations: rows.map(row => ({ id: row.id, role: row.role, target: row.email || row.username || null, expiresAt: row.expires_at.toISOString(), createdAt: row.created_at.toISOString() })) };
  });
  app.post('/api/teams/:teamId/invitations', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string }, body = object(request.body);
    const role = inviteRole(body.role ?? 'creator'), target = string(body.target ?? '', '邀请对象', 320, true);
    await rateLimit(ctx, `team-invite:${user.id}`, 30, 3600);
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); const team = await requireTeam(db, teamId, user.id, 'manage');
      if (role === 'admin' && team.role !== 'owner') throw httpError(403, '只有所有者可以邀请管理员');
      let email: string | null = null, targetId: string | null = null;
      if (target.includes('@')) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw httpError(400, '邮箱格式无效'); email = target.toLowerCase() }
      else if (target) { targetId = (await db.query('SELECT id FROM oaooao_users WHERE lower(username)=lower($1) AND enabled', [target])).rows[0]?.id ?? null; if (!targetId) throw httpError(404, '用户名不存在，未注册成员请使用邮箱邀请') }
      if (targetId || email) {
        const already = await db.query('SELECT m.user_id FROM oaooao_team_members m JOIN oaooao_users u ON u.id=m.user_id WHERE m.team_id=$1 AND (m.user_id=$2 OR lower(u.email)=$3)', [teamId, targetId, email]);
        if (already.rowCount) throw httpError(409, '此用户已经是团队成员');
        const pending = await db.query('SELECT id FROM oaooao_team_invitations WHERE team_id=$1 AND (target_user_id=$2 OR email=$3) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()', [teamId, targetId, email]);
        if (pending.rowCount) throw httpError(409, '此成员已有待接受邀请，请先撤销旧邀请');
      }
      const token = randomBytes(32).toString('base64url'), id = randomUUID();
      const invitation = (await db.query("INSERT INTO oaooao_team_invitations(id,team_id,token_hash,role,email,target_user_id,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '7 days') RETURNING expires_at", [id, teamId, hashToken(token), role, email, targetId, user.id])).rows[0];
      await assertTeamSeats(db, team);
      await teamEvent(db, teamId, user.id, 'invitation.created', { invitationId: id, role, targeted: !!target });
      return { invitation: { id, expiresAt: invitation.expires_at.toISOString() }, invitePath: `/teams/join?token=${token}` };
    });
  });
  app.delete('/api/teams/:teamId/invitations/:id', async request => {
    const user = await ctx.requireUser(request), { teamId, id } = request.params as { teamId: string; id: string };
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); const actor = await requireTeam(db, teamId, user.id, 'manage');
      const found = (await db.query('SELECT role FROM oaooao_team_invitations WHERE id=$1 AND team_id=$2', [id, teamId])).rows[0];
      if (!found) throw httpError(404, '邀请不存在');
      if (actor.role !== 'owner' && found.role === 'admin') throw httpError(403, '只有所有者可以撤销管理员邀请');
      await db.query('UPDATE oaooao_team_invitations SET revoked_at=clock_timestamp() WHERE id=$1 AND team_id=$2 AND accepted_at IS NULL', [id, teamId]);
      await teamEvent(db, teamId, user.id, 'invitation.revoked', { invitationId: id }); return { ok: true };
    });
  });
  app.post('/api/team-invitations/inspect', async request => {
    const user = await ctx.requireUser(request), token = string(object(request.body).token, '邀请码', 43);
    await rateLimit(ctx, `team-invite-lookup:${user.id}`, 60, 3600);
    const row = (await ctx.db.query('SELECT i.*,t.name FROM oaooao_team_invitations i JOIN oaooao_teams t ON t.id=i.team_id WHERE token_hash=$1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>clock_timestamp()', [hashToken(token)])).rows[0];
    if (!row) throw httpError(404, '邀请已失效、已被接受或已撤销');
    return { teamName: row.name, role: row.role, expiresAt: row.expires_at.toISOString(), emailRequired: !!row.email, identityMatches: (!row.target_user_id || row.target_user_id === user.id) && (!row.email || user.emailVerified && user.email?.toLowerCase() === row.email) };
  });
  app.post('/api/team-invitations/accept', async request => {
    const user = await ctx.requireUser(request), token = string(object(request.body).token, '邀请码', 43);
    await rateLimit(ctx, `team-invite-accept:${user.id}`, 30, 3600);
    return transaction(ctx.db, async db => {
      const lookup = (await db.query('SELECT team_id FROM oaooao_team_invitations WHERE token_hash=$1', [hashToken(token)])).rows[0];
      if (!lookup) throw httpError(404, '邀请不存在或已失效');
      const team = await lockTeam(db, lookup.team_id);
      const row = (await db.query('SELECT *,expires_at>clock_timestamp() valid FROM oaooao_team_invitations WHERE token_hash=$1 FOR UPDATE', [hashToken(token)])).rows[0];
      if (row.accepted_by === user.id && (await db.query('SELECT 1 FROM oaooao_team_members WHERE team_id=$1 AND user_id=$2', [team.id, user.id])).rowCount) return { teamId: team.id };
      if (!row.valid || row.revoked_at || row.accepted_at) throw httpError(409, '邀请已失效、被撤销或已使用');
      if (row.target_user_id && row.target_user_id !== user.id || row.email && (!user.emailVerified || user.email?.toLowerCase() !== row.email)) throw httpError(403, '请使用受邀请账号，或验证受邀请邮箱后再加入');
      if ((await db.query('SELECT 1 FROM oaooao_team_members WHERE team_id=$1 AND user_id=$2', [team.id, user.id])).rowCount) throw httpError(409, '你已经是团队成员');
      await db.query('UPDATE oaooao_team_invitations SET accepted_at=clock_timestamp(),accepted_by=$2 WHERE id=$1', [row.id, user.id]);
      await db.query('INSERT INTO oaooao_team_members(team_id,user_id,role,can_download) VALUES($1,$2,$3,$4)', [team.id, user.id, row.role, row.role !== 'reviewer']);
      await assertTeamSeats(db, team);
      await teamEvent(db, team.id, user.id, 'member.joined', { role: row.role }); return { teamId: team.id };
    });
  });
  app.post('/api/teams/:teamId/ownership', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string }, targetId = string(object(request.body).userId, '新所有者', 200);
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); await requireTeam(db, teamId, user.id, 'owner');
      const target = await requireTeam(db, teamId, targetId, 'write');
      if (targetId === user.id) throw httpError(400, '请选择另一位创作成员或管理员');
      if (target.role === 'owner') throw httpError(409, '成员角色已发生变化');
      await db.query("UPDATE oaooao_teams SET transfer_to=$2,transfer_expires_at=clock_timestamp()+interval '24 hours' WHERE id=$1", [teamId, targetId]);
      await teamEvent(db, teamId, user.id, 'ownership.requested', { userId: targetId }); return { ok: true };
    });
  });
  app.post('/api/teams/:teamId/ownership/accept', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string };
    return transaction(ctx.db, async db => {
      const team = await lockTeam(db, teamId); await requireTeam(db, teamId, user.id, 'write');
      const now = (await db.query('SELECT clock_timestamp() at')).rows[0].at;
      if (team.transfer_to !== user.id || !team.transfer_expires_at || team.transfer_expires_at <= now) throw httpError(409, '所有权交接申请已失效');
      await db.query("UPDATE oaooao_team_members SET role='admin' WHERE team_id=$1 AND role='owner'", [teamId]);
      await db.query("UPDATE oaooao_team_members SET role='owner',can_download=true WHERE team_id=$1 AND user_id=$2", [teamId, user.id]);
      await db.query('UPDATE oaooao_teams SET owner_id=$2,transfer_to=null,transfer_expires_at=null,updated_at=now() WHERE id=$1', [teamId, user.id]);
      await teamEvent(db, teamId, user.id, 'ownership.accepted', { previousOwnerId: team.owner_id }); return { ok: true };
    });
  });
  app.get('/api/teams/:teamId/usage', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string };
    return transaction(ctx.db, async db => {
      await lockTeam(db, teamId); const team = await requireTeam(db, teamId, user.id), manager = teamManager(team.role);
      const budget = await teamBudget(db, teamId, user.id);
      const batches = (await db.query('SELECT id,source,remaining_amount,expires_at FROM oaooao_team_credit_batches WHERE team_id=$1 AND remaining_amount>0 AND (expires_at IS NULL OR expires_at>clock_timestamp()) ORDER BY expires_at NULLS LAST,id LIMIT 100', [teamId])).rows;
      const operations = (await db.query('SELECT o.*,u.display_name,u.username FROM oaooao_team_credit_operations o JOIN oaooao_users u ON u.id=o.actor_id WHERE o.team_id=$1 AND ($2 OR o.actor_id=$3) ORDER BY o.created_at DESC,o.id LIMIT 100', [teamId, manager, user.id])).rows;
      return { balance: await teamWalletBalance(db, teamId), monthlySpent: manager ? Number(budget.total) : Number(budget.spent), mySpent: Number(budget.spent), myLimit: team.monthly_limit === null ? null : Number(team.monthly_limit), month: budget.month, storage: await teamStorageUsage(ctx, teamId, db), batches: batches.map(row => ({ id: row.id, source: row.source, remaining: Number(row.remaining_amount), expiresAt: row.expires_at?.toISOString() ?? null })), operations: operations.map(row => ({ id: row.id, kind: row.kind, amount: Number(row.amount), actorName: row.display_name || row.username, reason: row.reason, createdAt: row.created_at.toISOString() })) };
    });
  });
  app.get('/api/teams/:teamId/events', async request => {
    const user = await ctx.requireUser(request), { teamId } = request.params as { teamId: string }, page = pagination(request.query);
    await requireTeam(ctx.db, teamId, user.id, 'manage');
    const rows = (await ctx.db.query('SELECT e.*,u.display_name,u.username FROM oaooao_team_events e JOIN oaooao_users u ON u.id=e.actor_id WHERE e.team_id=$1 ORDER BY e.id DESC LIMIT $2 OFFSET $3', [teamId, page.pageSize, page.offset])).rows;
    return { events: rows.map(row => ({ id: String(row.id), action: row.action, actorName: row.display_name || row.username, details: row.details, createdAt: row.created_at.toISOString() })), hasMore: rows.length === page.pageSize };
  });
}
