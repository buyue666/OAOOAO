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

async function persistOnce() {
  const state = useCanvasStore.getState()
  if (!state.projectId || !state.hydrated || state.revision === state.savedRevision || state.saveStatus === 'conflict') return
  const revision = state.revision
  state.setSaveStatus('saving')
  try {
    const response = await request<SaveResponse>(`/api/canvas/projects/${encodeURIComponent(state.projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(buildSaveBody(state)),
    })
    const updatedAt = response.data?.project?.updatedAt ?? response.data?.ack?.updatedAt ?? null
    useCanvasStore.getState().markSaved(updatedAt, revision)
  } catch (error) {
    if (error instanceof StudioApiError && error.status === 409) {
      useCanvasStore.getState().setSaveStatus('conflict', '画布已在别处更新，请刷新页面后继续编辑')
      return
    }
    useCanvasStore.getState().setSaveStatus('error', error instanceof Error ? error.message : '保存失败')
  }
}

function scheduleCanvasSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushCanvasSave()
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
  inFlight = persistOnce().finally(() => {
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

/** 页面隐藏或关闭时用 keepalive 发出最后一次保存，避免最近 700ms 的修改丢失。 */
export function flushCanvasSaveOnHide() {
  const state = useCanvasStore.getState()
  if (!state.projectId || !state.hydrated || state.revision === state.savedRevision || state.saveStatus === 'conflict') return
  void fetch(`/api/canvas/projects/${encodeURIComponent(state.projectId)}`, {
    method: 'PATCH',
    credentials: 'include',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildSaveBody(state)),
  })
}

/** Agent 在服务端写入的新节点合并回编辑器；本地已有的节点与连线保持不变。 */
export async function mergeRemoteAdditions() {
  const projectId = useCanvasStore.getState().projectId
  if (!projectId) return
  await flushCanvasSave()
  const project = await getCanvasProject(projectId)
  const board = readBoard(project)
  useCanvasStore.getState().mergeRemote(board.nodes, board.edges, project.updatedAt)
}
