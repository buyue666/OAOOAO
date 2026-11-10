import type { GenerationReference, ImageGenerationInput } from './generation-types'

export type TryOnRole = 'person' | 'garment' | 'pose'
export type TryOnReference = {
  id: string; title: string; url: string; thumbnailUrl?: string; source?: 'catalog' | 'asset' | 'upload'
  role?: TryOnRole; groupId?: string; category?: string; style?: string; angle?: string; tags?: string[]; attribution?: string
  variants?: TryOnReference[]
}
export type TryOnSelections = Record<TryOnRole, TryOnReference | null>
export const tryOnRoleLabels: Record<TryOnRole, string> = { person: '人物', garment: '服装', pose: '姿势' }
export const emptyTryOnSelections = (): TryOnSelections => ({ person: null, garment: null, pose: null })
export const defaultTryOnPreset = '生成一张完整、自然的时尚试穿照片。精确保留参考服装的颜色、面料、纹样、领口、袖长和剪裁，呈现合理的贴合、褶皱与遮挡。不要把参考图拼成多宫格，不要输出人台、骨架线稿、图中文字或水印。'

export function tryOnReferences(selections: TryOnSelections): GenerationReference[] {
  return (['person','garment','pose'] as const).flatMap(role => {
    const item = selections[role]
    return item ? [{ name: `${tryOnRoleLabels[role]}：${item.title}`, type: 'image', url: item.url, role: 'reference' as const }] : []
  })
}
export function buildTryOnPrompt(selections: TryOnSelections, options: { prompt: string; preset?: string; background: 'preserve' | 'studio' | 'outdoor'; style: 'photo' | 'anime' }) {
  const lines = [options.preset ?? defaultTryOnPreset]
  let index = 0
  for (const role of ['person','garment','pose'] as const) {
    const item = selections[role]
    if (!item) continue
    index++
    lines.push(role === 'person' ? `参考图 ${index} 是人物身份参考：保留面部、发型、肤色、体型与人物辨识度。`
      : role === 'garment' ? `参考图 ${index} 是服装参考：提取衣物与配饰，不复制人台、衣架或背景。`
        : `参考图 ${index} 是姿势与构图参考：优先遵循身体动作、四肢位置、人物朝向、取景与相机视角${item.angle ? `（${item.angle}）` : ''}，不要把姿势参考的人物身份或衣物混入结果。`)
  }
  if (!selections.person) lines.push('未指定人物身份，请根据服装与姿势设计一名成年模特。')
  if (!selections.garment) lines.push('未指定服装，保留人物原有衣着；没有人物参考时自行设计合适穿搭。')
  if (!selections.pose) lines.push(selections.person ? '未指定姿势，保留人物参考中的原有姿势与朝向。' : '未指定姿势，采用自然且适合展示服装的动作。')
  lines.push(options.background === 'preserve' && selections.person ? '尽量保留人物参考的背景与光线，同时适配目标姿势。' : options.background === 'outdoor' ? '采用自然户外场景，光线与人物和服装协调。' : '采用简洁商业摄影棚背景与柔和布光。')
  lines.push(options.style === 'anime' ? '输出精致动漫插画风格。' : '输出商业写实摄影质感，自然皮肤与真实衣物纹理。')
  if (options.prompt.trim()) lines.push(`补充要求：${options.prompt.trim()}`)
  return lines.filter(Boolean).join('\n')
}
export function tryOnReferenceError(selections: TryOnSelections, maxReferences: number) {
  const count = tryOnReferences(selections).length
  if (count > maxReferences) return maxReferences === 0 ? '当前模型不支持参考图，请选择支持图生图的模型。' : `当前模型最多支持 ${maxReferences} 张参考图，已选择 ${count} 张。请更换模型或减少参考。`
  return ''
}
export function tryOnInput(selections: TryOnSelections, options: { model: string; ratio: string; resolution: string; quality: string; count: number; prompt: string; preset?: string; background: 'preserve' | 'studio' | 'outdoor'; style: 'photo' | 'anime' }): ImageGenerationInput {
  const references = tryOnReferences(selections)
  return { prompt: buildTryOnPrompt(selections, options), model: options.model, ratio: options.ratio, resolution: options.resolution, quality: options.quality, count: options.count,
    kind: references.length ? 'edit' : 'generation', references, title: 'AI换装', surface: 'chat' }
}
