import { create } from 'zustand'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
  type XYPosition,
} from '@xyflow/react'
import { createGroupNode, NODE_GAP, newNodeId, sizeOf } from './node-factory'
import { arrangeCanvasNodes } from './canvas-layout'
import { absoluteNodePosition, absoluteNodePositions, orderNodesParentsFirst, selectionNodes, selectionRoots, selectionSnapshot } from './canvas-selection'
import { DEFAULT_SETTINGS_PLACEMENT, HANDLE_IDS, type AgentNodeData, type FreeCanvasEdge, type FreeCanvasNode, type GenerationNodeData, type MediaNodeData, type NodeSide, type SettingsPlacement } from './types'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

type Snapshot = { nodes: FreeCanvasNode[]; edges: FreeCanvasEdge[] }

export type TrashEntry = Snapshot & { id: string; label: string; absolutePositions?: Record<string, XYPosition> }

export type ContextTarget = { type: 'pane'; position: XYPosition } | { type: 'node'; nodeId: string }
export type ContextMenuState = { x: number; y: number; target: ContextTarget } | null
export type TypeMenuState = { nodeId: string; side: NodeSide } | null

export type HydratePayload = {
  projectId: string
  title: string
  updatedAt: string | null
  projectMeta: Record<string, unknown>
  nodes: FreeCanvasNode[]
  edges: FreeCanvasEdge[]
  viewport: Viewport
}

export type RemoteNodePatch = { id: string; data: Partial<GenerationNodeData> | Partial<MediaNodeData> | Partial<AgentNodeData> }

const HISTORY_LIMIT = 80
const TRASH_LIMIT = 20
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }
const GROUP_PADDING = 40
const GROUP_HEADER = 56

export type CanvasState = {
  projectId: string | null
  title: string
  updatedAt: string | null
  /** 后端项目中本编辑器不负责的字段（创建时间、会话等），保存时原样回写，避免覆盖。 */
  projectMeta: Record<string, unknown>
  nodes: FreeCanvasNode[]
  edges: FreeCanvasEdge[]
  viewport: Viewport
  hydrated: boolean
  revision: number
  savedRevision: number
  saveStatus: SaveStatus
  saveError: string | null
  past: Snapshot[]
  future: Snapshot[]
  trash: TrashEntry[]
  clipboard: Snapshot | null
  notice: string | null
  settingsNodeId: string | null
  settingsPlacement: SettingsPlacement
  typeMenu: TypeMenuState
  contextMenu: ContextMenuState
  assetPanelOpen: boolean
  assetTargetNodeId: string | null
  focusNodeId: string | null
  directorNodeId: string | null
  miniMapOpen: boolean
  snapToGrid: boolean
  showEdges: boolean

  hydrate: (payload: HydratePayload) => void
  reset: () => void
  setTitle: (title: string) => void
  markSaved: (updatedAt: string | null, revision: number) => void
  setSaveStatus: (status: SaveStatus, error?: string | null) => void
  setNotice: (notice: string | null) => void
  onNodesChange: (changes: NodeChange<FreeCanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange<FreeCanvasEdge>[]) => void
  connect: (connection: Connection) => void
  commitViewport: (viewport: Viewport) => void
  beginEdit: () => void
  undo: () => void
  redo: () => void
  insertNodes: (nodes: FreeCanvasNode[], edges?: FreeCanvasEdge[], options?: { select?: boolean; focus?: boolean; selectRoots?: boolean }) => void
  insertNodeNear: (sourceId: string, side: NodeSide, node: FreeCanvasNode) => string | null
  updateNodeData: (nodeId: string, patch: Record<string, unknown>, options?: { history?: boolean }) => void
  patchNodes: (patches: RemoteNodePatch[], options?: { persist?: boolean }) => void
  removeNodes: (ids: string[], label?: string) => void
  deleteSelection: () => void
  restoreTrash: (entryId: string) => void
  duplicateSelection: () => void
  copySelection: () => void
  pasteClipboard: (position?: XYPosition) => void
  groupSelection: () => void
  ungroupSelection: () => void
  alignSelection: (axis: 'x' | 'y') => void
  arrangeLayout: () => boolean
  setMiniMapOpen: (open: boolean) => void
  setSnapToGrid: (enabled: boolean) => void
  setShowEdges: (visible: boolean) => void
  adoptRemoteBoard: (nodes: FreeCanvasNode[], edges: FreeCanvasEdge[], updatedAt: string) => void
  openSettings: (nodeId: string | null, placement?: SettingsPlacement) => void
  openTypeMenu: (menu: TypeMenuState) => void
  openContextMenu: (menu: ContextMenuState) => void
  closeOverlays: () => void
  setAssetPanel: (open: boolean, targetNodeId?: string | null) => void
  clearFocus: () => void
  setDirectorNodeId: (nodeId: string | null) => void
  selectNodeOnly: (nodeId: string) => void
}

