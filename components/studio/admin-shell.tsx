'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CircleDollarSign,
  ExternalLink,
  Layers3,
  LoaderCircle,
  Megaphone,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { ControlButton, Modal } from './ui'
import { SiteBrand } from '@/components/site-brand'
import { AdminWorkbench } from './admin-kit'
import { cn } from '@/lib/utils'
import { getSession, type BackendUser } from '@/lib/studio/api'
import type { AdminPermission, AdminSection } from '@/lib/studio/admin-types'

type AdminNavItem = readonly [AdminSection, string, LucideIcon, AdminPermission[]]

export const adminNavGroups: ReadonlyArray<{ label: string; items: ReadonlyArray<AdminNavItem> }> = [
  { label: '经营', items: [
    ['overview', '运营总览', BarChart3, ['analytics.read', 'generation.read', 'billing.read', 'system.manage', 'upstream.manage', 'billing.manage']],
    ['users', '用户与权限', Users, ['users.read']],
    ['orders', '订单与财务', CircleDollarSign, ['billing.read']],
    ['products', '商品与套餐', WalletCards, ['commerce.manage']],
  ] as const },
  { label: '创作服务', items: [
    ['generation', '生成任务', Activity, ['generation.read']],
    ['channels', '模型与渠道', Layers3, ['upstream.manage']],
    ['content', '内容与公告', Megaphone, ['content.manage']],
  ] as const },
  { label: '系统', items: [
    ['settings', '系统设置', Settings2, ['system.manage', 'upstream.manage', 'billing.manage', 'commerce.manage']],
    ['audit', '审计日志', ShieldCheck, ['audit.read']],
  ] as const },
] as const

const allAdminNavItems: ReadonlyArray<AdminNavItem> = adminNavGroups.flatMap((group) => group.items)

export const adminSectionMeta: Record<AdminSection, { title: string; description: string }> = {
  overview: { title: '运营总览', description: '今日与近 7 日调用、成功率、分布、渠道健康与收入摘要。' },
  users: { title: '用户与权限', description: '搜索用户、查看详情、调整积分套餐并分配管理员职责。' },
  generation: { title: '生成运维', description: '按用户、模型、渠道、类型和状态排查任务，处理失败与卡死请求。' },
  channels: { title: '模型与渠道', description: '维护上游渠道、逻辑模型、能力与计费倍率，并测试连通性。' },
  products: { title: '商品与套餐', description: '管理积分包、订阅套餐及其在订阅页展示的权益。' },
  orders: { title: '订单与财务', description: '查询订单与支付状态，处理退款、优惠券、促销与邀请返利。' },
  content: { title: '内容与公告', description: '发布公告并处理作品审核、下架与举报治理。' },
  settings: { title: '系统设置', description: '管理品牌外观、注册与积分、支付、邮件、存储和生成参数。' },
  audit: { title: '审计日志', description: '追踪管理员操作、登录、配置变更和敏感业务事件。' },
}

export function adminSectionFromValue(value?: string): AdminSection {
  return value && value in adminSectionMeta ? (value as AdminSection) : 'overview'
}

export function adminSectionHref(section: AdminSection) {
  return section === 'overview' ? '/admin' : `/admin/${section}`
}

/* -------------------------------- 会话上下文 -------------------------------- */

export type AdminSessionState = {
  user: BackendUser | null
  permissions: AdminPermission[]
  allowed: AdminSection[]
  isAdmin: boolean
  can: (permission: AdminPermission) => boolean
  canAny: (permissions: AdminPermission[]) => boolean
}

const AdminSessionContext = createContext<AdminSessionState | null>(null)
const AdminReloadContext = createContext<{ refresh: () => void; reloadKey: number }>({ refresh: () => {}, reloadKey: 0 })
type NavigationGuard = (proceed: () => void) => void
const AdminNavigationContext = createContext<{ navigate: (href: string) => void; registerGuard: (guard: NavigationGuard | null) => void }>({ navigate: () => {}, registerGuard: () => {} })

export function useAdminNavigation() { return useContext(AdminNavigationContext) }

export function useAdminSession() {
  const value = useContext(AdminSessionContext)
  if (!value) throw new Error('useAdminSession 必须在管理后台内使用')
  return value
}

export function useAdminReload() {
  return useContext(AdminReloadContext)
}

