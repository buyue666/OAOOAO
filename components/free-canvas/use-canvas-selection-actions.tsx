'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createLibraryAsset } from '@/lib/studio/account-api'
import { getSession } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { useCanvasStore } from './canvas-store'
import { absoluteNodePositions, selectionNodes } from './canvas-selection'
import { createAgentNode, sizeOf } from './node-factory'
import { safeSelectionMediaUrl, saveSelectionBatch, selectionAgentPrompt, selectionDocument, selectionResults, type SelectionReceipt, type SelectionResult } from './canvas-selection-actions'

const BUTTON = 'rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45'
const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring'
const labels: Record<SelectionResult['status'], string> = { pending: '待保存', saving: '保存中…', saved: '已保存', failed: '未保存', unknown: '待核对' }
const kinds = { image: '图片', video: '视频', audio: '音频', text: '文本' }
type Scope = { owner: string; projectId: string; projectMeta: Record<string, unknown>; epoch: number }
type ResultDialog = { type: 'results'; scope: Scope; rows: SelectionResult[]; checked: string[]; loading: boolean; error: string }
type DraftDialog = { type: 'agent'; scope: Scope; prompt: string; title: string; position: { x: number; y: number }; error: string }
type ActionDialog = ResultDialog | DraftDialog

async function resultKey(owner: string, projectId: string, result: SelectionResult) {
  const input = new TextEncoder().encode(JSON.stringify([owner, projectId, result.kind, result.url ?? result.text]))
  const hash = await crypto.subtle.digest('SHA-256', input)
  return `oaooao-selection-save-v1:${Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')}`
}

function receipt(key: string, value?: SelectionReceipt | null): SelectionReceipt | null {
  try {
    if (value === null) { window.localStorage.removeItem(key); return null }
    if (value) { window.localStorage.setItem(key, JSON.stringify(value)); return value }
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    // Corrupt receipts are uncertain writes, never permission to duplicate POST.
    return data?.status === 'saved' ? { status: 'saved', assetId: data.assetId } : { status: 'unknown' }
  } catch { throw new Error('浏览器暂时无法保留保存记录。请检查存储权限后重试，当前未继续提交。') }
}

function SelectionDialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} aria-label={title} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="fixed inset-0 m-auto max-h-[88dvh] w-[min(760px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl backdrop:bg-black/65">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><button type="button" className={BUTTON} disabled={busy} onClick={onClose} aria-label="关闭选区操作">关闭</button></div>{children}
  </dialog>
}

