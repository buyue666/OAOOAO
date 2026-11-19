import { redirect } from 'next/navigation'
import { billingStoreHref } from '@/lib/studio/billing-store-route'

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams
  redirect(billingStoreHref('credits', typeof returnTo === 'string' ? returnTo : undefined))
}
