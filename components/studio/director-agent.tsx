'use client'

import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bot, Check, CirclePause, CirclePlay, FileText, Layers3, Loader2, Paperclip, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { newClientRequestId } from '@/lib/studio/generation-api'
import { createLibraryAsset, uploadPersistentAsset } from '@/lib/studio/account-api'
import type { AgentRun } from '@/lib/studio/generation-types'
import { assistantContextLabel, assistantSuggestions, assistantThreadKey, buildAssistantPrompt, type AssistantContext } from '@/lib/studio/director-context'
import { parseAssistantThread, type AssistantMessage as Message, type AssistantPending as Pending } from '@/lib/studio/director-thread'
import { cn } from '@/lib/utils'
import { ControlButton, StatusBadge, type Tone } from './ui'

type Reference = { id: string; file: File; uploaded?: Awaited<ReturnType<typeof uploadPersistentAsset>>; assetId?: string; status: 'uploading' | 'ready' | 'error'; error?: string }
type Props = { projectId?: string; projectContext?: AssistantContext; context?: string; onOpenPlan?: (planId: string) => void; showHeader?: boolean; emptyStateLayout?: 'grid' | 'stacked'; compact?: boolean }
const statusMeta: Record<AgentRun['status'], { label: string; tone: Tone }> = {
  planning: { label: '正在规划', tone: 'accent' }, awaiting_approval: { label: '等待你确认', tone: 'warning' }, running: { label: '执行中', tone: 'accent' }, paused: { label: '已暂停', tone: 'warning' }, completed: { label: '已完成', tone: 'success' }, failed: { label: '执行失败', tone: 'warning' }, cancelled: { label: '已取消', tone: 'muted' },
}
const errorText = (reason: unknown) => reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' ? reason.message : '暂时无法完成请求，请重试。'
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/** A caller's placement label is not evidence of a selected project or its contents. */
export function DirectorAgent(props: Props) {
  const { state } = useStudio()
  const project = state.backendStatus === 'connected' ? state.projects.find((item) => item.id === props.projectId) : undefined
  const context: AssistantContext = props.projectContext?.projectId === props.projectId && props.projectContext
    ? props.projectContext : { surface: props.projectId ? 'canvas' : 'chat', projectId: props.projectId, projectTitle: project?.title, summary: project?.description }
  const scope = assistantThreadKey(state.user.id, context.surface, context.projectId)
  return <DirectorSession key={scope} {...props} scope={scope} verifiedContext={context} />
}

