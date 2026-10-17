'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { downloadMedia, type DeliverableMedia } from '@/lib/studio/result-delivery'
import { useStudio } from '@/lib/studio/store'

type Props = { media: DeliverableMedia; title: string; prompt?: string; taskId?: string; label?: string; iconOnly?: boolean; className?: string; disabled?: boolean }

export function MediaDownloadButton(props: Props) {
  const { state } = useStudio()
  const accountId = state.backendStatus === 'connected' ? state.user.id : ''
  return <ScopedMediaDownloadButton key={`${accountId}:${props.media.url}`} {...props} accountId={accountId} />
}

function ScopedMediaDownloadButton({ media, title, prompt, taskId, accountId, label = '下载', iconOnly = false, className, disabled }: Props & { accountId: string }) {
  const lock = useRef(false)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  async function download() {
    if (lock.current || !accountId || disabled) return
    lock.current = true; setBusy(true); setError(''); setSuccess(false)
    controller.current = new AbortController()
    try {
      const result = await downloadMedia(media, title, { accountId, signal: controller.current.signal, taskId, prompt })
      if (mounted.current) { if (!result.ok) setError(result.message); else setSuccess(true) }
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  return <span className="inline-flex max-w-full flex-col items-start gap-1"><button type="button" disabled={busy || disabled || !accountId} aria-label={busy ? `正在导出${title}` : `${label}${iconOnly ? title : ''}`} onClick={() => void download()} title={busy ? '正在处理导出…' : label} className={className}>{busy ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}{!iconOnly && <span>{busy ? '正在导出…' : label}</span>}</button>{error && <span role="alert" className="max-w-64 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</span>}{success && <span role="status" className="sr-only">已开始下载 {title}</span>}</span>
}
