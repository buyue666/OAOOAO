'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasActions } from '../canvas-context'
import { useCanvasStore } from '../canvas-store'
import { CanvasNameEditor } from '../canvas-name-editor'
import { CREATABLE_KINDS, NODE_META, type CreatableKind } from '../node-factory'
import { DEFAULT_SETTINGS_PLACEMENT, HANDLE_IDS, type NodeSide, type SettingsPlacement } from '../types'

/** 节点在 React Flow 中会随画布缩放；浮层用反向缩放保持可读尺寸，并继续锚定在节点上。 */
export const COUNTER_SCALE = 'scale(calc(1 / var(--canvas-zoom, 1)))'

const SIDES: NodeSide[] = ['top', 'right', 'bottom', 'left']
const MENU_WIDTH = 224
const SETTINGS_WIDTH = 320

const SIDE_LABEL: Record<NodeSide, string> = { top: '上方', right: '右侧', bottom: '下方', left: '左侧' }

const ANCHOR_POSITION: Record<NodeSide, CSSProperties> = {
  top: { left: '50%', top: 0 },
  right: { left: '100%', top: '50%' },
  bottom: { left: '50%', top: '100%' },
  left: { left: 0, top: '50%' },
}

const MENU_POSITION: Record<NodeSide, CSSProperties> = {
  top: { left: -MENU_WIDTH / 2, bottom: 26 },
  right: { left: 26, top: -12 },
  bottom: { left: -MENU_WIDTH / 2, top: 26 },
  left: { right: 26, top: -12 },
}

const MENU_ORIGIN: Record<NodeSide, string> = {
  top: 'bottom center',
  right: 'top left',
  bottom: 'top center',
  left: 'top right',
}

const HANDLE_STYLE: CSSProperties = { width: 12, height: 12, background: '#cbd0d8', border: '3px solid #15171b', zIndex: 10 }

export function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.inLeft} title="输入连接" aria-label="左侧输入连接" className="opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Top} id={HANDLE_IDS.inTop} title="输入连接" aria-label="上方输入连接" className="opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id={HANDLE_IDS.outRight} title="拖动连接到下游节点" aria-label="右侧输出连接" className="opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id={HANDLE_IDS.outBottom} title="拖动连接到下游节点" aria-label="下方输出连接" className="opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" style={HANDLE_STYLE} />
    </>
  )
}

export function NodeAnchors({ nodeId }: { nodeId: string }) {
  return (
    <>
      {SIDES.map((side) => (
        <NodeAnchor key={side} nodeId={nodeId} side={side} />
      ))}
    </>
  )
}

function NodeAnchor({ nodeId, side }: { nodeId: string; side: NodeSide }) {
  const open = useCanvasStore((state) => state.typeMenu?.nodeId === nodeId && state.typeMenu.side === side)
  const openTypeMenu = useCanvasStore((state) => state.openTypeMenu)
  const { createNodeNear } = useCanvasActions()

  const pick = (kind: CreatableKind) => {
    openTypeMenu(null)
    createNodeNear(nodeId, side, kind)
  }

  return (
    <div className="nodrag nopan" style={{ position: 'absolute', width: 0, height: 0, ...ANCHOR_POSITION[side] }}>
      <button
        type="button"
        aria-label={`在${SIDE_LABEL[side]}添加节点`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          openTypeMenu(open ? null : { nodeId, side })
        }}
        className={cn(
          'absolute flex size-6 items-center justify-center rounded-full border border-white/30 bg-neutral-950 text-white transition-opacity duration-150 hover:bg-white hover:text-black focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100',
        )}
        style={{ left: side === 'right' ? 14 : side === 'left' ? -38 : -12, top: side === 'bottom' ? 14 : side === 'top' ? -38 : -12, transform: COUNTER_SCALE }}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
      {open ? <NodeTypeMenu side={side} onPick={pick} /> : null}
    </div>
  )
}

