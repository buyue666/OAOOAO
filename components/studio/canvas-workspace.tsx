'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Film, Image as ImageIcon, Link2, Maximize2, MousePointer2, Plus, Redo2, RotateCcw, Sparkles, Type, Undo2, Video } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { canvasProjectToBoard, createCanvasProject, getCanvasProject, isUnauthorized, StudioApiError, updateCanvasProject, type CanvasBackendProject } from '@/lib/studio/api'
import { media } from '@/lib/studio/mock-data'
import type { CanvasBoard, CanvasNodeData } from '@/lib/studio/types'
import { DirectorAgent } from './director-agent'
import { ControlButton, IconAction, MediaThumb, StatusBadge } from './ui'

const canvasEdgeStyle = { stroke: 'var(--studio-ink-line)', strokeWidth: 1.35 }
const defaultEdgeOptions = { animated: false, style: canvasEdgeStyle }

function createInitialBoard(projectId: string, projectTitle?: string): CanvasBoard {
  const prefix = `${projectId || 'canvas'}-canvas`

  if (projectId === 'aurora') {
    return {
      nodes: [
        { id: `${prefix}-reference`, type: 'canvas', position: { x: 80, y: 120 }, data: { title: '极夜山谷参考', kind: 'image', detail: '参考素材 · 2400 × 1600', src: media.auroraCover } },
        { id: `${prefix}-shot`, type: 'canvas', position: { x: 380, y: 70 }, data: { title: '镜头 02 · 没有寄出的信', kind: 'text', detail: '屋内桌面上的信封被风吹开。' } },
        { id: `${prefix}-result`, type: 'canvas', position: { x: 720, y: 150 }, data: { title: '镜头 07 · 候选结果', kind: 'video', detail: 'Motion 03 · 8 秒', src: media.video, poster: media.videoPoster, status: '生成中' } },
        { id: `${prefix}-task`, type: 'canvas', position: { x: 380, y: 350 }, data: { title: '待执行任务', kind: 'task', detail: '生成两组低饱和夜景候选', status: '待确认' } },
      ],
      edges: [
        { id: `${prefix}-edge-reference-shot`, source: `${prefix}-reference`, target: `${prefix}-shot`, style: canvasEdgeStyle },
        { id: `${prefix}-edge-shot-result`, source: `${prefix}-shot`, target: `${prefix}-result`, style: canvasEdgeStyle },
        { id: `${prefix}-edge-shot-task`, source: `${prefix}-shot`, target: `${prefix}-task`, type: 'smoothstep', style: canvasEdgeStyle },
      ],
    }
  }

  const title = projectTitle ?? '当前项目'
  const isNorthline = projectId === 'northline'
  const isQuietRoom = projectId === 'quiet-room'
  const reference = isNorthline ? media.cityCover : isQuietRoom ? media.studio : media.product
  const referenceDetail = isNorthline ? '城市建筑参考 · 品牌视觉' : isQuietRoom ? '室内光线参考 · 4:5' : '产品静物参考 · 广告片'

  return {
    nodes: [
      { id: `${prefix}-reference`, type: 'canvas', position: { x: 100, y: 130 }, data: { title: `${title} · 参考`, kind: 'image', detail: referenceDetail, src: reference } },
      { id: `${prefix}-brief`, type: 'canvas', position: { x: 440, y: 90 }, data: { title: `${title} · 创作说明`, kind: 'text', detail: '在这里整理镜头、参考素材与视觉方向。' } },
      { id: `${prefix}-task`, type: 'canvas', position: { x: 440, y: 310 }, data: { title: '待执行任务', kind: 'task', detail: '补充第一轮候选并确认创作方向', status: '待确认' } },
    ],
    edges: [
      { id: `${prefix}-edge-reference-brief`, source: `${prefix}-reference`, target: `${prefix}-brief`, style: canvasEdgeStyle },
      { id: `${prefix}-edge-brief-task`, source: `${prefix}-brief`, target: `${prefix}-task`, type: 'smoothstep', style: canvasEdgeStyle },
    ],
  }
}

function cloneBoard(board: CanvasBoard): CanvasBoard {
  return {
    nodes: board.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data },
    })),
    edges: board.edges.map((edge) => ({
      ...edge,
      animated: false,
      style: { ...canvasEdgeStyle, ...edge.style },
    })),
  }
}

