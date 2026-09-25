/**
 * 积分流水分类与聚合（纯函数，无网络依赖）。
 *
 * 从这里拆出来是因为统计口径是账单正确性的核心，必须能被单独测试：
 * 分页聚合、跨月归属、类型分类都不应该和 HTTP 请求耦合在一起。
 *
 * 事实来源是后端 `/api/points`：`type` 与 `idempotencyKey` 由服务端给出，
 * 前端只做分类与求和，不自行推断金额方向。
 */

/** 后端 point record 的 type 取值。金额正负由后端给出，前端不再自行推断。 */
export type PointRecordType = 'consume' | 'refund' | 'recharge' | 'grant' | 'expire' | 'adjust' | string

export type PointRecord = {
  id: string
  type: PointRecordType
  amount: number
  balanceAfter: number
  permanentAmount: number
  dailyAmount: number
  permanentBalanceAfter: number
  dailyBalanceAfter: number
  description?: string
  model?: string
  idempotencyKey?: string
  sourceRecordId?: string
  sourceDate?: string
  createdAt: string
}

/**
 * 账务分类。
 *
 * 区分依据是后端给出的 `type`（辅以 `idempotencyKey`），而不是金额正负——
 * 退款金额可能为 0（例如未实际扣费），按正负号判断会把 0 元退款算成「无方向」。
 *
 * 后端实际写入的 type 只有四种，但同一个 type 承载多种业务：
 * - `consume`：生成扣费；
 * - `refund`：生成任务失败退回（idempotencyKey 前缀 `points-refund:`）；
 * - `credit`：订单支付充值（`billing-order:*:credit`）或邀请奖励（`referral-reward:*:credit`）；
 * - `admin-adjust`：**既用于订单退款**（`billing-order:*:refund`，金额为负，把已发放积分扣回）
 *   **也用于管理员手工调整**（`admin-adjust:*`，金额可正可负）。
 *
 * 因此必须看 idempotencyKey：订单退款在业务上是「退款」，算进「调整」会让
 * 用户看到的退款金额少算、调整金额多算。
 */
export type LedgerCategory = 'consume' | 'refund' | 'recharge' | 'grant' | 'expire' | 'adjust'

export const ledgerCategoryLabels: Record<LedgerCategory, string> = {
  consume: '消费',
  refund: '退款',
  recharge: '充值',
  grant: '赠送',
  expire: '过期',
  adjust: '调整',
}

export function ledgerCategoryOf(type: PointRecordType, options: { amount?: number; idempotencyKey?: string } = {}): LedgerCategory {
  const key = options.idempotencyKey || ''
  switch (type) {
    case 'consume': return 'consume'
    case 'refund': return 'refund'
    case 'expire': return 'expire'
    case 'grant': return 'grant'
    case 'recharge': return 'recharge'
    case 'credit':
      // 邀请奖励属于「赠送」，订单支付才属于「充值」。
      return key.startsWith('referral-reward:') ? 'grant' : 'recharge'
    case 'admin-adjust':
      // 订单退款（billing-order:<id>:refund）在业务上是退款，不是人工调整。
      if (key.endsWith(':refund') || key.startsWith('points-refund:')) return 'refund'
      return 'adjust'
    default: return 'adjust'
  }
}

export type LedgerSummaryRow = { category: LedgerCategory; amount: number; count: number }
export type LedgerTrendRow = { date: string; consume: number; refund: number; recharge: number; grant: number; expire: number }
export type LedgerSummary = {
  rows: LedgerSummaryRow[]
  totals: Record<LedgerCategory, number>
  trend: LedgerTrendRow[]
  /** 参与统计的流水条数与实际扫描页数，用于向用户说明统计范围。 */
  scanned: number
  scannedPages: number
  truncated: boolean
  firstDate?: string
  lastDate?: string
}

export const emptyLedgerTotals: Record<LedgerCategory, number> = { consume: 0, refund: 0, recharge: 0, grant: 0, expire: 0, adjust: 0 }

/** 单页流水；由调用方注入，便于统计逻辑脱离 HTTP 单独测试。 */
export type PointRecordPage = { records: PointRecord[]; total: number; page: number; pageSize: number }
export type PointRecordFetcher = (params: { page: number; pageSize: number }) => Promise<PointRecordPage>

