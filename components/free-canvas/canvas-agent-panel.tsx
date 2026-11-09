'use client'

import { useEffect, useRef } from 'react'
import { Bot, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from './canvas-store'
import { CanvasAgentCard } from './nodes/agent-node'

export function CanvasAgentPanel() {
  const nodeId = useCanvasStore(state => state.agentPanelNodeId)
  const node = useCanvasStore(state => state.nodes.find(item => item.id === state.agentPanelNodeId))
  const docked = useCanvasStore(state => state.agentPanelDocked)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!nodeId) return
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [nodeId])
  if (!node || node.type !== 'agent') return null
  return <aside ref={ref} aria-label="画布助手面板" data-canvas-agent-panel className={cn('absolute inset-x-3 bottom-3 top-24 z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl sm:inset-x-auto sm:right-3 sm:top-20 sm:w-[388px]', docked && 'lg:bottom-3 lg:top-3')} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); useCanvasStore.getState().setAgentPanel(null) } }}>
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <Bot className="size-4 text-studio-accent" aria-hidden="true" /><h2 className="flex-1 text-sm font-medium">画布助手</h2>
      <button type="button" aria-label={docked ? '改为悬浮面板' : '固定到右侧'} title={docked ? '改为悬浮面板' : '固定到右侧'} aria-pressed={docked} onClick={() => useCanvasStore.getState().setAgentPanelDocked(!docked)} className="hidden size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground lg:flex">{docked ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}</button>
      <button type="button" aria-label="关闭画布助手" title="关闭画布助手" onClick={() => useCanvasStore.getState().setAgentPanel(null)} className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"><CanvasAgentCard id={node.id} data={node.data} panel /></div>
  </aside>
}
