'use client'

import { MediaDownloadButton } from './media-download-button'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bot, Check, ChevronDown, Download, Film, GitBranch, Image as ImageIcon, Plus, Save, Sparkles } from 'lucide-react'
import { getDramaProject, saveDramaProject, StudioApiError } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { defaultGenerationDefaults, imageQualityOptions, qualityLabel } from '@/lib/studio/studio-models'
import { getGenerationTask, newClientRequestId } from '@/lib/studio/generation-api'
import { createProjectRender, getProjectRender, getRenderCapability, listShotCandidates, normalizeCandidateMedia, registerAdoptedShotCandidate, registerShotCandidate } from '@/lib/studio/creative-api'
import { adoptShotCandidate, buildProjectSrt, buildShotPrompt, newCreativeShot, shotReferences, updateCreativeShot, type ShotCandidate } from '@/lib/studio/creative-project'
import { creativeDraftStorageKey, parseCreativeDraft, restoreCreativeDraft, serializeCreativeDraft, type CreativeDraftBackup } from '@/lib/studio/creative-draft'
import type { DramaEpisode, DramaProject, DramaShot } from '@/lib/studio/drama-types'
import type { GenerationTaskView } from '@/lib/studio/generation-types'
import { dramaAssistantContext } from '@/lib/studio/director-context'
import { DirectorAgent } from './director-agent'
import { CreativeProjectCanvas } from './creative-project-canvas'
import { CreativeProjectAssets } from './creative-project-assets'
import { ControlButton, MediaThumb, PageHeader } from './ui'

const tabs = [{ id: 'shots', label: '镜头' }, { id: 'canvas', label: '画布' }, { id: 'assets', label: '主体与参考' }, { id: 'delivery', label: '交付' }] as const
type View = typeof tabs[number]['id']
const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 disabled:opacity-60'
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'

