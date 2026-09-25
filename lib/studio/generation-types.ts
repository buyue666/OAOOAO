/**
 * OAOOAO 真实生成业务的数据契约。
 * 字段来自当前后端的 image-tasks / video-generation-tasks / audio-tasks / text-tasks / agent/runs 接口，
 * 页面只消费这里的类型，不在组件里判断后端原始结构。
 */

export type GenerationKind = 'image' | 'video' | 'audio' | 'text' | 'agent'
export type GenerationStatus = 'pending' | 'running' | 'success' | 'error' | 'paused' | 'cancelled'
export type GenerationExecutionPhase = 'created' | 'submitted' | 'polling' | 'result_ready' | 'persisting' | 'completed' | 'needs_review' | string

/** 后端通过 x-vozeb-pro-points-* 响应头回传的实时余额。 */
export type PointsSnapshot = {
  remaining?: number
  permanent?: number
  daily?: number
  dailyExpiresAt?: string
}

export type MediaResult = {
  url: string
  poster?: string
  width?: number
  height?: number
  mimeType?: string
  kind: 'image' | 'video' | 'audio'
}

export type GenerationTask = {
  id: string
  kind: GenerationKind
  status: GenerationStatus
  model: string
  result?: unknown
  error?: string
  /** 后端返回该任务的实际扣费（部分接口在 billing 字段内）。 */
  pointsCost?: number
  pointsRefunded?: boolean
  needsReview?: boolean
  reviewReason?: string
  executionPhase?: GenerationExecutionPhase
  /** 视频任务返回的上游任务标识与时长。 */
  upstreamId?: string
  durationSeconds?: number
  canRetry?: boolean
  warning?: string
}

/** 归一化后的任务视图：页面只使用这一层，不再关心各类型接口的差异。 */
export type GenerationTaskView = GenerationTask & {
  title: string
  prompt: string
  createdAt: number
  updatedAt: number
  /** 由 result 解析出的可展示媒体；文本任务为空。 */
  media: MediaResult[]
  text?: string
  /** 用于失败重试的原始请求参数；不包含渠道密钥。 */
  retryInput?: RetryInput
  /**
   * 连续查询失败的次数与上限。仅表示「没问到状态」，不代表任务失败：
   * 达到上限后停止自动轮询，等待用户手动重新检查。
   */
  queryFailures?: number
  queryFailureLimit?: number
  /**
   * 未确认提交的占位任务。
   *
   * `true` 表示请求可能已到达后端但响应丢失，此时**没有服务器任务 ID**，
   * 不能查询任务详情，只能用原 clientRequestId 重新提交来恢复。
   */
  unconfirmed?: boolean
  /** 本次提交的幂等标识；未确认任务恢复时必需。 */
  clientRequestId?: string
}

export type RetryInput =
  | { kind: 'image'; input: ImageGenerationInput }
  | { kind: 'video'; input: VideoGenerationInput }
  | { kind: 'audio'; input: AudioGenerationInput }
  | { kind: 'text'; input: TextGenerationInput }

/** 任务创建时提交给后端的受控参考素材。上传文件会先换成 /api/reference-assets URL。 */
export type GenerationReference = {
  name?: string
  type?: string
  url?: string
  dataUrl?: string
  role?: 'reference' | 'first_frame' | 'last_frame'
}

/**
 * 一次创作的幂等标识。
 *
 * 后端以 `(user, task_type, clientRequestId, attemptNo)` 去重：
 * - 网络失败后重试必须复用同一个 ID，否则会真的创建第二条任务并重复扣费；
 * - 只有用户明确发起「新的一次创作」时才换新 ID。
 * `attemptNo` 由后端用来区分同一 ID 下的重新尝试。
 *
 * 字段可选：页面调用生成 store 时可以不带，由 store 统一生成并持有；
 * 但**重试路径必须显式传入同一个值**，这是防重复扣费的关键。
 */
export type SubmissionIdentity = {
  clientRequestId?: string
  attemptNo?: number
}

