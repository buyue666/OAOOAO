/**
 * OAOOAO ��ʵ����ҵ���������Լ��
 * �ֶ����Ե�ǰ��˵� image-tasks / video-generation-tasks / audio-tasks / text-tasks / agent/runs �ӿڣ�
 * ҳ��ֻ������������ͣ�����������жϺ��ԭʼ�ṹ��
 */

export type GenerationKind = 'image' | 'video' | 'audio' | 'text' | 'agent'
export type GenerationStatus = 'pending' | 'running' | 'success' | 'error' | 'paused' | 'cancelled'
export type GenerationExecutionPhase = 'created' | 'submitted' | 'polling' | 'result_ready' | 'persisting' | 'completed' | 'needs_review' | string

/** ���ͨ�� x-vozeb-pro-points-* ��Ӧͷ�ش���ʵʱ�� */
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
  /** ��˷��ظ������ʵ�ʿ۷ѣ����ֽӿ��� billing �ֶ��ڣ��� */
  pointsCost?: number
  pointsRefunded?: boolean
  needsReview?: boolean
  reviewReason?: string
  executionPhase?: GenerationExecutionPhase
  /** ��Ƶ���񷵻ص����������ʶ��ʱ���� */
  upstreamId?: string
  durationSeconds?: number
  canRetry?: boolean
  /** The provider may still be running after a cancellation request. */
  cancelRequested?: boolean
  warning?: string
}

/** ��һ�����������ͼ��ҳ��ֻʹ����һ�㣬���ٹ��ĸ����ͽӿڵĲ��졣 */
export type GenerationTaskView = GenerationTask & {
  title: string
  prompt: string
  createdAt: number
  updatedAt: number
  /** �� result �������Ŀ�չʾý�壻�ı�����Ϊ�ա� */
  media: MediaResult[]
  text?: string
  /** ����ʧ�����Ե�ԭʼ���������������������Կ�� */
  retryInput?: RetryInput
  /**
   * ������ѯʧ�ܵĴ��������ޡ�����ʾ��û�ʵ�״̬��������������ʧ�ܣ�
   * �ﵽ���޺�ֹͣ�Զ���ѯ���ȴ��û��ֶ����¼�顣
   */
  queryFailures?: number
  queryFailureLimit?: number
  /**
   * δȷ���ύ��ռλ����
   *
   * `true` ��ʾ��������ѵ����˵���Ӧ��ʧ����ʱ**û�з��������� ID**��
   * ���ܲ�ѯ�������飬ֻ����ԭ clientRequestId �����ύ���ָ���
   */
  unconfirmed?: boolean
  /** �����ύ���ݵȱ�ʶ��δȷ������ָ�ʱ���衣 */
  clientRequestId?: string
}

export type RetryInput =
  | { kind: 'image'; input: ImageGenerationInput }
  | { kind: 'video'; input: VideoGenerationInput }
  | { kind: 'audio'; input: AudioGenerationInput }
  | { kind: 'text'; input: TextGenerationInput }

/** ���񴴽�ʱ�ύ����˵��ܿزο��زġ��ϴ��ļ����Ȼ��� /api/reference-assets URL�� */
export type GenerationReference = {
  name?: string
  type?: string
  url?: string
  dataUrl?: string
  role?: 'reference' | 'first_frame' | 'last_frame'
}

/**
 * һ�δ������ݵȱ�ʶ��
 *
 * ����� `(user, task_type, clientRequestId, attemptNo)` ȥ�أ�
 * - ����ʧ�ܺ����Ա��븴��ͬһ�� ID���������Ĵ����ڶ��������ظ��۷ѣ�
 * - ֻ���û���ȷ�����µ�һ�δ�����ʱ�Ż��� ID��
 * `attemptNo` �ɺ����������ͬһ ID �µ����³��ԡ�
 *
 * �ֶο�ѡ��ҳ��������� store ʱ���Բ������� store ͳһ���ɲ����У�
 * ��**����·��������ʽ����ͬһ��ֵ**�����Ƿ��ظ��۷ѵĹؼ���
 */
export type SubmissionIdentity = {
  clientRequestId?: string
  attemptNo?: number
}

