import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { httpError, string, type Context } from './core.js';
import { assertTeamSeats, lockTeam, requireTeam, teamEvent } from './team-access.js';
import { grantTeamCredits } from './team-wallet.js';
import { creditDecimal, creditUnits } from './wallet.js';

type Row = Record<string, any>;
export async function prepareTeamPurchase(db: PoolClient, userId: string, input: Row) {
  const planId = string(input.teamPlanId, '团队套餐', 100), seats = Number(input.seats);
  if (!Number.isSafeInteger(seats) || seats < 2 || seats > 100) throw httpError(400, '请选择有效的创作席位数');
  const plan = (await db.query('SELECT * FROM oaooao_team_plans WHERE id=$1 AND enabled FOR SHARE', [planId])).rows[0];
  if (!plan || plan.price_cents === null) throw httpError(404, '团队套餐未开放购买');
  if (seats < plan.min_seats || seats > plan.max_seats) throw httpError(400, '席位数不在套餐允许范围内');
  let team: Row;
  if (input.teamId) {
    const teamId = string(input.teamId, '团队', 100);
    await lockTeam(db, teamId); team = await requireTeam(db, teamId, userId, 'manage');
  } else {
    const name = string(input.teamName, '新团队名称', 80);
    await db.query('SELECT id FROM oaooao_users WHERE id=$1 FOR NO KEY UPDATE', [userId]);
    if (Number((await db.query('SELECT count(*) n FROM oaooao_teams WHERE owner_id=$1', [userId])).rows[0].n) >= 20) throw httpError(409, '每个账号最多创建 20 个团队');
    team = (await db.query('INSERT INTO oaooao_teams(id,name,owner_id) VALUES($1,$2,$3) RETURNING *', [randomUUID(),name,userId])).rows[0];
    await db.query("INSERT INTO oaooao_team_members(team_id,user_id,role,can_download) VALUES($1,$2,'owner',true)", [team.id,userId]);
    await teamEvent(db,team.id,userId,'team.created',{name,source:'subscription-checkout'});
  }
  const now = (await db.query('SELECT clock_timestamp() at')).rows[0].at;
  const active = team.subscription_expires_at && team.subscription_expires_at > now;
  if (active && (team.plan_id !== planId || team.seat_limit !== seats)) throw httpError(409, '当前套餐有效期内可按原套餐和席位续费；更换套餐或席位请等待本期结束');
  const pending = (await db.query("SELECT id FROM oaooao_orders WHERE metadata->'teamPurchase'->>'teamId'=$1 AND (status='refunding' OR status='pending' AND expires_at>now()) LIMIT 1", [team.id])).rows[0];
  if (pending) throw httpError(409, '这个团队已有待处理订单，请先到原购买账号的订单记录继续支付或确认状态');
  await assertTeamSeats(db,{...team,seat_limit:seats,reviewer_limit:plan.reviewer_limit});
  const used = Number((await db.query('SELECT coalesce(sum(byte_count),0) n FROM oaooao_team_assets WHERE team_id=$1',[team.id])).rows[0].n);
  if (used > Number(plan.storage_bytes)) throw httpError(409,'所选套餐容量小于团队当前用量，请先清理素材或选择更高容量套餐');
  const price = Number(plan.price_cents) * seats;
  if (!Number.isSafeInteger(price) || price < 1 || price > 10_000_000) throw httpError(400,'团队订单金额超出支付范围');
  const points = creditDecimal(creditUnits(plan.points_per_seat) * BigInt(seats));
  const productId = `internal-team-plan:${plan.id}`;
  await db.query(`INSERT INTO oaooao_products(id,product_kind,name,amount_cents,points_amount,enabled,metadata) VALUES($1,'points',$2,0,0,false,'{"internalTeamPlan":true}') ON CONFLICT(id) DO NOTHING`,[productId,plan.name]);
  const snapshot = { teamId:team.id,teamName:team.name,planId:plan.id,planName:plan.name,seats,points,creditValidityDays:plan.credit_validity_days,reviewerLimit:plan.reviewer_limit,storageBytes:Number(plan.storage_bytes),teamConcurrency:plan.team_concurrency,memberConcurrency:plan.member_concurrency,taskLimit:String(plan.task_limit),modelIds:plan.model_ids,periodDays:30,renewal:Boolean(active) };
  return { id:productId,product_kind:'team_plan',plan_id:plan.id,name:`${plan.name} · ${team.name} · ${seats} 席 / 30 天`,amount_cents:price,currency:'CNY',points_amount:'0',daily_points:'0',period_days:30,teamPurchase:snapshot };
}

