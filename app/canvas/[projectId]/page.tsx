import { CanvasWorkspace } from '@/components/studio/canvas-workspace'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <CanvasWorkspace projectId={projectId} fullScreen />
}
