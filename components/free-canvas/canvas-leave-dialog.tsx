'use client'

import { useEffect, useRef, useState } from 'react'
import { flushCanvasSave } from './canvas-persistence'
import { useCanvasStore } from './canvas-store'

export function CanvasLeaveDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const previous = document.activeElement; const element = dialog.current; element?.showModal(); return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() } }, [])
  const save = async () => {
    if (busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      await flushCanvasSave()
      const current = useCanvasStore.getState()
      if (current.revision !== current.savedRevision) throw new Error(current.saveError || '画布仍有未保存的修改，请保留当前页面并重试。')
      onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
    finally { busy.current = false; setSaving(false) }
  }
  return <dialog ref={dialog} onCancel={(event) => { if (saving) event.preventDefault(); else onClose() }} aria-labelledby="canvas-leave-title" className="pointer-events-auto fixed inset-0 m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-neutral-900 p-6 text-white shadow-2xl backdrop:bg-black/70">
    <h2 id="canvas-leave-title" className="text-lg font-semibold">画布还有未保存的修改</h2>
    <p className="mt-3 text-sm leading-6 text-neutral-400">保存成功后返回，节点内容和连线会一起保留。</p>
    {error ? <p role="alert" className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-sm leading-6 text-amber-100">{error}</p> : null}
    <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-white/20 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-white disabled:opacity-45">继续编辑</button><button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-45">{saving ? '正在保存…' : '保存并返回'}</button></div>
  </dialog>
}
