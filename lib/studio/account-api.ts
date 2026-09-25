/**
 * OAOOAO 账户侧真实数据访问层。
 *
 * 覆盖三类后端事实来源：
 * - `/api/points`：积分流水（消费 / 退款 / 充值 / 赠送 / 过期），账单统计的唯一依据。
 * - `/api/generation-logs`：生成历史与结果资产，作品列表与素材选择的依据。
 * - `/api/referrals`：邀请码、邀请关系与奖励。
 *
 * 页面只消费这里归一化后的结果；分页与聚合都来自服务端，
 * 本地缓存仅用于加速，不作为唯一索引。
 */
import { request, StudioApiError } from './api'
import { summarizePointRecordsWith, type LedgerSummary, type PointRecord, type PointRecordPage } from './ledger'
import { WORK_ID_PREFIX } from './reference-selection'

/* -------------------------------- 积分流水 -------------------------------- */

// 分类与聚合口径在 `./ledger` 中实现（纯函数，可单独测试）；
// 这里只负责把后端分页接口接上。
export {
  ledgerCategoryLabels,
  ledgerCategoryOf,
  ledgerMonthOf,
  summarizeLedgerMonth,
  currentLedgerMonth,
  type LedgerCategory,
  type LedgerSummary,
  type LedgerMonthSummary,
  type LedgerTrendRow,
  type LedgerSummaryRow,
  type PointRecord,
  type PointRecordType,
} from './ledger'

export async function listPointRecords(params: { page?: number; pageSize?: number; direction?: 'credit' | 'debit' } = {}): Promise<PointRecordPage> {
  const search = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) })
  if (params.direction) search.set('direction', params.direction)
  const payload = await request<{ records?: PointRecord[]; total?: number; page?: number; pageSize?: number }>(`/api/points?${search.toString()}`)
  return {
    records: payload.records ?? [],
    total: Number(payload.total) || 0,
    page: Number(payload.page) || params.page || 1,
    pageSize: Number(payload.pageSize) || params.pageSize || 20,
  }
}

/**
 * 逐页聚合全部积分流水。
 * 统计口径见 `./ledger`；达到页数上限时返回 truncated，页面必须如实展示。
 */
export function summarizePointRecords(options: { maxPages?: number; pageSize?: number } = {}): Promise<LedgerSummary> {
  return summarizePointRecordsWith((params) => listPointRecords(params), options)
}

/* ------------------------------ 生成历史与作品 ------------------------------ */

export type GenerationAsset = { type?: string; url: string; serverUrl?: string; poster?: string; mimeType?: string; width?: number; height?: number }

export type GenerationHistoryItem = {
  id: string
  taskId?: string
  kind: string
  status: string
  title: string
  prompt: string
  model?: string
  source?: string
  durationMs?: number
  pointsCost?: number
  pointsRefunded?: boolean
  assets: GenerationAsset[]
  error?: string
  createdAt?: string
}

export type GenerationHistoryPage = { items: GenerationHistoryItem[]; total: number; page: number; pageSize: number }

/**
 * 作品只来自「有结果资产且成功」的记录。
 * 后端把结果资产放在 generation-logs.assets，权限由该接口自身按用户归属校验。
 */
export type StudioWork = {
  id: string
  taskId?: string
  title: string
  kind: 'image' | 'video' | 'audio'
  src: string
  poster?: string
  fallback: string
  status: '已完成'
  createdAt?: string
  model?: string
  prompt: string
  durationMs?: number
  taskStatus: string
}

function normalizeAsset(raw: Record<string, unknown>): GenerationAsset | null {
  const url = String(raw.serverUrl || raw.url || '')
  if (!url) return null
  return {
    url,
    serverUrl: raw.serverUrl ? String(raw.serverUrl) : undefined,
    type: raw.type ? String(raw.type) : undefined,
    poster: raw.poster ? String(raw.poster) : undefined,
    mimeType: raw.mimeType ? String(raw.mimeType) : undefined,
    width: Number(raw.width) || undefined,
    height: Number(raw.height) || undefined,
  }
}

