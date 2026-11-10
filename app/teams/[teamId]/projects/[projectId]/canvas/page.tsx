import { PluginCanvasEditor } from '@/components/free-canvas/plugin-canvas'
import { loadCanvasPluginAccess, loadTeamCanvas } from '@/components/free-canvas/canvas-server-data'

export default async function TeamCanvasPage({ params }: { params: Promise<{ teamId: string; projectId: string }> }) {
  const { teamId, projectId } = await params
  const access = await loadCanvasPluginAccess()
  const { project, workspace, error } = access.installed ? await loadTeamCanvas(teamId, projectId) : { project: null, workspace: undefined, error: access.error }
  return <PluginCanvasEditor key={`${teamId}:${projectId}`} loaded={access.installed || Boolean(access.error)} projectId={projectId} project={project} workspace={workspace} loadError={error} />
}
