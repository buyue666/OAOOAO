import { PluginDramaPage } from '@/components/studio/plugins/plugin-workspaces'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <PluginDramaPage key={projectId} projectId={projectId} />
}
