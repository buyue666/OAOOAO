/**
 * OAOOAO 真实生成接口客户端。
 *
 * 覆盖 image-tasks / video-generation-tasks / audio-tasks / text-tasks / agent/runs 与 generation-logs。
 * 后端任务接口会把积分余额放在 `x-vozeb-pro-points-*` 响应头里，这里统一解析为 PointsSnapshot，
 * 页面因此不需要自己读取响应头。配置密钥不在前端出现：任务请求只提交逻辑模型 ID，
 * 真正的渠道与密钥由后端按管理员配置解析。
 */
import { StudioApiError } from './api'
import type {
  AgentRun,
  AgentRunEvent,
  AudioGenerationInput,
  GenerationLog,
  GenerationReference,
  GenerationStatus,
  GenerationTask,
  ImageGenerationInput,
  MediaResult,
  PointsSnapshot,
  TextGenerationInput,
  VideoGenerationInput,
} from './generation-types'

export type GenerationResponse<T> = { data: T; points: PointsSnapshot; status: number }

const POINTS_HEADERS = {
  remaining: 'x-vozeb-pro-points-remaining',
  permanent: 'x-vozeb-pro-points-permanent',
  daily: 'x-vozeb-pro-points-daily',
  dailyExpiresAt: 'x-vozeb-pro-points-daily-expires-at',
} as const

function readPoints(headers: Headers): PointsSnapshot {
  const number = (name: string) => {
    const raw = headers.get(name)
    if (raw === null) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }
  return {
    remaining: number(POINTS_HEADERS.remaining),
    permanent: number(POINTS_HEADERS.permanent),
    daily: number(POINTS_HEADERS.daily),
    dailyExpiresAt: headers.get(POINTS_HEADERS.dailyExpiresAt) || undefined,
  }
}

function errorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['error', 'msg', 'message']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return `请求失败（${status}）`
}

/**
 * 请求结果的性质。
 *
 * 关键区分：`unavailable` 表示「这次没问到」，`failed` 才表示「任务真的失败」。
 * 早先把查询失败直接当成任务失败，会在上游仍在生成时误判并停止轮询。
 */
export type RequestOutcome = 'ok' | 'rejected' | 'expired' | 'unavailable' | 'not-found' | 'pending-confirmation' | 'failed'

const CONFIRMATION_PATTERN = /待确认|需要人工|人工接管|无法确认/

/**
 * 把一次 HTTP 结果归类。
 * - 5xx / 429 / 网络异常 → unavailable：结果未知，可重试，不能当作终态。
 * - **402（或文案表明积分/余额不足）→ failed**：这是**确定性拒绝**，
 *   余额不够时重试多少次都不会成功，必须提示用户去充值，
 *   而不是像 429 那样提示「稍后重试」并自动重试。
 * - 401/403 → expired：会话或权限失效，需要重新登录。
 * - 404 → not-found：任务在后端不存在（例如已过期清理）。
 * - 409 → rejected：状态已变化或参数冲突，需要刷新后重试。
 * - 其他 4xx → failed：后端明确拒绝，是真实失败。
 * - 200/202 带待确认标记 → pending-confirmation：上游创建结果未知，必须人工/重新检查。
 */
export function classifyOutcome(status: number | undefined, message = '', payload?: unknown): RequestOutcome {
  const text = `${message} ${payload && typeof payload === 'object' ? JSON.stringify(payload) : ''}`
  if (status === undefined) return 'unavailable'
  // 必须先于 429 分支判断：余额不足是确定性拒绝，不是「稍后重试」。
  if (status === 402 || /积分不足|余额不足|配额不足|insufficient\s+(points|balance)/i.test(text)) return 'failed'
  if (status >= 500 || status === 429 || status === 408) return 'unavailable'
  if (status === 401 || status === 403) return 'expired'
  if (status === 404) return 'not-found'
  if (status === 409) return 'rejected'
  if (status === 0) return 'unavailable'
  if (CONFIRMATION_PATTERN.test(text)) return 'pending-confirmation'
  if (status >= 400) return 'failed'
  return CONFIRMATION_PATTERN.test(text) ? 'pending-confirmation' : 'ok'
}

/** 任务状态到结果性质的映射，供轮询判断能否继续等待。 */
export function outcomeOfTask(task: { status?: string; needsReview?: boolean } | undefined): RequestOutcome {
  if (!task) return 'unavailable'
  if (task.needsReview) return 'pending-confirmation'
  if (task.status === 'success') return 'ok'
  if (task.status === 'pending' || task.status === 'running' || task.status === 'paused') return 'unavailable'
  if (task.status === 'cancelled') return 'rejected'
  return 'failed'
}

