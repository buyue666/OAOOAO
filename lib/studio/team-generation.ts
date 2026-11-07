import type { SessionSettings } from './api'
import type { ModelConfig } from './types'

export function availableTeamModels(models: ModelConfig[], allowedIds: string[], settings?: SessionSettings) {
  return models.filter(model => model.status === '可用' && (!allowedIds.length || allowedIds.some(id => {
    const logical = settings?.logicalModels?.find(item => item.id === id)
    return model.id === id || logical?.bindings.some(binding => binding.enabled && binding.requestAlias === model.id)
  })))
}

export function teamSubmissionUncertain(reason: unknown) {
  const status = reason && typeof reason === 'object' && 'status' in reason ? Number(reason.status) : 0
  return !status || status >= 500 || status === 408
}

export type PendingTeamGeneration = { requestId: string; points: number; payload: { kind: string; prompt: string; config: Record<string, unknown>; references: unknown[] } }

export function readPendingTeamGeneration(raw: string | null): PendingTeamGeneration | null {
  try {
    const value = JSON.parse(raw || 'null')
    if (!value || !/^[\w-]{8,100}$/.test(value.requestId) || !Number.isFinite(value.points) || value.points < 0) return null
    const input = value.payload
    if (!input || !['image', 'video', 'audio', 'text'].includes(input.kind) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 64000 || !input.config || typeof input.config.model !== 'string' || !Array.isArray(input.references)) return null
    return value
  } catch { return null }
}
