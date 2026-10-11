import { CanvasIndexPage } from '@/components/free-canvas/canvas-index-page'
import { loadCanvasSummaries } from '@/components/free-canvas/canvas-server-data'

export default async function Page() {
  const { projects, error } = await loadCanvasSummaries()
  return <CanvasIndexPage projects={projects} loadError={error} />
}
