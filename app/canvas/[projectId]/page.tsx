import { PluginCanvasEditor } from '@/components/free-canvas/plugin-canvas'
import { loadCanvasPluginAccess, loadCanvasProject } from '@/components/free-canvas/canvas-server-data'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const access = await loadCanvasPluginAccess()
  const { project, error } = access.installed ? await loadCanvasProject(projectId) : { project: null, error: access.error }
  return <PluginCanvasEditor key={projectId} loaded={access.installed || Boolean(access.error)} projectId={projectId} project={project} loadError={error} />
}
