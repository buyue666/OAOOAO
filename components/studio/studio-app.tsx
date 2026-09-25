'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useStudio } from '@/lib/studio/store'
import { MobileNav } from './mobile-nav'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { cn } from '@/lib/utils'

export function StudioApp({ children }: { children: React.ReactNode }) {
  const { state } = useStudio()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const pathname = usePathname()

  const isLanding = pathname === '/'
  const isHome = pathname === '/studio'
  const isAuthPage = pathname === '/login' || pathname === '/plans'
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/')
  const isWorkspace = pathname === '/image' || pathname === '/video'
  const isGradientSkin = state.skin === 'gradient'

  if (isLanding || isAuthPage) return <div className="min-h-dvh bg-background text-foreground">{children}</div>
  if (isAdmin) return <div className="min-h-dvh bg-background text-foreground">{children}</div>

  return (
    <div
      data-studio-route={isHome ? 'home' : isWorkspace ? 'workspace' : 'inner'}
      data-studio-skin={state.skin}
      className={cn(
        'studio-app-shell min-h-dvh bg-background text-foreground',
        !isHome && !isGradientSkin && 'studio-minimal-shell',
        isGradientSkin && 'studio-gradient-shell',
      )}
    >
      <Sidebar />
      <div className={cn('min-h-dvh transition-[padding] duration-200 ease-out', state.sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-54')}>
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-h-[calc(100dvh-60px)]">
          {/* 路由切换时内容轻微淡入并上移 8px，不产生累计布局偏移 */}
          <div key={pathname} className="motion-page">{children}</div>
        </main>
      </div>
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div data-studio-portal-root />
    </div>
  )
}
