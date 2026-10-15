import type { Viewport } from '@xyflow/react'
import type { CanvasBackendConnection, CanvasBackendNode, CanvasBackendProject } from '@/lib/studio/api'
import { DEFAULT_DIRECTOR_SCENE, GENERATION_TITLES } from './node-factory'
import {
  HANDLE_IDS,
  isGenerationKind,
  isMediaKind,
  type AgentNodeData,
  type AgentStep,
  type FreeCanvasEdge,
  type FreeCanvasNode,
  type GenerationKind,
  type GenerationNodeData,
  type MediaNodeData,
  type MediaNodeKind,
  type NodeReference,
  type NodeResult,
  type NodeSkill,
  type NodeTask,
  type NodeSubmission,
  type TaskPhase,
  type DirectorNodeData,
  type DirectorSceneData,
} from './types'

type Raw = Record<string, unknown>

/** 工作台画布（studio）写入的中文状态，读回时还原为任务阶段。 */
const LEGACY_PHASE: Record<string, TaskPhase> = {
  生成中: 'running',
  已完成: 'success',
  生成失败: 'error',
  已取消: 'cancelled',
}

const PHASE_LEGACY_STATUS: Record<TaskPhase, string> = {
  queued: '生成中',
  running: '生成中',
  success: '已完成',
  error: '生成失败',
  cancelled: '已取消',
}

function asRecord(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

function textOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberOf(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback
}

function resolveKind(raw: Raw, type: unknown): CanvasNodeKindValue {
  const candidate = textOf(raw.kind, textOf(type))
  if (candidate === 'task' || candidate === 'agent') return 'agent'
  if (candidate === 'reference' || candidate === 'asset' || candidate === 'group' || candidate === 'director') return candidate
  if (isGenerationKind(candidate)) return candidate
  return 'text'
}

type CanvasNodeKindValue = GenerationKind | MediaNodeKind | 'agent' | 'director' | 'group'

function readDirectorScene(value: unknown): DirectorSceneData {
  const raw = asRecord(value)
  const actors = Array.isArray(raw.actors) ? raw.actors.flatMap((item, index) => {
    const actor = asRecord(item)
    const id = textOf(actor.id, `actor-${index + 1}`)
    return [{ id, name: textOf(actor.name, `角色 ${index + 1}`), x: numberOf(actor.x), y: numberOf(actor.y), z: numberOf(actor.z), color: textOf(actor.color, '#74b9ff'), scale: Math.max(0.25, numberOf(actor.scale, 1)), pose: (actor.pose === 'hero' || actor.pose === 'walk' ? actor.pose : 'idle') as 'idle' | 'hero' | 'walk' }]
  }) : DEFAULT_DIRECTOR_SCENE.actors
  const cameras = Array.isArray(raw.cameras) ? raw.cameras.flatMap((item, index) => {
    const camera = asRecord(item)
    return [{ id: textOf(camera.id, `camera-${index + 1}`), name: textOf(camera.name, `机位 ${index + 1}`), x: numberOf(camera.x), y: numberOf(camera.y, 2.2), z: numberOf(camera.z, 6.5), targetX: numberOf(camera.targetX), targetY: numberOf(camera.targetY, 1), targetZ: numberOf(camera.targetZ), fov: Math.min(100, Math.max(20, numberOf(camera.fov, 42))) }]
  }) : DEFAULT_DIRECTOR_SCENE.cameras
  const activeCameraId = textOf(raw.activeCameraId, cameras[0]?.id ?? DEFAULT_DIRECTOR_SCENE.activeCameraId)
  return {
    schemaVersion: 1,
    aspect: raw.aspect === '9:16' || raw.aspect === '1:1' ? raw.aspect : '16:9',
    grid: raw.grid !== false,
    actors: actors.length ? actors : DEFAULT_DIRECTOR_SCENE.actors,
    cameras: cameras.length ? cameras : DEFAULT_DIRECTOR_SCENE.cameras,
    activeCameraId: cameras.some(camera => camera.id === activeCameraId) ? activeCameraId : cameras[0]?.id ?? DEFAULT_DIRECTOR_SCENE.activeCameraId,
    notes: textOf(raw.notes),
  }
}

function readDirector(raw: Raw): DirectorNodeData {
  return { kind: 'director', title: textOf(raw.title, '3D 导演台'), scene: readDirectorScene(raw.scene), ...(numberOf(raw.lastCaptureAt) ? { lastCaptureAt: numberOf(raw.lastCaptureAt) } : {}) }
}

function readReference(value: unknown): NodeReference | null {
  const raw = asRecord(value)
  const url = textOf(raw.url)
  if (!url) return null
  return {
    id: textOf(raw.id, url),
    ...(textOf(raw.libraryAssetId) ? { libraryAssetId: textOf(raw.libraryAssetId) } : {}),
    title: textOf(raw.title, '参考素材'),
    url,
    mediaKind: isMediaKind(raw.mediaKind) ? raw.mediaKind : 'image',
  }
}

function readReferences(value: unknown): NodeReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const reference = readReference(item)
    return reference ? [reference] : []
  })
}

