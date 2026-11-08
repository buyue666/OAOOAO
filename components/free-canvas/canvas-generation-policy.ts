import type { ModelConfig } from '@/lib/studio/types'
import { isSubmittableReferenceUrl } from '@/lib/studio/reference-assets'
import { promptReferenceMentions, referenceMentionLabel, serializePromptReferences } from '@/lib/studio/prompt-references'
import { selectableVideoDurations, videoReferenceLimit } from '@/lib/studio/video-policy'
import type { FreeCanvasEdge, FreeCanvasNode, GenerationNodeData, NodeReference, NodeSubmission } from './types'

/** Explicit references retain their mention order when a new upstream node is connected. */
export function canvasReferences(nodeId: string, data: GenerationNodeData, nodes: FreeCanvasNode[], edges: FreeCanvasEdge[]) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const candidates = [...data.references]
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const source = byId.get(edge.source)
    if (source?.type === 'media' && source.data.media) candidates.push(source.data.media)
    if (source?.type === 'generation' && source.data.results[0]) {
      const result = source.data.results[0]
      candidates.push({ id: source.id, title: source.data.title, url: result.url, mediaKind: result.mediaKind })
    }
  }
  const seen = new Set<string>()
  return candidates.filter(reference => {
    const key = reference.url.trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function canvasVideoMode(references: NodeReference[]) {
  if (references.some(ref => ref.role === 'last_frame')) return 'ends'
  if (references.some(ref => ref.role === 'first_frame')) return 'first'
  return references.length ? 'references' : 'text'
}

/** Apply supported defaults only when creating a node or explicitly changing a model. */
export function canvasModelDefaults(data: GenerationNodeData, model: ModelConfig | undefined): GenerationNodeData {
  if (!model) return data
  const caps = model.capabilities
  const quality = caps.qualities.includes(data.quality) ? data.quality : caps.qualities[0] || data.quality
  const durations = selectableVideoDurations(model, quality, canvasVideoMode(data.references)).map(value => Number.parseFloat(value))
  return { ...data, ratio: caps.ratios.includes(data.ratio) ? data.ratio : caps.ratios[0] || data.ratio,
    resolution: caps.resolutions.includes(data.resolution) ? data.resolution : caps.resolutions[0] || data.resolution,
    quality, seconds: durations.includes(data.seconds) ? data.seconds : durations[0] || data.seconds }
}

export function validateCanvasGeneration(data: GenerationNodeData, model: ModelConfig | undefined, references: NodeReference[]) {
  if (!model) throw new Error('请先选择一个当前可用的模型')
  const caps = model.capabilities
  if (references.some(ref => !isSubmittableReferenceUrl(ref.url))) throw new Error('参考素材尚未上传完成，请重新选择素材')
  if (references.length > caps.maxReferences) throw new Error(`当前模型最多支持 ${caps.maxReferences} 个参考素材，已选择 ${references.length} 个；请移除多余素材或连线`)
  if (data.kind === 'image' && references.some(ref => ref.mediaKind !== 'image')) throw new Error('图片生成只支持图片参考素材')
  if ((data.kind === 'audio' || data.kind === 'text') && references.length) throw new Error('此生成节点暂不支持媒体参考，请移除素材连线')
  if (['image', 'video'].includes(data.kind)) {
    if (caps.ratios.length && !caps.ratios.includes(data.ratio)) throw new Error('请在节点配置中选择当前模型支持的比例')
    if (caps.qualities.length && !caps.qualities.includes(data.quality) && data.kind === 'video') throw new Error('请重新选择清晰度')
  }
  if (data.kind !== 'video') return
  const frames = references.filter(ref => ref.role === 'first_frame' || ref.role === 'last_frame')
  if (frames.some(ref => ref.mediaKind !== 'image')) throw new Error('首尾帧只能使用图片')
  for (const role of ['first_frame', 'last_frame'] as const) {
    if (frames.filter(ref => ref.role === role).length > 1) throw new Error('首帧和尾帧各只能选择一张图片')
  }
  if (frames.some(ref => ref.role === 'first_frame') && !caps.firstFrame) throw new Error('当前模型不支持首帧')
  if (frames.some(ref => ref.role === 'last_frame') && !caps.lastFrame) throw new Error('当前模型不支持尾帧')
  if (frames.some(ref => ref.role === 'last_frame') && !frames.some(ref => ref.role === 'first_frame')) throw new Error('请同时选择首帧图片')
  if (frames.length) {
    if (references.some(ref => ref.mediaKind === 'video')) throw new Error('首尾帧模式不能同时使用参考视频')
    const allowed = caps.videoPolicy?.frameReferenceTypes ?? []
    if (references.some(ref => (!ref.role || ref.role === 'reference') && !allowed.includes(ref.mediaKind as 'image' | 'audio'))) throw new Error('当前模型的首尾帧模式不支持这些额外参考素材')
  }
  for (const type of ['image', 'video', 'audio'] as const) {
    if (references.filter(ref => ref.mediaKind === type).length > videoReferenceLimit(model, type)) throw new Error(`当前模型的${type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}参考数量超出限制`)
  }
  const durations = selectableVideoDurations(model, data.quality, canvasVideoMode(references)).map(value => Number.parseFloat(value))
  if (caps.durations.length && !durations.includes(data.seconds)) throw new Error('当前素材模式或清晰度不支持这个时长，请重新选择')
}

export function submissionReferences(references: NodeReference[]) {
  return references.map(ref => ({ name: ref.title, type: ref.mediaKind, url: ref.url.trim(), ...(ref.role ? { role: ref.role } : {}) }))
}

export function canvasPrompt(prompt: string, references: NodeReference[]) {
  return serializePromptReferences(prompt, references.map(ref => ({ type: ref.mediaKind })))
}

export function remapCanvasMentions(prompt: string, previous: NodeReference[], next: NodeReference[]) {
  const oldTypes = previous.map(ref => ({ type: ref.mediaKind })), newTypes = next.map(ref => ({ type: ref.mediaKind }))
  let result = '', end = 0
  for (const token of promptReferenceMentions(prompt, oldTypes)) {
    const ref = previous[token.index], index = next.findIndex(item => item.url === ref.url)
    result += prompt.slice(end, token.start) + (index < 0 ? `（已移除：${ref.title}）` : referenceMentionLabel(newTypes, index))
    end = token.end
  }
  return result + prompt.slice(end)
}

/** The team transport uses the same parameter names as the regular generation adapters. */
export function teamCanvasPayload(submission: NodeSubmission) {
  const input = submission.input
  return { kind: submission.kind, prompt: input.prompt, config: {
    model: input.model,
    ...('ratio' in input ? { size: input.ratio } : {}),
    ...(submission.kind === 'image' ? { resolution: submission.input.resolution, quality: submission.input.quality, n: submission.input.count ?? 1 } : {}),
    ...(submission.kind === 'video' ? { vquality: submission.input.quality, videoSeconds: String(submission.input.seconds) } : {}),
    ...(submission.kind === 'audio' ? { voice: submission.input.voice, format: submission.input.format } : {}),
  }, references: 'references' in input ? input.references ?? [] : [], ...(submission.kind === 'image' && submission.input.edit ? { edit: submission.input.edit } : {}) }
}
