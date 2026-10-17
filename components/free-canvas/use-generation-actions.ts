import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createLibraryAsset, listLibraryAssets } from '@/lib/studio/account-api'
import { composeSkillPrompt, resolveCanvasSkills } from '@/lib/studio/canvas-skills'
import { cancelGenerationTask, getGenerationTask, newClientRequestId, normalizeTaskResult } from '@/lib/studio/generation-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { GenerationTaskView, SessionGenerationSettings, SessionLogicalModel } from '@/lib/studio/generation-types'
import { isSubmittableReferenceUrl } from '@/lib/studio/reference-assets'
import { defaultModelFor, filterModelsByCapability } from '@/lib/studio/studio-models'
import { useStudio } from '@/lib/studio/store'
import type { ModelConfig } from '@/lib/studio/types'
import { useCanvasStore, type RemoteNodePatch } from './canvas-store'
import { flushCanvasSave } from './canvas-persistence'
import type { FreeCanvasEdge, FreeCanvasNode, GenerationFlowNode, GenerationKind, GenerationNodeData, NodeReference, NodeResult, NodeSubmission, NodeTask, TaskPhase } from './types'

const CAPABILITY: Record<GenerationKind, SessionLogicalModel['capability']> = {
  image: 'image',
  video: 'video',
  text: 'text',
  audio: 'audio',
}

const DEFAULT_REFERENCE_LIMIT = 4

export function errorMessageOf(error: unknown) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message ? error.message : '请求失败，请稍后重试'
}

function phaseOf(view: Pick<GenerationTaskView, 'status'>): TaskPhase {
  if (view.status === 'success') return 'success'
  if (view.status === 'error') return 'error'
  if (view.status === 'cancelled') return 'cancelled'
  if (view.status === 'pending') return 'queued'
  return 'running'
}

function resultsOf(view: GenerationTaskView): NodeResult[] {
  return view.media.map((media) => ({ url: media.url, poster: media.poster, mediaKind: media.kind }))
}

function sameResults(a: NodeResult[], b: NodeResult[]) {
  return a.length === b.length && a.every((item, index) => item.url === b[index].url && item.poster === b[index].poster)
}

function sameTask(a: NodeTask | null, b: NodeTask) {
  return !!a && a.id === b.id && a.phase === b.phase && a.error === b.error && Boolean(a.cancelRequested) === Boolean(b.cancelRequested)
}

/** 把生成接口的任务状态映射到节点：只产出真正变化的补丁，避免无意义的保存。 */
export function collectTaskPatches(nodes: FreeCanvasNode[], tasks: GenerationTaskView[]): RemoteNodePatch[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const patches: RemoteNodePatch[] = []
  for (const node of nodes) {
    if (node.type !== 'generation' || !node.data.task?.id) continue
    const view = byId.get(node.data.task.id)
    if (!view) continue
    const phase = phaseOf(view)
    const task: NodeTask = { ...node.data.task, phase, cancelRequested: Boolean(view.cancelRequested && (phase === 'queued' || phase === 'running')), error: phase === 'error' ? view.error || '生成失败' : undefined }
    const results = phase === 'success' ? resultsOf(view) : node.data.results
    const text = phase === 'success' ? view.text ?? node.data.text : node.data.text
    const resultsChanged = !sameResults(results, node.data.results)
    if (sameTask(node.data.task, task) && !resultsChanged && text === node.data.text) continue
    // The source describes the old library output, not future generations on
    // this node. Preserve it while pending/failed or re-reading that same output.
    const outputReplaced = phase === 'success' && (resultsChanged || text !== node.data.text)
    patches.push({ id: node.id, data: { task, results, text, ...(outputReplaced ? { resultSource: undefined } : {}) } })
  }
  return patches
}

function maxReferencesOf(kind: GenerationKind, model: ModelConfig | undefined) {
  if (kind === 'text' || kind === 'audio') return 0
  const configured = model?.capabilities.maxReferences ?? 0
  return configured > 0 ? configured : DEFAULT_REFERENCE_LIMIT
}

function referencesFor(nodeId: string, data: GenerationNodeData, maxReferences: number, nodes: FreeCanvasNode[], edges: FreeCanvasEdge[]) {
  const upstream: NodeReference[] = []
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const source = nodes.find((node) => node.id === edge.source)
    if (!source) continue
    if (source.type === 'media' && source.data.media) upstream.push(source.data.media)
    if (source.type === 'generation' && (source.data.kind === 'image' || source.data.kind === 'video') && source.data.results[0]) {
      const result = source.data.results[0]
      upstream.push({ id: source.id, title: source.data.title, url: result.url, mediaKind: result.mediaKind })
    }
  }
  const seen = new Set<string>()
  const candidates: NodeReference[] = []
  for (const reference of [...upstream, ...data.references]) {
    if (!isSubmittableReferenceUrl(reference.url) || seen.has(reference.url)) continue
    seen.add(reference.url)
    candidates.push(reference)
  }
  return candidates.slice(0, maxReferences).map((reference) => ({ name: reference.title, type: reference.mediaKind, url: reference.url.trim() }))
}