export async function listGenerationHistory(params: { page?: number; pageSize?: number; kind?: string; status?: string } = {}): Promise<GenerationHistoryPage> {
  const search = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 24) })
  if (params.kind) search.set('kind', params.kind)
  if (params.status) search.set('status', params.status)
  const payload = await request<{ items?: Array<Record<string, unknown>>; total?: number; page?: number; pageSize?: number }>(`/api/generation-logs?${search.toString()}`)
  const items = (payload.items ?? []).map(toHistoryItem).filter((item): item is GenerationHistoryItem => Boolean(item))
  return { items, total: Number(payload.total) || 0, page: Number(payload.page) || params.page || 1, pageSize: Number(payload.pageSize) || params.pageSize || 24 }
}

function toHistoryItem(raw: Record<string, unknown>): GenerationHistoryItem | null {
  const id = String(raw.id || '')
  if (!id) return null
  const assets = Array.isArray(raw.assets) ? raw.assets.flatMap((asset) => (asset && typeof asset === 'object' ? [normalizeAsset(asset as Record<string, unknown>)].filter(Boolean) as GenerationAsset[] : [])) : []
  const billing = raw.billing && typeof raw.billing === 'object' ? (raw.billing as Record<string, unknown>) : undefined
  return {
    id,
    taskId: raw.taskId ? String(raw.taskId) : undefined,
    kind: String(raw.kind || 'image'),
    status: String(raw.status || 'unknown'),
    title: String(raw.title || raw.prompt || id),
    prompt: String(raw.prompt || ''),
    model: raw.model ? String(raw.model) : undefined,
    source: raw.source ? String(raw.source) : undefined,
    durationMs: Number(raw.durationMs) || undefined,
    pointsCost: Number(raw.pointsCost) || Number(billing?.pointsCost) || undefined,
    pointsRefunded: raw.pointsRefunded === true || billing?.refunded === true,
    assets,
    error: raw.error ? String(raw.error) : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
  }
}

/** 把成功且带资产的记录拍平成作品条目，供「我的作品」与素材选择使用。 */
export function historyToWorks(items: GenerationHistoryItem[]): StudioWork[] {
  const works: StudioWork[] = []
  for (const item of items) {
    if (item.status !== 'success' || !item.assets.length) continue
    const kind = item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'image'
    item.assets.forEach((asset, index) => {
      works.push({
        id: `${item.id}-${index}`,
        taskId: item.taskId,
        title: item.assets.length > 1 ? `${item.title} · ${index + 1}` : item.title,
        kind,
        src: asset.url,
        poster: asset.poster,
        fallback: item.title,
        status: '已完成',
        createdAt: item.createdAt,
        model: item.model,
        prompt: item.prompt,
        durationMs: item.durationMs,
        taskStatus: item.status,
      })
    })
  }
  return works
}

/** 逐页拉取全部作品。用于作品页需要完整计数与分页展示的场景。 */
export async function listAllWorks(options: { maxPages?: number; pageSize?: number; kind?: string } = {}): Promise<{ works: StudioWork[]; total: number; scanned: number; truncated: boolean }> {
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 24))
  const maxPages = Math.max(1, options.maxPages ?? 20)
  const works: StudioWork[] = []
  let total = 0
  let scanned = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listGenerationHistory({ page, pageSize, kind: options.kind })
    total = result.total
    scanned += result.items.length
    works.push(...historyToWorks(result.items))
    if (result.items.length < pageSize || scanned >= total) break
  }
  return { works, total, scanned, truncated: scanned < total }
}

/**
 * **定向**校验若干生成作品 id 是否仍然存在。
 *
 * 为什么不复用 `listAllWorks`：它按"作品页"的语义一次拉 20×24=480 条，
 * 而生成记录可能远超这个量（本机实测 944 条）→ 永远 `truncated` →
 * 存活证据永远是 `unavailable` → **已删除的作品永远清不掉**（实测踩到）。
 *
 * 这里的做法不同：只关心**传入的那几个 id**，因此
 *  1. 一旦全部找到就**提前结束**（最常见的"作品还在"只需 1 次请求）；
 *  2. 只有"要判定删除"时才需要读到底，此时以 `total` 为准判断是否读完；
 *  3. 读到底仍未找到 → 该 id 确实不存在（可判定删除）；
 *  4. 达到页数上限仍未读完 → `complete=false`，调用方**不得**判定删除。
 *
 * 返回结构直接对应 `LiveSourceEvidence` 需要的"是否取得完整证据"。
 */
