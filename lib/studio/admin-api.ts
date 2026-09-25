/**
 * OAOOAO 管理后台接口层。
 * 页面只调用这里的函数；后端字段差异在这一层收敛，页面不写兼容分支。
 */
import { request, StudioApiError } from './api'
import type {
  AdminGenerationOperations,
  AdminGenerationOverview,
  AdminGenerationTask,
  AdminSettings,
  AdminUser,
  AdminUserListPayload,
  AdminUserUpdateInput,
  Announcement,
  AnnouncementInput,
  AuditFilters,
  AuditLog,
  BillingOrder,
  BillingOrderFilters,
  BillingProduct,
  CouponTemplate,
  FinanceSummary,
  GenerationOperationFilters,
  LogicalModel,
  ObjectStorageSettings,
  ObjectStorageUpdateInput,
  PromotionCampaign,
  PublishedWork,
  ReferralOverview,
  ReferralRelationship,
  ReferralReward,
  SiteSettings,
  SystemChannel,
  SystemChannelModelFetchResult,
  SystemDefaultModels,
  WorkGovernanceCase,
} from './admin-types'

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number }

/** 后端在不同接口上分别使用裸对象、`{data}` 和 `{code,data,msg}`，这里统一解包。 */
function unwrap<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object') return payload as T
  const record = payload as Record<string, unknown>
  if ('data' in record && record.data !== null && typeof record.data === 'object') return record.data as T
  return payload as T
}

function assertOk(payload: unknown) {
  if (!payload || typeof payload !== 'object') return
  const record = payload as Record<string, unknown>
  const code = record.code
  if (typeof code === 'number' && code !== 0) throw new Error(typeof record.msg === 'string' && record.msg ? record.msg : '操作失败')
}

export function query(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/* ---------------------------------- 用户 ---------------------------------- */

export async function listAdminUsers(filters: { page?: number; pageSize?: number; keyword?: string; role?: string; status?: string }): Promise<AdminUserListPayload> {
  const payload = await request<AdminUserListPayload>(`/api/admin/users${query({ ...filters })}`)
  return {
    users: payload.users ?? [],
    total: Number(payload.total) || 0,
    page: Number(payload.page) || 1,
    pageSize: Number(payload.pageSize) || 20,
    summary: payload.summary ?? { total: 0, active: 0, disabled: 0, admins: 0, activeAdmins: 0, usersWithPlan: 0, totalPointsBalance: 0 },
  }
}

export function updateAdminUser(id: string, input: AdminUserUpdateInput) {
  return request<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function createAdminUser(input: AdminUserUpdateInput & { username: string }) {
  return request<{ user: AdminUser }>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) })
}

/**
 * 用户详情里的调用记录与订单记录都支持分页。
 * 之前这两个函数固定读取第一页，导致详情抽屉只能看到最早的若干条记录。
 */
export async function listUserGenerationTasks(userId: string, page = 1, pageSize = 10): Promise<Paged<AdminGenerationTask>> {
  const payload = await request<unknown>(`/api/admin/generation-operations${query({ page, pageSize, userId })}`)
  assertOk(payload)
  const data = unwrap<Partial<Paged<AdminGenerationTask>>>(payload)
  return { items: data?.items ?? [], total: Number(data?.total) || 0, page: Number(data?.page) || page, pageSize: Number(data?.pageSize) || pageSize }
}

export async function listUserOrders(userId: string, page = 1, pageSize = 10): Promise<Paged<BillingOrder>> {
  const payload = await request<{ orders: BillingOrder[]; total: number; page?: number; pageSize?: number }>(`/api/admin/billing/orders${query({ page, pageSize, userId })}`)
  return { items: payload.orders ?? [], total: Number(payload.total) || 0, page: Number(payload.page) || page, pageSize: Number(payload.pageSize) || pageSize }
}

/* -------------------------------- 运营总览 -------------------------------- */

export async function getGenerationOverview(windowDays = 7): Promise<AdminGenerationOverview> {
  const payload = await request<unknown>(`/api/admin/generation-overview${query({ windowDays })}`)
  assertOk(payload)
  const data = unwrap<Partial<AdminGenerationOverview>>(payload)
  return {
    windowDays: Number(data?.windowDays) || windowDays,
    totalCalls: Number(data?.totalCalls) || 0,
    successCalls: Number(data?.successCalls) || 0,
    failedCalls: Number(data?.failedCalls) || 0,
    activeUsers: Number(data?.activeUsers) || 0,
    successRate: Number(data?.successRate) || 0,
    dailyCalls: data?.dailyCalls ?? [],
    modelDistribution: data?.modelDistribution ?? [],
    sourceDistribution: data?.sourceDistribution ?? [],
    kindDistribution: data?.kindDistribution ?? [],
  }
}