export type ImageGenerationInput = {
  prompt: string
  model?: string
  ratio?: string
  quality?: string
  count?: number
  /** 参考图，使用可直接访问的 URL 或 data URL。 */
  referenceUrls?: string[]
  /** 编辑模式：带参考图时后端会走 /images/edits。 */
  kind?: 'generation' | 'edit'
  references?: GenerationReference[]
  title?: string
  projectId?: string
  surface?: 'chat' | 'canvas' | 'drama'
} & SubmissionIdentity

export type VideoGenerationInput = {
  prompt: string
  model?: string
  ratio?: string
  quality?: string
  seconds?: number
  references?: GenerationReference[]
  projectId?: string
  surface?: 'chat' | 'canvas' | 'drama'
} & SubmissionIdentity

export type AudioGenerationInput = {
  prompt: string
  model?: string
  voice?: string
  format?: string
  projectId?: string
  surface?: 'chat' | 'canvas' | 'drama'
} & SubmissionIdentity

export type TextGenerationInput = {
  prompt: string
  model?: string
  /** 幂等标识：网络重试复用同一值，后端据此返回第一次创建的任务。 */
  clientRequestId?: string
  attemptNo?: number
}

/* --------------------------------- Agent --------------------------------- */

export type AgentRunStatus = 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type AgentRunTask = {
  id: string
  title: string
  type: 'image' | 'video' | 'audio' | 'text'
  model: string
  optimizedPrompt?: string
  ratio?: string
  quality?: string
  seconds?: number
  voice?: string
  format?: string
  count?: number
  status: string
  error?: string
}

export type AgentRun = {
  id: string
  conversationId?: string
  surface?: 'chat' | 'canvas' | 'drama'
  projectId?: string
  status: AgentRunStatus
  prompt: string
  referencedAssetIds: string[]
  selectedSkillIds: string[]
  requestedModelIds?: string[]
  assetIds: string[]
  tasks: AgentRunTask[]
  cancellation?: { pendingCount: number }
  pointsCost?: number
  timings?: Record<string, number>
  createdAt: number
  updatedAt: number
}

export type AgentRunEvent = {
  id?: string
  type: string
  data?: unknown
  createdAt?: number
}

/* ---------------------------- 会话中的真实模型目录 ---------------------------- */

export type SessionLogicalModel = {
  id: string
  name: string
  capability: 'text' | 'image' | 'video' | 'audio'
  enabled: boolean
  /** 额外可请求的名字；`id` 仍是稳定标识与计价键。 */
  aliases?: string[]
  bindings: Array<{
    id: string
    channelId: string
    upstreamModel: string
    enabled: boolean
    priority: number
    capabilityProfile?: {
      supportsReferenceImage?: boolean
      maxReferenceImages?: number
      aspectRatios?: string[]
      resolutions?: string[]
      durationSeconds?: number[]
      maxBatchSize?: number
      supportsAsync?: boolean
      supportsCancel?: boolean
    }
  }>
}

export type SessionSystemChannel = {
  id: string
  name: string
  baseUrl: string
  apiFormat?: string
  models: string[]
  enabled: boolean
  hasApiKey?: boolean
}

export type SessionGenerationDefaults = {
  canvasImageCount: number
  imageSize: string
  imageQuality: string
  imageCount: number
  videoQuality: string
  videoSeconds: number
  audioVoice: string
  audioFormat: string
}

export type SessionGenerationSettings = {
  modelPointCosts?: Record<string, number>
  generationPointMultipliers?: { imageQuality?: Record<string, number>; videoQuality?: Record<string, number>; videoSeconds?: Record<string, number> }
  generationConcurrency?: Record<string, number>
  generationDefaults?: SessionGenerationDefaults
  defaultModels?: { textModel: string; imageModel: string; videoModel: string; audioModel: string }
  logicalModels?: SessionLogicalModel[]
  systemChannels?: SessionSystemChannel[]
}

/* ------------------------------ 生成记录（只读） ------------------------------ */

export type GenerationLogAsset = { type?: string; url?: string; serverUrl?: string; poster?: string }

export type GenerationLog = {
  id: string
  kind: string
  source?: string
  status: string
  title?: string
  prompt?: string
  model?: string
  summary?: string
  durationMs?: number
  count?: number
  successCount?: number
  failCount?: number
  pointsCost?: number
  pointsRefunded?: boolean
  assets?: GenerationLogAsset[]
  error?: string
  createdAt?: string
}
