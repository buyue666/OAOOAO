'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FolderKanban,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  LayoutDashboard,
  ListChecks,
  Palette,
  PanelsTopLeft,
  Settings,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { Tooltip } from './ui'
import { cn } from '@/lib/utils'

interface StudioNavItem {
  label: string
  href: string
  icon: LucideIcon
  exact?: boolean
}

interface StudioNavGroup {
  label: string
  items: StudioNavItem[]
}

const studioNavGroups: StudioNavGroup[] = [
  {
    label: '创作',
    items: [
      { label: '导演 Agent', href: '/agent', icon: Bot },
      { label: '图片生成', href: '/image', icon: ImageIcon },
      { label: '视频生成', href: '/video', icon: Video },
      /**
       * 短剧与画布都指向**列表/入口页**，由那里解析当前用户的真实项目。
       * 早先写死 `/projects/aurora/script` 与 `/canvas/aurora`：
       * 那是演示项目，真实账号下不存在（画布请求直接 404），
       * 也会把用户带到不属于自己的项目上。
       */
      { label: '短剧制作', href: '/projects', icon: Clapperboard, exact: true },
    ],
  },
  {
    label: '工具',
    items: [
      { label: '自由画布', href: '/canvas', icon: PanelsTopLeft },
      { label: '任务中心', href: '/tasks', icon: ListChecks },
    ],
  },
  {
    label: '管理',
    items: [
      { label: '项目', href: '/projects', icon: FolderKanban, exact: true },
      { label: '素材库', href: '/assets', icon: GalleryHorizontalEnd },
      { label: '我的作品', href: '/works', icon: Palette },
      { label: '广场', href: '/gallery', icon: LayoutDashboard },
    ],
  },
]

function isActiveRoute(pathname: string, item: StudioNavItem) {
  // 画布是「列表 → 具体项目」两级：在具体项目里也应高亮「自由画布」。
  if (item.href === '/canvas') return pathname === '/canvas' || pathname.startsWith('/canvas/')
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function NavItem({ item, active, collapsed }: { item: StudioNavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon
  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'studio-nav-item group/nav flex h-8 items-center rounded-lg text-sm transition-colors duration-150',
        collapsed ? 'w-full justify-center px-0' : 'gap-2.5 px-2.5',
        active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn('truncate transition-opacity duration-150', collapsed ? 'w-0 opacity-0' : 'opacity-100')}>{item.label}</span>
    </Link>
  )

  return collapsed ? <Tooltip label={item.label} side="right" className="flex w-full">{link}</Tooltip> : link
}

export function Sidebar() {
  const pathname = usePathname()
  const { state, toggleSidebar } = useStudio()
  const collapsed = state.sidebarCollapsed

  return (
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'studio-sidebar fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out lg:flex lg:flex-col',
        collapsed ? 'w-16' : 'w-54',
      )}
    >
      {/* 品牌头部固定 60px：展开时 Logo 与收起按钮左右分列；收起时仅居中显示展开按钮，避免拥挤 */}
      <div className={cn('flex h-[60px] shrink-0 items-center border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        {!collapsed && (
          <Link
            href="/studio"
            aria-label="返回 OAOOAO 工作台"
            className="flex min-w-0 items-center rounded-md text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <span className="truncate text-sm font-bold tracking-tight">OAOOAO</span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!collapsed}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          {collapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronLeft className="size-4" aria-hidden="true" />}
        </button>
      </div>

      <nav aria-label="主导航" className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        <NavItem item={{ label: '工作台', href: '/studio', icon: Sparkles, exact: true }} active={pathname === '/studio'} collapsed={collapsed} />

        <div className={cn('flex flex-col', collapsed ? 'mt-1 gap-1' : 'mt-3 gap-3')}>
          {studioNavGroups.map((group) => (
            <section key={group.label} aria-labelledby={`nav-${group.label}`}>
              {/* 展开时分组标题占位并显示；收起时折叠高度，避免图标之间出现大片空白 */}
              <h2
                id={`nav-${group.label}`}
                className={cn(
                  'overflow-hidden whitespace-nowrap px-2.5 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground/70 transition-all duration-150',
                  collapsed ? 'h-0 opacity-0' : 'h-5 leading-5 opacity-100',
                )}
              >
                {group.label}
              </h2>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.href} item={item} active={isActiveRoute(pathname, item)} collapsed={collapsed} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className={cn('shrink-0 border-t border-sidebar-border py-3', collapsed ? 'px-2' : 'px-3')}>
        {state.backendStatus === 'connected' && state.user.role === 'admin' && <NavItem item={{ label: '管理员后台', href: '/admin', icon: LayoutDashboard }} active={pathname.startsWith('/admin')} collapsed={collapsed} />}
        <NavItem item={{ label: '设置', href: '/settings', icon: Settings }} active={pathname.startsWith('/settings')} collapsed={collapsed} />
      </div>
    </aside>
  )
}
