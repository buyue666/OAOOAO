import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { request } from '@/lib/studio/api'
import { createLibraryAsset, listLibraryAssets } from '@/lib/studio/account-api'
import { composeSkillPrompt, resolveCanvasSkills } from '@/lib/studio/canvas-skills'
import { cancelGenerationTask, getGenerationTask, newClientRequestId, normalizeTaskResult, quoteVideoGeneration } from '@/lib/studio/generation-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { GenerationTask, GenerationTaskView, SessionGenerationSettings, SessionLogicalModel } from '@/lib/studio/generation-types'
import { availableTeamModels } from '@/lib/studio/team-generation'
import { defaultModelFor, filterModelsByCapability } from '@/lib/studio/studio-models'
import { useStudio } from '@/lib/studio/store'
import { useCanvasStore, type RemoteNodePatch } from './canvas-store'
import { flushCanvasSave } from './canvas-persistence'
import { canvasPrompt, canvasReferences, submissionReferences, teamCanvasPayload, validateCanvasGeneration } from './canvas-generation-policy'
import { teamCanvasRoot } from './canvas-workspace'
import type { FreeCanvasNode, GenerationFlowNode, GenerationKind, GenerationNodeData, NodeResult, NodeSubmission, NodeTask, TaskPhase } from './types'

const CAPABILITY: Record<GenerationKind, SessionLogicalModel['capability']> = {
  image: 'image',
  video: 'video',
  text: 'text',
  audio: 'audio',
}

type Approval = { nodeId: string; submission: NodeSubmission; points: number; current: () => boolean; draftKey: string }

function draftKey(node: GenerationFlowNode) {
  const state = useCanvasStore.getState()
  const { task: _task, results: _results, text: _text, ...data } = node.data
  return JSON.stringify([data, canvasReferences(node.id, node.data, state.nodes, state.edges)])
}

function teamTaskView(task: GenerationTask): GenerationTaskView {
  const normalized = normalizeTaskResult(task.kind, task.result)
  return { ...task, title: '团队画布任务', prompt: '', createdAt: 0, updatedAt: Date.now(), ...normalized }
}

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

function setTask(nodeId: string, task: NodeTask | null) {
  useCanvasStore.getState().patchNodes([{ id: nodeId, data: { task } }])
}

function generationNodeOf(nodeId: string) {
  return useCanvasStore.getState().nodes.find((node): node is GenerationFlowNode => node.id === nodeId && node.type === 'generation')
}

