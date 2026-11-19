'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function SettingsDisclosure({ id, title, summary, children }: { id: string; title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), contentId = useId()
  const storageKey = `oao-settings-section:${id}`
  useEffect(() => {
    try { setOpen(localStorage.getItem(storageKey) === 'open') } catch { /* Folding remains available without storage. */ }
  }, [storageKey])
  const toggle = () => setOpen(current => {
    const next = !current
    try { localStorage.setItem(storageKey, next ? 'open' : 'closed') } catch { /* Preferences are optional. */ }
    return next
  })
  return <section className="studio-surface p-4 sm:p-5" aria-label={title} data-testid={`settings-section-${id}`}>
    <h2><button type="button" onClick={toggle} aria-expanded={open} aria-controls={contentId} className="flex min-h-11 w-full items-center justify-between gap-4 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><span className="text-base font-semibold">{title}</span><span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">{open ? '收起' : '展开'}<ChevronDown aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} /></span></button></h2>
    <p className="mt-1 break-words text-xs leading-6 text-muted-foreground">{summary}</p>
    <div id={contentId} hidden={!open} className="mt-5 border-t border-border pt-5">{children}</div>
  </section>
}
