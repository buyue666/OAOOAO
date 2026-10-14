'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The draft is committed once; typing never produces intermediate project names or undo entries. */
export function CanvasNameEditor({ value, onCommit, label, maxLength = 80, className, compact = false }: {
  value: string
  onCommit: (value: string) => void
  label: string
  maxLength?: number
  className?: string
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const active = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select() } }, [editing])

  const start = () => { active.current = true; setDraft(value); setEditing(true) }
  const finish = (cancel = false, restoreFocus = false) => {
    if (!active.current) return
    active.current = false
    const next = draft.trim().slice(0, maxLength)
    setEditing(false)
    if (!cancel && next && next !== value) onCommit(next)
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus())
  }

  if (!editing) return (
    <button ref={trigger} type="button" title={`重命名${label}（Enter / F2）`} aria-label={`重命名${label}：${value || '未命名'}`} onClick={start} onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); start() } }} className={cn('nodrag nopan group/name inline-flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-sm font-medium text-white transition-colors hover:border-white/15 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/60', className)}>
      <span className="min-w-0 flex-1 truncate">{value || '未命名画布'}</span>
      <Pencil aria-hidden="true" className={cn('size-3 shrink-0 text-neutral-500 transition-colors group-hover/name:text-neutral-300', compact && 'opacity-0 group-hover/name:opacity-100 group-focus-visible/name:opacity-100')} />
    </button>
  )

  return (
    <div data-canvas-name-editor className={cn('nodrag nopan nowheel flex min-w-0 items-center gap-0.5 rounded-lg border border-white/35 bg-white/[0.07] px-1 shadow-[0_0_0_3px_rgba(255,255,255,0.04)] focus-within:border-white/60', className)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) finish() }}>
      <input ref={input} aria-label={label} data-focus-managed value={draft} maxLength={maxLength} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); finish(false, true) }
        else if (event.key === 'Escape') { event.preventDefault(); finish(true, true) }
      }} className="h-8 w-full min-w-0 bg-transparent px-1 text-sm font-medium text-white" style={{ border: 0, outline: 'none', boxShadow: 'none' }} />
      <button type="button" aria-label={`确认${label}`} title="确认（Enter）" onClick={() => finish(false, true)} className="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"><Check className="size-3.5" aria-hidden="true" /></button>
      <button type="button" aria-label={`取消修改${label}`} title="取消（Esc）" onClick={() => finish(true, true)} className="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"><X className="size-3.5" aria-hidden="true" /></button>
    </div>
  )
}