function readLegacyReferences(value: unknown): NodeReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item !== 'string' || !item) return []
    return [{ id: item, title: `参考 ${index + 1}`, url: item, mediaKind: 'image' as const }]
  })
}

function readSkills(value: unknown): NodeSkill[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const raw = asRecord(item)
    const id = textOf(raw.id)
    const prompt = textOf(raw.prompt)
    return id && prompt ? [{ id, title: textOf(raw.title, '技能'), prompt }] : []
  })
}

function readResults(kind: GenerationKind, raw: Raw, meta: Raw): NodeResult[] {
  if (Array.isArray(raw.results)) {
    return raw.results.flatMap((item) => {
      const result = asRecord(item)
      const url = textOf(result.url)
      if (!url) return []
      return [{ url, poster: textOf(result.poster) || undefined, mediaKind: isMediaKind(result.mediaKind) ? result.mediaKind : 'image' }]
    })
  }
  const url = textOf(raw.src) || textOf(meta.remoteUrl)
  if (!url || kind === 'text') return []
  const mediaKind = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image'
  return [{ url, poster: textOf(raw.poster) || textOf(meta.posterUrl) || undefined, mediaKind }]
}

function readTask(raw: Raw): NodeTask | null {
  const task = asRecord(raw.task)
  const id = textOf(raw.generationTaskId) || textOf(task.id)
  const candidate = asRecord(task.submission), input = asRecord(candidate.input)
  const submission = isGenerationKind(textOf(candidate.kind)) && typeof input.prompt === 'string' && typeof input.clientRequestId === 'string' && input.clientRequestId
    ? candidate as NodeSubmission : undefined
  if (!id && !submission && !isTaskPhase(task.phase)) return null
  const savedPhase = isTaskPhase(task.phase) ? task.phase : LEGACY_PHASE[textOf(raw.status)] ?? 'running'
  const unconfirmed = !id && Boolean(task.unconfirmed || (savedPhase === 'queued' && submission))
  const interrupted = !id && savedPhase === 'queued'
  return { id, phase: unconfirmed || interrupted ? 'error' : savedPhase, unconfirmed, submission,
    cancelRequested: Boolean(task.cancelRequested),
    clientRequestId: textOf(task.clientRequestId) || submission?.input.clientRequestId,
    error: unconfirmed ? '请确认上次提交结果；重试会使用原参数和标识，不会重复扣费。' : interrupted ? '提交准备已中断，请检查任务记录后重试。' : textOf(task.error) || undefined,
    startedAt: numberOf(task.startedAt, Date.now()) }
}

function isTaskPhase(value: unknown): value is TaskPhase {
  return value === 'queued' || value === 'running' || value === 'success' || value === 'error' || value === 'cancelled'
}