export function useGenerationActions() {
  const generation = useGeneration()
  const studio = useStudio()
  const workspace = useCanvasStore(state => state.workspace)
  const models = useMemo(() => workspace ? availableTeamModels(studio.state.models, workspace.modelIds, studio.state.sessionSettings) : studio.state.models, [studio.state.models, studio.state.sessionSettings, workspace])
  const settings: SessionGenerationSettings | undefined = studio.state.sessionSettings
  const [approval, setApproval] = useState<Approval | null>(null)
  const approvalRef = useRef<Approval | null>(null)
  const preparing = useRef(new Set<string>())
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
    if (workspace) return
    const patches = collectTaskPatches(useCanvasStore.getState().nodes, tasks)
    if (patches.length) useCanvasStore.getState().patchNodes(patches)
  }, [tasks, workspace])

  const submitNode = useCallback(async (nodeId: string, approved?: Approval) => {
    const state = useCanvasStore.getState()
    const node = generationNodeOf(nodeId)
    if (!node || !state.projectId || !node.data.prompt.trim() || state.workspace?.readOnly || preparing.current.has(nodeId)) return
    if (!approved && approvalRef.current) return
    if (approved && (!approved.current() || approved.draftKey !== draftKey(node))) { setApproval(null); approvalRef.current = null; return state.setNotice('参数或素材已更改，请重新获取报价') }
    if (node.data.task?.phase === 'queued' || node.data.task?.phase === 'running') return
    const data = node.data
    const scopeCurrent = currentScope()
    const previous = data.task
    let submission = approved?.submission ?? (previous?.unconfirmed ? previous.submission : undefined)
    let approvedCost = approved?.points ?? previous?.approvedCost
    if (previous?.unconfirmed && !submission) return state.setNotice('上次提交尚未确认且缺少恢复参数，请到任务记录核对，勿重复生成。')
    const clientRequestId = submission?.input.clientRequestId || newClientRequestId(`canvas-${data.kind}`)
    const current = () => scopeCurrent() && generationNodeOf(nodeId)?.data.task?.clientRequestId === clientRequestId
    const capability = CAPABILITY[data.kind]
    const modelId = data.model || defaultModelFor(capability, settings, filterModelsByCapability(models, capability))
    const model = models.find((item) => item.id === modelId)
    const references = canvasReferences(nodeId, data, state.nodes, state.edges)
    const pending: NodeTask = { id: '', phase: 'queued', startedAt: Date.now(), clientRequestId, submission }
    const originalDraft = draftKey(node)
    preparing.current.add(nodeId)
    setTask(nodeId, pending)
    let submitted = false
    try {
      if (!submission) {
        validateCanvasGeneration(data, model, references)
        if (workspace && data.skills.length) throw new Error('团队画布请直接填写创作指令，个人技能尚不支持在团队中引用')
        const skills = workspace ? [] : await resolveCanvasSkills(data.skills.map((skill) => skill.id), (page) => listLibraryAssets({ kind: 'text', pageSize: 100, page }))
        if (!current()) return
        const prompt = composeSkillPrompt(canvasPrompt(data.prompt, references), skills)
        const common = { prompt, model: modelId, clientRequestId }
        const context = { projectId: state.projectId, surface: 'canvas' as const }
        submission = data.kind === 'image'
          ? { kind: 'image', input: { ...common, ...context, ratio: data.ratio, resolution: data.resolution, quality: data.quality, count: 1, references: submissionReferences(references), title: data.title, ...(data.edit ? { kind: 'edit', edit: data.edit } : {}) } }
          : data.kind === 'video'
            ? { kind: 'video', input: { ...common, ...context, ratio: data.ratio, quality: data.quality, seconds: data.seconds, references: submissionReferences(references) } }
            : data.kind === 'audio'
              ? { kind: 'audio', input: { ...common, ...context, voice: data.voice, format: data.format } }
              : { kind: 'text', input: common }
      }
      if (!previous?.unconfirmed && !approved && (workspace || submission.kind === 'video')) {
        const quote = workspace
          ? await request<{ points: number }>(`${teamCanvasRoot(workspace)}/generations/quote`, { method: 'POST', body: JSON.stringify(teamCanvasPayload(submission)) })
          : await quoteVideoGeneration((submission as Extract<NodeSubmission, { kind: 'video' }>).input)
        if (!current()) return
        if (!Number.isFinite(quote.points) || quote.points < 0) throw new Error('未能确认生成费用，请重试报价')
        setTask(nodeId, previous ?? null)
        const next = { nodeId, submission, points: quote.points, current: scopeCurrent, draftKey: originalDraft }
        approvalRef.current = next; setApproval(next)
        return
      }
      // Save the immutable identity before a request can charge points. Reloads
      // can then recover the same request even if the response never arrives.
      setApproval(null); approvalRef.current = null
      setTask(nodeId, { ...pending, submission, approvedCost })
      await flushCanvasSave()
      if (!current()) return
      const saved = useCanvasStore.getState()
      if (saved.revision !== saved.savedRevision) throw new Error('画布尚未保存，生成请求未发送。请先处理保存冲突或重试保存。')
      submitted = true
      const view = workspace
        ? teamTaskView((await request<{ task: GenerationTask }>(`${teamCanvasRoot(workspace)}/generations`, { method: 'POST', headers: { 'idempotency-key': clientRequestId }, body: JSON.stringify({ ...teamCanvasPayload(submission), approvedCost }) })).task)
        : submission.kind === 'image' ? await generation.createImage(submission.input)
        : submission.kind === 'video' ? await generation.createVideo({ ...submission.input, ...(approvedCost !== undefined ? { approvedCost } : {}) })
          : submission.kind === 'audio' ? await generation.createAudio(submission.input)
            : await generation.createText(submission.input)
      if (!current()) return
      const phase = phaseOf(view)
      useCanvasStore.getState().patchNodes([{ id: nodeId, data: { task: { id: view.id, phase, startedAt: pending.startedAt, clientRequestId }, ...(phase === 'success' ? { results: resultsOf(view), text: view.text ?? '', resultSource: undefined } : {}) } }])
    } catch (error) {
      if (!current()) return
      const definite = error && typeof error === 'object' && (('indeterminate' in error && error.indeterminate === false) || ('outcome' in error && ['rejected', 'failed', 'expired', 'not-found'].includes(String(error.outcome))) || (workspace && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500 && Number(error.status) !== 408))
      const unconfirmed = Boolean(previous?.unconfirmed || (submitted && !definite))
      setTask(nodeId, { ...pending, submission, approvedCost, phase: 'error', unconfirmed, error: unconfirmed ? `提交结果未确认；重试会使用原参数核对，不会重复扣费。${errorMessageOf(error)}` : errorMessageOf(error) })
    } finally {
      preparing.current.delete(nodeId)
    }
  }, [generation, models, settings, currentScope, workspace])

  const cancelNode = useCallback(async (nodeId: string) => {
    const node = generationNodeOf(nodeId)
    const task = node?.data.task
    if (!node || !task?.id || task.cancelRequested) return
    if (workspace?.readOnly) return
    const scopeCurrent = currentScope()
    const current = () => scopeCurrent() && generationNodeOf(nodeId)?.data.task?.id === task.id
    try {
      const view = generation.tasks.find((item) => item.id === task.id)
      const remote = workspace ? (await request<{ task: GenerationTask }>(`${teamCanvasRoot(workspace)}/generations/${encodeURIComponent(task.id)}/cancel`, { method: 'POST' })).task : view ? await generation.cancelTask(view) : (await cancelGenerationTask(node.data.kind, task.id)).data.task
      if (!current()) return
      const phase = phaseOf(remote)
      const waiting = phase === 'queued' || phase === 'running'
      setTask(nodeId, { ...task, phase, cancelRequested: waiting, error: phase === 'error' ? remote.error || '生成失败' : undefined })
      useCanvasStore.getState().setNotice(waiting ? '取消请求已发送，尚未确认停止。请继续检查状态，确认前不能重新生成。' : phase === 'cancelled' ? '任务已确认取消' : '任务已结束，请核对最终结果。')
    } catch (error) {
      if (current()) useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [generation, currentScope, workspace])

  /** 任务列表里找不到（例如换设备）时，直接向后端确认一次真实状态。 */
  const checkNode = useCallback(async (nodeId: string) => {
    const node = generationNodeOf(nodeId)
    const task = node?.data.task
    if (!node || !task?.id) return
    const scopeCurrent = currentScope()
    const current = () => scopeCurrent() && generationNodeOf(nodeId)?.data.task?.id === task.id
    try {
      const remote = workspace ? (await request<{ task: GenerationTask }>(`${teamCanvasRoot(workspace)}/generations/${encodeURIComponent(task.id)}`)).task : (await getGenerationTask(node.data.kind, task.id)).data.task
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
  }, [currentScope, workspace])

  useEffect(() => {
    if (!workspace) return
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      for (const node of useCanvasStore.getState().nodes) {
        if (stopped) return
        if (node.type === 'generation' && node.data.task?.id && ['queued', 'running'].includes(node.data.task.phase)) await checkNode(node.id)
      }
      if (!stopped) timer = setTimeout(poll, 2500)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [workspace, checkNode])

  const saveResultToLibrary = useCallback(async (nodeId: string, index: number) => {
    const node = generationNodeOf(nodeId)
    const result = node?.data.results[index]
    if (!node || !result) return
    if (workspace) return useCanvasStore.getState().setNotice('团队生成结果已自动保存到当前项目素材，无需重复收藏')
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
  }, [workspace])

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
    approval,
    confirmGeneration: () => { if (approvalRef.current) void submitNode(approvalRef.current.nodeId, approvalRef.current) },
    dismissApproval: () => { approvalRef.current = null; setApproval(null) },
    submitNode,
    cancelNode,
    checkNode,
    saveResultToLibrary,
    estimateNode,
  }), [approval, submitNode, cancelNode, checkNode, saveResultToLibrary, estimateNode])
}

export type GenerationActions = ReturnType<typeof useGenerationActions>
