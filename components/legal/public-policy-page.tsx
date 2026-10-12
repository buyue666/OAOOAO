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
    <main className="min-h-dvh bg-black px-5 py-12 text-zinc-100 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 sm:p-10">
        <Link href="/" className="text-xs text-white/55 hover:text-white">返回首页</Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{state.title}</h1>
        {state.version && <p className="mt-2 text-xs text-white/45">版本：{state.version}</p>}
        {state.loading ? <p className="mt-8 text-sm text-white/60">正在读取正文…</p> : state.error ? <p role="alert" className="mt-8 text-sm text-red-200">{state.error}</p> : state.content ? <div className="mt-8 whitespace-pre-wrap text-sm leading-8 text-white/80">{state.content}</div> : state.url && state.url !== `/${kind}` ? <p className="mt-8 text-sm text-white/70">请前往 <a className="underline" href={state.url} rel="noreferrer">{state.url}</a> 阅读正式文本。</p> : <p className="mt-8 text-sm text-amber-100/80">该政策正文尚未发布。</p>}
      </article>
    </main>
  )
}