function absoluteOf(node: FreeCanvasNode, nodes: FreeCanvasNode[]): XYPosition {
  return absoluteNodePosition(node, nodes)
}

function sortGroupsFirst(nodes: FreeCanvasNode[]) {
  return orderNodesParentsFirst([...nodes].sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group')))
}

function selectOnly(nodes: FreeCanvasNode[], ids: Set<string>): FreeCanvasNode[] {
  return nodes.map((node) => (node.selected === ids.has(node.id) ? node : { ...node, selected: ids.has(node.id) }))
}

function snapshotOf(state: Pick<CanvasState, 'nodes' | 'edges'>): Snapshot {
  return { nodes: state.nodes, edges: state.edges }
}

/** 撤销栈只记录结构变化；同一份快照不会重复入栈（例如反复聚焦输入框）。 */
function historyPatch(state: CanvasState): Partial<CanvasState> {
  const last = state.past[state.past.length - 1]
  if (last && last.nodes === state.nodes && last.edges === state.edges) return { future: [] }
  return { past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT), future: [] }
}

function dirtyPatch(state: CanvasState): Partial<CanvasState> {
  if (state.saveStatus === 'conflict') return {}
  return { saveStatus: 'dirty', revision: state.revision + 1 }
}

function removalPatch(state: CanvasState, ids: string[], label: string): Partial<CanvasState> {
  const removed = selectionNodes(state.nodes, ids)
  const removeIds = new Set(removed.map(node => node.id))
  if (!removed.length) return {}
  const removedGroupIds = new Set(removed.filter((node) => node.type === 'group').map((node) => node.id))
  const nodes = state.nodes.filter((node) => !removeIds.has(node.id))
  const removedEdges = state.edges.filter((edge) => removeIds.has(edge.source) || removeIds.has(edge.target))
  const entry: TrashEntry = {
    id: newNodeId('trash'),
    label: removedGroupIds.size ? '删除分组及内容' : label,
    nodes: removed,
    edges: removedEdges,
    absolutePositions: Object.fromEntries([...absoluteNodePositions(state.nodes)].filter(([id]) => removeIds.has(id))),
  }
  return {
    ...historyPatch(state),
    ...dirtyPatch(state),
    nodes,
    edges: state.edges.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)),
    trash: [entry, ...state.trash].slice(0, TRASH_LIMIT),
    settingsNodeId: state.settingsNodeId && removeIds.has(state.settingsNodeId) ? null : state.settingsNodeId,
    typeMenu: state.typeMenu && removeIds.has(state.typeMenu.nodeId) ? null : state.typeMenu,
    contextMenu: null,
    directorNodeId: state.directorNodeId && removeIds.has(state.directorNodeId) ? null : state.directorNodeId,
    ...(removedGroupIds.size ? { notice: `已删除 ${removedGroupIds.size} 个分组及其中内容（共 ${removed.length} 个节点），可撤销。` } : {}),
  }
}

