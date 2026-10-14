import type { EntitlementGenerationKind, EntitlementPlan } from './admin-types'

export const ENTITLEMENT_GENERATION_KINDS: ReadonlyArray<{ value: EntitlementGenerationKind; label: string }> = [
  { value: 'text', label: '文本生成' }, { value: 'image', label: '图片生成' },
  { value: 'video', label: '视频生成' }, { value: 'audio', label: '音频生成' }, { value: 'render', label: '成片合成' },
]

export function allowedGenerationKinds(plan: Pick<EntitlementPlan, 'allowedGenerationKinds'>): EntitlementGenerationKind[] {
  // Absent legacy policy permits all. An explicitly empty policy permits none.
  return ENTITLEMENT_GENERATION_KINDS.filter(item => plan.allowedGenerationKinds === undefined || plan.allowedGenerationKinds.includes(item.value)).map(item => item.value)
}
