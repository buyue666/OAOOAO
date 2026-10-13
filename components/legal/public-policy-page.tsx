'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getSession } from '@/lib/studio/api'
import { SiteBrand } from '@/components/site-brand'
import { ArrowLeft } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'

type Kind = 'terms' | 'privacy'

export function PublicPolicyPage({ kind }: { kind: Kind }) {
  const { state: studio } = useStudio()
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ loading: boolean; title: string; version: string; content: string; url: string; error: string }>({ loading: true, title: kind === 'terms' ? '服务条款' : '隐私政策', version: '', content: '', url: `/${kind}`, error: '' })

  useEffect(() => {
    let active = true
    getSession().then((session) => {
      if (!active) return
      const site = session.settings?.site ?? {}
      const isTerms = kind === 'terms'
      setState({ loading: false, title: isTerms ? '服务条款' : '隐私政策', version: String(site[isTerms ? 'termsVersion' : 'privacyVersion'] ?? ''), content: String(site[isTerms ? 'termsContent' : 'privacyContent'] ?? ''), url: String(site[isTerms ? 'termsUrl' : 'privacyUrl'] ?? `/${kind}`), error: '' })
    }).catch((reason) => { if (active) setState((current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : '政策读取失败' })) })
    return () => { active = false }
  }, [kind, revision])

  const externalPolicy = /^https?:\/\//i.test(state.url) ? state.url : ''
  const home = studio.backendStatus === 'connected' ? '/studio' : '/'

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-8 sm:py-12">
      <header className="mx-auto mb-8 flex max-w-3xl flex-wrap items-center justify-between gap-4"><Link href={home} aria-label="返回首页"><SiteBrand imageClassName="h-7" /></Link><nav aria-label="法律文件" className="flex gap-5 text-sm"><Link href="/terms" aria-current={kind === 'terms' ? 'page' : undefined} className={kind === 'terms' ? 'font-semibold text-foreground' : 'text-muted-foreground'}>服务条款</Link><Link href="/privacy" aria-current={kind === 'privacy' ? 'page' : undefined} className={kind === 'privacy' ? 'font-semibold text-foreground' : 'text-muted-foreground'}>隐私政策</Link></nav></header>
      <article className="mx-auto min-w-0 max-w-3xl rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm [overflow-wrap:anywhere] sm:p-10">
        <Link href={home} className="inline-flex items-center gap-2 rounded-sm text-sm text-muted-foreground hover:text-card-foreground"><ArrowLeft className="size-4" />{home === '/studio' ? '返回创作工作台' : '返回首页'}</Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{state.title}</h1>
        {state.version && <p className="mt-2 text-sm text-muted-foreground">版本：{state.version}</p>}
        {state.loading ? <p role="status" className="mt-8 text-sm text-muted-foreground">正在读取正文…</p> : state.error ? <div role="alert" className="mt-8 text-sm text-destructive">{state.error}<button onClick={() => { setState(current => ({ ...current, loading: true, error: '' })); setRevision(value => value + 1) }} className="ml-3 underline underline-offset-4">重新读取</button></div> : state.content ? <div className="mt-8 whitespace-pre-wrap text-sm leading-8 text-card-foreground sm:text-base">{state.content}</div> : externalPolicy ? <p className="mt-8 text-sm leading-7 text-card-foreground">请前往 <a className="rounded-sm underline underline-offset-4" href={externalPolicy} rel="noreferrer">正式政策页面</a> 阅读完整文本。</p> : <p className="mt-8 text-sm text-studio-warn">该政策正文尚未发布。</p>}
      </article>
    </main>
  )
}
