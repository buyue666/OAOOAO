import { PluginCanvasEditor } from '@/components/free-canvas/plugin-canvas'
import { loadCanvasProject } from '@/components/free-canvas/canvas-server-data'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const { project, error } = await loadCanvasProject(projectId)
  return <PluginCanvasEditor key={projectId} projectId={projectId} project={project} loadError={error} />
}
