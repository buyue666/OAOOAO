'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, CircleDollarSign, Layers3, RefreshCw, Settings2, ShieldCheck, Users, WalletCards, type LucideIcon } from 'lucide-react'
import { getLaunchReadiness, type LaunchReadinessReport } from '@/lib/studio/admin-api'
import { adminOverviewAccess, channelNeedsAttention, generationOverviewMetrics, loadAdminOverview, overviewAttention, type AdminOverviewSnapshot, type OverviewResource } from '@/lib/studio/admin-overview'
import type { AdminGenerationChannel, AdminGenerationOverview, AdminPermission } from '@/lib/studio/admin-types'
import { cn } from '@/lib/utils'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminCell, AdminEmpty, AdminError, AdminKpiStrip, AdminLoading, AdminNotice,
  AdminRow, AdminSectionCard, AdminSelect, AdminTable, AdminTabs, TableMessageRow,
  capabilityLabels, formatAdminDate, formatAdminDuration, formatAdminMoney,
  formatAdminNumber, labelOf, orderStatusLabels, statusTone, taskStatusLabels,
  type AdminKpi,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

type OverviewTab = 'overview' | 'readiness'
const quickLinks: Array<{ title: string; detail: string; href: string; icon: LucideIcon; permissions: AdminPermission[] }> = [
  { title: '生成运营', detail: '定位失败与运行中的任务', href: '/admin/generation', icon: Activity, permissions: ['generation.read'] },
  { title: '订单与财务', detail: '核对支付、退款与对账', href: '/admin/orders', icon: CircleDollarSign, permissions: ['billing.read'] },
  { title: '用户与权限', detail: '管理账号、积分与职责', href: '/admin/users', icon: Users, permissions: ['users.read'] },
  { title: '模型与渠道', detail: '维护模型供应与路由', href: '/admin/channels', icon: Layers3, permissions: ['upstream.manage'] },
  { title: '商品与套餐', detail: '管理在售商品与权益', href: '/admin/products', icon: WalletCards, permissions: ['commerce.manage'] },
  { title: '系统设置', detail: '品牌、支付与服务配置', href: '/admin/settings', icon: Settings2, permissions: ['system.manage', 'upstream.manage', 'billing.manage'] },
]

export function AdminOverviewPanel() {
  const session = useAdminSession()
  const access = adminOverviewAccess(session.permissions)
  const tabs: Array<readonly [OverviewTab, string]> = []
  if (access.analytics || access.generation || access.billing) tabs.push(['overview', '运营总览'])
  if (access.readiness) tabs.push(['readiness', '上线检查'])
  const [requestedTab, setRequestedTab] = useState<OverviewTab>('overview')
  const activeTab = tabs.find(([value]) => value === requestedTab)?.[0] ?? tabs[0]?.[0]
  const accountScope = JSON.stringify([session.user?.id, [...session.permissions].sort()])

  return (
    <div className="flex flex-col gap-6">
      {tabs.length > 1 && <AdminTabs label="运营总览分区" items={tabs} value={activeTab} onChange={setRequestedTab} />}
      <div key={accountScope} role="tabpanel" aria-label={activeTab === 'readiness' ? '上线检查' : '运营总览'}>
        {activeTab === 'overview' && <OverviewMetrics />}
        {activeTab === 'readiness' && <LaunchReadinessPanel />}
      </div>
    </div>
  )
}

