'use client'

import { CanvasWorkspaceView } from './canvas-workspace-view'
import { useCanvasWorkspaceController } from './use-canvas-workspace'

export function CanvasWorkspace({ projectId, fullScreen = false }: { projectId?: string; fullScreen?: boolean }) {
  const controller = useCanvasWorkspaceController({ projectId })
  const shellClass = fullScreen
    ? 'studio-canvas-fullscreen oao-canvas-editor relative flex min-h-0 overflow-hidden bg-black'
    : 'oao-canvas-editor studio-surface relative flex min-h-[600px] min-h-0 overflow-hidden'

  return <CanvasWorkspaceView {...controller} shellClass={shellClass} />
}
