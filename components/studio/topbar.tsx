'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronRight, Coins, LogIn, LogOut, Menu, Moon, Sun, UserRound } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { logout } from '@/lib/studio/account-api'
import { Tooltip } from './ui'
import { cn } from '@/lib/utils'

const rootLabels: Record<string, string> = {
  agent: '导演 Agent',
  image: '图片',
  video: '视频',
  tasks: '任务',
  assets: '素材',
  works: '我的作品',
  gallery: '广场',
  projects: '项目',
  account: '账户',
  settings: '设置',
  plans: '套餐',
  admin: '管理后台',
  canvas: '自由画布',
}

const sectionLabels: Record<string, string> = {
  products: '订阅与商品',
  orders: '订单管理',
  script: '短剧制作',
  storyboard: '分镜',
  shots: '镜头',
  overview: '概览',
  assets: '素材',
  characters: '角色与场景',
  cut: '成片',
  canvas: '画布',
  settings: '设置',
}

interface Crumb {
  label: string
  href?: string
}

/**
 * 顶栏只承担导航上下文（面包屑），页面主标题由各页面的 PageHeader 唯一呈现，
 * 因此这里不再重复渲染标题与副标题。
 */
function buildCrumbs(pathname: string, projectTitle?: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return []

  if (segments[0] === 'projects') {
    const crumbs: Crumb[] = [{ label: '项目', href: '/projects' }]
    if (segments[1]) {
      crumbs.push({ label: projectTitle ?? '项目', href: `/projects/${segments[1]}` })
      if (segments[2]) crumbs.push({ label: sectionLabels[segments[2]] ?? segments[2] })
    }
    return crumbs
  }

  if (segments[0] === 'admin') {
    const crumbs: Crumb[] = [{ label: '管理后台', href: '/admin' }]
    if (segments[1]) crumbs.push({ label: sectionLabels[segments[1]] ?? segments[1] })
    return crumbs
  }

  return [{ label: rootLabels[segments[0]] ?? 'OAOOAO' }]
}

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { state, toggleTheme, refreshSession } = useStudio()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const accountRef = useRef<HTMLDivElement>(null)

  const projectId = pathname.startsWith('/projects/') ? pathname.split('/')[2] : undefined
  const projectTitle = projectId ? state.projects.find((project) => project.id === projectId)?.title : undefined
  const crumbs = buildCrumbs(pathname, projectTitle)
  const themeLabel = state.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'
  const isConnected = state.backendStatus === 'connected'
  const notificationCount = isConnected ? 0 : state.notifications

  // 点击外部或按 Esc 关闭账户菜单。
  useEffect(() => {
    if (!accountOpen) return
    function onPointerDown(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [accountOpen])

  /**
   * 退出登录。
   *
   * 必须作用到后端会话，然后立即刷新会话状态与所有账户数据，
   * 否则界面会继续显示上一个账号的积分和作品，或者必须整页刷新才生效。
   */
  async function signOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await logout()
      await refreshSession()
      setAccountOpen(false)
      setNotificationsOpen(false)
      router.push('/login')
    } catch (reason) {
      setSignOutError(reason instanceof Error ? reason.message : '退出失败，请稍后重试。')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <header className="studio-topbar sticky top-0 z-30 flex h-[60px] items-center justify-between gap-4 border-b border-border bg-background/95 px-4 shadow-sm backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onMenuClick} aria-label="打开导航" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground lg:hidden">
          <Menu className="size-5" aria-hidden="true" />
        </button>
        {crumbs.length > 0 && (
          <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-xs">
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1
              return (
                <span key={`${crumb.label}-${index}`} className={cn('min-w-0 items-center gap-1.5', isLast ? 'flex' : 'hidden sm:flex')}>
                  {index > 0 && <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/60 sm:block" aria-hidden="true" />}
                  {crumb.href && !isLast ? (
                    <Link href={crumb.href} className="truncate text-muted-foreground transition-colors duration-150 hover:text-foreground">{crumb.label}</Link>
                  ) : (
                    <span aria-current={isLast ? 'page' : undefined} className={cn('truncate', isLast ? 'font-medium text-foreground' : 'text-muted-foreground')}>{crumb.label}</span>
                  )}
                </span>
              )
            })}
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {isConnected && <Link href="/plans" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-studio-accent/30 bg-studio-accent/10 px-2.5 text-xs font-semibold text-studio-accent shadow-sm transition-colors duration-150 hover:bg-studio-accent/15" aria-label={`${state.credits} 可用积分，查看套餐`}><Coins className="size-3.5" aria-hidden="true" /><span>{state.credits.toLocaleString()}</span></Link>}
        <Tooltip label={themeLabel}>
          <button type="button" onClick={toggleTheme} aria-label={themeLabel} className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground">
            {state.theme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
          </button>
        </Tooltip>
        <div className="relative">
          <Tooltip label={`通知，${notificationCount} 条未读`}>
            <button type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-expanded={notificationsOpen} aria-label={`通知，${notificationCount} 条未读`} className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground">
              <Bell className="size-4" aria-hidden="true" />
              {notificationCount > 0 && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-studio-accent" />}
            </button>
          </Tooltip>
          {notificationsOpen && <div role="dialog" aria-label="通知" className="absolute right-0 top-11 z-40 w-64 border border-border bg-card p-3 text-left shadow-xl">
            <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-foreground">通知</p><button type="button" onClick={() => setNotificationsOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">关闭</button></div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{isConnected ? '暂无新的系统通知。' : '当前为本地预览，登录后读取真实通知。'}</p>
          </div>}
        </div>
        <div className="relative" ref={accountRef}>
          <Tooltip label={isConnected ? '账户' : '登录'}>
            <button
              type="button"
              onClick={() => {
                if (!isConnected) { router.push('/login'); return }
                setAccountOpen((value) => !value)
              }}
              aria-expanded={isConnected ? accountOpen : undefined}
              aria-haspopup={isConnected ? 'menu' : undefined}
              aria-label={isConnected ? '打开账户菜单' : '登录'}
              className="flex size-8 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xs font-semibold text-foreground transition-colors duration-150 hover:border-studio-accent/60"
            >
              {isConnected ? state.user.name.split(/\s+/).map((item) => item[0]).join('').slice(0, 2).toUpperCase() : <LogIn className="size-4" />}
            </button>
          </Tooltip>
          {isConnected && accountOpen && (
            <div role="menu" aria-label="账户菜单" className="absolute right-0 top-11 z-40 w-56 border border-border bg-card p-1.5 text-left shadow-xl">
              <div className="border-b border-border px-2.5 pb-2 pt-1.5">
                <p className="truncate text-xs font-semibold text-foreground">{state.user.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{state.user.email || '未设置邮箱'}</p>
                <p className="mt-1 text-[11px] text-studio-accent">{state.credits.toLocaleString()} 积分 · {state.user.plan}</p>
              </div>
              <Link href="/account" role="menuitem" onClick={() => setAccountOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                <UserRound className="size-3.5" aria-hidden="true" />账户与套餐
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                <LogOut className="size-3.5" aria-hidden="true" />{signingOut ? '正在退出…' : '退出登录'}
              </button>
              {signOutError && <p role="alert" className="px-2.5 pb-1.5 pt-1 text-[11px] text-destructive">{signOutError}</p>}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
