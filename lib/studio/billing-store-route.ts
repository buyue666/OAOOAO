import { safeReturnPath } from './return-path'

export type BillingStoreView = 'personal' | 'team' | 'credits'

export function billingStoreView(view?: string | null, edition?: string | null): BillingStoreView {
  return view === 'credits' ? 'credits' : edition === 'team' ? 'team' : 'personal'
}

export function billingStoreHref(view: BillingStoreView, returnTo?: string) {
  const query = new URLSearchParams()
  if (view === 'credits') query.set('view', 'credits')
  if (view === 'team') query.set('edition', 'team')
  if (returnTo) {
    const destination = safeReturnPath(returnTo)
    if (destination !== '/studio') query.set('returnTo', destination)
  }
  return query.size ? `/plans?${query}` : '/plans'
}
