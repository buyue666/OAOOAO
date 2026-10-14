'use client'

import { useAnnouncements } from '@/components/site-announcements'
import { SiteAnnouncementBar } from '@/components/site-announcement-bar'
import { announcementKey, homepageAnnouncement } from '@/lib/studio/announcements'
import { useStudio } from '@/lib/studio/store'

export function HomepageAnnouncement({ placement }: { placement: 'landing' | 'workbench' }) {
  const { items, loading, error, open } = useAnnouncements()
  const { state } = useStudio()
  // Do not flash the old settings banner before the managed notices have loaded.
  if (loading || error) return null
  const item = homepageAnnouncement(items)
  if (item) return <SiteAnnouncementBar key={announcementKey(item)} placement={placement} identity={announcementKey(item)} announcement={{ enabled: true, text: item.title, dismissible: true, tone: item.bannerTone, effect: item.bannerEffect, href: item.actionUrl }} description={item.content.replace(/\s+/g, ' ').trim()} endsAt={item.endsAt} onOpen={() => open(item)} />
  return <SiteAnnouncementBar placement={placement} announcement={state.sessionSettings?.site?.announcementBar} />
}
