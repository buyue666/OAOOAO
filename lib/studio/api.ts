import type { Edge, Node } from '@xyflow/react'
import type { CanvasBoard, CanvasNodeData, Project } from './types'
import type { DramaProject, DramaSourceAsset } from './drama-types'

export type BackendUser = {
  id: string
  accountId?: string
  username?: string
  email?: string
  displayName?: string
  avatarUrl?: string
  role?: string
  adminPermissions?: string[]
  planId?: string
  planName?: string
  pointsBalance?: number
  permanentPointsBalance?: number
  dailyPointsBalance?: number
}

export type SessionResponse = {
  user: BackendUser | null
  settings?: SessionSettings
  install?: { ready?: boolean }
}

/**
 * 会话返回的设置里包含真实逻辑模型目录、默认模型与积分倍率。
 * 这些字段是前台模型选择与积分估算的唯一来源。
 */
export type SessionGenerationDefaults = {
  canvasImageCount: number
  imageSize: string
  imageQuality: string
  imageCount: number
  videoQuality: string
  videoSeconds: number
  audioVoice: string
  audioFormat: string
}

export type SessionSettings = {
  site?: { title?: string; logoUrl?: string; iconUrl?: string }
  modelPointCosts?: Record<string, number>
  generationPointMultipliers?: { imageQuality?: Record<string, number>; videoQuality?: Record<string, number>; videoSeconds?: Record<string, number> }
  generationConcurrency?: Record<string, number>
  generationDefaults?: SessionGenerationDefaults
  defaultModels?: { textModel: string; imageModel: string; videoModel: string; audioModel: string }
  logicalModels?: Array<{
    id: string
    name: string
    capability: 'text' | 'image' | 'video' | 'audio'
    enabled: boolean
    bindings: Array<{
      id: string
      channelId: string
      upstreamModel: string
      enabled: boolean
      priority: number
      capabilityProfile?: {
        supportsReferenceImage?: boolean
        maxReferenceImages?: number
        aspectRatios?: string[]
        resolutions?: string[]
        durationSeconds?: number[]
        maxBatchSize?: number
        supportsAsync?: boolean
        supportsCancel?: boolean
      }
    }>
  }>
  systemChannels?: Array<{ id: string; name: string; baseUrl: string; apiFormat?: string; models: string[]; enabled: boolean; hasApiKey?: boolean }>
}

export type BillingProduct = {
  id: string
  productKind: 'points' | 'plan' | string
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
  metadata?: unknown
  pricing?: { listUnitAmountCents: number; saleUnitAmountCents: number; discountCents: number; promotion?: { label: string } }
}

export type CanvasBackendNode = {
  id: string
  type?: string
  position?: { x?: number; y?: number }
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type CanvasBackendConnection = {
  id: string
  source: string
  target: string
  type?: string
  animated?: boolean
  style?: Record<string, unknown>
  [key: string]: unknown
}

export type CanvasBackendProject = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  nodes: CanvasBackendNode[]
  connections: CanvasBackendConnection[]
  chatSessions?: unknown[]
  activeChatId?: string | null
  backgroundMode?: string
  showImageInfo?: boolean
  viewport?: { x: number; y: number; k: number }
  creativeConversationId?: string
  sourceHandoffId?: string
}

export type CanvasSummary = {
  id: string
  title: string
  nodeCount: number
  connectionCount: number
  createdAt: string
  updatedAt: string
  cover?: { kind: 'image' | 'video'; url: string }
}

export type Checkout = {
  provider: string
  orderId: string
  orderNo: string
  kind: 'manual' | 'redirect' | 'form' | 'qr'
  url?: string
  qrContent?: string
  form?: { action: string; method: string; fields: Array<{ name: string; value: string }> }
  expiresAt?: string
}

