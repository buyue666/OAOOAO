import { CanvasEditor } from '@/components/free-canvas/canvas-editor'
import { loadTeamCanvas } from '@/components/free-canvas/canvas-server-data'

export default async function TeamCanvasPage({ params }: { params: Promise<{ teamId: string; projectId: string }> }) {
  const { teamId, projectId } = await params
  const { project, workspace, error } = await loadTeamCanvas(teamId, projectId)
  return <CanvasEditor key={`${teamId}:${projectId}`} projectId={projectId} project={project} workspace={workspace} loadError={error} />
}