export async function getFinanceSummary(): Promise<FinanceSummary | null> {
  const payload = await request<{ summary?: FinanceSummary }>('/api/admin/billing/summary')
  return payload.summary ?? null
}

/* -------------------------------- 生成运维 -------------------------------- */

export async function listGenerationOperations(filters: GenerationOperationFilters): Promise<AdminGenerationOperations> {
  const payload = await request<unknown>(`/api/admin/generation-operations${query({ ...filters })}`)
  assertOk(payload)
  const data = unwrap<Partial<AdminGenerationOperations>>(payload)
  return {
    items: data?.items ?? [],
    total: Number(data?.total) || 0,
    page: Number(data?.page) || 1,
    pageSize: Number(data?.pageSize) || 20,
    summary: data?.summary ?? { total: 0, active: 0, success: 0, failed: 0, averageDurationMs: 0, totalPointsCost: 0, byType: {}, byStatus: {} },
    channels: data?.channels ?? [],
    agentPerformance: data?.agentPerformance ?? { sampleSize: 0, planningP50Ms: 0, planningP95Ms: 0, firstResultP50Ms: 0, firstResultP95Ms: 0, queueAverageMs: 0, upstreamAverageMs: 0, reviewAverageMs: 0 },
  }
}

const taskPathPrefix: Record<string, string> = { text: 'text-tasks', image: 'image-tasks', video: 'video-tasks', audio: 'audio-tasks' }

