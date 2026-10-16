/**
 * OAOOAO ��ʵ���ɽӿڿͻ��ˡ�
 *
 * ���� image-tasks / video-generation-tasks / audio-tasks / text-tasks / agent/runs �� generation-logs��
 * �������ӿڻ�ѻ��������� `x-vozeb-pro-points-*` ��Ӧͷ�����ͳһ����Ϊ PointsSnapshot��
 * ҳ����˲���Ҫ�Լ���ȡ��Ӧͷ��������Կ����ǰ�˳��֣���������ֻ�ύ�߼�ģ�� ID��
 * ��������������Կ�ɺ�˰�����Ա���ý�����
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
  return `����ʧ�ܣ�${status}��`
}

/**
 * �����������ʡ�
 *
 * �ؼ����֣�`unavailable` ��ʾ�����û�ʵ�����`failed` �ű�ʾ���������ʧ�ܡ���
 * ���ȰѲ�ѯʧ��ֱ�ӵ�������ʧ�ܣ�����������������ʱ���в�ֹͣ��ѯ��
 */
export type RequestOutcome = 'ok' | 'rejected' | 'expired' | 'unavailable' | 'not-found' | 'pending-confirmation' | 'failed'

const CONFIRMATION_PATTERN = /��ȷ��|��Ҫ�˹�|�˹��ӹ�|�޷�ȷ��/

/**
 * ��һ�� HTTP ������ࡣ
 * - 5xx / 429 / �����쳣 �� unavailable�����δ֪�������ԣ����ܵ�����̬��
 * - **402�����İ���������/���㣩�� failed**������**ȷ���Ծܾ�**��
 *   ����ʱ���Զ��ٴζ�����ɹ���������ʾ�û�ȥ��ֵ��
 *   �������� 429 ������ʾ���Ժ����ԡ����Զ����ԡ�
 * - 401/403 �� expired���Ự��Ȩ��ʧЧ����Ҫ���µ�¼��
 * - 404 �� not-found�������ں�˲����ڣ������ѹ�����������
 * - 409 �� rejected��״̬�ѱ仯�������ͻ����Ҫˢ�º����ԡ�
 * - ���� 4xx �� failed�������ȷ�ܾ�������ʵʧ�ܡ�
 * - 200/202 ����ȷ�ϱ�� �� pending-confirmation�����δ������δ֪�������˹�/���¼�顣
 */
export function classifyOutcome(status: number | undefined, message = '', payload?: unknown): RequestOutcome {
  const text = `${message} ${payload && typeof payload === 'object' ? JSON.stringify(payload) : ''}`
  if (status === undefined) return 'unavailable'
  // �������� 429 ��֧�жϣ�������ȷ���Ծܾ������ǡ��Ժ����ԡ���
  if (status === 402 || /���ֲ���|����|����|insufficient\s+(points|balance)/i.test(text)) return 'failed'
  if (status >= 500 || status === 429 || status === 408) return 'unavailable'
  if (status === 401 || status === 403) return 'expired'
  if (status === 404) return 'not-found'
  if (status === 409) return 'rejected'
  if (status === 0) return 'unavailable'
  if (CONFIRMATION_PATTERN.test(text)) return 'pending-confirmation'
  if (status >= 400) return 'failed'
  return CONFIRMATION_PATTERN.test(text) ? 'pending-confirmation' : 'ok'
}

/** ����״̬��������ʵ�ӳ�䣬����ѯ�ж��ܷ�����ȴ��� */
export function outcomeOfTask(task: { status?: string; needsReview?: boolean } | undefined): RequestOutcome {
  if (!task) return 'unavailable'
  if (task.needsReview) return 'pending-confirmation'
  if (task.status === 'success') return 'ok'
  if (task.status === 'pending' || task.status === 'running' || task.status === 'paused') return 'unavailable'
  if (task.status === 'cancelled') return 'rejected'
  return 'failed'
}

