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
  return (home && item.popupHome) || (connected && workspace && item.popupAfterLogin)
}
