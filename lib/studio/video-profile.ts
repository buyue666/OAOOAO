import type {VideoDurationRule} from './video-duration'

export type ReferencePrices = {
  extraImage?: number
  extraVideo?: number
  extraAudio?: number
  referenceVideoPerSecond?: number
  referenceAudioPerSecond?: number
}
export type ReferencePriceTier = {maxSeconds: number; prices: ReferencePrices}
export type ResolutionPricing = {
  generationRate?: number | null
  referenceVideoGenerationRate?: number | null
  generationDurationRates?: Record<string, number>
  referenceVideoGenerationDurationRates?: Record<string, number>
  referencePrices?: ReferencePrices
  referenceDurationTiers?: ReferencePriceTier[]
  additionalPrices?: Record<string, number>
}
export type VideoPricing = ReferencePrices & {
  resolutionRates?: Record<string, number>
  durationRates?: Record<string, Record<string, number>>
  resolutionPricing?: Record<string, ResolutionPricing>
  [key: string]: unknown
}
export type VideoProfile = Record<string, unknown>
export const DOUBAO_VIDEO_PRICING_TEMPLATE = 'doubao-video'
export const isConditionalVideoPricing = (template: unknown) => template === 'reference-video-output' || template === DOUBAO_VIDEO_PRICING_TEMPLATE

const commonVideoRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3']
const ratioList = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim()))] : undefined
export function videoAspectRatios(profile: VideoProfile) {
  return ratioList(profile.aspectRatios) ?? ratioList(profile.nativeAspectRatios) ?? [...commonVideoRatios]
}
export function videoAspectRatioChoices(profile: VideoProfile) {
  return [...new Set([...(ratioList(profile.nativeAspectRatios) ?? [...commonVideoRatios, 'adaptive', 'auto']), ...videoAspectRatios(profile)])]
}
export function addVideoAspectRatio(profile: VideoProfile, raw: string) {
  const value = raw.trim().replace(/：/g, ':').replace(/\s+/g, '')
  const match = /^(\d{1,4}):(\d{1,4})$/.exec(value)
  if (!['auto', 'adaptive'].includes(value) && (!match || Number(match[1]) < 1 || Number(match[2]) < 1)) throw new Error('请输入有效比例，例如 16:9、9:16，或 auto、adaptive')
  const ratios = videoAspectRatios(profile)
  if (ratios.includes(value)) throw new Error('该比例已启用')
  const native = ratioList(profile.nativeAspectRatios)
  if (native && !native.includes(value)) throw new Error('此渠道当前模型不支持该比例')
  if (ratios.length >= 32) throw new Error('最多配置 32 个比例')
  return [...ratios, value]
}
export const referencePriceKeys = ['extraImage', 'extraVideo', 'extraAudio', 'referenceVideoPerSecond', 'referenceAudioPerSecond'] as const

export function resolutionPricing(profile: VideoProfile, quality: string, fallbackRate?: number): ResolutionPricing {
  const pricing = (profile.videoPricing || {}) as VideoPricing
  const row = pricing.resolutionPricing?.[quality] || {}
  const referencePrices = row.referencePrices ?? Object.fromEntries(referencePriceKeys.filter(key => typeof pricing[key] === 'number').map(key => [key, pricing[key]]))
  return {
    ...row,
    generationRate: Object.hasOwn(row, 'generationRate') ? row.generationRate : pricing.resolutionRates?.[quality] ?? fallbackRate,
    ...(isConditionalVideoPricing(profile.videoPricingTemplate) ? {referenceVideoGenerationRate: Object.hasOwn(row, 'referenceVideoGenerationRate') ? row.referenceVideoGenerationRate : profile.videoPricingTemplate === DOUBAO_VIDEO_PRICING_TEMPLATE ? undefined : row.referenceDurationTiers ? row.referenceDurationTiers[0]?.prices.referenceVideoPerSecond : referencePrices.referenceVideoPerSecond} : {}),
    generationDurationRates: row.generationDurationRates ?? pricing.durationRates?.[quality],
    referencePrices,
  }
}

