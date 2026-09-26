'use client'

import { ArrowUpRight, Megaphone, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { SiteAnnouncementBar as AnnouncementConfig } from '@/lib/studio/admin-types'
import { cn } from '@/lib/utils'

type AnnouncementPlacement = 'landing' | 'workbench'

/**
 * 站点级顶部通知。
 *
 * 配置来自公开会话里的 `settings.site.announcementBar`，因此访客不需要登录
 * 也能看到最新文案。关闭状态按「文案 + 链接」生成浏览器本地键，管理员换文案
 * 后会自然重新出现；不会把用户的关闭操作写回服务端。
 */
export function SiteAnnouncementBar({
  announcement,
  placement = 'workbench',
}: {
  announcement?: AnnouncementConfig
  placement?: AnnouncementPlacement
}) {
  const text = String(announcement?.text ?? '').trim()
  const href = String(announcement?.href ?? '').trim()
  const enabled = announcement?.enabled === true && Boolean(text)
  const dismissible = announcement?.dismissible !== false
  const tone = announcement?.tone === 'info' || announcement?.tone === 'warning' ? announcement.tone : 'promo'
  const storageKey = useMemo(() => {
    if (!text) return ''
    return `oaooao-announcement-dismissed:${text}:${href}`
  }, [href, text])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!enabled || !dismissible || !storageKey) {
      setDismissed(false)
      return
    }
    try {
      setDismissed(window.localStorage.getItem(storageKey) === '1')
    } catch {
      setDismissed(false)
    }
  }, [dismissible, enabled, storageKey])

  if (!enabled || dismissed) return null

  function close() {
    if (!dismissible) return
    setDismissed(true)
    try { window.localStorage.setItem(storageKey, '1') } catch { /* 浏览器禁用存储时仍允许本次关闭 */ }
  }

  const content = (
    <span className="oao-announcement-content">
      <Megaphone className="oao-announcement-icon" aria-hidden="true" />
      <span className="oao-announcement-text">{text}</span>
      {href && <ArrowUpRight className="oao-announcement-arrow" aria-hidden="true" />}
    </span>
  )

  return (
    <aside
      className={cn('oao-announcement-bar', `oao-announcement-${tone}`)}
      data-placement={placement}
      data-dismissible={dismissible ? 'true' : 'false'}
      role="status"
      aria-label="站点通知"
    >
      <div className="oao-announcement-inner">
        {href ? <a href={href} className="oao-announcement-link" target={/^https?:\/\//i.test(href) ? '_blank' : undefined} rel={/^https?:\/\//i.test(href) ? 'noreferrer' : undefined}>{content}</a> : content}
        {dismissible && <button type="button" className="oao-announcement-close" onClick={close} aria-label="关闭通知"><X aria-hidden="true" /></button>}
      </div>
    </aside>
  )
}