export class StudioApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: unknown) {
    super(message)
    this.name = 'StudioApiError'
  }

  /**
   * 本次请求的性质。
   *
   * `unavailable`（网络中断 / 5xx / 429）表示「结果未知」，不代表任务失败；
   * 页面必须据此继续重试或提示手动重新检查，不能据此宣布生成失败或已退款。
   */
  get outcome(): 'rejected' | 'expired' | 'unavailable' | 'not-found' | 'pending-confirmation' | 'failed' | 'unknown' {
    const explicit = this.payload && typeof this.payload === 'object' ? (this.payload as { outcome?: unknown }).outcome : undefined
    if (typeof explicit === 'string') return explicit as 'rejected' | 'expired' | 'unavailable' | 'not-found' | 'pending-confirmation' | 'failed' | 'unknown'
    // 402（及文案表明余额不足）是确定性拒绝，不是「稍后重试」。
    if (this.status === 402 || /积分不足|余额不足|配额不足|insufficient\s+(points|balance)/i.test(this.message)) return 'failed'
    if (this.status === 0 || this.status >= 500 || this.status === 429 || this.status === 408) return 'unavailable'
    if (this.status === 401 || this.status === 403) return 'expired'
    if (this.status === 404) return 'not-found'
    if (this.status === 409) return 'rejected'
    if (this.status >= 400) return 'failed'
    return 'unknown'
  }

  /** 结果未知：请求是否已经生效无法确定，必须重试或人工核对，不能当成终态。 */
  get isIndeterminate() {
    return this.outcome === 'unavailable'
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store' })
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'msg' in payload && typeof payload.msg === 'string'
      ? payload.msg
      : typeof payload === 'object' && payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `请求失败（${response.status}）`
    throw new StudioApiError(message, response.status, payload)
  }
  return payload as T
}

export function getSession() {
  return request<SessionResponse>('/api/auth/session')
}

export async function login(username: string, password: string, totpCode?: string) {
  return request<{ user: BackendUser; securityNotice?: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, ...(totpCode ? { totpCode } : {}) }),
  })
}

export function listBillingProducts() {
  return request<{ products: BillingProduct[]; paymentProviders: string[] }>('/api/billing/products')
}

export function listBillingOrders() {
  return request<{ orders: Array<Record<string, unknown>>; total: number }>('/api/billing/orders')
}

export function createBillingOrder(productId: string, provider: string) {
  return request<{ order: Record<string, unknown> }>('/api/billing/orders', {
    method: 'POST',
    body: JSON.stringify({ productId, quantity: 1, provider }),
  })
}

export async function createCheckout(orderId: string, provider: string) {
  const result = await request<{ code?: number; msg?: string; data?: { checkout: Checkout }; checkout?: Checkout }>(`/api/billing/orders/${encodeURIComponent(orderId)}/checkout`, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  })
  const checkout = result.data?.checkout ?? result.checkout
  if (!checkout || (result.code !== undefined && result.code !== 0)) throw new Error(result.msg || '支付参数响应无效')
  return { checkout }
}

export async function listCanvasProjects() {
  const result = await request<{ code: number; data: { projects: CanvasSummary[]; total: number }; msg?: string }>('/api/canvas/projects?page=1&pageSize=100')
  return result.data
}

export async function getCanvasProject(id: string) {
  const result = await request<{ code: number; data: { project: CanvasBackendProject } }>(`/api/canvas/projects/${encodeURIComponent(id)}`)
  return result.data.project
}

export async function createCanvasProject(input: { title: string; sourceHandoffId?: string; board?: CanvasBoard }) {
  const result = await request<{ code: number; data: { project: CanvasBackendProject } }>('/api/canvas/projects', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      sourceHandoffId: input.sourceHandoffId,
      project: input.board ? boardToCanvasProject(input.board) : undefined,
    }),
  })
  return result.data.project
}

/** 删除画布项目（用于清理创建失败或误建的画布）。 */
export async function deleteCanvasProjects(ids: string[]) {
  const result = await request<{ code: number; data: { deleted: string[] } }>('/api/canvas/projects', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  })
  return result.data.deleted
}

/* -------------------------------- 短剧项目 -------------------------------- */

export type DramaProjectSummary = {
  id: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
  shotCount?: number
  coverUrl?: string
}

export async function listDramaProjects() {
  const result = await request<{ code: number; data: { projects: DramaProjectSummary[]; total: number } }>('/api/drama/projects?page=1&pageSize=100')
  return result.data
}

/**
 * 创建短剧项目。
 *
 * 短剧项目与画布项目是不同的业务对象，因此必须走各自的接口，
 * 不能把短剧状态写进画布记录，否则刷新后会被服务端列表覆盖。
 *
 * `sourceHandoffId` 是**画布→短剧的唯一关联凭据**：后端用它把短剧 id 生成为
 * `drama-${sourceHandoffId}`，画布侧又是 `canvas-${sourceHandoffId}`，
 * 两个项目因此天然一一对应（后台自己的 `drama-canvas-link.ts` 就是这条规则）。
 */