export async function findExistingWorkIds(
  ids: readonly string[],
  options: { kind?: string; pageSize?: number; maxPages?: number } = {},
): Promise<{ found: Set<string>; complete: boolean }> {
  const wanted = new Set(ids)
  const found = new Set<string>()
  if (!wanted.size) return { found, complete: true }
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 50))
  const maxPages = Math.max(1, options.maxPages ?? 60)
  let scanned = 0
  let total = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listGenerationHistory({ page, pageSize, kind: options.kind })
    total = result.total
    scanned += result.items.length
    for (const work of historyToWorks(result.items)) {
      if (wanted.has(`${WORK_ID_PREFIX}${work.id}`)) found.add(`${WORK_ID_PREFIX}${work.id}`)
    }
    /** 全部找到 → 提前结束，不必读完整库。 */
    if (found.size === wanted.size) return { found, complete: true }
    if (result.items.length < pageSize || scanned >= total) break
  }
  /** 读到底（本次已覆盖 total）才算完整证据；否则调用方不得判定删除。 */
  return { found, complete: scanned >= total }
}

/* -------------------------------- 邀请中心 -------------------------------- */

export type ReferralCenter = {
  program: { enabled: boolean; inviterPoints: number; inviteeRewardType: string; inviteePoints: number; minimumPaidCents: number; coolingOffDays: number }
  code: string
  link: string
  stats: { clicks: number; registrations: number; qualified: number; pending: number; settled: number; revoked: number }
  referrals: Array<Record<string, unknown>>
  referralsTotal: number
  rewards: Array<Record<string, unknown>>
  rewardsTotal: number
}

export async function getReferralCenter(params: { referralsPage?: number; rewardsPage?: number; pageSize?: number } = {}): Promise<ReferralCenter | null> {
  const search = new URLSearchParams()
  if (params.referralsPage) search.set('referralsPage', String(params.referralsPage))
  if (params.rewardsPage) search.set('rewardsPage', String(params.rewardsPage))
  if (params.pageSize) search.set('pageSize', String(params.pageSize))
  const query = search.toString()
  const payload = await request<{ code?: number; data?: ReferralCenter; msg?: string }>(`/api/referrals${query ? `?${query}` : ''}`)
  if (typeof payload.code === 'number' && payload.code !== 0) throw new StudioApiError(payload.msg || '邀请数据加载失败', payload.code)
  return payload.data ?? null
}

export function isAccountApiError(error: unknown) {
  return error instanceof StudioApiError
}

/* ------------------------------ 账户资料与安全 ------------------------------ */

/** 后端会话里的用户对象。emailVerified 只在后端确认后为 true。 */
export type AccountProfile = {
  id: string
  username?: string
  email?: string
  displayName?: string
  bio?: string
  avatarUrl?: string
  role?: string
  planId?: string
  planName?: string
  hasActivePlan?: boolean
  pointsBalance?: number
  permanentPointsBalance?: number
  dailyPointsBalance?: number
  dailyPointsExpiresAt?: string
  createdAt?: string
  lastLoginAt?: string
}

/** 修改昵称与简介。邮箱变更必须带验证码，由后端校验。 */
export function updateProfile(input: { displayName?: string; bio?: string; email?: string; emailCode?: string }) {
  return request<{ user: AccountProfile }>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(input) })
}

/** 修改密码成功后后端会清除会话，前端需要跳回登录页。 */
export function updatePassword(input: { currentPassword: string; newPassword: string }) {
  return request<{ ok: boolean }>('/api/auth/password', { method: 'PATCH', body: JSON.stringify(input) })
}

