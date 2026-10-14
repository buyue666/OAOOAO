import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { type Context, httpError, transaction } from './core.js';
import { adjustWallet, getPlanSummary, getWallet, grantTimedCredits, type WalletClock } from './wallet.js';

export interface CheckInReward { rewardPoints:number; validityDays:number; }
export interface CheckInPlanReward extends CheckInReward { planId:string; }
export interface CheckInSettings extends CheckInReward { enabled:boolean; planRewards:CheckInPlanReward[]; }
export const DEFAULT_CHECK_IN_SETTINGS: Readonly<CheckInSettings> = Object.freeze({ enabled:false,rewardPoints:10,validityDays:0,planRewards:[] });
export const CHECK_IN_TIME_ZONE='Asia/Shanghai';
const validReward=(value:unknown):value is number=>typeof value==='number' && Number.isInteger(value) && value>=1 && value<=1_000_000;
const validDays=(value:unknown):value is number=>typeof value==='number' && Number.isInteger(value) && value>=0 && value<=3650;

export function validateCheckInSettings(value:unknown,knownPlanIds?:ReadonlySet<string>):CheckInSettings{
  if(!value || typeof value!=='object' || Array.isArray(value))throw httpError(400,'Invalid check-in settings');
  const input=value as Record<string,unknown>;const days=input.validityDays===undefined?0:input.validityDays;const plans=input.planRewards===undefined?[]:input.planRewards;
  if(Object.keys(input).some(key=>!['enabled','rewardPoints','validityDays','planRewards'].includes(key)) || typeof input.enabled!=='boolean' || !validReward(input.rewardPoints) || !validDays(days) || !Array.isArray(plans) || plans.length>100)throw httpError(400,'Check-in requires a boolean enabled flag, 1..1000000 integer points, 0..3650 validity days and at most 100 plan rules');
  const seen=new Set<string>();const planRewards=plans.map(raw=>{
    if(!raw || typeof raw!=='object' || Array.isArray(raw))throw httpError(400,'Invalid check-in plan rule');
    const rule=raw as Record<string,unknown>;
    if(Object.keys(rule).some(key=>!['planId','rewardPoints','validityDays'].includes(key)) || typeof rule.planId!=='string' || !rule.planId.trim() || rule.planId!==rule.planId.trim() || rule.planId.length>200 || seen.has(rule.planId) || !validReward(rule.rewardPoints) || !validDays(rule.validityDays))throw httpError(400,'Check-in plan rules require unique plan IDs, integer points and validity days');
    if(knownPlanIds && !knownPlanIds.has(rule.planId))throw httpError(400,'Check-in plan rule refers to an unknown entitlement plan');
    seen.add(rule.planId);return {planId:rule.planId,rewardPoints:rule.rewardPoints,validityDays:rule.validityDays};
  });
  return {enabled:input.enabled,rewardPoints:input.rewardPoints,validityDays:days,planRewards};
}
export function normalizeCheckInSettings(value:unknown):CheckInSettings{
  const defaults=()=>({...DEFAULT_CHECK_IN_SETTINGS,planRewards:[]});
  if(!value || typeof value!=='object' || Array.isArray(value))return defaults();
  const input=value as Record<string,unknown>;
  try{return validateCheckInSettings({...input,enabled:input.enabled===true,rewardPoints:input.rewardPoints===undefined?10:input.rewardPoints});}
  catch{return defaults();}
}