/** 取消进行中的任务。仍在上游执行的任务不会被删除，只终止本地调度。 */
export async function cancelGenerationTask(task: Pick<AdminGenerationTask, 'id' | 'type'>) {
  if (task.type === 'agent') {
    const payload = await request<unknown>(`/api/agent/runs/${encodeURIComponent(task.id)}/cancel`, { method: 'POST' })
    assertOk(payload)
    return
  }
  const prefix = taskPathPrefix[task.type]
  if (!prefix) throw new Error('该任务类型暂不支持取消')
  const payload = await request<unknown>(`/api/${prefix}/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  assertOk(payload)
}

/** 重新检查上游状态，用于回收卡死但上游已成功的任务。 */
export async function recoverGenerationTask(task: Pick<AdminGenerationTask, 'id' | 'type'>) {
  const prefix = taskPathPrefix[task.type]
  if (!prefix) throw new Error('该任务类型暂不支持重新检查')
  const payload = await request<unknown>(`/api/${prefix}/${encodeURIComponent(task.id)}`, { method: 'POST', body: JSON.stringify({ action: 'recover' }) })
  assertOk(payload)
}

/** 重试 Agent 运行中失败的子任务。 */
export async function retryAgentSubTask(task: Pick<AdminGenerationTask, 'id' | 'retryTaskId'>) {
  if (!task.retryTaskId) throw new Error('该任务没有可重试的子任务')
  const payload = await request<unknown>(`/api/agent/runs/${encodeURIComponent(task.id)}/tasks/${encodeURIComponent(task.retryTaskId)}/retry`, { method: 'POST' })
  assertOk(payload)
}

export type ReviewAction = { action: 'resume_upstream'; upstreamTaskId: string } | { action: 'provide_result'; result: string } | { action: 'confirm_failed'; reason?: string }

/** 人工接管“上游结果不确定”的任务：继续查询、补录结果或确认失败。 */
export async function reviewGenerationTask(task: Pick<AdminGenerationTask, 'id' | 'type'>, input: ReviewAction) {
  const payload = await request<unknown>(`/api/admin/generation-operations/${encodeURIComponent(task.type)}/${encodeURIComponent(task.id)}/review`, { method: 'POST', body: JSON.stringify(input) })
  assertOk(payload)
}

/* -------------------------------- 系统设置 -------------------------------- */

export async function getAdminSettings(): Promise<AdminSettings> {
  const payload = await request<{ settings: AdminSettings }>('/api/admin/settings')
  return payload.settings
}

/** 后端按字段合并补丁；这里允许提交部分设置。 */
export type AdminSettingsPatch = Partial<Omit<AdminSettings, 'defaultModels'>> & { defaultModels?: Partial<SystemDefaultModels> }

export function updateAdminSettings(patch: AdminSettingsPatch) {
  return request<{ settings: AdminSettings }>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) })
}

export function updateSiteSettings(site: SiteSettings) {
  return updateAdminSettings({ site })
}

/** 测试邮件：只发送，不改动已保存配置。 */
export function sendTestMail(to: string, mail?: AdminSettings['mail']) {
  return request<{ ok: boolean }>('/api/admin/mail/test', { method: 'POST', body: JSON.stringify({ to, ...(mail ? { mail } : {}) }) })
}

export async function getObjectStorage(): Promise<ObjectStorageSettings | null> {
  const payload = await request<unknown>('/api/admin/object-storage')
  assertOk(payload)
  return unwrap<ObjectStorageSettings | null>(payload)
}

export function updateObjectStorage(input: ObjectStorageUpdateInput) {
  return request<unknown>('/api/admin/object-storage', { method: 'PATCH', body: JSON.stringify(input) })
}

export function testObjectStorage() {
  return request<unknown>('/api/admin/object-storage', { method: 'POST' })
}

/** 拉取上游模型目录。密钥留空时后端会复用已保存的渠道密钥。 */
export async function fetchChannelModels(input: { channelId?: string; baseUrl?: string; apiKey?: string; apiFormat?: string; protocol?: string; configuredModels?: string[] }): Promise<SystemChannelModelFetchResult> {
  const payload = await request<SystemChannelModelFetchResult>('/api/admin/models', { method: 'POST', body: JSON.stringify(input) })
  return payload
}

/** 只保存渠道字段：复用设置接口，但只提交 systemChannels。密钥留空表示沿用已保存的值。 */
export async function saveChannels(channels: SystemChannel[]): Promise<AdminSettings> {
  const payload = await updateAdminSettings({ systemChannels: channels })
  return payload.settings
}

export function saveRouting(input: { systemChannels?: SystemChannel[]; logicalModels?: LogicalModel[]; defaultModels?: Partial<SystemDefaultModels>; modelPointCosts?: Record<string, number> }) {
  return updateAdminSettings(input)
}

/* ------------------------------ 上线前检查 ------------------------------ */

export type LaunchReadinessItem = {
  id: string
  title: string
  level: 'ok' | 'warning' | 'error'
  detail: string
  action?: string
}

export type LaunchReadinessReport = {
  /** 没有 error 才是 true（warning 不阻塞上线）。 */
  passed: boolean
  errors: number
  warnings: number
  checkedAt: string
  items: LaunchReadinessItem[]
}

/**
 * 上线前检查。
 *
 * 只读接口：不会修改任何配置。区分 error（阻断收费上线）与 warning（需人工确认）。
 */
export async function getLaunchReadiness(): Promise<LaunchReadinessReport> {
  const payload = await request<{ code?: number; msg?: string; data?: LaunchReadinessReport }>('/api/admin/launch-readiness')
  if (typeof payload.code === 'number' && payload.code !== 0) throw new StudioApiError(payload.msg || '上线检查失败', payload.code)
  const report = payload.data
  if (!report) throw new StudioApiError('上线检查未返回结果', 502)
  return report
}

/* ------------------------------ 商品与订单 ------------------------------ */

export async function listBillingProducts(enabledOnly = false): Promise<BillingProduct[]> {
  const payload = await request<{ products: BillingProduct[] }>(`/api/admin/billing/products${enabledOnly ? '?enabled=1' : ''}`)
  return payload.products ?? []
}

export function createBillingProduct(input: Record<string, unknown>) {
  return request<{ product: BillingProduct }>('/api/admin/billing/products', { method: 'POST', body: JSON.stringify(input) })
}

/**
 * 更新商品。
 *
 * `expectedUpdatedAt` 是**乐观锁前置条件**：传入调用方打开编辑器时看到的
 * `updatedAt`，若期间有别人改过同一商品，后端返回 409 而不是静默覆盖。
 * 这是「多人编辑冲突保护」的客户端一半。
 */
export function updateBillingProduct(id: string, input: Record<string, unknown>, expectedUpdatedAt?: string) {
  return request<{ product: BillingProduct }>(`/api/admin/billing/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(expectedUpdatedAt ? { ...input, expectedUpdatedAt } : input),
  })
}

/**
 * 复制商品。
 *
 * 后端没有复制接口，因此这里用「读取原商品 → 以新名称创建」实现。
 * 复制的是**商品配置**，不复制活动价：活动价挂在「活动 × 商品」上，
 * 新商品默认无活动（避免复制出一个运营没注意到的折扣）。
 */
export async function duplicateBillingProduct(source: BillingProduct, name: string): Promise<BillingProduct> {
  const payload = draftToProductPayload(source)
  const created = await createBillingProduct({ ...payload, name })
  const product = created.product
  if (!product?.id) throw new StudioApiError('复制商品失败：后端没有返回新商品', 502)
  return product
}