export async function createDramaProject(input: {
  title: string
  summary?: string
  style?: string
  initialScript?: string
  sourceHandoffId?: string
  sourceAssets?: DramaSourceAsset[]
}) {
  const result = await request<{ code: number; data: { project: DramaProject } }>('/api/drama/projects', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.style ? { style: input.style } : {}),
      ...(input.initialScript ? { initialScript: input.initialScript } : {}),
      ...(input.sourceHandoffId ? { sourceHandoffId: input.sourceHandoffId } : {}),
      ...(input.sourceAssets?.length ? { sourceAssets: input.sourceAssets } : {}),
    }),
  })
  return result.data.project
}

/**
 * 读取完整短剧项目。
 *
 * 必须用完整项目（而不是列表摘要）：PATCH 走的是整项目规范化，
 * 只发摘要会丢掉 episodes 而被后端拒绝（「短剧项目至少需要一集」）。
 */
export async function getDramaProject(id: string) {
  const result = await request<{ code: number; data: { project: DramaProject } }>(`/api/drama/projects/${encodeURIComponent(id)}`)
  if (!result.data?.project) throw new StudioApiError('后端没有返回短剧项目', 502)
  return result.data.project
}

/**
 * 保存完整短剧项目（PATCH）。
 *
 * 三条与后端约定相关的事实，都来自后端 `drama-project-service.ts`：
 * 1. `normalizeProject` 在 `episodes` 缺失或为空时抛 400，所以必须回传完整 episodes；
 * 2. **版本必须随请求提交**（本轮 P1 数据丢失修复的核心）。
 *    后端对「带 `updatedAt`」的请求启用乐观锁：
 *      - 提交的版本早于服务端当前版本 → **409**（不再静默返回未修改的项目）；
 *      - 版本被别的请求抢先推进 → 存储层的原子条件更新落空 → 同样 **409**。
 *    早先这里刻意 `delete payload.updatedAt` 想绕过「最后写入优先」守卫，
 *    结果整份过期快照畅通无阻地覆盖了别人的保存 —— 这正是要修掉的静默覆盖。
 *    现在必须把**调用方读到的那一版**原样带上，绝不在这里重新读取
 *    （「自动重读再覆盖」会把用户明确拒绝掉的竞态重新引回来）。
 *    不提交 `updatedAt` 的请求仍走旧的宽松语义（后端为老客户端保留的兼容通道），
 *    但本项目自己的保存路径一律带版本。
 * 3. 请求体上限 2 MiB（后端为 8 MiB 读取、2 MiB 语义校验），因此这里也做一次前置检查。
 *
 * 409 原样抛给调用方（`StudioApiError.status === 409`），由界面提示冲突并保留草稿；
 * 这里**不做任何自动重试**，是否用最新版本重存必须由用户决定。
 */
export async function saveDramaProject(id: string, project: DramaProject, expectedUpdatedAt?: string) {
  /**
   * 版本来源：显式参数优先，其次项目对象自带的 `updatedAt`。
   * 两者都没有时才退化为「不带版本」（老调用方），而不是去后端重新读一个版本。
   */
  const version = expectedUpdatedAt ?? project.updatedAt
  const payload: Partial<DramaProject> = { ...project }
  if (version) payload.updatedAt = version
  else delete payload.updatedAt
  const size = JSON.stringify(payload).length
  if (size > MAX_DRAMA_PROJECT_BYTES) throw new StudioApiError(`短剧项目数据过大（${Math.round(size / 1024)} KB），请精简后重试`, 413)
  const result = await request<{ code: number; data: { project: DramaProject }; msg?: string }>(`/api/drama/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  if (!result.data?.project) throw new StudioApiError('保存失败：后端没有返回短剧项目', 502)
  return result.data.project
}

/** 后端对短剧项目请求体的上限（2 MiB），与 `MAX_PROJECT_BYTES` 保持一致。 */
const MAX_DRAMA_PROJECT_BYTES = 2 * 1024 * 1024

/** 删除短剧项目（用于清理创建失败或误建的短剧项目）。 */
export async function deleteDramaProject(id: string) {
  const result = await request<{ code: number; data: { deleted: boolean } }>(`/api/drama/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return Boolean(result.data?.deleted)
}

/**
 * 归档 / 恢复短剧项目。
 *
 * 后端 PATCH 走的是整项目规范化，缺少 episodes 会被拒绝（「短剧项目至少需要一集」），
 * 因此必须先读取完整项目，再带上目标 status 整体提交，不能只发一个 status 字段。
 */
export async function updateDramaProjectStatus(id: string, status: 'active' | 'archived') {
  const current = await request<{ code: number; data: { project: Record<string, unknown> } }>(`/api/drama/projects/${encodeURIComponent(id)}`)
  const project = current.data.project
  const result = await request<{ code: number; data: { project?: DramaProjectSummary } }>(`/api/drama/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...project, status }),
  })
  return result.data.project
}

export async function updateCanvasProject(project: CanvasBackendProject, board: CanvasBoard) {
  const result = await request<{ code: number; data: { project?: CanvasBackendProject; ack?: { updatedAt: string } } }>(`/api/canvas/projects/${encodeURIComponent(project.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      expectedUpdatedAt: project.updatedAt,
      project: {
        ...project,
        ...boardToCanvasProject(board),
      },
    }),
  })
  return result.data.project ?? { ...project, ...boardToCanvasProject(board), updatedAt: result.data.ack?.updatedAt ?? project.updatedAt }
}

