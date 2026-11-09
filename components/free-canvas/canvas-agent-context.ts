import { promptReferenceMentions, type PromptReference } from '@/lib/studio/prompt-references'
import type { FreeCanvasNode } from './types'

export function canvasAgentReferences(nodes: readonly FreeCanvasNode[]): PromptReference[] {
  return nodes.filter(node => node.type !== 'agent' && node.type !== 'group').slice(0, 100).map(node => ({
    id: node.id, name: node.data.title,
    type: node.type === 'media' ? node.data.media?.mediaKind || 'image' : node.type === 'generation' && ['image', 'video', 'audio'].includes(node.data.kind) ? node.data.kind as 'image' | 'video' | 'audio' : 'text',
    mention: `@「${node.data.title.replace(/[「」\r\n]/g, ' ').slice(0, 70)} · ${node.id}」`,
  }))
}

/** References are explicit IDs in the owned server snapshot, never model-provided media URLs. */
export function canvasAgentPrompt(prompt: string, nodes: readonly FreeCanvasNode[]) {
  const references = canvasAgentReferences(nodes)
  const mentioned = promptReferenceMentions(prompt, references).map(token => references[token.index])
  for (const match of prompt.matchAll(/@「[^」]+」/g)) if (!references.some(reference => reference.mention === match[0])) throw new Error('有引用的节点已移除或改名，请重新输入 @ 选择。')
  const ids = [...new Set([...mentioned.map(reference => reference.id), ...nodes.filter(node => node.selected && node.type !== 'agent').map(node => node.id)])]
  return ids.length ? `${prompt}\n\n本次明确引用的画布节点 ID（以当前服务端画布为准）：${JSON.stringify(ids)}。先提出可审核计划，不宣称已修改画布。` : prompt
}
