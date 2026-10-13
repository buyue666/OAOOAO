'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getSession } from '@/lib/studio/api'

type Kind = 'terms' | 'privacy'

export function PublicPolicyPage({ kind }: { kind: Kind }) {
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
  }, [kind])

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-8 sm:py-12">
      <article className="mx-auto min-w-0 max-w-3xl rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm [overflow-wrap:anywhere] sm:p-10">
        <Link href="/" className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card">返回首页</Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{state.title}</h1>
        {state.version && <p className="mt-2 text-sm text-muted-foreground">版本：{state.version}</p>}
        {state.loading ? <p role="status" className="mt-8 text-sm text-muted-foreground">正在读取正文…</p> : state.error ? <p role="alert" className="mt-8 text-sm text-destructive">{state.error}</p> : state.content ? <div className="mt-8 whitespace-pre-wrap text-sm leading-8 text-card-foreground sm:text-base">{state.content}</div> : state.url && state.url !== `/${kind}` ? <p className="mt-8 text-sm leading-7 text-card-foreground">请前往 <a className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card" href={state.url} rel="noreferrer">{state.url}</a> 阅读正式文本。</p> : <p className="mt-8 text-sm text-studio-warn">该政策正文尚未发布。</p>}
      </article>
    </main>
  )
}
