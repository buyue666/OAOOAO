'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Background, BackgroundVariant, MiniMap, ReactFlow, useReactFlow, type NodeMouseHandler, type Viewport } from '@xyflow/react'
import { readAssetDrag } from './asset-reference'
import { useCanvasStore } from './canvas-store'
import { createMediaNode } from './node-factory'
import { AgentNode } from './nodes/agent-node'
import { GenerationNode } from './nodes/generation-node'
import { GroupNode } from './nodes/group-node'
import { MediaNode } from './nodes/media-node'
import { DirectorNode } from './nodes/director-node'
import { settingsPlacementFor } from './nodes/node-kit'
import type { FreeCanvasNode } from './types'
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from './canvas-navigation'
import { DirectorDesk } from './director-desk'

const nodeTypes = {
  generation: GenerationNode,
  media: MediaNode,
  agent: AgentNode,
  director: DirectorNode,
  group: GroupNode,
}

const defaultEdgeOptions = {
  type: 'default',
  style: { stroke: 'rgba(255,255,255,0.72)', strokeWidth: 1.4 },
}

/** React Flow 的主题变量统一换成黑白层级，不沿用旧画布的青绿色与玻璃面板。 */
const FLOW_THEME = {
  '--xy-background-color': '#000000',
  '--xy-node-background-color': '#0a0a0a',
  '--xy-node-border': '1px solid rgba(255,255,255,0.15)',
  '--xy-node-color': '#fafafa',
  '--xy-selection-background-color': 'rgba(255,255,255,0.05)',
  '--xy-selection-border': '1px dashed rgba(255,255,255,0.45)',
  '--xy-edge-stroke': 'rgba(255,255,255,0.72)',
  '--xy-edge-stroke-selected': '#ffffff',
  '--xy-handle-background-color': '#fafafa',
  '--xy-controls-button-background-color': '#0a0a0a',
  '--xy-controls-button-color': '#fafafa',
  '--xy-attribution-background-color': 'transparent',
} as CSSProperties

const INTERACTIVE_SELECTOR = 'textarea,input,select,button,a,label,video,audio'
// Keep library BEM selectors literal: Tailwind arbitrary selectors turn unescaped
// underscores into spaces, so `.react-flow__attribution` would target the wrong DOM.
const ATTRIBUTION_STYLE = `
[data-oao-free-canvas] .react-flow__panel.react-flow__attribution { bottom: 60px; background: transparent; }
[data-oao-free-canvas] .react-flow__attribution a { color: #a3a3a3; }
[data-oao-free-canvas] .react-flow__attribution a:hover { color: #ffffff; }
[data-oao-free-canvas] .react-flow__attribution a:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
`

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input,textarea,select,dialog[open],[role="dialog"],[data-canvas-name-editor]')))
}

