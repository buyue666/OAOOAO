/**
 * 由后端会话返回的真实逻辑模型目录派生出 UI 需要的模型配置。
 *
 * 后端 `settings.logicalModels` 与 `defaultModels` 是唯一事实来源；
 * 这里只做展示层适配（中文能力标签、比例/时长候选项、积分估算），不凭空造模型。
 */
import type { ModelCapability, ModelConfig, StudioMode } from './types'
import type { SessionGenerationDefaults, SessionGenerationSettings, SessionLogicalModel } from './generation-types'

const defaultCapability: ModelCapability = {
  textToMedia: true,
  firstFrame: false,
  lastFrame: false,
  multiReference: false,
  editing: false,
  durations: [],
  ratios: [],
  qualities: [],
  maxReferences: 0,
  maxBatchSize: 1,
}

/**
 * 后端未配置 `capabilityProfile` 时，参考素材数量采用的保守默认上限。
 *
 * 为什么不是 0：`0` 会被界面解读为「该模型不接受参考图」从而隐藏整个入口，
 * 但后端在没有 profile 时**不做上限校验**，带参考图的请求会被正常受理
 * （实测 `e2e-image` 无 profile，`POST /api/image-tasks` 带 references 返回 200 且 `kind:"edit"`）。
 * 用 0 会让一个真实可用的能力从界面上消失。
 */
const UNCONFIGURED_REFERENCE_LIMIT = 4

const qualityLabels = ['auto', 'low', 'medium', 'high']
const qualityLabelText: Record<string, string> = { auto: '自动', low: '低', medium: '中', high: '高清', standard: '标准', hd: '超清' }
const defaultVideoQualities = ['480', '720', '1080']
const defaultImageRatios = ['1:1', '4:5', '16:9', '9:16']
const audioVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
const audioFormats = ['mp3', 'wav', 'opus', 'aac']

const kindLabels: Record<string, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }

/** 后端能力到界面分组的映射。音频必须是独立分组，不能落到 image。 */
const kindByCapability: Record<SessionLogicalModel['capability'], StudioMode> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'drama',
}

/** 逻辑模型 ID 在前台保持不变，这样任务请求提交的就是后端认识的标识。 */
export function modelsFromSession(settings: SessionGenerationSettings | undefined): ModelConfig[] {
  const logicalModels = settings?.logicalModels ?? []
  return logicalModels
    .filter((model) => model.enabled && model.bindings.some((binding) => binding.enabled))
    .map((model) => toModelConfig(model, settings))
}

function toModelConfig(model: SessionLogicalModel, settings?: SessionGenerationSettings): ModelConfig {
  const profile = model.bindings.find((binding) => binding.enabled)?.capabilityProfile
  /**
   * 后端**明确声明**的能力：沿用「只有 profile 明确声明才算支持」的原语义。
   *
   * 本轮只调整 `maxReferences` 一处（见下），其余能力标志保持原样，
   * 避免在修「参考素材选不到上传素材」时顺带改变其他界面行为。
   */
  const explicitlyUnsupported = Boolean(profile) && profile?.supportsReferenceImage === false
  const supportsReference = Boolean(profile?.supportsReferenceImage)
  const capability: ModelCapability = {
    ...defaultCapability,
    firstFrame: supportsReference,
    lastFrame: supportsReference,
    multiReference: supportsReference && (profile?.maxReferenceImages ?? 0) > 1,
    editing: supportsReference,
    durations: (profile?.durationSeconds ?? []).map((value) => `${value} 秒`),
    ratios: profile?.aspectRatios?.length ? [...profile.aspectRatios] : defaultRatiosFor(model.capability),
    qualities: qualityCandidates(model.capability, settings, profile?.resolutions),
    /**
     * 未配置上限时用保守默认值，**不能**给 0。
     *
     * `0` 被界面解读为「该模型不接受参考图」→ 直接隐藏整个参考素材入口。
     * 但后端在没有 profile 时不做上限校验，带参考图的请求会被正常受理
     * （实测 `e2e-image` 无 profile，带 references 提交返回 200 且 `kind:"edit"`）。
     * 给 0 会把一个真实可用的能力从界面上抹掉——用户报的「选不到上传素材」会变成「根本没有入口」。
     */
    maxReferences: explicitlyUnsupported ? 0 : Math.max(1, Number(profile?.maxReferenceImages) || UNCONFIGURED_REFERENCE_LIMIT),
    // 后端 maxBatchSize 决定能否一次提交多张/多条；缺省按 1 处理，避免发出后端不支持的批量。
    maxBatchSize: Math.max(1, Number(profile?.maxBatchSize) || 1),
  }
  const kind = kindByCapability[model.capability] ?? 'image'
  const capabilityLabel = kindLabels[model.capability] ?? model.capability
  return {
    id: model.id,
    name: model.name || model.id,
    shortName: model.name || model.id,
    provider: capabilityLabel,
    kind,
    capability: model.capability,
    description: `后台配置的${capabilityLabel}模型 · ${model.bindings.filter((binding) => binding.enabled).length} 条可用渠道`,
    creditCost: Number(settings?.modelPointCosts?.[model.id]) || 0,
    capabilities: capability,
    status: '可用',
  }
}

