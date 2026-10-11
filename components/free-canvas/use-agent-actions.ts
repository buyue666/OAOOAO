import { useCallback, useMemo } from 'react'
import { controlAgentRun } from '@/lib/studio/generation-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { AgentRun } from '@/lib/studio/generation-types'
import { flushCanvasSave } from './canvas-persistence'
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
    } catch (error) {
      patchAgentNode(nodeId, { runStatus: 'failed', failure: errorMessageOf(error) })
    }
  }, [generation])

  const controlRun = useCallback(async (nodeId: string, action: 'cancel' | 'approve') => {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'agent' || !node.data.runId) return
    try {
      const response = await controlAgentRun(node.data.runId, action)
      patchAgentNode(nodeId, agentPatchFromRun(response.data.run))
    } catch (error) {
      useCanvasStore.getState().setNotice(errorMessageOf(error))
    }
  }, [])

  const cancelAgent = useCallback((nodeId: string) => controlRun(nodeId, 'cancel'), [controlRun])
  const approveAgent = useCallback((nodeId: string) => controlRun(nodeId, 'approve'), [controlRun])

  return useMemo(() => ({ startAgent, cancelAgent, approveAgent }), [startAgent, cancelAgent, approveAgent])
}

export type AgentActions = ReturnType<typeof useAgentActions>