function setTask(nodeId: string, task: NodeTask | null) {
  useCanvasStore.getState().patchNodes([{ id: nodeId, data: { task } }])
}

function generationNodeOf(nodeId: string) {
  return useCanvasStore.getState().nodes.find((node): node is GenerationFlowNode => node.id === nodeId && node.type === 'generation')
}

export function useGenerationActions() {
  const generation = useGeneration()
  const studio = useStudio()
  const models = studio.state.models
  const settings: SessionGenerationSettings | undefined = studio.state.sessionSettings
  const nodes = useCanvasStore((state) => state.nodes)
  const { tasks } = generation
  const { estimateCredits } = studio
  const mounted = useRef(true)
  const account = useRef(studio.state.user.id)
  account.current = studio.state.user.id
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const currentScope = useCallback(() => {
    const { projectId, projectMeta } = useCanvasStore.getState()
    const owner = account.current
    return () => {
      const current = useCanvasStore.getState()
      return mounted.current && account.current === owner && current.projectId === projectId && current.projectMeta === projectMeta && current.hydrated
    }
  }, [])

  useEffect(() => {
    const patches = collectTaskPatches(useCanvasStore.getState().nodes, tasks)
    if (patches.length) useCanvasStore.getState().patchNodes(patches)
  }, [tasks, nodes])

  const submitNode = useCallback(async (nodeId: string) => {
    const state = useCanvasStore.getState()
    const node = generationNodeOf(nodeId)
    if (!node || !state.projectId || !node.data.prompt.trim()) return
    if (node.data.task?.phase === 'queued' || node.data.task?.phase === 'running') return
    const data = node.data
    const scopeCurrent = currentScope()
    const previous = data.task
    let submission = previous?.unconfirmed ? previous.submission : undefined
    if (previous?.unconfirmed && !submission) return state.setNotice('上次提交尚未确认且缺少恢复参数，请到任务记录核对，勿重复生成。')
    const clientRequestId = submission?.input.clientRequestId || newClientRequestId(`canvas-${data.kind}`)
    const current = () => scopeCurrent() && generationNodeOf(nodeId)?.data.task?.clientRequestId === clientRequestId
    const capability = CAPABILITY[data.kind]
    const modelId = data.model || defaultModelFor(capability, settings, filterModelsByCapability(models, capability))
    const model = models.find((item) => item.id === modelId)
    const references = referencesFor(nodeId, data, maxReferencesOf(data.kind, model), state.nodes, state.edges)
    const pending: NodeTask = { id: '', phase: 'queued', startedAt: Date.now(), clientRequestId, submission }
    setTask(nodeId, pending)
    let submitted = false
    try {
      if (!submission) {
        const skills = await resolveCanvasSkills(data.skills.map((skill) => skill.id), (page) => listLibraryAssets({ kind: 'text', pageSize: 100, page }))
        if (!current()) return
        const prompt = composeSkillPrompt(data.prompt, skills)
        const common = { prompt, model: modelId, clientRequestId }
        const context = { projectId: state.projectId, surface: 'canvas' as const }
        submission = data.kind === 'image'
          ? { kind: 'image', input: { ...common, ...context, ratio: data.ratio, resolution: data.resolution, quality: data.quality, count: 1, references, title: data.title } }
          : data.kind === 'video'
            ? { kind: 'video', input: { ...common, ...context, ratio: data.ratio, quality: data.quality, seconds: data.seconds, references } }
            : data.kind === 'audio'
              ? { kind: 'audio', input: { ...common, ...context, voice: data.voice, format: data.format } }
              : { kind: 'text', input: common }
      }
      // Save the immutable identity before a request can charge points. Reloads
      // can then recover the same request even if the response never arrives.
      setTask(nodeId, { ...pending, submission })
      await flushCanvasSave()
      if (!current()) return
      const saved = useCanvasStore.getState()
      if (saved.revision !== saved.savedRevision) throw new Error('画布尚未保存，生成请求未发送。请先处理保存冲突或重试保存。')
      submitted = true
      const view = submission.kind === 'image' ? await generation.createImage(submission.input)
        : submission.kind === 'video' ? await generation.createVideo(submission.input)
          : submission.kind === 'audio' ? await generation.createAudio(submission.input)
            : await generation.createText(submission.input)
      if (!current()) return
      setTask(nodeId, { id: view.id, phase: phaseOf(view), startedAt: pending.startedAt, clientRequestId })
    } catch (error) {
      if (!current()) return
      const definite = error && typeof error === 'object' && (('indeterminate' in error && error.indeterminate === false) || ('outcome' in error && ['rejected', 'failed', 'expired', 'not-found'].includes(String(error.outcome))))
      const unconfirmed = Boolean(previous?.unconfirmed || (submitted && !definite))
      setTask(nodeId, { ...pending, submission, phase: 'error', unconfirmed, error: unconfirmed ? `提交结果未确认；重试会使用原参数核对，不会重复扣费。${errorMessageOf(error)}` : errorMessageOf(error) })
    }
  }, [generation, models, settings, currentScope])

  const cancelNode = useCallback(async (nodeId: string) => {
    const node = generationNodeOf(nodeId)
    const task = node?.data.task
    if (!node || !task?.id || task.cancelRequested) return
    const scopeCurrent = currentScope()
    const current = () => scopeCurrent() && generationNodeOf(nodeId)?.data.task?.id === task.id
    try {
      const view = generation.tasks.find((item) => item.id === task.id)
      const remote = view ? await generation.cancelTask(view) : (await cancelGenerationTask(node.data.kind, task.id)).data.task
      if (!current()) return
      const phase = phaseOf(remote)
      const waiting = phase === 'queued' || phase === 'running'
      setTask(nodeId, { ...task, phase, cancelRequested: waiting, error: phase === 'error' ? remote.error || '生成失败' : undefined })
      useCanvasStore.getState().setNotice(waiting ? '取消请求已发送，尚未确认停止。请继续检查状态，确认前不能重新生成。' : phase === 'cancelled' ? '任务已确认取消' : '任务已结束，请核对最终结果。')
    } catch (error) {
      if (current()) useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [generation, currentScope])

  /** 任务列表里找不到（例如换设备）时，直接向后端确认一次真实状态。 */
  const checkNode = useCallback(async (nodeId: string) => {
    const node = generationNodeOf(nodeId)
    const task = node?.data.task
    if (!node || !task?.id) return
    const scopeCurrent = currentScope()
    const current = () => scopeCurrent() && generationNodeOf(nodeId)?.data.task?.id === task.id
    try {
      const remote = (await getGenerationTask(node.data.kind, task.id)).data.task
      if (!current()) return
      const normalized = normalizeTaskResult(node.data.kind, remote.result)
      const phase: TaskPhase = remote.status === 'success'
        ? 'success'
        : remote.status === 'error'
          ? 'error'
          : remote.status === 'cancelled'
            ? 'cancelled'
            : remote.status === 'pending'
              ? 'queued'
              : 'running'
      const results: NodeResult[] = remote.status === 'success'
        ? normalized.media.map((media) => ({ url: media.url, poster: media.poster, mediaKind: media.kind }))
        : node.data.results
      const text = phase === 'success' ? normalized.text ?? node.data.text : node.data.text
      const outputReplaced = phase === 'success' && (!sameResults(results, node.data.results) || text !== node.data.text)
      useCanvasStore.getState().patchNodes([{
        id: nodeId,
        data: { task: { ...task, phase, cancelRequested: Boolean(remote.cancelRequested && (phase === 'queued' || phase === 'running')), error: phase === 'error' ? remote.error || '生成失败' : undefined }, results, text, ...(outputReplaced ? { resultSource: undefined } : {}) },
      }])
    } catch (error) {
      if (current()) useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [currentScope])

  const saveResultToLibrary = useCallback(async (nodeId: string, index: number) => {
    const node = generationNodeOf(nodeId)
    const result = node?.data.results[index]
    if (!node || !result) return
    try {
      const isImage = result.mediaKind === 'image'
      await createLibraryAsset({
        kind: result.mediaKind,
        title: `${node.data.title} ${index + 1}`.slice(0, 120),
        coverUrl: result.poster ?? (isImage ? result.url : undefined),
        tags: ['收藏'],
        source: 'canvas-favorite',
        data: {
          serverUrl: result.url,
          url: isImage ? undefined : result.url,
          dataUrl: isImage ? result.url : undefined,
          mediaKind: result.mediaKind,
          assetRole: 'general',
        },
      })
      useCanvasStore.getState().setNotice('已收藏到资产库')
    } catch (error) {
      useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [])

  const estimateNode = useCallback((data: GenerationNodeData) => {
    const capability = CAPABILITY[data.kind]
    const modelId = data.model || defaultModelFor(capability, settings, filterModelsByCapability(models, capability))
    if (!modelId) return 0
    return estimateCredits(modelId, {
      count: 1,
      quality: data.quality,
      duration: data.kind === 'video' ? String(data.seconds) : undefined,
    })
  }, [estimateCredits, models, settings])

  return useMemo(() => ({
    submitNode,
    cancelNode,
    checkNode,
    saveResultToLibrary,
    estimateNode,
  }), [submitNode, cancelNode, checkNode, saveResultToLibrary, estimateNode])
}

export type GenerationActions = ReturnType<typeof useGenerationActions>
