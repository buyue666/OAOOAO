import { useCallback, useEffect, useMemo } from 'react'
import { newClientRequestId } from '@/lib/studio/generation-api'
import { listLibraryAssets } from '@/lib/studio/account-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { AgentRun } from '@/lib/studio/generation-types'
import { flushCanvasSave } from './canvas-persistence'
import { buildAgentResultNodes, loadAgentResultAssets } from './agent-delivery'
import { useCanvasStore } from './canvas-store'
import { errorMessageOf } from './use-generation-actions'
import type { AgentNodeData, AgentStep } from './types'

const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled']
const USER_ACTION_RUN_STATUSES = ['awaiting_approval', 'paused']
const AGENT_POLL_INTERVAL_MS = 2500

export function isAgentRunTerminal(status?: string | null) {
  return Boolean(status && TERMINAL_RUN_STATUSES.includes(status))
}

function stepsOf(run: AgentRun): AgentStep[] {
  return run.tasks.map((task) => ({ id: task.id, title: task.title, type: task.type, status: task.status, error: task.error }))
}

export function agentPatchFromRun(run: AgentRun): Partial<AgentNodeData> {
  return {
    runId: run.id,
    runStatus: run.status,
    steps: stepsOf(run),
    failure: run.failure ?? null,
    pointsCost: typeof run.pointsCost === 'number' ? run.pointsCost : null,
    clientRequestId: null,
    submission: undefined,
    planApproval: run.planApproval ? {
      totalPoints: run.planApproval.totalPoints,
      estimated: run.planApproval.estimated,
      ...(run.planApproval.approvedAt ? { approvedAt: run.planApproval.approvedAt } : {}),
    } : undefined,
  }
}

function patchAgentNode(nodeId: string, data: Partial<AgentNodeData>, persist = true, projectId?: string) {
  const state = useCanvasStore.getState()
  const node = state.nodes.find((item) => item.id === nodeId)
  if (!node || node.type !== 'agent' || (projectId && state.projectId !== projectId)) return false
  state.patchNodes([{ id: nodeId, data }], { persist })
  return true
}

type Observer = { cancel: () => void }
const observedRuns = new Map<string, Observer>()

/** 观察服务端运行，切换画布后迟到的响应不会写回新画布。 */
function observeAgentRun(nodeId: string, runId: string, getAgent: (id: string) => Promise<AgentRun>, projectId: string) {
  const key = `${projectId}:${nodeId}:${runId}`
  if (observedRuns.has(key)) return
  let cancelled = false
  const cancel = () => {
    cancelled = true
    if (observedRuns.get(key)?.cancel === cancel) observedRuns.delete(key)
  }
  observedRuns.set(key, { cancel })

  void (async () => {
    try {
      while (!cancelled) {
        const state = useCanvasStore.getState()
        const node = state.nodes.find((item) => item.id === nodeId)
        if (state.projectId !== projectId || !node || node.type !== 'agent' || node.data.runId !== runId) return
        const run = await getAgent(runId)
        if (cancelled) return
        const after = useCanvasStore.getState()
        const afterNode = after.nodes.find((item) => item.id === nodeId)
        if (after.projectId !== projectId || !afterNode || afterNode.type !== 'agent' || afterNode.data.runId !== runId) return

        if (isAgentRunTerminal(run.status)) {
          const current = () => {
            const latest = useCanvasStore.getState()
            return !cancelled && latest.projectId === projectId && latest.hydrated && latest.nodes.some((item) => item.id === nodeId && item.type === 'agent' && item.data.runId === runId)
          }
          try {
            if (afterNode.data.deliveredRunId !== run.id) {
              const assets = await loadAgentResultAssets(run.assetIds || [], (page) => listLibraryAssets({ page, pageSize: 100 }), current)
              if (!assets || !current()) return
              const latest = useCanvasStore.getState()
              const nodes = buildAgentResultNodes(run.id, assets, latest.nodes)
              if (nodes.length) latest.insertNodes(nodes)
            }
            if (!current()) return
            patchAgentNode(nodeId, { ...agentPatchFromRun(run), deliveredRunId: run.id, deliveryError: null }, true, projectId)
            // Save the appended results and delivery marker with the current CAS
            // version. Never adopt a remote board over the user's local edits.
            await flushCanvasSave()
            if (!current()) return
            const saved = useCanvasStore.getState()
            if (saved.revision !== saved.savedRevision) throw new Error(saved.saveError || '画布版本尚未确认保存。')
          } catch (error) {
            if (current()) {
              const deliveryError = `运行已结束，结果尚未完整保存到画布。${errorMessageOf(error)} 本地修改已保留，可重试接收结果；版本冲突时请先导出本地画布再刷新。`
              patchAgentNode(nodeId, { ...agentPatchFromRun(run), deliveryError }, false, projectId)
              useCanvasStore.getState().setNotice(deliveryError)
            }
          }
          return
        }

        const waitingForUser = USER_ACTION_RUN_STATUSES.includes(run.status)
        patchAgentNode(nodeId, agentPatchFromRun(run), waitingForUser, projectId)
        if (waitingForUser) return
        await new Promise<void>((resolve) => window.setTimeout(resolve, AGENT_POLL_INTERVAL_MS))
      }
    } catch (error) {
      if (!cancelled && useCanvasStore.getState().projectId === projectId) useCanvasStore.getState().setNotice(errorMessageOf(error))
    } finally {
      if (observedRuns.get(key)?.cancel === cancel) observedRuns.delete(key)
    }
  })()
}

