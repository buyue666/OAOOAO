import type { GenerationReference } from './generation-types'

type VideoReferencesInput = {
  mode: string
  first: GenerationReference[]
  last: GenerationReference[]
  source: GenerationReference[]
  references: GenerationReference[]
  maxReferences: number
  frameReferenceTypes?: readonly ('image' | 'audio')[]
}

export function buildVideoReferences(input: VideoReferencesInput): GenerationReference[] {
  const frame = (items: GenerationReference[], role: 'first_frame' | 'last_frame') => {
    if (items.length !== 1 || items[0].type !== 'image' || !(items[0].url || items[0].dataUrl)) {
      throw new Error(role === 'first_frame' ? '请选择一张首帧图片' : '请选择一张尾帧图片')
    }
    return { ...items[0], role }
  }
  if (input.mode === 'frames' || input.mode === 'mixed') {
    if (input.mode === 'frames' && !input.first.length) throw new Error('请选择一张首帧图片，尾帧可选')
    const allowed = input.frameReferenceTypes ?? (input.mode === 'mixed' ? ['image', 'audio'] : [])
    for (const reference of input.references) {
      if (reference.type === 'video') throw new Error('首尾帧模式不支持参考视频，请切换到多参考模式')
      if (!allowed.includes(reference.type as 'image' | 'audio')) throw new Error('当前模型不支持首尾帧搭配此类参考素材')
    }
    const refs = [...(input.first.length ? [frame(input.first, 'first_frame')] : []), ...(input.last.length ? [frame(input.last, 'last_frame')] : []), ...input.references.map(item => ({ ...item, role: 'reference' as const }))]
    if (input.last.length && !input.first.length) throw new Error('请先选择首帧，再添加尾帧')
    if (refs.length > input.maxReferences) throw new Error(`参考素材最多 ${input.maxReferences} 个`)
    return refs
  }
  if (input.mode === 'first') return [frame(input.first, 'first_frame')]
  if (input.mode === 'ends') return [frame(input.first, 'first_frame'), frame(input.last, 'last_frame')]
  if (input.mode === 'edit') {
    if (input.source.length !== 1 || input.source[0].type !== 'video' || !(input.source[0].url || input.source[0].dataUrl)) {
      throw new Error('请选择一个待编辑视频')
    }
    return [{ ...input.source[0], role: 'reference' }]
  }
  if (input.references.length > input.maxReferences) throw new Error(`参考素材最多 ${input.maxReferences} 个，请减少上传或选择的素材`)
  return input.references.map((item) => ({ ...item, role: 'reference' }))
}

export function isVideoFrameMode(mode: string) { return ['frames', 'first', 'ends', 'mixed'].includes(mode) }

/** Every library dialog has one explicit kind, independent of generation mode. */
export function videoPickerKind(target: string | null): 'image' | 'video' | 'audio' {
  return target === 'source' || target === 'video' ? 'video' : target === 'audio' ? 'audio' : 'image'
}
