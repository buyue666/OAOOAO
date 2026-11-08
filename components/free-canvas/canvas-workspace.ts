export type CanvasWorkspace = {
  teamId: string
  projectId: string
  teamName: string
  readOnly: boolean
  canDownload: boolean
  modelIds: string[]
}

export function teamCanvasRoot(workspace: Pick<CanvasWorkspace, 'teamId' | 'projectId'>) {
  return `/api/teams/${encodeURIComponent(workspace.teamId)}/projects/${encodeURIComponent(workspace.projectId)}`
}
