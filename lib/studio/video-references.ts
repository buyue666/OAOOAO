import type { GenerationReference } from './generation-types'

type VideoReferencesInput = {
  mode: string
  first: GenerationReference[]
  last: GenerationReference[]
  source: GenerationReference[]
  references: GenerationReference[]
  maxReferences: number
}

export function buildVideoReferences(input: VideoReferencesInput): GenerationReference[] {
  const frame = (items: GenerationReference[], role: 'first_frame' | 'last_frame') => {
    if (items.length !== 1 || items[0].type !== 'image' || !(items[0].url || items[0].dataUrl)) {
      throw new Error(role === 'first_frame' ? '请选择一张首帧图片' : '请选择一张尾帧图片')
    }
    return { ...items[0], role }
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
