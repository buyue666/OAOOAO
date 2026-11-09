'use client'

import { useEffect, useRef, useState } from 'react'
import { getDramaProject, saveDramaProject } from './api'
import { acknowledgeDramaSave, applyDramaProduction, cancelDramaProduction, createDramaProduction, dramaProductionLabels, listDramaProduction, quoteDramaProduction, type DramaProductionRequest, type DramaProductionStage, type DramaProductionTask, type DramaQuoteInput } from './drama-production'
import type { DramaProject } from './drama-types'
import type { ModelConfig } from './types'
import { createProjectRender, getProjectRender, getRenderCapability } from './creative-api'

const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'
type Quote = { input: DramaQuoteInput; points: number; version: string; requestId: string }
export function useDramaProduction(projectId: string, accountId: string, models: ModelConfig[]) {
  const [project, setProject] = useState<DramaProject | null>(null)
  const draft = useRef<DramaProject | null>(null), mounted = useRef(true)
  const edits = useRef(0), savedEdits = useRef(0), saveLock = useRef(false), actionLock = useRef(false)
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [tasks, setTasks] = useState<DramaProductionTask[]>([]), [taskRefresh, setTaskRefresh] = useState(0), [taskError, setTaskError] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null), [quoting, setQuoting] = useState(false), [working, setWorking] = useState(false)
  const [pending, setPending] = useState<DramaProductionRequest | null>(null), [recoveryBlocked, setRecoveryBlocked] = useState(false)
  const [renderAvailable, setRenderAvailable] = useState(false)
  const scope = `oao:drama-production:${accountId}:${projectId}`
  useEffect(() => {
    mounted.current = true
    void getDramaProject(projectId).then(loaded => { if (mounted.current) { draft.current = loaded; setProject(loaded); setLoading(false) } }).catch(reason => { if (mounted.current) { setError(message(reason)); setLoading(false) } })
    void getRenderCapability().then(available => { if (mounted.current) setRenderAvailable(available) }).catch(() => {})
    try {
      const raw = localStorage.getItem(scope)
      if (raw) { const restored = JSON.parse(raw); if (!restored?.clientRequestId || !restored.model || !restored.expectedUpdatedAt || typeof restored.approvedCost !== 'number' || !Number.isFinite(restored.approvedCost) || restored.approvedCost < 0 || !Object.hasOwn(dramaProductionLabels, restored.stage)) throw new Error('请求恢复信息损坏，请先在生成记录核对。'); setPending(restored) }
    } catch (reason) { setError(message(reason)); setRecoveryBlocked(true) }
    return () => { mounted.current = false }
  }, [projectId, scope])
  useEffect(() => {
    if (!dirty) return
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const loaded = await listDramaProduction(projectId)
        if (stopped) return
        setTasks(loaded); setTaskError('')
        timer = setTimeout(refresh, loaded.some(task => ['pending', 'running', 'paused'].includes(task.status)) ? 2500 : 10000)
      } catch (reason) { if (!stopped) { setTaskError(message(reason)); timer = setTimeout(refresh, 8000) } }
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [projectId, taskRefresh])
  const renderingIds = project?.episodes.filter(ep => ep.renderTask && ['pending', 'running'].includes(ep.renderTask.status)).map(ep => `${ep.id}:${ep.renderTask!.id}`).join('|') || ''
  const [renderTick, setRenderTick] = useState(0)
  useEffect(() => {
    if (!renderingIds) return
    let stopped = false
    const timer = setTimeout(async () => {
      for (const entry of renderingIds.split('|')) {
        const [epId, taskId] = entry.split(':')
        try { const next = await getProjectRender(taskId); if (!stopped) change(p => ({ ...p, episodes: p.episodes.map(ep => ep.id === epId ? { ...ep, renderTask: next } : ep) })) } catch (reason) { if (!stopped) setError(message(reason)) }
      }
      if (!stopped) setRenderTick(value => value + 1)
    }, 3000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [renderingIds, renderTick])
  function change(mutate: (project: DramaProject) => DramaProject) {
    if (!mounted.current || !draft.current) return
    const next = mutate(draft.current); draft.current = next; edits.current++; setProject(next); setDirty(true); setNotice('')
  }
  async function save(quiet = false): Promise<DramaProject | null> {
    if (!draft.current || saveLock.current) return null
    if (savedEdits.current === edits.current) return draft.current
    const submitted = draft.current, revision = edits.current
    saveLock.current = true; setSaving(true); setError('')
    try {
      const saved = await saveDramaProject(projectId, submitted, submitted.updatedAt)
      if (!mounted.current || !draft.current) return null
      const next = acknowledgeDramaSave(draft.current, submitted, saved)
      draft.current = next; savedEdits.current = revision; setProject(next); setDirty(edits.current !== revision)
      if (!quiet) setNotice(edits.current === revision ? '项目已保存。' : '已保存本次提交；保存期间的新修改仍保留在草稿中。')
      return edits.current === revision ? next : null
    } catch (reason) { if (mounted.current) setError(message(reason)); return null }
    finally { saveLock.current = false; if (mounted.current) setSaving(false) }
  }
  async function prepare(stage: DramaProductionStage, episodeId?: string, shotId?: string, instructions = '') {
    if (actionLock.current || pending || recoveryBlocked) return
    const capability = ['analysis', 'outline', 'script', 'assets', 'storyboard'].includes(stage) ? 'text' : stage
    const model = draft.current?.productionSettings?.[`${capability}Model` as 'textModel' | 'imageModel' | 'videoModel' | 'audioModel']
    if (!model || !models.some(item => item.id === model && item.capability === capability)) { setError('请先在制作设置中选择此步骤的可用模型。'); return 'settings' as const }
    actionLock.current = true; setQuoting(true); setError('')
    try {
      const saved = await save(true)
      if (!saved) { if (mounted.current) setError(value => value || '还有未保存的新修改，请保存后再生成。'); return }
      const shot = saved.episodes.find(ep => ep.id === episodeId)?.shots.find(item => item.id === shotId)
      if (stage === 'video' && !shot?.storyboardImageUrl && shot?.videoMode !== 'direct') throw new Error('请先生成并采用分镜图片，或选择直接文生视频。')
      const settings = saved.productionSettings || {}
      const config: Record<string, string | number> = stage === 'image' ? { ...(settings.resolution ? { resolution: settings.resolution } : {}), ...(settings.quality ? { quality: settings.quality } : {}) } : stage === 'video' ? { ...(settings.videoQuality ? { vquality: settings.videoQuality } : {}) } : stage === 'audio' && settings.voice ? { voice: settings.voice } : {}
      const input = { stage, model, episodeId, ...(['image', 'video', 'audio'].includes(stage) ? { shotId } : {}), instructions, config }
      const estimate = await quoteDramaProduction(projectId, input)
      if (mounted.current) setQuote({ input, points: estimate.points, version: saved.updatedAt, requestId: crypto.randomUUID() })
    } catch (reason) { if (mounted.current) setError(message(reason)) }
    finally { actionLock.current = false; if (mounted.current) setQuoting(false) }
  }
  async function submit(recover = false) {
    if (actionLock.current || (!pending && !quote)) return
    if (!recover && (dirty || draft.current?.updatedAt !== quote?.version)) { setError('内容或设置已变化，请重新预估费用。'); setQuote(null); return }
    const request = pending || { ...quote!.input, clientRequestId: quote!.requestId, expectedUpdatedAt: quote!.version, approvedCost: quote!.points }
    try { localStorage.setItem(scope, JSON.stringify(request)) } catch { setError('浏览器无法保存请求恢复标识，任务尚未提交。'); return }
    actionLock.current = true; setWorking(true); setPending(request); setError('')
    try {
      const task = await createDramaProduction(projectId, request)
      if (!mounted.current) return
      setTasks(value => [task, ...value.filter(item => item.id !== task.id)]); setTaskRefresh(value => value + 1); setQuote(null); setPending(null); localStorage.removeItem(scope)
      setNotice(`${dramaProductionLabels[task.stage]}已提交，预计 ${task.pointsCost} 积分。完成后可在制作记录中预览和采用。`)
    } catch (reason) { if (mounted.current) { const status = (reason as { status?: number }).status; if (status && status >= 400 && status < 500) { setPending(null); localStorage.removeItem(scope) } setError(message(reason)) } }
    finally { actionLock.current = false; if (mounted.current) setWorking(false) }
  }
  async function adopt(task: DramaProductionTask, replace = false) {
    if (actionLock.current) return null
    actionLock.current = true; setWorking(true); setError('')
    try {
      const saved = await save(true); if (!saved) return null
      const revision = edits.current
      const next = await applyDramaProduction(projectId, task.id, saved.updatedAt, replace)
      if (!mounted.current) return null
      if (edits.current !== revision) { setError('采用期间草稿发生变化，服务端已采用方案；请导出草稿后重新打开项目核对。'); return null }
      draft.current = next; setProject(next); savedEdits.current = edits.current; setDirty(false); setTaskRefresh(value => value + 1); setNotice('已采用方案并保存项目。'); return next
    } catch (reason) { if (mounted.current) setError(message(reason)); return null }
    finally { actionLock.current = false; if (mounted.current) setWorking(false) }
  }
  async function cancel(taskId: string) { try { await cancelDramaProduction(projectId, taskId); if (mounted.current) setTaskRefresh(value => value + 1) } catch (reason) { if (mounted.current) setError(message(reason)) } }
  async function render(episodeId: string) {
    if (actionLock.current || !renderAvailable) return
    actionLock.current = true; setWorking(true); setError('')
    try { const saved = await save(true); if (!saved) return; const result = await createProjectRender(saved, episodeId); if (mounted.current) { change(p => ({ ...p, episodes: p.episodes.map(ep => ep.id === episodeId ? { ...ep, renderTask: result } : ep) })); setNotice('成片合成任务已提交。') } }
    catch (reason) { if (mounted.current) setError(message(reason)) }
    finally { actionLock.current = false; if (mounted.current) setWorking(false) }
  }
  return { project, loading, dirty, saving, working, quoting, error, notice, tasks, taskError, quote, pending, recoveryBlocked, renderAvailable, setError, change, save, prepare, submit, adopt, cancel, render, closeQuote: () => { if (!actionLock.current && !pending) setQuote(null) }, refresh: () => setTaskRefresh(value => value + 1) }
}
