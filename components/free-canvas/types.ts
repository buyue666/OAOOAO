import type { Edge, Node } from '@xyflow/react'

export type GenerationKind = 'image' | 'video' | 'text' | 'audio'
export type MediaKind = 'image' | 'video' | 'audio'
export type MediaNodeKind = 'reference' | 'asset'
export type CanvasNodeKind = GenerationKind | MediaNodeKind | 'agent' | 'group'
export type NodeSide = 'top' | 'right' | 'bottom' | 'left'
export type TaskPhase = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export type NodeReference = {
  id: string
  title: string
  url: string
  mediaKind: MediaKind
}

export type NodeSkill = {
  id: string
  title: string
  prompt: string
}

export type NodeResult = {
  url: string
  poster?: string
  mediaKind: MediaKind
}

export type NodeTask = {
  /** 空字符串表示提交请求还在途中，尚未拿到后端任务 ID。 */
  id: string
  phase: TaskPhase
  error?: string
  startedAt: number
}

export type GenerationNodeData = {
  kind: GenerationKind
  title: string
  prompt: string
  model: string
  ratio: string
  quality: string
  seconds: number
  count: number
  voice: string
  format: string
  references: NodeReference[]
  skills: NodeSkill[]
  task: NodeTask | null
  results: NodeResult[]
  text: string
}

export type MediaNodeData = {
  kind: MediaNodeKind
  title: string
  media: NodeReference | null
}

export type AgentStep = {
  id: string
  title: string
  type: string
  status: string
  error?: string
}

export type AgentNodeData = {
  kind: 'agent'
  title: string
  prompt: string
  runId: string | null
  runStatus: string | null
  steps: AgentStep[]
  failure: string | null
  pointsCost: number | null
  context: string[]
}

export type GroupNodeData = {
  kind: 'group'
  title: string
}

export type GenerationFlowNode = Node<GenerationNodeData, 'generation'>
export type MediaFlowNode = Node<MediaNodeData, 'media'>
export type AgentFlowNode = Node<AgentNodeData, 'agent'>
export type GroupFlowNode = Node<GroupNodeData, 'group'>
export type FreeCanvasNode = GenerationFlowNode | MediaFlowNode | AgentFlowNode | GroupFlowNode
export type FreeCanvasEdge = Edge

export const HANDLE_IDS = {
  inLeft: 'in-left',
  inTop: 'in-top',
  outRight: 'out-right',
  outBottom: 'out-bottom',
} as const

export function isGenerationKind(value: string): value is GenerationKind {
  return value === 'image' || value === 'video' || value === 'text' || value === 'audio'
}

export function isMediaKind(value: unknown): value is MediaKind {
  return value === 'image' || value === 'video' || value === 'audio'
}