/**
 * ���ɽӿڿ��ܷ��� 200 �� 202�����δ��������ȷ�ϣ���
 * ���߶�Я�����������������ֻ�� 4xx/5xx ��Ϊʧ�ܡ�
 * ������쳣ͳһת�� `unavailable`���õ��÷����֡�û�ʵ����͡�����ʧ�ܡ���
 */
async function generate<T>(path: string, init: RequestInit): Promise<GenerationResponse<T>> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store' })
  } catch (reason) {
    // ����������жϡ�DNS ʧ�ܡ����ӱ����ã���������Ѿ������ˣ����δ֪��
    throw new StudioApiError(reason instanceof Error ? reason.message : '��������ʧ�ܣ��޷�ȷ�Ϸ����״̬', 0, { outcome: 'unavailable' })
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
 * ����һ���ύ��ʶ��
 *
 * ����� `(user, task_type, clientRequestId, attemptNo)` ���ݵ�ȥ�أ�
 * ͬһ�� ID �ظ��ύֻ�᷵�ص�һ�δ��������񣬲����ظ��۷ѡ�
 * ������ ID �����ɵ��÷����в����ã��������ԣ���ֻ�С���ȷ����һ�δ������Ż��� ID��
 */
export function newClientRequestId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/* ---------------------------------- ���� ---------------------------------- */

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
      ...(input.edit ? { edit: input.edit } : {}),
      source: input.surface ?? 'image-workbench',
      context: projectTaskContext(input),
    }),
    headers: requestIdHeaders(input.clientRequestId, input.attemptNo),
  })
}

/**
 * ������ȶ�ȡ `x-vozeb-pro-client-request-id` ͷ��������֮ǰ���ȥ�أ�
 * �������ͬһ�� ID �Ȳ����½�����Ҳ���ᱻ�ظ�����������
 */
function requestIdHeaders(clientRequestId?: string, attemptNo?: number) {
  const headers: Record<string, string> = {}
  if (clientRequestId) headers['x-vozeb-pro-client-request-id'] = clientRequestId
  if (attemptNo && attemptNo > 0) headers['x-vozeb-pro-attempt-no'] = String(attemptNo)
  return headers
}

function projectTaskContext(input: { projectId?: string; episodeId?: string; shotId?: string; conversationId?: string; parentTaskId?: string; surface?: string; clientRequestId?: string; attemptNo?: number }) {
  return Object.fromEntries(Object.entries({
    projectId: input.projectId,
    episodeId: input.episodeId,
    shotId: input.shotId,
    conversationId: input.conversationId,
    parentTaskId: input.parentTaskId,
    surface: input.surface,
    clientRequestId: input.clientRequestId,
    attemptNo: input.attemptNo,
  }).filter(([, value]) => value !== undefined && value !== ''))
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
      context: projectTaskContext(input),
    }),
    headers: requestIdHeaders(input.clientRequestId, input.attemptNo),
  })
}

/** ��������ڵĲο��زĽ��������Ȩ��У�����ʱ����������� blob: URL ֱ�Ӵ������Ρ� */
export async function publishReferenceAsset(type: 'image' | 'video', dataUrl: string) {
  if (!dataUrl) throw new StudioApiError('�ο��زĶ�ȡʧ�ܣ��������ϴ�', 400)
  if (dataUrl.length > 24 * 1024 * 1024) throw new StudioApiError('�ο��زĳ�����ǰֱ�����ƣ���ѹ��������', 413)
  const result = await generate<{ upstreamUrl?: string; error?: string; data?: { upstreamUrl?: string; error?: string } }>('/api/reference-assets', {
    method: 'POST',
    body: JSON.stringify({ type, dataUrl, persistent: false }),
  })
  const upstreamUrl = result.data?.upstreamUrl ?? result.data?.data?.upstreamUrl
  if (!upstreamUrl) throw new StudioApiError(result.data?.error || result.data?.data?.error || '�ο��زķ���ʧ��', 502, result.data)
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
      context: projectTaskContext(input),
    }),
    headers: requestIdHeaders(input.clientRequestId, input.attemptNo),
  })
}

