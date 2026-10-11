import type { Viewport } from '@xyflow/react'
import type { CanvasBackendConnection, CanvasBackendNode, CanvasBackendProject } from '@/lib/studio/api'
import { GENERATION_TITLES } from './node-factory'
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
  type TaskPhase,
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
  if (candidate === 'reference' || candidate === 'asset' || candidate === 'group') return candidate
  if (isGenerationKind(candidate)) return candidate
  return 'text'
}

type CanvasNodeKindValue = GenerationKind | MediaNodeKind | 'agent' | 'group'

function readReference(value: unknown): NodeReference | null {
  const raw = asRecord(value)
  const url = textOf(raw.url)
  if (!url) return null
  return {
    id: textOf(raw.id, url),
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
  const id = textOf(raw.generationTaskId) || asRecord(raw.task).id
  if (typeof id !== 'string' || !id) return null
  const task = asRecord(raw.task)
  const phase = isTaskPhase(task.phase) ? task.phase : LEGACY_PHASE[textOf(raw.status)] ?? 'running'
  return { id: textOf(id), phase, error: textOf(task.error) || undefined, startedAt: numberOf(task.startedAt, Date.now()) }
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
    count: Math.min(4, Math.max(1, numberOf(raw.count, 1))),
    voice: textOf(raw.voice),
    format: textOf(raw.format),
    references: Array.isArray(raw.references) ? readReferences(raw.references) : readLegacyReferences(raw.referenceUrls),
    skills: readSkills(raw.skills),
    task: readTask(raw),
    results: readResults(kind, raw, meta),
    text: textOf(raw.text, textOf(raw.content)),
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
  return {
    kind: 'agent',
    title: textOf(raw.title, 'OAO Agent'),
    prompt: textOf(raw.prompt),
    runId: textOf(raw.runId, textOf(raw.agentRunId)) || null,
    runStatus: textOf(raw.runStatus) || null,
    steps: readSteps(raw.steps),
    failure: textOf(raw.failure) || null,
    pointsCost,
    context: Array.isArray(raw.context) ? raw.context.filter((item): item is string => typeof item === 'string') : [],
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
    ...(node.type === 'group' ? { width: node.width, height: node.height } : {}),
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
