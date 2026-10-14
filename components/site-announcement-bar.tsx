'use client'

import { ArrowUpRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AnnouncementCountdown } from '@/components/announcement-countdown'
import type { SiteAnnouncementBar as AnnouncementConfig } from '@/lib/studio/admin-types'
import { safeAnnouncementHref } from '@/lib/studio/announcements'
import { normalizeAnnouncementEffect, normalizeAnnouncementTone } from '@/lib/studio/announcement-appearance'
import { cn } from '@/lib/utils'

/** One homepage strip; dismissal belongs to this notice revision, independently of dialog read state. */
export function SiteAnnouncementBar({ announcement, placement = 'workbench', description, endsAt, identity, onOpen, preview = false }: {
  announcement?: AnnouncementConfig
  placement?: 'landing' | 'workbench'
  description?: string
  endsAt?: string
  identity?: string
  onOpen?: () => void
  preview?: boolean
}) {
  const text = String(announcement?.text ?? '').trim()
  const href = safeAnnouncementHref(announcement?.href)
  const enabled = announcement?.enabled === true && Boolean(text)
  const dismissible = announcement?.dismissible !== false
  const tone = normalizeAnnouncementTone(announcement?.tone)
  const effect = normalizeAnnouncementEffect(announcement?.effect)
  const storageKey = `oaooao-home-banner:v1:${identity || `${text}:${href}:${tone}:${effect}`}`
  const [dismissal, setDismissal] = useState({ key: '', closed: false })

  useEffect(() => {
    if (preview) return
    const restore = () => {
      let closed = false
      try { closed = window.localStorage.getItem(storageKey) === '1' } catch { /* Storage is optional. */ }
      setDismissal({ key: storageKey, closed })
    }
    restore()
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) restore() }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [storageKey, preview])

  if (!enabled || (!preview && dismissible && (dismissal.key !== storageKey || dismissal.closed))) return null

  function close() {
    setDismissal({ key: storageKey, closed: true })
    try { window.localStorage.setItem(storageKey, '1') } catch { /* Allow closing with storage disabled. */ }
  }

  return (
    <aside className={cn('oao-announcement-bar', `oao-announcement-${tone}`)} data-placement={placement} data-effect={effect} data-preview={preview ? 'true' : undefined} aria-label={preview ? '公告效果预览' : '首页公告'}>
      <div className="oao-announcement-inner">
        <AnnouncementCountdown endsAt={endsAt} />
        <span className="oao-announcement-badge"><span aria-hidden="true" />最新公告</span>
        <div className="oao-announcement-copy">
          <p className="oao-announcement-title">{text}</p>
          {description && <p className="oao-announcement-description">{description}</p>}
        </div>
        {preview ? (onOpen || href ? <button type="button" disabled className="oao-announcement-action">{onOpen ? '查看详情' : '了解更多'}<ArrowUpRight aria-hidden="true" /></button> : null)
          : onOpen ? <button type="button" className="oao-announcement-action" onClick={onOpen}>查看详情<ArrowUpRight aria-hidden="true" /></button>
          : href ? <a href={href} className="oao-announcement-action" target={/^https?:\/\//i.test(href) ? '_blank' : undefined} rel={/^https?:\/\//i.test(href) ? 'noopener noreferrer' : undefined}>了解更多<ArrowUpRight aria-hidden="true" /></a> : null}
        {dismissible && <button type="button" disabled={preview} className="oao-announcement-close" onClick={close} aria-label="关闭首页公告"><X aria-hidden="true" /></button>}
      </div>
    </aside>
  )
}
