'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { STUDIO_TOUR_EVENT, studioTourKey } from '@/lib/studio/studio-tour'

const StudioTour = dynamic(() => import('./studio-tour'), { ssr: false })

export function StudioTourLauncher({ account, pathname, home }: { account: string; pathname: string; home: boolean }) {
  const [active, setActive] = useState(false)
  const kind = pathname === '/tools/tryon' ? 'tryon' : 'studio'
  useEffect(() => { setActive(false) }, [account, pathname])
  useEffect(() => {
    const open = () => setActive(true)
    window.addEventListener(STUDIO_TOUR_EVENT, open)
    if (!home) return () => window.removeEventListener(STUDIO_TOUR_EVENT, open)
    let attempts = 0
    const timer = setInterval(() => {
      try { if (localStorage.getItem(studioTourKey(account, 'studio'))) { clearInterval(timer); return } } catch { clearInterval(timer); return }
      const blocking = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(node => node.getClientRects().length)
      if (!blocking) { clearInterval(timer); setActive(true) }
      else if (++attempts >= 60) clearInterval(timer)
    }, 1200)
    return () => { clearInterval(timer); window.removeEventListener(STUDIO_TOUR_EVENT, open) }
  }, [account, pathname, home])
  function close() {
    try { localStorage.setItem(studioTourKey(account, kind), 'done') } catch { /* Closing always works in storage-restricted browsers. */ }
    setActive(false)
  }
  return active ? <StudioTour key={`${account}-${pathname}`} kind={kind} onClose={close} /> : null
}
