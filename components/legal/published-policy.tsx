'use client'

import { useEffect, useState } from 'react'
import { getSession } from '@/lib/studio/api'
import type { PolicyKind } from '@/lib/studio/auth-policy'

export const policyTitle = (kind: PolicyKind) => kind === 'terms' ? '服务条款' : '隐私政策'
type PublishedPolicy = { kind?: PolicyKind; loading: boolean; version: string; content: string; url: string; error: string }
const emptyPolicy: PublishedPolicy = { loading: true, version: '', content: '', url: '', error: '' }

export function usePublishedPolicy(kind: PolicyKind | null) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<PublishedPolicy>(emptyPolicy)
  useEffect(() => {
    if (!kind) return
    let active = true
    setState(emptyPolicy)
    getSession().then(session => {
      if (!active) return
      const site = session.settings?.site ?? {}
      setState({ kind, loading: false, version: String(site[kind === 'terms' ? 'termsVersion' : 'privacyVersion'] ?? ''), content: String(site[kind === 'terms' ? 'termsContent' : 'privacyContent'] ?? ''), url: String(site[kind === 'terms' ? 'termsUrl' : 'privacyUrl'] ?? '/' + kind), error: '' })
    }).catch(reason => { if (active) setState({ ...emptyPolicy, kind, loading: false, error: reason instanceof Error ? reason.message : '政策读取失败' }) })
    return () => { active = false }
  }, [kind, revision])
  return { ...(state.kind === kind ? state : emptyPolicy), retry: () => setRevision(value => value + 1) }
}

export function PublishedPolicyBody({ policy }: { policy: ReturnType<typeof usePublishedPolicy> }) {
  let external = ''
  try { const url = new URL(policy.url); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) external = url.href } catch {}
  if (policy.loading) return <p role="status" className="text-sm text-muted-foreground">正在读取正文…</p>
  if (policy.error) return <div role="alert" className="text-sm leading-7 text-destructive">{policy.error}<button type="button" onClick={policy.retry} className="ml-3 min-h-11 rounded-sm px-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">重新读取</button></div>
  if (policy.content) return <div className="whitespace-pre-wrap text-sm leading-8 sm:text-base">{policy.content}</div>
  if (external) return <p className="text-sm leading-7">请前往 <a className="rounded-sm underline underline-offset-4" href={external} target="_blank" rel="noopener noreferrer">正式政策页面（新窗口）</a> 阅读完整文本。</p>
  return <p className="text-sm text-studio-warn">该政策正文尚未发布。</p>
}