function OverviewMetrics() {
  const { reloadKey } = useAdminReload()
  const session = useAdminSession()
  const [data, setData] = useState<AdminOverviewSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)
  const permissionKey = JSON.stringify(session.permissions)

  useEffect(() => {
    let active = true
    setLoading(true)
    void loadAdminOverview(JSON.parse(permissionKey) as AdminPermission[]).then((next) => {
      if (!active) return
      setData(next)
      setLoading(false)
    })
    return () => { active = false }
  }, [permissionKey, reloadKey, retryKey])

  const refresh = () => setRetryKey((value) => value + 1)
  const links = quickLinks.filter((link) => session.canAny(link.permissions))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
          <p>{data ? `上次读取 ${formatAdminDate(data.loadedAt)}` : '正在读取当前账号有权限的数据'}</p>
          <p>生成趋势按北京时间 · 财务为累计统计</p>
        </div>
        <ControlButton variant="secondary" onClick={refresh} disabled={loading}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />{loading ? '正在读取' : '刷新数据'}</ControlButton>
      </div>

      {loading && !data ? <AdminLoading label="正在读取运营数据" rows={4} /> : data && <OverviewData data={data} retry={refresh} />}

      {links.length > 0 && (
        <section aria-labelledby="admin-quick-title">
          <h2 id="admin-quick-title" className="mb-3 text-sm font-semibold">常用入口</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {links.map(({ title, detail, href, icon: Icon }) => (
              <Link key={href} href={href} className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-studio-accent/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50"><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{detail}</span></span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function OverviewData({ data, retry }: { data: AdminOverviewSnapshot; retry: () => void }) {
  const overview = data.analytics.status === 'ready' ? data.analytics.data : null
  const generation = data.generation.status === 'ready' ? data.generation.data : null
  const finance = data.finance.status === 'ready' ? data.finance.data : null
  const orders = data.orders.status === 'ready' ? data.orders.data : null
  const attention = overviewAttention(data)
  const errors = [
    ['生成统计', data.analytics], ['任务与渠道', data.generation], ['财务摘要', data.finance], ['最近订单', data.orders],
  ] as const
  const failed = errors.filter(([, result]) => result.status === 'error')
  const kpis: AdminKpi[] = []
  if (overview) {
    const metrics = generationOverviewMetrics(overview, new Date(data.loadedAt))
    kpis.push(
      { label: '今日调用', value: metrics.todayCalls === null ? '—' : formatAdminNumber(metrics.todayCalls), detail: metrics.todayCalls === null ? '服务未返回今日的日期数据' : '北京时间 00:00 起的生成记录' },
      { label: `近 ${overview.windowDays} 日调用`, value: formatAdminNumber(overview.totalCalls), detail: `成功 ${formatAdminNumber(overview.successCalls)} · 失败 ${formatAdminNumber(overview.failedCalls)}` },
      { label: '生成成功率', value: metrics.successRate === null ? '—' : `${metrics.successRate.toFixed(1)}%`, detail: `近 ${overview.windowDays} 日 · ${metrics.successRate === null ? '暂无调用样本' : '成功记录 / 全部生成记录'}` },
      { label: '活跃用户', value: formatAdminNumber(overview.activeUsers), detail: `近 ${overview.windowDays} 日有调用的用户` },
    )
  }
  if (generation) kpis.push(
    { label: '执行中任务', value: formatAdminNumber(generation.summary.byStatus.running), detail: `排队 ${formatAdminNumber(generation.summary.byStatus.pending)} · 暂停 ${formatAdminNumber(generation.summary.byStatus.paused)}` },
  )
  if (finance) kpis.push(
    { label: '累计已支付订单金额', value: formatAdminMoney(finance.orders.paidAmountCents), detail: `当前已支付状态 ${formatAdminNumber(finance.orders.paid)} 笔` },
    { label: '累计退款订单金额', value: formatAdminMoney(finance.orders.refundedAmountCents), detail: `当前已退款状态 ${formatAdminNumber(finance.orders.refunded)} 笔` },
    { label: '待支付订单', value: formatAdminNumber(finance.orders.pending), detail: `待支付 ${formatAdminMoney(finance.orders.pendingAmountCents)}` },
  )

  return (
    <>
      {failed.map(([name, resource]) => resource.status === 'error' && <AdminError key={name} message={`${name}暂不可用：${resource.error}`} retry={retry} />)}
      {kpis.length > 0 && <AdminKpiStrip label="核心运营指标" items={kpis} />}

      <AdminSectionCard title="优先关注" description="按当前任务状态、渠道运行状态与订单状态整理；点击进入对应模块核查。">
        {attention.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {attention.map((item) => (
              <Link key={item.id} href={item.href} className={cn('group flex flex-col rounded-xl border p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', item.tone === 'danger' ? 'border-destructive/20 bg-destructive/[0.03]' : item.tone === 'warning' ? 'border-studio-warn/25 bg-studio-warn/[0.04]' : 'border-border bg-muted/20')}>
                <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">{item.title}<ArrowUpRight className="size-3.5" /></span>
                <strong className={cn('my-2 text-2xl font-semibold tabular-nums', item.tone === 'danger' && 'text-destructive', item.tone === 'warning' && 'text-studio-warn')}>{formatAdminNumber(item.count)}</strong>
                <span className="text-xs leading-5 text-muted-foreground">{item.detail}</span>
              </Link>
            ))}
          </div>
        ) : <AdminEmpty title={failed.length ? '部分数据暂时无法判断' : generation || finance ? '当前数据中没有需关注的状态' : '当前账号可查看生成统计'} description={failed.length ? '读取失败的模块不会按零异常处理，请重试后查看。' : generation || finance ? '这里会展示暂停、失败、渠道异常、运行中任务和待支付订单。' : '任务运维与财务事项需要对应的查看权限。'} />}
      </AdminSectionCard>

      {overview && <AnalyticsPanels overview={overview} />}

      {generation && (
        <div className="grid gap-5 xl:grid-cols-2">
          <AdminSectionCard title="最近生成任务" description="最新 5 条任务记录，包含当前执行状态。" action={<ModuleLink href="/admin/generation">查看全部</ModuleLink>}>
            <AdminTable columns={['任务', '用户', '状态', '创建时间']} minWidth={580} caption="最近生成任务">
              {generation.items.map((task) => <AdminRow key={`${task.type}-${task.id}`}>
                <AdminCell><p className="max-w-48 truncate text-xs font-medium" title={task.prompt || task.id}>{task.prompt || task.model || task.id}</p><p className="mt-1 text-[11px] text-muted-foreground">{task.model || '未记录模型'}</p></AdminCell>
                <AdminCell className="text-xs">{task.displayName || task.username || '—'}</AdminCell>
                <AdminCell><StatusBadge tone={statusTone(task.status)}>{labelOf(taskStatusLabels, task.status)}</StatusBadge></AdminCell>
                <AdminCell className="whitespace-nowrap text-xs text-muted-foreground">{formatAdminDate(task.createdAt)}</AdminCell>
              </AdminRow>)}
              {!generation.items.length && <TableMessageRow colSpan={4} loading={false} empty="暂无生成任务" />}
            </AdminTable>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">已结束任务平均耗时 {formatAdminDuration(generation.summary.averageDurationMs)} · 任务记录累计积分消耗 {formatAdminNumber(generation.summary.totalPointsCost)}</p>
          </AdminSectionCard>
          <ChannelPanel channels={generation.channels} />
        </div>
      )}

      {orders && <AdminSectionCard title="最近订单" description="最新 5 笔订单；金额与状态均来自订单记录。" action={<ModuleLink href="/admin/orders">查看全部</ModuleLink>}>
        <AdminTable columns={['订单号', '用户', '商品', '金额', '状态', '时间']} minWidth={720} caption="最近订单">
          {orders.map((order) => <AdminRow key={order.id}>
            <AdminCell className="font-mono text-xs">{order.orderNo}</AdminCell>
            <AdminCell className="text-xs">{order.userUsername || order.userDisplayName || '—'}</AdminCell>
            <AdminCell className="max-w-[200px] truncate text-xs">{order.subject}</AdminCell>
            <AdminCell className="text-xs">{formatAdminMoney(order.amountCents, order.currency)}</AdminCell>
            <AdminCell><StatusBadge tone={statusTone(order.status)}>{labelOf(orderStatusLabels, order.status)}</StatusBadge></AdminCell>
            <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(order.createdAt)}</AdminCell>
          </AdminRow>)}
          {!orders.length && <TableMessageRow colSpan={6} loading={false} empty="暂无订单" />}
        </AdminTable>
      </AdminSectionCard>}
    </>
  )
}

function AnalyticsPanels({ overview }: { overview: AdminGenerationOverview }) {
  const maxDaily = Math.max(1, ...overview.dailyCalls.map((item) => item.value))
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
      <AdminSectionCard title="生成调用趋势" description={`近 ${overview.windowDays} 日 · 北京时间 · 按生成记录创建日期统计`}>
        {overview.dailyCalls.length ? <div className="flex h-48 items-end gap-2 border-b border-border px-1 sm:gap-4">
          {overview.dailyCalls.map((item, index) => <div key={item.date || `${item.label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">{formatAdminNumber(item.value)}</span>
            <div className="w-full max-w-12 rounded-t-md bg-studio-accent/75" style={{ height: `${item.value > 0 ? Math.max(3, (item.value / maxDaily) * 126) : 0}px` }} title={`${item.date || item.label}：${item.value} 次`} />
            <span className="max-w-full truncate pb-2 text-[11px] text-muted-foreground">{item.label}</span>
          </div>)}
        </div> : <AdminEmpty title="暂无调用趋势" description="产生生成记录后，这里会展示按日汇总。" />}
        <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          {[{ title: '调用类型', items: overview.kindDistribution }, { title: '调用来源', items: overview.sourceDistribution }].map((group) => <div key={group.title}>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</h3>
            <div className="flex flex-wrap gap-2">{group.items.length ? group.items.map((item, index) => <span key={`${item.label}-${index}`} className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs">{item.label}<span className="ml-2 tabular-nums text-muted-foreground">{formatAdminNumber(item.value)}</span></span>) : <span className="text-xs text-muted-foreground">暂无记录</span>}</div>
          </div>)}
        </div>
      </AdminSectionCard>
      <AdminSectionCard title="常用模型" description={`近 ${overview.windowDays} 日调用最多的 6 个模型`}>
        {overview.modelDistribution.length ? <div className="flex flex-col gap-4">{overview.modelDistribution.slice(0, 6).map((item, index) => <div key={`${item.label}-${index}`}>
          <div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="truncate" title={item.label}>{item.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{formatAdminNumber(item.value)} 次 · {Number(item.percent || 0).toFixed(1)}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-studio-accent/65" style={{ width: `${Math.max(0, Math.min(100, Number(item.percent) || 0))}%` }} /></div>
        </div>)}</div> : <AdminEmpty title="暂无模型记录" description="产生生成记录后，这里会展示模型分布。" />}
      </AdminSectionCard>
    </div>
  )
}

function ChannelPanel({ channels }: { channels: AdminGenerationChannel[] }) {
  const ordered = [...channels].sort((left, right) => Number(channelNeedsAttention(right)) - Number(channelNeedsAttention(left)))
  return <AdminSectionCard title="渠道运行状态" description="按模型绑定展示；异常优先，最多展示 6 项。运行计数不属于 7 日生成统计。" action={<ModuleLink href="/admin/generation">查看全部</ModuleLink>}>
    {ordered.length ? <div className="divide-y divide-border">{ordered.slice(0, 6).map((channel, index) => {
      const runtime = channel.planningRuntime
      const attempts = (runtime?.successCount || 0) + (runtime?.failureCount || 0)
      const state = !channel.enabled ? '已停用' : channel.runtimeHealth.status === 'cooling' ? '冷却中' : channel.runtimeHealth.consecutiveFailures > 0 ? '存在失败' : '未处于冷却'
      return <div key={`${channel.id}-${channel.logicalModelId}-${index}`} className="py-3 first:pt-0 last:pb-0">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium" title={channel.name}>{channel.name || channel.id}</p><p className="mt-1 truncate text-xs text-muted-foreground">{labelOf(capabilityLabels, channel.capability)} · {channel.logicalModelName || channel.upstreamModel}</p></div><StatusBadge tone={!channel.enabled ? 'muted' : channelNeedsAttention(channel) ? 'warning' : 'neutral'}>{state}</StatusBadge></div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{attempts ? `文本规划尝试成功 ${runtime?.successCount} / ${attempts} · 平均耗时 ${formatAdminDuration(runtime?.averageLatencyMs)}` : '暂无文本规划尝试计数'}{channel.runtimeHealth.consecutiveFailures > 0 ? ` · 连续失败 ${channel.runtimeHealth.consecutiveFailures} 次` : ''}</p>
      </div>
    })}</div> : <AdminEmpty title="暂无模型渠道绑定" description="配置模型与渠道后可在此查看运行状态。" />}
  </AdminSectionCard>
}

function ModuleLink({ href, children }: { href: string; children: string }) {
  return <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{children}<ArrowUpRight className="size-3.5" /></Link>
}

function LaunchReadinessPanel() {
  const { reloadKey } = useAdminReload()
  const [profile, setProfile] = useState<'production' | 'paid_beta' | 'self_use'>('production')
  const [retryKey, setRetryKey] = useState(0)
  const [resource, setResource] = useState<OverviewResource<LaunchReadinessReport> | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setResource(null)
    void getLaunchReadiness(profile).then(
      (data) => { if (active) { setResource({ status: 'ready', data }); setLoading(false) } },
      (reason) => { if (active) { setResource({ status: 'error', error: reason instanceof Error ? reason.message : '上线检查失败' }); setLoading(false) } },
    )
    return () => { active = false }
  }, [profile, reloadKey, retryKey])
  const readiness = resource?.status === 'ready' ? resource.data : null

  return <AdminSectionCard title="上线检查" description="选择运营场景，检查当前配置是否满足要求。检查只读取配置。" action={<ShieldCheck className="size-5 text-muted-foreground" />}>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">检查场景<AdminSelect value={profile} onChange={(event) => setProfile(event.target.value as typeof profile)} className="w-40"><option value="production">正式运营</option><option value="paid_beta">付费试运营</option><option value="self_use">自用</option></AdminSelect></label>
      <ControlButton onClick={() => setRetryKey((value) => value + 1)} disabled={loading}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />重新检查</ControlButton>
      {readiness && <StatusBadge tone={readiness.errors ? 'danger' : readiness.warnings ? 'warning' : 'success'}>{readiness.errors ? `${readiness.errors} 项错误` : readiness.warnings ? `${readiness.warnings} 项警告` : '全部通过'}</StatusBadge>}
    </div>
    {loading && <AdminLoading label="正在检查当前配置" rows={3} />}
    {resource?.status === 'error' && <AdminError message={resource.error} retry={() => setRetryKey((value) => value + 1)} />}
    {readiness && <div className="flex flex-col gap-3" data-testid="launch-readiness">
      {readiness.items.map((item) => <div key={item.id} className="flex items-start gap-3 rounded-xl border border-border p-3" data-testid={`readiness-${item.id}`} data-level={item.level}>
        <StatusBadge tone={item.level === 'error' ? 'danger' : item.level === 'warning' ? 'warning' : 'success'}>{item.level === 'error' ? '错误' : item.level === 'warning' ? '警告' : '正常'}</StatusBadge>
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.detail}</p>{item.action && <p className="mt-1 text-xs leading-5 text-studio-warn">建议：{item.action}</p>}</div>
      </div>)}
      <AdminNotice tone={readiness.passed ? 'neutral' : 'warning'}>检查时间：{formatAdminDate(readiness.checkedAt)}。{readiness.passed ? '当前场景未发现阻断项；请结合警告与实际业务确认。' : `存在 ${readiness.errors} 项阻断错误，请处理后重新检查。`}</AdminNotice>
    </div>}
  </AdminSectionCard>
}
