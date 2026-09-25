/**
 * OAOOAO 管理后台的数据契约。
 * 所有字段来自当前后端管理接口；页面只消费这里的类型，不直接判断后端原始结构。
 */

export type AdminPermission =
  | 'analytics.read'
  | 'users.read'
  | 'users.manage'
  | 'administrators.manage'
  | 'generation.read'
  | 'generation.manage'
  | 'upstream.manage'
  | 'commerce.manage'
  | 'billing.read'
  | 'billing.manage'
  | 'system.manage'
  | 'content.manage'
  | 'audit.read'

export type AdminPermissionMeta = { id: AdminPermission; label: string; description: string }

export const ADMIN_PERMISSIONS: readonly AdminPermissionMeta[] = [
  { id: 'analytics.read', label: '运营数据', description: '查看运营总览和统计图表' },
  { id: 'users.read', label: '用户查看', description: '浏览用户列表与用户详情' },
  { id: 'users.manage', label: '用户管理', description: '编辑资料、启停账户、调整积分和套餐' },
  { id: 'administrators.manage', label: '管理员管理', description: '授予或收回管理员职责' },
  { id: 'generation.read', label: '生成记录查看', description: '查看生成任务与请求详情' },
  { id: 'generation.manage', label: '生成运维', description: '取消、重试和接管生成任务' },
  { id: 'upstream.manage', label: '模型与渠道', description: '维护渠道、逻辑模型与生成参数' },
  { id: 'commerce.manage', label: '商品运营', description: '维护商品、套餐、优惠券和促销活动' },
  { id: 'billing.read', label: '订单查看', description: '查看订单、支付状态与财务摘要' },
  { id: 'billing.manage', label: '订单与财务', description: '退款、关闭订单与调整计费设置' },
  { id: 'system.manage', label: '系统设置', description: '站点、邮件、存储与数据保留策略' },
  { id: 'content.manage', label: '内容治理', description: '发布公告与处理作品审核' },
  { id: 'audit.read', label: '审计日志', description: '查看管理员操作与安全事件' },
] as const

export type AdminSection = 'overview' | 'users' | 'generation' | 'channels' | 'products' | 'orders' | 'content' | 'settings' | 'audit'

/* ---------------------------------- 用户 ---------------------------------- */

export type AdminUser = {
  id: string
  accountId?: string
  username: string
  displayName?: string
  email?: string
  bio?: string
  role: 'admin' | 'user' | string
  adminPermissions: AdminPermission[]
  status: 'active' | 'disabled' | string
  planId?: string
  planName?: string
  hasActivePlan?: boolean
  pointsBalance: number
  permanentPointsBalance?: number
  dailyPointsBalance?: number
  dailyPointsExpiresAt?: string
  mfaEnabled?: boolean
  createdAt?: string
  updatedAt?: string
  lastLoginAt?: string
}

export type AdminUserSummary = {
  total: number
  active: number
  disabled: number
  admins: number
  activeAdmins: number
  usersWithPlan: number
  totalPointsBalance: number
}

export type AdminUserListPayload = {
  users: AdminUser[]
  total: number
  page: number
  pageSize: number
  summary: AdminUserSummary
}

export type AdminUserUpdateInput = {
  username?: string
  displayName?: string
  email?: string
  password?: string
  role?: 'admin' | 'user'
  adminPermissions?: AdminPermission[]
  status?: 'active' | 'disabled'
  pointsBalance?: number
  planId?: string
}

/* ---------------------------------- 生成 ---------------------------------- */

export type GenerationTaskType = 'agent' | 'image' | 'video' | 'audio' | 'text'
export type GenerationTaskStatus = 'pending' | 'running' | 'success' | 'error' | 'paused' | 'cancelled'

export type GenerationAttempt = {
  attemptNo: number
  channelId?: string
  model?: string
  status: 'running' | 'succeeded' | 'failed'
  startedAt?: number
  completedAt?: number
  pointsCost?: number
  error?: string
}