/**
 * 逐页拉取全部流水后聚合，避免只统计第一页导致金额偏小。
 * 后端单页上限 50，因此按 50 翻页；达到 maxPages 时标记 truncated，
 * 页面必须把这个状态展示出来，不能把不完整的合计当成完整月度统计。
 */
export async function summarizePointRecordsWith(fetchPage: PointRecordFetcher, options: { maxPages?: number; pageSize?: number } = {}): Promise<LedgerSummary> {
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 50))
  const maxPages = Math.max(1, options.maxPages ?? 40)
  const totals: Record<LedgerCategory, number> = { ...emptyLedgerTotals }
  const counts: Record<LedgerCategory, number> = { consume: 0, refund: 0, recharge: 0, grant: 0, expire: 0, adjust: 0 }
  const trendMap = new Map<string, LedgerTrendRow>()
  let scanned = 0
  let scannedPages = 0
  let page = 1
  let total = 0

  while (page <= maxPages) {
    const result = await fetchPage({ page, pageSize })
    total = result.total
    scannedPages += 1
    for (const record of result.records) {
      const category = ledgerCategoryOf(record.type, { amount: record.amount, idempotencyKey: record.idempotencyKey })
      // 金额取绝对值累计，方向由分类表达，避免退款为负数时把合计算错。
      const amount = Math.abs(Number(record.amount) || 0)
      totals[category] += amount
      counts[category] += 1
      scanned += 1
      const date = (record.sourceDate || record.createdAt || '').slice(0, 10)
      if (!date) continue
      const row = trendMap.get(date) ?? { date, consume: 0, refund: 0, recharge: 0, grant: 0, expire: 0 }
      if (category === 'consume') row.consume += amount
      else if (category === 'refund') row.refund += amount
      else if (category === 'recharge') row.recharge += amount
      else if (category === 'grant') row.grant += amount
      else if (category === 'expire') row.expire += amount
      trendMap.set(date, row)
    }
    if (result.records.length < pageSize || scanned >= total) break
    page += 1
  }

  const trend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  return {
    rows: (Object.keys(totals) as LedgerCategory[]).map((category) => ({ category, amount: totals[category], count: counts[category] })),
    totals,
    trend,
    scanned,
    scannedPages,
    truncated: scanned < total,
    firstDate: trend[0]?.date,
    lastDate: trend[trend.length - 1]?.date,
  }
}

export type LedgerMonthSummary = {
  /** 统计月份，格式 YYYY-MM。 */
  month: string
  consume: number
  refund: number
  recharge: number
  grant: number
  expire: number
  adjust: number
  /** 该月是否被统计范围截断（流水太多未扫描完）。 */
  truncated: boolean
}

/**
 * 按业务时区（Asia/Shanghai）取一条流水所属的自然月。
 *
 * 早先用 `toISOString().slice(0,7)` 取月份，用的是 UTC，
 * 会把北京时间月初 08:00 之前的流水算进上一个月，月度统计因此跨月错位。
 */
export function ledgerMonthOf(record: Pick<PointRecord, 'sourceDate' | 'createdAt'>, timeZone = 'Asia/Shanghai') {
  const source = record.sourceDate || record.createdAt || ''
  if (!source) return ''
  const parsed = new Date(source)
  if (Number.isNaN(parsed.getTime())) return source.slice(0, 7)
  // en-CA 输出 YYYY-MM-DD，取前 7 位即为该时区的自然月。
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(parsed).slice(0, 7)
}

/**
 * 从逐页聚合结果中取出某一个月的统计。
 *
 * 注意统计范围：若 `summary.truncated` 为真，说明还有更早的流水没有扫描到，
 * 月度合计可能偏小，调用方必须把这个状态展示出来。
 */
export function summarizeLedgerMonth(summary: LedgerSummary, month: string, timeZone = 'Asia/Shanghai'): LedgerMonthSummary {
  const result: LedgerMonthSummary = { month, consume: 0, refund: 0, recharge: 0, grant: 0, expire: 0, adjust: 0, truncated: summary.truncated }
  for (const row of summary.trend) {
    if (ledgerMonthOf({ sourceDate: row.date, createdAt: row.date }, timeZone) !== month) continue
    result.consume += row.consume
    result.refund += row.refund
    result.recharge += row.recharge
    result.grant += row.grant
    result.expire += row.expire
  }
  return result
}

/** 当前业务时区下的月份键。 */
export function currentLedgerMonth(timeZone = 'Asia/Shanghai', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(now).slice(0, 7)
}
