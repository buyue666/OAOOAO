import { request } from './api'
import type { DramaEpisode, DramaNamedAsset, DramaProject, DramaShot } from './drama-types'

export type DramaProductionStage = 'analysis' | 'outline' | 'script' | 'assets' | 'storyboard' | 'image' | 'video' | 'audio'
export type DramaWorkspaceStage = 'story' | 'script' | 'assets' | 'storyboard' | 'production' | 'delivery'
export const dramaWorkspaceStages = [
  { id: 'story', label: '故事设定', caption: '原文与创作方向' }, { id: 'script', label: '分集剧本', caption: '大纲、对白与节奏' },
  { id: 'assets', label: '角色与场景', caption: '统一视觉设定' }, { id: 'storyboard', label: '镜头设计', caption: '画面、运镜与声音' },
  { id: 'production', label: '生成制作', caption: '出图、视频与配音' }, { id: 'delivery', label: '成片检查', caption: '预览、合成与导出' },
] as const
export const dramaProductionLabels: Record<DramaProductionStage, string> = { analysis: '故事分析', outline: '分集大纲', script: '分集剧本', assets: '角色与场景拆解', storyboard: '镜头设计', image: '分镜图片', video: '镜头视频', audio: '镜头配音' }
export type DramaProductionTask = {
  id: string; stage: DramaProductionStage; episodeId?: string; shotId?: string; model: string; status: 'pending' | 'running' | 'success' | 'error' | 'cancelled' | 'paused'; pointsCost: number; createdAt: number; baseUpdatedAt: string; appliedAt?: string; error?: string; proposalError?: string; proposal?: Record<string, any>; result?: { url?: string; content?: string; results?: Array<{ url?: string }> }
}
export type DramaProductionRequest = { stage: DramaProductionStage; episodeId?: string; shotId?: string; model: string; instructions?: string; config?: Record<string, string | number>; clientRequestId: string; expectedUpdatedAt: string; approvedCost: number }
export type DramaQuoteInput = Omit<DramaProductionRequest, 'clientRequestId' | 'expectedUpdatedAt' | 'approvedCost'>
type Envelope<T> = { code: number; data: T }
const root = (id: string) => `/api/drama/projects/${encodeURIComponent(id)}/production`
export async function quoteDramaProduction(id: string, input: DramaQuoteInput) { return (await request<Envelope<{ points: number; estimated: boolean }>>(`${root(id)}/quote`, { method: 'POST', body: JSON.stringify(input) })).data }
export async function createDramaProduction(id: string, input: DramaProductionRequest) { return (await request<Envelope<DramaProductionTask>>(root(id), { method: 'POST', body: JSON.stringify(input) })).data }
export async function listDramaProduction(id: string) { return (await request<Envelope<{ tasks: DramaProductionTask[] }>>(root(id))).data.tasks }
export async function applyDramaProduction(id: string, taskId: string, expectedUpdatedAt: string, replace = false) { return (await request<Envelope<{ project: DramaProject }>>(`${root(id)}/${encodeURIComponent(taskId)}/apply`, { method: 'POST', body: JSON.stringify({ expectedUpdatedAt, replace }) })).data.project }
export async function cancelDramaProduction(id: string, taskId: string) { return (await request<Envelope<DramaProductionTask>>(`${root(id)}/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: '{}' })).data }

const id = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
export function newDramaEpisode(index: number): DramaEpisode { return { id: id(), episodeNumber: index + 1, title: `第 ${index + 1} 集`, script: '', outline: '', hook: '', nextPreview: '', sourceRange: '', reviewStatus: 'draft', shots: [] } }
export function newDramaShot(index: number): DramaShot { return { id: id(), order: index + 1, title: `镜头 ${index + 1}`, description: '', sourceText: '', shotBoundary: '', dialogue: '', narration: '', utterances: [], imagePrompt: '', videoPrompt: '', cameraMotion: '', duration: 5, characterIds: [], propIds: [], clueIds: [], storyboardStatus: 'idle', generationStatus: 'idle' } }
export function newDramaAsset(): DramaNamedAsset { return { id: id(), name: '未命名素材', description: '', references: [], profile: { visualIdentity: '', styling: '', colorPalette: '', consistencyRules: '' } } }
export function dramaStageCompletion(project: DramaProject, episode?: DramaEpisode): Record<DramaWorkspaceStage, boolean> {
  return { story: Boolean(project.storyBible?.logline || project.summary), script: Boolean(episode?.script.trim()), assets: Boolean(project.characters.length || project.scenes.length), storyboard: Boolean(episode?.shots.length), production: Boolean(episode?.shots.length && episode.shots.every(shot => shot.videoUrl)), delivery: episode?.renderTask?.status === 'success' }
}
export function dramaEpisodeReadiness(episode?: DramaEpisode) {
  const shots = episode?.shots || []
  const missingVideo = shots.filter(shot => !shot.videoUrl)
  const missingAudio = shots.filter(shot => shot.audioMode === 'voiceover' && !shot.audioUrl)
  return { total: shots.length, images: shots.filter(shot => shot.storyboardImageUrl).length, videos: shots.length - missingVideo.length, seconds: shots.reduce((sum, shot) => sum + Math.max(0, Number(shot.duration) || 0), 0), missingVideo, missingAudio, canRender: shots.length > 0 && !missingVideo.length && !missingAudio.length }
}
/** Retain edits made during a save while advancing only the confirmed server version. */
export function acknowledgeDramaSave(current: DramaProject, submitted: DramaProject, saved: DramaProject): DramaProject { return current === submitted ? saved : { ...current, updatedAt: saved.updatedAt } }
