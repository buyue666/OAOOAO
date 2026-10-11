import { CanvasEditor } from '@/components/free-canvas/canvas-editor'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <CanvasEditor key={projectId} projectId={projectId} />
}