/**
 * 生成接口可能返回 200 或 202（上游创建结果待确认）。
 * 两者都携带可用任务，因此这里只把 4xx/5xx 视为失败。
 * 网络层异常统一转成 `unavailable`，让调用方区分「没问到」和「任务失败」。
 */
async function generate<T>(path: string, init: RequestInit): Promise<GenerationResponse<T>> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store' })
  } catch (reason) {
    // 浏览器网络中断、DNS 失败、连接被重置：请求可能已经到达后端，结果未知。
    throw new StudioApiError(reason instanceof Error ? reason.message : '网络请求失败，无法确认服务端状态', 0, { outcome: 'unavailable' })
  }
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const message = errorMessage(payload, response.status)
    throw new StudioApiError(message, response.status, { payload, outcome: classifyOutcome(response.status, message, payload) })
  }
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const data = (record.data !== undefined && record.code !== undefined ? record.data : payload) as T
  return { data, points: readPoints(response.headers), status: response.status }
}

/**
 * 生成一个提交标识。
 *
 * 后端以 `(user, task_type, clientRequestId, attemptNo)` 做幂等去重：
 * 同一个 ID 重复提交只会返回第一次创建的任务，不会重复扣费。
 * 因此这个 ID 必须由调用方持有并复用（网络重试），只有「明确的新一次创作」才换新 ID。
 */
export function newClientRequestId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/* ---------------------------------- 创建 ---------------------------------- */

export function createImageTask(input: ImageGenerationInput) {
  const references: GenerationReference[] = input.references?.filter((reference) => reference.url || reference.dataUrl) ?? (input.referenceUrls ?? []).filter(Boolean).map((url) => (
    url.startsWith('data:') ? { dataUrl: url, type: 'image' } : { url, type: 'image' }
  ))
  return generate<{ task: GenerationTask }>('/api/image-tasks', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt,
      config: {
        ...(input.model ? { model: input.model } : {}),
        ...(input.ratio ? { size: input.ratio } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
      },
      ...(input.title ? { title: input.title } : {}),
      kind: input.kind ?? (references.length ? 'edit' : 'generation'),
      ...(references.length ? { references } : {}),
      source: input.surface ?? 'image-workbench',
      context: { ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.surface ? { surface: input.surface } : {}) },
    }),
    headers: requestIdHeaders(input.clientRequestId),
  })
}

/**
 * 后端优先读取 `x-vozeb-pro-client-request-id` 头并在限流之前完成去重，
 * 因此重试同一个 ID 既不会新建任务，也不会被重复计入限流。
 */
function requestIdHeaders(clientRequestId?: string, attemptNo?: number) {
  const headers: Record<string, string> = {}
  if (clientRequestId) headers['x-vozeb-pro-client-request-id'] = clientRequestId
  if (attemptNo && attemptNo > 0) headers['x-vozeb-pro-attempt-no'] = String(attemptNo)
  return headers
}

export function createVideoTask(input: VideoGenerationInput) {
  const references = input.references?.filter((reference) => reference.url || reference.dataUrl) ?? []
  return generate<{ task: GenerationTask; warning?: string }>('/api/video-generation-tasks', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt,
      config: {
        ...(input.model ? { model: input.model } : {}),
        ...(input.ratio ? { size: input.ratio } : {}),
        ...(input.quality ? { vquality: input.quality } : {}),
        ...(input.seconds ? { videoSeconds: String(input.seconds) } : {}),
      },
      ...(references.length ? { references } : {}),
      source: input.surface ?? 'video-workbench',
      context: { ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.surface ? { surface: input.surface } : {}) },
    }),
    headers: requestIdHeaders(input.clientRequestId),
  })
}

/** 将浏览器内的参考素材交给后端做权限校验和临时发布，避免把 blob: URL 直接传给上游。 */
export async function publishReferenceAsset(type: 'image' | 'video', dataUrl: string) {
  if (!dataUrl) throw new StudioApiError('参考素材读取失败，请重新上传', 400)
  if (dataUrl.length > 24 * 1024 * 1024) throw new StudioApiError('参考素材超过当前直传限制，请压缩后重试', 413)
  const result = await generate<{ upstreamUrl?: string; error?: string; data?: { upstreamUrl?: string; error?: string } }>('/api/reference-assets', {
    method: 'POST',
    body: JSON.stringify({ type, dataUrl, persistent: false }),
  })
  const upstreamUrl = result.data?.upstreamUrl ?? result.data?.data?.upstreamUrl
  if (!upstreamUrl) throw new StudioApiError(result.data?.error || result.data?.data?.error || '参考素材发布失败', 502, result.data)
  return upstreamUrl
}