export function requestEmailCode(input: { purpose: 'register' | 'email-change' | 'password-reset'; email: string }) {
  return request<{ ok?: boolean; expiresInSeconds?: number; devCode?: string }>('/api/auth/email-code', { method: 'POST', body: JSON.stringify(input) })
}

export function resetPasswordByEmail(input: { email: string; code: string; newPassword: string }) {
  return request<{ ok: boolean }>('/api/auth/password/reset', { method: 'POST', body: JSON.stringify(input) })
}

export type RegisterInput = {
  username: string
  password: string
  email?: string
  emailCode?: string
  displayName?: string
  referralCode?: string
  policyAccepted: boolean
}

export function registerAccount(input: RegisterInput) {
  return request<{ user: AccountProfile }>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) })
}

export function logout() {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
}

/* ------------------------------ 订单与支付状态 ------------------------------ */

export type BillingOrderView = {
  id: string
  orderNo: string
  productId: string
  status: string
  subject: string
  amountCents: number
  currency: string
  pointsAmount?: number
  dailyPoints?: number
  periodDays?: number
  provider?: string
  expiresAt?: string
  createdAt: string
}

export type CheckoutView = {
  provider: string
  orderId: string
  orderNo: string
  kind: 'manual' | 'redirect' | 'form' | 'qr'
  url?: string
  qrContent?: string
  form?: { action: string; method: string; fields: Array<{ name: string; value: string }> }
  expiresAt?: string
}

export async function listAccountOrders(params: { page?: number; pageSize?: number } = {}) {
  const search = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) })
  const payload = await request<{ orders?: BillingOrderView[]; total?: number; page?: number; pageSize?: number }>(`/api/billing/orders?${search.toString()}`)
  return { orders: payload.orders ?? [], total: Number(payload.total) || 0, page: Number(payload.page) || 1, pageSize: Number(payload.pageSize) || 20 }
}

export function getAccountOrder(id: string) {
  return request<{ order: BillingOrderView }>(`/api/billing/orders/${encodeURIComponent(id)}`)
}

/** 继续支付：为待支付订单重新获取支付参数。 */
export async function resumeCheckout(orderId: string, provider: string): Promise<CheckoutView> {
  const payload = await request<{ code?: number; msg?: string; data?: { checkout?: CheckoutView }; checkout?: CheckoutView }>(
    `/api/billing/orders/${encodeURIComponent(orderId)}/checkout`,
    { method: 'POST', body: JSON.stringify({ provider }) },
  )
  const checkout = payload.data?.checkout ?? payload.checkout
  if (!checkout) throw new StudioApiError(payload.msg || '支付参数响应无效', 502)
  return checkout
}

