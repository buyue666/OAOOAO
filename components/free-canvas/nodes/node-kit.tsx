'use client'

import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasActions } from '../canvas-context'
import { useCanvasStore } from '../canvas-store'
import { CREATABLE_KINDS, NODE_META, type CreatableKind } from '../node-factory'
import { HANDLE_IDS, type NodeSide } from '../types'

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

const HANDLE_STYLE: CSSProperties = { width: 10, height: 10, background: '#fafafa', border: '2px solid #050505' }

export function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.inLeft} className="opacity-40 transition-opacity group-hover:opacity-100" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Top} id={HANDLE_IDS.inTop} className="opacity-40 transition-opacity group-hover:opacity-100" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id={HANDLE_IDS.outRight} className="opacity-40 transition-opacity group-hover:opacity-100" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id={HANDLE_IDS.outBottom} className="opacity-40 transition-opacity group-hover:opacity-100" style={HANDLE_STYLE} />
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
        style={{ left: -12, top: -12, transform: COUNTER_SCALE }}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
      {open ? <NodeTypeMenu side={side} onPick={pick} /> : null}
    </div>
  )
}

function NodeTypeMenu({ side, onPick }: { side: NodeSide; onPick: (kind: CreatableKind) => void }) {
  return (
    <div
      role="menu"
      aria-label="选择节点类型"
      className="nowheel nodrag rounded-2xl border border-white/15 bg-neutral-950 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
      style={{ position: 'absolute', width: MENU_WIDTH, transform: COUNTER_SCALE, transformOrigin: MENU_ORIGIN[side], ...MENU_POSITION[side] }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== title) updateNodeData(nodeId, { title: next }, { history: true })
  }

  if (!editing) {
    return (
      <button
        type="button"
        title="双击重命名"
        onDoubleClick={() => {
          setDraft(title)
          setEditing(true)
        }}
        className={cn('min-w-0 truncate text-left text-sm font-medium text-white', className)}
      >
        {title}
      </button>
    )
  }

  return (
    <input
      autoFocus
      aria-label="节点名称"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setEditing(false)
      }}
      className={cn('nodrag nowheel min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none', className)}
      maxLength={60}
    />
  )
}

/** 节点靠近视口右侧时，配置浮层改为向左展开，避免被裁切。 */
export function settingsSideFor(element: Element | null): 'left' | 'right' {
  const node = element?.closest('.react-flow__node')
  const flow = element?.closest('.react-flow')
  if (!node || !flow) return 'right'
  return node.getBoundingClientRect().right + SETTINGS_WIDTH + 16 > flow.getBoundingClientRect().right ? 'left' : 'right'
}

export const SETTINGS_POPOVER_WIDTH = SETTINGS_WIDTH
