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
  resolutions: [],
  outputDimensions: {},
  outputDimensionsByResolution: {},
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
const qualityLabelText: Record<string, string> = { auto: '自动', low: '低', medium: '中', high: '高', standard: '标准', hd: '超清' }
const defaultVideoQualities = ['480', '720', '1080']
const defaultImageRatios = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9']
const defaultImageResolutions = ['1K']
/**
 * 仅作为没有配置 outputDimensions 时的展示兜底；真实渠道尺寸应由后台能力配置覆盖。
 * 尺寸遵循 GPT 图片接口的 16 倍数约束，避免把 UI 比例误当成上游不接受的自定义尺寸。
 */
const defaultOutputDimensions: Record<string, string> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '16:9': '1536x864',
  '9:16': '864x1536',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '21:9': '1536x656',
}
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
    .flatMap((model) => {
      const bindings = model.bindings.filter((binding) => binding.enabled)
      const aliasedBindings = bindings.filter((binding) => binding.requestAlias?.trim())
      // 保留逻辑模型作为默认/兜底入口，同时把每个绑定别名作为独立可售入口展示。
      return [toModelConfig(model, settings), ...aliasedBindings.map((binding) => toModelConfig(model, settings, binding))]
    })
}

function toModelConfig(model: SessionLogicalModel, settings?: SessionGenerationSettings, binding?: SessionLogicalModel['bindings'][number]): ModelConfig {
  const selectedBinding = binding || model.bindings.find((item) => item.enabled)
  const profile = selectedBinding?.capabilityProfile
  /**
   * 后端**明确声明**的能力：沿用「只有 profile 明确声明才算支持」的原语义。
   *
   * 本轮只调整 `maxReferences` 一处（见下），其余能力标志保持原样，
   * 避免在修「参考素材选不到上传素材」时顺带改变其他界面行为。
   */
  const explicitlyUnsupported = Boolean(profile) && profile?.supportsReferenceImage === false
  const supportsReference = Boolean(profile?.supportsReferenceImage)
  const configuredResolutions = profile?.outputResolutions?.length ? profile.outputResolutions : profile?.resolutions
  const configuredQualities = profile?.imageQualities?.length ? profile.imageQualities : profile?.qualities
  const outputDimensions = normalizeOutputDimensions(profile, configuredResolutions)
  const capability: ModelCapability = {
    ...defaultCapability,
    firstFrame: supportsReference,
    lastFrame: supportsReference,
    multiReference: supportsReference && (profile?.maxReferenceImages ?? 0) > 1,
    editing: supportsReference,
    durations: (profile?.durationSeconds ?? []).map((value) => `${value} 秒`),
    ratios: profile?.aspectRatios?.length ? [...profile.aspectRatios] : defaultRatiosFor(model.capability),
    resolutions: configuredResolutions?.length
      ? [...configuredResolutions]
      : defaultResolutionsFor(model.capability),
    outputDimensions: model.capability === 'image' ? outputDimensions.selected : defaultOutputDimensionsFor(model.capability),
    outputDimensionsByResolution: model.capability === 'image' ? outputDimensions.byResolution : {},
    qualities: qualityCandidates(model.capability, settings, configuredQualities),
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
  const requestId = selectedBinding?.requestAlias?.trim() || model.id
  const requestName = selectedBinding?.requestAlias?.trim() || model.name || model.id
  const configuredCost = settings?.modelPointCosts || {}
  const cost = configuredCost[requestId] ?? (selectedBinding ? configuredCost[selectedBinding.upstreamModel] : undefined) ?? configuredCost[model.id]
  return {
    id: requestId,
    name: requestName,
    shortName: requestName,
    provider: capabilityLabel,
    kind,
    capability: model.capability,
    description: selectedBinding?.requestAlias ? `绑定 ${selectedBinding.channelId} · 上游 ${selectedBinding.upstreamModel}` : `后台配置的${capabilityLabel}模型 · ${model.bindings.filter((item) => item.enabled).length} 条可用渠道`,
    creditCost: Number(cost) || 0,
    capabilities: capability,
    status: '可用',
    iconUrl: selectedBinding?.iconUrl || model.iconUrl,
  }
}

function defaultRatiosFor(capability: SessionLogicalModel['capability']) {
  return capability === 'image' || capability === 'video' ? defaultImageRatios : []
}

function defaultResolutionsFor(capability: SessionLogicalModel['capability']) {
  return capability === 'image' ? defaultImageResolutions : []
}

function defaultOutputDimensionsFor(capability: SessionLogicalModel['capability']) {
  return capability === 'image' ? { ...defaultOutputDimensions } : {}
}

type NormalizedOutputDimensions = {
  selected: Record<string, string>
  byResolution: Record<string, Record<string, string>>
}

/**
 * Normalize the two capability-map spellings accepted by the backend.  The
 * admin UI historically stored a flat ratio map while newer bindings may use
 * either `{ '1K': { '1:1': '1024x1024' } }` or `{ '1:1': { '1K': ... } }`.
 * Keeping a normalized map in ModelCapability lets every surface render the
 * same dimensions without leaking backend shape details into components.
 */
function normalizeOutputDimensions(
  profile: SessionLogicalModel['bindings'][number]['capabilityProfile'] | undefined,
  resolutions?: string[],
): NormalizedOutputDimensions {
  const byResolution: Record<string, Record<string, string>> = {}
  const selected: Record<string, string> = {}
  const maps = [profile?.sizeMap, profile?.outputDimensions]
  const inferredResolutions = maps.flatMap((map) => Object.entries(map || {}).flatMap(([key, value]) => {
    if (typeof value === 'string') return []
    return [/^\d+(?:K|M)$/i.test(key) ? key : '', ...Object.keys(value).filter((nested) => /^\d+(?:K|M)$/i.test(nested))]
  })).filter(Boolean)
  const knownResolutions = [...new Set([...(resolutions || []), ...inferredResolutions, '1K'])]

  const put = (resolution: string, ratio: string, value: unknown) => {
    if (!resolution || !ratio || typeof value !== 'string' || !/^auto$|^\d+x\d+$/i.test(value.trim())) return
    const row = byResolution[resolution] || (byResolution[resolution] = {})
    // Match backend precedence: sizeMap wins over outputDimensions.
    if (row[ratio] === undefined) row[ratio] = value.trim()
  }
  const putFlat = (ratio: string, value: unknown) => {
    for (const resolution of knownResolutions) put(resolution, ratio, value)
  }
  const visit = (map: Record<string, string | Record<string, string>> | undefined) => {
    if (!map || typeof map !== 'object') return
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'string') {
        const parts = key.split(':')
        if (parts.length === 3) {
          const ratioFirst = `${parts[0]}:${parts[1]}`
          const ratioLast = `${parts[1]}:${parts[2]}`
          if (knownResolutions.includes(parts[2])) put(parts[2], ratioFirst, value)
          else if (knownResolutions.includes(parts[0])) put(parts[0], ratioLast, value)
          else putFlat(key, value)
        } else {
          putFlat(key, value)
        }
        continue
      }
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (knownResolutions.includes(key)) put(key, nestedKey, nestedValue)
        else if (knownResolutions.includes(nestedKey)) put(nestedKey, key, nestedValue)
      }
    }
  }
  for (const map of maps) visit(map)

  const defaultResolution = knownResolutions[0] || '1K'
  const firstRow = byResolution[defaultResolution] || {}
  for (const [ratio, value] of Object.entries(firstRow)) selected[ratio] = value
  if (!Object.keys(selected).length) {
    Object.assign(selected, defaultOutputDimensions)
    byResolution[defaultResolution] = { ...selected }
  }
  return { selected, byResolution }
}