export function useCanvasSelectionActions() {
  const { state: studio } = useStudio()
  const projectId = useCanvasStore(store => store.projectId)
  const projectMeta = useCanvasStore(store => store.projectMeta)
  const [dialog, setDialog] = useState<ActionDialog | null>(null)
  const [busy, setBusy] = useState(false)
  const owner = useRef(studio.user.id), epoch = useRef(0), mounted = useRef(true), submitting = useRef(false)
  const consumedDrafts = useRef(new WeakSet<Scope>())
  if (owner.current !== studio.user.id) { owner.current = studio.user.id; epoch.current++ }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++ } }, [])
  useEffect(() => { setDialog(null) }, [projectId, projectMeta, studio.user.id])
  const current = useCallback((scope: Scope) => {
    const store = useCanvasStore.getState()
    return mounted.current && owner.current === scope.owner && epoch.current === scope.epoch && store.hydrated && store.projectId === scope.projectId && store.projectMeta === scope.projectMeta
  }, [])
  const scopeOf = useCallback((): Scope | null => {
    const store = useCanvasStore.getState()
    if (!owner.current || !store.hydrated || !store.projectId) { store.setNotice('请登录并等待画布加载完成。'); return null }
    return { owner: owner.current, projectId: store.projectId, projectMeta: store.projectMeta, epoch: epoch.current }
  }, [])

  const saveSelectionResults = useCallback((nodeIds?: readonly string[]) => {
    if (submitting.current) return
    const scope = scopeOf()
    if (!scope) return
    const rows = selectionResults(useCanvasStore.getState().nodes, nodeIds)
    const draft: ResultDialog = { type: 'results', scope, rows, checked: [], loading: true, error: '' }
    setDialog(draft)
    void (async () => {
      try {
        const prepared = await Promise.all(rows.map(async row => {
          if (row.skipped) return row
          const key = await resultKey(scope.owner, scope.projectId, row)
          return { ...row, key, status: receipt(key)?.status ?? 'pending' } as SelectionResult
        }))
        if (current(scope)) setDialog(existing => existing === draft ? { ...draft, loading: false, rows: prepared, checked: prepared.filter(row => !row.skipped && row.status === 'pending').map(row => row.id) } : existing)
      } catch (error) {
        if (current(scope)) setDialog(existing => existing === draft ? { ...draft, loading: false, error: error instanceof Error ? error.message : '无法准备结果列表' } : existing)
      }
    })()
  }, [current, scopeOf])

  const draftAgentFromSelection = useCallback((nodeIds?: readonly string[]) => {
    if (submitting.current) return
    const scope = scopeOf(), store = useCanvasStore.getState(), selected = selectionNodes(store.nodes, nodeIds)
    if (!scope) return
    if (!selected.length) { store.setNotice('请先选择要交给 Agent 的节点。'); return }
    const positions = absoluteNodePositions(store.nodes)
    const position = { x: Math.max(...selected.map(node => positions.get(node.id)!.x + sizeOf(node).width)) + 80, y: Math.min(...selected.map(node => positions.get(node.id)!.y)) }
    setDialog({ type: 'agent', scope, position, title: '选区创作任务', prompt: selectionAgentPrompt(store.nodes, store.edges, nodeIds), error: '' })
  }, [scopeOf])

  const exportSelection = useCallback((nodeIds?: readonly string[]) => {
    const scope = scopeOf(), store = useCanvasStore.getState()
    if (!scope) return
    const payload = selectionDocument(store.nodes, store.edges, nodeIds)
    if (!payload.nodes.length) { store.setNotice('请先选择要导出的节点。'); return }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'OAOOAO-选区.json'; document.body.appendChild(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    store.setNotice('已导出选区 JSON：包含创作文本与结构，不含媒体文件、地址和运行记录。')
  }, [scopeOf])

  const save = async () => {
    if (submitting.current || dialog?.type !== 'results' || dialog.loading || !current(dialog.scope)) return
    const draft = dialog
    submitting.current = true; setBusy(true)
    try {
      await saveSelectionBatch(draft.rows.filter(row => draft.checked.includes(row.id)), {
        current: () => current(draft.scope), verifyOwner: async () => (await getSession()).user?.id === draft.scope.owner,
        create: createLibraryAsset, receipt,
        lock: (key, action) => navigator.locks ? navigator.locks.request(key, action) : action(),
        update: (id, patch) => { if (current(draft.scope)) setDialog(existing => existing?.type === 'results' && existing.scope === draft.scope ? { ...existing, rows: existing.rows.map(row => row.id === id ? { ...row, ...patch } : row) } : existing) },
      })
    } catch (error) {
      if (current(draft.scope)) setDialog(existing => existing?.type === 'results' && existing.scope === draft.scope ? { ...existing, error: error instanceof Error ? error.message : '保存已中断，请核对各项状态。' } : existing)
    } finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  const createDraft = () => {
    if (submitting.current || dialog?.type !== 'agent' || !current(dialog.scope) || consumedDrafts.current.has(dialog.scope)) return
    if (!dialog.prompt.trim() || dialog.prompt.length > 16000 || !dialog.title.trim()) { setDialog({ ...dialog, error: '请填写名称和任务内容；内容最多 16000 字符，请精简后创建。' }); return }
    submitting.current = true
    consumedDrafts.current.add(dialog.scope)
    try {
      const node = createAgentNode(dialog.position)
      node.data = { ...node.data, title: dialog.title.trim(), prompt: dialog.prompt.trim() }
      useCanvasStore.getState().insertNodes([node], [], { select: true, focus: true })
      setDialog(null); useCanvasStore.getState().setNotice('已新建 Agent 任务草稿。检查后点击运行；运行仍会结合整个画布。')
    } finally { submitting.current = false }
  }
  const visible = dialog && current(dialog.scope) ? dialog : null
  const readyCount = visible?.type === 'results' ? visible.rows.filter(row => visible.checked.includes(row.id) && !row.skipped && row.key && ['pending', 'failed'].includes(row.status)).length : 0
  const close = () => { if (!submitting.current) setDialog(null) }
  const dialogs: ReactNode = visible ? <SelectionDialog title={visible.type === 'results' ? '将选区结果保存到资产库' : '从选区创建 Agent 任务草稿'} busy={busy} onClose={close}>
    {visible.type === 'results' ? <>
      <p className="mb-4 text-xs leading-6 text-muted-foreground">仅保存勾选的媒体与生成文本。已是资产库素材的条目会跳过；提示词与未完成任务不会作为结果保存。</p>
      {visible.loading ? <p role="status" className="py-6 text-sm">正在检查保存记录…</p> : visible.rows.length ? <ul aria-label="选区结果列表" className="max-h-[45dvh] space-y-2 overflow-y-auto">
        {visible.rows.map(row => <li key={row.id} className="rounded-xl border border-border bg-muted/20 p-3">
          <label className="flex items-start gap-3"><input type="checkbox" checked={visible.checked.includes(row.id)} disabled={busy || Boolean(row.skipped) || !row.key || !['pending', 'failed'].includes(row.status)} onChange={event => setDialog(existing => existing?.type === 'results' ? { ...existing, checked: event.target.checked ? [...existing.checked, row.id] : existing.checked.filter(id => id !== row.id) } : existing)} className="mt-1" />
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{row.title}</span><span className="text-xs text-muted-foreground">{kinds[row.kind]} · {row.skipped || labels[row.status]}</span>{row.text ? <span className="mt-2 block max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{row.text}</span> : null}</span>
          </label>
          {row.kind === 'image' && row.url && safeSelectionMediaUrl(row.url) ? <img src={row.url} alt={`${row.title}预览`} loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-36 max-w-full rounded-lg object-contain" /> : null}
          {row.error || row.status === 'unknown' ? <p className="mt-2 text-xs leading-5 text-amber-600 dark:text-amber-300">{row.error || '上次保存结果未确认。请到资产库核对，此项不会重复提交。'}</p> : null}
        </li>)}
      </ul> : <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">选区内还没有可保存的媒体或生成文本。先生成结果，或选择已有媒体节点。</p>}
      <div aria-live="polite" className="mt-3 text-xs text-muted-foreground">{visible.rows.filter(row => row.status === 'saved').length} 项已保存 · {visible.rows.filter(row => row.status === 'unknown').length} 项待核对</div>
      {visible.error ? <p role="alert" className="mt-3 text-sm text-destructive">{visible.error}</p> : null}
      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><a href="/assets" target="_blank" rel="noopener noreferrer" className="text-xs underline underline-offset-4">在新页面查看资产库</a><div className="flex gap-2"><button className={BUTTON} disabled={busy} onClick={close}>完成</button><button className={`${BUTTON} bg-foreground text-background hover:bg-foreground/90`} disabled={busy || visible.loading || !readyCount} onClick={() => void save()}>{busy ? '正在保存…' : `确认保存 ${readyCount} 项`}</button></div></footer>
    </> : <form onSubmit={event => { event.preventDefault(); createDraft() }} className="space-y-4">
      <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-6">确认后仅新建任务草稿，不会开始生成。选区摘要用于表达意图；运行仍会结合整个画布，选区不是执行范围隔离。</p>
      <label className="block text-xs font-medium">任务名称<input autoFocus className={`${INPUT} mt-1.5`} required maxLength={120} value={visible.title} onChange={event => setDialog(existing => existing?.type === 'agent' ? { ...existing, title: event.target.value, error: '' } : existing)} /></label>
      <label className="block text-xs font-medium">编辑任务草稿<textarea rows={12} className={`${INPUT} mt-1.5 max-h-[42dvh] resize-y`} required value={visible.prompt} onChange={event => setDialog(existing => existing?.type === 'agent' ? { ...existing, prompt: event.target.value, error: '' } : existing)} /></label>
      <p className={`text-xs ${visible.prompt.length > 16000 ? 'text-destructive' : 'text-muted-foreground'}`}>{visible.prompt.length}/16000 字符 · 摘要省略了素材地址、任务标识与运行记录。</p>
      {visible.error ? <p role="alert" className="text-sm text-destructive">{visible.error}</p> : null}
      <footer className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" className={BUTTON} onClick={close}>取消</button><button type="submit" className={`${BUTTON} bg-foreground text-background hover:bg-foreground/90`} disabled={!visible.prompt.trim() || visible.prompt.length > 16000 || !visible.title.trim()}>创建任务草稿</button></footer>
    </form>}
  </SelectionDialog> : null
  return { saveSelectionResults, draftAgentFromSelection, exportSelection, dialogs }
}