export type AdminGenerationTask = {
  id: string
  userId: string
  accountId?: string
  username: string
  displayName: string
  type: GenerationTaskType
  status: GenerationTaskStatus
  surface?: string
  runId?: string
  parentTaskId?: string
  model: string
  channelId?: string
  provider?: string
  executionPhase?: string
  workerId?: string
  leaseUntil?: number
  lastHeartbeatAt?: number
  nextPollAt?: number
  lastPollAt?: number
  leaseExpired: boolean
  upstreamTaskId?: string
  lastUpstreamStatus?: string
  attempts?: GenerationAttempt[]
  prompt: string
  error?: string
  durationMs: number
  pointsCost: number
  pointsBreakdown?: { planner: number; childTasks: number; total: number }
  createdAt: number
  updatedAt: number
  canCancel: boolean
  retryTaskId?: string
  canReview: boolean
}

export type AdminGenerationChannel = {
  id: string
  name: string
  capability: 'text' | 'image' | 'video' | 'audio'
  logicalModelId: string
  logicalModelName: string
  upstreamModel: string
  enabled: boolean
  runtimeHealth: {
    status: 'healthy' | 'cooling'
    consecutiveFailures: number
    cooldownUntil?: number
    lastError?: string
  }
  planningRuntime?: {
    protocol?: string
    successCount: number
    failureCount: number
    averageLatencyMs?: number
  }
}

export type AdminGenerationSummary = {
  total: number
  active: number
  success: number
  failed: number
  averageDurationMs: number
  totalPointsCost: number
  byType: Record<string, number>
  byStatus: Record<string, number>
}

export type AdminAgentPerformance = {
  sampleSize: number
  planningP50Ms: number
  planningP95Ms: number
  firstResultP50Ms: number
  firstResultP95Ms: number
  queueAverageMs: number
  upstreamAverageMs: number
  reviewAverageMs: number
}

export type AdminGenerationOperations = {
  items: AdminGenerationTask[]
  total: number
  page: number
  pageSize: number
  summary: AdminGenerationSummary
  channels: AdminGenerationChannel[]
  agentPerformance: AdminAgentPerformance
}

export type GenerationOperationFilters = {
  page?: number
  pageSize?: number
  type?: string
  status?: string
  surface?: string
  userId?: string
  search?: string
}

export type GenerationOverviewMetric = { date?: string; label: string; value: number; percent?: number }

export type AdminGenerationOverview = {
  windowDays: number
  totalCalls: number
  successCalls: number
  failedCalls: number
  activeUsers: number
  successRate: number
  dailyCalls: GenerationOverviewMetric[]
  modelDistribution: GenerationOverviewMetric[]
  sourceDistribution: GenerationOverviewMetric[]
  kindDistribution: GenerationOverviewMetric[]
}

/* -------------------------------- 渠道模型 -------------------------------- */

export type ChannelProtocolId = string

export type ChannelModelConfig = {
  capability?: 'text' | 'image' | 'video' | 'audio'
  source?: string
  apiFormat?: string
  protocol?: string
  createPath?: string
  editPath?: string
  imageToVideoPath?: string
  queryPath?: string
  requestTemplate?: string
  resultField?: string
  statusField?: string
  supportsReferenceImage?: boolean
  supportsReferenceVideo?: boolean
  supportsReferenceAudio?: boolean
  [key: string]: unknown
}

export type SystemChannelAdvancedConfig = {
  protocol?: ChannelProtocolId
  authMode?: 'bearer' | 'header' | 'none' | string
  authHeader?: string
  authPrefix?: string
  textModel?: string
  imageModel?: string
  videoModel?: string
  createPath?: string
  editPath?: string
  imageToVideoPath?: string
  queryPath?: string
  requestTemplate?: string
  resultField?: string
  statusField?: string
  durationRange?: string
  referenceRule?: string
  supportsReferenceImage?: boolean
  supportsReferenceVideo?: boolean
  supportsReferenceAudio?: boolean
  modelCatalogPaths?: string[]
  modelCapabilities?: Record<string, 'text' | 'image' | 'video' | 'audio'>
  modelConfigs?: Record<string, ChannelModelConfig>
  operationConfigs?: Record<string, ChannelModelConfig>
  [key: string]: unknown
}