/**
 * �ı����񴴽���
 *
 * �����֧�� `context.clientRequestId` �� `x-vozeb-pro-client-request-id` �ݵ�ͷ
 * �����ֲ��룩������ı�����������ͼƬ/��Ƶһ�����������Ը���ͬһ��ʶʱ
 * ��˷��ص�һ�δ��������񣬲����ظ�����Ҳ�����ظ��۷ѡ�
 */
export function createTextTask(input: TextGenerationInput) {
  return generate<{ task: GenerationTask }>('/api/text-tasks', {
    method: 'POST',
    body: JSON.stringify({
      config: input.model ? { model: input.model } : {},
      messages: input.messages?.length ? input.messages : [{ role: 'user', content: input.prompt }],
      context: {
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        ...(input.attemptNo ? { attemptNo: input.attemptNo } : {}),
      },
    }),
    headers: requestIdHeaders(input.clientRequestId),
  })
}

/* ---------------------------------- ��ѯ ---------------------------------- */

const taskPaths: Record<string, string> = { image: 'image-tasks', video: 'video-tasks', audio: 'audio-tasks', text: 'text-tasks' }

export function getGenerationTask(kind: 'image' | 'video' | 'audio' | 'text', id: string) {
  const path = taskPaths[kind]
  if (!path) throw new StudioApiError('��֧�ֵ���������', 400)
  return generate<{ task: GenerationTask }>(`/api/${path}/${encodeURIComponent(id)}`, { method: 'GET' })
}

/** ȡ�����񡣺��ֻ���� pending/running ״̬ȡ�������෵�� 409�� */
export function cancelGenerationTask(kind: 'image' | 'video' | 'audio' | 'text', id: string) {
  const path = taskPaths[kind]
  if (!path) throw new StudioApiError('��֧�ֵ���������', 400)
  return generate<{ task: GenerationTask }>(`/api/${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled' }),
  })
}

/** ���¼������״̬������ʧ�ܻ�������Ļ��ա� */
export function recoverGenerationTask(kind: 'image' | 'video' | 'audio' | 'text', id: string) {
  const path = taskPaths[kind]
  if (!path) throw new StudioApiError('��֧�ֵ���������', 400)
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
  snapshot?: unknown
  preferences?: { mode: 'image' | 'video'; image?: { size?: string; quality?: string; count?: number }; video?: { size?: string; quality?: string; seconds?: number } }
  /** �ݵȱ�ʶ������ʧ�ܺ����Ա��븴�ã���˾ݴ˷���ԭ���ж������½��� */
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
      ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
      ...(input.preferences ? { preferences: input.preferences } : {}),
    }),
  })
}

/** Agent ֧����ͣ���ָ������ԡ�ȡ�����ƻ�ȷ�ϡ� */
export function controlAgentRun(id: string, action: 'pause' | 'resume' | 'retry' | 'cancel' | 'approve') {
  return generate<{ run: AgentRun }>(`/api/agent/runs/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({}) })
}

/** ���� Agent ������ʧ�ܵ������� */
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

/** �����¼�����Ӧ��ֻ���� data ���أ�����������ע���С� */
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

/* -------------------------------- ���ɼ�¼ -------------------------------- */

export async function listGenerationLogs(params: { page?: number; pageSize?: number; kind?: string; status?: string } = {}) {
  const search = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) })
  if (params.kind) search.set('kind', params.kind)
  if (params.status) search.set('status', params.status)
  const { data } = await generate<{ items?: GenerationLog[]; logs?: GenerationLog[]; total?: number }>(`/api/generation-logs?${search.toString()}`, { method: 'GET' })
  return { items: data?.items ?? data?.logs ?? [], total: Number(data?.total) || 0 }
}

/* -------------------------------- �����һ�� -------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function textOf(value: unknown) {
  return typeof value === 'string' ? value : ''
}

/**
 * ��˸���������� result �ṹ��ͬ��ͼƬΪ dataUrl/remoteUrl����ƵΪ url/poster����ƵΪ url���ı�Ϊ content����
 * ����ͳһ������ MediaResult[] ���ѡ�ı���ҳ�����ֻ�账��һ����̬��
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

  // ȥ�أ������״γ��ֵ�˳��
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

