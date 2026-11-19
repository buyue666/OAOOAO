'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { authPolicyLink, createAuthPolicyNavigation, type PolicyKind } from '@/lib/studio/auth-policy'
import { policyTitle, PublishedPolicyBody, usePublishedPolicy } from './published-policy'

export function useAuthPolicyReader() {
  const [kind, setKind] = useState<PolicyKind | null>(null)
  const navigation = useRef<ReturnType<typeof createAuthPolicyNavigation> | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const controller = createAuthPolicyNavigation(window, setKind)
    navigation.current = controller
    return () => { controller.dispose(); navigation.current = null }
  }, [])
  return {
    kind, returnFocus,
    open(next: PolicyKind, trigger?: HTMLElement) { if (trigger) returnFocus.current = trigger; navigation.current?.open(next) },
    close() { navigation.current?.close() },
  }
}
type Reader = ReturnType<typeof useAuthPolicyReader>
const linkClass = 'rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export function AuthPolicyLink({ kind, configured, returnPath, reader }: { kind: PolicyKind; configured?: unknown; returnPath: string; reader: Reader }) {
  const target = authPolicyLink(kind, configured, returnPath, typeof window === 'undefined' ? 'https://policy.invalid' : window.location.origin)
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!target.inline || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return
    event.preventDefault()
    reader.open(kind, event.currentTarget)
  }
  return <a href={target.href} target="_blank" rel="noopener noreferrer" className={linkClass} onClick={open}>{policyTitle(kind)}</a>
}

export function AuthPolicyReader({ reader, returnLabel }: { reader: Reader; returnLabel: string }) {
  const policy = usePublishedPolicy(reader.kind)
  return <Dialog open={reader.kind !== null} onOpenChange={open => { if (!open) reader.close() }}>
    <DialogContent showCloseButton={false} finalFocus={reader.returnFocus} className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" overlayClassName="bg-black/45">
      <header className="shrink-0 space-y-3 border-b border-border px-5 py-4 sm:px-7">
        <div className="flex items-start justify-between gap-4"><div className="space-y-2"><DialogTitle className="text-lg font-semibold">{policyTitle(reader.kind ?? 'terms')}</DialogTitle><DialogDescription>阅读后可返回继续填写，已填信息会保留。</DialogDescription></div><button type="button" aria-label="关闭条款阅读" className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={reader.close}><X className="size-5" /></button></div>
        <nav aria-label="法律文件" className="flex flex-wrap gap-2">{(['terms', 'privacy'] as const).map(kind => <button type="button" key={kind} aria-pressed={reader.kind === kind} className={'min-h-11 rounded-xl border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ' + (reader.kind === kind ? 'border-foreground/25 bg-muted text-foreground' : 'border-border text-muted-foreground hover:bg-muted')} onClick={() => reader.open(kind)}>{policyTitle(kind)}</button>)}</nav>
      </header>
      <div key={reader.kind} tabIndex={0} aria-label="政策正文" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-ring sm:px-7">
        {policy.version && <p className="mb-5 text-xs text-muted-foreground">版本：{policy.version}</p>}
        <PublishedPolicyBody policy={policy} />
      </div>
      <footer className="flex shrink-0 justify-end border-t border-border px-5 py-4 sm:px-7"><button type="button" onClick={reader.close} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ArrowLeft className="size-4" />{returnLabel}</button></footer>
    </DialogContent>
  </Dialog>
}
