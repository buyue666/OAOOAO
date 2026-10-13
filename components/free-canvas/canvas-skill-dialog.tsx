'use client'

import { useEffect, useRef } from 'react'
import { toggleCanvasSkill } from '@/lib/studio/canvas-skills'
import { CanvasSkillLibrary } from './canvas-skill-library'
import { useCanvasStore } from './canvas-store'

export function CanvasSkillDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const node = useCanvasStore((store) => store.nodes.find((item) => item.id === nodeId))
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => { if (!node) onClose() }, [node, onClose])
  if (!node || (node.type !== 'agent' && node.type !== 'generation')) return null
  return (
    <dialog ref={dialog} onCancel={onClose} aria-label="选择技能" className="fixed inset-0 m-auto max-h-[85dvh] w-[min(640px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl backdrop:bg-black/65" onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}>
      <CanvasSkillLibrary selected={node.data.skills ?? []} onClose={onClose} onToggle={(skill) => {
        const store = useCanvasStore.getState()
        const current = store.nodes.find((item) => item.id === nodeId)
        if (!current || (current.type !== 'agent' && current.type !== 'generation')) return
        try { store.updateNodeData(nodeId, { skills: toggleCanvasSkill(current.data.skills ?? [], skill) }, { history: true }) }
        catch (error) { store.setNotice(error instanceof Error ? error.message : '无法选择技能') }
      }} />
    </dialog>
  )
}
