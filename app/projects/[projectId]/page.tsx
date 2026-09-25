import { ProjectWorkspacePage } from '@/components/studio/projects-pages'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <ProjectWorkspacePage projectId={projectId} />
}