export function useAgentActions() {
  const generation = useGeneration()
  const projectId = useCanvasStore((state) => state.projectId)
  const hydrated = useCanvasStore((state) => state.hydrated)
  const activeAgentRuns = useCanvasStore((state) => state.nodes
    .flatMap((node) => node.type === 'agent' && node.data.runId && ((!isAgentRunTerminal(node.data.runStatus) && !USER_ACTION_RUN_STATUSES.includes(node.data.runStatus ?? '')) || (isAgentRunTerminal(node.data.runStatus) && node.data.deliveredRunId !== node.data.runId && !node.data.deliveryError)) ? [`${node.id}:${node.data.runId}`] : [])
    .join('|'))

  // Only leaving this board or replacing the API observer cancels its work.
  // Adding a run must not cancel the observer just started by startAgent.
  useEffect(() => () => {
    for (const [key, observer] of observedRuns) if (key.startsWith(`${projectId}:`)) observer.cancel()
  }, [generation.getAgent, hydrated, projectId])

  // 刷新或重新打开画布后，自动恢复尚未结束的运行观察。
  useEffect(() => {
    if (!hydrated || !projectId) return
    for (const node of useCanvasStore.getState().nodes) {
      if (node.type === 'agent' && node.data.runId && ((!isAgentRunTerminal(node.data.runStatus) && !USER_ACTION_RUN_STATUSES.includes(node.data.runStatus ?? '')) || (isAgentRunTerminal(node.data.runStatus) && node.data.deliveredRunId !== node.data.runId && !node.data.deliveryError))) {
        observeAgentRun(node.id, node.data.runId, generation.getAgent, projectId)
      }
    }
  }, [activeAgentRuns, generation.getAgent, hydrated, projectId])

  const startAgent = useCallback(async (nodeId: string) => {
    const state = useCanvasStore.getState()
    const node = state.nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'agent' || !state.projectId) return
    const prompt = node.data.prompt.trim()
    if (!prompt || ['planning', 'running', 'awaiting_approval', 'paused'].includes(node.data.runStatus ?? '')) return
    if (node.data.runId && isAgentRunTerminal(node.data.runStatus) && (node.data.deliveredRunId !== node.data.runId || node.data.deliveryError)) return

    const context = state.nodes
      .filter((item) => item.type !== 'agent' && item.type !== 'group')
      .slice(0, 24)
      .map((item) => item.data.title)
    const assetIds = [...new Set(state.nodes.flatMap((item) => (item.type === 'media' && item.data.media?.libraryAssetId ? [item.data.media.libraryAssetId] : [])))].slice(0, 16)
    const submission = node.data.clientRequestId && node.data.submission ? node.data.submission : { prompt, assetIds, skillIds: (node.data.skills ?? []).map((skill) => skill.id) }
    const clientRequestId = node.data.clientRequestId || newClientRequestId('agent')
    patchAgentNode(nodeId, { runId: null, runStatus: 'planning', steps: [], failure: null, pointsCost: null, context, clientRequestId, submission, planApproval: undefined, deliveredRunId: null, deliveryError: null }, true, state.projectId)
    try {
      await flushCanvasSave()
      const input = { ...submission, surface: 'canvas' as const, projectId: state.projectId, clientRequestId }
      const current = useCanvasStore.getState()
      if (current.projectId !== state.projectId || current.revision !== current.savedRevision) throw new Error('画布尚未保存，请先解决保存问题后再运行 Agent')
      const run = await generation.runAgent(input)
      patchAgentNode(nodeId, agentPatchFromRun(run), true, state.projectId)
      observeAgentRun(nodeId, run.id, generation.getAgent, state.projectId)
    } catch (error) {
      const indeterminate = typeof error === 'object' && error !== null && Boolean(('isIndeterminate' in error && error.isIndeterminate) || ('indeterminate' in error && error.indeterminate))
      patchAgentNode(nodeId, indeterminate
        ? { runStatus: 'unconfirmed', failure: '提交结果未确认，点击“重新提交”可按同一标识安全重试。' }
        : { runStatus: 'failed', failure: errorMessageOf(error), clientRequestId: null, submission: undefined }, true, state.projectId)
    }
  }, [generation])

  const controlRun = useCallback(async (nodeId: string, action: 'pause' | 'resume' | 'cancel' | 'approve' | 'retry') => {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
    const currentProjectId = useCanvasStore.getState().projectId
    if (!node || node.type !== 'agent' || !node.data.runId || !currentProjectId) return
    try {
      const run = await generation.cancelAgent({ id: node.data.runId }, action)
      patchAgentNode(nodeId, agentPatchFromRun(run), true, currentProjectId)
      if (!isAgentRunTerminal(run.status) && !USER_ACTION_RUN_STATUSES.includes(run.status)) observeAgentRun(nodeId, run.id, generation.getAgent, currentProjectId)
    } catch (error) {
      if (useCanvasStore.getState().projectId === currentProjectId) useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [generation])

  const refreshAgent = useCallback((nodeId: string) => {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
    const currentProjectId = useCanvasStore.getState().projectId
    if (!node || node.type !== 'agent' || !node.data.runId || !currentProjectId) return
    observeAgentRun(nodeId, node.data.runId, generation.getAgent, currentProjectId)
  }, [generation])

  const cancelAgent = useCallback((nodeId: string) => controlRun(nodeId, 'cancel'), [controlRun])
  const approveAgent = useCallback((nodeId: string) => controlRun(nodeId, 'approve'), [controlRun])
  const pauseAgent = useCallback((nodeId: string) => controlRun(nodeId, 'pause'), [controlRun])
  const resumeAgent = useCallback((nodeId: string) => controlRun(nodeId, 'resume'), [controlRun])

  return useMemo(
    () => ({ startAgent, cancelAgent, approveAgent, pauseAgent, resumeAgent, refreshAgent }),
    [startAgent, cancelAgent, approveAgent, pauseAgent, resumeAgent, refreshAgent],
  )
}

export type AgentActions = ReturnType<typeof useAgentActions>