export function boardToCanvasProject(board: CanvasBoard) {
  return {
    nodes: board.nodes.map((node) => ({
      id: node.id,
      type: node.data.kind,
      position: { x: node.position.x, y: node.position.y },
      data: node.data,
      metadata: {
        ...(node.data.src ? { remoteUrl: node.data.src } : {}),
        ...(node.data.poster ? { posterUrl: node.data.poster } : {}),
        ...(node.data.status ? { status: node.data.status } : {}),
      },
    })),
    connections: board.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      animated: edge.animated,
      style: edge.style ? { ...edge.style } as Record<string, unknown> : undefined,
    })),
  }
}

export function canvasProjectToBoard(project: CanvasBackendProject): CanvasBoard {
  const nodes: Node<CanvasNodeData>[] = project.nodes.map((node, index) => {
    const rawData = node.data && typeof node.data === 'object' ? node.data : {}
    const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {}
    const kind = rawData.kind === 'image' || rawData.kind === 'video' || rawData.kind === 'task' || rawData.kind === 'text'
      ? rawData.kind
      : node.type === 'image' || node.type === 'video' || node.type === 'task' || node.type === 'text'
        ? node.type
        : 'text'
    const data: CanvasNodeData = {
      title: typeof rawData.title === 'string' ? rawData.title : `画布节点 ${index + 1}`,
      kind,
      detail: typeof rawData.detail === 'string' ? rawData.detail : '',
      ...(typeof rawData.src === 'string' ? { src: rawData.src } : typeof metadata.remoteUrl === 'string' ? { src: metadata.remoteUrl } : {}),
      ...(typeof rawData.poster === 'string' ? { poster: rawData.poster } : typeof metadata.posterUrl === 'string' ? { poster: metadata.posterUrl } : {}),
      ...(typeof rawData.status === 'string' ? { status: rawData.status } : typeof metadata.status === 'string' ? { status: metadata.status } : {}),
    }
    return {
      id: node.id,
      type: 'canvas',
      position: { x: Number(node.position?.x) || 0, y: Number(node.position?.y) || 0 },
      data,
    }
  })
  const edges: Edge[] = project.connections.map((connection) => ({
    id: connection.id,
    source: connection.source,
    target: connection.target,
    type: connection.type,
    animated: Boolean(connection.animated),
    style: connection.style as Edge['style'],
  }))
  return { nodes, edges }
}

export function backendUserToStudioUser(user: BackendUser, fallbackAvatar: string) {
  return {
    id: user.id,
    name: user.displayName || user.username || user.email || '用户',
    email: user.email || user.username || '',
    role: user.role === 'admin' ? 'admin' as const : 'member' as const,
    avatar: user.avatarUrl || fallbackAvatar,
    plan: user.planName || '免费用户',
    credits: Math.max(0, Number(user.pointsBalance ?? user.permanentPointsBalance ?? 0) || 0),
  }
}

export function moneyLabel(amountCents: number, currency: string) {
  const amount = Math.max(0, Number(amountCents) || 0) / 100
  const symbol = currency.toUpperCase() === 'CNY' ? '¥' : currency.toUpperCase() === 'USD' ? '$' : `${currency.toUpperCase()} `
  return `${symbol}${amount.toFixed(2)}`
}

export function isUnauthorized(error: unknown) {
  return error instanceof StudioApiError && error.status === 401
}
