'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
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
  Settings2,
  ShieldCheck,
  Users,
  WalletCards,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { ControlButton, PageHeader } from './ui'
import { cn } from '@/lib/utils'
import { getSession, type BackendUser } from '@/lib/studio/api'
import type { AdminPermission, AdminSection } from '@/lib/studio/admin-types'

type AdminNavItem = readonly [AdminSection, string, LucideIcon, AdminPermission[]]

export const adminNavGroups: ReadonlyArray<{ label: string; items: ReadonlyArray<AdminNavItem> }> = [
  { label: '运营', items: [
    ['overview', '运营总览', BarChart3, ['analytics.read']],
    ['users', '用户与权限', Users, ['users.read']],
    ['generation', '生成运维', Activity, ['generation.read']],
  ] as const },
  { label: '上游', items: [['channels', '模型与渠道', Layers3, ['upstream.manage']]] as const },
  { label: '商业', items: [
    ['products', '商品与套餐', WalletCards, ['commerce.manage']],
    ['orders', '订单与财务', CircleDollarSign, ['billing.read']],
  ] as const },
  { label: '治理', items: [
    ['content', '内容与公告', Megaphone, ['content.manage']],
    ['settings', '系统设置', Settings2, ['system.manage', 'upstream.manage', 'billing.manage']],
    ['audit', '审计日志', ShieldCheck, ['audit.read']],
  ] as const },
] as const

