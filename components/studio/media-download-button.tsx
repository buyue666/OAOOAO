'use client'

import { useUiText } from '@/lib/studio/i18n'
import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { downloadMedia, type DeliverableMedia } from '@/lib/studio/result-delivery'
import { useStudio } from '@/lib/studio/store'
import { useTeamMedia } from '@/lib/studio/team-media-context'

type Props = { media: DeliverableMedia; title: string; prompt?: string; taskId?: string; label?: string; iconOnly?: boolean; className?: string; disabled?: boolean }

export function MediaDownloadButton(props: Props) {
  const { state } = useStudio()
  const team = useTeamMedia()
  const tx = useUiText()
  if (team) {
    const label = tx(props.label ?? '下载')
    const content = <><Download className="size-3.5" aria-hidden="true" />{!props.iconOnly && <span>{label}</span>}</>
    const url = props.media.url
    if (!props.disabled && team.team.canDownload && url.startsWith(`/api/teams/${team.team.id}/assets/`) && /^[a-f0-9-]{36}\/content$/i.test(url.split('/assets/')[1] || '')) return <a href={`${url}?download=1`} aria-label={props.iconOnly ? `${label}${props.title}` : undefined} className={props.className}>{content}</a>
    return <button type="button" disabled aria-label={props.iconOnly ? `${label}${props.title}` : undefined} className={props.className}>{content}</button>
  }
  const accountId = state.backendStatus === 'connected' ? state.user.id : ''
  return <ScopedMediaDownloadButton key={`${accountId}:${props.media.url}`} {...props} accountId={accountId} />
}

function ScopedMediaDownloadButton({ media, title, prompt, taskId, accountId, label = '下载', iconOnly = false, className, disabled }: Props & { accountId: string }) {
  const tx = useUiText()
  const lock = useRef(false)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [direct, setDirect] = useState<{ url: string; expiresAt?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  async function download() {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); setError(''); setSuccess(false)
    controller.current = new AbortController()
    try {
      const result = await downloadMedia(media, title, { accountId, signal: controller.current.signal, taskId, prompt })
      if (mounted.current) { if (!result.ok) setError(result.message); else { setSuccess(true); setDirect(result.directUrl ? { url: result.directUrl, expiresAt: result.expiresAt } : null); setCopied(false) } }
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const directAvailable = direct && (!direct.expiresAt || Date.parse(direct.expiresAt) > Date.now())
  return <span className="inline-flex max-w-full flex-col items-start gap-1"><button type="button" disabled={busy || Boolean(disabled)} aria-label={busy ? tx("正在导出{0}", [title]) : `${tx(label)}${iconOnly ? title : ''}`} onClick={() => void download()} title={busy ? tx('正在准备下载…') : tx(label)} className={className}>{busy ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}{!iconOnly && <span>{busy ? tx('正在准备…') : tx(label)}</span>}</button>{error && <span role="alert" className="max-w-64 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</span>}{directAvailable && <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"><a href={direct.url} referrerPolicy="no-referrer" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{tx('直接下载')}</a><button type="button" className="underline underline-offset-2 hover:text-foreground" title={tx('链接 1 小时内有效，持有链接即可下载')} onClick={async () => { try { await navigator.clipboard.writeText(direct.url); if (mounted.current) setCopied(true) } catch { if (mounted.current) setError(tx('无法复制链接，请右键直接下载链接进行复制')) } }}>{tx(copied ? '已复制' : '复制下载链接')}</button></span>}{success && <span role="status" className="sr-only">{tx("已发起下载 ")}{title}</span>}</span>
}