function DirectorSession({ scope, verifiedContext, showHeader = true, compact = false, emptyStateLayout = 'grid' }: Props & { scope: string; verifiedContext: AssistantContext }) {
  const { state } = useStudio()
  const generation = useGeneration()
  const connected = state.backendStatus === 'connected'
  const canPlan = connected && state.liveModels.some((model) => model.capability === 'text')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [refs, setRefs] = useState<Reference[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [runs, setRuns] = useState<Record<string, AgentRun>>({})
  const [queryErrors, setQueryErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pollRevision, setPollRevision] = useState(0)
  const submitLock = useRef(false)
  const refsRef = useRef<Reference[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const identity = `${scope}:${state.backendStatus}`
  const scopeEpoch = useRef({ identity, epoch: 0 })
  if (scopeEpoch.current.identity !== identity) scopeEpoch.current = { identity, epoch: scopeEpoch.current.epoch + 1 }
  const identityRef = useRef(0)
  identityRef.current = scopeEpoch.current.epoch
  const inputId = useId()
  const suggestions = assistantSuggestions(verifiedContext, input)
  const unfinishedRefs = refs.some((ref) => ref.status !== 'ready')

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!connected) {
      submitLock.current = false; setSubmitting(false)
      refsRef.current = refsRef.current.map((ref) => ref.status === 'uploading' ? { ...ref, status: 'error', error: '连接已变化，请重新上传此参考。' } : ref)
      setRefs([...refsRef.current])
    }
  }, [connected])
  useEffect(() => {
    try {
      const saved = parseAssistantThread(window.localStorage.getItem(scope), verifiedContext.surface, verifiedContext.projectId)
      setMessages(saved.messages); setPending(saved.pending); setStorageBlocked(false)
      if (saved.pending) setInput(saved.pending.displayText)
    } catch (reason) { setStorageBlocked(true); setError(errorText(reason)) }
    setReady(true)
  }, [scope, verifiedContext.surface, verifiedContext.projectId])
  function persist(nextMessages: Message[], request: Pending | null) {
    window.localStorage.setItem(scope, JSON.stringify({ version: 2, messages: nextMessages.slice(-40), pending: request }))
  }
  useEffect(() => { const node = scrollRef.current; if (node) node.scrollTop = node.scrollHeight }, [messages.length])
  const activeIds = useMemo(() => [...new Set(messages.flatMap((message) => message.runId ? [message.runId] : []))].filter((id) => !runs[id] || ['planning', 'awaiting_approval', 'running', 'paused'].includes(runs[id].status)).join('|'), [messages, runs])
  useEffect(() => {
    if (!connected || !activeIds) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const token = identityRef.current
    async function poll() {
      for (const id of activeIds.split('|')) {
        if (stopped || token !== identityRef.current) return
        try {
          const run = await generation.getAgent(id)
          if (stopped || token !== identityRef.current) return
          setRuns((current) => ({ ...current, [id]: run })); setQueryErrors((current) => ({ ...current, [id]: '' }))
        } catch (reason) { if (!stopped && token === identityRef.current) setQueryErrors((current) => ({ ...current, [id]: errorText(reason) })) }
      }
      if (!stopped) timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [activeIds, connected, generation.getAgent, pollRevision])

  function updateReference(value: Reference) { refsRef.current = refsRef.current.map((ref) => ref.id === value.id ? value : ref); setRefs([...refsRef.current]) }
  async function upload(ref: Reference) {
    const token = identityRef.current
    const current = () => alive.current && token === identityRef.current && refsRef.current.some((item) => item.id === ref.id)
    let next: Reference = { ...ref, status: 'uploading', error: undefined }
    updateReference(next)
    try {
      if (!next.uploaded) { const uploaded = await uploadPersistentAsset(ref.file, 'image'); if (!current()) return; next = { ...next, uploaded }; updateReference(next) }
      const uploaded = next.uploaded!
      const asset = await createLibraryAsset({ kind: 'image', title: ref.file.name, source: 'assistant-reference', tags: ['创作参考'], data: { storageKey: uploaded.key, serverUrl: uploaded.url, dataUrl: uploaded.url, mimeType: uploaded.mimeType, bytes: uploaded.bytes } })
      if (current()) updateReference({ ...next, assetId: asset.id, status: 'ready' })
    } catch (reason) { if (current()) updateReference({ ...next, status: 'error', error: errorText(reason) }) }
  }
  function addFiles(files: File[]) {
    if (!connected || submitting || pending) return
    if (refsRef.current.length + files.length > 4) { setError('一次最多添加 4 张参考图。'); return }
    const invalid = files.find((file) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 20 * 1024 * 1024)
    if (invalid) { setError(`「${invalid.name}」无法添加。请选择不超过 20 MB 的 PNG、JPEG、WebP 或 GIF 图片。`); return }
    const added: Reference[] = files.map((file) => ({ id: crypto.randomUUID(), file, status: 'uploading' }))
    refsRef.current = [...refsRef.current, ...added]; setRefs([...refsRef.current]); setError('')
    for (const ref of added) void upload(ref)
  }
  async function send() {
    if (submitLock.current || !ready || storageBlocked || !canPlan || (!pending && (!input.trim() || unfinishedRefs))) return
    const token = identityRef.current
    const current = () => alive.current && token === identityRef.current
    const request: Pending = pending ?? { clientRequestId: newClientRequestId('assistant'), displayText: input.trim(), prompt: buildAssistantPrompt(input, verifiedContext), surface: verifiedContext.surface, projectId: verifiedContext.projectId, assetIds: refs.map((ref) => ref.assetId!), refTitles: refs.map((ref) => ref.file.name) }
    try { persist(messages, request) } catch { setError('浏览器无法保存请求恢复标识，请允许本站本地存储后重试。请求尚未发送。'); return }
    submitLock.current = true; setSubmitting(true); setPending(request); setError('')
    try {
      const run = await generation.runAgent(request)
      if (!current()) return
      const next: Message[] = [...messages, { id: `${request.clientRequestId}-user`, role: 'user', text: request.displayText, refs: request.refTitles }, { id: `${request.clientRequestId}-run`, role: 'agent', text: '规划请求已收到。计划返回后，请先查看步骤和预计积分，再决定是否执行。', runId: run.id }]
      setRuns((value) => ({ ...value, [run.id]: run })); setMessages(next); setPending(null); setInput(''); refsRef.current = []; setRefs([])
      try { persist(next, null) } catch { setError('请求已收到，但浏览器记录未能更新。刷新后使用原请求标识恢复，不会重复创建。') }
    } catch (reason) {
      if (!current()) return
      const definite = reason && typeof reason === 'object' && 'outcome' in reason && ['failed', 'rejected', 'expired', 'not-found'].includes(String(reason.outcome))
      if (definite) { setPending(null); try { persist(messages, null) } catch { /* The same request identity remains safe to recover. */ } }
      setError(`${definite ? '请求未获接受，可修改后重试。' : '提交结果暂未确认，请恢复同一请求。'} ${errorText(reason)}`)
    } finally { if (current()) { submitLock.current = false; setSubmitting(false) } }
  }
  async function control(run: AgentRun, action: 'pause' | 'resume' | 'retry' | 'cancel' | 'approve') {
    const token = identityRef.current
    const nextRun = await generation.cancelAgent(run, action)
    if (alive.current && token === identityRef.current) setRuns((current) => ({ ...current, [run.id]: nextRun }))
  }

  return <section className="flex h-full min-h-0 flex-col" aria-label="创作助手">
    {showHeader && <header className={cn('flex shrink-0 items-center justify-between gap-3 border-b border-violet-400/15 bg-gradient-to-r from-violet-500/8 via-transparent to-cyan-400/5', compact ? 'px-3 py-3' : 'px-5 py-4')}>
      <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-400/10 text-violet-600 dark:text-violet-300"><Sparkles className="size-5" aria-hidden="true" /></span><div><h2 className="text-sm font-semibold">创作助手</h2><p className="mt-0.5 text-xs text-muted-foreground">把你的内容，发展成下一步</p></div></div>
      {messages.length > 0 && <button type="button" aria-label="清空当前对话记录" disabled={Boolean(pending) || submitting} className={cn('rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40', focus)} onClick={() => { if (!window.confirm('清空当前对话记录？已提交的任务会继续保留在任务中心。')) return; try { persist([], null); setMessages([]); setRuns({}) } catch { setError('记录未能清空，请重试。') } }}><Trash2 className="size-4" aria-hidden="true" /></button>}
    </header>}
    <div className="shrink-0 border-b border-border/60 px-4 py-3"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 className="size-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" aria-hidden="true" /><span>{assistantContextLabel(verifiedContext)}</span></p>{verifiedContext.projectTitle && <details className="mt-2 text-xs text-muted-foreground"><summary className={cn('w-fit cursor-pointer rounded', focus)}>查看本次提供的文字上下文</summary><p className="mt-2 whitespace-pre-wrap leading-5">{[verifiedContext.summary, verifiedContext.episodeTitle, verifiedContext.script?.slice(0, 2000), verifiedContext.shot?.description].filter(Boolean).join('\n\n') || '目前只有项目名称，尚未提供创作提纲或镜头描述。'}{verifiedContext.script && verifiedContext.script.length > 2000 ? '\n（剧本文字仅使用前 2000 字）' : ''}</p></details>}</div>
    <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', compact ? 'p-3' : 'p-5')}>
      {!ready ? <p role="status" className="text-sm text-muted-foreground">正在读取当前对话…</p> : messages.length === 0 ? <div className="mx-auto flex max-w-2xl flex-col justify-center py-6 sm:py-10">
        <div className="mb-5 flex items-center gap-2 text-xs font-medium text-violet-600 dark:text-violet-300"><span className="h-px w-7 bg-current opacity-50" />一起把想法往前推进</div>
        <h3 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{verifiedContext.shot?.description ? '从这个镜头，打开更多可能。' : verifiedContext.summary || verifiedContext.script ? '让已有内容，长出下一步。' : '还没想清楚，也可以开始。'}</h3>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{verifiedContext.projectTitle ? '建议会结合上方显示的项目文字。缺少的信息，我们先补充；生成步骤由你确认。' : '写下目标、故事或一句零散的想法。没有关联项目时，我只使用你在这里提供的内容。'}</p>
        <div className={cn('mt-6 grid gap-2.5', emptyStateLayout === 'grid' && !compact && 'lg:grid-cols-3')}>{suggestions.map((suggestion, index) => <button key={suggestion} type="button" disabled={Boolean(pending) || submitting} onClick={() => { setInput(suggestion); document.getElementById(inputId)?.focus() }} className={cn('group flex flex-col gap-4 rounded-xl border p-4 text-left text-sm leading-6 motion-safe:transition-[transform,background-color] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 disabled:opacity-50', index === 0 ? 'border-violet-400/25 bg-violet-500/7 hover:bg-violet-500/12' : index === 1 ? 'border-cyan-400/25 bg-cyan-500/6 hover:bg-cyan-500/10' : 'border-amber-400/25 bg-amber-500/6 hover:bg-amber-500/10', focus)}><span className="text-[10px] font-medium tracking-widest text-muted-foreground">0{index + 1}</span><span className="line-clamp-3 flex-1 break-words">{suggestion}</span><ArrowRight className="size-4 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-1" aria-hidden="true" /></button>)}</div>
      </div> : <div className="mx-auto flex max-w-3xl flex-col gap-5">{messages.map((message) => <article key={message.id} className={cn('min-w-0 rounded-2xl border p-4', message.role === 'user' ? 'ml-5 border-cyan-400/15 bg-cyan-500/5' : 'mr-2 border-violet-400/20 bg-card')}><p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">{message.role === 'user' ? <FileText className="size-3.5" /> : <Bot className="size-3.5 text-violet-500" />}{message.role === 'user' ? '你的想法' : '创作助手'}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>{message.refs?.length ? <p className="mt-2 text-xs text-muted-foreground">参考：{message.refs.join('、')}</p> : null}{message.runId && <div className="mt-4 border-t border-border/70 pt-3">{runs[message.runId] ? <AgentRunPanel run={runs[message.runId]} connected={connected} onControl={(action) => control(runs[message.runId!], action)} onRetryTask={async (taskId) => { const token = identityRef.current; await generation.retryAgentTask(message.runId!, taskId); const updated = await generation.getAgent(message.runId!); if (alive.current && token === identityRef.current) setRuns((current) => ({ ...current, [updated.id]: updated })) }} /> : <p className="text-xs text-muted-foreground">正在读取服务端任务状态…</p>}{queryErrors[message.runId] && <p role="alert" className="mt-2 text-xs text-studio-warn">状态暂未确认：{queryErrors[message.runId]} <button className="underline" type="button" onClick={() => setPollRevision((value) => value + 1)}>重新检查</button></p>}</div>}</article>)}</div>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void send() }} className={cn('shrink-0 border-t border-border bg-card/90', compact ? 'p-3' : 'p-4 sm:p-5')}>
      {error && <p role="alert" className="mb-3 rounded-lg border border-amber-400/25 bg-amber-500/8 p-3 text-xs leading-5 text-foreground">{error}</p>}
      {storageBlocked && <p className="mb-3 text-xs leading-5 text-muted-foreground">请求恢复记录无法安全读取，已暂停新提交。<Link href="/tasks" className="underline">前往任务中心核对</Link>，确认没有待处理任务后可清除本站的损坏对话记录并刷新。</p>}
      {pending && !submitting && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/25 p-3"><p className="text-xs leading-5">有一笔提交待确认。恢复时沿用原内容和请求标识。</p><ControlButton size="sm" disabled={!canPlan} onClick={() => void send()}><RotateCcw className="size-3.5" />恢复上次提交</ControlButton></div>}
      {refs.length > 0 && <ul className="mb-3 flex flex-wrap gap-2">{refs.map((ref) => <li key={ref.id} className="max-w-full rounded-lg border border-border px-2 py-1.5 text-xs"><span className="flex items-center gap-2"><span className="max-w-44 truncate">{ref.file.name}</span>{ref.status === 'uploading' ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> : ref.status === 'ready' ? <Check className="size-3 text-success" /> : <button className="text-destructive underline" type="button" disabled={!connected || submitting || Boolean(pending)} onClick={() => void upload(ref)}>重试上传</button>}<button type="button" disabled={submitting || Boolean(pending)} aria-label={`移除参考 ${ref.file.name}`} className={cn('rounded p-1 hover:bg-muted', focus)} onClick={() => { refsRef.current = refsRef.current.filter((item) => item.id !== ref.id); setRefs([...refsRef.current]) }}><X className="size-3" /></button></span>{ref.error && <span role="alert" className="mt-1 block max-w-64 text-destructive">{ref.error}</span>}</li>)}</ul>}
      <div className="rounded-xl border border-violet-400/30 bg-background p-2 focus-within:ring-2 focus-within:ring-violet-400/15"><label htmlFor={inputId} className="sr-only">告诉创作助手你的想法</label><textarea id={inputId} value={input} maxLength={4000} disabled={submitting || Boolean(pending)} onChange={(event) => setInput(event.target.value)} rows={compact ? 3 : 4} placeholder={verifiedContext.projectTitle ? '针对这个项目，你想探索或调整什么？' : '写下你的目标或已有内容，从这里一起开始…'} className="w-full resize-y rounded-lg bg-transparent px-2 py-1.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60" onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
        <div className="flex items-center justify-between gap-2 px-1 pb-1"><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = '' }} /><button type="button" disabled={!connected || submitting || Boolean(pending) || refs.length >= 4} onClick={() => fileRef.current?.click()} className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40', focus)}><Paperclip className="size-4" aria-hidden="true" />参考图</button><button type="submit" disabled={!ready || storageBlocked || !canPlan || submitting || Boolean(pending) || !input.trim() || unfinishedRefs} className={cn('inline-flex min-h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-xs font-semibold text-white shadow-sm shadow-violet-500/20 motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 disabled:transform-none disabled:cursor-not-allowed disabled:opacity-40', focus)}>{submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}{submitting ? '正在提交' : '请助手规划'}</button></div>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{!connected ? state.backendStatus === 'unauthenticated' ? <Link href="/login" className="underline">登录后使用创作助手</Link> : '服务暂不可用，写好的内容会留在此处，恢复连接后再提交。' : !canPlan ? '暂未配置可用的文字规划模型，请联系管理员。' : 'Enter 换行，Ctrl / ⌘ + Enter 提交。生成步骤须确认；参考图先保存到你的素材库。'}</p>
    </form>
  </section>
}

function AgentRunPanel({ run, connected, onControl, onRetryTask }: { run: AgentRun; connected: boolean; onControl: (action: 'pause' | 'resume' | 'retry' | 'cancel' | 'approve') => Promise<void>; onRetryTask: (taskId: string) => Promise<void> }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const meta = statusMeta[run.status] || { label: '状态待确认', tone: 'muted' as Tone }
  async function act(key: string, work: () => Promise<void>) { if (lock.current || !connected) return; lock.current = true; setBusy(key); setError(''); try { await work() } catch (reason) { setError(errorText(reason)) } finally { lock.current = false; setBusy('') } }
  const canCancel = ['planning', 'awaiting_approval', 'running', 'paused'].includes(run.status)
  return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge><span className="text-xs text-muted-foreground">{run.pointsCost !== undefined ? `已计费 ${run.pointsCost} 积分` : '积分以任务账单为准'}</span></div>
    {run.failure && <p role="alert" className="text-xs text-destructive">{run.failure}</p>}
    {run.status === 'planning' && <p className="text-xs text-muted-foreground">正在根据这次提交的内容准备计划；尚未确认执行生成步骤。</p>}
    {run.status === 'awaiting_approval' && <div className="space-y-3 rounded-xl border border-violet-400/25 bg-violet-500/5 p-3"><h4 className="text-sm font-semibold">先看看这次计划</h4>{run.planApproval?.steps.length ? <><ol className="space-y-2">{run.planApproval.steps.map((step, index) => <li key={step.id} className="flex items-start gap-2 text-xs leading-5"><span className="text-violet-600 dark:text-violet-300">{index + 1}.</span><span className="flex-1">{step.title}<span className="block text-muted-foreground">{step.model || '服务端选定模型'} · {step.count} 项{step.estimatedPoints !== undefined ? ` · 预计 ${step.estimatedPoints} 积分` : ''}</span></span></li>)}</ol><p className="text-xs font-medium">预计共 {run.planApproval.totalPoints} 积分 · 最终以任务账单为准</p><ControlButton variant="primary" disabled={Boolean(busy) || !connected} onClick={() => void act('approve', () => onControl('approve'))}>{busy === 'approve' ? '正在确认…' : '确认计划并执行'}</ControlButton></> : <p className="text-xs text-muted-foreground">计划详情尚未完整返回，确认按钮将在内容就绪后显示。</p>}<p className="text-[11px] leading-5 text-muted-foreground">确认后会创建生成任务。结果请在任务与素材库中检查，再选择采用；不会自动替换当前镜头。</p></div>}
    {run.tasks.length > 0 && <ul className="space-y-2">{run.tasks.map((task) => <li key={task.id} className="rounded-lg border border-border/70 p-2.5"><p className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-medium">{task.title}</span><span className="text-muted-foreground">{{ pending: '等待中', queued: '排队中', running: '生成中', processing: '生成中', success: '已完成', completed: '已完成', error: '失败', failed: '失败', cancelled: '已取消' }[task.status] || '状态待确认'}</span></p><p className="mt-1 text-[11px] text-muted-foreground">{task.model}</p>{task.error && <p className="mt-1 text-xs text-destructive">{task.error}</p>}{['error', 'failed'].includes(task.status) && <button type="button" disabled={Boolean(busy) || !connected} className={cn('mt-2 rounded text-xs text-violet-600 underline dark:text-violet-300 disabled:opacity-40', focus)} onClick={() => void act(task.id, () => onRetryTask(task.id))}>{busy === task.id ? '正在重试…' : '重试这个步骤'}</button>}</li>)}</ul>}
    {run.cancellation && <p className="text-xs text-studio-warn">已请求取消，还有 {run.cancellation.pendingCount} 项等待确认。</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">{run.status === 'running' && <ControlButton size="sm" disabled={Boolean(busy) || !connected} onClick={() => void act('pause', () => onControl('pause'))}><CirclePause className="size-3.5" />暂停后续步骤</ControlButton>}{run.status === 'paused' && <ControlButton size="sm" disabled={Boolean(busy) || !connected} onClick={() => void act('resume', () => onControl('resume'))}><CirclePlay className="size-3.5" />继续</ControlButton>}{run.status === 'failed' && !run.tasks.length && <ControlButton size="sm" disabled={Boolean(busy) || !connected} onClick={() => void act('retry', () => onControl('retry'))}><RotateCcw className="size-3.5" />重新规划</ControlButton>}{canCancel && <ControlButton size="sm" disabled={Boolean(busy) || !connected} onClick={() => void act('cancel', () => onControl('cancel'))}><X className="size-3.5" />取消任务</ControlButton>}<Link href="/tasks" className={cn('rounded text-xs text-muted-foreground underline', focus)}>查看任务记录</Link>{run.status === 'completed' && <Link href="/library" className={cn('rounded text-xs text-violet-600 underline dark:text-violet-300', focus)}>查看生成素材</Link>}</div>
  </div>
}

/** Old local notes remain read-only and cannot be promoted into simulated executions. */
export function AgentPlanPanel({ planId }: { planId: string | null; onNotice?: (text: string) => void; hideTitle?: boolean; hideDestinations?: boolean }) {
  const { state } = useStudio()
  const plan = state.agentPlans.find((item) => item.id === planId)
  return <div className="space-y-3 p-4"><p className="text-sm font-medium">{plan?.title || '尚无计划'}</p><p className="text-xs leading-5 text-muted-foreground">历史本地草稿不会创建或完成生成任务。请向创作助手提交内容，查看服务端返回的计划并确认执行。</p></div>
}
export function DirectorAgentWorkspace({ projectId }: { projectId?: string; context?: string }) {
  return <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/5 via-card to-cyan-500/5 shadow-xl shadow-violet-950/5"><DirectorAgent projectId={projectId} /></div>
}
