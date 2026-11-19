import { notFound } from 'next/navigation'
import { TeamStudio } from '@/components/studio/team-studio'
import { teamStudioView } from '@/lib/studio/team-studio-routes'

export default async function Page({ params }: { params: Promise<{ teamId: string; view?: string[] }> }) {
  const { teamId, view } = await params
  const area = teamStudioView(view)
  if (!area) notFound()
  return <TeamStudio teamId={teamId} area={area} />
}