export type SystemChannel = {
  id: string
  name: string
  baseUrl: string
  /** 后端始终脱敏返回空串；写入时只有填了新值才会生效。 */
  apiKey?: string
  webhookSecret?: string
  apiFormat?: string
  models: string[]
  enabled: boolean
  advancedConfig?: SystemChannelAdvancedConfig
  hasApiKey?: boolean
  hasWebhookSecret?: boolean
  clearApiKey?: boolean
  clearWebhookSecret?: boolean
}

export type LogicalModelBinding = {
  id: string
  channelId: string
  upstreamModel: string
  enabled: boolean
  priority: number
  weight?: number
  capabilityProfile?: Record<string, unknown>
}

export type LogicalModel = {
  id: string
  name: string
  capability: 'text' | 'image' | 'video' | 'audio'
  enabled: boolean
  bindings: LogicalModelBinding[]
  /**
   * 可请求别名。
   *
   * `id` 是内部稳定标识（被已有任务、计价键、默认模型引用）。
   * 别名让运营在不改 `id` 的前提下提供额外可请求的名字：
   * 客户端用别名或 `id` 请求都会解析到同一个逻辑模型，
   * 计费、渠道选择与日志仍然记在 `id` 上。
   */
  aliases?: string[]
}

export type SystemDefaultModels = { textModel: string; imageModel: string; videoModel: string; audioModel: string }

export type SystemChannelModelFetchResult = {
  models: string[]
  modelCapabilities?: Record<string, string>
  modelConfigs?: Record<string, ChannelModelConfig>
  discoveredCount?: number
  totalCount?: number
  catalogSupported?: boolean
  provider?: string
  warning?: string
}

/* -------------------------------- 系统设置 -------------------------------- */

export type SiteFriendLink = { id: string; label: string; url: string; enabled: boolean }
export type SiteSocial = { enabled: boolean; label: string; url: string }

export type SiteSettings = {
  title?: string
  logoUrl?: string
  iconUrl?: string
  seoTitle?: string
  seoDescription?: string
  seoKeywords?: string
  footerCopyright?: string
  termsUrl?: string
  termsVersion?: string
  privacyUrl?: string
  privacyVersion?: string
  friendLinks?: SiteFriendLink[]
  socials?: Record<string, SiteSocial>
  heroVideoUrl?: string
  heroVideoPosterUrl?: string
  [key: string]: unknown
}

export type MailSettings = {
  provider?: string
  host?: string
  port?: number
  secure?: boolean
  username?: string
  /** 后端脱敏返回空串；只能写入新值。 */
  password?: string
  fromEmail?: string
  fromName?: string
}

export type GenerationConcurrencySettings = { agent: number; image: number; video: number; audio: number; text: number; render: number }

export type GenerationDefaultSettings = {
  canvasImageCount: number
  imageSize: string
  imageQuality: string
  imageCount: number
  videoQuality: string
  videoSeconds: number
  audioVoice: string
  audioFormat: string
}

export type GenerationCostControlSettings = { maxPointsPerTask: number; dailyUserPointSpend: number; dailyTotalPointSpend: number }
export type DataLifecycleSettings = {
  cleanupExpiredSessions: boolean
  cleanupExpiredEmailCodes: boolean
  cleanupExpiredGenerationTasks: boolean
  cleanupExpiredTemporaryMedia: boolean
  maintenanceBatchSize: number
}
export type EntitlementPlanLimits = Record<'dailyPointSpend' | 'dailyApiCalls' | 'dailyImages' | 'dailyVideos' | 'dailyAudio' | 'dailyText', number>
export type EntitlementPlan = { id: string; name: string; enabled: boolean; dailyPoints: number; limits: EntitlementPlanLimits; features: string[] }
export type EntitlementSettings = { enabled: boolean; defaultPlanId: string; plans: EntitlementPlan[] }
export type GenerationPointMultipliers = { imageQuality?: Record<string, number>; videoQuality?: Record<string, number>; videoSeconds?: Record<string, number> }

