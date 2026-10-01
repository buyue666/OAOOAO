'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useStudio } from '@/lib/studio/store'
import { MobileNav } from './mobile-nav'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { cn } from '@/lib/utils'
import { SiteAnnouncementBar } from '@/components/site-announcement-bar'

function isProtectedStudioRoute(pathname: string) {
  return pathname === '/studio'
    || pathname === '/agent'
    || pathname.startsWith('/agent/')
    || pathname === '/image'
    || pathname.startsWith('/image/')
    || pathname === '/video'
    || pathname.startsWith('/video/')
    || pathname === '/drama'
    || pathname.startsWith('/drama/')
    || pathname === '/canvas'
    || pathname.startsWith('/canvas/')
    || pathname === '/projects'
    || pathname.startsWith('/projects/')
    || pathname === '/assets'
    || pathname === '/tasks'
    || pathname === '/account'
    || pathname === '/settings'
}

export function StudioApp({ children }: { children: React.ReactNode }) {
  const { state } = useStudio()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const isLanding = pathname === '/'
  const isAuthPage = pathname === '/login' || pathname === '/plans'
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/')
  const isWorkspace = pathname === '/image' || pathname === '/video'
  const isCanvasRoute = pathname === '/canvas' || pathname.startsWith('/canvas/')
  const isProtectedRoute = isProtectedStudioRoute(pathname)
  const authChecking = isProtectedRoute && (!state.hydrated || state.backendStatus === 'checking')
  const authRedirecting = isProtectedRoute && state.hydrated && (state.backendStatus === 'unauthenticated' || state.backendStatus === 'offline')

  useEffect(() => {
    if (!authRedirecting) return
    const next = `${pathname}${window.location.search}`
    router.replace(`/login?next=${encodeURIComponent(next)}`)
  }, [authRedirecting, pathname, router])

  if (authChecking || authRedirecting) {
    return <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-sm text-muted-foreground">{authRedirecting ? '正在前往登录页…' : '正在检查登录状态…'}</main>
  }

  /**
   * 着陆页、登录、套餐与后台都自带独立版式，不套工作台外壳：
   *  - 着陆页主视觉与滚动编排是专门调整过的，外壳会干扰它；
   *  - 套餐页有指定的布局与商品展示规则；
   *  - 后台是独立控制台（自己的侧栏与顶栏）。
   *
   * 因此这里只负责工作台页面（含画布、Agent、项目、素材等）。
   */
  if (isLanding || isAuthPage) return <div className="min-h-dvh bg-background text-foreground">{children}</div>
  if (isAdmin) return <div className="min-h-dvh bg-background text-foreground">{children}</div>
  if (isCanvasRoute) return <div className="oao-canvas-route flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-black text-white"><SiteAnnouncementBar announcement={state.sessionSettings?.site?.announcementBar} placement="workbench" /><div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div></div>

  return (
    <>
      <SiteAnnouncementBar announcement={state.sessionSettings?.site?.announcementBar} placement="workbench" />
      <div
        data-studio-route={pathname === '/studio' ? 'home' : isWorkspace ? 'workspace' : 'inner'}
        data-studio-skin={state.skin}
        className="studio-app-shell relative min-h-dvh text-foreground"
      >
      {/* 只给玻璃伪元素使用的边缘折射滤镜；不放在 root 上，避免影响 fixed/sticky 定位。 */}
      <svg aria-hidden="true" width="0" height="0" className="pointer-events-none fixed opacity-0" style={{ overflow: 'hidden' }}>
        <defs>
          <filter id="oao-liquid-edge" x="-12%" y="-12%" width="124%" height="124%" filterUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
            <feDisplacementMap scale="72" />
          </filter>
        </defs>
      </svg>
      <Sidebar />
      {/*
        内容列只做左侧内边距过渡。这里**不能**加 filter / backdrop-filter /
        transform / contain：那会给内部的 fixed 侧栏、sticky 顶栏与 portal 浮层
        创建新的包含块，导致菜单、弹窗与工具提示错位。
      */}
      <div className={cn('relative z-10 min-h-dvh transition-[padding] duration-200 ease-out', state.sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-56')}>
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-h-[calc(100dvh-60px)]">
          {/* 路由切换时内容轻微淡入并上移，不产生累计布局偏移 */}
          <div key={pathname} className={isWorkspace ? undefined : 'motion-page'}>{children}</div>
        </main>
      </div>
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div data-studio-portal-root />
      </div>
    </>
  )
}
