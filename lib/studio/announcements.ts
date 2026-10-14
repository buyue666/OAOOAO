import type { Announcement } from './admin-types'

export function activeAnnouncements(items: Announcement[], now = Date.now()) {
  return items.filter(item => item.enabled && (!item.startsAt || Date.parse(item.startsAt) <= now) && (!item.endsAt || Date.parse(item.endsAt) > now))
}

export function announcementKey(item: Announcement) {
  return `${item.id}:${item.updatedAt || item.createdAt}`
}

export function popupEligible(item: Announcement, pathname: string, connected: boolean) {
  const home = pathname === '/' || (pathname === '/studio' && connected)
  const workspace = /^\/(studio|image|video|agent|canvas|projects|drama|assets|works|tasks|skills|account|settings)(\/|$)/.test(pathname)
  return !home && connected && workspace && item.popupAfterLogin
}

/** Keep the existing API field; homepage notices now use a banner, never an automatic modal. */
export function homepageAnnouncement(items: Announcement[], now = Date.now()) {
  return activeAnnouncements(items, now)
    .filter(item => item.popupHome)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt) || a.id.localeCompare(b.id))[0]
}

export function safeAnnouncementHref(value?: string) {
  const raw = String(value || '')
  const href = raw.trim()
  if (!href || href.length > 2048 || /[\\\u0000-\u001f\u007f-\u009f]/.test(raw)) return ''
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (!/^https?:\/\/[^/\s]/i.test(href) || /^https?:\/\/[^/?#]*@/i.test(href)) return ''
  try {
    const url = new URL(href)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : ''
  } catch { return '' }
}
