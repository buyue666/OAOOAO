import type { LogicalModel, SystemChannel } from './admin-types'

/** Discovered models stay disabled drafts until an administrator configures them. */
export function channelModelCatalog(channels: SystemChannel[], configured: LogicalModel[]) {
  const models = structuredClone(configured)
  const pendingIds = new Set<string>()
  const normalize = (name: string) => name.trim().toLowerCase()
  const routedUpstreams = new Set(configured.flatMap(model => model.bindings.map(binding => `${binding.channelId}:${normalize(binding.upstreamModel)}`)))
  const reserved = new Set(configured.flatMap(model => [model.id, ...(model.aliases ?? [])]).map(normalize))
  const known = new Set(configured.flatMap(model => [model.id, ...(model.aliases ?? []), ...model.bindings.map(binding => binding.upstreamModel)].map(name => `${model.capability}:${normalize(name)}`)))
  const drafts = new Map<string, LogicalModel>()
  for (const channel of channels) for (const upstreamModel of channel.models) {
    if (routedUpstreams.has(`${channel.id}:${normalize(upstreamModel)}`)) continue
    const capability = channel.advancedConfig?.modelCapabilities?.[upstreamModel] ?? 'text'
    const key = `${capability}:${normalize(upstreamModel)}`
    if (known.has(key)) continue
    let model = drafts.get(key)
    if (!model) {
      const base = upstreamModel.trim().slice(0, 175)
      if (!base) continue
      let id = base, suffix = 1
      while (reserved.has(normalize(id))) id = `${base}-${capability}-${suffix++}`
      reserved.add(normalize(id))
      model = { id, name: upstreamModel, capability, enabled: false, bindings: [] }
      drafts.set(key, model)
      pendingIds.add(id)
      models.push(model)
    }
    if (!model.bindings.some(binding => binding.channelId === channel.id)) {
      model.bindings.push({ id: `discovered-${model.bindings.length + 1}`, channelId: channel.id, upstreamModel, enabled: true, priority: model.bindings.length + 1 })
    }
  }
  return { models, pendingIds }
}

/** Saving another route must not silently persist every unconfigured discovery. */
export function configuredCatalogModels(models: LogicalModel[], initial: ReturnType<typeof channelModelCatalog>, costs: Record<string, number>) {
  return models.filter(model => !initial.pendingIds.has(model.id)
    || JSON.stringify(model) !== JSON.stringify(initial.models.find(item => item.id === model.id))
    || [model.id, ...model.bindings.flatMap(binding => [binding.upstreamModel, binding.requestAlias ?? ''])].some(key => Object.hasOwn(costs, key)))
}