/**
 * 清晰度候选。返回的是**协议值**（auto/low/medium/high、480/720/1080、mp3…），
 * 中文只用于展示，由 qualityLabel 转换，避免把中文直接发给上游。
 */
function qualityCandidates(capability: SessionLogicalModel['capability'], settings?: SessionGenerationSettings, profileQualities?: string[]) {
  if (profileQualities?.length) return [...profileQualities]
  if (capability === 'video') {
    const configured = Object.keys(settings?.generationPointMultipliers?.videoQuality ?? {})
    return configured.length ? configured : defaultVideoQualities
  }
  if (capability === 'image') return qualityLabels
  if (capability === 'audio') return audioFormats
  return []
}

/** 图片的“图片质量”与“清晰度/分辨率”是两个独立参数；1K 档只允许自动质量。 */
export function imageQualityOptions(model?: Pick<ModelConfig, 'capabilities'>, resolution?: string) {
  const qualities = model?.capabilities.qualities?.length ? model.capabilities.qualities : qualityLabels
  return resolution === '1K' ? ['auto'] : [...qualities]
}

/** 画幅比例显示实际输出尺寸；后台配置优先，兜底只用于避免空白选项。 */
export function ratioLabel(
  value: string,
  outputDimensions?: Record<string, string>,
  resolution?: string,
  outputDimensionsByResolution?: Record<string, Record<string, string>>,
) {
  const dimensions = ratioDimension(value, outputDimensions, resolution, outputDimensionsByResolution)
  return dimensions ? `${value} · ${dimensions}` : value
}

/** Return only the concrete width×height text used in ratio option hints. */
export function ratioDimension(
  value: string,
  outputDimensions?: Record<string, string>,
  resolution?: string,
  outputDimensionsByResolution?: Record<string, Record<string, string>>,
) {
  return outputDimensionsByResolution?.[resolution || '']?.[value] ?? outputDimensions?.[value] ?? defaultOutputDimensions[value]
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