interface ClaimRow { reward_points:number; validity_days:number; expires_at:Date|null; rule_plan_id:string|null;rule_plan_name:string|null; }
interface CheckInRule extends CheckInReward { enabled:boolean;rulePlanId:string|null;rulePlanName:string|null; }
interface CheckInStatus extends CheckInRule {
  claimed:boolean;date:string;timeZone:typeof CHECK_IN_TIME_ZONE;
  claimedRewardPoints:number|null;claimedValidityDays:number|null;claimedPlanId:string|null;claimedPlanName:string|null;expiresAt:string|null;
}
async function lockedState(ctx:Context,db:PoolClient,userId:string,clock?:WalletClock){
  // Config -> user order. Plan purchases, refunds and assignments also serialize on this user.
  const raw=(await db.query("SELECT value FROM oaooao_settings WHERE id='global' FOR SHARE")).rows[0]?.value ?? {};
  const user=await db.query('SELECT id FROM oaooao_users WHERE id=$1 FOR NO KEY UPDATE',[userId]);
  if(!user.rowCount)throw httpError(404,'Account not found');
  const at=clock?.() ?? (await db.query<{at:Date}>('SELECT clock_timestamp() AS at')).rows[0]!.at;
  if(!Number.isFinite(at.getTime()))throw httpError(500,'Invalid check-in clock');
  const date=(await db.query<{date:string}>("SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date",[at])).rows[0]!.date;
  const config=normalizeCheckInSettings(raw.checkIn);
  const plan=await getPlanSummary(ctx,userId,db,at);
  // A historical users.plan_id label must never qualify for a paid reward rule.
  const override=plan.hasActivePlan?config.planRewards.find(rule=>rule.planId===plan.planId):undefined;
  const rule:CheckInRule={enabled:config.enabled,rewardPoints:override?.rewardPoints ?? config.rewardPoints,validityDays:override?.validityDays ?? config.validityDays,rulePlanId:override?.planId ?? null,rulePlanName:override ? plan.planName ?? override.planId : null};
  const claim=(await db.query<ClaimRow>('SELECT reward_points,validity_days,expires_at,rule_plan_id,rule_plan_name FROM oaooao_check_ins WHERE user_id=$1 AND claim_date=$2::date',[userId,date])).rows[0];
  return {at,date,rule,claim};
}
function status(rule:CheckInRule,date:string,claim?:ClaimRow):CheckInStatus{
  return {...rule,claimed:Boolean(claim),date,timeZone:CHECK_IN_TIME_ZONE,claimedRewardPoints:claim?.reward_points ?? null,claimedValidityDays:claim?.validity_days ?? null,claimedPlanId:claim?.rule_plan_id ?? null,claimedPlanName:claim?.rule_plan_name ?? null,expiresAt:claim?.expires_at?.toISOString() ?? null};
}
export async function getCheckInStatus(ctx:Context,userId:string,clock?:WalletClock):Promise<CheckInStatus>{
  return transaction(ctx.db,async db=>{const state=await lockedState(ctx,db,userId,clock);return status(state.rule,state.date,state.claim);});
}
export async function claimCheckIn(ctx:Context,userId:string,clock?:WalletClock):Promise<CheckInStatus & {balance:number}>{
  return transaction(ctx.db,async db=>{
    const {at,date,rule,claim}=await lockedState(ctx,db,userId,clock);
    if(claim)return {...status(rule,date,claim),balance:(await getWallet(ctx,userId,db,()=>at)).pointsBalance};
    if(!rule.enabled)throw httpError(409,'签到暂未开启','rejected');
    const operationId=`check-in:${createHash('sha256').update(userId).digest('hex')}:${date}`;
    const expiresAt=rule.validityDays===0?null:new Date(at.getTime()+rule.validityDays*86_400_000);
    const details={kind:'check_in',type:'grant',description:'每日签到奖励',date,timeZone:CHECK_IN_TIME_ZONE,validityDays:rule.validityDays,planId:rule.rulePlanId,planName:rule.rulePlanName};
    const wallet=expiresAt
      ? await grantTimedCredits(ctx,userId,operationId,rule.rewardPoints,expiresAt,details,db,()=>at)
      : await adjustWallet(ctx,userId,operationId,rule.rewardPoints,details,db,()=>at);
    const saved=(await db.query<ClaimRow>('INSERT INTO oaooao_check_ins(user_id,claim_date,reward_points,operation_id,claimed_at,validity_days,expires_at,rule_plan_id,rule_plan_name) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9) RETURNING reward_points,validity_days,expires_at,rule_plan_id,rule_plan_name',[userId,date,rule.rewardPoints,operationId,at,rule.validityDays,expiresAt,rule.rulePlanId,rule.rulePlanName])).rows[0]!;
    await ctx.audit({actorId:userId,action:'account.check_in',targetType:'wallet',targetId:userId,metadata:{date,rewardPoints:rule.rewardPoints,validityDays:rule.validityDays,expiresAt:expiresAt?.toISOString() ?? null,planId:rule.rulePlanId,planName:rule.rulePlanName,operationId}},db);
    return {...status(rule,date,saved),balance:wallet.pointsBalance};
  });
}
export async function registerCheckIn(app:FastifyInstance,ctx:Context){
  app.get('/api/account/check-in',async request=>getCheckInStatus(ctx,(await ctx.requireUser(request)).id));
  app.post('/api/account/check-in',async request=>claimCheckIn(ctx,(await ctx.requireUser(request)).id));
}
