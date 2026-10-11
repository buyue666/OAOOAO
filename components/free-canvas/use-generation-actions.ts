import { useCallback, useEffect, useMemo } from 'react'
import { createLibraryAsset } from '@/lib/studio/account-api'
import { cancelGenerationTask, getGenerationTask, normalizeTaskResult } from '@/lib/studio/generation-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { GenerationTaskView, SessionGenerationSettings, SessionLogicalModel } from '@/lib/studio/generation-types'
import { isSubmittableReferenceUrl } from '@/lib/studio/reference-assets'
import { defaultModelFor, filterModelsByCapability } from '@/lib/studio/studio-models'
import { useStudio } from '@/lib/studio/store'
import type { ModelConfig } from '@/lib/studio/types'
import { useCanvasStore, type RemoteNodePatch } from './canvas-store'
import type { FreeCanvasEdge, FreeCanvasNode, GenerationFlowNode, GenerationKind, GenerationNodeData, NodeReference, NodeResult, NodeTask, TaskPhase } from './types'

const CAPABILITY: Record<GenerationKind, SessionLogicalModel['capability']> = {
  image: 'image',
  video: 'video',
  text: 'text',
  audio: 'audio',
}

const DEFAULT_REFERENCE_LIMIT = 4

export function errorMessageOf(error: unknown) {
  return error instanceof Error && error.message ? error.message : '请求失败，请稍后重试'
}

function phaseOf(view: GenerationTaskView): TaskPhase {
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
  return !!a && a.id === b.id && a.phase === b.phase && a.error === b.error
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
    const task: NodeTask = { ...node.data.task, phase, error: phase === 'error' ? view.error || '生成失败' : undefined }
    const results = phase === 'success' ? resultsOf(view) : node.data.results
    const text = view.text ?? node.data.text
    const resultsChanged = !sameResults(results, node.data.results)
    if (sameTask(node.data.task, task) && !resultsChanged && text === node.data.text) continue
    patches.push({ id: node.id, data: { task, results, text } })
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

function composePrompt(data: GenerationNodeData) {
  return [data.prompt.trim(), ...data.skills.map((skill) => skill.prompt.trim()).filter(Boolean)].join('\n\n')
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
    const capability = CAPABILITY[data.kind]
    const modelId = data.model || defaultModelFor(capability, settings, filterModelsByCapability(models, capability))
    const model = models.find((item) => item.id === modelId)
    const references = referencesFor(nodeId, data, maxReferencesOf(data.kind, model), state.nodes, state.edges)
    const prompt = composePrompt(data)
    setTask(nodeId, { id: '', phase: 'queued', startedAt: Date.now() })
    try {
      const projectId = state.projectId
      const view = data.kind === 'image'
        ? await generation.createImage({ prompt, model: modelId, ratio: data.ratio, quality: data.quality, count: data.count, references, title: data.title, projectId, surface: 'canvas' })
        : data.kind === 'video'
          ? await generation.createVideo({ prompt, model: modelId, ratio: data.ratio, quality: data.quality, seconds: data.seconds, references, projectId, surface: 'canvas' })
          : data.kind === 'audio'
            ? await generation.createAudio({ prompt, model: modelId, voice: data.voice, format: data.format, projectId, surface: 'canvas' })
            : await generation.createText({ prompt, model: modelId })
      setTask(nodeId, { id: view.id, phase: phaseOf(view), startedAt: Date.now() })
    } catch (error) {
      setTask(nodeId, { id: '', phase: 'error', error: errorMessageOf(error), startedAt: Date.now() })
    }
  }, [generation, models, settings])

  const cancelNode = useCallback(async (nodeId: string) => {
    const node = generationNodeOf(nodeId)
    const task = node?.data.task
    if (!node || !task?.id) return
    try {
      const view = generation.tasks.find((item) => item.id === task.id)
      if (view) await generation.cancelTask(view)
      else await cancelGenerationTask(node.data.kind, task.id)
      setTask(nodeId, { ...task, phase: 'cancelled', error: undefined })
    } catch (error) {
      useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [generation])

  /** 任务列表里找不到（例如换设备）时，直接向后端确认一次真实状态。 */
  const checkNode = useCallback(async (nodeId: string) => {
    const node = generationNodeOf(nodeId)
    const task = node?.data.task
    if (!node || !task?.id) return
    try {
      const remote = (await getGenerationTask(node.data.kind, task.id)).data.task
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
      useCanvasStore.getState().patchNodes([{
        id: nodeId,
        data: { task: { ...task, phase, error: phase === 'error' ? remote.error || '生成失败' : undefined }, results, text: normalized.text ?? node.data.text },
      }])
    } catch (error) {
      useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [])

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

  const saveSkillFromNode = useCallback(async (nodeId: string) => {
    const node = generationNodeOf(nodeId)
    const prompt = node?.data.prompt.trim()
    if (!prompt) return
    try {
      await createLibraryAsset({
        kind: 'text',
        title: prompt.slice(0, 24),
        tags: ['技能'],
        source: 'canvas-skill',
        data: { prompt, text: prompt, assetRole: 'style' },
      })
      useCanvasStore.getState().setNotice('已保存为技能')
    } catch (error) {
      useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [])

  const estimateNode = useCallback((data: GenerationNodeData) => {
    const capability = CAPABILITY[data.kind]
    const modelId = data.model || defaultModelFor(capability, settings, filterModelsByCapability(models, capability))
    if (!modelId) return 0
    return estimateCredits(modelId, {
      count: data.count,
      quality: data.quality,
      duration: data.kind === 'video' ? String(data.seconds) : undefined,
    })
  }, [estimateCredits, models, settings])

  return useMemo(() => ({
    submitNode,
    cancelNode,
    checkNode,
    saveResultToLibrary,
    saveSkillFromNode,
    estimateNode,
  }), [submitNode, cancelNode, checkNode, saveResultToLibrary, saveSkillFromNode, estimateNode])
}

export type GenerationActions = ReturnType<typeof useGenerationActions>
