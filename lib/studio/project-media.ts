/**
 * 作品/素材 → 项目引用的真实持久化。
 *
 * 背景（本轮复现的真实缺陷）：
 *  - 图片工作台的「加入项目」只 `setNotice('已加入极光之后项目素材。')`——
 *    纯提示，什么都没有写入，刷新后自然也没有；
 *  - 「送入画布」写死 `router.push('/canvas/aurora')`，不管当前项目是哪个，
 *    对没有 aurora 项目的用户直接跳到一个空画布；
 *  - 素材库的「加入项目」只改本地 state，换浏览器就丢。
 *
 * 后端已有真实承载：`/api/canvas/projects/:id` 会把画布节点与连线持久化。
 * 因此「加入项目」= 在该项目画布上新增一个媒体节点；
 * 「送入画布」= 打开该项目（新节点已经在画布里）。两者都真实落库。
 */

import { canvasProjectToBoard, getCanvasProject, updateCanvasProject, type CanvasBackendProject } from './api'
import type { CanvasBoard, CanvasNodeData, CanvasNodeKind } from './types'

/** 一个可加入项目的媒体（来自任务结果、后端作品或素材库）。 */
export type ProjectMediaInput = {
  /** 稳定标识，用于幂等：同一媒体重复加入不会产生多个节点。 */
  sourceId: string
  title: string
  kind: 'image' | 'video' | 'audio'
  url: string
  poster?: string
  prompt?: string
  model?: string
  detail?: string
}

/**
 * 媒体节点在画布节点 `data` 上的标记。
 *
 * 用 `data` 而不是 `metadata`：`canvasProjectToBoard` 只把 `data` 还原进画布，
 * 写在 metadata 里的字段在「读取 → 编辑 → 保存」一圈后会丢失，
 * 那样幂等判断就会失效并产生重复节点。
 */
export const PROJECT_MEDIA_MARKER = 'oaooaoMediaSourceId'

/** 画布只认这几种节点类型，音频没有独立类型，落到 task 节点。 */
function canvasKindOf(kind: ProjectMediaInput['kind']): CanvasNodeKind {
  return kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'task'
}

function mediaNodeId(sourceId: string) {
  // 节点 ID 必须稳定且可比较，才能做幂等与「已加入」判断。
  let hash = 0
  for (let index = 0; index < sourceId.length; index += 1) {
    hash = (hash * 31 + sourceId.charCodeAt(index)) | 0
  }
  return `media-${(hash >>> 0).toString(36)}`
}

/** 该媒体是否已经在画布上（按稳定 sourceId 判断，不看标题）。 */
export function hasMediaNode(board: CanvasBoard, sourceId: string): boolean {
  return board.nodes.some((node) => node.data?.[PROJECT_MEDIA_MARKER] === sourceId || node.id === mediaNodeId(sourceId))
}

/** 位置按已有节点数量排布，避免全部叠在原点而看起来「没加进去」。 */
function nextPosition(board: CanvasBoard) {
  const count = board.nodes.length
  const columns = 4
  return { x: (count % columns) * 340, y: Math.floor(count / columns) * 320 }
}

export type AddToProjectResult = {
  projectId: string
  nodeId: string
  /** 已经存在时为 true：没有重复写入，如实告知用户。 */
  alreadyPresent: boolean
}

/**
 * 把一个媒体加入项目画布。
 *
 * 幂等：同一 `sourceId` 已存在时直接返回，不重复写节点。
 * 失败时抛出后端原因，由调用方提示——绝不吞掉错误只弹「成功」。
 */
export async function addMediaToProject(projectId: string, media: ProjectMediaInput): Promise<AddToProjectResult> {
  if (!projectId) throw new Error('请先选择要加入的项目')
  if (!media.url) throw new Error('该结果没有可用的媒体地址，无法加入项目')
  const project: CanvasBackendProject = await getCanvasProject(projectId)
  const board = canvasProjectToBoard(project)
  const nodeId = mediaNodeId(media.sourceId)
  if (hasMediaNode(board, media.sourceId)) return { projectId, nodeId, alreadyPresent: true }
  const data: CanvasNodeData = {
    title: media.title || '未命名素材',
    kind: canvasKindOf(media.kind),
    detail: media.detail || media.prompt || '',
    src: media.url,
    poster: media.poster,
    status: 'ready',
    [PROJECT_MEDIA_MARKER]: media.sourceId,
    prompt: media.prompt ?? '',
    model: media.model ?? '',
  }
  const next: CanvasBoard = {
    nodes: [...board.nodes, { id: nodeId, type: 'media', position: nextPosition(board), data }],
    edges: board.edges,
  }
  await updateCanvasProject(project, next)
  return { projectId, nodeId, alreadyPresent: false }
}

/**
 * 从项目移除一个媒体引用。
 *
 * 与「删除原文件」严格区分：
 *  - 移除引用只从画布上删掉这个节点，**不动**服务器上的媒体文件，
 *    因此其他项目与作品仍能继续使用同一份素材；
 *  - 删除文件是素材库的独立操作。
 * 这是「不能误删其他项目仍在使用的素材」的实现基础。
 */
export async function removeMediaFromProject(projectId: string, sourceId: string): Promise<{ removed: boolean }> {
  if (!projectId) throw new Error('项目标识为空')
  const project: CanvasBackendProject = await getCanvasProject(projectId)
  const board = canvasProjectToBoard(project)
  if (!hasMediaNode(board, sourceId)) return { removed: false }
  const nodes = board.nodes.filter((node) => node.data?.[PROJECT_MEDIA_MARKER] !== sourceId && node.id !== mediaNodeId(sourceId))
  await updateCanvasProject(project, { nodes, edges: board.edges })
  return { removed: true }
}

/** 列出画布引用的全部媒体。 */
export function listBoardMedia(board: CanvasBoard): Array<{ sourceId: string; title: string; url: string }> {
  return board.nodes.flatMap((node) => {
    const sourceId = node.data?.[PROJECT_MEDIA_MARKER]
    const url = node.data?.src
    if (typeof sourceId !== 'string' || !sourceId || typeof url !== 'string' || !url) return []
    return [{ sourceId, title: String(node.data?.title ?? ''), url }]
  })
}

/** 项目画布上引用的全部 sourceId，用于素材页判断「是否已被项目引用」。 */
export async function listProjectReferencedSourceIds(projectId: string): Promise<string[]> {
  const project: CanvasBackendProject = await getCanvasProject(projectId)
  return listBoardMedia(canvasProjectToBoard(project)).map((item) => item.sourceId)
}
