'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { Focus, Keyboard, LayoutGrid, Map, Maximize2, Minus, Plus, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from './canvas-store'
import { CanvasViewToggle } from './canvas-controls'

export const CANVAS_MIN_ZOOM = 0.2
export const CANVAS_MAX_ZOOM = 5

function motionDuration() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 }

export function CanvasNavigationDock() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])
  const nodeCount = useCanvasStore((state) => state.nodes.length)
  const readOnly = useCanvasStore(state => state.workspace?.readOnly ?? false)
  const hasSelection = useCanvasStore((state) => state.nodes.some(node => node.selected))
  const miniMapOpen = useCanvasStore((state) => state.miniMapOpen)
  const setMiniMapOpen = useCanvasStore((state) => state.setMiniMapOpen)
  const snapToGrid = useCanvasStore((state) => state.snapToGrid)
  const showEdges = useCanvasStore((state) => state.showEdges)
  const setSnapToGrid = useCanvasStore((state) => state.setSnapToGrid)
  const setShowEdges = useCanvasStore((state) => state.setShowEdges)
  const [helpOpen, setHelpOpen] = useState(false)
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const viewMenuRef = useRef<HTMLDivElement>(null)
  const zoomTrigger = useRef<HTMLButtonElement>(null)
  const viewTrigger = useRef<HTMLButtonElement>(null)
  const arrangeFrame = useRef<number | null>(null)
  useEffect(() => () => { if (arrangeFrame.current !== null) window.cancelAnimationFrame(arrangeFrame.current) }, [])
  const fitAll = useCallback(() => { if (useCanvasStore.getState().nodes.length) void fitView({ padding: 0.22, minZoom: CANVAS_MIN_ZOOM, maxZoom: 1, duration: motionDuration() }) }, [fitView])
  const fitSelected = useCallback(() => {
    const selected = useCanvasStore.getState().nodes.filter(node => node.selected)
    if (selected.length) void fitView({ nodes: selected.map(node => ({ id: node.id })), padding: 0.35, minZoom: CANVAS_MIN_ZOOM, maxZoom: 1, duration: motionDuration() })
  }, [fitView])
  const arrange = useCallback(() => {
    const state = useCanvasStore.getState()
    if (!state.arrangeLayout()) return
    if (arrangeFrame.current !== null) window.cancelAnimationFrame(arrangeFrame.current)
    arrangeFrame.current = window.requestAnimationFrame(() => {
      arrangeFrame.current = null
      if (useCanvasStore.getState().projectId === state.projectId) fitAll()
    })
  }, [fitAll])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,button,a,[role="menu"],dialog[open],[role="dialog"],[data-canvas-name-editor]')))) return
      if (event.altKey && event.shiftKey && event.code === 'KeyF') { event.preventDefault(); arrange(); return }
      if (event.altKey) return
      if (event.code === 'Digit1' && event.shiftKey) { event.preventDefault(); fitAll() }
      else if (event.code === 'Digit2' && event.shiftKey) { event.preventDefault(); fitSelected() }
      else if (event.code === 'Digit0' && event.shiftKey) { event.preventDefault(); void zoomTo(1, { duration: motionDuration() }) }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); void zoomIn({ duration: motionDuration() }) }
      else if (event.key === '-') { event.preventDefault(); void zoomOut({ duration: motionDuration() }) }
      else if (event.key.toLowerCase() === 'm') { event.preventDefault(); const state = useCanvasStore.getState(); state.setMiniMapOpen(!state.miniMapOpen) }
      else if (event.key === '?') { event.preventDefault(); setHelpOpen(true) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [arrange, fitAll, fitSelected, zoomIn, zoomOut, zoomTo])

  useEffect(() => {
    if (!zoomMenuOpen && !viewMenuOpen) return
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (!menuRef.current?.contains(event.target)) setZoomMenuOpen(false)
      if (!viewMenuRef.current?.contains(event.target)) setViewMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menuRef.current?.contains(document.activeElement)) zoomTrigger.current?.focus()
      else if (viewMenuRef.current?.contains(document.activeElement)) viewTrigger.current?.focus()
      setZoomMenuOpen(false)
      setViewMenuOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [zoomMenuOpen, viewMenuOpen])

  return <>
    <div role="toolbar" aria-label="画布导航" className="pointer-events-auto absolute bottom-3 left-3 z-[45] flex max-w-[calc(100%-1.5rem)] flex-wrap items-center rounded-2xl border border-border bg-card/95 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,.3)] backdrop-blur-md sm:flex-nowrap sm:gap-0.5">
      <DockButton label="缩小（−）" disabled={zoom <= CANVAS_MIN_ZOOM + .001} onClick={() => void zoomOut({ duration: motionDuration() })}><Minus className="size-4" /></DockButton>
      <div ref={menuRef} className="relative">
        <button ref={zoomTrigger} type="button" aria-label={`缩放比例 ${Math.round(zoom * 100)}%，选择缩放比例`} aria-expanded={zoomMenuOpen} aria-controls="canvas-zoom-options" onClick={() => { setZoomMenuOpen(open => !open); setViewMenuOpen(false) }} className="h-7 min-w-10 rounded-lg px-1 text-center text-xs tabular-nums text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:h-11 sm:min-w-12">{Math.round(zoom * 100)}%</button>
        {zoomMenuOpen && <div id="canvas-zoom-options" className="absolute bottom-11 left-0 min-w-36 rounded-xl border border-border bg-popover p-1.5 shadow-xl" aria-label="缩放比例选项">
          {[25, 50, 75, 100, 150, 200, 300, 500].map(percent => <button key={percent} type="button" aria-pressed={Math.round(zoom * 100) === percent} onClick={() => { void zoomTo(percent / 100, { duration: motionDuration() }); setZoomMenuOpen(false); zoomTrigger.current?.focus() }} className="flex h-11 w-full items-center justify-between rounded-lg px-3 text-left text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><span>{percent}%</span>{percent === 100 && <span className="text-muted-foreground">原始尺寸</span>}</button>)}
        </div>}
      </div>
      <DockButton label="放大（+）" disabled={zoom >= CANVAS_MAX_ZOOM - .001} onClick={() => void zoomIn({ duration: motionDuration() })}><Plus className="size-4" /></DockButton>
      <span className="mx-0.5 h-4 w-px bg-muted sm:mx-1" aria-hidden="true" />
      <DockButton label="适应整个画布（Shift + 1）" disabled={!nodeCount} onClick={fitAll}><Maximize2 className="size-4" /></DockButton>
      <DockButton label="定位选中节点（Shift + 2）" disabled={!hasSelection} onClick={fitSelected}><Focus className="size-4" /></DockButton>
      <DockButton label="整理画布，可撤销（Alt + Shift + F）" disabled={readOnly || nodeCount < 2} onClick={arrange}><LayoutGrid className="size-4" /></DockButton>
      <span className="mx-0.5 h-4 w-px bg-muted sm:mx-1" aria-hidden="true" />
      <DockButton label="小地图：拖动定位、滚轮缩放（M）" pressed={miniMapOpen} onClick={() => setMiniMapOpen(!miniMapOpen)}><Map className="size-4" /></DockButton>
      <div ref={viewMenuRef} className="static sm:relative">
        <button ref={viewTrigger} type="button" aria-label="画布视图设置" title="画布视图设置" aria-expanded={viewMenuOpen} aria-controls="canvas-view-options" onClick={() => { setViewMenuOpen(open => !open); setZoomMenuOpen(false) }} className="flex size-7 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:size-11"><SlidersHorizontal className="size-4" aria-hidden="true" /></button>
        {viewMenuOpen && <div id="canvas-view-options" className="absolute bottom-full left-0 mb-2 max-h-[60dvh] w-52 max-w-full overflow-y-auto rounded-xl border border-border bg-popover p-3 text-xs text-foreground shadow-xl sm:bottom-11 sm:left-auto sm:right-0 sm:mb-0 sm:max-w-none">
          <p className="mb-3 text-[11px] text-muted-foreground">当前画布视图</p>
          <CanvasViewToggle label="显示节点连线" checked={showEdges} onChange={setShowEdges} />
          <CanvasViewToggle label="拖动时吸附网格" checked={snapToGrid} onChange={setSnapToGrid} />
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">隐藏连线不影响节点间的输入引用。吸附间距为 24 px。</p>
        </div>}
      </div>
      <DockButton label="快捷键帮助（?）" onClick={() => setHelpOpen(true)}><Keyboard className="size-4" /></DockButton>
    </div>
    {helpOpen && <CanvasShortcutsDialog onClose={() => setHelpOpen(false)} />}
  </>
}

function DockButton({ label, children, onClick, disabled, pressed }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} aria-pressed={pressed} onClick={onClick} className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-30 sm:size-11', pressed && 'bg-muted text-foreground')}><span aria-hidden="true">{children}</span></button>
}

