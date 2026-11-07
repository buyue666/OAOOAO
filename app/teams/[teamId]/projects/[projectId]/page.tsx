import { Suspense } from 'react'
import type { Metadata } from 'next'
import { TeamProjectWorkspace } from '@/components/studio/team-project-workspace'
import { TeamLoading } from '@/components/studio/team-feedback'

export const metadata: Metadata = { title: '团队创作项目 · OAO', robots: { index: false, follow: false } }

export default async function TeamProjectPage({ params }: { params: Promise<{ teamId: string; projectId: string }> }) {
  const { teamId, projectId } = await params
  return <Suspense fallback={<TeamLoading />}><TeamProjectWorkspace teamId={teamId} projectId={projectId} /></Suspense>
}
