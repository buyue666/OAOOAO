import { Suspense } from 'react'
import type { Metadata } from 'next'
import { TeamWorkspace } from '@/components/studio/team-workspace'
import { TeamLoading } from '@/components/studio/team-feedback'

export const metadata: Metadata = { title: '团队工作空间 · OAO', robots: { index: false, follow: false } }

export default async function TeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  return <Suspense fallback={<TeamLoading />}><TeamWorkspace teamId={teamId} /></Suspense>
}
