import { createCanvasProject, getCanvasProject, request, StudioApiError } from '@/lib/studio/api'
import { readBoard, writeBoard, writeViewport } from './board-codec'
import { useCanvasStore, type CanvasState } from './canvas-store'

const AUTOSAVE_DELAY_MS = 700

type SaveResponse = {
  data?: { project?: { updatedAt?: string }; ack?: { updatedAt?: string } }
}

export async function createFreeCanvas(title: string) {
  return createCanvasProject({ title })
}

/** 重命名需要回写完整项目，否则会把节点与连线清空。 */
export async function renameFreeCanvas(projectId: string, title: string) {
  const project = await getCanvasProject(projectId)
  await request(`/api/canvas/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedUpdatedAt: project.updatedAt, project: { ...project, title } }),
  })
}

function buildSaveBody(state: CanvasState) {
  return {
    expectedUpdatedAt: state.updatedAt,
    project: {
      ...state.projectMeta,
      id: state.projectId,
      title: state.title,
      ...writeBoard(state.nodes, state.edges),
      viewport: writeViewport(state.viewport),
    },
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null
let hiddenFlushes = 0

async function persistOnce(keepalive: boolean) {
  const state = useCanvasStore.getState()
  if (!state.projectId || !state.hydrated || state.revision === state.savedRevision || state.saveStatus === 'conflict') return
  const projectId = state.projectId
  // Hydration supplies a fresh metadata object, including when the same project
  // is reopened. A previous editor session must not acknowledge the new one.
  const projectMeta = state.projectMeta
  const revision = state.revision
  state.setSaveStatus('saving')
  try {
    const response = await request<SaveResponse>(`/api/canvas/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(buildSaveBody(state)),
      ...(keepalive ? { keepalive: true } : {}),
    })
    const updatedAt = response.data?.project?.updatedAt ?? response.data?.ack?.updatedAt ?? null
    if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) throw new Error('服务端未确认画布版本，修改尚未确认保存，请重试。')
    const current = useCanvasStore.getState()
    if (current.projectId === projectId && current.projectMeta === projectMeta && current.hydrated) current.markSaved(updatedAt, revision)
  } catch (error) {
    const current = useCanvasStore.getState()
    if (current.projectId !== projectId || current.projectMeta !== projectMeta || !current.hydrated) return
    if (error instanceof StudioApiError && error.status === 409) {
      current.setSaveStatus('conflict', '画布已在别处更新，请刷新页面后继续编辑')
      return
    }
    current.setSaveStatus('error', error instanceof Error ? error.message : '保存失败')
    throw error
  }
}

function scheduleCanvasSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushCanvasSave().catch(() => undefined)
  }, AUTOSAVE_DELAY_MS)
}

/** 立即保存当前画布；保存进行中时排队，保证服务端最终与编辑器一致。 */
export async function flushCanvasSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  while (inFlight) await inFlight
  const state = useCanvasStore.getState()
  if (state.revision === state.savedRevision) return
  inFlight = persistOnce(hiddenFlushes > 0).finally(() => {
    inFlight = null
  })
  await inFlight
  const after = useCanvasStore.getState()
  if (after.revision !== after.savedRevision && after.saveStatus === 'dirty') await flushCanvasSave()
}

/** 订阅编辑器的修改版本号，任何结构或内容变化都会防抖保存。 */
export function startCanvasAutosave() {
  return useCanvasStore.subscribe((state, previous) => {
    if (state.revision !== previous.revision && state.hydrated && state.saveStatus !== 'conflict') scheduleCanvasSave()
  })
}

export function stopCanvasSaveTimer() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}

/** 页面隐藏或关闭时尽力用 keepalive 提交最后修改，仍以服务端响应确认保存。 */
export function flushCanvasSaveOnHide() {
  const state = useCanvasStore.getState()
  if (!state.projectId || !state.hydrated || state.revision === state.savedRevision || state.saveStatus === 'conflict') return
  // Share the queue, response validation and CAS version with visible saves.
  // Mark queued revisions keepalive too when an ordinary request is in flight.
  hiddenFlushes += 1
  void flushCanvasSave().catch(() => undefined).finally(() => { hiddenFlushes -= 1 })
}

async function settleInFlightSave() {
  while (inFlight) await inFlight
}

/**
 * Agent 在服务端写入结果后，把服务端画布与新版本号同步回编辑器。
 * 这里不能先保存本地状态：本地版本号已过期，保存必然 409。没有未保存修改时整体采用服务端画布；
 * 有未保存修改时只追加服务端新增的节点与连线，本地修改优先，之后的保存会使用新的版本号。
 */
export async function syncRemoteBoard() {
  const { projectId, projectMeta } = useCanvasStore.getState()
  if (!projectId) return
  await settleInFlightSave()
  if (useCanvasStore.getState().projectId !== projectId || useCanvasStore.getState().projectMeta !== projectMeta) return
  const project = await getCanvasProject(projectId)
  if (useCanvasStore.getState().projectId !== projectId || useCanvasStore.getState().projectMeta !== projectMeta || !useCanvasStore.getState().hydrated) return
  const board = readBoard(project)
  useCanvasStore.getState().adoptRemoteBoard(board.nodes, board.edges, project.updatedAt)
}
