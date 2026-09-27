'use client'

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import Link from 'next/link'
import {
  Background,
  Controls,
  MiniMap,
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
import { cn } from '@/lib/utils'
import { DirectorAgent } from './director-agent'
import { CanvasGenerationPanel, type CanvasCreatedGeneration } from './canvas-generation-panel'
import { ControlButton, IconAction, MediaThumb, StatusBadge } from './ui'
import { nodeTypes } from './canvas-node'
import {
  type CanvasContextMenu,
  defaultEdgeOptions,
  type CanvasFlowInstance,
  type CanvasPanelTab,
  type HistoryState,
} from './canvas-workspace-model'

export type CanvasGenerationMode = 'image' | 'video' | 'agent'

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
  addNode: (kind: CanvasNodeData['kind']) => void
  addAssetNode: (asset: Asset) => void
  openGeneration: (mode: CanvasGenerationMode, targetId?: string) => void
  closeGeneration: () => void
  addGeneratedNode: (created: CanvasCreatedGeneration) => void
  addAgentNode: (run: AgentRun, prompt: string) => void
  duplicateNode: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
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
}: CanvasWorkspaceViewProps) {
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
          onInit={(instance: ReactFlowInstance<Node<CanvasNodeData>, Edge>) => {
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
              {workspacePanelTab === 'tasks' && (generationTasks.length ? generationTasks.slice(0, 24).map((task) => <div key={task.id} className="oao-canvas-list-row"><span className="oao-canvas-list-icon"><ListChecks aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong>{task.title}</strong><small>{task.error || task.executionPhase || task.status}</small></span><StatusBadge tone={task.status === 'success' ? 'success' : task.status === 'error' ? 'warning' : 'neutral'}>{task.status === 'success' ? '已完成' : task.status === 'error' ? '失败' : '进行中'}</StatusBadge></div>) : state.tasks.length ? state.tasks.slice(0, 24).map((task) => <div key={task.id} className="oao-canvas-list-row"><span className="oao-canvas-list-icon"><ListChecks aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong>{task.title}</strong><small>{task.stage || task.status}</small></span><StatusBadge tone={task.status === 'completed' ? 'success' : task.status === 'failed' ? 'warning' : 'neutral'}>{task.status}</StatusBadge></div>) : <p className="oao-canvas-panel-empty">暂无生成任务。</p>)}
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
        ) : !generationPanelOpen && <button type="button" className="oao-canvas-agent-launcher" data-canvas-no-zoom aria-label="打开画布 Agent" title="打开画布 Agent" onClick={() => { setShowAgent(true) }}><span className="oao-canvas-agent-orb"><MessageCircle aria-hidden="true" /></span><span>Agent</span></button>}

        <div className="oao-canvas-zoom-dock" data-canvas-no-zoom><IconAction label="缩小画布" onClick={() => flowRef.current?.fitView({ padding: 0.28, maxZoom: 0.62, duration: 220 })}><span className="oao-canvas-zoom-symbol">−</span></IconAction><span>100%</span><IconAction label="适应画布" onClick={resetView}><RotateCcw aria-hidden="true" /></IconAction><IconAction label="放大画布" onClick={() => flowRef.current?.fitView({ padding: 0.06, maxZoom: 1.45, duration: 220 })}><Plus aria-hidden="true" /></IconAction></div>

        <div className="oao-canvas-dock canvas-toolbar" data-canvas-no-zoom aria-label="画布工具"><button type="button" className={cn('oao-canvas-dock-button', !panMode && 'is-active')} title="选择" aria-label="选择" aria-pressed={!panMode} onClick={() => { setPanMode(false); setSelectedId(null) }}><MousePointer2 aria-hidden="true" /></button><button type="button" className={cn('oao-canvas-dock-button', panMode && 'is-active')} title="抓手平移" aria-label="抓手平移" aria-pressed={panMode} onClick={() => setPanMode(true)}><Hand aria-hidden="true" /></button><span className="oao-canvas-dock-divider" /><button type="button" className="oao-canvas-dock-button" title="撤销" aria-label="撤销" disabled={!historyState.canUndo} onClick={undo}><Undo2 aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="重做" aria-label="重做" disabled={!historyState.canRedo} onClick={redo}><Redo2 aria-hidden="true" /></button><span className="oao-canvas-dock-divider" /><button type="button" className="oao-canvas-dock-button is-accent" title="在画布内生成" aria-label="在画布内生成" onClick={() => openGeneration('image')}><Sparkles aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加空白图片节点" aria-label="添加空白图片节点" onClick={() => addNode('image')}><ImageIcon aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加视频节点" aria-label="添加视频节点" onClick={() => addNode('video')}><Film aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="添加文本节点" aria-label="添加文本节点" onClick={() => addNode('text')}><Type aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="导入素材" aria-label="导入素材" onClick={() => uploadInputRef.current?.click()}><Upload aria-hidden="true" /></button><button type="button" className="oao-canvas-dock-button" title="清空选择" aria-label="清空选择" onClick={() => setSelectedId(null)}><Archive aria-hidden="true" /></button></div>
      </main>
    </div>
  )
}
