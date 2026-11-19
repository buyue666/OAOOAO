import { notFound } from 'next/navigation'
import { TeamStudio } from '@/components/studio/team-studio'
import { teamStudioView } from '@/lib/studio/team-studio-routes'

export default async function Page({ params }: { params: Promise<{ teamId: string; projectId: string; view?: string[] }> }) {
  const { teamId, projectId, view } = await params
  const area = teamStudioView(view)
  if (!area || area === 'canvas') notFound()
  return <TeamStudio teamId={teamId} projectId={projectId} area={area} />
}
