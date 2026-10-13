import { getCanvasProject, request, type CanvasBackendProject, type CanvasBackendNode } from './api'
import type { CanvasBoard } from './types'

export type ProjectMediaInput = {
  sourceId: string
  title: string
  kind: 'image' | 'video' | 'audio'
  url: string
  poster?: string
  prompt?: string
  model?: string
  detail?: string
}

export const PROJECT_MEDIA_MARKER = 'oaooaoMediaSourceId'
type MediaBoard = Pick<CanvasBackendProject, 'nodes'> | Pick<CanvasBoard, 'nodes'>

function mediaNodeId(sourceId: string) {
  let hash = 0
  for (let index = 0; index < sourceId.length; index += 1) hash = (hash * 31 + sourceId.charCodeAt(index)) | 0
  return `media-${(hash >>> 0).toString(36)}`
}

function referencesSource(node: MediaBoard['nodes'][number], sourceId: string) {
  const data = node.data as Record<string, unknown>
  const media = data.media && typeof data.media === 'object' ? data.media as Record<string, unknown> : undefined
  // A legacy hash alone is insufficient: unrelated sources can share a 32-bit hash.
  return data[PROJECT_MEDIA_MARKER] === sourceId || media?.id === sourceId ||
    (!data[PROJECT_MEDIA_MARKER] && !media?.id && node.id === mediaNodeId(sourceId) && data.src === sourceId)
}

export function hasMediaNode(board: MediaBoard, sourceId: string): boolean {
  return board.nodes.some((node) => referencesSource(node, sourceId))
}

export type AddToProjectResult = { projectId: string; nodeId: string; alreadyPresent: boolean }

/** Save the raw document under CAS. Never roundtrip through the older board adapter. */
async function saveSnapshot(project: CanvasBackendProject, next: CanvasBackendProject) {
  if (!project.updatedAt || !Number.isFinite(Date.parse(project.updatedAt))) throw new Error('项目版本不可用，请刷新后重试')
  const result = await request<{ data?: { project?: CanvasBackendProject; ack?: { updatedAt?: string } } }>(`/api/canvas/projects/${encodeURIComponent(project.id)}`, {
    method: 'PATCH', body: JSON.stringify({ expectedUpdatedAt: project.updatedAt, project: next }),
  })
  const updatedAt = result.data?.project?.updatedAt ?? result.data?.ack?.updatedAt
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) throw new Error('服务端未确认项目保存，请刷新后检查')
}

/** Append only the new node; all existing node, edge and project fields stay intact. */
export async function addMediaToProject(projectId: string, media: ProjectMediaInput): Promise<AddToProjectResult> {
  if (!projectId) throw new Error('请先选择要加入的项目')
  if (!media.url || !media.sourceId) throw new Error('该结果没有可用的媒体地址或标识，无法加入项目')
  const project = await getCanvasProject(projectId)
  const existing = project.nodes.find((node) => referencesSource(node, media.sourceId))
  if (existing) return { projectId, nodeId: existing.id, alreadyPresent: true }
  const nodeId = `media-${crypto.randomUUID()}`
  const title = media.title || '未命名素材'
  const node: CanvasBackendNode = {
    id: nodeId, type: 'reference', position: { x: (project.nodes.length % 4) * 340, y: Math.floor(project.nodes.length / 4) * 320 },
    data: { kind: 'reference', title, media: { id: media.sourceId, title, url: media.url, mediaKind: media.kind },
      [PROJECT_MEDIA_MARKER]: media.sourceId, src: media.url, poster: media.poster, prompt: media.prompt ?? '', model: media.model ?? '', detail: media.detail || media.prompt || '' },
  }
  await saveSnapshot(project, { ...project, nodes: [...project.nodes, node] })
  return { projectId, nodeId, alreadyPresent: false }
}

/** Remove matching references and their incident edges; preserve every unrelated field. */
export async function removeMediaFromProject(projectId: string, sourceId: string): Promise<{ removed: boolean }> {
  if (!projectId) throw new Error('项目标识为空')
  const project = await getCanvasProject(projectId)
  const removed = new Set(project.nodes.filter((node) => referencesSource(node, sourceId)).map((node) => node.id))
  if (!removed.size) return { removed: false }
  await saveSnapshot(project, { ...project, nodes: project.nodes.filter((node) => !removed.has(node.id)), connections: project.connections.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)) })
  return { removed: true }
}

export function listBoardMedia(board: MediaBoard): Array<{ sourceId: string; title: string; url: string }> {
  return board.nodes.flatMap((node) => {
    const data = node.data as Record<string, unknown>
    const media = data.media && typeof data.media === 'object' ? data.media as Record<string, unknown> : undefined
    const sourceId = data[PROJECT_MEDIA_MARKER] ?? media?.id
    const url = data.src ?? media?.url
    if (typeof sourceId !== 'string' || !sourceId || typeof url !== 'string' || !url) return []
    return [{ sourceId, title: String(data.title ?? ''), url }]
  })
}

export async function listProjectReferencedSourceIds(projectId: string): Promise<string[]> {
  return listBoardMedia(await getCanvasProject(projectId)).map((item) => item.sourceId)
}