const shortcuts = [
  ['选择 / 抓手', 'V / H'], ['临时平移', '按住空格拖动 / 鼠标中键'], ['框选多个节点', '选择工具下拖动空白处'], ['追加选择', 'Ctrl/⌘ + 点击'], ['放大 / 缩小', '+ / − 或滚轮'],
  ['打开 / 收起画布助手', 'Ctrl/⌘ + /'],
  ['适应全部 / 定位选中', 'Shift + 1 / Shift + 2'], ['恢复 100%', 'Shift + 0'], ['切换小地图', 'M'],
  ['整理画布', 'Alt + Shift + F'],
  ['撤销 / 重做', 'Ctrl/⌘ + Z / Shift + Z'], ['复制 / 粘贴', 'Ctrl/⌘ + C / V'], ['创建副本', 'Ctrl/⌘ + D'],
  ['分组 / 解组', 'Ctrl/⌘ + G / Shift + G'], ['删除选中', 'Delete / Backspace'], ['关闭面板', 'Esc'],
]

function CanvasShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="canvas-shortcuts-title" className="pointer-events-auto fixed inset-0 m-auto max-h-[85dvh] w-[min(500px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-background/65">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 id="canvas-shortcuts-title" className="flex items-center gap-2 text-base font-semibold"><Keyboard className="size-4" aria-hidden="true" />画布快捷键</h2><DockButton label="关闭快捷键帮助" onClick={onClose}><X className="size-4" /></DockButton></div>
    <dl className="space-y-3">{shortcuts.map(([label, keys]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2 text-xs"><dt className="text-foreground">{label}</dt><dd><kbd className="rounded-md bg-muted px-2 py-1 font-sans text-[11px] text-muted-foreground">{keys}</kbd></dd></div>)}</dl>
    <p className="mt-5 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">编辑名称或提示词时，快捷键优先用于文字编辑。整理画布只调整位置，保留分组、连线与所有内容，可以撤销。</p>
    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">画布交互组件由 <a href="https://reactflow.dev" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">React Flow</a> 提供。</p>
  </dialog>
}
