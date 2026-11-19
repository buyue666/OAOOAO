import type { Metadata } from 'next'
import { PlansPage } from '@/components/membership/plans-page'
import { billingStoreView } from '@/lib/studio/billing-store-route'

export const metadata: Metadata = { title: '会员与积分 · OAO', description: '查看 OAO 会员套餐和积分包。' }

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; edition?: string; returnTo?: string }> }) {
  const { view, edition, returnTo } = await searchParams
  return <PlansPage initialView={billingStoreView(view, edition)} explicitReturnPath={typeof returnTo === 'string' ? returnTo : undefined} />
}
