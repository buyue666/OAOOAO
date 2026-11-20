import { PluginCanvasIndex } from '@/components/free-canvas/plugin-canvas'
import { loadCanvasSummaries } from '@/components/free-canvas/canvas-server-data'

export default async function Page() {
  const { projects, error } = await loadCanvasSummaries()
  return <PluginCanvasIndex projects={projects} loadError={error} />
}
