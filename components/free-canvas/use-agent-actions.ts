import { useCallback, useEffect, useMemo } from 'react'
import { controlAgentRun, newClientRequestId } from '@/lib/studio/generation-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { AgentRun } from '@/lib/studio/generation-types'
import { flushCanvasSave, syncRemoteBoard } from './canvas-persistence'
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
  const cancel = () => { cancelled = true }
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
          let remoteSyncFailed = false
          try { await syncRemoteBoard() } catch { remoteSyncFailed = true }
          if (!cancelled) {
            patchAgentNode(nodeId, {
              ...agentPatchFromRun(run),
              ...(remoteSyncFailed ? { failure: '运行已结束，但结果画布同步失败，请点击“刷新进度”重试。' } : {}),
            }, !remoteSyncFailed, projectId)
            if (remoteSyncFailed) useCanvasStore.getState().setNotice('Agent 已完成，但结果画布同步失败，请刷新进度后重试。')
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
    .flatMap((node) => node.type === 'agent' && node.data.runId && !isAgentRunTerminal(node.data.runStatus) && !USER_ACTION_RUN_STATUSES.includes(node.data.runStatus ?? '') ? [`${node.id}:${node.data.runId}`] : [])
    .join('|'))

  // 刷新或重新打开画布后，自动恢复尚未结束的运行观察。
  useEffect(() => {
    if (!hydrated || !projectId) return
    for (const node of useCanvasStore.getState().nodes) {
      if (node.type === 'agent' && node.data.runId && !isAgentRunTerminal(node.data.runStatus) && !USER_ACTION_RUN_STATUSES.includes(node.data.runStatus ?? '')) {
        observeAgentRun(node.id, node.data.runId, generation.getAgent, projectId)
      }
    }
    return () => {
      for (const [key, observer] of observedRuns) if (key.startsWith(`${projectId}:`)) observer.cancel()
    }
  }, [activeAgentRuns, generation.getAgent, hydrated, projectId])

  const startAgent = useCallback(async (nodeId: string) => {
    const state = useCanvasStore.getState()
    const node = state.nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'agent' || !state.projectId) return
    const prompt = node.data.prompt.trim()
    if (!prompt || ['planning', 'running', 'awaiting_approval', 'paused'].includes(node.data.runStatus ?? '')) return

    const context = state.nodes
      .filter((item) => item.type !== 'agent' && item.type !== 'group')
      .slice(0, 24)
      .map((item) => item.data.title)
    const assetIds = state.nodes.flatMap((item) => (item.type === 'media' && item.data.media ? [item.data.media.id] : []))
    const clientRequestId = node.data.clientRequestId || newClientRequestId('agent')
    patchAgentNode(nodeId, { runId: null, runStatus: 'planning', steps: [], failure: null, pointsCost: null, context, clientRequestId, planApproval: undefined }, true, state.projectId)
    try {
      await flushCanvasSave()
      const run = await generation.runAgent({ prompt, surface: 'canvas', projectId: state.projectId, assetIds, clientRequestId })
      patchAgentNode(nodeId, agentPatchFromRun(run), true, state.projectId)
      observeAgentRun(nodeId, run.id, generation.getAgent, state.projectId)
    } catch (error) {
      const indeterminate = typeof error === 'object' && error !== null && 'isIndeterminate' in error && Boolean((error as { isIndeterminate?: unknown }).isIndeterminate)
      patchAgentNode(nodeId, indeterminate
        ? { runStatus: 'unconfirmed', failure: '提交结果未确认，点击“重新提交”可按同一标识安全重试。' }
        : { runStatus: 'failed', failure: errorMessageOf(error), clientRequestId: null }, false, state.projectId)
    }
  }, [generation])

  const controlRun = useCallback(async (nodeId: string, action: 'pause' | 'resume' | 'cancel' | 'approve' | 'retry') => {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
    const currentProjectId = useCanvasStore.getState().projectId
    if (!node || node.type !== 'agent' || !node.data.runId || !currentProjectId) return
    try {
      const { run } = (await controlAgentRun(node.data.runId, action)).data
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
