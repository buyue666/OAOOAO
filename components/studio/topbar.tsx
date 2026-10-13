'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, Coins, Languages, LogIn, LogOut, Menu, Moon, Sun, UserRound } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { logout } from '@/lib/studio/account-api'
import { useLocale } from '@/lib/studio/i18n'
import { Tooltip } from './ui'
import { studioPageTitle } from './studio-nav'
import { cn } from '@/lib/utils'
import { AnnouncementList, useAnnouncements } from '@/components/site-announcements'
import { RETURN_PATH_KEY, safeReturnPath } from '@/lib/studio/return-path'

const creditChipClass = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground shadow-[var(--lg-shadow-1)]'
const iconButtonClass = 'flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70'

/**
 * 顶栏只承担三件事：当前页面名称、积分余额、通知与账户入口。
 * 主题与语言切换放进账户菜单，避免顶栏堆叠多个工具按钮。
 */
export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { state, toggleTheme, refreshSession } = useStudio()
  const { locale, toggleLocale, t } = useLocale()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const notificationsRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  const projectId = pathname.startsWith('/projects/') ? pathname.split('/')[2] : undefined
  const projectTitle = projectId ? state.projects.find((project) => project.id === projectId)?.title : undefined
  const pageTitle = studioPageTitle(pathname, projectTitle)
  const themeLabel = state.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'
  const localeLabel = locale === 'zh-CN' ? t('switchToEnglish') : t('switchToChinese')
  const isConnected = state.backendStatus === 'connected'
  const rechargeEnabled = state.sessionSettings?.operationMode === 'commercial'
  const { unread: notificationCount } = useAnnouncements()
  const creditsLabel = `${state.credits.toLocaleString()} 积分`
  function capturePlansDestination(event: React.MouseEvent<HTMLAnchorElement>) {
    const returnTo = safeReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
    const href = `/plans?returnTo=${encodeURIComponent(returnTo)}`
    event.currentTarget.href = href
    try { sessionStorage.setItem(RETURN_PATH_KEY, returnTo) } catch { /* Explicit query retains the return target. */ }
    // Keep modified clicks as native link navigation while reading location at activation time.
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); router.push(href) }
  }

  // 通知与账户菜单共用一套关闭规则：点击外部或按 Esc 关闭。
  useEffect(() => {
    if (!accountOpen && !notificationsOpen) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (accountRef.current && !accountRef.current.contains(target)) setAccountOpen(false)
      if (notificationsRef.current && !notificationsRef.current.contains(target)) setNotificationsOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAccountOpen(false)
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [accountOpen, notificationsOpen])

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
    <header className="studio-topbar sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-3 md:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={onMenuClick} aria-label="打开导航" className={cn(iconButtonClass, 'lg:hidden')}>
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <p className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground" aria-current="page">{pageTitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {isConnected && (rechargeEnabled ? (
          <a href="/plans" onClick={capturePlansDestination} onAuxClick={capturePlansDestination} aria-label={`${creditsLabel}，查看套餐`} className={cn(creditChipClass, 'transition-colors duration-150 hover:bg-muted')}>
            <Coins className="size-4 text-studio-accent" aria-hidden="true" />
            <span className="tabular-nums">{creditsLabel}</span>
          </a>
        ) : (
          <span aria-label={creditsLabel} className={creditChipClass}>
            <Coins className="size-4 text-studio-accent" aria-hidden="true" />
            <span className="tabular-nums">{creditsLabel}</span>
          </span>
        ))}

        <div className="relative" ref={notificationsRef}>
          <Tooltip label={`通知，${notificationCount} 条未读`}>
            <button
              type="button"
              onClick={() => setNotificationsOpen((value) => !value)}
              aria-expanded={notificationsOpen}
              aria-label={`通知，${notificationCount} 条未读`}
              className={cn(iconButtonClass, 'relative')}
            >
              <Bell className="size-4" aria-hidden="true" />
              {notificationCount > 0 && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-studio-accent" />}
            </button>
          </Tooltip>
          {notificationsOpen && (
            <div role="dialog" aria-label="通知" className="lg-glass-overlay motion-panel absolute right-0 top-11 z-40 w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border p-3 text-left shadow-[var(--lg-shadow-4)]">
              <p className="text-sm font-semibold text-foreground">通知</p>
              <AnnouncementList />
            </div>
          )}
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
              className="flex size-9 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xs font-semibold text-foreground transition-colors duration-150 hover:border-studio-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {isConnected ? state.user.name.split(/\s+/).map((item) => item[0]).join('').slice(0, 2).toUpperCase() : <LogIn className="size-4" aria-hidden="true" />}
            </button>
          </Tooltip>
          {isConnected && accountOpen && (
            <div role="menu" aria-label="账户菜单" className="lg-glass-overlay motion-panel absolute right-0 top-11 z-40 w-60 max-w-[calc(100vw-24px)] rounded-lg border border-border p-1.5 text-left shadow-[var(--lg-shadow-4)]">
              <div className="border-b border-border px-2.5 pb-2.5 pt-1.5">
                <p className="truncate text-sm font-semibold text-foreground">{state.user.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{state.user.email || '未设置邮箱'}</p>
                <p className="mt-1.5 text-xs font-medium text-studio-accent">{creditsLabel} · {state.user.plan}</p>
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                <Link href="/account" role="menuitem" onClick={() => setAccountOpen(false)} className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground hover:bg-muted">
                  <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />账户与套餐
                </Link>
                <button type="button" role="menuitem" onClick={() => { toggleTheme(); setAccountOpen(false) }} className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-muted">
                  {state.theme === 'dark' ? <Sun className="size-4 text-muted-foreground" aria-hidden="true" /> : <Moon className="size-4 text-muted-foreground" aria-hidden="true" />}{themeLabel}
                </button>
                <button type="button" role="menuitem" onClick={() => { toggleLocale(); setAccountOpen(false) }} className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-muted">
                  <Languages className="size-4 text-muted-foreground" aria-hidden="true" />{localeLabel}
                </button>
                <button type="button" role="menuitem" onClick={() => void signOut()} disabled={signingOut} className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-muted disabled:opacity-60">
                  <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />{signingOut ? '正在退出…' : '退出登录'}
                </button>
              </div>
              {signOutError && <p role="alert" className="px-2.5 pb-1.5 pt-1 text-xs text-destructive">{signOutError}</p>}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
