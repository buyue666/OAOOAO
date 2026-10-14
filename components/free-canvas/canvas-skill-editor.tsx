'use client'

import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Download, FileText, Upload } from 'lucide-react'
import {
  canvasSkillDraftError, canvasSkillDraftPrompt, exportCanvasSkillMarkdown,
  importCanvasSkillMarkdown, MAX_SKILL_MARKDOWN_BYTES, MAX_SKILL_PROMPT, type CanvasSkillDraft,
} from '@/lib/studio/canvas-skills'

const CONTROL = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45'
const INPUT = 'mt-1.5 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'

export function downloadCanvasSkill(draft: CanvasSkillDraft) {
  const url = URL.createObjectURL(new Blob([exportCanvasSkillMarkdown(draft)], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'SKILL.md'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Let the browser acquire the Blob before releasing the URL, including on Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function CanvasSkillEditor({ initialDraft, saving, onCancel, onSave }: {
  initialDraft: CanvasSkillDraft
  saving: boolean
  onCancel: () => void
  onSave: (draft: CanvasSkillDraft) => void
}) {
  const [draft, setDraft] = useState(() => initialDraft)
  const [view, setView] = useState<'edit' | 'prompt' | 'markdown'>('edit')
  const [reading, setReading] = useState(false)
  const [pendingImport, setPendingImport] = useState<CanvasSkillDraft | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const readingRef = useRef(false)
  const countId = useId()
  const prompt = canvasSkillDraftPrompt(draft)
  const validation = canvasSkillDraftError(draft)
  const blocked = saving || reading
  const update = (key: keyof CanvasSkillDraft, value: string) => { setDraft((current) => ({ ...current, [key]: value })); setError('') }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    const file = files?.[0]
    const count = files?.length ?? 0
    event.target.value = ''
    if (!file || blocked || readingRef.current) return
    setError(''); setPendingImport(null)
    if (count !== 1 || !/^skill\.md$/i.test(file.name)) { setError('请选择单个 SKILL.md 文本文件；不支持 ZIP 或多文件技能包'); return }
    if (file.size > MAX_SKILL_MARKDOWN_BYTES) { setError('SKILL.md 不能超过 64 KB'); return }
    readingRef.current = true; setReading(true)
    try { setPendingImport(importCanvasSkillMarkdown(await file.text(), file.name)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取该文件，请确认它是 UTF-8 文本') }
    finally { readingRef.current = false; setReading(false) }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (blocked || pendingImport) return
    if (validation) { setError(validation); return }
    onSave(draft)
  }

  return (
    <form onSubmit={submit} aria-label="创建技能" className="min-w-0 space-y-4 rounded-xl border border-border bg-muted/25 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold">把经验写成可重复使用的技能</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">说明什么时候用、怎样做，以及什么样的结果才算完成。</p></div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept=".md,text/markdown,text/plain" aria-label="导入 SKILL.md 文件" className="hidden" disabled={blocked} onChange={(event) => void importFile(event)} />
          <button type="button" className={CONTROL} disabled={blocked} onClick={() => fileInput.current?.click()}><Upload className="size-3.5" aria-hidden="true" />{reading ? '读取中…' : '导入 SKILL.md'}</button>
          <button type="button" className={CONTROL} disabled={blocked || Boolean(validation)} onClick={() => downloadCanvasSkill(draft)}><Download className="size-3.5" aria-hidden="true" />导出 SKILL.md</button>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">创作指令技能 · 用于画布生成节点和 Agent。导入只读取文本，文件中的代码与外部文件不会作为程序执行。</p>
      {pendingImport ? <section aria-label="待确认的技能文件" className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
        <p className="text-sm font-medium">待导入：{pendingImport.title}</p>
        <p className="text-xs text-muted-foreground">{canvasSkillDraftPrompt(pendingImport).length} 个执行字符。确认后替换当前草稿，保存后才会进入技能库。</p>
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-6">{canvasSkillDraftPrompt(pendingImport)}</pre>
        <div className="flex gap-2"><button type="button" className={CONTROL} disabled={blocked} onClick={() => { setDraft(pendingImport); setPendingImport(null); setView('edit') }}>使用导入内容</button><button type="button" className={CONTROL} disabled={blocked} onClick={() => setPendingImport(null)}>保留当前草稿</button></div>
      </section> : null}
      <div role="group" aria-label="技能编辑视图" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {([['edit', '填写技能'], ['prompt', '执行预览'], ['markdown', 'SKILL.md 预览']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`${CONTROL} ${view === value ? 'border-transparent bg-foreground text-background hover:bg-foreground/90' : 'border-transparent'}`}>{label}</button>)}
      </div>
      {view === 'edit' ? <div className="space-y-4">
        <label className="block text-xs font-medium">技能名称 <span className="text-muted-foreground">必填</span><input autoFocus required maxLength={80} disabled={blocked} value={draft.title} onChange={(event) => update('title', event.target.value)} className={INPUT} placeholder="例如：产品镜头连续性检查" /></label>
        <label className="block text-xs font-medium">一句话简介 <span className="text-muted-foreground">可选，最多 240 字符</span><input maxLength={240} disabled={blocked} value={draft.summary} onChange={(event) => update('summary', event.target.value)} className={INPUT} placeholder="这个技能可以帮你解决什么问题？" /></label>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="block min-w-0 text-xs font-medium">适用场景 <span className="text-muted-foreground">可选</span><textarea rows={3} maxLength={MAX_SKILL_PROMPT} disabled={blocked} value={draft.scenarios} onChange={(event) => update('scenarios', event.target.value)} className={`${INPUT} resize-y`} placeholder="例如：同一产品跨多个镜头，需要保持外观一致时。" /></label>
          <label className="block min-w-0 text-xs font-medium">使用方式 <span className="text-muted-foreground">可选</span><textarea rows={3} maxLength={MAX_SKILL_PROMPT} disabled={blocked} value={draft.usage} onChange={(event) => update('usage', event.target.value)} className={`${INPUT} resize-y`} placeholder="需要提供哪些参考？先做哪一步，再检查什么？" /></label>
        </div>
        <label className="block text-xs font-medium">输出要求 <span className="text-muted-foreground">可选</span><textarea rows={3} maxLength={MAX_SKILL_PROMPT} disabled={blocked} value={draft.output} onChange={(event) => update('output', event.target.value)} className={`${INPUT} resize-y`} placeholder="例如：按镜头列出问题与修改建议，保留已确认的产品特征。" /></label>
        <label className="block text-xs font-medium">技能指令 <span className="text-muted-foreground">必填</span><textarea required rows={7} maxLength={MAX_SKILL_PROMPT} disabled={blocked} aria-describedby={countId} value={draft.instructions} onChange={(event) => update('instructions', event.target.value)} className={`${INPUT} resize-y`} placeholder="写下具体步骤、风格约束和判断标准。调用时会同时带上上方填写的说明。" /></label>
      </div> : <section aria-label={view === 'prompt' ? '实际执行指令预览' : 'SKILL.md 文件预览'} className="space-y-3">
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{view === 'prompt' ? '以下内容会完整加入所选节点的任务指令；栏目标题和换行也计入长度。' : '导出文件包含可再次导入的说明和技能指令。内容按文本显示。'}</p>
        {view === 'markdown' && validation ? <p className="rounded-lg bg-muted p-3 text-sm">{validation}，完成后可预览和导出文件。</p> : <pre className="max-h-[420px] min-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6">{view === 'prompt' ? prompt || '填写说明与指令后，在这里查看完整执行内容。' : exportCanvasSkillMarkdown(draft)}</pre>}
      </section>}
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p id={countId} className={`text-xs leading-5 ${prompt.length > MAX_SKILL_PROMPT ? 'text-destructive' : 'text-muted-foreground'}`}>完整执行指令 {prompt.length}/{MAX_SKILL_PROMPT} 字符<br />包含简介、场景、使用方式、输出要求和栏目标题{prompt.length > MAX_SKILL_PROMPT ? `；需精简 ${prompt.length - MAX_SKILL_PROMPT} 字符` : ''}</p>
        <div className="flex gap-2"><button type="button" className={CONTROL} disabled={blocked} onClick={onCancel}>取消</button><button type="submit" className={`${CONTROL} border-transparent bg-foreground text-background hover:bg-foreground/90`} disabled={blocked || Boolean(validation) || Boolean(pendingImport)}>{saving ? '保存中…' : '保存技能'}</button></div>
      </footer>
    </form>
  )
}