function NodeTypeMenu({ side, onPick }: { side: NodeSide; onPick: (kind: CreatableKind) => void }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [])
  return (
    <div
      ref={root}
      role="menu"
      aria-label="选择节点类型"
      className="nowheel nodrag rounded-2xl border border-white/15 bg-neutral-950 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
      style={{ position: 'absolute', width: MENU_WIDTH, transform: COUNTER_SCALE, transformOrigin: MENU_ORIGIN[side], ...MENU_POSITION[side] }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); useCanvasStore.getState().openTypeMenu(null); return }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[index]?.focus()
      }}
    >
      {CREATABLE_KINDS.map((kind) => {
        const meta = NODE_META[kind]
        const Icon = meta.icon
        return (
          <button
            key={kind}
            type="button"
            role="menuitem"
            onClick={() => onPick(kind)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-white transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
          >
            <Icon className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}

export function TitleEditor({ nodeId, title, className }: { nodeId: string; title: string; className?: string }) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  return <CanvasNameEditor key={nodeId} value={title} label="节点名称" maxLength={60} compact className={className} onCommit={(next) => updateNodeData(nodeId, { title: next }, { history: true })} />
}

/** 节点靠近视口右侧时，配置浮层改为向左展开，避免被裁切。 */
const SETTINGS_OVERLAY_GAP = 16
const SETTINGS_OVERLAY_MAX_HEIGHT = 460
const SETTINGS_VIEWPORT_MARGIN = 16
/** 画布顶部与底部的工具条占用的高度，浮层不能压住它们。 */
const SETTINGS_VIEWPORT_CHROME = 72

/**
 * 配置浮层默认与节点顶部对齐。两侧都按真实矩形计算与其他节点的重叠面积（超出视口的部分同样计入），
 * 选择遮挡更少的一侧，并把浮层平移回 React Flow 视口内，偏移量换算为节点本地坐标。
 */
export function settingsPlacementFor(element: Element | null): SettingsPlacement {
  const node = element?.closest('.react-flow__node')
  const flow = element?.closest('.react-flow')
  if (!node || !flow) return DEFAULT_SETTINGS_PLACEMENT
  const anchor = node.getBoundingClientRect()
  const viewport = flow.getBoundingClientRect()
  const others = [...flow.querySelectorAll('.react-flow__node')]
    .filter((item) => item !== node)
    .map((item) => item.getBoundingClientRect())
  const height = Math.min(SETTINGS_OVERLAY_MAX_HEIGHT, window.innerHeight * 0.7)

  const costOf = (left: number) => {
    const right = left + SETTINGS_WIDTH
    const bottom = anchor.top + height
    const overlapArea = others.reduce((total, other) => {
      const width = Math.min(right, other.right) - Math.max(left, other.left)
      const areaHeight = Math.min(bottom, other.bottom) - Math.max(anchor.top, other.top)
      return width > 0 && areaHeight > 0 ? total + width * areaHeight : total
    }, 0)
    const outsideWidth = Math.max(0, right - viewport.right) + Math.max(0, viewport.left - left)
    return overlapArea + outsideWidth * height
  }

  const rightLeft = anchor.right + SETTINGS_OVERLAY_GAP
  const leftLeft = anchor.left - SETTINGS_OVERLAY_GAP - SETTINGS_WIDTH
  const side = costOf(leftLeft) < costOf(rightLeft) ? 'left' : 'right'
  const anchoredLeft = side === 'left' ? leftLeft : rightLeft
  const clampedLeft = keepWithin(anchoredLeft, viewport.left + SETTINGS_VIEWPORT_MARGIN, viewport.right - SETTINGS_VIEWPORT_MARGIN - SETTINGS_WIDTH)
  const clampedTop = keepWithin(anchor.top, viewport.top + SETTINGS_VIEWPORT_CHROME, viewport.bottom - SETTINGS_VIEWPORT_CHROME - height)
  const zoom = node instanceof HTMLElement && node.offsetWidth ? anchor.width / node.offsetWidth : 1
  return { side, offset: { x: (clampedLeft - anchoredLeft) / zoom, y: (clampedTop - anchor.top) / zoom } }
}

/** 数值限制在 [min, max] 内；区间反向（视口比浮层还小）时优先保证起始边可见。 */
function keepWithin(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

export const SETTINGS_POPOVER_WIDTH = SETTINGS_WIDTH
