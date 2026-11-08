import type { AssistantContext } from './director-context'

export type AssistantMessage = { id: string; role: 'user' | 'agent'; text: string; runId?: string; refs?: string[] }
export type AssistantPending = { clientRequestId: string; prompt: string; displayText: string; surface: AssistantContext['surface']; projectId?: string; assetIds: string[]; refTitles: string[]; skillIds?: string[]; publicPrompt?: string }

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

/** Never discard an unreadable recovery request and enable a fresh potentially duplicate submission. */
export function parseAssistantThread(raw: string | null, surface: AssistantContext['surface'], projectId?: string): { messages: AssistantMessage[]; pending: AssistantPending | null } {
  if (!raw) return { messages: [], pending: null }
  const saved: unknown = JSON.parse(raw)
  if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 2 || !('messages' in saved) || !Array.isArray(saved.messages)) throw new Error('对话恢复记录格式无效，请先到任务中心核对已有请求。')
  const messages = saved.messages.filter((item): item is AssistantMessage => item && typeof item.id === 'string' && typeof item.text === 'string' && ['user', 'agent'].includes(item.role) && (item.runId === undefined || typeof item.runId === 'string') && (item.refs === undefined || strings(item.refs))).slice(-40)
  const request = 'pending' in saved ? saved.pending : null
  if (request === null || request === undefined) return { messages, pending: null }
  if (typeof request !== 'object' || !('clientRequestId' in request) || typeof request.clientRequestId !== 'string' || !request.clientRequestId.trim() || !('prompt' in request) || typeof request.prompt !== 'string' || !request.prompt.trim() || !('displayText' in request) || typeof request.displayText !== 'string' || !('surface' in request) || request.surface !== surface || ('projectId' in request ? request.projectId : undefined) !== projectId || !('assetIds' in request) || !strings(request.assetIds) || !('refTitles' in request) || !strings(request.refTitles)) throw new Error('待确认请求的恢复信息不完整，请先到任务中心核对，避免重复提交。')
  if (('skillIds' in request && (!strings(request.skillIds) || request.skillIds.length > 8)) || ('publicPrompt' in request && typeof request.publicPrompt !== 'string')) throw new Error('待确认请求的技能或原始需求信息损坏，请先到任务中心核对。')
  return { messages, pending: request as AssistantPending }
}
