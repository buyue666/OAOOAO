'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Clapperboard, LoaderCircle, Paperclip, X } from 'lucide-react'
import { createDramaProject, StudioApiError } from '@/lib/studio/api'
import { createLibraryAsset, uploadPersistentAsset } from '@/lib/studio/account-api'
import { bumpAccountData } from '@/lib/studio/account-data-sync'
import type { DramaProject, DramaSourceAsset } from '@/lib/studio/drama-types'
import { useStudio } from '@/lib/studio/store'

type StarterProps = {
  brief?: string
  onBriefChange?: (value: string) => void
  onCreated?: (project: DramaProject) => void
}

type SavedReference = {
  uploaded?: Awaited<ReturnType<typeof uploadPersistentAsset>>
  source?: DramaSourceAsset
}

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-60'

/** 创建服务器项目；参考图同时保存到资产库，失败重试沿用本次已上传的素材。 */
export function CreativeProjectStarter({ brief: controlledBrief, onBriefChange, onCreated }: StarterProps = {}) {
  const router = useRouter()
  const { state } = useStudio()
  const [title, setTitle] = useState('')
  const [localBrief, setLocalBrief] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [files, setFiles] = useState<File[]>([])
  const [creating, setCreating] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef(false)
  const creationRef = useRef<{ accountId: string; sourceHandoffId: string; payload?: Parameters<typeof createDramaProject>[0] } | null>(null)
  const previousAccount = useRef(state.user.id)
  const savedRefs = useRef(new Map<File, SavedReference>())
  const sessionRef = useRef(0)
  const identity = `${state.user.id}:${state.backendStatus}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  const brief = controlledBrief ?? localBrief
  const connected = state.backendStatus === 'connected'

  useEffect(() => {
    if (previousAccount.current !== state.user.id) {
      previousAccount.current = state.user.id
      creationRef.current = null; setRecovering(false); setTitle(''); setLocalBrief(''); setRatio('16:9')
      onBriefChange?.('')
    }
  }, [state.user.id, onBriefChange])

  useEffect(() => {
    sessionRef.current += 1
    savedRefs.current.clear()
    setFiles([])
    setError('')
    pendingRef.current = false
    setCreating(false)
    setStage('')
    return () => { sessionRef.current += 1 }
  }, [state.user.id, connected])

  function changeBrief(value: string) {
    if (onBriefChange) onBriefChange(value)
    else setLocalBrief(value)
  }

  function addFiles(incoming: File[]) {
    setError('')
    const combined = [...files]
    for (const file of incoming) {
      if (!file.type.startsWith('image/')) { setError('目前支持图片参考，请选择角色、产品或场景图片。'); return }
      if (file.size > 20 * 1024 * 1024) { setError(`「${file.name}」超过 20 MB，请压缩后重试。`); return }
      if (!combined.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) combined.push(file)
    }
    if (combined.length > 6) { setError('一个项目最多先添加 6 张参考图，其他素材可以进入项目后继续添加。'); return }
    setFiles(combined)
  }

  async function createProject() {
    if (pendingRef.current || !title.trim() || !connected || identityRef.current !== identity) return
    pendingRef.current = true
    setCreating(true)
    setError('')
    let created = false
    const session = sessionRef.current
    // 后端按账户与 sourceHandoffId 找回已创建的项目；响应丢失后重试不会再新建一份。
    // 连接状态变化保留本次标识，只有切换账户或打开新的创建表单才开始新的一次。
    if (creationRef.current?.accountId !== state.user.id) creationRef.current = { accountId: state.user.id, sourceHandoffId: `creative-${crypto.randomUUID()}` }
    const sourceHandoffId = creationRef.current.sourceHandoffId
    const isCurrent = () => sessionRef.current === session && identityRef.current === identity
    const ensureSession = () => {
      if (!isCurrent()) throw new Error('账户状态已变化，请重新打开创建入口。')
    }
    try {
      const sources: DramaSourceAsset[] = []
      for (let index = 0; !creationRef.current?.payload && index < files.length; index += 1) {
        const file = files[index]
        ensureSession()
        setStage(`正在保存参考 ${index + 1}/${files.length}…`)
        const saved = savedRefs.current.get(file) ?? {}
        if (!saved.uploaded) {
          saved.uploaded = await uploadPersistentAsset(file, 'image')
          ensureSession()
          savedRefs.current.set(file, saved)
        }
        if (!saved.source) {
          ensureSession()
          const asset = await createLibraryAsset({
            kind: 'image',
            title: file.name,
            coverUrl: saved.uploaded.url,
            source: 'upload',
            tags: ['项目参考'],
            data: { storageKey: saved.uploaded.key, remoteUrl: saved.uploaded.url, serverUrl: saved.uploaded.url, mimeType: saved.uploaded.mimeType },
          })
          ensureSession()
          saved.source = { id: asset.id, type: 'image', title: asset.title, storageKey: saved.uploaded.key, remoteUrl: saved.uploaded.url, serverUrl: saved.uploaded.url, mimeType: saved.uploaded.mimeType }
          savedRefs.current.set(file, saved)
        }
        sources.push(saved.source)
      }
      ensureSession()
      setStage('正在创建项目…')
      const payload = creationRef.current?.payload ?? { title: title.trim(), summary: brief.trim(), initialScript: brief.trim(), ratio, sourceAssets: sources, sourceHandoffId }
      creationRef.current = { accountId: state.user.id, sourceHandoffId, payload }
      setRecovering(true)
      const project = await createDramaProject(payload)
      ensureSession()
      created = true
      setStage('项目已保存，正在进入…')
      bumpAccountData()
      if (onCreated) onCreated(project)
      else router.push(`/projects/${encodeURIComponent(project.id)}`)
    } catch (reason) {
      if (isCurrent()) {
        const rejected = reason instanceof StudioApiError && ['rejected', 'failed', 'not-found', 'expired'].includes(reason.outcome)
        if (rejected) { creationRef.current = null; setRecovering(false) }
        setError(`${!rejected && creationRef.current?.payload ? '创建结果暂未确认。请恢复本次创建，将沿用原内容，不会另建一份项目。 ' : ''}${reason instanceof Error ? reason.message : '项目创建失败，请稍后重试。'}`)
      }
    } finally {
      // 路由切换完成前保持按钮锁定，避免慢网络下重复创建同一项目。
      if (!created && isCurrent()) { pendingRef.current = false; setCreating(false); setStage('') }
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void createProject() }} className="flex flex-col gap-5 p-5 sm:p-7" aria-label="新建创作项目">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"><Clapperboard className="size-5" aria-hidden="true" /></span>
        <div><h2 className="text-lg font-semibold tracking-tight">把想法放进一个项目</h2>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">从创作提纲和参考素材开始，接着逐个打磨镜头。</p></div>
      </div>
      <ol className="grid grid-cols-3 gap-2 text-xs text-muted-foreground" aria-label="创作流程">{['写下想法', '打磨镜头', '选择结果'].map((step, index) => <li key={step} className="flex items-center gap-2 rounded-lg bg-cyan-500/5 px-2.5 py-2"><span className="text-cyan-700 dark:text-cyan-300">0{index + 1}</span>{step}</li>)}</ol>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
        <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-muted-foreground">作品名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required disabled={creating || recovering} placeholder="给这次创作起个名字" className={inputClass} /></label>
        <label className="flex flex-col gap-2 text-xs font-medium text-muted-foreground">画面比例<select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={creating || recovering} className={inputClass}><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option></select></label>
      </div>
      <label className="flex flex-col gap-2 text-xs font-medium text-muted-foreground">创作提纲<textarea value={brief} onChange={(event) => changeBrief(event.target.value)} rows={4} maxLength={20000} disabled={creating || recovering} placeholder="想做什么、给谁看、需要保留哪些角色或产品细节？已有剧本也可以粘贴在这里。" className={`${inputClass} min-h-32 resize-y leading-6`} /></label>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((file) => <span key={`${file.name}-${file.size}-${file.lastModified}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/30 py-1 pl-2.5 pr-1 text-xs"><span className="truncate">{file.name}</span><button type="button" disabled={creating || recovering} aria-label={`移除参考 ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"><X className="size-3.5" aria-hidden="true" /></button></span>)}
          <button type="button" disabled={creating || recovering || files.length >= 6} onClick={() => fileInputRef.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"><Paperclip className="size-4" aria-hidden="true" />添加角色或产品参考</button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" tabIndex={-1} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">参考图会保存在创作资产中，供这个项目和后续作品复用。最多 6 张，每张 20 MB。</p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm leading-6 text-destructive">{error}</p>}
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">创建和整理项目不消耗生成积分。<br />生成图片或视频时，再确认模型与费用。</p>
        {connected ? <button type="submit" disabled={creating || !title.trim()} aria-busy={creating || undefined} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-700 to-teal-700 px-5 text-sm font-semibold text-white hover:from-cyan-600 hover:to-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">{creating ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span aria-live="polite">{stage || '正在准备…'}</span></> : <>{recovering ? '恢复本次创建' : '创建并进入项目'}<ArrowRight className="size-4" aria-hidden="true" /></>}</button> : state.backendStatus === 'checking' ? <span role="status" className="text-sm text-muted-foreground">正在检查登录状态…</span> : state.backendStatus === 'unauthenticated' ? <Link href="/login" className="inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background">登录后创建项目</Link> : <span role="status" className="text-sm text-muted-foreground">服务暂时不可用，请稍后重试。</span>}
      </div>
    </form>
  )
}