export function createAudioTask(input: AudioGenerationInput) {
  return generate<{ task: GenerationTask }>('/api/audio-tasks', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt,
      config: {
        ...(input.model ? { model: input.model } : {}),
        ...(input.voice ? { voice: input.voice } : {}),
        ...(input.format ? { format: input.format } : {}),
      },
      source: input.surface ?? 'audio-workbench',
      context: { ...(input.projectId ? { projectId: input.projectId } : {}) },
    }),
    headers: requestIdHeaders(input.clientRequestId),
  })
}

/**
 * 文本任务创建。
 *
 * 后端已支持 `context.clientRequestId` 与 `x-vozeb-pro-client-request-id` 幂等头
 * （本轮补齐），因此文本任务现在与图片/视频一样：网络重试复用同一标识时
 * 后端返回第一次创建的任务，不会重复创建也不会重复扣费。
 */
export function createTextTask(input: TextGenerationInput) {
  return generate<{ task: GenerationTask }>('/api/text-tasks', {
    method: 'POST',
    body: JSON.stringify({
      config: input.model ? { model: input.model } : {},
      messages: [{ role: 'user', content: input.prompt }],
      context: {
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        ...(input.attemptNo ? { attemptNo: input.attemptNo } : {}),
      },
    }),
    headers: requestIdHeaders(input.clientRequestId),
  })
}

/* ---------------------------------- 查询 ---------------------------------- */

const taskPaths: Record<string, string> = { image: 'image-tasks', video: 'video-tasks', audio: 'audio-tasks', text: 'text-tasks' }

export function getGenerationTask(kind: 'image' | 'video' | 'audio' | 'text', id: string) {
  const path = taskPaths[kind]
  if (!path) throw new StudioApiError('不支持的任务类型', 400)
  return generate<{ task: GenerationTask }>(`/api/${path}/${encodeURIComponent(id)}`, { method: 'GET' })
}

/** 取消任务。后端只允许 pending/running 状态取消，其余返回 409。 */
export function cancelGenerationTask(kind: 'image' | 'video' | 'audio' | 'text', id: string) {
  const path = taskPaths[kind]
  if (!path) throw new StudioApiError('不支持的任务类型', 400)
  return generate<{ task: GenerationTask }>(`/api/${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled' }),
  })
}

/** 重新检查上游状态，用于失败或卡死任务的回收。 */
export function recoverGenerationTask(kind: 'image' | 'video' | 'audio' | 'text', id: string) {
  const path = taskPaths[kind]
  if (!path) throw new StudioApiError('不支持的任务类型', 400)
  return generate<{ task: GenerationTask }>(`/api/${path}/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'recover' }),
  })
}

/* --------------------------------- Agent --------------------------------- */

export function listAgentRuns(params: { projectId?: string; conversationId?: string; surface?: string; activeOnly?: boolean; limit?: number } = {}) {
  const search = new URLSearchParams()
  if (params.projectId) search.set('projectId', params.projectId)
  if (params.conversationId) search.set('conversationId', params.conversationId)
  if (params.surface) search.set('surface', params.surface)
  if (params.activeOnly) search.set('status', 'active')
  if (params.limit) search.set('limit', String(params.limit))
  const query = search.toString()
  return generate<{ runs: AgentRun[] }>(`/api/agent/runs${query ? `?${query}` : ''}`, { method: 'GET' })
}

export function getAgentRun(id: string) {
  return generate<{ run: AgentRun }>(`/api/agent/runs/${encodeURIComponent(id)}`, { method: 'GET' })
}

export type CreateAgentRunInput = {
  prompt: string
  surface: 'chat' | 'canvas' | 'drama'
  projectId?: string
  conversationId?: string
  assetIds?: string[]
  skillIds?: string[]
  modelIds?: string[]
  publicPrompt?: string
  /** 幂等标识：网络失败后重试必须复用，后端据此返回原运行而不是新建。 */
  clientRequestId?: string
}

export function createAgentRun(input: CreateAgentRunInput) {
  return generate<{ run: AgentRun; conversation?: { id?: string }; created?: boolean }>('/api/agent/runs', {
    method: 'POST',
    body: JSON.stringify({
      clientRequestId: input.clientRequestId || newClientRequestId('agent'),
      surface: input.surface,
      prompt: input.prompt,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.assetIds?.length ? { assetIds: input.assetIds } : {}),
      ...(input.skillIds?.length ? { skillIds: input.skillIds } : {}),
      ...(input.modelIds?.length ? { modelIds: input.modelIds } : {}),
      ...(input.publicPrompt ? { publicPrompt: input.publicPrompt } : {}),
    }),
  })
}

