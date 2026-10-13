import { CreativeWorkspace } from '@/components/studio/creative-workspace'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <CreativeWorkspace key={projectId} projectId={projectId} />
}
