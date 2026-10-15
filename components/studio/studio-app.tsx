'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useStudio } from '@/lib/studio/store'
import { MobileNav } from './mobile-nav'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { cn } from '@/lib/utils'
import { HomepageAnnouncement } from '@/components/homepage-announcement'
import { RETURN_PATH_KEY } from '@/lib/studio/return-path'

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
    || pathname === '/works'
    || pathname === '/skills'
    || pathname === '/tools'
    || pathname === '/account'
    || pathname === '/settings'
}

export function StudioApp({ children }: { children: React.ReactNode }) {
  const { state } = useStudio()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const isLanding = pathname === '/'
  const isAuthPage = pathname === '/login' || pathname === '/register' || pathname === '/forgot-password' || pathname === '/plans' || pathname === '/credits'
  const isPolicyPage = pathname === '/terms' || pathname === '/privacy'
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

  useEffect(() => {
    if (!isProtectedRoute || authChecking || authRedirecting) return
    try { sessionStorage.setItem(RETURN_PATH_KEY, `${pathname}${window.location.search}${window.location.hash}`) } catch {}
  }, [pathname, isProtectedRoute, authChecking, authRedirecting])

  if (authChecking || authRedirecting) {
    return <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-sm text-muted-foreground">{authRedirecting ? '����ǰ����¼ҳ��' : '���ڼ���¼״̬��'}</main>
  }

  /**
   * ��½ҳ����¼���ײ����̨���Դ�������ʽ�����׹���̨��ǣ�
   *  - ��½ҳ���Ӿ������������ר�ŵ������ģ���ǻ��������
   *  - �ײ�ҳ��ָ���Ĳ�������Ʒչʾ����
   *  - ��̨�Ƕ�������̨���Լ��Ĳ����붥������
   *
   * �������ֻ������̨ҳ�棨��������Agent����Ŀ���زĵȣ���
   */
  if (isLanding || isAuthPage || isPolicyPage) return <div className="min-h-dvh bg-background text-foreground">{children}</div>
  if (isAdmin) return <div className="min-h-dvh bg-background text-foreground">{children}</div>
  if (isCanvasRoute) return <div className="oao-canvas-route flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-black text-white"><div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div></div>

  return (
      <div
        data-studio-route={pathname === '/studio' ? 'home' : isWorkspace ? 'workspace' : 'inner'}
        data-studio-skin={state.skin}
        className="studio-app-shell relative min-h-dvh text-foreground"
      >
      {pathname === '/studio' && <HomepageAnnouncement placement="workbench" />}
      <Sidebar />
      {/*
        ������ֻ������ڱ߾���ɡ�����**����**�� filter / backdrop-filter /
        transform / contain���ǻ���ڲ��� fixed ������sticky ������ portal ����
        �����µİ����飬���²˵��������빤����ʾ��λ��
      */}
      <div className={cn('relative z-10 min-h-dvh transition-[padding] duration-200 ease-out', state.sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-56')}>
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-h-[calc(100dvh-60px)]">
          {/* ·���л�ʱ������΢���벢���ƣ��������ۼƲ���ƫ�� */}
          <div key={pathname} className={isWorkspace ? undefined : 'motion-page'}>{children}</div>
        </main>
      </div>
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div data-studio-portal-root />
      </div>
  )
}

