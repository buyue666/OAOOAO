'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import { SiteBrand } from '@/components/site-brand'
import { usePathname } from 'next/navigation'
import { Suspense } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { cn } from '@/lib/utils'
import { StudioNavLink, StudioToolsNav, studioAdminNav, studioPrimaryNav, studioSecondaryNav, studioSettingsNav } from './studio-nav'
import { StorageUsageLink } from './storage-usage'
import { workspaceHref } from '@/lib/studio/workspace-navigation'
import { useWorkspace } from '@/lib/studio/workspace-context'
import { WechatContactButton } from './wechat-contact-button'

function SidebarContent() {
  const tx = useUiText()
  const pathname = usePathname()
  const workspace = useWorkspace()
  const { state, toggleSidebar } = useStudio()
  const collapsed = state.sidebarCollapsed
  const showAdmin = state.backendStatus === 'connected' && state.user.role === 'admin'
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <aside
      aria-label={tx("工作台侧栏")}
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'studio-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r transition-[width] duration-200 ease-out lg:flex',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center px-3' : 'justify-between px-3')}>
        {!collapsed && (
          <Link
            prefetch={false}
            href={workspace.identity ? workspace.href('/studio') : workspaceHref(pathname, '/studio')}
            aria-label={tx("返回工作台")}
            className="flex h-9 w-auto shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <SiteBrand imageClassName="h-6 max-w-[152px]" />
          </Link>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? tx('展开侧边栏') : tx('收起侧边栏')}
          aria-expanded={!collapsed}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <ToggleIcon className="size-[18px]" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label={tx("主导航")} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pt-2">
        {studioPrimaryNav.map((item) => (
          <StudioNavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </nav>

      <div className="mx-3 h-px shrink-0 bg-sidebar-border/60" />

      <div className="flex shrink-0 flex-col gap-1 px-2.5 py-2.5">
        {state.backendStatus==='connected'&&<StorageUsageLink collapsed={collapsed} teamId={workspace.identity?.teamId} />}
        <nav aria-label={tx("创作记录与工具")} className="mb-1 flex flex-col gap-1 pb-1.5">
          {studioSecondaryNav.filter(item => !workspace.identity || item.href !== '/skills').map((item) => (
            <StudioNavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          ))}
          <StudioToolsNav pathname={pathname} collapsed={collapsed} idSuffix="desktop" />
        </nav>
        <div className="mx-1 mb-1 h-px bg-sidebar-border/60" />
        {showAdmin && <StudioNavLink item={studioAdminNav} pathname={pathname} collapsed={collapsed} />}
        <StudioNavLink item={studioSettingsNav} pathname={pathname} collapsed={collapsed} />
        <WechatContactButton config={state.sessionSettings?.site?.wechatContact} collapsed={collapsed} />
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
