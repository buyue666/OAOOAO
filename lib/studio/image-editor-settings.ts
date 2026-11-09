import type { ModelConfig } from './types'
import type { GenerationReference } from './generation-types'
import { selectableVideoDurations } from './video-policy'

export function imageEditorModelSettings(model: ModelConfig) {
  const qualities = model.capabilities.qualities
  return {
    id: model.id,
    label: `${model.shortName || model.name}${model.capability === 'image' && model.creditCost > 0 ? ` · ${model.creditCost} 积分/张` : ''}`,
    note: model.note,
    capability: model.capability as 'image' | 'video',
    ratios: model.capabilities.ratios,
    resolutions: model.capabilities.resolutions,
    qualities,
    qualityLabels: model.capabilities.qualityLabels,
    creditCost: model.creditCost,
    videoDurations: model.capability === 'video' ? Object.fromEntries((qualities.length ? qualities : ['']).map(quality => [quality, selectableVideoDurations(model, quality, model.capabilities.firstFrame ? 'first' : 'references').map(value => Number.parseFloat(value))])) : undefined,
  }
}

/** Quote and submit must use the same source role, ratio, quality and duration. */
export function imageEditorVideoInput(model: ModelConfig, imageUrl: string, sourceRatio: string | undefined, quality: string, seconds: number) {
  const reference: GenerationReference = { type: 'image', ...(imageUrl.startsWith('data:') ? { dataUrl: imageUrl } : { url: imageUrl }), ...(model.capabilities.firstFrame ? { role: 'first_frame' as const } : {}) }
  return { model: model.id, ratio: sourceRatio && model.capabilities.ratios.includes(sourceRatio) ? sourceRatio : model.capabilities.ratios[0] || '16:9', quality, seconds, references: [reference] }
}