/**
 * 由已有商品构造创建请求体。
 *
 * 只带**商品自身**的字段；`enabled` 强制为 `false`，
 * 避免复制出来的商品立刻出现在用户订阅页上（运营应先核对再上架）。
 */
function draftToProductPayload(source: BillingProduct): Record<string, unknown> {
  const metadata = { ...(source.metadata ?? {}) }
  const membership = metadata.membership
  if (membership && typeof membership === 'object' && !Array.isArray(membership)) {
    // 复制副本必须落在**独立分组**，否则会与原商品争抢同一张卡片的同档位同周期。
    const display = membership as Record<string, unknown>
    metadata.membership = { ...display, groupId: `${typeof display.groupId === 'string' && display.groupId ? display.groupId : source.id}-copy` }
  }
  return {
    productKind: source.productKind,
    ...(source.planId ? { planId: source.planId } : {}),
    description: source.description ?? '',
    amountCents: source.amountCents,
    currency: source.currency,
    pointsAmount: source.pointsAmount,
    dailyPoints: source.dailyPoints,
    periodDays: source.periodDays,
    enabled: false,
    sortOrder: source.sortOrder + 1,
    metadata,
  }
}

export async function listBillingOrders(filters: BillingOrderFilters): Promise<Paged<BillingOrder>> {
  const payload = await request<{ orders: BillingOrder[]; total: number; page?: number; pageSize?: number }>(`/api/admin/billing/orders${query({ ...filters })}`)
  return { items: payload.orders ?? [], total: Number(payload.total) || 0, page: Number(payload.page) || Number(filters.page) || 1, pageSize: Number(payload.pageSize) || Number(filters.pageSize) || 20 }
}