export function videoDurationRule(profile: VideoProfile, quality: string): VideoDurationRule {
  const rules = (profile.videoDurationRules || {}) as Record<string, VideoDurationRule>
  const durations = (profile.durationSeconds || [4,8,12]) as number[]
  const max = (profile.maxDurationByResolution as Record<string, number> | undefined)?.[quality] || 3600
  return rules[quality] || {mode: 'list', values: durations.filter(seconds => seconds <= max)}
}

export function videoDurationValues(profile: VideoProfile, quality: string, rule = videoDurationRule(profile, quality)): number[] {
  const native = (profile.nativeDurationSeconds || []) as number[]
  const max = (profile.maxDurationByResolution as Record<string, number> | undefined)?.[quality] || 3600
  const candidates = rule.mode === 'list' ? rule.values || [] : Array.from({length: Math.min(3600, Math.max(0, Math.floor(((rule.max || 1) - (rule.min || 1)) / (rule.step || 1)) + 1))}, (_, index) => (rule.min || 1) + index * (rule.step || 1))
  return [...new Set(candidates)].filter(seconds => seconds > 0 && seconds <= max && (!native.length || native.includes(seconds))).sort((a, b) => a - b)
}

export function durationRulesPatch(profile: VideoProfile, rules: Record<string, VideoDurationRule>): VideoProfile {
  const native = (profile.nativeDurationSeconds || []) as number[]
  const qualities = (profile.videoQualities || []) as string[]
  const values = qualities.flatMap(quality => videoDurationValues({...profile, videoDurationRules: rules}, quality))
  return {videoDurationRules: rules, durationSeconds: native.length ? native : [...new Set(values)].sort((a, b) => a - b)}
}

export function copyVideoResolutionParameters(profile: VideoProfile, source: string, selected: readonly string[], fallbackRate?: number): VideoProfile {
  const qualities = (profile.videoQualities || []) as string[]
  if (!qualities.includes(source) || !selected.includes(source)) throw new Error('请先选择参数来源清晰度')
  const targets = [...new Set(selected)].filter(quality => quality !== source && qualities.includes(quality))
  if (!targets.length) throw new Error('请至少选择两个清晰度')
  const pricing = (profile.videoPricing || {}) as VideoPricing
  const rows = {...pricing.resolutionPricing}
  const rules = {...(profile.videoDurationRules || {}) as Record<string, VideoDurationRule>}
  const sourceRule = videoDurationRule(profile, source)
  const sourcePrices = resolutionPricing(profile, source, fallbackRate)
  for (const quality of targets) {
    const allowed = videoDurationValues(profile, quality, sourceRule)
    if (!allowed.length) throw new Error(`${quality} 不支持来源清晰度的时长，请单独设置`)
    rules[quality] = sourceRule.mode === 'range'
      ? {mode: 'range', min: allowed[0], max: allowed.at(-1), step: sourceRule.step || 1}
      : {mode: 'list', values: allowed}
    const row = structuredClone(sourcePrices)
    if (row.generationDurationRates) row.generationDurationRates = Object.fromEntries(Object.entries(row.generationDurationRates).filter(([seconds]) => allowed.includes(Number(seconds))))
    if (row.referenceVideoGenerationDurationRates) row.referenceVideoGenerationDurationRates = Object.fromEntries(Object.entries(row.referenceVideoGenerationDurationRates).filter(([seconds]) => allowed.includes(Number(seconds))))
    if (row.referenceDurationTiers) {
      const max = allowed.at(-1)!
      row.referenceDurationTiers = row.referenceDurationTiers.filter((tier, index, tiers) => index === 0 || tiers[index - 1].maxSeconds < max).map(tier => ({...tier, maxSeconds: Math.min(tier.maxSeconds, max)}))
    }
    rows[quality] = row
  }
  return {...durationRulesPatch(profile, rules), videoPricing: {...pricing, resolutionPricing: rows}}
}

export function validVideoQuality(value: string, existing: readonly string[]): string {
  const quality = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,31}$/.test(quality) || ['constructor','prototype','__proto__'].includes(quality.toLowerCase())) throw new Error('请输入上游接受的清晰度参数，例如 720p、2K')
  if (existing.some(item => item.toLowerCase() === quality.toLowerCase())) throw new Error('该清晰度已存在')
  if (existing.length >= 16) throw new Error('最多配置 16 个清晰度')
  return quality
}
