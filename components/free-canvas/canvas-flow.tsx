'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Background, BackgroundVariant, MiniMap, ReactFlow, SelectionMode, useReactFlow, type NodeMouseHandler, type Viewport } from '@xyflow/react'
import { readAssetDrag } from './asset-reference'
import { useCanvasStore } from './canvas-store'
import { createMediaNode } from './node-factory'
import { AgentNode } from './nodes/agent-node'
import { GenerationNode } from './nodes/generation-node'
import { GroupNode } from './nodes/group-node'
import { MediaNode } from './nodes/media-node'
import { DirectorNode } from './nodes/director-node'
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
  style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.4 },
}

/** Keep the canvas in the same theme as the workbench. */
const FLOW_THEME = {
  '--xy-background-color': 'var(--background)',
  '--xy-node-background-color': 'var(--card)',
  '--xy-node-border': '1px solid var(--border)',
  '--xy-node-color': 'var(--foreground)',
  '--xy-selection-background-color': 'color-mix(in oklab, var(--primary) 8%, transparent)',
  '--xy-selection-border': '1px dashed var(--primary)',
  '--xy-edge-stroke': 'var(--muted-foreground)',
  '--xy-edge-stroke-selected': 'var(--primary)',
  '--xy-handle-background-color': 'var(--primary)',
  '--xy-controls-button-background-color': 'var(--card)',
  '--xy-controls-button-color': 'var(--foreground)',
  '--xy-attribution-background-color': 'transparent',
} as CSSProperties

const INTERACTIVE_SELECTOR = 'textarea,input,select,button,a,label,video,audio'
function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input,textarea,select,button,a,[role="menu"],dialog[open],[role="dialog"],[data-canvas-name-editor]')))
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
  const tool = useCanvasStore(state => state.tool)
  const [spacePan, setSpacePan] = useState(false)
  const readOnly = useCanvasStore(state => state.workspace?.readOnly ?? false)
  const edges = useCanvasStore((state) => state.edges)
  const miniMapOpen = useCanvasStore((state) => state.miniMapOpen)
  const snapToGrid = useCanvasStore((state) => state.snapToGrid)
  const showEdges = useCanvasStore((state) => state.showEdges)
  const directorNodeId = useCanvasStore((state) => state.directorNodeId)
  const hasSelection = useCanvasStore((state) => state.nodes.some(node => node.selected))
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

  const renderEdges = useMemo(() => showEdges ? edges : edges.map(edge => ({ ...edge, hidden: true })), [edges, showEdges])

  const handleNodeClick: NodeMouseHandler<FreeCanvasNode> = (event, node) => {
    if (tool === 'pan' || spacePan) return
    if ((event.target as Element).closest(INTERACTIVE_SELECTOR)) return
    if (node.type !== 'generation') {
      openSettings(null)
      return
    }
    const current = useCanvasStore.getState().settingsNodeId
    openSettings(current === node.id ? null : node.id)
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
    if (readOnly || useCanvasStore.getState().workspace) return
    const payload = readAssetDrag(event.dataTransfer)
    if (!payload) return
    event.preventDefault()
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const kind = payload.category === 'general' ? 'reference' : 'asset'
    insertNodes([createMediaNode(kind, position, payload.reference)], [], { select: true })
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open],[data-director-desk]')) return
      const store = useCanvasStore.getState()
      const toolbar = event.target instanceof HTMLElement && event.target.closest('[role="toolbar"]') && !event.target.closest('input,textarea,select')
      if ((!isEditableTarget(event.target) || toolbar) && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (event.code === 'KeyV') { event.preventDefault(); store.setTool('select'); return }
        if (event.code === 'KeyH') { event.preventDefault(); store.setTool('pan'); return }
      }
      if (isEditableTarget(event.target)) return
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
    const holdPan = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.closest('.oao-free-canvas') || target.isContentEditable || target.closest('textarea,input:not([type="checkbox"]):not([type="radio"]),[contenteditable="true"],dialog,[role="dialog"],[data-director-desk]')) return
      event.preventDefault()
      setSpacePan(true)
    }
    window.addEventListener('keydown', holdPan, true)
    const releasePan = (event: KeyboardEvent) => { if (event.code === 'Space') setSpacePan(false) }
    const blur = () => setSpacePan(false)
    window.addEventListener('keyup', releasePan)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', holdPan, true); window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', releasePan); window.removeEventListener('blur', blur) }
  }, [])

  return (
    <div ref={rootRef} data-oao-free-canvas data-canvas-tool={spacePan ? 'pan' : tool} className="absolute inset-0 bg-background" style={FLOW_THEME} onDragOver={handleDragOver} onDrop={handleDrop}>
      <ReactFlow
        aria-label="自由画布"
        nodes={nodes}
        edges={renderEdges}
        nodeTypes={nodeTypes}
        onlyRenderVisibleElements={nodes.length >= 40}
        nodesDraggable={!readOnly && tool === 'select' && !spacePan}
        elementsSelectable={tool === 'select' && !spacePan}
        nodesConnectable={!readOnly && tool === 'select' && !spacePan}
        edgesReconnectable={!readOnly}
        defaultEdgeOptions={defaultEdgeOptions}
        // The canvas shell is branded and the attribution is not part of the
        // product chrome. React Flow is retained as a dependency and its MIT
        // license remains documented in THIRD_PARTY_DEPENDENCY_NOTICES.txt.
        proOptions={{ hideAttribution: true }}
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
        selectionOnDrag={tool === 'select' && !spacePan}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={tool === 'select' && !spacePan}
        panOnDrag={tool === 'pan' || spacePan ? true : [1]}
        panActivationKeyCode="Space"
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
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--border)" />
        {miniMapOpen && <MiniMap<FreeCanvasNode>
          ariaLabel="画布小地图，可拖动定位或滚轮缩放"
          pannable
          zoomable
          position="bottom-left"
          className="overflow-hidden rounded-xl border border-border shadow-xl"
          style={{ left: 12, bottom: hasSelection ? 216 : 72, margin: 0, width: 192, height: 120 }}
          bgColor="var(--card)"
          maskColor="color-mix(in srgb, var(--background) 75%, transparent)"
          maskStrokeColor="var(--muted-foreground)"
          maskStrokeWidth={1.5}
          nodeBorderRadius={6}
          nodeColor={node => node.selected ? 'var(--primary)' : 'var(--muted-foreground)'}
          nodeStrokeColor={() => 'var(--border)'}
          onClick={(_, position) => void setCenter(position.x, position.y, { zoom: getZoom() })}
        />}
      </ReactFlow>
      {directorNodeId ? <DirectorDesk nodeId={directorNodeId} onClose={() => useCanvasStore.getState().setDirectorNodeId(null)} /> : null}
    </div>
  )
}
