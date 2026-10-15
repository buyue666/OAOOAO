import type { Edge, Node } from '@xyflow/react'
import type { AudioGenerationInput, ImageGenerationInput, TextGenerationInput, VideoGenerationInput } from '@/lib/studio/generation-types'

export type GenerationKind = 'image' | 'video' | 'text' | 'audio'
export type MediaKind = 'image' | 'video' | 'audio'
export type MediaNodeKind = 'reference' | 'asset'
export type CanvasNodeKind = GenerationKind | MediaNodeKind | 'agent' | 'director' | 'group'
export type NodeSide = 'top' | 'right' | 'bottom' | 'left'

/** 节点配置浮层的锚定侧，以及相对默认位置的平移量（已换算为节点本地坐标）。 */
export type SettingsPlacement = { side: 'left' | 'right'; offset: { x: number; y: number } }
export const DEFAULT_SETTINGS_PLACEMENT: SettingsPlacement = { side: 'right', offset: { x: 0, y: 0 } }
export type TaskPhase = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export type NodeReference = {
  id: string
  /** Present only when this reference was selected from the owned library. */
  libraryAssetId?: string
  title: string
  url: string
  mediaKind: MediaKind
}

export type NodeSkill = {
  id: string
  title: string
  prompt: string
}

export type NodeResult = {
  url: string
  poster?: string
  mediaKind: MediaKind
}

export type NodeTask = {
  /** 空字符串表示提交请求还在途中，尚未拿到后端任务 ID。 */
  id: string
  phase: TaskPhase
  error?: string
  startedAt: number
  clientRequestId?: string
  unconfirmed?: boolean
  cancelRequested?: boolean
  submission?: NodeSubmission
}

export type NodeSubmission = { kind: 'image'; input: ImageGenerationInput } | { kind: 'video'; input: VideoGenerationInput } | { kind: 'audio'; input: AudioGenerationInput } | { kind: 'text'; input: TextGenerationInput }

export type GenerationNodeData = {
  kind: GenerationKind
  title: string
  prompt: string
  model: string
  ratio: string
  quality: string
  seconds: number
  count: number
  voice: string
  format: string
  references: NodeReference[]
  skills: NodeSkill[]
  task: NodeTask | null
  results: NodeResult[]
  text: string
  resultSource?: { runId: string; assetId: string }
}

export type MediaNodeData = {
  kind: MediaNodeKind
  title: string
  media: NodeReference | null
}

export type AgentStep = {
  id: string
  title: string
  type: string
  status: string
  error?: string
}

export type AgentNodeData = {
  kind: 'agent'
  title: string
  prompt: string
  skills: NodeSkill[]
  collapsed?: boolean
  runId: string | null
  runStatus: string | null
  steps: AgentStep[]
  failure: string | null
  pointsCost: number | null
  context: string[]
  /** 请求已发出但响应未知时复用，避免重试重复创建运行。 */
  clientRequestId?: string | null
  submission?: { prompt: string; assetIds: string[]; skillIds: string[] }
  /** Set in the same saved board version as the delivered result nodes. */
  deliveredRunId?: string | null
  deliveryError?: string | null
  planApproval?: { totalPoints: number; estimated: boolean; approvedAt?: number }
}

export type GroupNodeData = {
  kind: 'group'
  title: string
}

export type DirectorActor = {
  id: string
  name: string
  x: number
  y: number
  z: number
  color: string
  scale: number
  /** Euler rotation in degrees. Kept in scene data so saved boards are portable. */
  rotationX: number
  rotationY: number
  rotationZ: number
  pose: 'idle' | 'hero' | 'walk'
  /**
   * Optional per-joint pose offsets in degrees. Older director boards omit
   * this object and continue to use the built-in pose presets.
   */
  poseControls?: DirectorPoseControls
  /** Optional same-origin GLB model. Missing values use the bundled CC0 model. */
  modelUrl?: string
}

/** Fine-grained, human-readable joint controls used by the director pose tab. */
export type DirectorPoseControls = {
  torsoPitch: number
  torsoRoll: number
  torsoYaw: number
  headPitch: number
  headRoll: number
  headYaw: number
  leftShoulderPitch: number
  leftShoulderRoll: number
  leftShoulderYaw: number
  leftElbow: number
  leftWrist: number
  rightShoulderPitch: number
  rightShoulderRoll: number
  rightShoulderYaw: number
  rightElbow: number
  rightWrist: number
  leftHip: number
  leftKnee: number
  leftAnkle: number
  rightHip: number
  rightKnee: number
  rightAnkle: number
}

export const DEFAULT_DIRECTOR_POSE_CONTROLS: DirectorPoseControls = {
  torsoPitch: 0,
  torsoRoll: 0,
  torsoYaw: 0,
  headPitch: 0,
  headRoll: 0,
  headYaw: 0,
  leftShoulderPitch: 0,
  leftShoulderRoll: 0,
  leftShoulderYaw: 0,
  leftElbow: 0,
  leftWrist: 0,
  rightShoulderPitch: 0,
  rightShoulderRoll: 0,
  rightShoulderYaw: 0,
  rightElbow: 0,
  rightWrist: 0,
  leftHip: 0,
  leftKnee: 0,
  leftAnkle: 0,
  rightHip: 0,
  rightKnee: 0,
  rightAnkle: 0,
}

export type DirectorCamera = {
  id: string
  name: string
  x: number
  y: number
  z: number
  targetX: number
  targetY: number
  targetZ: number
  fov: number
  /** Rotation of the camera marker / optional explicit camera orientation, in degrees. */
  rotationX: number
  rotationY: number
  rotationZ: number
}

export type DirectorSceneData = {
  /** Version 2 adds persisted Euler rotations for actors and cameras. */
  schemaVersion: 2
  aspect: '16:9' | '9:16' | '1:1'
  grid: boolean
  actors: DirectorActor[]
  cameras: DirectorCamera[]
  activeCameraId: string
  notes: string
}

export type DirectorNodeData = {
  kind: 'director'
  title: string
  scene: DirectorSceneData
  lastCaptureAt?: number
}

export type GenerationFlowNode = Node<GenerationNodeData, 'generation'>
export type MediaFlowNode = Node<MediaNodeData, 'media'>
export type AgentFlowNode = Node<AgentNodeData, 'agent'>
export type DirectorFlowNode = Node<DirectorNodeData, 'director'>
export type GroupFlowNode = Node<GroupNodeData, 'group'>
export type FreeCanvasNode = GenerationFlowNode | MediaFlowNode | AgentFlowNode | DirectorFlowNode | GroupFlowNode
export type FreeCanvasEdge = Edge

export const HANDLE_IDS = {
  inLeft: 'in-left',
  inTop: 'in-top',
  outRight: 'out-right',
  outBottom: 'out-bottom',
} as const

export function isGenerationKind(value: string): value is GenerationKind {
  return value === 'image' || value === 'video' || value === 'text' || value === 'audio'
}

export function isMediaKind(value: unknown): value is MediaKind {
  return value === 'image' || value === 'video' || value === 'audio'
}
