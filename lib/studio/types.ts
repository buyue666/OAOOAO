import type { Edge, Node } from '@xyflow/react'
import type { SessionGenerationDefaults, SessionSettings } from './api'
export type { SessionGenerationDefaults, SessionSettings }

export type ID = string

export type CanvasNodeKind = 'image' | 'video' | 'text' | 'task'

export interface CanvasNodeData extends Record<string, unknown> {
  title: string
  kind: CanvasNodeKind
  detail: string
  src?: string
  poster?: string
  status?: string
}

export interface CanvasBoard {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
}

export type Theme = 'dark' | 'light'
export type StudioSkin = 'minimal' | 'gradient'
export type BackendStatus = 'checking' | 'connected' | 'unauthenticated' | 'offline'
export type StudioMode = 'image' | 'video' | 'audio' | 'drama'
/** 后端 logicalModels.capability 的原样取值，是模型分组的唯一事实来源。 */
export type ModelCapabilityKind = 'text' | 'image' | 'video' | 'audio'
export type ProjectType = '短剧' | '广告片' | '品牌视觉' | '个人作品'
export type ProjectStatus = '进行中' | '已完成' | '已归档'
export type AssetKind = 'image' | 'video' | 'audio' | 'character' | 'scene'
export type AssetStatus = '可用' | '处理中' | '已归档'
export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
export type TaskType = 'image' | 'video' | 'storyboard' | 'upscale' | 'export'
export type WorkKind = 'image' | 'video'
export type ShotStatus = '待生成' | '生成中' | '已完成' | '需重试'

export interface User {
  id: ID
  name: string
  email: string
  role: 'member' | 'admin'
  avatar: string
  plan: string
  credits: number
}

export interface Project {
  id: ID
  title: string
  type: ProjectType
  cover: string
  updatedAt: string
  status: ProjectStatus
  progress: number
  tags: string[]
  shotCount: number
  chapterCount: number
  description: string
  favorite: boolean
}

export interface Asset {
  id: ID
  kind: AssetKind
  title: string
  src: string
  poster?: string
  fallback: string
  duration?: string
  dimensions?: string
  tags: string[]
  size: string
  status: AssetStatus
  projectIds: ID[]
  referencedBy: string[]
  createdAt: string
  /** 真实素材的更新时间；本地演示素材没有该字段。 */
  updatedAt?: string
}

export interface ModelCapability {
  /** 文生图/文生视频等纯文本驱动。 */
  textToMedia: boolean
  firstFrame: boolean
  lastFrame: boolean
  multiReference: boolean
  editing: boolean
  durations: string[]
  ratios: string[]
  qualities: string[]
  /**
   * 参考素材数量上限。
   *
   * `0` 表示**后端明确声明该模型不支持参考图**（`capabilityProfile.supportsReferenceImage === false`）。
   * 后端**没有配置** profile 时不能给 0：那种情况下后端不做上限校验，
   * 带参考图的请求会被正常受理（实测 `e2e-image` 无 profile，带 references 提交返回 200 `kind:"edit"`），
   * 给 0 会被界面解读为「不支持」从而**隐藏整个参考素材入口**，把真实可用的能力从界面上抹掉。
   * 见 `lib/studio/studio-models.ts` 的 `UNCONFIGURED_REFERENCE_LIMIT`。
   */
  maxReferences: number
  /** 后端允许的单次生成数量上限，1 表示不支持批量。 */
  maxBatchSize: number
}

export interface ModelConfig {
  id: ID
  name: string
  shortName: string
  provider: string
  kind: StudioMode
  /** 后端原样能力，用于精确分组，避免音频被并入图片。 */
  capability: ModelCapabilityKind
  description: string
  creditCost: number
  capabilities: ModelCapability
  status: '可用' | '演示配置' | '维护中'
}

export interface GenerationSettings {
  modelId: ID
  ratio: string
  quality: string
  count?: number
  duration?: string
  mode?: string
}

export interface Task {
  id: ID
  type: TaskType
  title: string
  status: TaskStatus
  stage: string
  createdAt: number
  updatedAt: number
  expectedCredits: number
  actualCredits: number | null
  input: string
  projectId?: ID
  resultAssetIds: ID[]
  retryCount: number
  error?: string
  settings: GenerationSettings
}

export interface Work {
  id: ID
  title: string
  kind: WorkKind
  src: string
  poster?: string
  fallback: string
  projectId?: ID
  status: '草稿' | '已发布' | '处理中'
  updatedAt: string
  ratio: string
  model: string
  /**
   * 生成该结果的提示词。
   *
   * 「复用参数」需要把提示词写回表单；后端作品带 prompt，
   * 本地演示条目没有该字段（因此可选）。
   */
  prompt?: string
  createdAt?: string
  duration?: string
  /** 后端结果的真实 MIME，用于决定下载扩展名。 */
  mimeType?: string
}

export interface StoryboardCandidate {
  id: ID
  src: string
  poster?: string
  title: string
  model: string
  selected: boolean
}

