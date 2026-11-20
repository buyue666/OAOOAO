import { creativePlugin, type CreativePluginId } from './creative-plugins'
import { workspaceHref, workspaceRoot, type WorkspaceIdentity } from './workspace-navigation'

/** Tools must use the team's project APIs or operate entirely on local files. */
const teamFeatures = new Set<CreativePluginId>(['canvas', 'director'])

export function workspaceFeature(id: CreativePluginId, identity: WorkspaceIdentity | null) {
  const supported = !identity || teamFeatures.has(id)
  const href = creativePlugin(id).href
  return {
    supported,
    available: supported,
    href: supported ? identity ? workspaceHref(workspaceRoot(identity), href) : href : undefined,
  }
}
