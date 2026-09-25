'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, CircleDollarSign, Clock, Layers3, TrendingUp, Users } from 'lucide-react'
import { getFinanceSummary, getGenerationOverview, getLaunchReadiness, listBillingOrders, listGenerationOperations, type LaunchReadinessReport } from '@/lib/studio/admin-api'
import type { AdminGenerationChannel, AdminGenerationOverview, AdminGenerationSummary, BillingOrder, FinanceSummary } from '@/lib/studio/admin-types'
import { StatusBadge } from './ui'
import {
  AdminCell,
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminRow,
  AdminSectionCard,
  AdminStat,
  AdminTable,
  TableMessageRow,
  capabilityLabels,
  formatAdminDate,
  formatAdminDuration,
  formatAdminMoney,
  formatAdminNumber,
  labelOf,
  orderStatusLabels,
  statusTone,
} from './admin-kit'
import { useAdminReload } from './admin-shell'

type Loaded = {
  overview: AdminGenerationOverview
  summary: AdminGenerationSummary
  channels: AdminGenerationChannel[]
  finance: FinanceSummary | null
  recentOrders: BillingOrder[]
}

const emptySummary: AdminGenerationSummary = { total: 0, active: 0, success: 0, failed: 0, averageDurationMs: 0, totalPointsCost: 0, byType: {}, byStatus: {} }

