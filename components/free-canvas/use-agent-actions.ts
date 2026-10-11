import { useCallback, useMemo } from 'react'
import { controlAgentRun } from '@/lib/studio/generation-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { AgentRun } from '@/lib/studio/generation-types'
import { flushCanvasSave, mergeRemoteAdditions } from './canvas-persistence'
import { useCanvasStore } from './canvas-store'
import { errorMessageOf } from './use-generation-actions'
import type { AgentNodeData, AgentStep } from './types'

const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled']

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
  }
}

function patchAgentNode(nodeId: string, data: Partial<AgentNodeData>) {
  useCanvasStore.getState().patchNodes([{ id: nodeId, data }])
}

const AGENT_POLL_INTERVAL_MS = 2500
/** 等待用户操作的状态不再轮询；确认或恢复的用户动作会重新启动观察。 */
const USER_ACTION_RUN_STATUSES = ['awaiting_approval', 'paused']
const observedRunIds = new Set<string>()

function hasAgentNode(nodeId: string) {
  return useCanvasStore.getState().nodes.some((node) => node.id === nodeId)
}

/**
 * 观察单个 Agent 运行直到终态或等待用户操作。同一运行只保留一个循环，节点删除后立即停止。
 * 由用户动作显式启动（运行、确认、取消、刷新进度），不依赖渲染期副作用。
 */
function observeAgentRun(nodeId: string, runId: string, getAgent: (id: string) => Promise<AgentRun>) {
  if (observedRunIds.has(runId)) return
  observedRunIds.add(runId)
  void (async () => {
    try {
      while (hasAgentNode(nodeId)) {
        const run = await getAgent(runId)
        if (!hasAgentNode(nodeId)) return
        patchAgentNode(nodeId, agentPatchFromRun(run))
        if (isAgentRunTerminal(run.status)) {
          await mergeRemoteAdditions().catch(() => undefined)
          return
        }
        if (USER_ACTION_RUN_STATUSES.includes(run.status)) return
        await new Promise((resolve) => setTimeout(resolve, AGENT_POLL_INTERVAL_MS))
      }
    } catch (error) {
      useCanvasStore.getState().setNotice(errorMessageOf(error))
    } finally {
      observedRunIds.delete(runId)
    }
  })()
}

/**
 * OAO Agent 始终绑定当前画布：运行前先保存画布，让服务端读到最新节点、素材与提示词。
 * 读取的画布对象与运行结果都回写到 Agent 节点，便于用户核对它实际处理了什么。
 */
export function useAgentActions() {
  const generation = useGeneration()

  const startAgent = useCallback(async (nodeId: string) => {
    const state = useCanvasStore.getState()
    const node = state.nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'agent' || !state.projectId) return
    const prompt = node.data.prompt.trim()
    if (!prompt) return
    const context = state.nodes
      .filter((item) => item.type !== 'agent' && item.type !== 'group')
      .slice(0, 24)
      .map((item) => item.data.title)
    const assetIds = state.nodes.flatMap((item) => (item.type === 'media' && item.data.media ? [item.data.media.id] : []))
    patchAgentNode(nodeId, { runId: null, runStatus: 'planning', steps: [], failure: null, pointsCost: null, context })
    try {
      await flushCanvasSave()
      const run = await generation.runAgent({ prompt, surface: 'canvas', projectId: state.projectId, assetIds })
      patchAgentNode(nodeId, agentPatchFromRun(run))
      if (!isAgentRunTerminal(run.status)) observeAgentRun(nodeId, run.id, generation.getAgent)
    } catch (error) {
      patchAgentNode(nodeId, { runStatus: 'failed', failure: errorMessageOf(error) })
    }
  }, [generation])

  const controlRun = useCallback(async (nodeId: string, action: 'cancel' | 'approve') => {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'agent' || !node.data.runId) return
    try {
      const { run } = (await controlAgentRun(node.data.runId, action)).data
      patchAgentNode(nodeId, agentPatchFromRun(run))
      if (!isAgentRunTerminal(run.status)) observeAgentRun(nodeId, run.id, generation.getAgent)
    } catch (error) {
      useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [generation])

  const refreshAgent = useCallback((nodeId: string) => {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'agent' || !node.data.runId) return
    observeAgentRun(nodeId, node.data.runId, generation.getAgent)
  }, [generation])

  const cancelAgent = useCallback((nodeId: string) => controlRun(nodeId, 'cancel'), [controlRun])
  const approveAgent = useCallback((nodeId: string) => controlRun(nodeId, 'approve'), [controlRun])

  return useMemo(
    () => ({ startAgent, cancelAgent, approveAgent, refreshAgent }),
    [startAgent, cancelAgent, approveAgent, refreshAgent],
  )
}

export type AgentActions = ReturnType<typeof useAgentActions>