/** Agent 支持 pause / resume / retry / cancel 四个动作。 */
export function controlAgentRun(id: string, action: 'pause' | 'resume' | 'retry' | 'cancel') {
  return generate<{ run: AgentRun }>(`/api/agent/runs/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({}) })
}

/** 重试 Agent 运行中失败的子任务。 */
export function retryAgentRunTask(runId: string, taskId: string) {
  return generate<unknown>(`/api/agent/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' })
}

export async function listAgentRunEvents(id: string, lastEventId?: string) {
  const response = await fetch(`/api/agent/runs/${encodeURIComponent(id)}/events${lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : ''}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { accept: 'text/event-stream' },
  })
  if (!response.ok) throw new StudioApiError(errorMessage(null, response.status), response.status)
  const text = await response.text()
  return parseSseEvents(text)
}

/** 解析事件流响应；只保留 data 负载，忽略心跳与注释行。 */
export function parseSseEvents(text: string): AgentRunEvent[] {
  const events: AgentRunEvent[] = []
  let current: { type?: string; id?: string; data: string[] } | null = null
  const flush = () => {
    if (!current?.type) { current = null; return }
    let data: unknown
    const raw = current.data.join('\n').trim()
    try {
      data = raw ? JSON.parse(raw) : undefined
    } catch {
      data = raw
    }
    events.push({ type: current.type, id: current.id, data })
    current = null
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue }
    if (line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const value = separator === -1 ? '' : line.slice(separator + 1).trimStart()
    if (field === 'event') { flush(); current = { type: value, data: [] }; continue }
    if (!current) current = { data: [] }
    if (field === 'data') current.data.push(value)
    else if (field === 'id') current.id = value
  }
  flush()
  return events
}

/* -------------------------------- 生成记录 -------------------------------- */

export async function listGenerationLogs(params: { page?: number; pageSize?: number; kind?: string; status?: string } = {}) {
  const search = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) })
  if (params.kind) search.set('kind', params.kind)
  if (params.status) search.set('status', params.status)
  const { data } = await generate<{ items?: GenerationLog[]; logs?: GenerationLog[]; total?: number }>(`/api/generation-logs?${search.toString()}`, { method: 'GET' })
  return { items: data?.items ?? data?.logs ?? [], total: Number(data?.total) || 0 }
}

/* -------------------------------- 结果归一化 -------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function textOf(value: unknown) {
  return typeof value === 'string' ? value : ''
}

/**
 * 后端各类型任务的 result 结构不同（图片为 dataUrl/remoteUrl，视频为 url/poster，音频为 url，文本为 content）。
 * 这里统一收敛成 MediaResult[] 与可选文本，页面因此只需处理一种形态。
 */
export function normalizeTaskResult(kind: string, result: unknown): { media: MediaResult[]; text?: string } {
  if (!result) return { media: [] }

  if (typeof result === 'string') {
    const value = result.trim()
    if (!value) return { media: [] }
    if (kind === 'text') return { media: [], text: value }
    if (/^https?:|^data:|^\//.test(value)) return { media: [{ url: value, kind: mediaKind(kind) }] }
    return { media: [], text: value }
  }

  if (!isRecord(result)) return { media: [] }

  if (kind === 'text') {
    const content = textOf(result.content) || textOf(result.text) || textOf(result.message)
    return { media: [], text: content || undefined }
  }

  const media: MediaResult[] = []
  const push = (value: unknown, poster?: unknown, extra: Partial<MediaResult> = {}) => {
    const url = textOf(value)
    if (!url) return
    media.push({ url, poster: textOf(poster) || undefined, kind: mediaKind(kind), ...extra })
  }

  push(result.remoteUrl, result.posterUrl, { width: numberOr(result.width), height: numberOr(result.height), mimeType: textOf(result.mimeType) || undefined })
  push(result.dataUrl && !media.length ? result.dataUrl : '', undefined)
  push(result.url, result.poster)
  push(result.serverUrl)
  push(result.videoUrl, result.posterUrl)
  push(result.audioUrl)

  const list = Array.isArray(result.results) ? result.results : Array.isArray(result.assets) ? result.assets : []
  for (const item of list) {
    if (typeof item === 'string') { push(item); continue }
    if (!isRecord(item)) continue
    push(item.remoteUrl || item.url || item.serverUrl || item.dataUrl, item.posterUrl || item.poster, { width: numberOr(item.width), height: numberOr(item.height) })
  }

  // 去重，保留首次出现的顺序
  const seen = new Set<string>()
  const unique = media.filter((item) => item.url && !seen.has(item.url) && seen.add(item.url))
  return { media: unique, text: textOf(result.content) || undefined }
}

function numberOr(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function mediaKind(kind: string): MediaResult['kind'] {
  return kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image'
}

export function isTerminalStatus(status?: string): status is 'success' | 'error' | 'cancelled' {
  return status === 'success' || status === 'error' || status === 'cancelled'
}

export function isActiveStatus(status?: GenerationStatus) {
  return status === 'pending' || status === 'running' || status === 'paused'
}
