/**
 * 短剧项目的数据契约（前台侧的最小镜像）。
 *
 * 字段与后端 `web/src/lib/drama-project-contract.ts` 一一对应，
 * 只保留前台真正会读写的部分：保存时会把**整份项目**回传，因此这里不再裁剪，
 * 免得归一化时丢掉后端字段（例如 `scriptRichContent`、`continuity`）。
 */

export type DramaTaskStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export type DramaReviewStatus = 'draft' | 'content_review' | 'approved' | 'visual_ready'

export type DramaVideoMode = 'storyboard' | 'direct' | 'reference'

export type DramaSourceAsset = {
  id: string
  type: 'text' | 'image' | 'video' | 'audio'
  title: string
  textContent?: string
  storageKey?: string
  remoteUrl?: string
  serverUrl?: string
  mimeType?: string
  width?: number
  height?: number
}

export type DramaUtterance = {
  id: string
  order: number
  type: 'dialogue' | 'voiceover'
  speaker: string
  text: string
}

export type DramaShot = {
  id: string
  order: number
  title: string
  description: string
  sourceText: string
  shotBoundary: string
  dialogue: string
  narration: string
  utterances: DramaUtterance[]
  imagePrompt: string
  videoPrompt: string
  cameraMotion: string
  startFramePrompt?: string
  endFramePrompt?: string
  negativePrompt?: string
  duration: number
  characterIds: string[]
  propIds: string[]
  clueIds: string[]
  sceneId?: string
  videoMode?: DramaVideoMode
  storyboardStatus?: DramaTaskStatus
  storyboardAttempt?: number
  storyboardTaskId?: string
  storyboardError?: string
  storyboardImageUrl?: string
  storyboardImageWidth?: number
  storyboardImageHeight?: number
  generationStatus?: DramaTaskStatus
  generationAttempt?: number
  generationTaskId?: string
  generationError?: string
  [key: string]: unknown
}

export type DramaEpisode = {
  id: string
  episodeNumber?: number
  title: string
  script: string
  scriptRichContent?: unknown
  outline: string
  hook: string
  nextPreview: string
  sourceRange: string
  reviewStatus: DramaReviewStatus
  shots: DramaShot[]
  productionPaused?: boolean
  [key: string]: unknown
}

export type DramaProject = {
  id: string
  sourceHandoffId?: string
  title: string
  summary: string
  style: string
  ratio: string
  status: 'active' | 'archived'
  creativeConversationId?: string
  activeEpisodeId?: string
  characters: Array<Record<string, unknown>>
  scenes: Array<Record<string, unknown>>
  props: Array<Record<string, unknown>>
  clues: Array<Record<string, unknown>>
  defaultVideoMode: DramaVideoMode
  episodes: DramaEpisode[]
  sourceAssets?: DramaSourceAsset[]
  createdAt: string
  updatedAt: string
}