export function closeBillingOrder(id: string, reason?: string) {
  return request<unknown>(`/api/admin/billing/orders/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function completeBillingOrder(id: string, reason?: string) {
  return request<unknown>(`/api/admin/billing/orders/${encodeURIComponent(id)}/complete`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function refundBillingOrder(id: string, reason: string) {
  return request<unknown>(`/api/admin/billing/orders/${encodeURIComponent(id)}/refund`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export async function listPromotions(): Promise<PromotionCampaign[]> {
  const payload = await request<unknown>('/api/admin/billing/promotions')
  assertOk(payload)
  const data = unwrap<{ campaigns?: PromotionCampaign[] }>(payload)
  return data?.campaigns ?? []
}

/**
 * 促销活动的写入接口统一返回**后端权威结果**（`{ campaign }`）。
 *
 * 调用方需要用返回体更新本地状态（活动价、时间窗、标签），
 * 否则界面只能靠猜，或再发一次列表请求。
 */
async function promotionWrite(path: string, method: 'POST' | 'PATCH', input: Record<string, unknown>): Promise<PromotionCampaign | undefined> {
  const payload = await request<unknown>(path, { method, body: JSON.stringify(input) })
  assertOk(payload)
  return unwrap<{ campaign?: PromotionCampaign }>(payload)?.campaign
}

export function savePromotion(input: Record<string, unknown>) {
  return promotionWrite('/api/admin/billing/promotions', 'POST', input)
}

export function updatePromotion(id: string, input: Record<string, unknown>) {
  return promotionWrite(`/api/admin/billing/promotions/${encodeURIComponent(id)}`, 'PATCH', input)
}

/** 删除促销活动。后端已提供 DELETE，此前管理端没有入口。 */
export async function deletePromotion(id: string): Promise<PromotionCampaign | undefined> {
  const payload = await request<unknown>(`/api/admin/billing/promotions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  assertOk(payload)
  return unwrap<{ campaign?: PromotionCampaign }>(payload)?.campaign
}

export async function listCouponTemplates(): Promise<CouponTemplate[]> {
  const payload = await request<unknown>('/api/admin/billing/coupon-templates')
  assertOk(payload)
  const data = unwrap<{ templates?: CouponTemplate[] }>(payload)
  return data?.templates ?? []
}

export function saveCouponTemplate(input: Record<string, unknown>) {
  return request<unknown>('/api/admin/billing/coupon-templates', { method: 'POST', body: JSON.stringify(input) })
}

export function updateCouponTemplate(id: string, input: Record<string, unknown>) {
  return request<unknown>(`/api/admin/billing/coupon-templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function grantCoupon(input: { templateId: string; userId?: string; username?: string; quantity?: number }) {
  return request<unknown>('/api/admin/billing/coupons/grant', { method: 'POST', body: JSON.stringify(input) })
}

export async function getReferralOverview(): Promise<ReferralOverview | null> {
  const payload = await request<unknown>('/api/admin/referrals')
  assertOk(payload)
  return unwrap<ReferralOverview | null>(payload)
}

export function updateReferralProgram(input: Record<string, unknown>) {
  return request<unknown>('/api/admin/referrals', { method: 'PATCH', body: JSON.stringify(input) })
}

export async function listReferralRelationships(page = 1, pageSize = 20): Promise<Paged<ReferralRelationship>> {
  const payload = await request<unknown>(`/api/admin/referrals/relationships${query({ page, pageSize })}`)
  assertOk(payload)
  const data = unwrap<Partial<Paged<ReferralRelationship>>>(payload)
  return { items: data?.items ?? [], total: Number(data?.total) || 0, page: Number(data?.page) || page, pageSize: Number(data?.pageSize) || pageSize }
}

export async function listReferralRewards(page = 1, pageSize = 20): Promise<Paged<ReferralReward>> {
  const payload = await request<unknown>(`/api/admin/referrals/rewards${query({ page, pageSize })}`)
  assertOk(payload)
  const data = unwrap<Partial<Paged<ReferralReward>>>(payload)
  return { items: data?.items ?? [], total: Number(data?.total) || 0, page: Number(data?.page) || page, pageSize: Number(data?.pageSize) || pageSize }
}

/* ------------------------------ 内容与公告 ------------------------------ */

export async function listAnnouncements(page = 1, pageSize = 20): Promise<Paged<Announcement>> {
  const payload = await request<{ announcements: Announcement[]; total: number; page?: number; pageSize?: number }>(`/api/admin/announcements${query({ page, pageSize })}`)
  return { items: payload.announcements ?? [], total: Number(payload.total) || 0, page: Number(payload.page) || page, pageSize: Number(payload.pageSize) || pageSize }
}

export function createAnnouncement(input: AnnouncementInput) {
  return request<{ announcement: Announcement }>('/api/admin/announcements', { method: 'POST', body: JSON.stringify(input) })
}

export function updateAnnouncement(id: string, input: AnnouncementInput) {
  return request<{ announcement: Announcement }>(`/api/admin/announcements/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deleteAnnouncement(id: string) {
  return request<unknown>(`/api/admin/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listPublishedWorks(filters: { page?: number; pageSize?: number; status?: string; lifecycleStatus?: string; keyword?: string }): Promise<Paged<PublishedWork>> {
  const payload = await request<unknown>(`/api/admin/works${query({ ...filters })}`)
  assertOk(payload)
  const data = unwrap<Partial<Paged<PublishedWork>>>(payload)
  return { items: data?.items ?? [], total: Number(data?.total) || 0, page: Number(data?.page) || 1, pageSize: Number(data?.pageSize) || 20 }
}

export function reviewWork(id: string, decision: 'approved' | 'rejected', input: { versionId?: string; reason?: string } = {}) {
  return request<unknown>(`/api/admin/works/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision, ...input }) })
}

export function takeDownWork(id: string, reason: string) {
  return request<unknown>(`/api/admin/works/${encodeURIComponent(id)}/take-down`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function featureWork(id: string, featured: boolean) {
  return request<unknown>(`/api/admin/works/${encodeURIComponent(id)}/feature`, { method: 'POST', body: JSON.stringify({ featured }) })
}

export function deleteWork(id: string) {
  return request<unknown>(`/api/admin/works/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listWorkCases(page = 1, pageSize = 20): Promise<Paged<WorkGovernanceCase>> {
  const payload = await request<unknown>(`/api/admin/work-cases${query({ page, pageSize })}`)
  assertOk(payload)
  const data = unwrap<Partial<Paged<WorkGovernanceCase>>>(payload)
  return { items: data?.items ?? [], total: Number(data?.total) || 0, page: Number(data?.page) || page, pageSize: Number(data?.pageSize) || pageSize }
}

export function resolveWorkCase(id: string, decision: string, resolution?: string) {
  return request<unknown>(`/api/admin/work-cases/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ decision, resolution }) })
}

/* --------------------------------- 审计 --------------------------------- */

export async function listAuditLogs(filters: AuditFilters): Promise<Paged<AuditLog>> {
  const payload = await request<{ logs: AuditLog[]; total: number; page?: number; pageSize?: number }>(`/api/admin/audit-logs${query({ ...filters })}`)
  return { items: payload.logs ?? [], total: Number(payload.total) || 0, page: Number(payload.page) || Number(filters.page) || 1, pageSize: Number(payload.pageSize) || Number(filters.pageSize) || 20 }
}