export function cancelAccountOrder(orderId: string, reason?: string) {
  return request<{ order?: BillingOrderView }>(`/api/billing/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
}

/* ------------------------------- 素材库（服务端持久化） ------------------------------- */

/**
 * 落库素材。媒体类素材必须已经保存到服务器（后端拒绝 `data:` / `blob:` URL），
 * 因此上传流程是「先 persistent 上传拿到 key+url，再登记素材」。
 */
export type LibraryAssetView = {
  id: string
  kind: 'image' | 'video' | 'audio' | 'text'
  title: string
  coverUrl?: string
  tags: string[]
  source?: string
  note?: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type LibraryAssetPage = { assets: LibraryAssetView[]; total: number; page: number; pageSize: number }

export async function listLibraryAssets(params: { page?: number; pageSize?: number; kind?: string; keyword?: string } = {}): Promise<LibraryAssetPage> {
  const search = new URLSearchParams()
  search.set('page', String(params.page ?? 1))
  search.set('pageSize', String(params.pageSize ?? 60))
  if (params.kind) search.set('kind', params.kind)
  if (params.keyword) search.set('keyword', params.keyword)
  const payload = await request<{ code?: number; msg?: string; data?: LibraryAssetPage }>(`/api/library-assets?${search.toString()}`)
  if (typeof payload.code === 'number' && payload.code !== 0) throw new StudioApiError(payload.msg || '素材加载失败', payload.code)
  return {
    assets: payload.data?.assets ?? [],
    total: Number(payload.data?.total) || 0,
    page: Number(payload.data?.page) || 1,
    pageSize: Number(payload.data?.pageSize) || 60,
  }
}

/**
 * 逐页取**全部**素材库条目，用于"某个已选素材是否真的被删除"的判定。
 *
 * 为什么需要它：后端 `listLibraryAssetPageForUser` 把 `pageSize` 限制在 **100**，
 * 所以"请求 pageSize=500 拿第一页"**并不是**全集 ——
 * 素材超过 100 条时，第 101 条之后会被当成"不存在"而误报已删除（本轮缺陷）。
 *
 * 完整性必须显式判定，不能靠"请求了一大页"来暗示：
 *  - 逐页读到 `scanned >= total` 才算 `complete`；
 *  - 达到 `maxPages`/`maxItems` 上限仍未读完 → `truncated`，调用方**不得**据此判定删除；
 *  - 任何一页失败都向上抛，由调用方降级为"证据不可用"。
 */
export async function listAllLibraryAssetIds(
  options: { maxPages?: number; maxItems?: number; kind?: string } = {},
): Promise<{ ids: string[]; total: number; scanned: number; truncated: boolean }> {
  const pageSize = 100
  const maxPages = Math.max(1, options.maxPages ?? 50)
  const maxItems = Math.max(1, options.maxItems ?? 5000)
  const ids: string[] = []
  const seen = new Set<string>()
  let total = 0
  let scanned = 0
  let truncated = false
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listLibraryAssets({ page, pageSize, kind: options.kind })
    total = result.total
    scanned += result.assets.length
    for (const asset of result.assets) {
      if (seen.has(asset.id)) continue
      seen.add(asset.id)
      ids.push(asset.id)
      if (ids.length >= maxItems) break
    }
    // 读完了（本页不足一页，或已覆盖 total），或达到条目上限。
    if (result.assets.length < pageSize || scanned >= total) break
    if (ids.length >= maxItems) { truncated = scanned < total; break }
    if (page === maxPages) truncated = scanned < total
  }
  return { ids, total, scanned, truncated }
}

export async function createLibraryAsset(input: {
  kind: 'image' | 'video' | 'audio' | 'text'
  title: string
  coverUrl?: string
  tags?: string[]
  source?: string
  note?: string
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<LibraryAssetView> {
  const payload = await request<{ code?: number; msg?: string; data?: { asset?: LibraryAssetView } }>('/api/library-assets', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (typeof payload.code === 'number' && payload.code !== 0) throw new StudioApiError(payload.msg || '素材保存失败', payload.code)
  const asset = payload.data?.asset
  if (!asset) throw new StudioApiError('素材保存失败：后端没有返回素材', 502)
  return asset
}

export async function deleteLibraryAsset(id: string) {
  return request<{ code?: number; msg?: string }>(`/api/library-assets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * 上传一个文件到服务器并取得**持久**地址。
 *
 * `persistent: true` 是必须的：临时引用会在过期后被清理，
 * 素材库需要长期可访问的 URL，否则刷新后素材变成坏链。
 */
export async function uploadPersistentAsset(file: File, kind: 'image' | 'video' | 'audio'): Promise<{ key: string; url: string; bytes: number; mimeType: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('type', kind)
  form.append('persistent', 'true')
  // 注意：不能设置 content-type，浏览器需要自己补 multipart 边界。
  const response = await fetch('/api/reference-assets', { method: 'POST', body: form, credentials: 'include' })
  const text = await response.text()
  let payload: { error?: string; key?: string; url?: string; bytes?: number; mimeType?: string } | null = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = null }
  if (!response.ok) throw new StudioApiError(payload?.error || `上传失败（HTTP ${response.status}）`, response.status, payload)
  const url = payload?.url
  const key = payload?.key
  if (!url || !key) throw new StudioApiError(payload?.error || '上传失败：后端没有返回可访问地址', 502, payload)
  return { key, url, bytes: Number(payload?.bytes) || file.size, mimeType: payload?.mimeType || file.type || '' }
}

/** 用 canvas 读取图片真实尺寸，用于素材卡片按比例展示。 */
export async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return size
  } catch {
    return null
  }
}