function readGeneration(kind: GenerationKind, raw: Raw, meta: Raw): GenerationNodeData {
  return {
    kind,
    title: textOf(raw.title, GENERATION_TITLES[kind]),
    prompt: textOf(raw.prompt),
    model: textOf(raw.model),
    ratio: textOf(raw.ratio),
    quality: textOf(raw.quality),
    seconds: numberOf(raw.seconds, 0),
    count: 1,
    voice: textOf(raw.voice),
    format: textOf(raw.format),
    references: Array.isArray(raw.references) ? readReferences(raw.references) : readLegacyReferences(raw.referenceUrls),
    skills: readSkills(raw.skills),
    task: readTask(raw),
    results: readResults(kind, raw, meta),
    text: textOf(raw.text, textOf(raw.content)),
    ...(typeof asRecord(raw.resultSource).runId === 'string' && typeof asRecord(raw.resultSource).assetId === 'string' ? { resultSource: raw.resultSource as GenerationNodeData['resultSource'] } : {}),
  }
}

function readMedia(kind: MediaNodeKind, raw: Raw): MediaNodeData {
  return {
    kind,
    title: textOf(raw.title, kind === 'asset' ? '资产' : '参考素材'),
    media: readReference(raw.media),
  }
}

function readSteps(value: unknown): AgentStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const raw = asRecord(item)
    const id = textOf(raw.id)
    return id ? [{ id, title: textOf(raw.title, '步骤'), type: textOf(raw.type), status: textOf(raw.status), error: textOf(raw.error) || undefined }] : []
  })
}

function readAgent(raw: Raw): AgentNodeData {
  const pointsCost = raw.pointsCost === null || raw.pointsCost === undefined ? null : numberOf(raw.pointsCost, 0)
  const runId = textOf(raw.runId, textOf(raw.agentRunId)) || null
  const runStatus = textOf(raw.runStatus) || null
  const clientRequestId = textOf(raw.clientRequestId) || null
  const submission = raw.submission && typeof raw.submission === 'object' && typeof asRecord(raw.submission).prompt === 'string'
    ? { prompt: String(asRecord(raw.submission).prompt), assetIds: Array.isArray(asRecord(raw.submission).assetIds) ? (asRecord(raw.submission).assetIds as unknown[]).filter((id): id is string => typeof id === 'string') : [], skillIds: Array.isArray(asRecord(raw.submission).skillIds) ? (asRecord(raw.submission).skillIds as unknown[]).filter((id): id is string => typeof id === 'string') : [] }
    : undefined
  // A saved pre-submit snapshot cannot prove whether the request was accepted.
  // Reopen the existing idempotent recovery path instead of locking forever.
  const interrupted = !runId && runStatus === 'planning' && Boolean(clientRequestId && submission)
  return {
    kind: 'agent',
    title: textOf(raw.title, 'OAO Agent'),
    prompt: textOf(raw.prompt),
    skills: readSkills(raw.skills),
    collapsed: raw.collapsed === true,
    runId,
    runStatus: interrupted ? 'unconfirmed' : runStatus,
    steps: readSteps(raw.steps),
    failure: interrupted ? '上次规划提交尚未确认，请点击“确认上次提交”沿用原请求安全恢复。' : textOf(raw.failure) || null,
    pointsCost,
    context: Array.isArray(raw.context) ? raw.context.filter((item): item is string => typeof item === 'string') : [],
    clientRequestId,
    submission,
    deliveredRunId: textOf(raw.deliveredRunId) || null,
    deliveryError: textOf(raw.deliveryError) || null,
    planApproval: raw.planApproval && typeof raw.planApproval === 'object'
      ? { totalPoints: numberOf(asRecord(raw.planApproval).totalPoints), estimated: Boolean(asRecord(raw.planApproval).estimated), ...(numberOf(asRecord(raw.planApproval).approvedAt) ? { approvedAt: numberOf(asRecord(raw.planApproval).approvedAt) } : {}) }
      : undefined,
  }
}