function cloneSelection(selected: FreeCanvasNode[], edges: FreeCanvasEdge[], offset: XYPosition): Snapshot {
  const selectedIds = new Set(selected.map((node) => node.id))
  const idMap = new Map(selected.map((node) => [node.id, newNodeId(String(node.type ?? 'node'))]))
  const nodes = selected.map((node): FreeCanvasNode => {
    const parentInSelection = node.parentId && selectedIds.has(node.parentId)
    const data = node.type === 'agent'
      ? { ...node.data, runId: null, runStatus: null, steps: [], failure: null, pointsCost: null, context: [], clientRequestId: null, submission: undefined, planApproval: undefined, deliveredRunId: null, deliveryError: null }
      : node.type === 'generation' ? { ...node.data, task: null } : node.data
    return {
      ...node,
      id: idMap.get(node.id) ?? node.id,
      data,
      position: parentInSelection ? { ...node.position } : { x: node.position.x + offset.x, y: node.position.y + offset.y },
      parentId: parentInSelection && node.parentId ? idMap.get(node.parentId) : undefined,
      selected: true,
      dragging: false,
    } as FreeCanvasNode
  })
  const clonedEdges = edges
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .map((edge): FreeCanvasEdge => ({
      ...edge,
      id: newNodeId('edge'),
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
      selected: false,
    }))
  return { nodes, edges: clonedEdges }
}

function overlaps(position: XYPosition, size: { width: number; height: number }, nodes: FreeCanvasNode[]) {
  const positions = absoluteNodePositions(nodes)
  return nodes.some((node) => {
    const origin = positions.get(node.id)!
    const other = sizeOf(node)
    return position.x < origin.x + other.width + 12
      && position.x + size.width + 12 > origin.x
      && position.y < origin.y + other.height + 12
      && position.y + size.height + 12 > origin.y
  })
}

function freeSpotFor(position: XYPosition, size: { width: number; height: number }, nodes: FreeCanvasNode[], side: NodeSide): XYPosition {
  let candidate = position
  for (let attempt = 0; attempt < 12 && overlaps(candidate, size, nodes); attempt += 1) {
    candidate = side === 'top' || side === 'bottom'
      ? { x: candidate.x + 80, y: candidate.y }
      : { x: candidate.x, y: candidate.y + 80 }
  }
  return candidate
}

