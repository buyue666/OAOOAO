import { httpError, type Context } from './core.js';
import type { PoolClient } from 'pg';
import { getPlanSummary } from './wallet.js';
import type { GenerationKind } from './providers.js';

export const GENERATION_KINDS = ['text', 'image', 'video', 'audio', 'render'] as const;
const labels: Record<GenerationKind, string> = {
  text: '文本生成', image: '图片生成', video: '视频生成', audio: '音频生成', render: '成片合成',
};

export const GENERATION_CONCURRENCY_KINDS = ['agent', ...GENERATION_KINDS] as const;
export type GenerationConcurrencyKind = typeof GENERATION_CONCURRENCY_KINDS[number];
const concurrencyLabels = {...labels, agent:'创作助手'};
const validConcurrency=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=100;

export function validatePlanConcurrency(plan: Record<string, unknown>): void {
  const value=plan.generationConcurrency;
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([kind,limit])=>
    !Object.hasOwn(concurrencyLabels,kind)||!validConcurrency(limit)))throw httpError(400,'套餐生成并发须为 1–100 的整数，留空可沿用全局默认');
}

export function assertGenerationConcurrency(settings:Record<string,any>,plan:Record<string,any>|undefined,kind:GenerationConcurrencyKind,active:number):void {
  const override=plan?.generationConcurrency?.[kind],fallback=settings.generationConcurrency?.[kind];
  const limit=validConcurrency(override)?override:validConcurrency(fallback)?fallback:kind==='agent'?1:3;
  if(active>=limit)throw httpError(429,`${concurrencyLabels[kind]}并发已满（最多 ${limit} 项），请等待已有任务完成后再试`);
}

/** Omission preserves existing plans. An explicit empty list grants no new generation. */
export function validatePlanGenerationKinds(plan: Record<string, unknown>): void {
  const value = plan.allowedGenerationKinds;
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > GENERATION_KINDS.length
    || value.some(kind => typeof kind !== 'string' || !GENERATION_KINDS.includes(kind as GenerationKind))
    || new Set(value).size !== value.length) {
    throw httpError(400, '允许的创作功能必须从文本、图片、视频、音频生成和成片合成中选择，且不能重复');
  }
}

export function assertPlanGenerationAllowed(plan: Record<string, unknown>, kind: GenerationKind): void {
  // Validate persisted settings as well; malformed restrictions must never grant access.
  validatePlanGenerationKinds(plan);
  if (Array.isArray(plan.allowedGenerationKinds) && !plan.allowedGenerationKinds.includes(kind)) {
    throw httpError(403, `当前权益方案未开放${labels[kind]}，请联系管理员或选择包含此功能的方案`);
  }
}

/** Omitted model scope preserves legacy access; an empty scope denies all models. */
export function validatePlanModels(plan: Record<string, unknown>): void {
  const value = plan.allowedModelIds;
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 2000 || value.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 200)
    || new Set(value).size !== value.length) throw httpError(400, '可用模型必须是有效且不重复的逻辑模型 ID 列表');
}

export function assertPlanModelAllowed(plan: Record<string, unknown>, modelId: string): void {
  validatePlanModels(plan);
  if (Array.isArray(plan.allowedModelIds) && !plan.allowedModelIds.includes(modelId))
    throw httpError(403, '当前个人套餐未开放此模型，请选择套餐允许的模型或升级套餐');
}

export async function personalGenerationPlan(ctx: Context, settings: Record<string, any>, userId: string, client?: PoolClient): Promise<Record<string, any> | undefined> {
  if (ctx.workspace || settings.entitlements?.enabled !== true) return;
  const summary = await getPlanSummary(ctx, userId, client);
  const id = summary.hasActivePlan ? summary.planId : settings.entitlements.defaultPlanId;
  const plan = settings.entitlements.plans?.find((item: Record<string, any>) => item.enabled && item.id === id);
  if (!plan) throw httpError(403, '没有可用的个人套餐权益方案，请联系管理员');
  validatePlanModels(plan);
  return plan;
}

/** Credits alone do not confer subscription-only model access. */
export async function modelSubscriptionAccess(ctx:Context,settings:Record<string,any>,userId?:string,client?:PoolClient):Promise<boolean>{
 if(!userId)return false;
 if(ctx.workspace){const team=(await (client||ctx.db).query('SELECT subscription_expires_at FROM oaooao_teams WHERE id=$1',[ctx.workspace.teamId])).rows[0];return !!team?.subscription_expires_at&&new Date(team.subscription_expires_at).getTime()>Date.now();}
 const plan=await getPlanSummary(ctx,userId,client);
 return plan.hasActivePlan&&plan.planId!==settings.entitlements?.defaultPlanId;
}
export async function assertModelSubscription(ctx:Context,settings:Record<string,any>,model:Record<string,any>,userId?:string,client?:PoolClient){
 if(model.requiresSubscription===true&&!await modelSubscriptionAccess(ctx,settings,userId,client))throw httpError(403,'需要订阅套餐才可使用此模型');
}