export type AdminSettings = {
  site: SiteSettings
  registrationEnabled: boolean
  emailRegistrationEnabled: boolean
  freeDailyPointsEnabled: boolean
  freeDailyPoints: number
  mail: MailSettings
  allowUserApiConfig?: boolean
  modelPointCosts: Record<string, number>
  generationPointMultipliers: GenerationPointMultipliers
  generationCostControl: GenerationCostControlSettings
  dataLifecycle: DataLifecycleSettings
  entitlements: EntitlementSettings
  generationConcurrency: GenerationConcurrencySettings
  generationDefaults: GenerationDefaultSettings
  systemChannels: SystemChannel[]
  logicalModels: LogicalModel[]
  defaultModels: SystemDefaultModels
}

export type ObjectStorageSettings = {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  prefix: string
  forcePathStyle: boolean
  hasAccessKeyId: boolean
  hasSecretAccessKey: boolean
  updatedAt?: string
}

export type ObjectStorageUpdateInput = {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  prefix: string
  forcePathStyle: boolean
  accessKeyId?: string
  secretAccessKey?: string
  clearAccessKeyId?: boolean
  clearSecretAccessKey?: boolean
}

/* ------------------------------ 商品与订单 ------------------------------ */

export type BillingProductKind = 'points' | 'plan'

export type BillingProductPricing = {
  listUnitAmountCents: number
  saleUnitAmountCents: number
  discountCents: number
  promotion?: { label?: string }
  coupon?: { label?: string }
}

export type BillingProduct = {
  id: string
  productKind: BillingProductKind | string
  planId?: string
  name: string
  description?: string
  amountCents: number
  currency: string
  pointsAmount: number
  dailyPoints: number
  periodDays: number
  enabled: boolean
  sortOrder: number
  metadata?: Record<string, unknown>
  pricing?: BillingProductPricing
  createdAt?: string
  updatedAt?: string
}

export type BillingOrderStatus = 'pending' | 'paid' | 'closed' | 'canceled' | 'refunding' | 'refunded'

export type BillingOrder = {
  id: string
  orderNo: string
  productId: string
  userId: string
  userAccountId?: string
  userUsername?: string
  userDisplayName?: string
  productKind?: string
  status: BillingOrderStatus | string
  subject: string
  listAmountCents: number
  promotionDiscountCents: number
  couponDiscountCents: number
  amountCents: number
  currency: string
  pointsAmount: number
  dailyPoints: number
  periodDays: number
  quantity: number
  provider?: string
  providerOrderId?: string
  expiresAt?: string
  closedAt?: string
  paidAt?: string
  refundedAt?: string
  pricingSnapshot?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt?: string
}

export type BillingOrderFilters = {
  page?: number
  pageSize?: number
  status?: string
  userId?: string
  productId?: string
  keyword?: string
}

export type FinanceSummary = {
  orders: {
    total: number
    pending: number
    paid: number
    closed: number
    canceled: number
    refunded: number
    grossAmountCents: number
    paidAmountCents: number
    pendingAmountCents: number
    refundedAmountCents: number
  }
  payments: { succeeded: number; refunded: number; succeededAmountCents: number; refundedAmountCents: number }
  commerce: {
    convertedOrders: number
    promotionOrders: number
    promotionConvertedOrders: number
    promotionDiscountCents: number
    couponOrders: number
    couponConvertedOrders: number
    couponDiscountCents: number
  }
  providers: Array<{
    provider: string
    totalOrders: number
    pendingOrders: number
    paidOrders: number
    refundedOrders: number
    paidAmountCents: number
    refundedAmountCents: number
  }>
  reconciliation: { paidOrdersWithoutSucceededPayment: number; succeededPaymentsWithoutPaidOrder: number; amountMismatchPayments: number }
}

