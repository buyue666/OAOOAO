import { PluginCanvasIndex } from '@/components/free-canvas/plugin-canvas'
import { loadCanvasPluginAccess, loadCanvasSummaries } from '@/components/free-canvas/canvas-server-data'

export default async function Page() {
  const access = await loadCanvasPluginAccess()
  const { projects, error } = access.installed ? await loadCanvasSummaries() : { projects: [], error: access.error }
  return <PluginCanvasIndex loaded={access.installed || Boolean(access.error)} projects={projects} loadError={error} />
}
