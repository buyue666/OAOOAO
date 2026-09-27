'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { useStudio } from '@/lib/studio/store'
import { canvasProjectToBoard, createCanvasProject, getCanvasProject, isUnauthorized, StudioApiError, updateCanvasProject, type CanvasBackendProject } from '@/lib/studio/api'
import type { Asset, CanvasBoard, CanvasNodeData } from '@/lib/studio/types'
import type { CanvasCreatedGeneration } from './canvas-generation-panel'
import { useGeneration } from '@/lib/studio/generation-store'
import type { AgentRun } from '@/lib/studio/generation-types'
import { canvasEdgeStyle, cloneBoard, createInitialBoard, emptyBoard, type CanvasContextMenu, type CanvasFlowInstance, type CanvasPanelTab, type HistoryState } from './canvas-workspace-model'

export function useCanvasWorkspaceController({ projectId }: { projectId?: string }) {
  const { state, dispatch } = useStudio()
  const generation = useGeneration()
  const boardKey = projectId ?? state.selectedProjectId ?? 'canvas'
  const projectTitle = state.projects.find((project) => project.id === boardKey)?.title
  const seedBoard = useMemo(() => createInitialBoard(boardKey, projectTitle), [boardKey, projectTitle])
  const [nodes, setNodes] = useNodesState<Node<CanvasNodeData>>(seedBoard.nodes)
  const [edges, setEdges] = useEdgesState(seedBoard.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAgent, setShowAgent] = useState(false)
  const [generationPanelOpen, setGenerationPanelOpen] = useState(false)
  const [generationMode, setGenerationMode] = useState<'image' | 'video' | 'agent'>('image')
  const [generationTargetId, setGenerationTargetId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu>(null)
  const [panMode, setPanMode] = useState(false)
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false)
  const [workspacePanelTab, setWorkspacePanelTab] = useState<CanvasPanelTab>('nodes')
  const [historyState, setHistoryState] = useState<HistoryState>({ canUndo: false, canRedo: false })
  const [boardRevision, setBoardRevision] = useState(0)
  const [syncStatus, setSyncStatus] = useState<'checking' | 'synced' | 'saving' | 'local' | 'conflict' | 'error'>('checking')
  const nodesRef = useRef<Node<CanvasNodeData>[]>(seedBoard.nodes)
  const edgesRef = useRef<Edge[]>(seedBoard.edges)
  const historyRef = useRef<CanvasBoard[]>([])
  const futureRef = useRef<CanvasBoard[]>([])
  const draggingHistoryRef = useRef(false)
  const flowRef = useRef<CanvasFlowInstance | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const remoteProjectRef = useRef<CanvasBackendProject | null>(null)
  const remoteLoadedRef = useRef(false)
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId), [nodes, selectedId])
  const generationTargetNode = useMemo(() => nodes.find((node) => node.id === generationTargetId), [generationTargetId, nodes])

  const syncHistoryState = useCallback(() => {
    setHistoryState({ canUndo: historyRef.current.length > 0, canRedo: futureRef.current.length > 0 })
  }, [])

  const setBoard = useCallback((board: CanvasBoard) => {
    const next = cloneBoard(board)
    nodesRef.current = next.nodes
    edgesRef.current = next.edges
    setNodes(next.nodes)
    setEdges(next.edges)
  }, [setEdges, setNodes])

  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current, cloneBoard({ nodes: nodesRef.current, edges: edgesRef.current })].slice(-40)
    futureRef.current = []
    syncHistoryState()
  }, [syncHistoryState])

  useEffect(() => {
    if (!state.hydrated) return
    const storedBoard = state.canvasBoards?.[boardKey]
    const nextBoard = cloneBoard(storedBoard ?? seedBoard)
    nodesRef.current = nextBoard.nodes
    edgesRef.current = nextBoard.edges
    setNodes(nextBoard.nodes)
    setEdges(nextBoard.edges)
    setSelectedId(nextBoard.nodes.find((node) => node.data.kind === 'text')?.id ?? nextBoard.nodes[0]?.id ?? null)
    historyRef.current = []
    futureRef.current = []
    syncHistoryState()
    setBoardRevision((value) => value + 1)
  }, [boardKey, seedBoard, state.hydrated, setEdges, setNodes, syncHistoryState])

  useEffect(() => {
    if (!state.hydrated || state.backendStatus === 'checking') return
    let cancelled = false
    remoteLoadedRef.current = false
    remoteProjectRef.current = null
    if (state.backendStatus !== 'connected') {
      setSyncStatus('local')
      return
    }

    setSyncStatus('checking')
    const remoteId = boardKey.startsWith('canvas-') ? boardKey : `canvas-${boardKey}`
    const load = async () => {
      try {
        let project: CanvasBackendProject
        try {
          project = await getCanvasProject(remoteId)
        } catch (error) {
          if (!(error instanceof StudioApiError) || error.status !== 404) throw error
          project = await createCanvasProject({ title: projectTitle ?? '未命名画布', sourceHandoffId: boardKey })
        }
        if (cancelled) return
        remoteProjectRef.current = project
        remoteLoadedRef.current = true
        setSyncStatus('synced')
        const remoteBoard = project.nodes.length ? canvasProjectToBoard(project) : null
        /**
         * 空画布必须是空的。
         *
         * 早先这里回落到 `seedBoard`（内置演示节点），导致新建的画布
         * 被自动填满「极夜山谷参考」等演示内容，看起来像已有数据。
         * 现在：后端有节点用后端节点；后端项目为空时只在本地存在未同步草稿的情况下
         * 使用本地草稿，否则保持空画布。
         */
        const localDraft = state.canvasBoards?.[boardKey]
        const nextBoard = cloneBoard(remoteBoard ?? (localDraft?.nodes.length ? localDraft : emptyBoard))
        nodesRef.current = nextBoard.nodes
        edgesRef.current = nextBoard.edges
        setNodes(nextBoard.nodes)
        setEdges(nextBoard.edges)
        setSelectedId(nextBoard.nodes.find((node) => node.data.kind === 'text')?.id ?? nextBoard.nodes[0]?.id ?? null)
        setBoardRevision((value) => value + 1)
      } catch (error) {
        if (cancelled) return
        remoteLoadedRef.current = false
        setSyncStatus(isUnauthorized(error) ? 'local' : 'error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [boardKey, projectTitle, seedBoard, setEdges, setNodes, state.backendStatus, state.hydrated])

  useEffect(() => {
    if (!state.hydrated) return
    const timer = window.setTimeout(() => {
      dispatch({
        type: 'SAVE_CANVAS_BOARD',
        projectId: boardKey,
        board: cloneBoard({ nodes, edges }),
      })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [boardKey, dispatch, edges, nodes, state.hydrated])

  useEffect(() => {
    if (!state.hydrated || state.backendStatus !== 'connected' || !remoteLoadedRef.current || !remoteProjectRef.current) return
    const timer = window.setTimeout(() => {
      const project = remoteProjectRef.current
      if (!project) return
      setSyncStatus('saving')
      updateCanvasProject(project, { nodes, edges })
        .then((updated) => {
          remoteProjectRef.current = updated
          setSyncStatus('synced')
        })
        .catch((error: unknown) => {
          if (error instanceof StudioApiError && error.status === 409) setSyncStatus('conflict')
          else setSyncStatus('error')
        })
    }, 550)
    return () => window.clearTimeout(timer)
  }, [boardKey, edges, nodes, state.backendStatus, state.hydrated])

  useEffect(() => {
    if (!state.hydrated || !flowRef.current) return
    const timer = window.setTimeout(() => {
      flowRef.current?.fitView({ padding: showAgent ? 0.2 : 0.14, maxZoom: 1.2, duration: 220 })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [boardKey, boardRevision, showAgent, state.hydrated])

  /**
   * 生成任务是画布节点的一部分，而不是离开画布后才出现的外部记录。
   * 任务轮询更新时只改节点数据，不推入撤销栈，避免用户按撤销时跳回旧的
   *「生成中」状态；节点本身仍会随着普通保存流程同步到后端。
   */
  useEffect(() => {
    if (!generation.tasks.length) return
    let changed = false
    const nextNodes = nodesRef.current.map((node) => {
      const taskId = node.data.generationTaskId
      if (!taskId) return node
      const task = generation.tasks.find((item) => item.id === taskId)
      if (!task) return node
      const mediaResult = task.media[0]
      const status = task.status === 'success' ? '已完成' : task.status === 'error' ? '生成失败' : task.status === 'cancelled' ? '已取消' : '生成中'
      const nextData: CanvasNodeData = {
        ...node.data,
        status,
        detail: task.error || `${node.data.model || task.model || '自动模型'} · ${status}`,
        ...(mediaResult?.url ? { src: mediaResult.url, poster: mediaResult.poster } : {}),
      }
      if (node.data.status !== nextData.status || node.data.src !== nextData.src || node.data.detail !== nextData.detail) changed = true
      return changed ? { ...node, data: nextData } : node
    })
    if (changed) {
      nodesRef.current = nextNodes
      setNodes(nextNodes)
    }
  }, [generation.tasks, setNodes])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [contextMenu])

  const handleNodesChange = useCallback((changes: NodeChange<Node<CanvasNodeData>>[]) => {
    if (changes.some((change) => change.type !== 'select' && change.type !== 'position' && change.type !== 'dimensions')) pushHistory()
    const nextNodes = applyNodeChanges(changes, nodesRef.current)
    nodesRef.current = nextNodes
    setNodes(nextNodes)
  }, [pushHistory, setNodes])

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((change) => change.type !== 'select')) pushHistory()
    const nextEdges = applyEdgeChanges(changes, edgesRef.current)
    edgesRef.current = nextEdges
    setEdges(nextEdges)
  }, [pushHistory, setEdges])

  const handleNodeDragStart = useCallback(() => {
    if (draggingHistoryRef.current) return
    draggingHistoryRef.current = true
    pushHistory()
  }, [pushHistory])

  const handleNodeDragStop = useCallback(() => {
    draggingHistoryRef.current = false
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    pushHistory()
    const nextEdges = addEdge({ ...connection, animated: false, style: canvasEdgeStyle }, edgesRef.current)
    edgesRef.current = nextEdges
    setEdges(nextEdges)
  }, [pushHistory, setEdges])

  /**
   * 接收来自作品页的「发送到画布」结果。
   *
   * 作品页把结果写入本地待接收队列，这里读取后作为真实节点插入，
   * 并按数量逐个消费，避免刷新后重复插入同一份结果。
   */
  useEffect(() => {
    if (!state.hydrated) return
    const key = 'oaooao-canvas-handoff'
    let entries: Array<{ id?: string; kind?: string; title?: string; src?: string; poster?: string; prompt?: string; model?: string }> = []
    try {
      const raw = window.localStorage.getItem(key)
      const parsed = raw ? JSON.parse(raw) : []
      entries = Array.isArray(parsed) ? parsed : []
    } catch {
      entries = []
    }
    if (!entries.length) return
    const incoming = entries.filter((entry) => entry?.src && entry?.id)
    if (!incoming.length) {
      try { window.localStorage.removeItem(key) } catch { /* 存储不可用时忽略 */ }
      return
    }
    // 先清空队列再插入，保证即使插入过程报错也不会无限重放。
    try { window.localStorage.removeItem(key) } catch { /* 存储不可用时忽略 */ }
    pushHistory()
    const base = nodesRef.current.length
    const added: Node<CanvasNodeData>[] = incoming.map((entry, index) => ({
      id: `handoff-${entry.id}-${index}`,
      type: 'canvas',
      position: { x: 120 + ((base + index) % 4) * 260, y: 140 + Math.floor((base + index) / 4) * 220 },
      data: {
        title: entry.title || '来自作品的结果',
        kind: entry.kind === 'video' ? 'video' : 'image',
        detail: entry.model ? `${entry.model}` : '来自我的作品',
        src: entry.src,
        poster: entry.poster,
        status: '已完成',
      },
    }))
    const nextNodes = [...nodesRef.current, ...added]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
    setSelectedId(added[0].id)
  }, [pushHistory, setNodes, state.hydrated])

  const addNode = useCallback((kind: CanvasNodeData['kind']) => {
    const id = `${boardKey}-node-${Date.now()}-${nodesRef.current.length}`
    const item: Node<CanvasNodeData> = {
      id,
      type: 'canvas',
      position: { x: 260 + nodesRef.current.length * 20, y: 180 + nodesRef.current.length * 16 },
      data: {
        title: kind === 'image' ? '新图片节点' : kind === 'video' ? '新视频节点' : kind === 'task' ? '新任务节点' : '新文本节点',
        kind,
        // 新节点保持空白，不预填演示媒体；内容由用户从作品或素材中选择。
        detail: kind === 'text' ? '点击后在属性面板中编辑文字。' : '从「我的作品」或素材库选择内容后填入。',
        status: kind === 'task' ? '待确认' : undefined,
      },
    }
    pushHistory()
    const nextNodes = [...nodesRef.current, item]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
    setSelectedId(id)
  }, [boardKey, pushHistory, setNodes])

  const addUploadedFiles = useCallback((incoming: FileList | File[]) => {
    const files = Array.from(incoming).filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    if (!files.length) return
    pushHistory()
    const base = nodesRef.current.length
    const added: Node<CanvasNodeData>[] = files.map((file, index) => {
      const kind: CanvasNodeData['kind'] = file.type.startsWith('video/') ? 'video' : 'image'
      return {
        id: `${boardKey}-upload-${Date.now()}-${index}`,
        type: 'canvas',
        position: { x: 120 + ((base + index) % 4) * 270, y: 120 + Math.floor((base + index) / 4) * 220 },
        data: {
          title: file.name || (kind === 'video' ? '导入视频' : '导入图片'),
          kind,
          detail: `本地导入 · ${Math.max(1, Math.round(file.size / 1024))} KB`,
          src: URL.createObjectURL(file),
          status: '待整理',
        },
      }
    })
    const nextNodes = [...nodesRef.current, ...added]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
    setSelectedId(added[0]?.id ?? null)
  }, [boardKey, pushHistory, setNodes])

  const addAssetNode = useCallback((asset: Asset) => {
    const kind: CanvasNodeData['kind'] = asset.kind === 'video' ? 'video' : 'image'
    const id = `${boardKey}-asset-${asset.id}-${Date.now()}`
    pushHistory()
    const item: Node<CanvasNodeData> = {
      id,
      type: 'canvas',
      position: { x: 180 + (nodesRef.current.length % 4) * 270, y: 130 + Math.floor(nodesRef.current.length / 4) * 220 },
      data: { title: asset.title, kind, detail: `素材库 · ${asset.dimensions || asset.kind}`, src: asset.src, poster: asset.poster, status: '已引用' },
    }
    const nextNodes = [...nodesRef.current, item]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
    setSelectedId(id)
    setWorkspacePanelOpen(false)
  }, [boardKey, pushHistory, setNodes])

  const undo = useCallback(() => {
    const previous = historyRef.current.pop()
    if (!previous) return
    futureRef.current.push(cloneBoard({ nodes: nodesRef.current, edges: edgesRef.current }))
    setBoard(previous)
    setSelectedId((current) => previous.nodes.some((node) => node.id === current) ? current : previous.nodes[0]?.id ?? null)
    syncHistoryState()
  }, [setBoard, syncHistoryState])

  const redo = useCallback(() => {
    const next = futureRef.current.pop()
    if (!next) return
    historyRef.current.push(cloneBoard({ nodes: nodesRef.current, edges: edgesRef.current }))
    setBoard(next)
    setSelectedId((current) => next.nodes.some((node) => node.id === current) ? current : next.nodes[0]?.id ?? null)
    syncHistoryState()
  }, [setBoard, syncHistoryState])

  const openGeneration = useCallback((mode: 'image' | 'video' | 'agent', targetId?: string) => {
    setGenerationTargetId(targetId ?? selectedId)
    setGenerationMode(mode)
    setGenerationPanelOpen(true)
    setShowAgent(false)
    setWorkspacePanelOpen(false)
    setContextMenu(null)
  }, [selectedId])

  const closeGeneration = useCallback(() => {
    setGenerationPanelOpen(false)
    setGenerationTargetId(null)
  }, [])

  const addGeneratedNode = useCallback((created: CanvasCreatedGeneration) => {
    const mediaResult = created.task.media[0]
    const kind = created.mode === 'video' ? 'video' : 'image'
    const id = `${boardKey}-generation-${created.task.id}`
    const basePosition = generationTargetNode?.position ?? { x: 180 + (nodesRef.current.length % 4) * 270, y: 130 + Math.floor(nodesRef.current.length / 4) * 220 }
    const item: Node<CanvasNodeData> = {
      id,
      type: 'canvas',
      position: { x: basePosition.x + 330, y: basePosition.y + 20 },
      data: {
        title: kind === 'video' ? '视频生成节点' : '图片生成节点',
        kind,
        detail: `${created.model || '自动模型'} · ${created.ratio || '自动比例'}`,
        status: created.task.status === 'success' ? '已完成' : created.task.status === 'error' ? '生成失败' : '生成中',
        generationTaskId: created.task.id,
        prompt: created.prompt,
        model: created.model,
        ratio: created.ratio,
        quality: created.quality,
        seconds: created.seconds,
        referenceUrls: created.referenceUrls,
        ...(mediaResult?.url ? { src: mediaResult.url, poster: mediaResult.poster } : {}),
      },
    }
    pushHistory()
    const nextNodes = [...nodesRef.current, item]
    const nextEdges = generationTargetNode ? [...edgesRef.current, { id: `${id}-from-${generationTargetNode.id}`, source: generationTargetNode.id, target: id, type: 'smoothstep', style: canvasEdgeStyle }] : edgesRef.current
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedId(id)
    closeGeneration()
  }, [boardKey, closeGeneration, generationTargetNode, pushHistory, setEdges, setNodes])

  const addAgentNode = useCallback((run: AgentRun, prompt: string) => {
    const id = `${boardKey}-agent-${run.id}`
    const basePosition = generationTargetNode?.position ?? { x: 180 + (nodesRef.current.length % 4) * 270, y: 130 + Math.floor(nodesRef.current.length / 4) * 220 }
    const item: Node<CanvasNodeData> = {
      id,
      type: 'canvas',
      position: { x: basePosition.x + 330, y: basePosition.y + 20 },
      data: {
        title: '导演 Agent 任务',
        kind: 'task',
        detail: `${run.tasks.length} 个步骤 · ${run.status === 'completed' ? '已完成' : '执行中'}`,
        status: run.status === 'completed' ? '已完成' : run.status === 'failed' ? '执行失败' : '执行中',
        agentRunId: run.id,
        prompt,
      },
    }
    pushHistory()
    const nextNodes = [...nodesRef.current, item]
    const nextEdges = generationTargetNode ? [...edgesRef.current, { id: `${id}-from-${generationTargetNode.id}`, source: generationTargetNode.id, target: id, type: 'smoothstep', style: canvasEdgeStyle }] : edgesRef.current
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedId(id)
    closeGeneration()
  }, [boardKey, closeGeneration, generationTargetNode, pushHistory, setEdges, setNodes])

  const deleteNode = useCallback((nodeId: string) => {
    if (!nodesRef.current.some((node) => node.id === nodeId)) return
    pushHistory()
    const nextNodes = nodesRef.current.filter((node) => node.id !== nodeId)
    const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedId((current) => current === nodeId ? null : current)
    setContextMenu(null)
  }, [pushHistory, setEdges, setNodes])

  const duplicateNode = useCallback((nodeId: string) => {
    const original = nodesRef.current.find((node) => node.id === nodeId)
    if (!original) return
    const id = `${original.id}-copy-${Date.now()}`
    const item: Node<CanvasNodeData> = { ...original, id, position: { x: original.position.x + 48, y: original.position.y + 48 }, data: { ...original.data, title: `${original.data.title} · 副本`, status: original.data.src ? original.data.status : '待编辑' } }
    pushHistory()
    const nextNodes = [...nodesRef.current, item]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
    setSelectedId(id)
    setContextMenu(null)
  }, [pushHistory, setNodes])

  const resetView = useCallback(() => {
    flowRef.current?.fitView({ padding: showAgent ? 0.2 : 0.14, maxZoom: 1.2, duration: 260 })
  }, [showAgent])

  const syncLabel = syncStatus === 'synced' ? '已保存' : syncStatus === 'saving' ? '保存中' : syncStatus === 'conflict' ? '版本冲突' : syncStatus === 'error' ? '同步失败' : syncStatus === 'local' ? '本地草稿' : '连接中'

  return {
    projectId,
    boardKey,
    projectTitle,
    state,
    nodes,
    edges,
    selectedId,
    selectedNode,
    generationTargetNode,
    generationPanelOpen,
    generationMode,
    showAgent,
    panMode,
    contextMenu,
    workspacePanelOpen,
    workspacePanelTab,
    historyState,
    syncStatus,
    syncLabel,
    generationTasks: generation.tasks,
    flowRef,
    uploadInputRef,
    setSelectedId,
    setShowAgent,
    setPanMode,
    setContextMenu,
    setWorkspacePanelOpen,
    setWorkspacePanelTab,
    handleNodesChange,
    handleEdgesChange,
    onConnect,
    handleNodeDragStart,
    handleNodeDragStop,
    addUploadedFiles,
    addNode,
    addAssetNode,
    openGeneration,
    closeGeneration,
    addGeneratedNode,
    addAgentNode,
    duplicateNode,
    deleteNode,
    resetView,
    undo,
    redo,
  }
}
