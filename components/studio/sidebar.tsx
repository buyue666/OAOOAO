'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Suspense } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { cn } from '@/lib/utils'
import { StudioNavLink, studioAdminNav, studioPrimaryNav, studioSecondaryNav, studioSettingsNav } from './studio-nav'

function SidebarContent() {
  const pathname = usePathname()
  const { state, toggleSidebar } = useStudio()
  const collapsed = state.sidebarCollapsed
  const showAdmin = state.backendStatus === 'connected' && state.user.role === 'admin'
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <aside
      aria-label="工作台侧栏"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'studio-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r transition-[width] duration-200 ease-out lg:flex',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center px-3' : 'justify-between px-3')}>
        {!collapsed && (
          <Link
            href="/studio"
            aria-label="返回工作台"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <Image src="/media/brand/oao-mark.png" alt="" width={512} height={512} priority className="size-7 dark:invert" />
          </Link>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!collapsed}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <ToggleIcon className="size-[18px]" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="主导航" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto border-t border-sidebar-border p-2 pt-3">
        {studioPrimaryNav.map((item) => (
          <StudioNavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border p-2">
        <nav aria-label="创作记录与工具" className="mb-1 flex flex-col gap-1 border-b border-sidebar-border pb-2">
          {studioSecondaryNav.map((item) => (
            <StudioNavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          ))}
        </nav>
        {showAdmin && <StudioNavLink item={studioAdminNav} pathname={pathname} collapsed={collapsed} />}
        <StudioNavLink item={studioSettingsNav} pathname={pathname} collapsed={collapsed} />
      </div>
    </aside>
  )
}

export function Sidebar() {
  return (
    <Suspense fallback={null}>
      <SidebarContent />
    </Suspense>
  )
}
