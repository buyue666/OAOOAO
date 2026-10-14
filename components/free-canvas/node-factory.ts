import type { XYPosition } from '@xyflow/react'
import { AudioLines, Bot, Clapperboard, FileText, Image as ImageIcon, Library, Paperclip, type LucideIcon } from 'lucide-react'
import type { SessionGenerationDefaults } from '@/lib/studio/generation-types'
import type {
  AgentFlowNode,
  FreeCanvasNode,
  GenerationFlowNode,
  GenerationKind,
  GroupFlowNode,
  MediaFlowNode,
  MediaNodeKind,
  NodeReference,
} from './types'

export type CreatableKind = GenerationKind | MediaNodeKind | 'agent'

export const CREATABLE_KINDS: CreatableKind[] = ['image', 'video', 'text', 'audio', 'reference', 'asset', 'agent']

export const NODE_META: Record<CreatableKind, { label: string; hint: string; icon: LucideIcon }> = {
  image: { label: '图片生成', hint: '文字生成图片，或基于参考图编辑', icon: ImageIcon },
  video: { label: '视频生成', hint: '文字或参考图生成短视频', icon: Clapperboard },
  text: { label: '文本生成', hint: '生成文案、脚本与提示词', icon: FileText },
  audio: { label: '音频生成', hint: '生成配音与音效', icon: AudioLines },
  reference: { label: '参考素材', hint: '上传或选择参考图片、视频', icon: Paperclip },
  asset: { label: '资产', hint: '从资产库选择人物、场景、道具或风格', icon: Library },
  agent: { label: 'OAO Agent', hint: '读取当前画布，拆解并执行创作任务', icon: Bot },
}

export const GENERATION_TITLES: Record<GenerationKind, string> = {
  image: '图片生成',
  video: '视频生成',
  text: '文本生成',
  audio: '音频生成',
}

export const NODE_SIZE = {
  // Initial empty-card dimensions; React Flow measurements take over afterward.
  generation: { width: 320, height: 415 },
  media: { width: 232, height: 246 },
  agent: { width: 360, height: 420 },
  group: { width: 420, height: 300 },
} as const

export const NODE_GAP = 96

export type GenerationDefaults = Pick<
  SessionGenerationDefaults,
  'imageSize' | 'imageQuality' | 'imageCount' | 'videoQuality' | 'videoSeconds' | 'audioVoice' | 'audioFormat'
>

export function newNodeId(prefix: string) {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random.slice(0, 8)}`
}

export function createGenerationNode(kind: GenerationKind, position: XYPosition, defaults: GenerationDefaults, id = newNodeId(kind)): GenerationFlowNode {
  return {
    id,
    type: 'generation',
    position,
    data: {
      kind,
      title: GENERATION_TITLES[kind],
      prompt: '',
      model: '',
      ratio: kind === 'video' ? '16:9' : defaults.imageSize,
      quality: kind === 'image' ? defaults.imageQuality : kind === 'video' ? defaults.videoQuality : '',
      seconds: defaults.videoSeconds,
      count: kind === 'image' ? defaults.imageCount : 1,
      voice: defaults.audioVoice,
      format: defaults.audioFormat,
      references: [],
      skills: [],
      task: null,
      results: [],
      text: '',
    },
  }
}

export function createMediaNode(kind: MediaNodeKind, position: XYPosition, media: NodeReference | null = null, id = newNodeId(kind)): MediaFlowNode {
  return {
    id,
    type: 'media',
    position,
    data: { kind, title: media?.title ?? (kind === 'asset' ? '资产' : '参考素材'), media },
  }
}

export function createAgentNode(position: XYPosition, id = newNodeId('agent')): AgentFlowNode {
  return {
    id,
    type: 'agent',
    position,
    data: { kind: 'agent', title: 'OAO Agent', prompt: '', skills: [], runId: null, runStatus: null, steps: [], failure: null, pointsCost: null, context: [], clientRequestId: null },
  }
}

export function createGroupNode(position: XYPosition, size: { width: number; height: number }, id = newNodeId('group')): GroupFlowNode {
  return {
    id,
    type: 'group',
    position,
    width: size.width,
    height: size.height,
    data: { kind: 'group', title: '分组' },
  }
}

export function createNodeOfKind(kind: CreatableKind, position: XYPosition, defaults: GenerationDefaults): FreeCanvasNode {
  if (kind === 'agent') return createAgentNode(position)
  if (kind === 'reference' || kind === 'asset') return createMediaNode(kind, position)
  return createGenerationNode(kind, position, defaults)
}

export function sizeOf(node: FreeCanvasNode): { width: number; height: number } {
  const fallback = node.type === 'group' ? NODE_SIZE.group : node.type === 'media' ? NODE_SIZE.media : node.type === 'agent' ? NODE_SIZE.agent : NODE_SIZE.generation
  return {
    width: node.width ?? node.measured?.width ?? fallback.width,
    height: node.height ?? node.measured?.height ?? fallback.height,
  }
}