/** 空画布：真实登录状态下新建画布保持为空，不自动填充演示节点。 */
const emptyBoard: CanvasBoard = { nodes: [], edges: [] }

function CanvasNode({ data, selected }: NodeProps<Node<CanvasNodeData>>) {
  return (
    <div className={selected ? 'w-56 rounded-lg border border-foreground bg-card shadow-lg shadow-foreground/10 ring-1 ring-foreground/15' : 'w-56 rounded-lg border border-border bg-card shadow-md'}>
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-studio-ink-foreground" />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex size-6 items-center justify-center rounded bg-muted text-muted-foreground">
          {data.kind === 'image' ? <ImageIcon className="size-3.5" aria-hidden="true" /> : data.kind === 'video' ? <Video className="size-3.5" aria-hidden="true" /> : data.kind === 'task' ? <Sparkles className="size-3.5" aria-hidden="true" /> : <Type className="size-3.5" aria-hidden="true" />}
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{data.title}</p>
      </div>
      {data.src && <MediaThumb src={data.src} poster={data.poster} alt={data.title} fallback={data.title} kind={data.kind === 'video' ? 'video' : 'image'} className="h-28 rounded-none" />}
      {!data.src && <div className="px-3 py-4 text-xs leading-5 text-muted-foreground">{data.detail}</div>}
      {data.src && (
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <p className="truncate text-[10px] text-muted-foreground">{data.detail}</p>
          {data.status && <StatusBadge tone="neutral">{data.status}</StatusBadge>}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-studio-ink-foreground" />
    </div>
  )
}

const nodeTypes = { canvas: CanvasNode }

type CanvasFlowInstance = Pick<ReactFlowInstance<Node<CanvasNodeData>, Edge>, 'fitView'>

type HistoryState = {
  canUndo: boolean
  canRedo: boolean
}

export function CanvasWorkspace({ projectId, fullScreen = false }: { projectId?: string; fullScreen?: boolean }) {
  const router = useRouter()
  const { state, dispatch } = useStudio()
  const boardKey = projectId ?? state.selectedProjectId ?? 'canvas'
  const projectTitle = state.projects.find((project) => project.id === boardKey)?.title
  const seedBoard = useMemo(() => createInitialBoard(boardKey, projectTitle), [boardKey, projectTitle])
  const [nodes, setNodes] = useNodesState<Node<CanvasNodeData>>(seedBoard.nodes)
  const [edges, setEdges] = useEdgesState(seedBoard.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAgent, setShowAgent] = useState(false)
  const [historyState, setHistoryState] = useState<HistoryState>({ canUndo: false, canRedo: false })
  const [boardRevision, setBoardRevision] = useState(0)
  const [syncStatus, setSyncStatus] = useState<'checking' | 'synced' | 'saving' | 'local' | 'conflict' | 'error'>('checking')
  const nodesRef = useRef<Node<CanvasNodeData>[]>(seedBoard.nodes)
  const edgesRef = useRef<Edge[]>(seedBoard.edges)
  const historyRef = useRef<CanvasBoard[]>([])
  const futureRef = useRef<CanvasBoard[]>([])
  const draggingHistoryRef = useRef(false)
  const flowRef = useRef<CanvasFlowInstance | null>(null)
  const remoteProjectRef = useRef<CanvasBackendProject | null>(null)
  const remoteLoadedRef = useRef(false)
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId), [nodes, selectedId])

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

  const resetView = useCallback(() => {
    flowRef.current?.fitView({ padding: showAgent ? 0.2 : 0.14, maxZoom: 1.2, duration: 260 })
  }, [showAgent])

  const sendToWorkspace = useCallback(() => {
    if (!selectedNode) return
    if (selectedNode.data.kind === 'image') {
      router.push('/image')
      return
    }
    if (selectedNode.data.kind === 'video') {
      router.push('/video')
      return
    }
    if (selectedNode.data.kind === 'task') {
      router.push('/tasks')
      return
    }
    router.push(`/projects/${projectId ?? boardKey}/storyboard`)
  }, [boardKey, projectId, router, selectedNode])

  const shellClass = fullScreen
    ? 'flex h-[calc(100dvh-60px)] min-h-0 flex-col overflow-hidden bg-background'
    : 'studio-surface flex min-h-[600px] min-h-0 flex-col'

  return (
    <div className={shellClass}>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <ControlButton size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
            <MousePointer2 className="size-3.5" aria-hidden="true" />
            选择
          </ControlButton>
          <ControlButton size="sm" variant="ghost" onClick={() => addNode('image')}>
            <ImageIcon className="size-3.5" aria-hidden="true" />
            图片
          </ControlButton>
          <ControlButton size="sm" variant="ghost" onClick={() => addNode('video')}>
            <Film className="size-3.5" aria-hidden="true" />
            视频
          </ControlButton>
          <ControlButton size="sm" variant="ghost" onClick={() => addNode('text')}>
            <Type className="size-3.5" aria-hidden="true" />
            文本
          </ControlButton>
          <ControlButton size="sm" variant="ghost" onClick={() => addNode('task')}>
            <Plus className="size-3.5" aria-hidden="true" />
            任务
          </ControlButton>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge tone={syncStatus === 'synced' ? 'success' : syncStatus === 'conflict' || syncStatus === 'error' ? 'warning' : syncStatus === 'local' ? 'neutral' : 'accent'}>
            {syncStatus === 'synced' ? '已同步' : syncStatus === 'saving' ? '保存中' : syncStatus === 'conflict' ? '版本冲突' : syncStatus === 'error' ? '同步失败' : syncStatus === 'local' ? '本地预览' : '连接中'}
          </StatusBadge>
          <IconAction label="撤销" onClick={undo} disabled={!historyState.canUndo}>
            <Undo2 className="size-3.5" aria-hidden="true" />
          </IconAction>
          <IconAction label="重做" onClick={redo} disabled={!historyState.canRedo}>
            <Redo2 className="size-3.5" aria-hidden="true" />
          </IconAction>
          <IconAction label="重置视图" onClick={resetView}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </IconAction>
          <ControlButton size="sm" variant={showAgent ? 'primary' : 'secondary'} onClick={() => setShowAgent((value) => !value)}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            Agent
          </ControlButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-studio-workspace">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onInit={(instance) => {
              flowRef.current = instance
              window.setTimeout(() => instance.fitView({ padding: showAgent ? 0.2 : 0.14, maxZoom: 1.2 }), 0)
            }}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            selectionOnDrag
            selectionKeyCode="Shift"
            className="studio-flow"
          >
            <Background color="var(--studio-grid)" gap={22} size={1} />
            <Controls showInteractive={false} position="bottom-left" className="!m-3 !overflow-hidden !rounded-lg !border !border-border !bg-card !shadow-sm" />
            <MiniMap nodeColor="var(--studio-ink-foreground)" maskColor="var(--studio-map-mask)" position="bottom-right" className="!m-3 !rounded-lg !border !border-studio-ink-line !bg-studio-workspace" />
          </ReactFlow>

          {selectedNode && (
            <aside className="studio-surface absolute right-3 top-3 z-10 hidden w-60 md:block">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-xs font-semibold text-foreground">节点属性</p>
                <IconAction label="关闭属性" onClick={() => setSelectedId(null)}>
                  <Maximize2 className="size-3.5" aria-hidden="true" />
                </IconAction>
              </div>
              <div className="flex flex-col gap-3 p-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">名称</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{selectedNode.data.title}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">类型</p>
                  <p className="mt-1 text-sm text-foreground">{selectedNode.data.kind === 'image' ? '图片节点' : selectedNode.data.kind === 'video' ? '视频节点' : selectedNode.data.kind === 'task' ? '任务节点' : '文本节点'}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">描述</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedNode.data.detail}</p>
                </div>
                <ControlButton size="sm" variant="secondary" onClick={sendToWorkspace}>
                  <Link2 className="size-3.5" aria-hidden="true" />
                  送入工作台
                </ControlButton>
              </div>
            </aside>
          )}
        </div>

        {showAgent && (
          <div className="flex h-[min(520px,42dvh)] min-h-0 w-full shrink-0 flex-col border-t border-border bg-card lg:h-auto lg:w-80 lg:border-l lg:border-t-0">
            <DirectorAgent projectId={projectId} context="画布 · 当前选择" compact emptyStateLayout="stacked" />
          </div>
        )}
      </div>
    </div>
  )
}
