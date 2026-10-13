import { getFinanceSummary, getGenerationOverview, listBillingOrders, listGenerationOperations } from './admin-api'
import type { AdminGenerationChannel, AdminGenerationOperations, AdminGenerationOverview, AdminPermission, BillingOrder, FinanceSummary } from './admin-types'

export type OverviewResource<T> =
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string }
  | { status: 'forbidden' }

export type AdminOverviewSnapshot = {
  analytics: OverviewResource<AdminGenerationOverview>
  generation: OverviewResource<AdminGenerationOperations>
  finance: OverviewResource<FinanceSummary>
  orders: OverviewResource<BillingOrder[]>
  loadedAt: string
}

export function adminOverviewAccess(permissions: readonly AdminPermission[]) {
  return {
    analytics: permissions.includes('analytics.read'),
    generation: permissions.includes('generation.read'),
    billing: permissions.includes('billing.read'),
    readiness: ['system.manage', 'upstream.manage', 'billing.manage'].some((permission) => permissions.includes(permission as AdminPermission)),
  }
}

const defaultSources = {
  analytics: () => getGenerationOverview(),
  generation: () => listGenerationOperations({ page: 1, pageSize: 5 }),
  finance: getFinanceSummary,
  orders: async () => (await listBillingOrders({ page: 1, pageSize: 5 })).items,
}

/** Independent permissions and failures: unavailable money must never become a zero balance. */
export async function loadAdminOverview(permissions: readonly AdminPermission[], sources = defaultSources): Promise<AdminOverviewSnapshot> {
  const access = adminOverviewAccess(permissions)
  async function read<T>(allowed: boolean, load: () => Promise<T | null>): Promise<OverviewResource<T>> {
    if (!allowed) return { status: 'forbidden' }
    try {
      const data = await load()
      if (data === null || data === undefined) throw new Error('服务没有返回统计结果')
      return { status: 'ready', data }
    } catch (reason) {
      return { status: 'error', error: reason instanceof Error ? reason.message : '读取失败，请重试' }
    }
  }
  const [analytics, generation, finance, orders] = await Promise.all([
    read(access.analytics, sources.analytics),
    read(access.generation, sources.generation),
    read(access.billing, sources.finance),
    read(access.billing, sources.orders),
  ])
  return { analytics, generation, finance, orders, loadedAt: new Date().toISOString() }
}

export function overviewDateKey(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

/** Backend analytics has a fixed seven-day window in UTC+8; match dates, never the last arbitrary bucket. */
export function generationOverviewMetrics(overview: AdminGenerationOverview, now: Date) {
  const today = overview.dailyCalls.find((item) => item.date === overviewDateKey(now))
  return {
    todayCalls: today ? today.value : null,
    successRate: overview.totalCalls > 0 ? (overview.successCalls / overview.totalCalls) * 100 : null,
    failureRate: overview.totalCalls > 0 ? (overview.failedCalls / overview.totalCalls) * 100 : null,
  }
}

export function channelNeedsAttention(channel: AdminGenerationChannel) {
  return channel.enabled && (channel.runtimeHealth.status === 'cooling' || channel.runtimeHealth.consecutiveFailures > 0)
}

export type OverviewAttention = { id: string; title: string; count: number; detail: string; href: string; tone: 'danger' | 'warning' | 'neutral' }

export function overviewAttention(snapshot: AdminOverviewSnapshot): OverviewAttention[] {
  const attention: OverviewAttention[] = []
  if (snapshot.generation.status === 'ready') {
    const { summary, channels } = snapshot.generation.data
    const paused = summary.byStatus.paused || 0
    const active = (summary.byStatus.pending || 0) + (summary.byStatus.running || 0)
    const channelCount = new Set(channels.filter(channelNeedsAttention).map((channel) => channel.id)).size
    if (paused > 0) attention.push({ id: 'paused', title: '暂停的任务', count: paused, detail: '检查任务详情，再决定是否继续。', href: '/admin/generation', tone: 'warning' })
    if (channelCount > 0) attention.push({ id: 'channels', title: '需关注的渠道', count: channelCount, detail: '已启用渠道有连续失败或正在冷却。', href: '/admin/generation', tone: 'danger' })
    if (summary.failed > 0) attention.push({ id: 'failed', title: '失败任务记录', count: summary.failed, detail: '累计失败状态记录，可到生成运营排查。', href: '/admin/generation', tone: 'danger' })
    if (active > 0) attention.push({ id: 'active', title: '排队与执行中', count: active, detail: `排队 ${summary.byStatus.pending || 0} · 执行 ${summary.byStatus.running || 0}`, href: '/admin/generation', tone: 'neutral' })
  }
  if (snapshot.finance.status === 'ready') {
    const { orders, reconciliation } = snapshot.finance.data
    const anomalies = reconciliation.paidOrdersWithoutSucceededPayment + reconciliation.succeededPaymentsWithoutPaidOrder + reconciliation.amountMismatchPayments
    if (anomalies > 0) attention.push({ id: 'reconciliation', title: '对账异常项', count: anomalies, detail: '包含支付缺失、订单状态或金额不一致；同笔可能涉及多项。', href: '/admin/orders', tone: 'danger' })
    if (orders.pending > 0) attention.push({ id: 'pending-orders', title: '待支付订单', count: orders.pending, detail: '当前待支付状态，不代表订单异常。', href: '/admin/orders', tone: 'neutral' })
  }
  return attention.sort((left, right) => ({ danger: 0, warning: 1, neutral: 2 })[left.tone] - ({ danger: 0, warning: 1, neutral: 2 })[right.tone])
}
