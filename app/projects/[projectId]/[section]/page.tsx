import { ProjectWorkspacePage } from '@/components/studio/projects-pages'

export default async function Page({ params }: { params: Promise<{ projectId: string; section: string }> }) {
  const { projectId, section } = await params
  return <ProjectWorkspacePage projectId={projectId} sub={section} />
}
