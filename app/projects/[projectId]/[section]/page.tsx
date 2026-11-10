import { redirect } from 'next/navigation'
import { PluginDramaPage } from '@/components/studio/plugins/plugin-workspaces'
import { legacyCanvasPath, type ProjectSearchParams } from '@/lib/studio/project-route'

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string; section: string }>; searchParams?: Promise<ProjectSearchParams> }) {
  const { projectId, section } = await params
  if (!projectId.startsWith('drama-')) redirect(legacyCanvasPath(projectId, await searchParams))
  return <PluginDramaPage key={projectId} projectId={projectId} section={section} />
}
