import { ProjectWorkspacePage } from '@/components/studio/projects-pages'
import { CreativeWorkspace } from '@/components/studio/creative-workspace'

export default async function Page({ params }: { params: Promise<{ projectId: string; section: string }> }) {
  const { projectId, section } = await params
  return projectId.startsWith('drama-') ? <CreativeWorkspace key={projectId} projectId={projectId} initialView={section} /> : <ProjectWorkspacePage projectId={projectId} sub={section} />
}
