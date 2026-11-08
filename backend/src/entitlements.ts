import { httpError, type Context } from './core.js';
import type { PoolClient } from 'pg';
import { getPlanSummary } from './wallet.js';
import type { GenerationKind } from './providers.js';

export const GENERATION_KINDS = ['text', 'image', 'video', 'audio', 'render'] as const;
const labels: Record<GenerationKind, string> = {
  text: '文本生成', image: '图片生成', video: '视频生成', audio: '音频生成', render: '成片合成',
};

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