export interface StoryboardShot {
  id: ID
  projectId: ID
  chapter: string
  index: number
  title: string
  description: string
  dialogue: string
  duration: string
  status: ShotStatus
  referenceAssetIds: ID[]
  candidates: StoryboardCandidate[]
}

export interface AgentStep {
  id: ID
  label: string
  detail: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export interface AgentPlan {
  id: ID
  title: string
  context: string
  model: string
  credits: number
  scope: string
  status: 'draft' | 'running' | 'paused' | 'completed' | 'failed'
  steps: AgentStep[]
  createdAt: number
}

export interface Order {
  id: ID
  product: string
  amount: string
  credits: number
  status: '已完成' | '退款中' | '待支付'
  createdAt: string
}

export interface AdminUser {
  id: ID
  name: string
  email: string
  plan: string
  credits: number
  tasks: number
  status: '正常' | '受限' | '待验证'
  lastSeen: string
}

export interface AdminChannel {
  id: ID
  name: string
  protocol: string
  mapping: string
  priority: number
  weight: number
  status: '已启用' | '演示配置' | '已停用'
  latency: string
}

export interface AdminModel {
  id: ID
  name: string
  displayName: string
  kind: StudioMode
  provider: string
  creditCost: number
  status: '展示中' | '隐藏' | '维护中'
}

export interface StudioState {
  hydrated: boolean
  backendStatus: BackendStatus
  backendError?: string
  theme: Theme
  skin: StudioSkin
  sidebarCollapsed: boolean
  user: User
  credits: number
  projects: Project[]
  assets: Asset[]
  models: ModelConfig[]
  /** 后端返回的真实逻辑模型目录；为空表示当前只能本地预览。 */
  liveModels: ModelConfig[]
  /** 会话返回的生成设置（默认模型、积分倍率、默认参数）。 */
  sessionSettings?: SessionSettings
  tasks: Task[]
  works: Work[]
  shots: StoryboardShot[]
  agentPlans: AgentPlan[]
  orders: Order[]
  adminUsers: AdminUser[]
  adminChannels: AdminChannel[]
  adminModels: AdminModel[]
  canvasBoards: Record<ID, CanvasBoard>
  selectedProjectId: ID
  notifications: number
}

export type StudioAction =
  | { type: 'HYDRATE'; payload: Partial<StudioState> }
  | { type: 'SET_BACKEND_STATUS'; status: BackendStatus; error?: string }
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'SET_SKIN'; skin: StudioSkin }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SELECTED_PROJECT'; projectId: ID }
  | { type: 'CREATE_PROJECT'; project: Project }
  | { type: 'DELETE_PROJECT'; projectId: ID }
  | { type: 'ARCHIVE_PROJECT'; projectId: ID }
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'RETRY_TASK'; taskId: ID }
  | { type: 'TICK_TASKS' }
  | { type: 'SPEND_CREDITS'; amount: number }
  | { type: 'ADD_ASSET_TO_PROJECT'; assetId: ID; projectId: ID }
  /** 把后端生成结果登记为项目素材（作品页「加入项目」）。 */
  | { type: 'ADD_WORK_TO_PROJECT'; projectId: ID; work: Asset }
  | { type: 'DELETE_ASSET'; assetId: ID }
  | { type: 'SELECT_SHOT_CANDIDATE'; shotId: ID; candidateId: ID }
  | { type: 'UPDATE_SHOT_STATUS'; shotId: ID; status: ShotStatus }
  | { type: 'ADD_SHOT'; shot: StoryboardShot }
  | { type: 'ADD_AGENT_PLAN'; plan: AgentPlan }
  | { type: 'UPDATE_AGENT_PLAN'; planId: ID; status: AgentPlan['status']; steps?: AgentStep[] }
  | { type: 'SAVE_CANVAS_BOARD'; projectId: ID; board: CanvasBoard }

export interface StudioContextValue {
  state: StudioState
  dispatch: React.Dispatch<StudioAction>
  setTheme: (theme: Theme) => void
  setSkin: (skin: StudioSkin) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  estimateCredits: (modelId: ID, settings?: Partial<GenerationSettings>) => number
  /** 本地预览任务（仅在后端不可用时使用）。 */
  addDemoTask: (input: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => ID | null
  /** 后端返回的真实逻辑模型；为空数组表示未拿到真实目录。 */
  liveModels: ModelConfig[]
  /** true 表示当前可以创建真实生成任务。 */
  liveReady: boolean
  /** 后端生成默认参数。 */
  defaultModels: SessionGenerationDefaults
  /** 登录、退出、切换账号后立即重新同步会话，不需要整页刷新。 */
  refreshSession: () => Promise<void>
  /** 新建项目：后端可用时先在后端创建，失败时抛出原因，不再只写本地状态。 */
  createProject: (title: string) => Promise<Project>
  /** 删除项目：后端可用时同步删除服务端记录。 */
  deleteProject: (projectId: ID) => Promise<void>
}