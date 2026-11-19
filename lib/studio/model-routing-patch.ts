import type {AdminSettings} from './admin-types'

type Routing = Pick<AdminSettings, 'logicalModels' | 'defaultModels' | 'modelPointCosts'>
type RoutingPatch = {logicalModels?: Routing['logicalModels']; defaultModels?: Partial<Routing['defaultModels']>; modelPointCosts?: Routing['modelPointCosts']}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]))
  return value
}
const equal = (left: unknown, right: unknown) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right))

/** Model metadata edits must not resubmit unchanged default selections and prices. */
export function modelRoutingPatch(current: Routing, draft: Routing): RoutingPatch {
  const patch: RoutingPatch = {}
  if (!equal(current.logicalModels, draft.logicalModels)) patch.logicalModels = draft.logicalModels
  const defaults = Object.fromEntries(Object.entries(draft.defaultModels).filter(([key, value]) => !equal(current.defaultModels[key as keyof Routing['defaultModels']], value)))
  if (Object.keys(defaults).length) patch.defaultModels = defaults
  const costs = Object.fromEntries(Object.entries(draft.modelPointCosts).filter(([key, value]) => !equal(current.modelPointCosts[key], value)))
  if (Object.keys(costs).length) patch.modelPointCosts = costs
  return patch
}
