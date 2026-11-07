import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { httpError, type Context } from './core.js';
import { creditDecimal, creditUnits, type CreditAmount } from './wallet.js';
import { lockTeam, requireTeam, teamEvent, type TeamDb, type TeamRow } from './team-access.js';

export async function teamWalletBalance(db: TeamDb, teamId: string) {
  return Number((await db.query('SELECT coalesce(sum(remaining_amount),0)::text balance FROM oaooao_team_credit_batches WHERE team_id=$1 AND (expires_at IS NULL OR expires_at>clock_timestamp())', [teamId])).rows[0].balance);
}

export async function teamBudget(db: TeamDb, teamId: string, userId: string) {
  const row = (await db.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') month,
    coalesce(sum(budget_delta) FILTER(WHERE actor_id=$2),0)::text spent,
    coalesce(sum(budget_delta),0)::text total
    FROM oaooao_team_credit_operations WHERE team_id=$1 AND budget_month=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date`, [teamId, userId])).rows[0];
  return { month: row.month, spent: row.spent as string, total: row.total as string };
}

export async function grantTeamCredits(ctx: Context, db: PoolClient, teamId: string, actorId: string, key: string, amount: CreditAmount, expiresAt: Date | null, reason: string, source = 'adjustment') {
  const units = creditUnits(amount);
  if (units <= 0n || !reason.trim() || !/^[\w:-]{8,160}$/.test(key) || !['subscription','topup','adjustment'].includes(source)) throw httpError(400, '积分数量、来源、说明或幂等标识无效');
  await lockTeam(db, teamId);
  const now = (await db.query('SELECT clock_timestamp() at')).rows[0].at as Date;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)) throw httpError(400, '积分有效期必须晚于当前时间');
  const grantKey = `team:${teamId}:${key}`;
  const previous = (await db.query('SELECT * FROM oaooao_team_credit_batches WHERE grant_key=$1', [grantKey])).rows[0];
  if (previous) {
    if (creditUnits(previous.original_amount) !== units || previous.source !== source || (previous.expires_at?.getTime() ?? null) !== (expiresAt?.getTime() ?? null)) throw httpError(409, '此幂等标识已经用于另一笔积分发放');
    return;
  }
  const current = (await db.query('SELECT coalesce(sum(remaining_amount),0)::text amount FROM oaooao_team_credit_batches WHERE team_id=$1', [teamId])).rows[0].amount;
  creditDecimal(creditUnits(current) + units);
  const id = randomUUID();
  await db.query('INSERT INTO oaooao_team_credit_batches(id,team_id,source,grant_key,original_amount,remaining_amount,expires_at) VALUES($1,$2,$3,$4,$5,$5,$6)', [id, teamId, source, grantKey, creditDecimal(units), expiresAt]);
  await db.query("INSERT INTO oaooao_team_credit_operations(id,team_id,actor_id,kind,amount,reason) VALUES($1,$2,$3,'grant',$4,$5)", [grantKey, teamId, actorId, creditDecimal(units), reason]);
  await db.query('INSERT INTO oaooao_team_credit_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)', [grantKey, id, creditDecimal(units)]);
  await teamEvent(db, teamId, actorId, 'credits.grant', { amount: creditDecimal(units), source, expiresAt: expiresAt?.toISOString() ?? null, reason });
  await ctx.audit({ actorId, action: 'team.credits.grant', targetType: 'team', targetId: teamId, metadata: { amount: creditDecimal(units), reason } }, db);
}

export async function debitTeamCredits(db: PoolClient, teamId: string, actorId: string, jobId: string, amount: CreditAmount) {
  const units = creditUnits(amount);
  if (units < 0n) throw httpError(400, '任务费用不能为负数');
  const team = await lockTeam(db, teamId);
  const member = await requireTeam(db, teamId, actorId, 'write');
  const operationId = `team-job:${jobId}:debit`;
  const previous = (await db.query('SELECT * FROM oaooao_team_credit_operations WHERE id=$1', [operationId])).rows[0];
  if (previous) {
    if (previous.team_id !== teamId || previous.actor_id !== actorId || creditUnits(previous.amount) !== -units) throw httpError(409, '任务扣费标识发生冲突');
    return;
  }
  if (units > creditUnits(team.task_limit)) throw httpError(402, '本次费用超过团队单次任务消费上限');
  const budget = await teamBudget(db, teamId, actorId);
  if (member.monthly_limit !== null && creditUnits(budget.spent) + units > creditUnits(member.monthly_limit)) throw httpError(402, '本月成员预算不足，请联系团队管理员');
  const batches = (await db.query('SELECT * FROM oaooao_team_credit_batches WHERE team_id=$1 AND remaining_amount>0 AND (expires_at IS NULL OR expires_at>clock_timestamp()) ORDER BY expires_at NULLS LAST,id FOR UPDATE', [teamId])).rows;
  const available = batches.reduce((sum, row) => sum + creditUnits(row.remaining_amount), 0n);
  if (available < units) throw httpError(402, '团队积分不足，不会改扣个人积分');
  await db.query("INSERT INTO oaooao_team_credit_operations(id,team_id,actor_id,kind,amount,budget_delta,budget_month,job_id,reason) VALUES($1,$2,$3,'debit',$4,$5,to_date($6,'YYYY-MM'),$7,'团队生成任务')", [operationId, teamId, actorId, creditDecimal(-units), creditDecimal(units), budget.month, jobId]);
  let remaining = units;
  for (const batch of batches) {
    const take = remaining < creditUnits(batch.remaining_amount) ? remaining : creditUnits(batch.remaining_amount);
    if (take === 0n) break;
    await db.query('UPDATE oaooao_team_credit_batches SET remaining_amount=remaining_amount-$2 WHERE id=$1', [batch.id, creditDecimal(take)]);
    await db.query('INSERT INTO oaooao_team_credit_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)', [operationId, batch.id, creditDecimal(-take)]);
    remaining -= take;
  }
}

export async function refundTeamJob(db: PoolClient, job: TeamRow) {
  await lockTeam(db, job.team_id);
  const debitId = `team-job:${job.id}:debit`, refundId = `team-job:${job.id}:refund`;
  if ((await db.query('SELECT id FROM oaooao_team_credit_operations WHERE refund_of=$1', [debitId])).rowCount) return;
  const debit = (await db.query('SELECT * FROM oaooao_team_credit_operations WHERE id=$1 AND team_id=$2', [debitId, job.team_id])).rows[0];
  if (!debit || debit.actor_id !== job.user_id || creditUnits(debit.amount) !== -creditUnits(job.cost)) throw httpError(409, '未找到匹配的团队扣费记录，需核对后退款');
  const allocations = (await db.query('SELECT a.*,b.expires_at,b.expires_at IS NULL OR b.expires_at>clock_timestamp() valid FROM oaooao_team_credit_allocations a JOIN oaooao_team_credit_batches b ON b.id=a.batch_id WHERE a.operation_id=$1 FOR UPDATE OF b', [debitId])).rows;
  const restored = allocations.filter(row => row.valid).reduce((sum, row) => sum - creditUnits(row.delta), 0n);
  // Restore the original budget month, even when the financial batch has expired.
  await db.query("INSERT INTO oaooao_team_credit_operations(id,team_id,actor_id,kind,amount,budget_delta,budget_month,job_id,refund_of,reason) VALUES($1,$2,$3,'refund',$4,$5,$6,$7,$8,'任务失败或取消；过期批次不延长有效期')", [refundId, job.team_id, job.user_id, creditDecimal(restored), creditDecimal(-creditUnits(debit.budget_delta)), debit.budget_month, job.id, debitId]);
  for (const row of allocations.filter(item => item.valid)) {
    const value = creditDecimal(-creditUnits(row.delta));
    await db.query('UPDATE oaooao_team_credit_batches SET remaining_amount=remaining_amount+$2 WHERE id=$1', [row.batch_id, value]);
    await db.query('INSERT INTO oaooao_team_credit_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)', [refundId, row.batch_id, value]);
  }
}