function readNode(node: CanvasBackendNode): FreeCanvasNode {
  const raw = asRecord(node.data)
  const meta = asRecord(node.metadata)
  const kind = resolveKind(raw, node.type)
  const common = {
    id: node.id,
    position: { x: numberOf(node.position?.x), y: numberOf(node.position?.y) },
    ...(textOf(node.parentId) ? { parentId: textOf(node.parentId) } : {}),
  }
  if (kind === 'group') {
    return { ...common, type: 'group', width: numberOf(node.width, 420), height: numberOf(node.height, 300), data: { kind: 'group', title: textOf(raw.title, '分组') } }
  }
  if (kind === 'agent') return { ...common, type: 'agent', data: readAgent(raw) }
  if (kind === 'director') return { ...common, type: 'director', width: numberOf(node.width, 360), height: numberOf(node.height, 280), data: readDirector(raw) }
  if (kind === 'reference' || kind === 'asset') return { ...common, type: 'media', data: readMedia(kind, raw) }
  return { ...common, type: 'generation', data: readGeneration(kind, raw, meta) }
}

function sortGroupsFirst(nodes: FreeCanvasNode[]) {
  return [...nodes].sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'))
}

function readEdge(connection: CanvasBackendConnection): FreeCanvasEdge {
  return {
    id: connection.id,
    source: connection.source,
    target: connection.target,
    sourceHandle: textOf(connection.sourceHandle, HANDLE_IDS.outRight),
    targetHandle: textOf(connection.targetHandle, HANDLE_IDS.inLeft),
    type: 'default',
  }
}

export function readBoard(project: CanvasBackendProject): { nodes: FreeCanvasNode[]; edges: FreeCanvasEdge[]; viewport: Viewport | null } {
  const viewport = asRecord(project.viewport)
  const zoom = numberOf(viewport.k, numberOf(viewport.zoom, 1))
  return {
    nodes: sortGroupsFirst((project.nodes ?? []).map(readNode)),
    edges: (project.connections ?? []).map(readEdge),
    viewport: Number.isFinite(Number(viewport.x)) && Number.isFinite(Number(viewport.y)) ? { x: Number(viewport.x), y: Number(viewport.y), zoom } : null,
  }
}

function primaryMediaOf(node: FreeCanvasNode): NodeResult | null {
  if (node.type === 'generation') return node.data.results[0] ?? null
  if (node.type === 'media' && node.data.media) return { url: node.data.media.url, mediaKind: node.data.media.mediaKind }
  return null
}

/**
 * 生成节点同时写入工作台画布读取的旧字段（src/poster/content/status），
 * 保证同一个项目在工作台的画布视图中也能看到结果，而不是空白节点。
 */
function withLegacyGenerationFields(data: GenerationNodeData) {
  const primary = data.results[0]
  return {
    ...data,
    src: primary?.url,
    poster: primary?.poster,
    content: data.text || undefined,
    status: data.task ? PHASE_LEGACY_STATUS[data.task.phase] : primary || data.text ? '已完成' : undefined,
    generationTaskId: data.task?.id || undefined,
    detail: `${data.model || '自动模型'} · ${data.task ? PHASE_LEGACY_STATUS[data.task.phase] : data.results.length || data.text ? '已完成' : '未生成'}`,
  }
}

function writeNode(node: FreeCanvasNode): CanvasBackendNode {
  const primary = primaryMediaOf(node)
  const data = node.type === 'generation'
    ? withLegacyGenerationFields(node.data)
    : node.type === 'media'
      ? { ...node.data, src: node.data.media?.url }
      : node.data
  return {
    id: node.id,
    type: node.data.kind,
    position: { x: node.position.x, y: node.position.y },
    data,
    metadata: {
      ...(primary?.url ? { remoteUrl: primary.url } : {}),
      ...(primary?.poster ? { posterUrl: primary.poster } : {}),
    },
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.type === 'group' || node.type === 'director' ? { width: node.width, height: node.height } : {}),
  }
}

function writeEdge(edge: FreeCanvasEdge): CanvasBackendConnection {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? HANDLE_IDS.outRight,
    targetHandle: edge.targetHandle ?? HANDLE_IDS.inLeft,
    type: 'default',
  }
}

export function writeBoard(nodes: FreeCanvasNode[], edges: FreeCanvasEdge[]) {
  return {
    nodes: nodes.map(writeNode),
    connections: edges.map(writeEdge),
  }
}

export function writeViewport(viewport: Viewport) {
  return { x: viewport.x, y: viewport.y, k: viewport.zoom }
}