export function AdminOverviewPanel() {
  const { reloadKey } = useAdminReload()
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [days, setDays] = useState(7)
  /** 上线前检查：独立加载，失败不影响其它运营数据展示。 */
  const [readiness, setReadiness] = useState<LaunchReadinessReport | null>(null)
  const [readinessError, setReadinessError] = useState('')

  const loadReadiness = useCallback(() => {
    setReadinessError('')
    getLaunchReadiness()
      .then(setReadiness)
      .catch((reason) => setReadinessError(reason instanceof Error ? reason.message : '上线检查加载失败'))
  }, [])

  const load = useCallback(() => {
    setLoading(true); setError('')
    Promise.all([
      getGenerationOverview(days),
      listGenerationOperations({ page: 1, pageSize: 1 }),
      getFinanceSummary(),
      listBillingOrders({ page: 1, pageSize: 5 }).catch(() => ({ items: [] as BillingOrder[], total: 0, page: 1, pageSize: 5 })),
    ])
      .then(([overview, operations, finance, orders]) => setData({ overview, summary: operations.summary, channels: operations.channels, finance, recentOrders: orders.items }))
      .catch((reason) => setError(reason instanceof Error ? reason.message : '运营数据加载失败'))
      .finally(() => setLoading(false))
  }, [days, reloadKey])

  useEffect(() => { void load() }, [load])
  useEffect(() => { loadReadiness() }, [loadReadiness, reloadKey])

  if (loading && !data) return <AdminLoading label="正在加载运营数据" rows={5} />
  if (error && !data) return <AdminError message={error} retry={load} />

  const overview = data?.overview
  const summary = data?.summary ?? emptySummary
  const finance = data?.finance
  const total = Number(overview?.totalCalls) || 0
  const success = Number(overview?.successCalls) || 0
  const failed = Number(overview?.failedCalls) || 0
  const successRate = total ? (success / total) * 100 : 0
  const failureRate = total ? (failed / total) * 100 : 0
  const queueCount = (summary.byStatus.pending || 0) + (summary.byStatus.running || 0) + (summary.byStatus.paused || 0)
  const paidCents = finance?.orders.paidAmountCents ?? 0
  const refundCents = finance?.orders.refundedAmountCents ?? 0

  const daily = overview?.dailyCalls ?? []
  const maxDaily = Math.max(1, ...daily.map((item) => Number(item.value) || 0))
  const todayValue = daily.length ? Number(daily[daily.length - 1]?.value) || 0 : 0
  const distributions = [
    { title: '调用类型分布', items: overview?.kindDistribution ?? [] },
    { title: '来源分布', items: overview?.sourceDistribution ?? [] },
  ]

  return (
    <div className="flex flex-col gap-5">
      {error && <AdminError message={error} retry={load} />}

      {/**
        * 上线前检查。
        *
        * 与「运营健康」的区别：运营健康看运行数据，上线检查看**配置是否具备收费条件**。
        * 明确区分 error（阻断收费上线）与 warning（需人工确认），
        * 并给出每一项的可执行动作；本面板只读，不会自动修改任何配置。
        */}
      <AdminSectionCard
        title="上线前检查"
        description="收费上线前的配置体检：区分错误（阻断上线）与警告（需人工确认）。本检查只读，不会修改任何配置。"
        action={(
          <div className="flex items-center gap-2">
            {readiness && (
              <StatusBadge tone={readiness.errors ? 'danger' : readiness.warnings ? 'warning' : 'success'}>
                {readiness.errors ? `${readiness.errors} 项错误` : readiness.warnings ? `${readiness.warnings} 项警告` : '全部通过'}
              </StatusBadge>
            )}
            <button type="button" onClick={loadReadiness} className="h-8 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">重新检查</button>
          </div>
        )}
      >
        {readinessError && <AdminError message={readinessError} retry={loadReadiness} />}
        {!readiness && !readinessError && <AdminLoading label="正在执行上线检查" rows={3} />}
        {readiness && (
          <div className="flex flex-col gap-2" data-testid="launch-readiness">
            {readiness.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-start gap-2 border-b border-border pb-2 last:border-b-0" data-testid={`readiness-${item.id}`} data-level={item.level}>
                <StatusBadge tone={item.level === 'error' ? 'danger' : item.level === 'warning' ? 'warning' : 'success'}>
                  {item.level === 'error' ? '错误' : item.level === 'warning' ? '警告' : '正常'}
                </StatusBadge>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{item.detail}</p>
                  {item.action && <p className="mt-0.5 text-[11px] leading-5 text-studio-warn">建议：{item.action}</p>}
                </div>
              </div>
            ))}
            <p className="text-[11px] leading-5 text-muted-foreground">
              检查时间：{formatAdminDate(readiness.checkedAt)}。
              {readiness.passed
                ? '没有发现阻断上线的配置错误；警告项请结合业务确认。'
                : `存在 ${readiness.errors} 项阻断上线的错误，请先处理后再开始收费。`}
            </p>
          </div>
        )}
      </AdminSectionCard>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">统计窗口：近 {overview?.windowDays ?? days} 天 · 平均耗时 {formatAdminDuration(summary.averageDurationMs)}</p>
        <div className="flex gap-1.5">
          {[1, 7, 30].map((value) => (
            <button key={value} type="button" onClick={() => setDays(value)} aria-pressed={days === value} className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${days === value ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}>
              {value === 1 ? '今日' : `近 ${value} 日`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStat label="今日调用数" value={formatAdminNumber(todayValue)} detail={`窗口内累计 ${formatAdminNumber(total)} 次`} />
        <AdminStat label={`近 ${overview?.windowDays ?? days} 日调用`} value={formatAdminNumber(total)} detail={`成功 ${formatAdminNumber(success)} · 失败 ${formatAdminNumber(failed)}`} />
        <AdminStat label="成功率" value={`${successRate.toFixed(1)}%`} detail="按生成记录统计" tone="success" />
        <AdminStat label="失败率" value={`${failureRate.toFixed(1)}%`} detail={`失败 ${formatAdminNumber(failed)} 次`} tone={failureRate > 10 ? 'danger' : 'neutral'} />
        <AdminStat label="活跃用户" value={formatAdminNumber(overview?.activeUsers)} detail="窗口内有调用的用户" />
        <AdminStat label="排队与执行中" value={formatAdminNumber(queueCount)} detail={`待处理 ${formatAdminNumber(summary.byStatus.pending)} · 执行 ${formatAdminNumber(summary.byStatus.running)}`} tone={queueCount ? 'warning' : 'neutral'} />
        <AdminStat label="今日收入" value={formatAdminMoney(paidCents)} detail={`已支付订单 ${formatAdminNumber(finance?.orders.paid)} 笔`} tone="success" />
        <AdminStat label="退款金额" value={formatAdminMoney(refundCents)} detail={`退款订单 ${formatAdminNumber(finance?.orders.refunded)} 笔`} tone={refundCents ? 'warning' : 'neutral'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <AdminSectionCard title="调用趋势" description={`近 ${overview?.windowDays ?? days} 天的生成请求数量`} action={<StatusBadge tone="success">真实接口数据</StatusBadge>}>
          {daily.length ? (
            <div className="flex h-48 items-end gap-2 border-b border-l border-border px-3 pt-4 sm:gap-4">
              {daily.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{formatAdminNumber(item.value)}</span>
                  <div className="w-full max-w-12 rounded-t bg-foreground/80" style={{ height: `${Math.max(4, ((Number(item.value) || 0) / maxDaily) * 118)}px` }} title={`${item.label}: ${item.value}`} />
                  <span className="max-w-full truncate text-[10px] text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          ) : <AdminEmpty title="暂无调用数据" description="产生生成请求后，这里会展示趋势。" />}
        </AdminSectionCard>

        <AdminSectionCard title="模型调用排行" description="按调用次数排序" action={<TrendingUp className="size-4 text-muted-foreground" />}>
          {(overview?.modelDistribution ?? []).length ? (
            <div className="flex flex-col gap-4">
              {(overview?.modelDistribution ?? []).slice(0, 6).map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate" title={item.label}>{item.label}</span>
                    <span className="shrink-0 text-muted-foreground">{formatAdminNumber(item.value)} · {Number(item.percent || 0).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, Number(item.percent) || 0)}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <p className="py-8 text-center text-xs text-muted-foreground">暂无模型分布数据</p>}
        </AdminSectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {distributions.map((group) => (
          <AdminSectionCard key={group.title} title={group.title} description="按窗口内请求占比统计">
            {group.items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-left text-xs">
                  <thead className="text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">分类</th><th className="py-2 pr-3 font-medium">数量</th><th className="py-2 font-medium">占比</th></tr></thead>
                  <tbody>{group.items.map((item, index) => <tr key={`${item.label}-${index}`} className="border-t border-border"><td className="py-2 pr-3">{item.label}</td><td className="py-2 pr-3">{formatAdminNumber(item.value)}</td><td className="py-2">{Number(item.percent || 0).toFixed(1)}%</td></tr>)}</tbody>
                </table>
              </div>
            ) : <p className="py-6 text-center text-xs text-muted-foreground">暂无分布数据</p>}
          </AdminSectionCard>
        ))}
      </div>

      <AdminSectionCard title="渠道成功率" description="按渠道汇总窗口内尝试结果与运行时健康状态" action={<Layers3 className="size-4 text-muted-foreground" />}>
        {data?.channels.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-muted-foreground"><tr>{['渠道', '能力', '绑定模型', '成功率', '最近延迟', '运行状态'].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {data.channels.slice(0, 12).map((channel, index) => {
                  const runtime = channel.planningRuntime
                  const attempts = (runtime?.successCount || 0) + (runtime?.failureCount || 0)
                  const rate = attempts ? ((runtime?.successCount || 0) / attempts) * 100 : null
                  return (
                    <tr key={`${channel.id}-${channel.logicalModelId}-${index}`} className="border-t border-border">
                      <td className="max-w-[220px] py-2 pr-3"><p className="truncate font-medium">{channel.name || channel.id}</p><p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{channel.id}</p></td>
                      <td className="py-2 pr-3">{labelOf(capabilityLabels, channel.capability)}</td>
                      <td className="max-w-[180px] truncate py-2 pr-3">{channel.logicalModelName || channel.upstreamModel}</td>
                      <td className="py-2 pr-3">{rate === null ? '-' : `${rate.toFixed(1)}%`}{attempts ? <span className="ml-1 text-muted-foreground">({runtime?.successCount}/{attempts})</span> : null}</td>
                      <td className="py-2 pr-3">{formatAdminDuration(runtime?.averageLatencyMs)}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge tone={channel.runtimeHealth.status === 'healthy' ? 'success' : 'warning'}>{channel.runtimeHealth.status === 'healthy' ? '正常' : '冷却中'}</StatusBadge>
                        {channel.runtimeHealth.consecutiveFailures > 0 && <p className="mt-1 text-[11px] text-destructive">连续失败 {channel.runtimeHealth.consecutiveFailures} 次</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <AdminEmpty title="暂无渠道数据" description="配置上游渠道后，这里会展示各渠道的成功率。" />}
      </AdminSectionCard>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        <AdminSectionCard title="最近订单" description="最新 5 笔订单及支付状态" action={<CircleDollarSign className="size-4 text-muted-foreground" />}>
          <AdminTable columns={['订单号', '用户', '商品', '金额', '状态', '时间']} minWidth={720} caption="最近订单">
            {(data?.recentOrders ?? []).map((order) => (
              <AdminRow key={order.id}>
                <AdminCell className="font-mono text-xs">{order.orderNo}</AdminCell>
                <AdminCell className="text-xs">{order.userUsername || order.userDisplayName || '-'}</AdminCell>
                <AdminCell className="max-w-[200px] truncate text-xs">{order.subject}</AdminCell>
                <AdminCell className="text-xs">{formatAdminMoney(order.amountCents, order.currency)}</AdminCell>
                <AdminCell><StatusBadge tone={statusTone(order.status)}>{labelOf(orderStatusLabels, order.status)}</StatusBadge></AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(order.createdAt)}</AdminCell>
              </AdminRow>
            ))}
            {!(data?.recentOrders ?? []).length && <TableMessageRow colSpan={6} loading={false} empty="暂无订单" />}
          </AdminTable>
        </AdminSectionCard>

        <AdminSectionCard title="运营健康" description="基于真实接口的关键风险指标">
          <div className="flex flex-col gap-3 text-xs">
            <HealthRow icon={CheckCircle2} label="生成成功率" value={`${successRate.toFixed(1)}%`} tone={successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'danger'} />
            <HealthRow icon={Clock} label="平均响应时间" value={formatAdminDuration(summary.averageDurationMs)} tone="neutral" />
            <HealthRow icon={Activity} label="累计积分消耗" value={formatAdminNumber(summary.totalPointsCost)} tone="neutral" />
            <HealthRow icon={Users} label="订单转化" value={`${formatAdminNumber(finance?.commerce.convertedOrders)} / ${formatAdminNumber(finance?.orders.total)}`} tone="neutral" />
            <HealthRow
              icon={AlertTriangle}
              label="对账异常"
              value={formatAdminNumber((finance?.reconciliation.paidOrdersWithoutSucceededPayment || 0) + (finance?.reconciliation.succeededPaymentsWithoutPaidOrder || 0) + (finance?.reconciliation.amountMismatchPayments || 0))}
              tone={(finance?.reconciliation.amountMismatchPayments || 0) > 0 ? 'danger' : 'success'}
            />
          </div>
        </AdminSectionCard>
      </div>
    </div>
  )
}

function HealthRow({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2.5 last:border-b-0 last:pb-0">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="size-3.5" />{label}</span>
      <StatusBadge tone={tone === 'neutral' ? 'muted' : tone}>{value}</StatusBadge>
    </div>
  )
}
