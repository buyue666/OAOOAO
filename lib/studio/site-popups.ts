export type SitePopup = {
  id: string
  title: string
  content: string
  imageUrl?: string
  actionUrl?: string
  buttonText: string
  enabled: boolean
  pages: ('home' | 'studio')[]
  frequency: 'session' | 'daily'
  startsAt?: string
  endsAt?: string
  createdAt?: string
  updatedAt?: string
}
export type SitePopupInput = Omit<SitePopup, 'id' | 'createdAt' | 'updatedAt' | 'imageUrl' | 'actionUrl' | 'startsAt' | 'endsAt'> & {
  imageUrl?: string | null
  actionUrl?: string | null
  startsAt?: string | null
  endsAt?: string | null
}

/** Public promotional images never use authenticated reference-asset endpoints. */
export function safePopupImageUrl(value?: string | null): string {
  if (!value || /[\\\u0000-\u001f\u007f-\u009f]/u.test(value)) return ''
  const target = value.trim()
  if (!target || target.length > 2048) return ''
  const local = target.startsWith('/')
  if (local ? !target.startsWith('/media/') : !/^https:\/\/[^/\s]/i.test(target)) return ''
  try {
    const url = new URL(target, 'https://popup.invalid')
    const path = decodeURIComponent(url.pathname)
    if (url.username || url.password || /^https:\/\/[^/?#]*@/i.test(target) || (!local && url.href.length > 2048)) return ''
    if (/[\\\u0000-\u001f\u007f-\u009f]/u.test(path) || /\.svgz?(?:$|\/)/i.test(path)) return ''
    if (local && (!url.pathname.startsWith('/media/') || !path.startsWith('/media/') || path.split('/').some(part => part === '.' || part === '..'))) return ''
    return target
  } catch { return '' }
}

export function popupPage(pathname: string): 'home' | 'studio' | null {
  return pathname === '/' ? 'home' : pathname === '/studio' ? 'studio' : null
}
export function popupRevision(popup: SitePopup) { return `${popup.id}:${popup.updatedAt || popup.createdAt || 'initial'}` }
export function popupDay(now: number) {
  const date = new Date(now)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
export function activeSitePopups(items: SitePopup[], pathname: string, now: number) {
  const page = popupPage(pathname)
  if (!page) return []
  return items.filter(item => item.enabled && Array.isArray(item.pages) && item.pages.includes(page)
    && (!item.startsAt || Date.parse(item.startsAt) <= now)
    && (!item.endsAt || Date.parse(item.endsAt) > now))
    .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0) || b.id.localeCompare(a.id))
}
export function popupSeenKey(popup: SitePopup, now: number) {
  return `${popupRevision(popup)}:${popup.frequency === 'daily' ? popupDay(now) : 'session'}`
}