export function CreativeWorkspace({ projectId, initialView }: { projectId: string; initialView?: string }) {
  const { state, estimateCredits } = useStudio()
  const generation = useGeneration()
  const [project, setProject] = useState<DramaProject | null>(null)
  const projectRef = useRef<DramaProject | null>(null)
  const [draft, setDraft] = useState<DramaProject | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const scopeGeneration = useRef(0)
  const identity = `${state.user.id}:${projectId}:${state.backendStatus}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  const projectOwnerRef = useRef('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const [view, setView] = useState<View>(initialView === 'canvas' ? 'canvas' : initialView === 'delivery' || initialView === 'cut' ? 'delivery' : initialView === 'characters' ? 'assets' : 'shots')
  const [episodeId, setEpisodeId] = useState('')
  const [shotId, setShotId] = useState('')
  const [kind, setKind] = useState<'image' | 'video'>('image')
  const [modelId, setModelId] = useState('')
  const [direction, setDirection] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantVisited, setAssistantVisited] = useState(false)
  const [candidates, setCandidates] = useState<ShotCandidate[]>([])
  const [candidateError, setCandidateError] = useState('')
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidateRevision, setCandidateRevision] = useState(0)
  const [renderAvailable, setRenderAvailable] = useState<boolean | null>(null)
  const [renderCheckError, setRenderCheckError] = useState('')
  const [pollRevision, setPollRevision] = useState(0)
  const [pollError, setPollError] = useState('')
  const [renderRevision, setRenderRevision] = useState(0)
  const [draftBackup, setDraftBackup] = useState<CreativeDraftBackup | null>(null)
  const [draftBackupError, setDraftBackupError] = useState('')
  const backupKey = creativeDraftStorageKey(state.user.id, projectId)
  const backupKeyRef = useRef(backupKey)
  backupKeyRef.current = backupKey

  const accept = useCallback((value: DramaProject, clearBackup = false) => {
    projectOwnerRef.current = identityRef.current
    projectRef.current = value
    setProject(value)
    setDraft(value)
    setDirty(false)
    if (clearBackup) {
      try { sessionStorage.removeItem(backupKeyRef.current) } catch { /* The confirmed server save remains authoritative. */ }
      setDraftBackup(null)
      setDraftBackupError('')
    }
  }, [])

  const reload = useCallback(async () => {
    const token = ++scopeGeneration.current
    const account = identityRef.current
    setLoading(true); setError(''); setConflict(false); setPlanOpen(false)
    projectRef.current = null; setProject(null); setDraft(null)
    try {
      const loaded = await getDramaProject(projectId)
      if (token !== scopeGeneration.current || account !== identityRef.current) return
      accept(loaded)
      try {
        const raw = sessionStorage.getItem(creativeDraftStorageKey(state.user.id, projectId))
        const backup = parseCreativeDraft(raw, state.user.id, projectId)
        setDraftBackup(backup)
        setDraftBackupError(raw && !backup ? '浏览器中的草稿备份无效，未加载到项目。' : '')
      } catch { setDraftBackupError('当前浏览器无法读取草稿备份。') }
      const episode = loaded.episodes.find((item) => item.id === loaded.activeEpisodeId) ?? loaded.episodes[0]
      setEpisodeId(episode?.id ?? '')
      setShotId(episode?.shots[0]?.id ?? '')
    } catch (reason) { if (token === scopeGeneration.current && account === identityRef.current) setError(messageOf(reason)) }
    finally { if (token === scopeGeneration.current && account === identityRef.current) setLoading(false) }
  }, [accept, projectId, state.user.id])

  useEffect(() => {
    if (state.backendStatus !== 'connected') { projectRef.current = null; setProject(null); setDraft(null); setDirty(false); setDraftBackup(null); setDraftBackupError(''); setLoading(false); return }
    lock.current = false; setBusy(false); setCandidates([]); setPollError(''); setNotice(''); setDraftBackup(null); setDraftBackupError('')
    void reload()
    return () => { scopeGeneration.current += 1; projectRef.current = null }
  }, [reload, state.backendStatus, state.user.id])

  useEffect(() => {
    let active = true
    void getRenderCapability().then((available) => { if (active) setRenderAvailable(available) }).catch((reason) => { if (active) setRenderCheckError(messageOf(reason)) })
    return () => { active = false }
  }, [state.user.id])

  const episode = draft?.episodes.find((item) => item.id === episodeId) ?? draft?.episodes[0]
  const shot = episode?.shots.find((item) => item.id === shotId) ?? episode?.shots[0]
  const activeShotId = shot?.id ?? ''
  const activeEpisodeId = episode?.id ?? ''
  const pendingShots = project?.episodes.flatMap((item) => item.shots.filter((value) => (['queued', 'running'].includes(value.storyboardStatus ?? '') && value.storyboardTaskId) || (['queued', 'running'].includes(value.generationStatus ?? '') && value.generationTaskId))) ?? []
  const waiting = pendingShots.length > 0
  const renderingAny = Boolean(project?.episodes.some((item) => item.renderTask && ['pending', 'running'].includes(item.renderTask.status)))
  const models = state.liveModels.filter((model) => model.capability === kind)
  const model = models.find((item) => item.id === modelId) ?? models[0]
  const references = draft && shot ? shotReferences(draft, shot, kind) : []
  const defaults = defaultGenerationDefaults(state.sessionSettings)
  const preferredQuality = kind === 'image' ? defaults.imageQuality : defaults.videoQuality
  const resolution = kind === 'image' ? model?.capabilities.resolutions?.[0] || '1K' : undefined
  const availableQualities = kind === 'image' ? imageQualityOptions(model, resolution) : model?.capabilities.qualities || []
  const quality = availableQualities.includes(preferredQuality) ? preferredQuality : availableQualities[0] || preferredQuality
  const estimated = model ? estimateCredits(model.id, { quality, ...(kind === 'video' ? { duration: String(shot?.duration ?? 5) } : {}), count: 1 }) : 0
  const blockedTask = generation.tasks.find((task) => {
    const input = task.retryInput?.input
    return task.unconfirmed && input && 'projectId' in input && input.projectId === projectId
  })
  const orphanTasks = generation.tasks.filter((task) => {
    const input = task.retryInput?.input
    if (task.unconfirmed || !input || !('projectId' in input) || input.projectId !== projectId || !('episodeId' in input) || input.episodeId !== activeEpisodeId || !('shotId' in input) || input.shotId !== activeShotId || (task.kind !== 'image' && task.kind !== 'video')) return false
    const knownId = task.kind === 'image' ? shot?.storyboardTaskId : shot?.generationTaskId
    return task.id !== knownId && !candidates.some((candidate) => candidate.taskId === task.id)
  })

  useEffect(() => {
    if (!activeEpisodeId || !activeShotId) { setCandidates([]); return }
    let active = true
    setCandidates([]); setCandidateError(''); setCandidateLoading(true)
    const account = identityRef.current
    void listShotCandidates({ projectId, episodeId: activeEpisodeId, shotId: activeShotId }, { shouldContinue: () => active && account === identityRef.current }).then((result) => {
      if (!active) return
      setCandidates(result.candidates)
      if (result.truncated) setCandidateError('候选历史尚未全部加载，当前展示已核对的版本。')
    }).catch((reason) => { if (active) setCandidateError(messageOf(reason)) }).finally(() => { if (active) setCandidateLoading(false) })
    return () => { active = false }
  }, [projectId, activeEpisodeId, activeShotId, candidateRevision, state.user.id])

  // All writes use the version actually loaded by this editor. A conflict never triggers an overwrite.
  async function persist(next: DramaProject): Promise<DramaProject> {
    const current = projectRef.current
    const token = scopeGeneration.current
    const account = identityRef.current
    if (!current || projectOwnerRef.current !== identityRef.current || current.id !== next.id || next.id !== projectId) throw new Error('项目已切换，请重新读取')
    const saved = await saveDramaProject(projectId, next, current.updatedAt)
    if (token !== scopeGeneration.current || account !== identityRef.current || !projectRef.current) throw new Error('项目已切换，已忽略迟到的保存结果')
    accept(saved, true)
    return saved
  }

  async function action(work: () => Promise<void>, propagate = false) {
    if (lock.current) { if (propagate) throw new Error('项目正在处理，请稍后重试'); return }
    const token = scopeGeneration.current
    const account = identityRef.current
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await work() }
    catch (reason) {
      if (token !== scopeGeneration.current || account !== identityRef.current) { if (propagate) throw reason; return }
      setError(messageOf(reason))
      if (reason instanceof StudioApiError && reason.status === 409) setConflict(true)
      if (propagate) throw reason
    } finally { if (token === scopeGeneration.current && account === identityRef.current) { lock.current = false; setBusy(false) } }
  }

  function editShot(patch: Partial<DramaShot>) {
    if (!draft || !episode || !shot || busy || waiting || renderingAny) return
    setDraft(updateCreativeShot(draft, episode.id, shot.id, patch)); setDirty(true); setPlanOpen(false)
  }

  // Polling is tied to saved shot IDs, so refresh and selecting another shot do not change its target.
  const pendingKey = JSON.stringify(project?.episodes.flatMap((item) => item.shots.flatMap((value) => [
    ['queued', 'running'].includes(value.storyboardStatus ?? '') && value.storyboardTaskId ? [item.id, value.id, 'image', value.storyboardTaskId] : null,
    ['queued', 'running'].includes(value.generationStatus ?? '') && value.generationTaskId ? [item.id, value.id, 'video', value.generationTaskId] : null,
  ].filter(Boolean))) ?? [])
  useEffect(() => {
    if (pendingKey === '[]' || conflict) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const token = scopeGeneration.current
    const account = identityRef.current
    async function poll() {
      if (stopped || token !== scopeGeneration.current || account !== identityRef.current) return
      if (lock.current) { timer = setTimeout(poll, 2500); return }
      lock.current = true; setBusy(true)
      try {
        for (const [targetEpisode, targetShot, mediaKind, taskId] of JSON.parse(pendingKey) as string[][]) {
          const taskKind = mediaKind as 'image' | 'video'
          const response = await getGenerationTask(taskKind, taskId).catch(async (reason) => {
            if (reason instanceof StudioApiError && reason.status === 404 && !stopped && token === scopeGeneration.current && account === identityRef.current) {
              const current = projectRef.current
              if (current) await persist(updateCreativeShot(current, targetEpisode, targetShot, taskKind === 'image'
                ? { storyboardStatus: 'error', storyboardError: '原任务已不存在或过期，已采用的画面仍保留。' }
                : { generationStatus: 'error', generationError: '原任务已不存在或过期，已采用的视频仍保留。' }))
              return null
            }
            throw reason
          })
          if (stopped || token !== scopeGeneration.current || account !== identityRef.current) return
          if (!response) continue
          const task = response.data.task
          if (!['success', 'error', 'cancelled'].includes(task.status)) continue
          let current = projectRef.current
          if (!current) return
          if (task.status === 'success') {
            const media = normalizeCandidateMedia(taskKind, task.result)
            if (!media.length) throw new Error('任务已结束，但尚未返回可保存的媒体结果。请稍后重新检查。')
            for (const [index, result] of media.entries()) {
              if (stopped || token !== scopeGeneration.current || account !== identityRef.current) return
              await registerShotCandidate({ scope: { projectId, episodeId: targetEpisode, shotId: targetShot }, media: result, taskId, resultIndex: index, model: task.model, title: `${current.title} · 镜头候选`, shouldContinue: () => !stopped && token === scopeGeneration.current && account === identityRef.current })
            }
            if (stopped || token !== scopeGeneration.current || account !== identityRef.current) return
            setCandidateRevision((value) => value + 1)
            setNotice('新候选已保存。采用后才会替换镜头和交付视图中的版本。')
          }
          current = projectRef.current
          if (!current) return
          await persist(updateCreativeShot(current, targetEpisode, targetShot, taskKind === 'image'
            ? { storyboardStatus: task.status === 'success' ? 'success' : task.status === 'cancelled' ? 'cancelled' : 'error', storyboardError: task.error }
            : { generationStatus: task.status === 'success' ? 'success' : task.status === 'cancelled' ? 'cancelled' : 'error', generationError: task.error }))
        }
        if (!stopped && token === scopeGeneration.current && account === identityRef.current) setPollError('')
      } catch (reason) {
        if (!stopped && token === scopeGeneration.current && account === identityRef.current) {
          setPollError(messageOf(reason))
          if (reason instanceof StudioApiError && reason.status === 409) setConflict(true)
        }
        return // Resume only when the user requests another check; never retry failed writes blindly.
      } finally { if (token === scopeGeneration.current && account === identityRef.current) { lock.current = false; setBusy(false) } }
      if (!stopped && token === scopeGeneration.current && account === identityRef.current) timer = setTimeout(poll, 2500)
    }
    timer = setTimeout(poll, 500)
    return () => { stopped = true; clearTimeout(timer) }
  // persist reads the latest confirmed project through projectRef; inputs stay frozen in pendingKey.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, projectId, pollRevision, conflict])

  async function generateCandidate() {
    if (!project || !shot || !episode || !model || dirty || waiting || renderingAny || blockedTask || conflict || orphanTasks.length || candidateLoading || candidateError) return
    const target = { projectId, episodeId: episode.id, shotId: shot.id }
    const selectedKind = kind
    const token = scopeGeneration.current
    const account = identityRef.current
    await action(async () => {
      if (references.length > model.capabilities.maxReferences) throw new Error(`这个模型最多支持 ${model.capabilities.maxReferences} 张参考，请调整模型或参考。`)
      if (selectedKind === 'video' && references.length && !model.capabilities.firstFrame) throw new Error('这个模型不支持首帧参考，请选择支持首帧的视频模型。')
      await registerAdoptedShotCandidate(project, episode.id, shot.id, selectedKind, () => token === scopeGeneration.current && account === identityRef.current)
      if (token !== scopeGeneration.current || account !== identityRef.current) return
      const input = { ...target, model: model.id, prompt: buildShotPrompt(project, shot, selectedKind, direction), references, ratio: project.ratio, ...(selectedKind === 'image' ? { resolution: resolution || '1K' } : {}), quality, surface: 'drama' as const, clientRequestId: newClientRequestId(`creative-${selectedKind}`) }
      const task: GenerationTaskView = selectedKind === 'image' ? await generation.createImage({ ...input, count: 1 }) : await generation.createVideo({ ...input, seconds: shot.duration })
      if (token !== scopeGeneration.current || account !== identityRef.current) return
      if (task.unconfirmed) throw new Error('提交结果尚未确认，请到任务中心恢复原请求，避免重复提交。')
      const current = projectRef.current
      if (!current) return
      await persist(updateCreativeShot(current, target.episodeId, target.shotId, selectedKind === 'image'
        ? { storyboardTaskId: task.id, storyboardStatus: 'queued', storyboardError: undefined }
        : { generationTaskId: task.id, generationStatus: 'queued', generationError: undefined }))
      setPlanOpen(false); setNotice('已提交当前镜头，已采用版本会保留到你选择新候选。')
    })
  }

  const renderTask = project?.episodes.find((item) => item.id === activeEpisodeId)?.renderTask
  useEffect(() => {
    if (!renderTask || !['pending', 'running'].includes(renderTask.status)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const token = scopeGeneration.current
    const account = identityRef.current
    const targetEpisodeId = activeEpisodeId
    const isCurrent = () => !stopped && token === scopeGeneration.current && account === identityRef.current && projectRef.current?.id === projectId
    async function pollRender() {
      if (!isCurrent()) return
      if (lock.current || dirty) { timer = setTimeout(pollRender, 2500); return }
      try {
        const task = await getProjectRender(renderTask!.id)
        if (!isCurrent()) return
        if (lock.current) { timer = setTimeout(pollRender, 2500); return }
        if (task.status === 'pending' || task.status === 'running') { timer = setTimeout(pollRender, 2500); return }
        await action(async () => {
          const current = projectRef.current
          if (isCurrent() && current) await persist({ ...current, episodes: current.episodes.map((item) => item.id === targetEpisodeId && item.renderTask?.id === task.id ? { ...item, renderTask: task } : item) })
        })
      } catch (reason) {
        if (isCurrent()) {
          setError(messageOf(reason))
          if (reason instanceof StudioApiError && reason.status === 404) await action(async () => {
            const current = projectRef.current
            if (isCurrent() && current) await persist({ ...current, episodes: current.episodes.map((item) => item.id === targetEpisodeId && item.renderTask?.id === renderTask!.id ? { ...item, renderTask: { ...renderTask!, status: 'error', error: '原合成任务已不存在或过期，可以重新合成。' } } : item) })
          })
        }
      }
    }
    timer = setTimeout(pollRender, 2500)
    return () => { stopped = true; clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTask?.id, renderTask?.status, activeEpisodeId, projectId, state.user.id, dirty, renderRevision])

  const backUpDraft = useCallback(() => {
    const base = projectRef.current
    if (!dirty || !draft || !base || !state.user.id || projectOwnerRef.current !== identity || identityRef.current !== identity) return
    try {
      sessionStorage.setItem(backupKey, serializeCreativeDraft(state.user.id, base, draft))
      setDraftBackupError('')
    } catch { setDraftBackupError('当前浏览器无法备份草稿，请先保存项目再离开。') }
  }, [backupKey, dirty, draft, identity, state.user.id])

  useEffect(() => { backUpDraft() }, [backUpDraft])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { backUpDraft(); event.preventDefault(); event.returnValue = '' }
    const confirmNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      let target: URL
      try { target = new URL(anchor.href, window.location.href) } catch { return }
      const current = new URL(window.location.href)
      if (target.origin !== current.origin || (target.pathname === current.pathname && target.search === current.search)) return
      backUpDraft()
      if (!window.confirm('还有未保存的修改，确定离开吗？返回此项目时可以恢复当前标签页中的草稿备份。')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('popstate', backUpDraft)
    document.addEventListener('click', confirmNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('popstate', backUpDraft)
      document.removeEventListener('click', confirmNavigation, true)
    }
  }, [backUpDraft, dirty])

  if (loading || (project && projectOwnerRef.current !== identity)) return <div className="p-8 text-sm text-muted-foreground">正在打开创作项目…</div>
  if (!project || !draft || !episode) return <div className="space-y-4 p-8"><p role="alert">{error || '项目没有可编辑的内容。'}</p><ControlButton onClick={() => void reload()}>重新读取</ControlButton><Link href="/projects" className="ml-4 text-sm underline">返回项目</Link></div>
  const disabled = busy || waiting || conflict || renderingAny || Boolean(draftBackup)
  const generationDisabled = disabled || dirty || Boolean(blockedTask) || orphanTasks.length > 0 || candidateLoading || Boolean(candidateError)
  const missingTaskPointer = episode.shots.some((item) => (['queued', 'running'].includes(item.storyboardStatus ?? '') && !item.storyboardTaskId) || (['queued', 'running'].includes(item.generationStatus ?? '') && !item.generationTaskId))

  return <div className="mx-auto max-w-[1700px] space-y-6 p-4 md:p-8" data-testid="creative-workspace">
    <Link href="/projects" className="inline-flex items-center gap-2 text-xs text-muted-foreground"><ArrowLeft className="size-3.5" />我的项目</Link>
    <div className="rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-cyan-500/7 via-transparent to-violet-500/7 p-5 md:p-6"><PageHeader eyebrow="创作项目" title={project.title} description={project.summary || '从参考和镜头开始，逐步完成这件作品。'} actions={<>
      <span className="text-xs text-muted-foreground" aria-live="polite">{busy ? '正在处理…' : dirty ? '有未保存修改' : '已保存到项目'}</span>
      <button type="button" aria-expanded={assistantOpen} aria-controls="project-creative-assistant" onClick={() => { setAssistantVisited(true); setAssistantOpen((value) => !value) }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-md shadow-violet-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"><Bot className="size-4" aria-hidden="true" />创作助手<ChevronDown className={`size-3.5 motion-safe:transition-transform ${assistantOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
      <ControlButton variant="primary" disabled={!dirty || disabled} onClick={() => void action(async () => { await persist(draft); setNotice('项目已保存。') })}><Save className="size-4" />保存修改</ControlButton>
    </>} /><p className="mt-4 flex items-center gap-2 text-xs leading-5 text-muted-foreground"><Sparkles className="size-3.5 shrink-0 text-violet-500" aria-hidden="true" />助手可结合当前剧本与选中镜头，帮你完善想法、补充信息或准备生成计划。</p></div>
    <div id="project-creative-assistant" hidden={!assistantOpen}>{assistantVisited && <div className="h-[min(760px,85dvh)] min-h-[480px] overflow-hidden rounded-2xl border border-violet-400/25 bg-card shadow-lg shadow-violet-950/5"><DirectorAgent projectId={project.id} projectContext={dramaAssistantContext(draft, episode, shot, dirty)} /></div>}</div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}</div>}
    {draftBackupError && <p role="alert" className="text-sm text-destructive">{draftBackupError}</p>}
    {draftBackup && !dirty && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm" role="status"><span>{draftBackup.baseUpdatedAt === project.updatedAt ? '找到这个账号在当前标签页中未保存的草稿。' : '找到旧草稿，但服务器项目已经更新。请下载备份后手动合并，避免覆盖新内容。'}</span><ControlButton disabled={busy || waiting || renderingAny || conflict || draftBackup.baseUpdatedAt !== project.updatedAt} onClick={() => {
      try { setDraft(restoreCreativeDraft(project, draftBackup)); setDirty(true); setDraftBackup(null); setNotice('草稿已恢复，保存后才会写入项目。') }
      catch (reason) { setDraftBackupError(messageOf(reason)) }
    }}>恢复草稿</ControlButton><ControlButton onClick={() => downloadBlob(new Blob([JSON.stringify(draftBackup, null, 2)], { type: 'application/json' }), '创作项目_草稿备份.json')}>下载草稿备份</ControlButton><ControlButton disabled={busy} onClick={() => { try { sessionStorage.removeItem(backupKey) } catch { /* Dismiss this view even if browser storage is unavailable. */ } setDraftBackup(null) }}>忽略备份</ControlButton></div>}
    {conflict && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"><span>服务端数据已变化。当前草稿保留，可先下载备份，再重新读取。</span><ControlButton onClick={() => downloadJson(draft)}>下载当前草稿</ControlButton><ControlButton onClick={() => { if (!dirty || window.confirm('重新读取将替换未保存的草稿，继续吗？')) void reload() }}>重新读取</ControlButton></div>}
    {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
    {pollError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm"><span>候选结果尚未确认：{pollError}</span><ControlButton disabled={busy || conflict} onClick={() => setPollRevision((value) => value + 1)}>重新检查结果</ControlButton></div>}
    {blockedTask && <p className="text-sm">有一笔提交结果尚未确认。<Link className="underline" href="/tasks">前往任务中心恢复原请求</Link></p>}
    {renderingAny && <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">成片正在处理，采用版本暂时锁定。<ControlButton disabled={busy} onClick={() => setRenderRevision((value) => value + 1)}>重新检查成片</ControlButton></p>}
    {orphanTasks.length > 0 && !candidateLoading && <div className="space-y-2 rounded-lg border border-border p-3 text-sm"><p>这个镜头有已提交但尚未关联的任务。先检查原任务，可避免重复生成。</p>{orphanTasks.map((task) => <ControlButton key={task.id} disabled={disabled || dirty} onClick={() => void action(async () => {
      const current = projectRef.current
      if (!current || !episode || !shot) return
      await persist(updateCreativeShot(current, episode.id, shot.id, task.kind === 'image' ? { storyboardTaskId: task.id, storyboardStatus: 'queued', storyboardError: undefined } : { generationTaskId: task.id, generationStatus: 'queued', generationError: undefined }))
      setPollRevision((value) => value + 1)
      setNotice('已关联原任务，将读取结果；没有创建新的生成任务。')
    })}>关联并检查原任务 · {task.id.slice(-8)}</ControlButton>)}</div>}
    {missingTaskPointer && <div className="flex flex-wrap items-center gap-3 text-sm"><span>部分旧镜头标为排队，但没有任务编号。可清除这些无法查询的状态。</span><ControlButton disabled={disabled || dirty} onClick={() => void action(async () => {
      await persist({ ...project, episodes: project.episodes.map((item) => item.id !== episode.id ? item : { ...item, shots: item.shots.map((value) => ({ ...value, ...(['queued', 'running'].includes(value.storyboardStatus ?? '') && !value.storyboardTaskId ? { storyboardStatus: 'idle' as const } : {}), ...(['queued', 'running'].includes(value.generationStatus ?? '') && !value.generationTaskId ? { generationStatus: 'idle' as const } : {}) })) }) })
      setNotice('已清除没有任务编号的旧状态，没有提交生成。')
    })}>清除无编号状态</ControlButton></div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
      <nav className="flex flex-wrap gap-1" aria-label="项目视图">{tabs.map((tab) => <button type="button" key={tab.id} aria-pressed={view === tab.id} onClick={() => setView(tab.id)} className={`rounded-t-lg border-b-2 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${view === tab.id ? 'border-cyan-500 bg-cyan-500/7 text-cyan-700 dark:text-cyan-300' : 'border-transparent text-muted-foreground hover:bg-muted'}`}>{tab.label}</button>)}</nav>
      <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">分集<select aria-label="当前分集" className="max-w-52 rounded border border-border bg-background px-2 py-1 text-foreground" value={activeEpisodeId} onChange={(event) => { setEpisodeId(event.target.value); setShotId(''); setPlanOpen(false) }}>{draft.episodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    </div>
    {view === 'assets' ? <CreativeProjectAssets project={draft} disabled={disabled || dirty} onSave={async (next) => { await action(async () => { await persist(next); setNotice('主体与参考已保存。') }, true) }} /> : view === 'delivery' ? <Delivery project={draft} episode={episode} disabled={disabled || dirty} renderAvailable={renderAvailable} renderCheckError={renderCheckError} onRender={() => void action(async () => {
      const token = scopeGeneration.current
      const account = identityRef.current
      const targetEpisodeId = episode.id
      const targetProjectId = project.id
      const task = await createProjectRender(project, targetEpisodeId)
      const current = projectRef.current
      if (token !== scopeGeneration.current || account !== identityRef.current || current?.id !== targetProjectId) return
      await persist({ ...current, episodes: current.episodes.map((item) => item.id === targetEpisodeId ? { ...item, renderTask: task } : item) })
      setNotice('成片任务已提交，可在这里查看结果。')
    })} /> : <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        {view === 'canvas' ? <CreativeProjectCanvas project={draft} episode={episode} selectedShotId={activeShotId} onSelectShot={(id) => { setShotId(id); setPlanOpen(false) }} /> : <>
          <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">创作描述与剧本</summary><textarea aria-label="项目剧本" className={`${field} mt-3 min-h-32`} disabled={disabled} value={episode.script} onChange={(event) => { setDraft({ ...draft, episodes: draft.episodes.map((item) => item.id === episode.id ? { ...item, script: event.target.value, scriptRichContent: undefined } : item) }); setDirty(true) }} /></details>
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-medium">先选好画面，再让它动起来</h2><p className="mt-1 text-xs text-muted-foreground">每次生成新增候选，采用版本贯穿画布与交付。</p></div><ControlButton disabled={disabled} onClick={() => {
            const nextShot = newCreativeShot(episode.shots.length + 1)
            setDraft({ ...draft, episodes: draft.episodes.map((item) => item.id === episode.id ? { ...item, shots: [...item.shots, nextShot], renderTask: undefined } : item) })
            setShotId(nextShot.id); setDirty(true); setPlanOpen(false)
          }}><Plus className="size-4" />添加镜头</ControlButton></div>
          {episode.shots.length ? <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{episode.shots.map((item, index) => <button type="button" key={item.id} aria-pressed={item.id === activeShotId} onClick={() => { setShotId(item.id); setPlanOpen(false) }} className={`min-w-0 overflow-hidden rounded-xl border bg-card text-left ${item.id === activeShotId ? 'border-foreground ring-1 ring-foreground' : 'border-border'}`}>
            <MediaThumb src={item.storyboardImageUrl || item.videoUrl} kind={item.storyboardImageUrl ? 'image' : item.videoUrl ? 'video' : 'image'} alt={item.title} fallback="等待第一版画面" className="aspect-video" />
            <div className="space-y-1 p-3"><p className="text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')} / {item.duration} 秒</p><h3 className="truncate text-sm font-medium">{item.title}</h3><p className="text-xs text-muted-foreground">{['queued', 'running'].includes(item.storyboardStatus ?? '') || ['queued', 'running'].includes(item.generationStatus ?? '') ? '新候选生成中' : item.storyboardImageUrl || item.videoUrl ? '已有采用版本' : '尚未采用画面'}</p></div>
          </button>)}</div> : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">添加第一个镜头，填写画面描述并关联主体。</div>}
        </>}
        {shot && <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="镜头编辑">
          <div className="grid gap-3 sm:grid-cols-[1fr_100px]"><label className="space-y-1.5 text-xs text-muted-foreground">镜头名称<input className={field} disabled={disabled} value={shot.title} onChange={(event) => editShot({ title: event.target.value })} /></label><label className="space-y-1.5 text-xs text-muted-foreground">时长（秒）<input type="number" min="1" max="60" className={field} disabled={disabled} value={shot.duration} onChange={(event) => editShot({ duration: Math.max(1, Math.min(60, Number(event.target.value) || 1)) })} /></label></div>
          <label className="block space-y-1.5 text-xs text-muted-foreground">画面描述<textarea className={`${field} min-h-24`} disabled={disabled} value={shot.description} onChange={(event) => editShot({ description: event.target.value, imagePrompt: event.target.value })} /></label>
          <label className="block space-y-1.5 text-xs text-muted-foreground">镜头运动与视频描述<textarea className={field} disabled={disabled} value={shot.videoPrompt} onChange={(event) => editShot({ videoPrompt: event.target.value })} placeholder="描述这个镜头中主体如何运动、镜头如何移动，以及需要保留的细节" /></label>
          <label className="block space-y-1.5 text-xs text-muted-foreground">自定义字幕<input className={field} disabled={disabled} value={shot.subtitle || ''} onChange={(event) => editShot({ subtitle: event.target.value })} placeholder={shot.dialogue || shot.narration || '填写这个镜头的字幕'} /></label>
          {!shot.subtitle && (shot.dialogue || shot.narration) && <p className="text-xs text-muted-foreground">未填写自定义字幕时，交付使用原对白或旁白：{shot.dialogue || shot.narration}</p>}
          {(draft.characters.length > 0 || draft.props.length > 0 || draft.scenes.length > 0) && <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 text-xs text-muted-foreground">这个镜头引用的主体</legend><div className="flex flex-wrap gap-3">{(['characters', 'props'] as const).flatMap((group) => draft[group].map((asset) => {
            const key = group === 'characters' ? 'characterIds' : 'propIds'
            return <label key={asset.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={shot[key].includes(asset.id)} onChange={(event) => editShot({ [key]: event.target.checked ? [...shot[key], asset.id] : shot[key].filter((id) => id !== asset.id) })} />{asset.name}</label>
          }))}</div>{draft.scenes.length > 0 && <select aria-label="镜头场景" className={field} value={shot.sceneId || ''} onChange={(event) => editShot({ sceneId: event.target.value || undefined })}><option value="">未关联场景</option>{draft.scenes.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>}</fieldset>}
        </section>}
        {shot && <section className="space-y-3" aria-label="候选版本"><div className="flex items-center justify-between"><h2 className="text-sm font-medium">候选版本</h2><ControlButton size="sm" disabled={candidateLoading} onClick={() => setCandidateRevision((value) => value + 1)}>刷新候选</ControlButton></div>
          {candidateError && <p role="alert" className="text-sm text-destructive">{candidateError}</p>}
          {candidateLoading ? <p className="text-sm text-muted-foreground">读取候选版本…</p> : !candidates.length ? <p className="text-sm text-muted-foreground">生成完成后在这里比较候选；已采用的旧画面会保留。</p> : <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{candidates.map((candidate, index) => {
            const adopted = (candidate.kind === 'image' ? shot.storyboardImageUrl : shot.videoUrl) === candidate.url
            return <article key={candidate.key} className="overflow-hidden rounded-xl border border-border bg-card"><MediaThumb src={candidate.url} kind={candidate.kind} alt={`候选 ${index + 1}`} fallback="媒体暂不可用" className="aspect-video" /><div className="flex flex-wrap items-center justify-between gap-2 p-3"><span className="text-xs text-muted-foreground">{candidate.kind === 'image' ? '画面' : '视频'} · {index + 1}</span><ControlButton size="sm" disabled={adopted || disabled || dirty} variant={adopted ? 'secondary' : 'primary'} onClick={() => void action(async () => {
              await persist(adoptShotCandidate(project, episode.id, shot.id, candidate)); setNotice('已采用这个版本，画布与交付同步更新。')
            })}>{adopted ? <><Check className="size-3.5" />已采用</> : '采用版本'}</ControlButton></div></article>
          })}</div>}
        </section>}
      </div>
      <aside className="h-fit space-y-4 rounded-xl border border-border bg-card p-5 xl:sticky xl:top-20" aria-label="镜头创作">
        <h2 className="flex items-center gap-2 font-medium"><Sparkles className="size-4" />镜头创作</h2>
        <p className="text-xs text-muted-foreground">{shot ? `当前对象：${shot.title}` : '先添加并选择一个镜头'}</p>
        <div className="grid grid-cols-2 gap-2"><ControlButton variant={kind === 'image' ? 'primary' : 'secondary'} onClick={() => { setKind('image'); setPlanOpen(false) }}><ImageIcon className="size-4" />画面候选</ControlButton><ControlButton variant={kind === 'video' ? 'primary' : 'secondary'} onClick={() => { setKind('video'); setPlanOpen(false) }}><Film className="size-4" />让画面动起来</ControlButton></div>
        <label className="block space-y-1.5 text-xs text-muted-foreground">模型<select className={field} aria-label="创作模型" value={model?.id || ''} onChange={(event) => { setModelId(event.target.value); setPlanOpen(false) }}>{models.length ? models.map((item) => <option value={item.id} key={item.id}>{item.name}</option>) : <option value="">暂无可用模型</option>}</select></label>
        <label className="block space-y-1.5 text-xs text-muted-foreground">这次想调整什么<textarea className={`${field} min-h-24`} disabled={!shot || busy} value={direction} onChange={(event) => { setDirection(event.target.value); setPlanOpen(false) }} placeholder="例如：让杯沿的光更柔和，保留产品外观" /></label>
        <p className="text-xs leading-5 text-muted-foreground">{references.length ? `引用 ${references.length} 张参考${kind === 'video' && shot?.storyboardImageUrl ? '，使用已采用画面作为首帧' : ''}。` : '当前没有关联图片参考。'} 每次只生成当前镜头的新候选。</p>
        <p className="text-xs text-muted-foreground">{draft.ratio} · {qualityLabel(quality, model?.capabilities.qualityLabels)}{kind === 'video' && shot ? ` · ${shot.duration} 秒` : ''}</p>
        {dirty && <p className="text-xs text-muted-foreground">先保存修改，再生成新候选。</p>}
        {waiting && <p className="text-xs text-muted-foreground">正在生成候选，完成后可继续修改。</p>}
        <ControlButton className="w-full" disabled={!shot || !model || generationDisabled} onClick={() => { try { buildShotPrompt(draft, shot!, kind, direction); setPlanOpen(true); setError('') } catch (reason) { setError(messageOf(reason)) } }}><GitBranch className="size-4" />查看本次生成计划</ControlButton>
        {planOpen && shot && <div className="space-y-3 border-t border-border pt-4"><p className="text-sm">仅为「{shot.title}」新增一个{kind === 'image' ? '画面' : '视频'}候选，保留当前采用版本。</p><p className="text-xs text-muted-foreground">预估 {estimated} 积分 · 最终以任务账单为准</p><ControlButton className="w-full" variant="primary" disabled={generationDisabled} onClick={() => void generateCandidate()}>确认生成候选</ControlButton></div>}
        {(shot?.storyboardError || shot?.generationError) && <p role="alert" className="text-xs text-destructive">{shot.storyboardError || shot.generationError}</p>}
        <Link className="inline-block text-xs text-muted-foreground underline" href="/tasks">查看任务与恢复操作</Link>
      </aside>
    </div>}
  </div>
}

function Delivery({ project, episode, disabled, renderAvailable, renderCheckError, onRender }: { project: DramaProject; episode: DramaEpisode; disabled: boolean; renderAvailable: boolean | null; renderCheckError: string; onRender: () => void }) {
  const ready = episode.shots.length > 0 && episode.shots.every((shot) => Boolean(shot.videoUrl))
  const rendering = episode.renderTask && ['pending', 'running'].includes(episode.renderTask.status)
  const srt = buildProjectSrt(episode)
  return <section className="space-y-5" aria-label="作品交付"><div><h2 className="font-medium">这件作品的交付版本</h2><p className="mt-1 text-sm text-muted-foreground">使用每个镜头当前采用的视频、声音和字幕。</p></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{episode.shots.map((shot, index) => <article key={shot.id} className="overflow-hidden rounded-xl border border-border bg-card">{shot.videoUrl ? <video controls controlsList="nodownload" playsInline preload="metadata" src={shot.videoUrl} poster={shot.storyboardImageUrl} className="aspect-video w-full bg-black" aria-label={`${shot.title} 已采用视频`} /> : <MediaThumb src={shot.storyboardImageUrl} alt={shot.title} fallback="尚未采用视频" className="aspect-video" />}<div className="space-y-1 p-3"><p className="text-sm">{index + 1}. {shot.title}</p><p className="text-xs text-muted-foreground">{shot.duration} 秒 · {shot.videoUrl ? '已采用视频' : '等待视频版本'}</p>{shot.subtitle && <p className="text-xs text-muted-foreground">{shot.subtitle}</p>}</div></article>)}</div>
    <div className="flex flex-wrap gap-3"><ControlButton variant="primary" disabled={disabled || !ready || !renderAvailable || Boolean(rendering)} onClick={onRender}><Film className="size-4" />{rendering ? '成片处理中…' : '合成成片'}</ControlButton><ControlButton disabled={!srt || disabled} onClick={() => downloadBlob(new Blob([srt], { type: 'text/plain;charset=utf-8' }), `${project.title}.srt`)}><Download className="size-4" />导出字幕</ControlButton><ControlButton disabled={disabled} onClick={() => downloadJson(project)}><Download className="size-4" />保存项目文件</ControlButton></div>
    {!ready && <p className="text-sm text-muted-foreground">每个镜头采用视频版本后，即可合成成片。</p>}
    {renderAvailable === false && <p className="text-sm text-muted-foreground">当前服务器未启用成片合成。已选镜头和字幕可继续使用。</p>}
    {renderCheckError && <p role="alert" className="text-sm text-destructive">合成服务读取失败：{renderCheckError}</p>}
    {episode.renderTask?.error && <p role="alert" className="text-sm text-destructive">{episode.renderTask.error}</p>}
    {episode.renderTask?.status === 'success' && episode.renderTask.result?.url && <div className="space-y-3"><video controls controlsList="nodownload" playsInline src={episode.renderTask.result.url} className="max-h-[560px] w-full rounded-xl bg-black" aria-label="已合成作品" /><MediaDownloadButton media={{ url: episode.renderTask.result.url, kind: 'video' }} title={project.title} taskId={episode.renderTask.id} label="下载成片" className="inline-flex items-center gap-2 text-sm underline disabled:opacity-50" /></div>}
  </section>
}

function downloadJson(project: DramaProject) { downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${project.title || '创作项目'}.json`) }
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name.replace(/[<>:"/\\|?*]/g, '_'); link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
