'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { SiteBrand } from '@/components/site-brand'
import { ArrowLeft } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { authPolicyLink, authPolicyReturnLabel, authPolicyReturnPath, type PolicyKind } from '@/lib/studio/auth-policy'
import { policyTitle, PublishedPolicyBody, usePublishedPolicy } from './published-policy'

export function PublicPolicyPage({ kind }: { kind: PolicyKind }) {
  const { state: studio } = useStudio()
  const search = useSearchParams()
  const returnPath = authPolicyReturnPath(search.get('returnTo'))
  const policy = usePublishedPolicy(kind)
  const home = studio.backendStatus === 'connected' ? '/studio' : '/'
  const destination = returnPath ?? home
  const returnLabel = returnPath ? authPolicyReturnLabel(returnPath) : home === '/studio' ? '返回创作工作台' : '返回首页'
  const policyPath = (next: PolicyKind) => returnPath ? authPolicyLink(next, '/' + next, returnPath, 'https://policy.invalid').href : '/' + next

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-8 sm:py-12">
      <header className="mx-auto mb-8 flex max-w-3xl flex-wrap items-center justify-between gap-4"><Link href={destination} aria-label={returnLabel}><SiteBrand imageClassName="h-7" /></Link><nav aria-label="法律文件" className="flex gap-5 text-sm">{(['terms', 'privacy'] as const).map(next => <Link key={next} href={policyPath(next)} aria-current={kind === next ? 'page' : undefined} className={'inline-flex min-h-11 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring ' + (kind === next ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{policyTitle(next)}</Link>)}</nav></header>
      <article className="mx-auto min-w-0 max-w-3xl rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm [overflow-wrap:anywhere] sm:p-10">
        <Link href={destination} className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-muted-foreground hover:text-card-foreground focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft className="size-4" />{returnLabel}</Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{policyTitle(kind)}</h1>
        {policy.version && <p className="mt-2 text-sm text-muted-foreground">版本：{policy.version}</p>}
        <div className="mt-8"><PublishedPolicyBody policy={policy} /></div>
      </article>
    </main>
  )
}