const initialState = {
  projectId: null,
  title: '',
  updatedAt: null,
  projectMeta: {},
  nodes: [] as FreeCanvasNode[],
  edges: [] as FreeCanvasEdge[],
  viewport: DEFAULT_VIEWPORT,
  hydrated: false,
  revision: 0,
  savedRevision: 0,
  saveStatus: 'idle' as SaveStatus,
  saveError: null,
  past: [] as Snapshot[],
  future: [] as Snapshot[],
  trash: [] as TrashEntry[],
  clipboard: null as Snapshot | null,
  notice: null,
  settingsNodeId: null,
  settingsPlacement: DEFAULT_SETTINGS_PLACEMENT,
  typeMenu: null as TypeMenuState,
  contextMenu: null as ContextMenuState,
  assetPanelOpen: false,
  assetTargetNodeId: null,
  focusNodeId: null,
  directorNodeId: null,
  miniMapOpen: false,
  snapToGrid: false,
  showEdges: true,
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  ...initialState,

  hydrate: (payload) =>
    set({
      ...initialState,
      projectId: payload.projectId,
      title: payload.title,
      updatedAt: payload.updatedAt,
      projectMeta: payload.projectMeta,
      nodes: sortGroupsFirst(payload.nodes),
      edges: payload.edges,
      viewport: payload.viewport,
      hydrated: true,
    }),

  reset: () => set({ ...initialState }),

  setTitle: (title) => set((state) => {
    const next = title.trim().slice(0, 80)
    return next && next !== state.title ? { title: next, ...dirtyPatch(state) } : {}
  }),

  // Navigation preferences belong to this editor session, never to saved project data.
  setMiniMapOpen: (miniMapOpen) => set({ miniMapOpen }),
  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
  setShowEdges: (showEdges) => set({ showEdges }),
  setDirectorNodeId: (directorNodeId) => set({ directorNodeId }),
  arrangeLayout: () => {
    const state = get()
    if (state.saveStatus === 'conflict') {
      set({ notice: '画布已在别处更新，请先导出本地内容并同步最新版本。' })
      return false
    }
    const nodes = arrangeCanvasNodes(state.nodes, state.edges)
    if (nodes === state.nodes) {
      set({ notice: '当前画布无需调整。' })
      return false
    }
    set({ nodes, ...historyPatch(state), ...dirtyPatch(state), settingsNodeId: null, contextMenu: null, typeMenu: null, notice: '已整理画布，分组与连线保持不变；可撤销。' })
    return true
  },

  markSaved: (updatedAt, revision) =>
    set((state) => ({
      updatedAt: updatedAt ?? state.updatedAt,
      savedRevision: revision,
      saveStatus: state.revision === revision ? 'saved' : 'dirty',
      saveError: null,
    })),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, saveError: error }),

  setNotice: (notice) => set({ notice }),

  onNodesChange: (changes) =>
    set((state) => {
      const removals = changes.filter((change) => change.type === 'remove').map((change) => change.id)
      if (removals.length) return removalPatch(state, removals, '删除节点')
      const nodes = applyNodeChanges<FreeCanvasNode>(changes, state.nodes)
      const dragFinished = changes.some((change) => change.type === 'position' && change.dragging === false)
      return { nodes, ...(dragFinished ? dirtyPatch(state) : {}) }
    }),

  onEdgesChange: (changes) =>
    set((state) => {
      const edges = applyEdgeChanges<FreeCanvasEdge>(changes, state.edges)
      const removed = changes.some((change) => change.type === 'remove')
      const mutated = changes.some((change) => change.type !== 'select')
      return {
        edges,
        ...(removed ? historyPatch(state) : {}),
        ...(mutated ? dirtyPatch(state) : {}),
      }
    }),

  connect: (connection) =>
    set((state) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return {}
      const duplicate = state.edges.some((edge) => edge.source === connection.source
        && edge.target === connection.target
        && edge.sourceHandle === connection.sourceHandle
        && edge.targetHandle === connection.targetHandle)
      if (duplicate) return {}
      return {
        edges: addEdge<FreeCanvasEdge>({ ...connection, id: newNodeId('edge'), type: 'default' }, state.edges),
        ...historyPatch(state),
        ...dirtyPatch(state),
      }
    }),

  commitViewport: (viewport) =>
    set((state) => {
      const current = state.viewport
      if (current.x === viewport.x && current.y === viewport.y && current.zoom === viewport.zoom) return {}
      return { viewport, ...dirtyPatch(state) }
    }),

  beginEdit: () => set((state) => historyPatch(state)),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1]
      if (!previous) return {}
      const selected = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id))
      return {
        nodes: previous.nodes.map((node) => ({ ...node, selected: selected.has(node.id) }) as FreeCanvasNode),
        edges: previous.edges,
        past: state.past.slice(0, -1),
        future: [snapshotOf(state), ...state.future].slice(0, HISTORY_LIMIT),
        ...dirtyPatch(state),
      }
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0]
      if (!next) return {}
      const selected = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id))
      return {
        nodes: next.nodes.map((node) => ({ ...node, selected: selected.has(node.id) }) as FreeCanvasNode),
        edges: next.edges,
        past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        ...dirtyPatch(state),
      }
    }),

  insertNodes: (nodes, edges = [], options) =>
    set((state) => {
      const existing = new Set(state.nodes.map((node) => node.id))
      const fresh = nodes.filter((node) => !existing.has(node.id))
      if (!fresh.length) return {}
      const freshIds = new Set(fresh.map((node) => node.id))
      const selectedIds = options?.selectRoots ? new Set(selectionRoots(fresh, [...freshIds]).map(node => node.id)) : freshIds
      const knownEdges = new Set(state.edges.map((edge) => edge.id))
      const addedEdges = edges.filter((edge) => !knownEdges.has(edge.id))
      const merged = options?.select
        ? [...selectOnly(state.nodes, selectedIds), ...fresh.map((node) => ({ ...node, selected: selectedIds.has(node.id) }) as FreeCanvasNode)]
        : [...state.nodes, ...fresh]
      return {
        nodes: sortGroupsFirst(merged),
        edges: [...state.edges, ...addedEdges],
        focusNodeId: options?.focus ? fresh[fresh.length - 1].id : state.focusNodeId,
        ...historyPatch(state),
        ...dirtyPatch(state),
      }
    }),

  insertNodeNear: (sourceId, side, node) => {
    const state = get()
    const source = state.nodes.find((item) => item.id === sourceId)
    if (!source) return null
    const origin = absoluteOf(source, state.nodes)
    const sourceSize = sizeOf(source)
    const size = sizeOf(node)
    const preferred: XYPosition = side === 'right'
      ? { x: origin.x + sourceSize.width + NODE_GAP, y: origin.y }
      : side === 'left'
        ? { x: origin.x - size.width - NODE_GAP, y: origin.y }
        : side === 'bottom'
          ? { x: origin.x, y: origin.y + sourceSize.height + NODE_GAP }
          : { x: origin.x, y: origin.y - size.height - NODE_GAP }
    const position = freeSpotFor(preferred, size, state.nodes, side)
    const placed = { ...node, position } as FreeCanvasNode
    const outgoing = side === 'right' || side === 'bottom'
    const edge: FreeCanvasEdge = {
      id: newNodeId('edge'),
      source: outgoing ? sourceId : placed.id,
      target: outgoing ? placed.id : sourceId,
      sourceHandle: side === 'right' || side === 'left' ? HANDLE_IDS.outRight : HANDLE_IDS.outBottom,
      targetHandle: side === 'right' || side === 'left' ? HANDLE_IDS.inLeft : HANDLE_IDS.inTop,
      type: 'default',
    }
    get().insertNodes([placed], [edge], { select: true, focus: true })
    return placed.id
  },

  updateNodeData: (nodeId, patch, options) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? ({ ...node, data: { ...node.data, ...patch } } as FreeCanvasNode) : node)),
      ...(options?.history ? historyPatch(state) : {}),
      ...dirtyPatch(state),
    })),

  patchNodes: (patches, options) =>
    set((state) => {
      const byId = new Map(patches.map((patch) => [patch.id, patch.data]))
      let changed = false
      const nodes = state.nodes.map((node) => {
        const patch = byId.get(node.id)
        if (!patch) return node
        changed = true
        return { ...node, data: { ...node.data, ...patch } } as FreeCanvasNode
      })
      if (!changed) return {}
      return { nodes, ...(options?.persist === false ? {} : dirtyPatch(state)) }
    }),

  removeNodes: (ids, label = '删除节点') => set((state) => removalPatch(state, ids, label)),

  deleteSelection: () =>
    set((state) => {
      const nodeIds = state.nodes.filter((node) => node.selected).map((node) => node.id)
      const selectedEdgeIds = new Set(state.edges.filter((edge) => edge.selected).map((edge) => edge.id))
      if (!nodeIds.length && !selectedEdgeIds.size) return {}
      const patch = nodeIds.length ? removalPatch(state, nodeIds, '删除节点') : {}
      if (!selectedEdgeIds.size) return patch
      const edges = (patch.edges ?? state.edges).filter((edge) => !selectedEdgeIds.has(edge.id))
      return { ...historyPatch(state), ...dirtyPatch(state), ...patch, edges }
    }),

  restoreTrash: (entryId) =>
    set((state) => {
      const entry = state.trash.find((item) => item.id === entryId)
      if (!entry) return {}
      const existing = new Set(state.nodes.map((node) => node.id))
      const available = new Set([...existing, ...entry.nodes.map((node) => node.id)])
      const restored = entry.nodes.filter((node) => !existing.has(node.id)).map((node) => {
        const missingParent = node.parentId && !available.has(node.parentId)
        return {
          ...node, selected: false,
          ...(missingParent ? { parentId: undefined, extent: node.extent === 'parent' ? undefined : node.extent, position: entry.absolutePositions?.[node.id] ?? node.position } : {}),
        } as FreeCanvasNode
      })
      const knownEdges = new Set(state.edges.map((edge) => edge.id))
      const edges = [
        ...state.edges,
        ...entry.edges.filter((edge) => !knownEdges.has(edge.id) && available.has(edge.source) && available.has(edge.target)),
      ]
      return {
        nodes: sortGroupsFirst([...state.nodes, ...restored]),
        edges,
        trash: state.trash.filter((item) => item.id !== entryId),
        ...historyPatch(state),
        ...dirtyPatch(state),
      }
    }),

  duplicateSelection: () => {
    const state = get()
    const snapshot = selectionSnapshot(state.nodes, state.edges)
    if (!snapshot.nodes.length) return
    if (!selectionRoots(snapshot.nodes, snapshot.nodes.map(node => node.id)).length) return set({ notice: '分组的父级关系异常，请先整理分组后再复制。' })
    const copy = cloneSelection(snapshot.nodes, snapshot.edges, { x: 48, y: 48 })
    get().insertNodes(copy.nodes, copy.edges, { select: true, selectRoots: true })
  },

  copySelection: () => {
    const state = get()
    const snapshot = selectionSnapshot(state.nodes, state.edges)
    if (!snapshot.nodes.length) return
    set({
      clipboard: snapshot,
      notice: `已复制 ${snapshot.nodes.length} 个节点${snapshot.nodes.some(node => node.type === 'group') ? '（包含分组内容）' : ''}`,
    })
  },

  pasteClipboard: (position) => {
    const clipboard = get().clipboard
    if (!clipboard?.nodes.length) return
    const roots = selectionRoots(clipboard.nodes, clipboard.nodes.map(node => node.id))
    if (!roots.length) return set({ notice: '复制的分组父级关系异常，无法粘贴。' })
    const origin = roots.reduce(
      (min, node) => ({ x: Math.min(min.x, node.position.x), y: Math.min(min.y, node.position.y) }),
      { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
    )
    const offset = position
      ? { x: position.x - origin.x, y: position.y - origin.y }
      : { x: 48, y: 48 }
    // Clipboard coordinates were frozen at copy time; later moves/deletions of
    // the source parent must never change the pasted result.
    const snapshot = selectionSnapshot(clipboard.nodes, clipboard.edges, clipboard.nodes.map(node => node.id))
    const copy = cloneSelection(snapshot.nodes, snapshot.edges, offset)
    get().insertNodes(copy.nodes, copy.edges, { select: true, selectRoots: true })
  },

  groupSelection: () => {
    const state = get()
    const selected = selectionRoots(state.nodes)
    if (selected.length < 2) {
      set({ notice: '至少选择两个节点才能分组' })
      return
    }
    const positions = absoluteNodePositions(state.nodes)
    const rects = selectionNodes(state.nodes).map((node) => ({ origin: positions.get(node.id)!, size: sizeOf(node) }))
    const left = Math.min(...rects.map((rect) => rect.origin.x)) - GROUP_PADDING
    const top = Math.min(...rects.map((rect) => rect.origin.y)) - GROUP_PADDING - GROUP_HEADER
    const right = Math.max(...rects.map((rect) => rect.origin.x + rect.size.width)) + GROUP_PADDING
    const bottom = Math.max(...rects.map((rect) => rect.origin.y + rect.size.height)) + GROUP_PADDING
    const firstParent = selected[0].parentId
    const commonParent = firstParent && selected.every(node => node.parentId === firstParent) && positions.has(firstParent) ? firstParent : undefined
    const parentOrigin = commonParent ? positions.get(commonParent)! : { x: 0, y: 0 }
    const group = { ...createGroupNode({ x: left - parentOrigin.x, y: top - parentOrigin.y }, { width: right - left, height: bottom - top }), ...(commonParent ? { parentId: commonParent } : {}), selected: true }
    const ids = new Set(selected.map((node) => node.id))
    const children = selected.map((node) => {
      const origin = positions.get(node.id)!
      return { ...node, parentId: group.id, position: { x: origin.x - left, y: origin.y - top }, selected: false } as FreeCanvasNode
    })
    set({
      nodes: sortGroupsFirst([group as FreeCanvasNode, ...state.nodes.filter((node) => !ids.has(node.id) && node.id !== group.id).map(node => node.selected ? { ...node, selected: false } as FreeCanvasNode : node), ...children]),
      ...historyPatch(state),
      ...dirtyPatch(state),
    })
  },

  ungroupSelection: () =>
    set((state) => {
      const groupIds = new Set(state.nodes.filter((node) => node.type === 'group' && node.selected).map((node) => node.id))
      if (!groupIds.size) return {}
      const byId = new Map(state.nodes.map(node => [node.id, node]))
      const positions = absoluteNodePositions(state.nodes)
      const nodes = state.nodes
        .filter((node) => !groupIds.has(node.id))
        .map((node) => {
          if (!node.parentId || !groupIds.has(node.parentId)) return node
          const seen = new Set<string>()
          let parentId: string | undefined = node.parentId
          while (parentId && groupIds.has(parentId)) {
            if (seen.has(parentId)) { parentId = undefined; break }
            seen.add(parentId)
            parentId = byId.get(parentId)?.parentId
          }
          if (parentId && !byId.has(parentId)) parentId = undefined
          const origin = positions.get(node.id)!, parentOrigin = parentId ? positions.get(parentId)! : { x: 0, y: 0 }
          return { ...node, parentId, position: { x: origin.x - parentOrigin.x, y: origin.y - parentOrigin.y }, selected: true, ...(node.extent === 'parent' && !parentId ? { extent: undefined } : {}) } as FreeCanvasNode
        })
      return { nodes: sortGroupsFirst(nodes), edges: state.edges.filter(edge => !groupIds.has(edge.source) && !groupIds.has(edge.target)), ...historyPatch(state), ...dirtyPatch(state), notice: '已解散分组，内容保持原位置。' }
    }),

  alignSelection: (axis) =>
    set((state) => {
      const selected = selectionRoots(state.nodes)
      if (selected.length < 2) return {}
      const positions = absoluteNodePositions(state.nodes)
      const target = Math.min(...selected.map(node => positions.get(node.id)![axis]))
      const ids = new Set(selected.map((node) => node.id))
      let changed = false
      const nodes = state.nodes.map((node) => {
        if (!ids.has(node.id)) return node
        const offset = target - positions.get(node.id)![axis]
        if (!offset) return node
        changed = true
        const position = { ...node.position, [axis]: node.position[axis] + offset }
        return { ...node, position } as FreeCanvasNode
      })
      return changed ? { nodes, ...historyPatch(state), ...dirtyPatch(state) } : {}
    }),

  adoptRemoteBoard: (nodes, edges, updatedAt) =>
    set((state) => {
      if (state.saveStatus === 'conflict') return {}
      if (state.revision === state.savedRevision) {
        const selectedIds = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id))
        return {
          nodes: sortGroupsFirst(nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) }) as FreeCanvasNode)),
          edges,
          updatedAt,
        }
      }
      const knownNodes = new Set(state.nodes.map((node) => node.id))
      const knownEdges = new Set(state.edges.map((edge) => edge.id))
      const addedNodes = nodes.filter((node) => !knownNodes.has(node.id))
      const addedEdges = edges.filter((edge) => !knownEdges.has(edge.id))
      return {
        nodes: addedNodes.length ? sortGroupsFirst([...state.nodes, ...addedNodes]) : state.nodes,
        edges: addedEdges.length ? [...state.edges, ...addedEdges] : state.edges,
        updatedAt,
      }
    }),

  openSettings: (nodeId, placement = DEFAULT_SETTINGS_PLACEMENT) => set({ settingsNodeId: nodeId, settingsPlacement: placement, typeMenu: null, contextMenu: null }),

  openTypeMenu: (menu) => set({ typeMenu: menu, contextMenu: null }),

  openContextMenu: (menu) => set({ contextMenu: menu, typeMenu: null }),

  closeOverlays: () => set({ settingsNodeId: null, typeMenu: null, contextMenu: null, assetPanelOpen: false, assetTargetNodeId: null, directorNodeId: null }),

  setAssetPanel: (open, targetNodeId = null) => set({ assetPanelOpen: open, assetTargetNodeId: open ? targetNodeId : null, contextMenu: null }),

  clearFocus: () => set({ focusNodeId: null }),

  selectNodeOnly: (nodeId) => set((state) => ({ nodes: selectOnly(state.nodes, new Set([nodeId])) })),
}))