function defaultRatiosFor(capability: SessionLogicalModel['capability']) {
  return capability === 'image' || capability === 'video' ? defaultImageRatios : []
}

/**
 * 清晰度候选。返回的是**协议值**（auto/low/medium/high、480/720/1080、mp3…），
 * 中文只用于展示，由 qualityLabel 转换，避免把中文直接发给上游。
 */
function qualityCandidates(capability: SessionLogicalModel['capability'], settings?: SessionGenerationSettings, profileResolutions?: string[]) {
  if (profileResolutions?.length) return [...profileResolutions]
  if (capability === 'video') {
    const configured = Object.keys(settings?.generationPointMultipliers?.videoQuality ?? {})
    return configured.length ? configured : defaultVideoQualities
  }
  if (capability === 'image') return qualityLabels
  if (capability === 'audio') return audioFormats
  return []
}

export function qualityLabel(value: string) {
  return qualityLabelText[value] ?? value
}

/**
 * 按后端原样能力过滤，而不是按 kind 猜测。
 * 早先 audio 被映射成 image，导致音频模型出现在生图下拉里。
 */
export function filterModelsByCapability(models: ModelConfig[], capability: SessionLogicalModel['capability']) {
  return models.filter((model) => model.capability === capability)
}

/** 默认模型直接取后端 defaultModels，保证与后端解析出的渠道一致。 */
export function defaultModelFor(capability: SessionLogicalModel['capability'], settings?: SessionGenerationSettings, models: ModelConfig[] = []) {
  const defaults = settings?.defaultModels
  const preferred = capability === 'image' ? defaults?.imageModel : capability === 'video' ? defaults?.videoModel : capability === 'audio' ? defaults?.audioModel : defaults?.textModel
  if (preferred && models.some((model) => model.id === preferred)) return preferred
  return models[0]?.id ?? ''
}
export function defaultGenerationDefaults(settings?: SessionGenerationSettings): SessionGenerationDefaults {
  return settings?.generationDefaults ?? {
    canvasImageCount: 1,
    imageSize: '1:1',
    imageQuality: 'auto',
    imageCount: 1,
    videoQuality: '720',
    videoSeconds: 5,
    audioVoice: 'alloy',
    audioFormat: 'mp3',
  }
}

export function defaultVoices() {
  return audioVoices
}

export function defaultFormats() {
  return audioFormats
}

/**
 * 积分估算与后端保持同一套规则：
 * 单次模型积分 × 数量 × 时长倍率 × 清晰度倍率。
 * 结果为 0 表示后端未对该模型单独定价，实际扣费以任务返回的 billing 为准。
 */
export function estimatePoints(
  modelId: string,
  settings: SessionGenerationSettings | undefined,
  models: ModelConfig[],
  options: { count?: number; quality?: string; seconds?: number } = {},
) {
  const model = models.find((item) => item.id === modelId)
  const base = Number(settings?.modelPointCosts?.[modelId]) || model?.creditCost || 0
  if (!base) return 0
  const multipliers = settings?.generationPointMultipliers
  const count = Math.max(1, Number(options.count) || 1)
  const qualityMultiplier = multipliers?.imageQuality?.[options.quality ?? ''] ?? multipliers?.videoQuality?.[options.quality ?? ''] ?? 1
  const secondsMultiplier = options.seconds ? multipliers?.videoSeconds?.[String(options.seconds)] ?? 1 : 1
  const total = base * count * (Number(qualityMultiplier) || 1) * (Number(secondsMultiplier) || 1)
  return Math.max(0, Math.ceil(total))
}

export function hasUsableModels(settings?: SessionGenerationSettings) {
  return modelsFromSession(settings).length > 0
}
