'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { createLibraryAsset } from '@/lib/studio/account-api'
import { canvasSkillAssetInput, type CanvasSkillDraft } from '@/lib/studio/canvas-skills'
import { useStudio } from '@/lib/studio/store'
import { CanvasSkillEditor } from './canvas-skill-editor'
import type { SelectionSkillDraft } from './canvas-selection-skill'
import { useCanvasStore } from './canvas-store'

export type SelectionSkillSession = {
  selection: SelectionSkillDraft
  projectId: string
  projectMeta: Record<string, unknown>
  accountId: string
}

/** Selection is captured once on opening; subsequent canvas selection changes never rewrite a draft. */
export function CanvasSelectionSkillDialog({ session, onClose }: { session: SelectionSkillSession; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(false)
  const savingRef = useRef(false)
  const { state } = useStudio()
  const account = useRef(state.user.id)
  account.current = state.user.id
  const sameBoard = useCanvasStore((store) => store.hydrated && store.projectId === session.projectId && store.projectMeta === session.projectMeta)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const current = () => {
    const store = useCanvasStore.getState()
    return mounted.current && account.current === session.accountId && store.hydrated && store.projectId === session.projectId && store.projectMeta === session.projectMeta
  }

  useEffect(() => {
    mounted.current = true
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    return () => { mounted.current = false; element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => { if (!sameBoard || state.user.id !== session.accountId) onClose() }, [sameBoard, state.user.id, session.accountId, onClose])

  const save = async (draft: CanvasSkillDraft) => {
    if (savingRef.current || !current()) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      await createLibraryAsset(canvasSkillAssetInput(draft))
      if (!current()) return
      useCanvasStore.getState().setNotice('技能已保存到技能库，可以通过节点上的“选择技能”调用。')
      onClose()
    } catch (cause) {
      if (current()) setError(cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '技能保存失败，草稿已保留，请重试')
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!savingRef.current) onClose() }} aria-label="从选中节点创建技能" className="fixed inset-0 m-auto max-h-[90dvh] w-[min(800px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-border bg-background p-4 text-foreground shadow-2xl backdrop:bg-black/65 sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-base font-semibold">从画布整理创作技能</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">已选 {session.selection.nodeCount} 个节点 · {session.selection.stepCount} 个生成步骤 · {session.selection.connectionCount} 条内部关系。检查下方草稿后再保存，原画布保持不变。</p></div>
        <button type="button" aria-label="关闭技能草稿" disabled={saving} onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"><X className="size-4" aria-hidden="true" /></button>
      </header>
      {session.selection.warnings.length ? <aside aria-label="草稿整理说明" className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"><ul className="list-disc space-y-1 pl-4 text-xs leading-6">{session.selection.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></aside> : null}
      {error ? <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <CanvasSkillEditor initialDraft={session.selection.draft} saving={saving} onCancel={onClose} onSave={(draft) => void save(draft)} />
    </dialog>
  )
}
