'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Megaphone, RefreshCw } from 'lucide-react'
import { request } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import type { Announcement } from '@/lib/studio/admin-types'
import { activeAnnouncements, announcementKey, popupEligible } from '@/lib/studio/announcements'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const Context = createContext({ items: [] as Announcement[], unread: 0, loading: true, error: '', refresh: () => {}, open: (_item: Announcement) => {} })
export const useAnnouncements = () => useContext(Context)

export function SiteAnnouncements({ children }: { children: React.ReactNode }) {
  const { state } = useStudio()
  const pathname = usePathname()
  const connected = state.backendStatus === 'connected'
  const scope = connected ? state.user.id : 'visitor'
  const [items, setItems] = useState<Announcement[]>([])
  const [now, setNow] = useState(Date.now)
  const visibleItems = useMemo(() => activeAnnouncements(items, now), [items, now])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Announcement | null>(null)
  const [seen, setSeen] = useState<string[]>([])
  const [read, setRead] = useState<string[]>([])
  const [readyScope, setReadyScope] = useState('')
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    const readKeys = (key: string) => { try { const value = JSON.parse(sessionStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [] } catch { return [] } }
    setSelected(null)
    setSeen(readKeys(`oao-announcements:seen:${scope}`))
    setRead(readKeys(`oao-announcements:read:${scope}`))
    setReadyScope(scope)
  }, [scope])

  useEffect(() => {
    let active = true
    let latestRequest = 0
    const load = async () => {
      const ticket = ++latestRequest
      try {
        const result = await request<{ announcements: Announcement[] }>('/api/announcements')
        if (active && ticket === latestRequest) { setItems(result.announcements || []); setNow(Date.now()); setError('') }
      } catch { if (active && ticket === latestRequest) setError('公告暂时无法读取，请重试。') }
      finally { if (active && ticket === latestRequest) setLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30000)
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [revision])

  useEffect(() => {
    const deadlines = items.flatMap(item => [Date.parse(item.startsAt || ''), Date.parse(item.endsAt || '')]).filter(time => time > Date.now())
    const delay = deadlines.length ? Math.min(60000, Math.max(1, Math.min(...deadlines) - Date.now() + 10)) : 60000
    const timer = window.setTimeout(() => setNow(Date.now()), delay)
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [items, now])

  const mark = useCallback((item: Announcement) => {
    const key = announcementKey(item)
    setSeen(current => { const next = Array.from(new Set([...current, key])).slice(-500); try { sessionStorage.setItem(`oao-announcements:seen:${scope}`, JSON.stringify(next)) } catch {} return next })
    setRead(current => { const next = Array.from(new Set([...current, key])).slice(-500); try { sessionStorage.setItem(`oao-announcements:read:${scope}`, JSON.stringify(next)) } catch {} return next })
  }, [scope])
  const open = useCallback((item: Announcement) => { mark(item); setSelected(item) }, [mark])

  useEffect(() => { setSelected(null) }, [pathname])
  useEffect(() => {
    if (!state.hydrated || state.backendStatus === 'checking' || readyScope !== scope || selected || error) return
    const next = visibleItems.find(item => popupEligible(item, pathname, connected) && !seen.includes(announcementKey(item)))
    if (next) open(next)
  }, [visibleItems, pathname, connected, seen, selected, open, state.hydrated, state.backendStatus, readyScope, scope, error])
  // A withdrawn or expired notice must disappear even if its dialog was open.
  useEffect(() => { if (selected && !visibleItems.some(item => announcementKey(item) === announcementKey(selected))) setSelected(null) }, [visibleItems, selected])
  const value = useMemo(() => ({ items: visibleItems, unread: visibleItems.filter(item => !read.includes(announcementKey(item))).length, loading, error, refresh, open }), [visibleItems, read, loading, error, refresh, open])

  return <Context.Provider value={value}>{children}<Dialog open={!!selected} onOpenChange={value => { if (!value) setSelected(null) }}><DialogContent className="max-h-[85dvh] overflow-y-auto p-6 sm:max-w-lg"><DialogHeader><div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-studio-accent/10 text-studio-accent"><Megaphone className="size-6" /></div><DialogTitle className="pr-5 text-xl leading-7">{selected?.title}</DialogTitle><DialogDescription>站点公告</DialogDescription></DialogHeader><div className="whitespace-pre-wrap break-words text-sm leading-7">{selected?.content}</div><button type="button" onClick={() => setSelected(null)} className="mt-2 rounded-xl bg-foreground px-4 py-2.5 font-medium text-background">知道了</button></DialogContent></Dialog></Context.Provider>
}

export function AnnouncementList() {
  const { items, loading, error, refresh, open } = useAnnouncements()
  return <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">{loading ? <p role="status" className="text-xs text-muted-foreground">正在读取公告…</p> : error ? <p role="alert" className="text-xs text-destructive">{error}<button onClick={refresh} className="ml-2 inline-flex items-center gap-1 underline"><RefreshCw className="size-3" />重试</button></p> : items.length ? items.map(item => <button key={announcementKey(item)} onClick={() => open(item)} className="block w-full rounded-lg border border-border p-3 text-left hover:bg-muted"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.content}</span></button>) : <p className="text-xs text-muted-foreground">暂无生效中的公告。</p>}</div>
}