export async function settleTeamPurchase(ctx: Context, db: PoolClient, order: Row) {
  const item = order.metadata?.teamPurchase;
  if (order.product_kind !== 'team_plan' || !item?.teamId) throw httpError(409,'团队订单快照不完整');
  const team = await lockTeam(db,item.teamId);
  const previous = (await db.query("SELECT 1 FROM oaooao_team_events WHERE team_id=$1 AND action='subscription.purchased' AND details->>'orderId'=$2",[team.id,order.id])).rows[0];
  if (previous) return;
  const now = (await db.query('SELECT clock_timestamp() at')).rows[0].at as Date;
  const starts = team.subscription_expires_at && team.subscription_expires_at > now ? team.subscription_expires_at : now;
  const expires = new Date(starts.getTime()+30*86400000);
  // A paid renewal cannot remove existing seats or capacity while members are using them.
  const active = starts > now;
  const previousTeam = Object.fromEntries(['seat_limit','reviewer_limit','storage_quota_bytes','team_concurrency','member_concurrency','task_limit','model_ids','plan_id','subscription_expires_at'].map(key=>[key,team[key]]));
  await db.query(`UPDATE oaooao_teams SET seat_limit=$2,reviewer_limit=$3,storage_quota_bytes=$4,team_concurrency=$5,member_concurrency=$6,task_limit=$7,model_ids=$8,plan_id=$9,subscription_expires_at=$10,updated_at=now() WHERE id=$1`, [team.id,Math.max(active?team.seat_limit:0,item.seats),Math.max(active?team.reviewer_limit:0,item.reviewerLimit),Math.max(active?Number(team.storage_quota_bytes):0,item.storageBytes),item.teamConcurrency,item.memberConcurrency,item.taskLimit,JSON.stringify(item.modelIds),item.planId,expires]);
  if (creditUnits(item.points)>0n) await grantTeamCredits(ctx,db,team.id,order.user_id,`order:${order.id}`,item.points,new Date(starts.getTime()+item.creditValidityDays*86400000),`团队套餐购买：${order.order_no}`,'subscription');
  await db.query("UPDATE oaooao_orders SET metadata=metadata || $2::jsonb WHERE id=$1", [order.id,JSON.stringify({teamPurchaseFulfillment:{previousTeam,startsAt:starts.toISOString(),expiresAt:expires.toISOString()}})]);
  await teamEvent(db,team.id,order.user_id,'subscription.purchased',{orderId:order.id,planId:item.planId,seats:item.seats,expiresAt:expires.toISOString()});
}

