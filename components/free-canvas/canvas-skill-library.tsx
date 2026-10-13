'use client'

import { useRef, useState, type FormEvent } from 'react'
import { Check, Loader2, Plus, Puzzle, Search, Trash2, X } from 'lucide-react'
import { createLibraryAsset, deleteLibraryAsset } from '@/lib/studio/account-api'
import { useLibraryAssets } from '@/lib/studio/use-account-data'
import { canvasSkillOf, MAX_CANVAS_SKILLS, MAX_SKILL_PROMPT, type CanvasSkill } from '@/lib/studio/canvas-skills'

const CONTROL = 'rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45'

/** Shared by the dedicated skills page and the canvas selector. No media picker is mounted here. */
export function CanvasSkillLibrary({ selected = [], onToggle, onClose }: { selected?: readonly CanvasSkill[]; onToggle?: (skill: CanvasSkill) => void; onClose?: () => void }) {
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState<{ title: string; prompt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const library = useLibraryAssets({ kind: 'text', pageSize: 100 })
  const skills = library.assets.flatMap((asset) => { const skill = canvasSkillOf(asset); return skill ? [skill] : [] })
  const visible = skills.filter((skill) => `${skill.title}\n${skill.prompt}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft?.title.trim() || !draft.prompt.trim() || busyRef.current) return
    busyRef.current = true; setBusy(true); setMessage('')
    try {
      await createLibraryAsset({ kind: 'text', title: draft.title.trim(), source: 'canvas-skill', tags: ['技能'], data: { prompt: draft.prompt.trim(), skillVersion: 1 } })
      setDraft(null); await library.reload(); setMessage('技能已保存，可以从列表选择使用。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '技能保存失败，请重试') }
    finally { busyRef.current = false; setBusy(false) }
  }

  const remove = async (id: string) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setMessage('')
    try { await deleteLibraryAsset(id); setDeleteId(null); await library.reload(); setMessage('技能已删除，已引用的节点需要重新选择技能。') }
    catch (error) { setMessage(error instanceof Error ? error.message : '删除失败，请重试') }
    finally { busyRef.current = false; setBusy(false) }
  }

  return (
    <section aria-label={onToggle ? '选择技能' : '我的技能'} className="flex min-h-0 flex-col gap-4 text-foreground">
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"><Puzzle className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><h2 className="font-semibold">{onToggle ? '选择技能' : '我的技能'}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">把常用创作要求存成技能，用于生成节点或 Agent。{onToggle ? `已选 ${selected.length}/${MAX_CANVAS_SKILLS}` : '技能仅对当前账号可见。'}</p></div>
        {onClose ? <button type="button" aria-label="关闭技能选择" onClick={onClose} className={CONTROL}><X className="size-4" /></button> : null}
      </header>
      <div className="flex gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border px-3 focus-within:ring-2 focus-within:ring-ring"><Search className="size-4 text-muted-foreground" /><input aria-label="搜索技能" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称或指令内容" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label><button type="button" disabled={busy} onClick={() => setDraft({ title: '', prompt: '' })} className={CONTROL}><Plus className="mr-1 inline size-4" />新建技能</button></div>
      {draft ? <form onSubmit={create} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <label className="text-xs font-medium">技能名称<input required maxLength={80} disabled={busy} autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1.5 w-full rounded-lg border border-border bg-background p-2.5 text-sm focus-visible:outline-ring" placeholder="例如：电影分镜描述" /></label>
        <label className="text-xs font-medium">技能指令<textarea required maxLength={MAX_SKILL_PROMPT} disabled={busy} rows={5} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background p-2.5 text-sm leading-6 focus-visible:outline-ring" placeholder="写下可反复使用的要求，例如镜头语言、风格约束、输出格式。" /></label>
        <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{draft.prompt.length}/{MAX_SKILL_PROMPT}</span><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setDraft(null)} className={CONTROL}>取消</button><button disabled={busy || !draft.title.trim() || !draft.prompt.trim()} className={`${CONTROL} bg-foreground text-background hover:opacity-80`}>{busy ? '保存中…' : '保存技能'}</button></div></div>
      </form> : null}
      {message ? <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p> : null}
      {library.state === 'error' ? <div role="alert" className="rounded-lg border border-border p-3 text-sm">{library.message}<button type="button" onClick={() => void library.reload()} className={`${CONTROL} ml-2`}>重试</button></div> : null}
      {library.state === 'loading' ? <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取技能…</p> : null}
      <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto" aria-label="技能列表">
        {visible.map((skill) => { const chosen = selected.some((item) => item.id === skill.id); return <li key={skill.id} className={`rounded-xl border p-4 ${chosen ? 'border-foreground/55 bg-muted/60' : 'border-border'}`}>
          <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{skill.title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{skill.prompt}</p></div>{onToggle ? <button type="button" aria-pressed={chosen} disabled={busy || (!chosen && selected.length >= MAX_CANVAS_SKILLS)} onClick={() => onToggle(skill)} className={`${CONTROL} shrink-0`}>{chosen ? <><Check className="mr-1 inline size-4" />已选</> : '选择'}</button> : null}</div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2"><button type="button" disabled={busy} onClick={() => setDraft({ title: `${skill.title} · 副本`.slice(0, 80), prompt: skill.prompt })} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-ring">编辑为新技能</button>{deleteId === skill.id ? <><span className="text-xs text-muted-foreground">确认删除？</span><button type="button" disabled={busy} onClick={() => void remove(skill.id)} className={CONTROL}>删除</button><button type="button" disabled={busy} onClick={() => setDeleteId(null)} className={CONTROL}>保留</button></> : <button type="button" aria-label={`删除技能 ${skill.title}`} disabled={busy} onClick={() => setDeleteId(skill.id)} className="rounded p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-ring"><Trash2 className="size-3.5" /></button>}</div>
        </li> })}
      </ul>
      {!visible.length && library.state !== 'loading' && library.state !== 'error' ? <p className="py-5 text-center text-sm text-muted-foreground">{keyword ? '没有匹配的技能。' : '还没有技能，点击“新建技能”保存第一条创作指令。'}</p> : null}
      {library.hasMore ? <button type="button" disabled={library.loadingMore} onClick={() => void library.loadMore()} className={CONTROL}>{library.loadingMore ? '读取中…' : '加载更多技能'}</button> : null}
    </section>
  )
}
