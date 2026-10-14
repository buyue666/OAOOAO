import { httpError } from './core.js';
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
