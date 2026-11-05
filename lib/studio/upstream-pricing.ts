import type {LogicalModel, LogicalModelBinding, SystemChannel} from './admin-types'

/** Separate accounts at the same endpoint share prices within a logical model. */
export function upstreamPriceKey(binding: LogicalModelBinding, channels: SystemChannel[]): string {
  const channel = channels.find(item => item.id === binding.channelId)
  if (!channel || !binding.upstreamModel.trim()) return ''
  try {
    const url = new URL(channel.baseUrl)
    const endpoint = url.origin + url.pathname.replace(/\/+$/, '') + url.search
    return JSON.stringify([endpoint, channel.advancedConfig?.protocol || channel.apiFormat || 'openai', binding.upstreamModel.trim()])
  } catch { return '' }
}

export function upstreamPricePeers(model: LogicalModel, source: LogicalModelBinding, channels: SystemChannel[]) {
  const key = upstreamPriceKey(source, channels)
  return key ? model.bindings.filter(binding => upstreamPriceKey(binding, channels) === key) : [source]
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]))
  return value
}

const priceFields = ['videoBillingUnit', 'videoPricingTemplate', 'videoPricing'] as const
const types = ['image', 'video', 'audio'] as const
export function bindingBaseCost(model: LogicalModel, binding: LogicalModelBinding, costs: Record<string, number>) {
  return (binding.requestAlias ? costs[binding.requestAlias.trim()] : undefined) ?? costs[binding.upstreamModel] ?? costs[model.id]
}
export function upstreamPricingSnapshot(model: LogicalModel, binding: LogicalModelBinding, costs: Record<string, number>) {
  const profile = binding.capabilityProfile || {}
  return JSON.stringify(ordered({
    base: bindingBaseCost(model, binding, costs),
    ...(model.capability === 'video' ? Object.fromEntries(priceFields.map(key => [key, profile[key]])) : {}),
    ...(model.capability === 'video' ? {freeCounts: types.map(type => (profile.videoReferenceRules as Record<string, {freeCount?: number}> | undefined)?.[type]?.freeCount)} : {}),
  }))
}

/** Copy pricing only: routing, credentials, supported qualities and limits stay local. */
export function synchronizeUpstreamPricing(model: LogicalModel, sourceId: string, channels: SystemChannel[], costs: Record<string, number>) {
  const source = model.bindings.find(binding => binding.id === sourceId)
  if (!source) return {model, costs}
  const peers = new Set(upstreamPricePeers(model, source, channels).map(binding => binding.id))
  const sourceProfile = source.capabilityProfile || {}
  const nextCosts = {...costs}
  const rate = bindingBaseCost(model, source, costs)
  const bindings = model.bindings.map(binding => {
    if (!peers.has(binding.id)) return binding
    const key = binding.requestAlias?.trim() || binding.upstreamModel
    if (rate === undefined) delete nextCosts[key]; else nextCosts[key] = rate
    if (model.capability !== 'video' || binding.id === source.id) return binding
    const profile = structuredClone(binding.capabilityProfile || {})
    for (const field of priceFields) {
      if (sourceProfile[field] === undefined) delete profile[field]
      else profile[field] = structuredClone(sourceProfile[field])
    }
    const sourceRules = sourceProfile.videoReferenceRules as Record<string, {freeCount?: number}> | undefined
    const rules = structuredClone((profile.videoReferenceRules || {}) as Record<string, Record<string, unknown>>)
    for (const type of types) {
      if (sourceRules?.[type]?.freeCount === undefined) {
        if (rules[type]) delete rules[type].freeCount
      } else rules[type] = {...rules[type], freeCount: sourceRules[type].freeCount}
      if (rules[type] && !Object.keys(rules[type]).length) delete rules[type]
    }
    if (Object.keys(rules).length) profile.videoReferenceRules = rules; else delete profile.videoReferenceRules
    return {...binding, capabilityProfile: profile}
  })
  return {model: {...model, bindings}, costs: nextCosts}
}

export function upstreamPricingConflicts(model: LogicalModel, channels: SystemChannel[], costs: Record<string, number>) {
  return model.bindings.filter((binding, index) => {
    const peers = upstreamPricePeers(model, binding, channels)
    return peers.length > 1 && model.bindings.indexOf(peers[0]) === index && peers.some(peer => upstreamPricingSnapshot(model, peer, costs) !== upstreamPricingSnapshot(model, binding, costs))
  })
}
