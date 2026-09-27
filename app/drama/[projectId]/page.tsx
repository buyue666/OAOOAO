import { DramaDetailPage } from '@/components/studio/drama-detail-page'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <DramaDetailPage projectId={projectId} />
}