export type PromotionCampaign = {
  id: string
  name: string
  label?: string
  enabled: boolean
  startsAt?: string
  endsAt?: string
  products: Array<{ productId: string; promotionalAmountCents: number }>
  createdAt?: string
  updatedAt?: string
}

export type CouponTemplate = {
  id: string
  name: string
  /** 折扣类型由后端定义；这里保留原始值并在页面翻译。 */
  discountType?: string
  discountValue?: number
  minAmountCents?: number
  maxDiscountCents?: number
  totalQuantity?: number
  claimedQuantity?: number
  perUserLimit?: number
  enabled?: boolean
  startsAt?: string
  endsAt?: string
  productIds?: string[]
  [key: string]: unknown
}

export type PointsRecord = {
  id: string
  kind?: string
  direction: 'credit' | 'debit' | string
  amount: number
  balanceAfter?: number
  description?: string
  createdAt: string
  [key: string]: unknown
}

export type ReferralProgram = {
  id: string
  enabled: boolean
  inviterPoints: number
  inviteeRewardType: string
  inviteePoints: number
  minimumPaidCents: number
  coolingOffDays: number
  inviterMonthlyLimit: number
  campaignTotalLimit: number
  autoFreezeRisk: boolean
}

export type ReferralRelationship = {
  id: string
  inviterUserId?: string
  inviteeUserId?: string
  inviterUsername?: string
  inviteeUsername?: string
  status?: string
  qualifiedAt?: string
  createdAt?: string
  [key: string]: unknown
}

export type ReferralReward = {
  id: string
  relationshipId?: string
  inviterUserId?: string
  points?: number
  status?: string
  settledAt?: string
  createdAt?: string
  [key: string]: unknown
}

export type ReferralOverview = {
  program: ReferralProgram
  stats: { clicks: number; registrations: number; qualified: number; pending: number; settled: number; risky: number }
}

/* ------------------------------ 内容与公告 ------------------------------ */

/**
 * 公告由后端定义为 enabled（是否展示）+ popupHome / popupAfterLogin（弹窗位置）+
 * startsAt / endsAt（生效区间）。没有独立的 draft 状态，草稿即 enabled=false。
 */
export type Announcement = {
  id: string
  title: string
  content: string
  enabled: boolean
  popupHome: boolean
  popupAfterLogin: boolean
  startsAt?: string
  endsAt?: string
  createdAt: string
  updatedAt: string
}

export type AnnouncementInput = {
  title?: string
  content?: string
  enabled?: boolean
  popupHome?: boolean
  popupAfterLogin?: boolean
  startsAt?: string
  endsAt?: string
}

export type PublishedWork = {
  id: string
  authorUserId?: string
  authorUsername?: string
  moderationStatus?: string
  lifecycleStatus?: string
  featured?: boolean
  currentVersion?: { id?: string; title?: string; summary?: string; coverUrl?: string; previewUrl?: string; status?: string }
  currentPreview?: { storageKey?: string; previewUrl?: string }
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type WorkGovernanceCase = {
  id: string
  workId?: string
  versionId?: string
  kind?: string
  status?: string
  reason?: string
  resolution?: string
  createdAt?: string
  resolvedAt?: string
  [key: string]: unknown
}

/* --------------------------------- 审计 --------------------------------- */

export type AuditLog = {
  id: string
  action: string
  status?: 'success' | 'failure' | string
  actor?: { id?: string; username?: string; role?: string; ip?: string; userAgent?: string }
  target?: { type?: string; id?: string; label?: string }
  metadata?: unknown
  createdAt: string
}

export type AuditFilters = {
  page?: number
  pageSize?: number
  keyword?: string
  action?: string
  status?: string
  actorId?: string
  targetType?: string
  start?: string
  end?: string
}