export function AdminAccessBoundary({ section, children }: { section: AdminSection; children: ReactNode }) {
  const [user, setUser] = useState<BackendUser | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const router = useRouter()
  const pathname = usePathname()
  const navigationGuard = useRef<NavigationGuard | null>(null)
  const registerGuard = useCallback((guard: NavigationGuard | null) => { navigationGuard.current = guard }, [])
  const navigate = useCallback((href: string) => {
    if (href === pathname) return
    const proceed = () => router.push(href)
    if (navigationGuard.current) navigationGuard.current(proceed)
    else proceed()
  }, [router, pathname])
  const navigation = useMemo(() => ({ navigate, registerGuard }), [navigate, registerGuard])

  useEffect(() => {
    let active = true
    setStatus('loading')
    getSession()
      .then((result) => { if (!active) return; setUser(result.user); setStatus('ready') })
      .catch((reason) => { if (!active) return; setError(reason instanceof Error ? reason.message : '管理员身份读取失败'); setStatus('error') })
    return () => { active = false }
  }, [reloadKey])

  const permissions = useMemo<AdminPermission[]>(() => (user?.adminPermissions ?? []) as AdminPermission[], [user])
  const isAdmin = user?.role === 'admin'
  const session = useMemo<AdminSessionState>(() => ({
    user,
    permissions,
    isAdmin,
    allowed: allAdminNavItems.filter(([, , , required]) => isAdmin && required.some((permission) => permissions.includes(permission))).map(([value]) => value),
    can: (permission) => isAdmin && permissions.includes(permission),
    canAny: (required) => isAdmin && required.some((permission) => permissions.includes(permission)),
  }), [isAdmin, permissions, user])
  const reload = useMemo(() => ({ refresh: () => setReloadKey((value) => value + 1), reloadKey }), [reloadKey])

  if (status === 'loading' && !user) return <div className="admin-gate flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在验证管理员身份</div>

  if (status === 'error') {
    return (
      <CenteredCard title="暂时无法连接管理服务">
        <p className="mt-2 break-words text-sm text-muted-foreground">{error}</p>
        <ControlButton className="mt-5" variant="primary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw className="size-4" />重试</ControlButton>
      </CenteredCard>
    )
  }

  if (!user) {
    return (
      <CenteredCard title="需要登录">
        <p className="mt-2 text-sm text-muted-foreground">请使用管理员账号登录后再访问 OAO 控制中心。</p>
        <Link href={`/login?next=${encodeURIComponent(adminSectionHref(section))}`} className="mt-5 inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm text-background">前往登录</Link>
      </CenteredCard>
    )
  }

  if (!isAdmin) {
    return (
      <CenteredCard title="需要管理员权限">
        <p className="mt-2 text-sm text-muted-foreground">当前账号不是管理员，无法访问 OAO 控制中心。</p>
        <Link href="/studio" className="mt-5 inline-flex h-9 items-center rounded-md border border-border px-4 text-sm">返回创作工作台</Link>
      </CenteredCard>
    )
  }

  const required = allAdminNavItems.find(([value]) => value === section)?.[3] ?? []
  const permitted = session.canAny(required)

  return (
    <AdminSessionContext.Provider value={session}>
      <AdminNavigationContext.Provider value={navigation}>
      <AdminReloadContext.Provider value={reload}>
        <AdminConsole key={user.id} section={section} onNavigate={(value) => navigate(adminSectionHref(value))}>
          {permitted ? children : (
            <AdminSectionCardShell title="没有访问该模块的职责权限" description="请联系具有“管理员管理”职责的管理员为当前账号分配对应权限。">
              <div className="mt-3 text-xs text-muted-foreground">当前账号职责：{permissions.length ? permissions.join('、') : '未分配'}</div>
            </AdminSectionCardShell>
          )}
        </AdminConsole>
      </AdminReloadContext.Provider>
      </AdminNavigationContext.Provider>
    </AdminSessionContext.Provider>
  )
}