export function CanvasFlow({ initialViewport }: { initialViewport: Viewport }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow()
  const [initialZoom] = useState(initialViewport.zoom)
  const [shouldFit] = useState(() => {
    const state = useCanvasStore.getState()
    const isDefault = state.viewport.x === 0 && state.viewport.y === 0 && state.viewport.zoom === 1
    return isDefault && state.nodes.length > 0
  })

  const nodes = useCanvasStore((state) => state.nodes)
  const edges = useCanvasStore((state) => state.edges)
  const miniMapOpen = useCanvasStore((state) => state.miniMapOpen)
  const snapToGrid = useCanvasStore((state) => state.snapToGrid)
  const showEdges = useCanvasStore((state) => state.showEdges)
  const directorNodeId = useCanvasStore((state) => state.directorNodeId)
  const hasSelection = useCanvasStore((state) => state.nodes.some(node => node.selected))
  const settingsNodeId = useCanvasStore((state) => state.settingsNodeId)
  const onNodesChange = useCanvasStore((state) => state.onNodesChange)
  const onEdgesChange = useCanvasStore((state) => state.onEdgesChange)
  const connect = useCanvasStore((state) => state.connect)
  const commitViewport = useCanvasStore((state) => state.commitViewport)
  const beginEdit = useCanvasStore((state) => state.beginEdit)
  const openSettings = useCanvasStore((state) => state.openSettings)
  const openContextMenu = useCanvasStore((state) => state.openContextMenu)
  const closeOverlays = useCanvasStore((state) => state.closeOverlays)
  const insertNodes = useCanvasStore((state) => state.insertNodes)

  /**
   * 节点浮层用 `--canvas-zoom` 反向缩放。变量直接写在 DOM 上，
   * 不经过 React 渲染，避免拖动或平移时被旧的缩放值覆盖。
   */
  const publishZoom = useCallback((zoom: number) => {
    rootRef.current?.style.setProperty('--canvas-zoom', String(zoom))
  }, [])

  useEffect(() => {
    publishZoom(initialZoom)
  }, [initialZoom, publishZoom])

  const renderNodes = useMemo(
    () => nodes.map((node) => (node.id === settingsNodeId ? ({ ...node, zIndex: 1000 } as FreeCanvasNode) : node)),
    [nodes, settingsNodeId],
  )
  const renderEdges = useMemo(() => showEdges ? edges : edges.map(edge => ({ ...edge, hidden: true })), [edges, showEdges])

  const handleNodeClick: NodeMouseHandler<FreeCanvasNode> = (event, node) => {
    if ((event.target as Element).closest(INTERACTIVE_SELECTOR)) return
    if (node.type !== 'generation') {
      openSettings(null)
      return
    }
    const current = useCanvasStore.getState().settingsNodeId
    openSettings(current === node.id ? null : node.id, settingsPlacementFor(event.currentTarget))
  }

  const handleNodeContextMenu = (event: ReactMouseEvent, node: FreeCanvasNode) => {
    event.preventDefault()
    openContextMenu({ x: event.clientX, y: event.clientY, target: { type: 'node', nodeId: node.id } })
  }

  const handlePaneContextMenu = (event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault()
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      target: { type: 'pane', position: screenToFlowPosition({ x: event.clientX, y: event.clientY }) },
    })
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('application/x-free-canvas-asset')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const payload = readAssetDrag(event.dataTransfer)
    if (!payload) return
    event.preventDefault()
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const kind = payload.category === 'general' ? 'reference' : 'asset'
    insertNodes([createMediaNode(kind, position, payload.reference)], [], { select: true })
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return
      const store = useCanvasStore.getState()
      if (event.key === 'Escape') {
        store.closeOverlays()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.deleteSelection()
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
      } else if (key === 'y') {
        event.preventDefault()
        store.redo()
      } else if (key === 'd') {
        event.preventDefault()
        store.duplicateSelection()
      } else if (key === 'c' && store.nodes.some((node) => node.selected)) {
        store.copySelection()
      } else if (key === 'v' && store.clipboard) {
        event.preventDefault()
        store.pasteClipboard()
      } else if (key === 'g') {
        event.preventDefault()
        if (event.shiftKey) store.ungroupSelection()
        else store.groupSelection()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div ref={rootRef} data-oao-free-canvas className="absolute inset-0 bg-black" style={FLOW_THEME} onDragOver={handleDragOver} onDrop={handleDrop}>
      <style>{ATTRIBUTION_STYLE}</style>
      <ReactFlow
        aria-label="自由画布"
        nodes={renderNodes}
        edges={renderEdges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        defaultViewport={initialViewport}
        fitView={shouldFit}
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        snapToGrid={snapToGrid}
        snapGrid={[24, 24]}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        panOnScroll={false}
        zoomOnDoubleClick={false}
        connectionRadius={28}
        isValidConnection={(connection) => connection.source !== connection.target}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={connect}
        onInit={(instance) => publishZoom(instance.getZoom())}
        onMove={(_, viewport) => publishZoom(viewport.zoom)}
        onMoveEnd={(_, viewport) => commitViewport(viewport)}
        onNodeDragStart={() => beginEdit()}
        onSelectionDragStart={() => beginEdit()}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={() => closeOverlays()}
        onPaneContextMenu={handlePaneContextMenu}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(255,255,255,0.16)" />
        {miniMapOpen && <MiniMap<FreeCanvasNode>
          ariaLabel="画布小地图，可拖动定位或滚轮缩放"
          pannable
          zoomable
          position="bottom-left"
          className="overflow-hidden rounded-xl border border-white/20 shadow-xl"
          style={{ left: 12, bottom: hasSelection ? 216 : 72, margin: 0, width: 192, height: 120 }}
          bgColor="#111113"
          maskColor="rgba(0,0,0,0.52)"
          maskStrokeColor="rgba(255,255,255,0.65)"
          maskStrokeWidth={1.5}
          nodeBorderRadius={6}
          nodeColor={node => node.type === 'group' ? '#23252a' : node.selected ? '#dce4ef' : node.type === 'agent' ? '#91a2ba' : node.type === 'director' ? '#62c9d6' : '#69717f'}
          nodeStrokeColor={node => node.selected ? '#ffffff' : '#979faa'}
          onClick={(_, position) => void setCenter(position.x, position.y, { zoom: getZoom() })}
        />}
      </ReactFlow>
      {directorNodeId ? <DirectorDesk nodeId={directorNodeId} onClose={() => useCanvasStore.getState().setDirectorNodeId(null)} /> : null}
    </div>
  )
}
