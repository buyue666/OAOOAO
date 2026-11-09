'use client'

import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Plus } from 'lucide-react'
import { useCanvasActions } from './canvas-context'
import { CREATABLE_KINDS, NODE_META } from './node-factory'
import { nodePositionAtCenter } from './canvas-position'
import { useCanvasStore } from './canvas-store'

export function CanvasCreateMenu({ rail = false }: { rail?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const actions = useCanvasActions()
  const workspace = useCanvasStore(state => state.workspace)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false) }
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div ref={ref} className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }} onKeyDown={event => {
    if (!open) return
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  }}>
    <button ref={trigger} type="button" aria-label="添加节点" title="添加节点" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} className={rail ? 'flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring' : 'mr-1 flex h-11 items-center gap-1 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring'}><Plus className="size-4" aria-hidden="true" />{!rail && <span className="hidden sm:inline">添加</span>}</button>
    {open && <div role="menu" aria-label="添加画布节点" className={`absolute z-50 max-h-[calc(100dvh-12rem)] w-48 overflow-y-auto rounded-xl border border-border bg-card p-1.5 text-foreground shadow-2xl ${rail ? 'left-full top-0 ml-3' : 'top-11 left-0'}`}>
      {CREATABLE_KINDS.filter(kind => !workspace || kind !== 'agent').map(kind => {
        const { icon: Icon, label } = NODE_META[kind]
        return <button key={kind} type="button" role="menuitem" tabIndex={-1} onClick={() => { actions.createNodeAt(kind, nodePositionAtCenter(kind, screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))); setOpen(false); trigger.current?.focus() }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"><Icon className="size-4" aria-hidden="true" />{label}</button>
      })}
    </div>}
  </div>
}
