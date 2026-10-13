'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { X } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { StudioNavLink, studioAdminNav, studioPrimaryNav, studioSecondaryNav, studioSettingsNav } from './studio-nav'

function MobileNavContent({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { state } = useStudio()
  const showAdmin = state.backendStatus === 'connected' && state.user.role === 'admin'

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div
      className="studio-mobile-nav motion-fade fixed inset-0 z-50 bg-studio-ink/50 lg:hidden"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}
    >
      <aside role="dialog" aria-modal="true" aria-label="工作台导航" className="motion-drawer-left flex h-full w-64 max-w-[85vw] flex-col border-r border-sidebar-border">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
          <Link href="/studio" onClick={onClose} aria-label="返回工作台" className="flex h-9 w-auto shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
            <Image src="/media/brand/oao-logo-transparent.png" alt="OAO" width={1221} height={292} className="h-6 w-auto object-contain dark:invert" />
          </Link>
          <button type="button" onClick={onClose} aria-label="关闭导航" className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="移动端主导航" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {studioPrimaryNav.map((item) => (
            <StudioNavLink key={item.href} item={item} pathname={pathname} onNavigate={onClose} />
          ))}
        </nav>

        <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border p-2">
          <nav aria-label="创作记录与工具" className="mb-1 flex flex-col gap-1 border-b border-sidebar-border pb-2">
            {studioSecondaryNav.map((item) => (
              <StudioNavLink key={item.href} item={item} pathname={pathname} onNavigate={onClose} />
            ))}
          </nav>
          {showAdmin && <StudioNavLink item={studioAdminNav} pathname={pathname} onNavigate={onClose} />}
          <StudioNavLink item={studioSettingsNav} pathname={pathname} onNavigate={onClose} />
        </div>
      </aside>
    </div>
  )
}

export function MobileNav(props: { open: boolean; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <MobileNavContent {...props} />
    </Suspense>
  )
}
