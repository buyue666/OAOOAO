import { Suspense } from 'react'
import type { Metadata } from 'next'
import { TeamList } from '@/components/studio/team-list'
import { TeamLoading } from '@/components/studio/team-feedback'

export const metadata: Metadata = { title: '团队空间 · OAO', description: '在 OAO 团队空间中管理成员、共享创作项目与素材，并控制团队积分预算。', robots: { index: false, follow: false } }

export default function TeamsPage() {
  return <Suspense fallback={<TeamLoading />}><TeamList /></Suspense>
}