function AdminSectionCardShell({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="studio-surface p-6">
      <ShieldCheck className="size-8 text-muted-foreground" />
      <h2 className="mt-4 text-sm font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}

function CenteredCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="admin-gate flex min-h-dvh items-center justify-center p-6">
      <div className="studio-surface max-w-md p-7 text-center">
        <ShieldCheck className="mx-auto size-9 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  )
}

/* ---------------------------------- 布局 ---------------------------------- */

function AdminConsole({ section, onNavigate, children }: { section: AdminSection; onNavigate: (value: AdminSection) => void; children: ReactNode }) {
  const session = useAdminSession()
  const { navigate: navigateHref } = useAdminNavigation()
  const { refresh } = useAdminReload()
  const [mobileOpen, setMobileOpen] = useState(false)
  const meta = adminSectionMeta[section]
  const items = adminNavGroups.flatMap((group) => group.items).filter(([, , , required]) => session.canAny(required))

  const navigate = useCallback((value: AdminSection) => { setMobileOpen(false); onNavigate(value) }, [onNavigate])
  const follow = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault(); navigateHref(href)
  }

  return (
    <div className="admin-console flex min-h-dvh bg-background text-foreground" data-admin-section={section}>
      {/* 实色侧栏：不要加 transform，否则其内部 fixed 定位的抽屉会错位。 */}
      <aside className="admin-sidebar sticky top-0 hidden h-dvh w-[224px] shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        <div className="flex min-h-24 items-center border-b border-border px-5 py-5">
          <Link href="/admin" onClick={(event) => follow(event, '/admin')} aria-label="管理后台首页" className="flex min-w-0 flex-col items-start gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <SiteBrand imageClassName="h-7 max-w-[172px] w-auto object-contain" />
            <span className="text-[11px] tracking-[0.16em] text-muted-foreground">管理后台</span>
          </Link>
        </div>
        <AdminNavList section={section} items={items} onNavigate={navigate} />
        <div className="border-t border-border p-3">
          <Link href="/studio" onClick={(event) => follow(event, '/studio')} className="flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" />返回创作工作台</Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="admin-topbar sticky top-0 z-30 flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <ControlButton variant="ghost" size="sm" className="lg:hidden" aria-label="打开后台导航" onClick={() => setMobileOpen(true)}><Menu className="size-4" /></ControlButton>
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <Link href="/admin" onClick={(event) => follow(event, '/admin')} className="text-xs text-muted-foreground hover:text-foreground">管理后台</Link>
              <span className="text-border" aria-hidden="true">/</span>
              <span className="truncate text-sm text-foreground">{meta.title}</span>
            </div>
            <div className="min-w-0 lg:hidden">
              <SiteBrand imageClassName="h-5 max-w-[100px] w-auto object-contain" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AdminModuleSearch items={items} onNavigate={navigate} />
            <ControlButton variant="ghost" size="sm" onClick={refresh} title="刷新当前页面" aria-label="刷新当前页面"><RefreshCw className="size-4" /></ControlButton>
            <Link href="/studio" onClick={(event) => follow(event, '/studio')} className="hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"><ExternalLink className="size-3.5" />工作台</Link>
            <div className="flex items-center gap-2 border-l border-border pl-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">{(session.user?.displayName || session.user?.username || 'A').slice(0, 1).toUpperCase()}</span>
              <span className="hidden max-w-32 truncate text-xs font-medium md:block">{session.user?.displayName || session.user?.username || '管理员'}</span>
            </div>
          </div>
        </header>

        <Modal open={mobileOpen} onClose={() => setMobileOpen(false)} title="后台导航" className="max-w-sm">
          <AdminNavList section={section} items={items} onNavigate={navigate} />
        </Modal>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-7 md:py-7">
          <div className="mb-6 border-b border-border pb-5">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{meta.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{meta.description}</p>
          </div>
          <AdminWorkbench>
            <div key={section} className="motion-page mt-5">{children}</div>
          </AdminWorkbench>
        </main>
      </div>
    </div>
  )
}

function AdminModuleSearch({ items, onNavigate }: { items: ReadonlyArray<AdminNavItem>; onNavigate: (value: AdminSection) => void }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const keyword = query.trim().toLowerCase()
  const matches = keyword ? items.filter(([value, label]) => `${label} ${adminSectionMeta[value].description}`.toLowerCase().includes(keyword)) : []
  const openResults = focused && Boolean(keyword)

  const open = (value: AdminSection) => { setQuery(''); setFocused(false); onNavigate(value) }

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && inputRef.current?.offsetParent) {
        event.preventDefault()
        inputRef.current.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  return (
    <div className="relative hidden w-56 md:block" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        ref={inputRef}
        role="combobox"
        aria-expanded={openResults}
        aria-controls={openResults ? 'admin-module-results' : undefined}
        aria-activedescendant={openResults && matches[activeIndex] ? `admin-module-${matches[activeIndex][0]}` : undefined}
        aria-autocomplete="list"
        aria-label="搜索后台模块"
        placeholder="搜索功能 · Ctrl K"
        autoComplete="off"
        value={query}
        onFocus={() => setFocused(true)}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setFocused(true) }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); setActiveIndex((value) => (value + 1) % matches.length) }
          if (event.key === 'ArrowUp' && matches.length) { event.preventDefault(); setActiveIndex((value) => (value - 1 + matches.length) % matches.length) }
          if (event.key === 'Enter' && matches[activeIndex]) { event.preventDefault(); open(matches[activeIndex][0]) }
          if (event.key === 'Escape') { setQuery(''); setFocused(false) }
        }}
        className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {openResults && (
        <ul id="admin-module-results" role="listbox" aria-label="匹配的后台模块" className="absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-md">
          {matches.map(([value, label, Icon], index) => (
            <li key={value} id={`admin-module-${value}`} role="option" aria-selected={activeIndex === index}>
              <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => open(value)} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs text-foreground transition-colors hover:bg-muted', activeIndex === index && 'bg-muted')}><Icon className="size-4 shrink-0" /><span>{label}</span></button>
            </li>
          ))}
          {!matches.length && <li role="presentation" className="px-3 py-4 text-xs text-muted-foreground">没有匹配功能，试试“积分”“模型”或“订单”。</li>}
        </ul>
      )}
    </div>
  )
}

function AdminNavList({ section, items, onNavigate }: { section: AdminSection; items: ReadonlyArray<AdminNavItem>; onNavigate: (value: AdminSection) => void }) {
  const groups = adminNavGroups.map((group) => ({ label: group.label, items: group.items.filter((item) => items.includes(item)) })).filter((group) => group.items.length)
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label="后台导航">
      {groups.map((group) => (
        <section key={group.label} className="mb-5 last:mb-0">
          <p className="mb-2 px-2.5 text-[11px] font-medium tracking-wider text-muted-foreground">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map(([value, label, Icon]) => {
              const active = section === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onNavigate(value)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-studio-accent/10 font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className={cn('size-4 shrink-0', active && 'text-studio-accent')} />{label}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </nav>
  )
}