export const adminSectionMeta: Record<AdminSection, { title: string; description: string }> = {
  overview: { title: '运营总览', description: '今日与近 7 日调用、成功率、分布、渠道健康与收入摘要。' },
  users: { title: '用户与权限', description: '搜索用户、查看详情、调整积分套餐并分配管理员职责。' },
  generation: { title: '生成运维', description: '按用户、模型、渠道、类型和状态排查任务，处理失败与卡死请求。' },
  channels: { title: '模型与渠道', description: '维护上游渠道、逻辑模型、能力与计费倍率，并测试连通性。' },
  products: { title: '商品与套餐', description: '管理积分包、订阅套餐及其在订阅页展示的权益。' },
  orders: { title: '订单与财务', description: '查询订单与支付状态，处理退款、优惠券、促销与邀请返利。' },
  content: { title: '内容与公告', description: '发布公告并处理作品审核、下架与举报治理。' },
  settings: { title: '系统设置', description: '站点、注册、积分、邮件、存储与生成参数的保存入口。' },
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
    allowed: adminNavGroups.flatMap((group) => group.items).filter(([, , , required]) => isAdmin && required.some((permission) => permissions.includes(permission))).map(([value]) => value),
    can: (permission) => isAdmin && permissions.includes(permission),
    canAny: (required) => isAdmin && required.some((permission) => permissions.includes(permission)),
  }), [isAdmin, permissions, user])
  const reload = useMemo(() => ({ refresh: () => setReloadKey((value) => value + 1), reloadKey }), [reloadKey])

  if (status === 'loading') return <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在验证管理员身份</div>

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
        <p className="mt-2 text-sm text-muted-foreground">请使用管理员账号登录后再访问 OAOOAO 控制中心。</p>
        <Link href={`/login?next=${encodeURIComponent(adminSectionHref(section))}`} className="mt-5 inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm text-background">前往登录</Link>
      </CenteredCard>
    )
  }

  if (!isAdmin) {
    return (
      <CenteredCard title="需要管理员权限">
        <p className="mt-2 text-sm text-muted-foreground">当前账号不是管理员，无法访问 OAOOAO 控制中心。</p>
        <Link href="/studio" className="mt-5 inline-flex h-9 items-center rounded-md border border-border px-4 text-sm">返回创作工作台</Link>
      </CenteredCard>
    )
  }

  const required = adminNavGroups.flatMap((group) => group.items).find(([value]) => value === section)?.[3] ?? []
  const permitted = session.canAny(required)

  return (
    <AdminSessionContext.Provider value={session}>
      <AdminReloadContext.Provider value={reload}>
        <AdminConsole section={section} onNavigate={(value) => router.push(adminSectionHref(value))}>
          {permitted ? children : (
            <AdminSectionCardShell title="没有访问该模块的职责权限" description="请联系具有“管理员管理”职责的管理员为当前账号分配对应权限。">
              <div className="mt-3 text-xs text-muted-foreground">当前账号职责：{permissions.length ? permissions.join('、') : '未分配'}</div>
            </AdminSectionCardShell>
          )}
        </AdminConsole>
      </AdminReloadContext.Provider>
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
    <div className="flex min-h-dvh items-center justify-center p-6">
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
  const { refresh } = useAdminReload()
  const [mobileOpen, setMobileOpen] = useState(false)
  const meta = adminSectionMeta[section]
  const items = adminNavGroups.flatMap((group) => group.items).filter(([, , , required]) => session.canAny(required))

  const navigate = useCallback((value: AdminSection) => { setMobileOpen(false); onNavigate(value) }, [onNavigate])

  return (
    <div className="admin-console flex min-h-dvh bg-background text-foreground">
      <aside className="hidden w-[232px] shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Link href="/studio" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background"><Zap className="size-4" /></span>
            OAOOAO <span className="text-muted-foreground">/ 控制中心</span>
          </Link>
        </div>
        <AdminNavList section={section} items={items} onNavigate={navigate} />
        <div className="border-t border-border p-3">
          <Link href="/studio" className="flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" />返回创作工作台</Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <ControlButton variant="ghost" size="sm" className="lg:hidden" aria-label="打开后台导航" onClick={() => setMobileOpen(true)}><Menu className="size-4" /></ControlButton>
            <Link href="/studio" className="flex items-center gap-2 lg:hidden" aria-label="OAOOAO 控制中心">
              <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background"><Zap className="size-4" /></span>
              <span className="text-sm font-semibold tracking-tight">OAOOAO</span>
            </Link>
            <div className="hidden min-w-0 lg:block">
              <p className="truncate text-sm font-semibold text-foreground">{meta.title}</p>
              <p className="truncate text-xs text-muted-foreground">{meta.description}</p>
            </div>
            <div className="min-w-0 lg:hidden">
              <p className="truncate text-sm font-semibold text-foreground">{meta.title}</p>
              <p className="truncate text-[11px] text-muted-foreground">OAOOAO 控制中心</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ControlButton variant="ghost" size="sm" onClick={refresh} title="刷新当前页面"><RefreshCw className="size-4" /></ControlButton>
            <Link href="/studio" className="hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"><ExternalLink className="size-3.5" />工作台</Link>
            <div className="flex items-center gap-2 border-l border-border pl-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">{(session.user?.displayName || session.user?.username || 'A').slice(0, 1).toUpperCase()}</span>
              <span className="hidden max-w-32 truncate text-xs font-medium md:block">{session.user?.displayName || session.user?.username || '管理员'}</span>
            </div>
          </div>
        </header>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2 lg:hidden">
          {items.map(([value, label, Icon]) => (
            <Link key={value} href={adminSectionHref(value)} className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs', section === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}>
              <Icon className="size-3.5" />{label}
            </Link>
          ))}
        </div>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden" role="presentation">
            <div className="absolute inset-0 bg-studio-ink/50" onClick={() => setMobileOpen(false)} />
            <nav className="relative flex w-[248px] max-w-[80vw] flex-col overflow-y-auto border-r border-border bg-card" aria-label="后台导航">
              <div className="flex h-16 items-center justify-between border-b border-border px-4">
                <span className="flex items-center gap-2 text-sm font-semibold"><Zap className="size-4" />OAOOAO 控制中心</span>
                <ControlButton variant="ghost" size="sm" aria-label="关闭导航" onClick={() => setMobileOpen(false)}><X className="size-4" /></ControlButton>
              </div>
              <AdminNavList section={section} items={items} onNavigate={navigate} />
            </nav>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1540px] px-4 py-5 md:px-7 md:py-7">
          <PageHeader title={meta.title} description={meta.description} />
          <div className="mt-5">{children}</div>
        </main>
      </div>
    </div>
  )
}

function AdminNavList({ section, items, onNavigate }: { section: AdminSection; items: ReadonlyArray<AdminNavItem>; onNavigate: (value: AdminSection) => void }) {
  const groups = adminNavGroups.map((group) => ({ label: group.label, items: group.items.filter((item) => items.includes(item)) })).filter((group) => group.items.length)
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label="后台导航">
      {groups.map((group) => (
        <section key={group.label} className="mb-6">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => onNavigate(value)}
                aria-current={section === value ? 'page' : undefined}
                className={cn('flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm transition-colors', section === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
              >
                <Icon className="size-4 shrink-0" />{label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </nav>
  )
}
