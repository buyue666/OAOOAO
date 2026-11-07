import { Suspense } from 'react'
import type { Metadata } from 'next'
import { TeamJoin } from '@/components/studio/team-join'
import { TeamLoading } from '@/components/studio/team-feedback'

export const metadata: Metadata = { title: '接受团队邀请 · OAO', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default function TeamJoinPage() {
  return <Suspense fallback={<TeamLoading />}><TeamJoin /></Suspense>
}
