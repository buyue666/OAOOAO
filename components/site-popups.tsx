'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { request } from '@/lib/studio/api'
import { activeSitePopups, popupPage, popupRevision, popupSeenKey, type SitePopup } from '@/lib/studio/site-popups'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SitePopupCard } from '@/components/site-popup-card'

const STORAGE_PREFIX = 'oao:site-popup:v1:'
const BLOCKING_DIALOG_SELECTOR = '[role="dialog"]:not(dialog):not([data-site-popup-dialog]):not([data-closed]):not([hidden]):not([aria-hidden="true"]),dialog[open]:not([data-site-popup-dialog])'

/** Independent public campaign placement. Never auto-opens in the canvas, checkout or legal pages. */
export function SitePopups() {
  const pathname = usePathname()
  const page = popupPage(pathname)
  const [items, setItems] = useState<SitePopup[]>([])
  const [loadedPage, setLoadedPage] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const [selected, setSelected] = useState<SitePopup | null>(null)
  const [pageVisible, setPageVisible] = useState(false)
  const [otherDialogOpen, setOtherDialogOpen] = useState(false)
  const remembered = useRef(new Set<string>())

  useEffect(() => {
    setSelected(null)
    setLoadedPage(null)
    setItems([])
    if (!page) return
    let active = true, ticket = 0
    async function load() {
      const current = ++ticket
      try {
        const result = await request<{ popups: SitePopup[] }>('/api/site-popups?pageSize=100')
        if (active && current === ticket) { setItems(Array.isArray(result.popups) ? result.popups : []); setNow(Date.now()); setLoadedPage(page) }
      } catch { if (active && current === ticket) { setItems([]); setSelected(null) } }
    }
    void load()
    const refresh = () => {
      const visible = document.visibilityState === 'visible'
      setPageVisible(visible)
      setNow(Date.now())
      if (visible) void load()
    }
    setPageVisible(document.visibilityState === 'visible')
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [page])

  useEffect(() => {
    if (!page) return
    const update = () => setOtherDialogOpen(!!document.querySelector(BLOCKING_DIALOG_SELECTOR))
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'open', 'hidden', 'aria-hidden', 'data-open', 'data-closed'] })
    return () => observer.disconnect()
  }, [page])

  useEffect(() => {
    if (!page) return
    const deadlines = items.flatMap(item => [Date.parse(item.startsAt || ''), Date.parse(item.endsAt || '')]).filter(value => value > Date.now())
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(30000, deadlines.length ? Math.max(1, Math.min(...deadlines) - Date.now() + 5) : 30000))
    return () => clearTimeout(timer)
  }, [items, now, page])

  useEffect(() => {
    if (!page || loadedPage !== page) return
    const visible = activeSitePopups(items, pathname, now)
    if (selected) {
      if (otherDialogOpen || !visible.some(item => popupRevision(item) === popupRevision(selected))) setSelected(null)
      return
    }
    // One campaign wins a placement; closing it must not unleash a queue of older campaigns.
    const candidate = visible[0]
    if (!candidate || !pageVisible || document.visibilityState !== 'visible' || otherDialogOpen || document.querySelector(BLOCKING_DIALOG_SELECTOR)) return
    const key = popupSeenKey(candidate, now)
    if (remembered.current.has(key)) return
    try {
      const storage = candidate.frequency === 'daily' ? localStorage : sessionStorage
      if (storage.getItem(STORAGE_PREFIX + key)) { remembered.current.add(key); return }
      storage.setItem(STORAGE_PREFIX + key, '1')
    } catch { /* In-memory deduplication also supports blocked browser storage. */ }
    remembered.current.add(key)
    setSelected(candidate)
  }, [items, loadedPage, now, page, pathname, selected, pageVisible, otherDialogOpen])

  const open = !!selected && pageVisible && !otherDialogOpen && page === loadedPage && activeSitePopups([selected], pathname, now).length > 0
  return <Dialog open={open} onOpenChange={open => { if (!open) setSelected(null) }}>
    <DialogContent data-site-popup-dialog showCloseButton={false} className="max-h-[85dvh] overflow-y-auto rounded-3xl p-0 sm:max-w-2xl motion-reduce:animate-none">
      <DialogTitle className="sr-only">{selected?.title || '活动通知'}</DialogTitle>
      <DialogDescription className="sr-only">站点推广活动，可关闭后继续浏览。</DialogDescription>
      {selected && <SitePopupCard popup={selected} onAction={() => setSelected(null)} />}
      <DialogClose aria-label="关闭推广弹窗" className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" aria-hidden="true" /></DialogClose>
    </DialogContent>
  </Dialog>
}
