import { redirect } from 'next/navigation'
import { CreativeWorkspace } from '@/components/studio/creative-workspace'
import { legacyCanvasPath, type ProjectSearchParams } from '@/lib/studio/project-route'

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams?: Promise<ProjectSearchParams> }) {
  const { projectId } = await params
  if (!projectId.startsWith('drama-')) redirect(legacyCanvasPath(projectId, await searchParams))
  return <CreativeWorkspace key={projectId} projectId={projectId} />
}
