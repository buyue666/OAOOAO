'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
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
import { Archive, ArrowLeft, Check, Copy, Film, FolderOpen, Hand, History, Home, Image as ImageIcon, Images, Layers3, ListChecks, Maximize2, Menu, MessageCircle, MousePointer2, PanelLeftClose, PanelLeftOpen, Plus, Redo2, RotateCcw, Search, Settings2, Share2, Sparkles, Trash2, Type, Undo2, Upload, Video, X } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { canvasProjectToBoard, createCanvasProject, getCanvasProject, isUnauthorized, StudioApiError, updateCanvasProject, type CanvasBackendProject } from '@/lib/studio/api'
import { media } from '@/lib/studio/mock-data'
import type { Asset, CanvasBoard, CanvasNodeData } from '@/lib/studio/types'
import { cn } from '@/lib/utils'
import { DirectorAgent } from './director-agent'
import { CanvasGenerationPanel, type CanvasCreatedGeneration } from './canvas-generation-panel'
import { ControlButton, IconAction, MediaThumb, StatusBadge } from './ui'
import { useGeneration } from '@/lib/studio/generation-store'
import type { AgentRun } from '@/lib/studio/generation-types'

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
    <div data-node-id={data.title} className={cn('oao-canvas-node w-56 overflow-hidden rounded-[14px] border shadow-[0_18px_38px_rgba(0,0,0,.32)]', selected ? 'is-selected' : '')}>
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-[#bfeee2]" />
      <div className="oao-canvas-node-header flex items-center gap-2 border-b px-3 py-2">
        <span className="oao-canvas-node-icon flex size-6 items-center justify-center rounded-md">
          {data.kind === 'image' ? <ImageIcon className="size-3.5" aria-hidden="true" /> : data.kind === 'video' ? <Video className="size-3.5" aria-hidden="true" /> : data.kind === 'task' ? <Sparkles className="size-3.5" aria-hidden="true" /> : <Type className="size-3.5" aria-hidden="true" />}
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">{data.title}</p>
      </div>
      {data.src && <MediaThumb src={data.src} poster={data.poster} alt={data.title} fallback={data.title} kind={data.kind === 'video' ? 'video' : 'image'} className="h-28 rounded-none" />}
      {!data.src && <div className="oao-canvas-node-copy flex flex-col gap-3 px-3 py-4 text-xs leading-5"><p>{data.detail}</p>{data.status && <span className="oao-canvas-node-status self-start">{data.status}</span>}</div>}
      {data.src && (
        <div className="oao-canvas-node-meta flex items-center justify-between gap-2 px-3 py-2">
          <p className="truncate text-[10px]">{data.detail}</p>
          {data.status && <span className="oao-canvas-node-status">{data.status}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-[#bfeee2]" />
    </div>
  )
}

const nodeTypes = { canvas: CanvasNode }

type CanvasFlowInstance = Pick<ReactFlowInstance<Node<CanvasNodeData>, Edge>, 'fitView'>

type HistoryState = {
  canUndo: boolean
  canRedo: boolean
}

type CanvasPanelTab = 'nodes' | 'assets' | 'tasks' | 'history'

export function CanvasWorkspace({ projectId, fullScreen = false }: { projectId?: string; fullScreen?: boolean }) {
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
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

  const shellClass = fullScreen
    ? 'studio-canvas-fullscreen oao-canvas-editor relative flex min-h-0 overflow-hidden bg-black'
    : 'oao-canvas-editor studio-surface relative flex min-h-[600px] min-h-0 overflow-hidden'
  const workspaceTabs: Array<{ id: CanvasPanelTab; label: string; icon: typeof Layers3 }> = [
    { id: 'nodes', label: '节点', icon: Layers3 },
    { id: 'assets', label: '资产', icon: Images },
    { id: 'tasks', label: '任务', icon: ListChecks },
    { id: 'history', label: '历史', icon: History },
  ]
  const syncLabel = syncStatus === 'synced' ? '已保存' : syncStatus === 'saving' ? '保存中' : syncStatus === 'conflict' ? '版本冲突' : syncStatus === 'error' ? '同步失败' : syncStatus === 'local' ? '本地草稿' : '连接中'

  return (
    <div className={shellClass} data-canvas-editor="true">
      <input ref={uploadInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(event) => { addUploadedFiles(event.target.files ?? []); event.currentTarget.value = '' }} />

      <aside className="oao-canvas-rail" data-canvas-no-zoom aria-label="画布左侧菜单">
        <Link href="/studio" className="oao-canvas-rail-button" aria-label="返回工作台" title="返回工作台"><Home aria-hidden="true" /><span>主页</span></Link>
        <div className="oao-canvas-rail-divider" />
        {workspaceTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={cn('oao-canvas-rail-button', workspacePanelOpen && workspacePanelTab === id && 'is-active')} aria-label={workspacePanelOpen && workspacePanelTab === id ? `收起${label}` : `打开${label}`} aria-pressed={workspacePanelOpen && workspacePanelTab === id} title={workspacePanelOpen && workspacePanelTab === id ? `收起${label}` : `打开${label}`} onClick={() => { if (workspacePanelOpen && workspacePanelTab === id) setWorkspacePanelOpen(false); else { setWorkspacePanelTab(id); setWorkspacePanelOpen(true) } }}><Icon aria-hidden="true" /><span>{label}</span></button>)}
        <div className="flex-1" />
        <button type="button" className="oao-canvas-rail-button" aria-label={workspacePanelOpen ? '收起面板' : '展开面板'} title={workspacePanelOpen ? '收起面板' : '展开面板'} onClick={() => setWorkspacePanelOpen((value) => !value)}>{workspacePanelOpen ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}<span>{workspacePanelOpen ? '收起' : '展开'}</span></button>
      </aside>

      <header className="oao-canvas-topbar" data-canvas-no-zoom>
        <div className="oao-canvas-topbar-leading">
          <button type="button" className="oao-canvas-topbar-menu" aria-label="打开画布面板" title="打开画布面板" onClick={() => setWorkspacePanelOpen((value) => !value)}><Menu aria-hidden="true" /></button>
          <Link href="/canvas" className="oao-canvas-project-pill" title="返回画布列表"><span className="oao-canvas-project-kind">自由画布</span><span className="oao-canvas-project-title">{projectTitle || '未命名画布'}</span></Link>
          <StatusBadge tone={syncStatus === 'synced' ? 'success' : syncStatus === 'error' || syncStatus === 'conflict' ? 'warning' : 'neutral'} className="oao-canvas-save-badge"><span className="oao-canvas-status-dot" aria-hidden="true" />{syncLabel}</StatusBadge>
        </div>
        <div className="oao-canvas-topbar-actions">
          <IconAction label="创建生成节点" onClick={() => openGeneration('image')}><Sparkles aria-hidden="true" /></IconAction>
          <IconAction label="搜索节点" onClick={() => { setWorkspacePanelTab('nodes'); setWorkspacePanelOpen(true) }}><Search aria-hidden="true" /></IconAction>
          <IconAction label="导入素材" onClick={() => uploadInputRef.current?.click()}><Upload aria-hidden="true" /></IconAction>
          <Link href="/plans" className="oao-canvas-credit-pill" title="打开套餐页"><Sparkles aria-hidden="true" /><span>{state.credits.toLocaleString()}</span></Link>
          <IconAction label="专注模式" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.() }}><Maximize2 aria-hidden="true" /></IconAction>
          <IconAction label="分享画布" onClick={() => { void navigator.clipboard?.writeText(window.location.href); window.alert('画布链接已复制') }}><Share2 aria-hidden="true" /></IconAction>
        </div>
      </header>

      <main className="oao-canvas-stage" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={(event) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); addUploadedFiles(event.dataTransfer.files) }}>
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
          onNodeClick={(_, node) => { setSelectedId(node.id); setContextMenu(null) }}
          onNodeContextMenu={(event, node) => { event.preventDefault(); setSelectedId(node.id); setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }) }}
          onPaneContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) }}
          onPaneClick={() => { setSelectedId(null); setContextMenu(null) }}
          fitView
          panOnDrag={panMode}
          selectionOnDrag={!panMode}
          selectionKeyCode="Shift"
          className="studio-flow oao-canvas-flow"
        >
          <Background color="#2b343b" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-left" className="canvas-float-controls oao-canvas-native-controls" />
          <MiniMap nodeColor="#9aa5ac" maskColor="rgba(4, 7, 9, .72)" position="bottom-right" className="canvas-float-controls oao-canvas-minimap" />
        </ReactFlow>

        {contextMenu && (
          <div className="oao-canvas-context-menu" data-canvas-no-zoom style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            <p className="oao-canvas-context-title">{contextMenu.nodeId ? '节点操作' : '画布操作'}</p>
            <button type="button" onClick={() => openGeneration('image', contextMenu.nodeId)}><ImageIcon aria-hidden="true" />生成图片</button>
            <button type="button" onClick={() => openGeneration('video', contextMenu.nodeId)}><Video aria-hidden="true" />生成视频</button>
            <button type="button" onClick={() => openGeneration('agent', contextMenu.nodeId)}><Sparkles aria-hidden="true" />交给 Agent</button>
            <span className="oao-canvas-context-divider" />
            {contextMenu.nodeId ? <>
              <button type="button" onClick={() => duplicateNode(contextMenu.nodeId as string)}><Copy aria-hidden="true" />复制节点</button>
              <button type="button" className="is-danger" onClick={() => deleteNode(contextMenu.nodeId as string)}><Trash2 aria-hidden="true" />删除节点</button>
            </> : <>
              <button type="button" onClick={() => { addNode('text'); setContextMenu(null) }}><Type aria-hidden="true" />新建文本节点</button>
              <button type="button" onClick={() => { addNode('image'); setContextMenu(null) }}><Plus aria-hidden="true" />新建空白节点</button>
            </>}
          </div>
        )}

        {workspacePanelOpen && (
          <aside className="oao-canvas-workspace-panel" data-canvas-no-zoom aria-label="画布工作区面板">
            <div className="oao-canvas-panel-header"><div><p className="oao-canvas-panel-kicker">工作区</p><h2>{workspaceTabs.find((item) => item.id === workspacePanelTab)?.label}</h2></div><IconAction label="关闭面板" onClick={() => setWorkspacePanelOpen(false)}><X aria-hidden="true" /></IconAction></div>
            <div className="oao-canvas-panel-tabs">{workspaceTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={cn('oao-canvas-panel-tab', workspacePanelTab === id && 'is-active')} onClick={() => setWorkspacePanelTab(id)}><Icon aria-hidden="true" />{label}</button>)}</div>
            <div className="oao-canvas-panel-scroll">
              {workspacePanelTab === 'nodes' && (nodes.length ? nodes.map((node) => <button key={node.id} type="button" className={cn('oao-canvas-list-row', selectedId === node.id && 'is-active')} onClick={() => setSelectedId(node.id)}><span className="oao-canvas-list-icon">{node.data.kind === 'image' ? <ImageIcon aria-hidden="true" /> : node.data.kind === 'video' ? <Video aria-hidden="true" /> : node.data.kind === 'task' ? <Sparkles aria-hidden="true" /> : <Type aria-hidden="true" />}</span><span className="min-w-0 flex-1 text-left"><strong>{node.data.title}</strong><small>{node.data.detail}</small></span></button>) : <p className="oao-canvas-panel-empty">画布还是空的。可以从底部工具岛添加节点，或把图片、视频拖进来。</p>)}
              {workspacePanelTab === 'assets' && (state.assets.length ? state.assets.slice(0, 24).map((asset) => <button key={asset.id} type="button" className="oao-canvas-list-row" onClick={() => addAssetNode(asset)}><MediaThumb src={asset.src} poster={asset.poster} alt={asset.title} fallback={asset.title} kind={asset.kind === 'video' ? 'video' : 'image'} className="size-10 shrink-0 rounded-md" /><span className="min-w-0 flex-1 text-left"><strong>{asset.title}</strong><small>{asset.kind === 'video' ? '视频素材' : '图片素材'}</small></span><Plus aria-hidden="true" /></button>) : <p className="oao-canvas-panel-empty">暂无可引用素材。</p>)}
              {workspacePanelTab === 'tasks' && (generation.tasks.length ? generation.tasks.slice(0, 24).map((task) => <div key={task.id} className="oao-canvas-list-row"><span className="oao-canvas-list-icon"><ListChecks aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong>{task.title}</strong><small>{task.error || task.executionPhase || task.status}</small></span><StatusBadge tone={task.status === 'success' ? 'success' : task.status === 'error' ? 'warning' : 'neutral'}>{task.status === 'success' ? '已完成' : task.status === 'error' ? '失败' : '进行中'}</StatusBadge></div>) : state.tasks.length ? state.tasks.slice(0, 24).map((task) => <div key={task.id} className="oao-canvas-list-row"><span className="oao-canvas-list-icon"><ListChecks aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong>{task.title}</strong><small>{task.stage || task.status}</small></span><StatusBadge tone={task.status === 'completed' ? 'success' : task.status === 'failed' ? 'warning' : 'neutral'}>{task.status}</StatusBadge></div>) : <p className="oao-canvas-panel-empty">暂无生成任务。</p>)}
              {workspacePanelTab === 'history' && <div className="oao-canvas-history-empty"><History aria-hidden="true" /><strong>画布历史</strong><p>每次节点移动、连接和导入都会进入撤销栈。底部工具岛可以逐步撤销或重做。</p></div>}
            </div>
          </aside>
        )}

        {selectedNode && !showAgent && !generationPanelOpen && (
          <aside className="oao-canvas-inspector canvas-float-panel" data-canvas-no-zoom>
            <div className="oao-canvas-inspector-header"><div><p className="oao-canvas-panel-kicker">当前选择</p><h2>节点属性</h2></div><IconAction label="关闭属性" onClick={() => setSelectedId(null)}><X aria-hidden="true" /></IconAction></div>
            <div className="oao-canvas-inspector-body"><div><span>名称</span><strong>{selectedNode.data.title}</strong></div><div><span>类型</span><strong>{selectedNode.data.kind === 'image' ? '图片节点' : selectedNode.data.kind === 'video' ? '视频节点' : selectedNode.data.kind === 'task' ? '任务节点' : '文本节点'}</strong></div><div><span>描述</span><p>{selectedNode.data.detail}</p></div><ControlButton size="sm" variant="primary" onClick={() => openGeneration(selectedNode.data.kind === 'video' ? 'video' : 'image', selectedNode.id)}><Sparkles className="size-3.5" aria-hidden="true" />在画布内生成</ControlButton></div>
          </aside>
        )}

        {generationPanelOpen && <CanvasGenerationPanel projectId={projectId ?? boardKey} selectedNode={generationTargetNode} initialMode={generationMode} onClose={closeGeneration} onCreated={addGeneratedNode} onAgentCreated={addAgentNode} />}

        {showAgent ? (
          <aside className="oao-canvas-agent-panel" data-canvas-no-zoom><div className="oao-canvas-agent-header"><div><p className="oao-canvas-panel-kicker">画布助手</p><h2>Agent</h2></div><IconAction label="关闭 Agent" onClick={() => setShowAgent(false)}><X aria-hidden="true" /></IconAction></div><div className="min-h-0 flex-1"><DirectorAgent projectId={projectId} context="画布 · 当前选择" compact emptyStateLayout="stacked" /></div></aside>
        ) : !generationPanelOpen && <button type="button" className="oao-canvas-agent-launcher" data-canvas-no-zoom aria-label="打开画布 Agent" title="打开画布 Agent" onClick={() => { setGenerationPanelOpen(false); setShowAgent(true) }}><span className="oao-canvas-agent-orb"><MessageCircle aria-hidden="true" /></span><span>Agent</span></button>}

        <div className="oao-canvas-zoom-dock" data-canvas-no-zoom><IconAction label="缩小画布" onClick={() => flowRef.current?.fitView({ padding: 0.28, maxZoom: 0.62, duration: 220 })}><span className="oao-canvas-zoom-symbol">−</span></IconAction><span>100%</span><IconAction label="适应画布" onClick={resetView}><RotateCcw aria-hidden="true" /></IconAction><IconAction label="放大画布" onClick={() => flowRef.current?.fitView({ padding: 0.06, maxZoom: 1.45, duration: 220 })}><Plus aria-hidden="true" /></IconAction></div>

        <div className="oao-canvas-dock canvas-toolbar" data-canvas-no-zoom aria-label="画布工具"><button type="button" className={cn('oao-canvas-dock-button', !panMode && 'is-active')} title="选择" aria-label="选择" aria-pressed={!panMode} onClick={() => { setPanMode(false); setSelectedId(null) }}><MousePointer2 aria-hidden="true" /></button><button type="button" className={cn('oao-canvas-dock-button', panMode && 'is-active')} title="抓手平移" aria-label="抓手平移" aria-pressed={panMode} onClick={() => setPanMode(true)}><Hand aria-hidden="true" /></button><span className="oao-canvas-dock-divider" /><button type="button" className="oao-canvas-dock-button" title="撤销" aria-label="撤销" disabled={!historyState.canUndo} onClick={undo}><Undo2 aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="重做" aria-label="重做" disabled={!historyState.canRedo} onClick={redo}><Redo2 aria-hidden="true" /></button><span className="oao-canvas-dock-divider" /><button type="button" className="oao-canvas-dock-button is-accent" title="在画布内生成" aria-label="在画布内生成" onClick={() => openGeneration('image')}><Sparkles aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加空白图片节点" aria-label="添加空白图片节点" onClick={() => addNode('image')}><ImageIcon aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加视频节点" aria-label="添加视频节点" onClick={() => addNode('video')}><Film aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加文本节点" aria-label="添加文本节点" onClick={() => addNode('text')}><Type aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="导入素材" aria-label="导入素材" onClick={() => uploadInputRef.current?.click()}><Upload aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="清空选择" aria-label="清空选择" onClick={() => setSelectedId(null)}><Archive aria-hidden="true" /></button></div>
      </main>
    </div>
  )
}
