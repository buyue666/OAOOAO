import type { Metadata } from 'next'
import { PlansPage } from '@/components/membership/plans-page'
import { TeamPlansPage } from '@/components/membership/team-plans-page'

export const metadata: Metadata = { title: '个人与团队会员 · OAO', description: '了解 OAO 个人会员和团队空间的积分、席位与创作权益。' }

export default async function Page({ searchParams }: { searchParams: Promise<{ edition?: string }> }) {
  const { edition } = await searchParams
  return edition === 'team' ? <TeamPlansPage /> : <PlansPage />
}
