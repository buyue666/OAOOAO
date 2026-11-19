import type { SessionGenerationSettings } from './generation-types'

/** Labels come from the public catalog. Internal identifiers remain request data. */
export function publicModelLabel(value: string | null | undefined, settings?: Pick<SessionGenerationSettings, 'logicalModels'>): string {
  const raw = value?.trim()
  if (!raw) return '未记录模型'
  const models = settings?.logicalModels ?? []
  const model = models.find(item => item.id === raw || item.name === raw || item.aliases?.includes(raw))
  if (model?.name?.trim()) return model.name.trim()
  for (const item of models) {
    const alias = item.bindings?.find(binding => binding.requestAlias?.trim() === raw)?.requestAlias?.trim()
    if (alias) return alias
  }
  const matches = new Set(models.filter(item => item.bindings?.some(binding => binding.upstreamModel === raw)).map(item => item.name?.trim()).filter(Boolean))
  return matches.size === 1 ? [...matches][0]! : '历史模型'
}
