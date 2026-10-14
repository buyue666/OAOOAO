'use client'

import { useAnnouncements } from '@/components/site-announcements'
import { SiteAnnouncementBar } from '@/components/site-announcement-bar'
import { announcementKey, homepageAnnouncement } from '@/lib/studio/announcements'

export function HomepageAnnouncement({ placement }: { placement: 'landing' | 'workbench' }) {
  const { items, loading, error, open } = useAnnouncements()
  // Homepage banners have one source: published announcements.
  if (loading || error) return null
  const item = homepageAnnouncement(items)
  if (item) return <SiteAnnouncementBar key={announcementKey(item)} placement={placement} identity={announcementKey(item)} announcement={{ enabled: true, text: item.title, dismissible: true, tone: item.bannerTone, effect: item.bannerEffect, href: item.actionUrl }} description={item.content.replace(/\s+/g, ' ').trim()} endsAt={item.endsAt} onOpen={() => open(item)} />
  return null
}