/** Never refund a team order through a personal-wallet deduction. */
export async function reserveTeamPurchaseRefund(db: PoolClient, order: Row, reservationId: string) {
  if(order.product_kind!=='team_plan')return;
  const item=order.metadata.teamPurchase,fulfillment=order.metadata.teamPurchaseFulfillment;
  const team=await lockTeam(db,item.teamId);
  const last=(await db.query("SELECT details FROM oaooao_team_events WHERE team_id=$1 AND action IN ('subscription.purchased','subscription.assigned') ORDER BY id DESC LIMIT 1",[team.id])).rows[0];
  if(last?.details.orderId!==order.id||!fulfillment||team.subscription_expires_at?.toISOString()!==fulfillment.expiresAt)throw httpError(409,'团队权益已发生后续变更，请先核对团队订单后再退款');
  const batch=(await db.query('SELECT * FROM oaooao_team_credit_batches WHERE grant_key=$1 FOR UPDATE',[`team:${team.id}:order:${order.id}`])).rows[0];
  if(creditUnits(item.points)>0n&&(!batch||creditUnits(batch.remaining_amount)!==creditUnits(batch.original_amount)))throw httpError(409,'本期团队积分已使用，不能按未使用订单全额退款');
  if(Number((await db.query("SELECT count(*) n FROM oaooao_generation_jobs WHERE team_id=$1 AND status IN ('pending','running','paused')",[team.id])).rows[0].n))throw httpError(409,'团队还有生成任务，请等待任务完成后再准备退款');
  if(batch){
    await db.query('UPDATE oaooao_team_credit_batches SET remaining_amount=0 WHERE id=$1',[batch.id]);
    await db.query("INSERT INTO oaooao_team_credit_operations(id,team_id,actor_id,kind,amount,reason) VALUES($1,$2,$3,'debit',$4,'团队订单退款预留')",[`team-order-refund:${reservationId}`,team.id,order.user_id,creditDecimal(-creditUnits(batch.remaining_amount))]);
    await db.query('INSERT INTO oaooao_team_credit_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)',[`team-order-refund:${reservationId}`,batch.id,creditDecimal(-creditUnits(batch.remaining_amount))]);
  }
  await db.query('UPDATE oaooao_teams SET subscription_expires_at=now(),updated_at=now() WHERE id=$1',[team.id]);
  order.metadata={...order.metadata,teamRefund:{reservationId,batchId:batch?.id,amount:batch?.remaining_amount||'0'}};
  await db.query("UPDATE oaooao_orders SET metadata=$2 WHERE id=$1",[order.id,order.metadata]);
}

export async function releaseTeamPurchaseRefund(db: PoolClient, order: Row, reservationId: string, completed: boolean) {
  if(order.product_kind!=='team_plan')return;
  const item=order.metadata.teamPurchase,held=order.metadata.teamRefund,fulfillment=order.metadata.teamPurchaseFulfillment;
  if(held?.reservationId!==reservationId||!fulfillment)throw httpError(409,'团队退款预留记录不一致');
  await lockTeam(db,item.teamId);
  if(!completed){
    if(held.batchId){
      await db.query('UPDATE oaooao_team_credit_batches SET remaining_amount=$2 WHERE id=$1',[held.batchId,held.amount]);
      await db.query("INSERT INTO oaooao_team_credit_operations(id,team_id,actor_id,kind,amount,refund_of,reason) VALUES($1,$2,$3,'refund',$4,$5,'团队订单退款取消，恢复原积分有效期')",[`team-order-refund:${reservationId}:release`,item.teamId,order.user_id,held.amount,`team-order-refund:${reservationId}`]);
      await db.query('INSERT INTO oaooao_team_credit_allocations(operation_id,batch_id,delta) VALUES($1,$2,$3)',[`team-order-refund:${reservationId}:release`,held.batchId,held.amount]);
    }
    await db.query('UPDATE oaooao_teams SET subscription_expires_at=$2,updated_at=now() WHERE id=$1',[item.teamId,fulfillment.expiresAt]);
    return;
  }
  const old=fulfillment.previousTeam;
  await db.query(`UPDATE oaooao_teams SET seat_limit=$2,reviewer_limit=$3,storage_quota_bytes=$4,team_concurrency=$5,member_concurrency=$6,task_limit=$7,model_ids=$8,plan_id=$9,subscription_expires_at=$10,updated_at=now() WHERE id=$1`,[item.teamId,old.seat_limit,old.reviewer_limit,old.storage_quota_bytes,old.team_concurrency,old.member_concurrency,old.task_limit,JSON.stringify(old.model_ids),old.plan_id,old.subscription_expires_at]);
  await teamEvent(db,item.teamId,order.user_id,'subscription.refunded',{orderId:order.id,reservationId});
}
