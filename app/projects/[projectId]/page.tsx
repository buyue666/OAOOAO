import { ProjectWorkspacePage } from '@/components/studio/projects-pages'
import { CreativeWorkspace } from '@/components/studio/creative-workspace'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return projectId.startsWith('drama-') ? <CreativeWorkspace key={projectId} projectId={projectId} /> : <ProjectWorkspacePage projectId={projectId} />
}
