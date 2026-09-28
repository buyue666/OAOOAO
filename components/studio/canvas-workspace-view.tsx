'use client'

import { useEffect, useMemo, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import Link from 'next/link'
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  Archive,
  Copy,
  Film,
  Hand,
  History,
  Home,
  Image as ImageIcon,
  Images,
  Layers3,
  ListChecks,
  Maximize2,
  Menu,
  MessageCircle,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import type { AgentRun } from '@/lib/studio/generation-types'
import type { Asset, CanvasNodeData, StudioState } from '@/lib/studio/types'
import { mergeReferenceAssets, libraryAssetToReferenceAsset, workToReferenceAsset } from '@/lib/studio/reference-assets'
import { useLibraryAssets, useServerWorks } from '@/lib/studio/use-account-data'
import { cn } from '@/lib/utils'
import { DirectorAgent } from './director-agent'
import { CanvasGenerationPanel, type CanvasCreatedGeneration } from './canvas-generation-panel'
import { ControlButton, IconAction, MediaThumb, StatusBadge } from './ui'
import { CanvasNodeActionsContext, nodeTypes, type CanvasNodeExpandDirection } from './canvas-node'
import {
  type CanvasContextMenu,
  defaultEdgeOptions,
  type CanvasFlowInstance,
  type CanvasPanelTab,
  fitCanvasWithTopSafeArea,
  type HistoryState,
} from './canvas-workspace-model'

export type CanvasGenerationMode = 'image' | 'video' | 'text' | 'agent'
type CanvasGenerationAnchor = { left: number; top: number; width: number }

type CanvasWorkspaceViewProps = {
  shellClass: string
  projectId?: string
  boardKey: string
  projectTitle?: string
  state: StudioState
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
  selectedId: string | null
  selectedNode?: Node<CanvasNodeData>
  generationTargetNode?: Node<CanvasNodeData>
  generationPanelOpen: boolean
  generationMode: CanvasGenerationMode
  showAgent: boolean
  panMode: boolean
  contextMenu: CanvasContextMenu
  workspacePanelOpen: boolean
  workspacePanelTab: CanvasPanelTab
  historyState: HistoryState
  syncStatus: 'checking' | 'synced' | 'saving' | 'local' | 'conflict' | 'error'
  syncLabel: string
  generationTasks: ReturnType<typeof import('@/lib/studio/generation-store').useGeneration>['tasks']
  flowRef: MutableRefObject<CanvasFlowInstance | null>
  uploadInputRef: RefObject<HTMLInputElement | null>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  setShowAgent: Dispatch<SetStateAction<boolean>>
  setPanMode: Dispatch<SetStateAction<boolean>>
  setContextMenu: Dispatch<SetStateAction<CanvasContextMenu>>
  setWorkspacePanelOpen: Dispatch<SetStateAction<boolean>>
  setWorkspacePanelTab: Dispatch<SetStateAction<CanvasPanelTab>>
  handleNodesChange: (changes: NodeChange<Node<CanvasNodeData>>[]) => void
  handleEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  handleNodeDragStart: () => void
  handleNodeDragStop: () => void
  addUploadedFiles: (files: FileList | File[]) => void
  addNode: (kind: CanvasNodeData['kind'], position?: { x: number; y: number }) => string
  expandNode: (sourceId: string, kind: CanvasNodeData['kind'], direction?: CanvasNodeExpandDirection) => string
  addAssetNode: (asset: Asset) => void
  openGeneration: (mode: CanvasGenerationMode, targetId?: string) => void
  openGenerationAt: (mode: CanvasGenerationMode, position: { x: number; y: number }) => void
  closeGeneration: () => void
  addGeneratedNode: (created: CanvasCreatedGeneration) => void
  addGeneratedTextNode: (created: { task: { id: string; status: string; text?: string; error?: string }; prompt: string; model: string }) => void
  addAgentNode: (run: AgentRun, prompt: string) => void
  duplicateNode: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
  updateNodeData: (nodeId: string, patch: Partial<CanvasNodeData>) => void
  resetView: () => void
  undo: () => void
  redo: () => void
}

const workspaceTabs: Array<{ id: CanvasPanelTab; label: string; icon: typeof Layers3 }> = [
  { id: 'nodes', label: '节点', icon: Layers3 },
  { id: 'assets', label: '资产', icon: Images },
  { id: 'tasks', label: '任务', icon: ListChecks },
  { id: 'history', label: '历史', icon: History },
]

export function CanvasWorkspaceView({
  shellClass,
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
  generationTasks,
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
  expandNode,
  addAssetNode,
  openGeneration,
  openGenerationAt,
  closeGeneration,
  addGeneratedNode,
  addGeneratedTextNode,
  addAgentNode,
  duplicateNode,
  deleteNode,
  updateNodeData,
  resetView,
  undo,
  redo,
}: CanvasWorkspaceViewProps) {
  const [expandMenu, setExpandMenu] = useState<{ x: number; y: number; nodeId: string; direction: CanvasNodeExpandDirection } | null>(null)
  const [generationAnchor, setGenerationAnchor] = useState<CanvasGenerationAnchor | null>(null)
  const [canvasToolNotice, setCanvasToolNotice] = useState('')
  const [canvasZoom, setCanvasZoom] = useState(1)
  const serverLibrary = useLibraryAssets({ pageSize: 60 })
  const serverWorks = useServerWorks({ pageSize: 60 })
  const canvasAssets = useMemo<Asset[]>(() => {
    if (state.backendStatus !== 'connected') return state.assets
    return mergeReferenceAssets([
      serverLibrary.assets.map(libraryAssetToReferenceAsset),
      serverWorks.works.map(workToReferenceAsset),
    ])
  }, [serverLibrary.assets, serverWorks.works, state.assets, state.backendStatus])
  const contextFlowPosition = contextMenu?.position
  const startContextGeneration = (mode: CanvasGenerationMode) => {
    if (contextMenu?.nodeId) openGeneration(mode, contextMenu.nodeId)
    else if (contextFlowPosition) openGenerationAt(mode, contextFlowPosition)
    else openGeneration(mode)
  }
  const contextNode = contextMenu?.nodeId ? nodes.find((node) => node.id === contextMenu.nodeId) : undefined
  const contextNodeMode: CanvasGenerationMode | null = contextNode?.data.kind === 'task'
    ? 'agent'
    : contextNode?.data.kind === 'image' || contextNode?.data.kind === 'video' || contextNode?.data.kind === 'text'
      ? contextNode.data.kind
      : null
  const onNodeExpand = (nodeId: string, direction: CanvasNodeExpandDirection, event: ReactMouseEvent<HTMLButtonElement>) => {
    setSelectedId(nodeId)
    setContextMenu(null)
    setExpandMenu({ x: event.clientX, y: event.clientY, nodeId, direction })
  }
  const nodeGenerationMode = (node: Node<CanvasNodeData>): CanvasGenerationMode => node.data.kind === 'video' ? 'video' : node.data.kind === 'task' ? 'agent' : node.data.kind === 'text' ? 'text' : 'image'
  const inspectNode = (nodeId: string) => {
    setSelectedId(nodeId)
    setContextMenu(null)
    setExpandMenu(null)
    closeGeneration()
  }
  const generateNode = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId)
    if (!node) return
    setSelectedId(nodeId)
    setContextMenu(null)
    setExpandMenu(null)
    openGeneration(nodeGenerationMode(node), nodeId)
  }
  const runCanvasImageTool = (label: string) => {
    if (!selectedNode || selectedNode.data.kind !== 'image') {
      const message = '请先选择一个图片节点'
      setCanvasToolNotice(message)
      window.setTimeout(() => setCanvasToolNotice((current) => current === message ? '' : current), 2200)
      return
    }
    if (label === '局部重绘') {
      generateNode(selectedNode.id)
      return
    }
    if (label === '文字编辑') {
      inspectNode(selectedNode.id)
      return
    }
    if (label === '图片工具') {
      inspectNode(selectedNode.id)
      return
    }
    const toolPrompts: Record<string, string> = {
      九宫格: '将当前主体整理为九宫格角色/场景设定图，保持外观一致。',
      全景图: '将当前画面扩展为连续的宽幅全景构图，保持主体和光线一致。',
      人像调整: '优化当前画面中的人物造型与面部细节，保持身份和构图一致。',
      视角: '基于当前图片生成一个新的镜头视角，保持主体、材质和风格一致。',
    }
    const instruction = toolPrompts[label]
    if (instruction) updateNodeData(selectedNode.id, { prompt: `${instruction}\n${selectedNode.data.prompt || selectedNode.data.detail}` })
    generateNode(selectedNode.id)
  }

  const updateGenerationAnchor = () => {
    if (!generationPanelOpen) return
    const stage = document.querySelector<HTMLElement>('.oao-canvas-stage')
    if (!stage) return
    const stageBox = stage.getBoundingClientRect()
    const targetElement = generationTargetNode
      ? Array.from(stage.querySelectorAll<HTMLElement>('[data-node-id]')).find((element) => element.dataset.nodeId === generationTargetNode.id)
      : undefined
    const targetBox = targetElement?.getBoundingClientRect()
    const compact = window.innerWidth <= 720
    const preferredWidth = compact ? Math.min(350, Math.max(280, stageBox.width - 76)) : window.innerWidth <= 900 ? 360 : 420
    const panelHeight = compact ? Math.min(450, Math.max(320, stageBox.height - 80)) : Math.min(430, Math.max(320, stageBox.height - 100))
    const minLeft = compact ? 64 : 76
    let panelWidth = preferredWidth
    let left = targetBox ? targetBox.right - stageBox.left + 16 : (stageBox.width - panelWidth) / 2
    let top = targetBox ? targetBox.top - stageBox.top : (stageBox.height - panelHeight) / 2
    if (targetBox && !compact) {
      const targetLeft = targetBox.left - stageBox.left
      const targetRight = targetBox.right - stageBox.left
      const targetBottom = targetBox.bottom - stageBox.top
      const belowTop = targetBottom + 16
      const belowAvailable = stageBox.height - belowTop - 14
      if (belowAvailable >= panelHeight) {
        left = targetLeft + (targetBox.width - panelWidth) / 2
        top = belowTop
      } else {
      const rightLeft = targetRight + 16
      const rightAvailable = stageBox.width - rightLeft - 14
      const leftAvailable = targetLeft - minLeft - 16
      if (rightAvailable >= 300) {
        left = rightLeft
        panelWidth = Math.min(preferredWidth, rightAvailable)
      } else if (leftAvailable >= 300) {
        panelWidth = Math.min(preferredWidth, leftAvailable)
        left = targetLeft - panelWidth - 16
      } else if (rightAvailable >= leftAvailable) {
        left = rightLeft
        panelWidth = Math.max(260, rightAvailable)
      } else {
        panelWidth = Math.max(260, leftAvailable)
        left = targetLeft - panelWidth - 16
      }
      }
    }
    const maxLeft = Math.max(minLeft, stageBox.width - panelWidth - 14)
    const maxTop = Math.max(64, stageBox.height - panelHeight - 14)
    left = Math.min(Math.max(left, minLeft), maxLeft)
    top = Math.min(Math.max(top, 64), maxTop)
    const next = { left: Math.round(left), top: Math.round(top), width: Math.round(panelWidth) }
    setGenerationAnchor((current) => current?.left === next.left && current.top === next.top && current.width === next.width ? current : next)
  }

  useEffect(() => {
    if (!generationPanelOpen) {
      setGenerationAnchor(null)
      return
    }
    const update = () => window.requestAnimationFrame(updateGenerationAnchor)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [generationPanelOpen, generationTargetNode?.id, nodes])

  useEffect(() => {
    if (!expandMenu) return
    const close = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof globalThis.Node) || !(target as Element).closest('[data-canvas-expand-menu]')) setExpandMenu(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpandMenu(null) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape) }
  }, [expandMenu])

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
          <Link href="/canvas" className="oao-canvas-project-pill" title="返回画布列表"><span className="oao-canvas-project-kind">Agent 创作</span><span className="oao-canvas-project-title">{projectTitle || '未命名画布'}</span></Link>
          <StatusBadge tone={syncStatus === 'synced' ? 'success' : syncStatus === 'error' || syncStatus === 'conflict' ? 'warning' : 'neutral'} className="oao-canvas-save-badge"><span className="oao-canvas-status-dot" aria-hidden="true" />{syncLabel}</StatusBadge>
        </div>
        <div className="oao-canvas-topbar-actions">
          <button type="button" className="oao-canvas-topbar-labeled" title="搜索节点" onClick={() => { setWorkspacePanelTab('nodes'); setWorkspacePanelOpen(true) }}><Search aria-hidden="true" /><span>搜索</span></button>
          <button type="button" className="oao-canvas-topbar-labeled" title="导入素材到画布" onClick={() => uploadInputRef.current?.click()}><Upload aria-hidden="true" /><span>导入画布素材</span></button>
          <Link href="/plans" className="oao-canvas-credit-pill" title="打开套餐页"><Sparkles aria-hidden="true" /><span>{state.credits.toLocaleString()}</span></Link>
          <button type="button" className="oao-canvas-topbar-labeled" title="查看画布版本" onClick={() => { setWorkspacePanelTab('history'); setWorkspacePanelOpen(true) }}><History aria-hidden="true" /><span>版本</span></button>
          <IconAction label="专注模式" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.() }}><Maximize2 aria-hidden="true" /></IconAction>
          <IconAction label="分享画布" onClick={() => { void navigator.clipboard?.writeText(window.location.href); setCanvasToolNotice('画布链接已复制') }}><Share2 aria-hidden="true" /></IconAction>
        </div>
      </header>

      <main className="oao-canvas-stage" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={(event) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); addUploadedFiles(event.dataTransfer.files) }}>
        {selectedNode?.data.kind === 'image' && <div className="oao-canvas-image-toolbar" data-canvas-no-zoom aria-label="图片工具栏">
          <button type="button" onClick={() => runCanvasImageTool('局部重绘')}><Sparkles aria-hidden="true" /><span>局部重绘</span></button>
          <button type="button" onClick={() => runCanvasImageTool('文字编辑')}><Type aria-hidden="true" /><span>文字编辑</span></button>
          <button type="button" onClick={() => runCanvasImageTool('九宫格')}><Layers3 aria-hidden="true" /><span>九宫格</span></button>
          <button type="button" onClick={() => runCanvasImageTool('全景图')}><Images aria-hidden="true" /><span>全景图</span></button>
          <button type="button" onClick={() => runCanvasImageTool('人像调整')}><MessageCircle aria-hidden="true" /><span>人像调整</span></button>
          <button type="button" onClick={() => runCanvasImageTool('视角')}><Maximize2 aria-hidden="true" /><span>视角</span></button>
          <button type="button" onClick={() => runCanvasImageTool('图片工具')}><ImageIcon aria-hidden="true" /><span>图片工具</span></button>
          <span className="oao-canvas-image-toolbar-divider" aria-hidden="true" />
          <button type="button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.() }}><Maximize2 aria-hidden="true" /><span>全屏</span></button>
          <button type="button" onClick={() => setCanvasToolNotice('当前画布可从右键菜单导出节点')}><Upload aria-hidden="true" /><span>导出</span></button>
          <button type="button" onClick={() => setCanvasToolNotice('更多节点工具已收纳在底部工具岛')}><Archive aria-hidden="true" /><span>更多</span></button>
          {canvasToolNotice && <span className="oao-canvas-tool-notice" role="status">{canvasToolNotice}</span>}
        </div>}
        <CanvasNodeActionsContext.Provider value={{ onExpand: onNodeExpand, onInspect: inspectNode, onGenerate: generateNode, onDuplicate: duplicateNode, onDelete: deleteNode }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onInit={(instance: ReactFlowInstance<Node<CanvasNodeData>, Edge>) => {
              flowRef.current = instance
              setCanvasZoom(instance.getViewport().zoom)
              window.setTimeout(() => fitCanvasWithTopSafeArea(instance, showAgent ? 0.26 : 0.22), 0)
            }}
            onNodeDragStart={handleNodeDragStart}
            onNodeDrag={() => { if (generationPanelOpen) window.requestAnimationFrame(updateGenerationAnchor) }}
            onNodeDragStop={handleNodeDragStop}
            onMove={(_, viewport) => { setCanvasZoom(viewport.zoom); if (generationPanelOpen) window.requestAnimationFrame(updateGenerationAnchor) }}
            onNodeClick={(_, node) => { setSelectedId(node.id); setContextMenu(null); setExpandMenu(null) }}
            onNodeDoubleClick={(_, node) => { generateNode(node.id) }}
            onNodeContextMenu={(event, node) => { event.preventDefault(); setSelectedId(node.id); setExpandMenu(null); setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }) }}
            onPaneContextMenu={(event) => { event.preventDefault(); setExpandMenu(null); setContextMenu({ x: event.clientX, y: event.clientY, position: flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) }) }}
            onPaneClick={() => { setSelectedId(null); setContextMenu(null); setExpandMenu(null) }}
            fitView
            panOnDrag={panMode}
            selectionOnDrag={!panMode}
            selectionKeyCode="Shift"
            className="studio-flow oao-canvas-flow"
          >
            <Background color="#3d3d3d" gap={28} size={1} />
            <Controls showInteractive={false} position="bottom-left" className="canvas-float-controls oao-canvas-native-controls" />
          </ReactFlow>
        </CanvasNodeActionsContext.Provider>

        {contextMenu && (
          <div className="oao-canvas-context-menu" data-canvas-no-zoom style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            <p className="oao-canvas-context-title">{contextMenu.nodeId ? '节点操作' : '画布操作'}</p>
            {contextMenu.nodeId ? <>
              {contextNodeMode && <button type="button" onClick={() => startContextGeneration(contextNodeMode)}>{contextNodeMode === 'image' ? <ImageIcon aria-hidden="true" /> : contextNodeMode === 'video' ? <Video aria-hidden="true" /> : contextNodeMode === 'agent' ? <Sparkles aria-hidden="true" /> : <Type aria-hidden="true" />}重新生成{contextNodeMode === 'image' ? '图片' : contextNodeMode === 'video' ? '视频' : contextNodeMode === 'agent' ? 'Agent 任务' : '文本'}</button>}
              <span className="oao-canvas-context-divider" />
              <button type="button" onClick={() => duplicateNode(contextMenu.nodeId as string)}><Copy aria-hidden="true" />复制节点</button>
              <button type="button" className="is-danger" onClick={() => deleteNode(contextMenu.nodeId as string)}><Trash2 aria-hidden="true" />删除节点</button>
            </> : <>
              <button type="button" onClick={() => startContextGeneration('image')}><ImageIcon aria-hidden="true" />生成图片节点</button>
              <button type="button" onClick={() => startContextGeneration('video')}><Video aria-hidden="true" />生成视频节点</button>
              <button type="button" onClick={() => startContextGeneration('text')}><Type aria-hidden="true" />生成文本节点</button>
              <button type="button" onClick={() => startContextGeneration('agent')}><Sparkles aria-hidden="true" />交给 Agent</button>
              <span className="oao-canvas-context-divider" />
              <button type="button" onClick={() => { addNode('text', contextFlowPosition); setContextMenu(null) }}><Type aria-hidden="true" />新建文本节点</button>
              <button type="button" onClick={() => { addNode('image', contextFlowPosition); setContextMenu(null) }}><Plus aria-hidden="true" />新建图片节点</button>
              <button type="button" onClick={() => { addNode('video', contextFlowPosition); setContextMenu(null) }}><Video aria-hidden="true" />新建视频节点</button>
            </>}
          </div>
        )}

        {expandMenu && (
          <div className={cn('oao-canvas-expand-menu', expandMenu.direction === 'before' && 'is-before')} data-canvas-expand-menu data-canvas-no-zoom style={{ left: expandMenu.x, top: expandMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            <p className="oao-canvas-expand-menu-title">添加连接节点</p>
            <button type="button" data-canvas-expand-option="image" onClick={() => { expandNode(expandMenu.nodeId, 'image', expandMenu.direction); setExpandMenu(null) }}><ImageIcon aria-hidden="true" />图片生成</button>
            <button type="button" data-canvas-expand-option="video" onClick={() => { expandNode(expandMenu.nodeId, 'video', expandMenu.direction); setExpandMenu(null) }}><Video aria-hidden="true" />视频生成</button>
            <button type="button" data-canvas-expand-option="text" onClick={() => { expandNode(expandMenu.nodeId, 'text', expandMenu.direction); setExpandMenu(null) }}><Type aria-hidden="true" />文本节点</button>
            <button type="button" data-canvas-expand-option="task" onClick={() => { expandNode(expandMenu.nodeId, 'task', expandMenu.direction); setExpandMenu(null) }}><Sparkles aria-hidden="true" />Agent 任务</button>
          </div>
        )}

        {workspacePanelOpen && (
          <aside className="oao-canvas-workspace-panel" data-canvas-no-zoom aria-label="画布工作区面板">
            <div className="oao-canvas-panel-header"><div><p className="oao-canvas-panel-kicker">工作区</p><h2>{workspaceTabs.find((item) => item.id === workspacePanelTab)?.label}</h2></div><IconAction label="关闭面板" onClick={() => setWorkspacePanelOpen(false)}><X aria-hidden="true" /></IconAction></div>
            <div className="oao-canvas-panel-tabs">{workspaceTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={cn('oao-canvas-panel-tab', workspacePanelTab === id && 'is-active')} onClick={() => setWorkspacePanelTab(id)}><Icon aria-hidden="true" />{label}</button>)}</div>
            <div className="oao-canvas-panel-scroll">
              {workspacePanelTab === 'nodes' && (nodes.length ? nodes.map((node) => <button key={node.id} type="button" className={cn('oao-canvas-list-row', selectedId === node.id && 'is-active')} onClick={() => setSelectedId(node.id)}><span className="oao-canvas-list-icon">{node.data.kind === 'image' ? <ImageIcon aria-hidden="true" /> : node.data.kind === 'video' ? <Video aria-hidden="true" /> : node.data.kind === 'task' ? <Sparkles aria-hidden="true" /> : <Type aria-hidden="true" />}</span><span className="min-w-0 flex-1 text-left"><strong>{node.data.title}</strong><small>{node.data.detail}</small></span></button>) : <p className="oao-canvas-panel-empty">画布还是空的。可以从底部工具岛添加节点，或把图片、视频拖进来。</p>)}
              {workspacePanelTab === 'assets' && (canvasAssets.length ? canvasAssets.slice(0, 24).map((asset) => <button key={asset.id} type="button" className="oao-canvas-list-row" onClick={() => addAssetNode(asset)}><MediaThumb src={asset.src} poster={asset.poster} alt={asset.title} fallback={asset.title} kind={asset.kind === 'video' ? 'video' : 'image'} className="size-10 shrink-0 rounded-md" /><span className="min-w-0 flex-1 text-left"><strong>{asset.title}</strong><small>{asset.category === 'character' ? '角色资产' : asset.category === 'scene' ? '场景资产' : asset.category === 'prop' ? '道具资产' : asset.kind === 'video' ? '视频素材' : '图片素材'}</small></span><Plus aria-hidden="true" /></button>) : <p className="oao-canvas-panel-empty">暂无属于你的可引用资产，请先在素材库上传。</p>)}
              {workspacePanelTab === 'tasks' && (generationTasks.length ? generationTasks.slice(0, 24).map((task) => <div key={task.id} className="oao-canvas-list-row"><span className="oao-canvas-list-icon"><ListChecks aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong>{task.title}</strong><small>{task.error || task.executionPhase || task.status}</small></span><StatusBadge tone={task.status === 'success' ? 'success' : task.status === 'error' ? 'warning' : 'neutral'}>{task.status === 'success' ? '已完成' : task.status === 'error' ? '失败' : '进行中'}</StatusBadge></div>) : state.tasks.length ? state.tasks.slice(0, 24).map((task) => <div key={task.id} className="oao-canvas-list-row"><span className="oao-canvas-list-icon"><ListChecks aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong>{task.title}</strong><small>{task.stage || task.status}</small></span><StatusBadge tone={task.status === 'completed' ? 'success' : task.status === 'failed' ? 'warning' : 'neutral'}>{task.status}</StatusBadge></div>) : <p className="oao-canvas-panel-empty">暂无生成任务。</p>)}
              {workspacePanelTab === 'history' && <div className="oao-canvas-history-empty"><History aria-hidden="true" /><strong>画布历史</strong><p>每次节点移动、连接和导入都会进入撤销栈。底部工具岛可以逐步撤销或重做。</p></div>}
            </div>
          </aside>
        )}

        {selectedNode && !showAgent && !generationPanelOpen && (
          <aside className="oao-canvas-inspector canvas-float-panel" data-canvas-no-zoom>
            <div className="oao-canvas-inspector-header"><div><p className="oao-canvas-panel-kicker">当前选择</p><h2>节点属性</h2></div><IconAction label="关闭属性" onClick={() => setSelectedId(null)}><X aria-hidden="true" /></IconAction></div>
            <div className="oao-canvas-inspector-body">
              <label className="oao-canvas-inspector-field"><span>名称</span><input className="studio-field" value={selectedNode.data.title} onChange={(event) => updateNodeData(selectedNode.id, { title: event.target.value })} /></label>
              <div><span>类型</span><strong>{selectedNode.data.kind === 'image' ? '图片节点' : selectedNode.data.kind === 'video' ? '视频节点' : selectedNode.data.kind === 'task' ? 'Agent 任务节点' : '文本节点'}</strong></div>
              <label className="oao-canvas-inspector-field"><span>{selectedNode.data.kind === 'text' ? '文字内容' : '提示词 / 说明'}</span><textarea className="studio-field" value={selectedNode.data.content || selectedNode.data.prompt || selectedNode.data.detail} onChange={(event) => updateNodeData(selectedNode.id, selectedNode.data.kind === 'text' ? { content: event.target.value, prompt: event.target.value, detail: event.target.value } : { prompt: event.target.value, detail: event.target.value })} rows={4} /></label>
              {selectedNode.data.model && <div><span>生成设置</span><strong>{selectedNode.data.model} · {selectedNode.data.ratio || '自动比例'}{selectedNode.data.quality ? ` · ${selectedNode.data.quality}` : ''}</strong></div>}
              <ControlButton size="sm" variant="primary" onClick={() => openGeneration(selectedNode.data.kind === 'video' ? 'video' : selectedNode.data.kind === 'task' ? 'agent' : selectedNode.data.kind === 'text' ? 'text' : 'image', selectedNode.id)}><Sparkles className="size-3.5" aria-hidden="true" />在画布内生成</ControlButton>
            </div>
          </aside>
        )}

        {generationPanelOpen && <CanvasGenerationPanel projectId={projectId ?? boardKey} selectedNode={generationTargetNode} availableAssets={canvasAssets} initialMode={generationMode} anchor={generationAnchor ?? undefined} onClose={closeGeneration} onCreated={addGeneratedNode} onTextCreated={addGeneratedTextNode} onAgentCreated={addAgentNode} />}

        {showAgent ? (
          <aside className="oao-canvas-agent-panel" data-canvas-no-zoom><div className="oao-canvas-agent-header"><div><p className="oao-canvas-panel-kicker">画布助手</p><h2>Agent</h2></div><IconAction label="关闭 Agent" onClick={() => setShowAgent(false)}><X aria-hidden="true" /></IconAction></div><div className="min-h-0 flex-1"><DirectorAgent projectId={projectId} context="画布 · 当前选择" compact emptyStateLayout="stacked" /></div></aside>
        ) : !generationPanelOpen && <button type="button" className="oao-canvas-agent-launcher" data-canvas-no-zoom aria-label="打开画布 Agent" title="打开画布 Agent" onClick={() => { setShowAgent(true) }}><span className="oao-canvas-agent-orb"><MessageCircle aria-hidden="true" /></span><span>Agent</span></button>}

        <div className="oao-canvas-zoom-dock" data-canvas-no-zoom><IconAction label="缩小画布" onClick={() => flowRef.current?.fitView({ padding: 0.28, maxZoom: 0.62, duration: 220 })}><span className="oao-canvas-zoom-symbol">−</span></IconAction><span>{Math.round(canvasZoom * 100)}%</span><IconAction label="适应画布" onClick={resetView}><RotateCcw aria-hidden="true" /></IconAction><IconAction label="放大画布" onClick={() => flowRef.current?.fitView({ padding: 0.06, maxZoom: 1.45, duration: 220 })}><Plus aria-hidden="true" /></IconAction></div>

        <div className="oao-canvas-dock canvas-toolbar" data-canvas-no-zoom aria-label="画布工具"><button type="button" className={cn('oao-canvas-dock-button', !panMode && 'is-active')} title="选择" aria-label="选择" aria-pressed={!panMode} onClick={() => { setPanMode(false); setSelectedId(null) }}><MousePointer2 aria-hidden="true" /></button><button type="button" className={cn('oao-canvas-dock-button', panMode && 'is-active')} title="抓手平移" aria-label="抓手平移" aria-pressed={panMode} onClick={() => setPanMode(true)}><Hand aria-hidden="true" /></button><span className="oao-canvas-dock-divider" /><button type="button" className="oao-canvas-dock-button" title="撤销" aria-label="撤销" disabled={!historyState.canUndo} onClick={undo}><Undo2 aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="重做" aria-label="重做" disabled={!historyState.canRedo} onClick={redo}><Redo2 aria-hidden="true" /></button><span className="oao-canvas-dock-divider" /><button type="button" className="oao-canvas-dock-button is-accent" title="在画布内生成" aria-label="在画布内生成" onClick={() => openGeneration('image')}><Sparkles aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加空白图片节点" aria-label="添加空白图片节点" onClick={() => addNode('image')}><ImageIcon aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加视频节点" aria-label="添加视频节点" onClick={() => addNode('video')}><Film aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加文本节点" aria-label="添加文本节点" onClick={() => addNode('text')}><Type aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="导入素材" aria-label="导入素材" onClick={() => uploadInputRef.current?.click()}><Upload aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="清空选择" aria-label="清空选择" onClick={() => setSelectedId(null)}><Archive aria-hidden="true" /></button></div>
      </main>
    </div>
  )
}
