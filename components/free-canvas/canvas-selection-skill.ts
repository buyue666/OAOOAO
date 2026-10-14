import { canvasSkillDraftPrompt, MAX_SKILL_PROMPT, type CanvasSkillDraft } from '@/lib/studio/canvas-skills'
import { selectionSnapshot } from './canvas-selection'
import type { FreeCanvasEdge, FreeCanvasNode, GenerationFlowNode } from './types'

export type SelectionSkillDraft = {
  draft: CanvasSkillDraft
  nodeCount: number
  stepCount: number
  connectionCount: number
  warnings: string[]
  promptLength: number
}

const KIND_LABEL = { image: '图片', video: '视频', text: '文本', audio: '音频' } as const

/** Build an editable instruction document, never a runnable graph or a serialized project. */
export function createSelectionSkillDraft(
  nodes: readonly FreeCanvasNode[],
  edges: readonly FreeCanvasEdge[],
  nodeIds?: readonly string[],
  models: readonly { id: string; name: string }[] = [],
): SelectionSkillDraft {
  if (nodeIds?.some((id) => !nodes.some((node) => node.id === id))) throw new Error('部分选中节点已不存在，请重新选择后创建技能')
  const snapshot = selectionSnapshot(nodes, edges, nodeIds)
  const generation = snapshot.nodes.filter((node): node is GenerationFlowNode => node.type === 'generation')
  if (!generation.some((node) => node.data.prompt.trim())) throw new Error('请至少选择一个已填写提示词的生成节点，再创建技能')
  const content = snapshot.nodes.filter((node) => node.type === 'generation' || node.type === 'media')
  const selectedIds = new Set(snapshot.nodes.map((node) => node.id))
  const contentIds = new Set(content.map((node) => node.id))
  const warnings: string[] = []
  let removedLinks = 0
  // Input text stays text. Links are not portable instructions and may contain signed credentials.
  const text = (value: string) => value.replace(/(?:https?:\/\/|blob:|data:|file:\/\/)[^\s<>"'，。；）)]+|\/(?:media|api\/reference-assets)\/[^\s<>"'，。；）)]+/gi, () => { removedLinks++; return '[使用时重新提供链接]' }).trim()
  const label = (value: string) => text(value).replace(/[\r\n]+/g, ' ')
  const seenEdges = new Set<string>()
  const internal = snapshot.edges.filter((edge) => {
    if (!contentIds.has(edge.source) || !contentIds.has(edge.target)) return false
    const key = JSON.stringify([edge.source, edge.target])
    if (seenEdges.has(key)) return false
    seenEdges.add(key)
    return true
  })
  const incoming = new Map(content.map((node) => [node.id, 0]))
  const outgoing = new Map(content.map((node) => [node.id, [] as string[]]))
  for (const edge of internal) { incoming.set(edge.target, incoming.get(edge.target)! + 1); outgoing.get(edge.source)!.push(edge.target) }
  const ready = content.filter((node) => !incoming.get(node.id)).map((node) => node.id)
  const ordered: string[] = []
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]
    ordered.push(id)
    for (const target of outgoing.get(id)!) {
      incoming.set(target, incoming.get(target)! - 1)
      if (incoming.get(target) === 0) ready.push(target)
    }
  }
  if (ordered.length < content.length) {
    const placed = new Set(ordered)
    ordered.push(...content.filter((node) => !placed.has(node.id)).map((node) => node.id))
    warnings.push('选中连线存在循环，已完整记录关系；请在草稿中确认步骤顺序。')
  }
  const byId = new Map(content.map((node) => [node.id, node]))
  const orderedGeneration = ordered.map((id) => byId.get(id)!).filter((node): node is GenerationFlowNode => node.type === 'generation')
  const labels = new Map(orderedGeneration.map((node, index) => [node.id, `步骤 ${index + 1}`]))
  const media = content.filter((node) => node.type === 'media')
  media.forEach((node, index) => labels.set(node.id, `参考素材 ${index + 1}`))
  const modelNames = new Map(models.map((model) => [model.id, model.name]))
  const sections = orderedGeneration.map((node, index) => {
    const data = node.data
    const settings = [`模型：${label(modelNames.get(data.model) || data.model || '使用时选择')}`]
    if (data.kind === 'image' || data.kind === 'video') {
      if (data.ratio) settings.push(`比例：${label(data.ratio)}`)
      if (data.quality) settings.push(`质量：${label(data.quality)}`)
    }
    if (data.kind === 'image' && Number.isFinite(data.count) && data.count > 0) settings.push(`原节点数量：${data.count}`)
    if (data.kind === 'video' && Number.isFinite(data.seconds) && data.seconds > 0) settings.push(`时长：${data.seconds} 秒`)
    if (data.kind === 'audio') {
      if (data.voice) settings.push(`音色：${label(data.voice)}`)
      if (data.format) settings.push(`格式：${label(data.format)}`)
    }
    return [
      `步骤 ${index + 1} · ${KIND_LABEL[data.kind]}：${label(data.title) || KIND_LABEL[data.kind]}`,
      text(data.prompt) || '（此步骤尚无提示词，请补充任务要求。）',
      `参考设置：${settings.join('；')}。`,
      data.references.length ? `本步骤原有 ${data.references.length} 份参考素材；使用时重新选择，素材文件与地址不随技能保存。` : '',
      data.skills.length ? `本步骤另有 ${data.skills.length} 个附加技能；其指令未复制，请在使用前另行选择或补充。` : '',
    ].filter(Boolean).join('\n')
  })
  if (media.length) sections.push('参考素材准备：\n' + media.map((node) => `${labels.get(node.id)} · ${label(node.data.title) || '未命名素材'}${node.data.media ? `（${KIND_LABEL[node.data.media.mediaKind]}）` : '（尚未选择素材）'}：使用时重新提供。`).join('\n'))
  if (internal.length) sections.push('选中节点的关联关系（仅作创作说明，不会自动连线或执行）：\n' + internal.map((edge) => `${labels.get(edge.source)} → ${labels.get(edge.target)}`).join('\n'))
  const externalCount = edges.filter((edge) => selectedIds.has(edge.source) !== selectedIds.has(edge.target)).length
  if (externalCount) warnings.push(`${externalCount} 条连接涉及未选中节点，未复制其内容；请补充实际需要的输入或步骤。`)
  const agents = snapshot.nodes.filter((node) => node.type === 'agent').length
  if (agents) warnings.push(`${agents} 个 Agent 节点的任务、运行历史和计划未加入技能。`)
  if (generation.some((node) => !node.data.prompt.trim())) warnings.push('部分生成节点的提示词为空，草稿中已标出，请保存前补充。')
  if (generation.some((node) => node.data.skills.length)) warnings.push('附加技能的指令未合并；如需这些要求，请在草稿中补充或在调用时另选技能。')
  if (removedLinks) warnings.push('文本中的链接已替换为提示占位，避免技能携带临时素材地址；原节点内容保持不变。')
  const draft: CanvasSkillDraft = {
    title: `${orderedGeneration.length} 步创作技能`,
    summary: `整理 ${orderedGeneration.length} 个生成节点的创作要求与参考参数。`,
    scenarios: '',
    usage: '先准备所需参考素材，再核对下方步骤。模型和参数仅供参考，以本次可用模型和实际生成设置为准；本技能提供文字要求，不会重建或自动执行原画布。',
    output: '',
    instructions: sections.join('\n\n'),
  }
  const promptLength = canvasSkillDraftPrompt(draft).length
  if (promptLength > MAX_SKILL_PROMPT) warnings.push(`已完整保留 ${promptLength} 个执行字符，超过 ${MAX_SKILL_PROMPT} 上限；请在编辑器精简后保存，不会自动截断。`)
  return { draft, nodeCount: snapshot.nodes.length, stepCount: orderedGeneration.length, connectionCount: internal.length, warnings, promptLength }
}