/** Stable destination for a generation task; persisted by the backend task store. */
export type GenerationProjectContext = {
  projectId?: string
  episodeId?: string
  shotId?: string
  conversationId?: string
  parentTaskId?: string
  surface?: 'chat' | 'canvas' | 'drama'
}

export type ImageGenerationInput = {
  prompt: string
  model?: string
  ratio?: string
  /** 输出分辨率档位，例如 1K、2K、4K；与图片质量参数分开。 */
  resolution?: string
  quality?: string
  count?: number
  /** �ο�ͼ��ʹ�ÿ�ֱ�ӷ��ʵ� URL �� data URL�� */
  referenceUrls?: string[]
  /** �༭ģʽ�����ο�ͼʱ��˻��� /images/edits�� */
  kind?: 'generation' | 'edit'
  references?: GenerationReference[]
  edit?: {
    operation?: 'inpaint' | 'remove-background' | 'erase' | 'outpaint' | 'enhance' | 'layers'
    mask?: GenerationReference
  }
  title?: string
  projectId?: string
  surface?: 'chat' | 'canvas' | 'drama'
} & SubmissionIdentity & GenerationProjectContext

export type VideoGenerationInput = {
  prompt: string
  model?: string
  ratio?: string
  quality?: string
  seconds?: number
  references?: GenerationReference[]
  projectId?: string
  surface?: 'chat' | 'canvas' | 'drama'
} & SubmissionIdentity & GenerationProjectContext

export type AudioGenerationInput = {
  prompt: string
  model?: string
  voice?: string
  format?: string
  projectId?: string
  surface?: 'chat' | 'canvas' | 'drama'
} & SubmissionIdentity & GenerationProjectContext

export type TextGenerationInput = {
  prompt: string
  model?: string
  messages?: TextGenerationMessage[]
  /** �ݵȱ�ʶ���������Ը���ͬһֵ����˾ݴ˷��ص�һ�δ��������� */
  clientRequestId?: string
  attemptNo?: number
}

export type TextGenerationMessage = {
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: string | Array<{
    type: 'text'
    text: string
  } | {
    type: 'image_url'
    image_url: { url: string }
  }>
}

/* --------------------------------- Agent --------------------------------- */

export type AgentRunStatus = 'planning' | 'awaiting_approval' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

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
  failure?: string
  planApproval?: { totalPoints: number; estimated: boolean; approvedAt?: number; steps: Array<{ id: string; title: string; model?: string; count: number; estimatedPoints?: number }> }
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

/* ---------------------------- �Ự�е���ʵģ��Ŀ¼ ---------------------------- */

export type SessionLogicalModel = {
  id: string
  name: string
  capability: 'text' | 'image' | 'video' | 'audio'
  enabled: boolean
  iconUrl?: string
  /** �������������֣�`id` �����ȶ���ʶ��Ƽۼ��� */
  aliases?: string[]
  bindings: Array<{
    id: string
    channelId: string
    upstreamModel: string
    requestAlias?: string
    iconUrl?: string
    enabled: boolean
    priority: number
    capabilityProfile?: {
      supportsReferenceImage?: boolean
      maxReferenceImages?: number
      aspectRatios?: string[]
      /** 新字段：清晰度档位（1K/2K/4K）；保留 resolutions 兼容旧配置。 */
      outputResolutions?: string[]
      resolutions?: string[]
      /** 新字段：图片质量（auto/low/medium/high）；保留 qualities 兼容旧配置。 */
      imageQualities?: string[]
      /**
       * 比例对应的输出尺寸。支持旧的扁平格式（{ '1:1': '1024x1024' }），
       * 也支持按清晰度分组（{ '1K': { '1:1': '1024x1024' } }）。
       */
      outputDimensions?: CapabilitySizeMap
      /** 后台编辑器使用的同义字段；提交时两者均可兼容。 */
      sizeMap?: CapabilitySizeMap
      qualities?: string[]
      durationSeconds?: number[]
      maxBatchSize?: number
      supportsAsync?: boolean
      supportsCancel?: boolean
    }
  }>
}

/** 模型能力中比例与实际尺寸的扁平/嵌套兼容结构。 */
export type CapabilitySizeMap = Record<string, string | Record<string, string>>

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

/* ------------------------------ ���ɼ�¼��ֻ���� ------------------------------ */

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

