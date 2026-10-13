import { request, StudioApiError } from './api'
import { createLibraryAsset, listLibraryAssets, uploadPersistentAsset, type LibraryAssetView } from './account-api'
import type { DramaProject, DramaRenderTask, DramaSourceAsset } from './drama-types'
import type { MediaResult } from './generation-types'
import { adoptedShotMedia, candidateKey, mediaStorageKey, stableMediaUrl, type ShotCandidate, type ShotScope } from './creative-project'

type CandidateMetadata = Omit<ShotCandidate, 'id' | 'url' | 'createdAt' | 'width' | 'height'> & { version: 1 }
type CandidateLibraryAsset = LibraryAssetView & { metadata?: { creativeCandidate?: CandidateMetadata } }
type Envelope<T> = { code?: number; data?: T; msg?: string }
export type CreativeContinuationGuard = () => boolean

function assertCurrent(shouldContinue?: CreativeContinuationGuard) {
  if (shouldContinue && !shouldContinue()) {
    const error = new Error('账号或项目已切换，已停止后续操作')
    error.name = 'AbortError'
    throw error
  }
}

function dataOf<T>(payload: Envelope<T>): T {
  if ((payload.code !== undefined && payload.code !== 0) || payload.data === undefined || payload.data === null) throw new StudioApiError(payload.msg || '服务端没有返回有效数据', 502)
  return payload.data
}

export function candidateFromLibraryAsset(asset: CandidateLibraryAsset, scope: ShotScope): ShotCandidate | null {
  const data = asset.metadata?.creativeCandidate
  if (!data || data.version !== 1 || data.projectId !== scope.projectId || data.episodeId !== scope.episodeId || data.shotId !== scope.shotId) return null
  if ((data.kind !== 'image' && data.kind !== 'video') || data.kind !== asset.kind || typeof data.taskId !== 'string' || !Number.isInteger(data.resultIndex) || data.resultIndex < 0) return null
  const url = stableMediaUrl(asset.data.serverUrl || asset.data.url || asset.data.dataUrl)
  if (!url) return null
  const key = candidateKey(scope, data.kind, data.taskId, data.resultIndex)
  if (data.key !== key) return null
  return {
    ...scope, id: asset.id, key, kind: data.kind, taskId: data.taskId, resultIndex: data.resultIndex,
    url, model: typeof data.model === 'string' ? data.model : undefined,
    prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
    width: positiveNumber(asset.data.width), height: positiveNumber(asset.data.height), createdAt: asset.createdAt,
  }
}

/** Full pagination is needed: a missing item on the first page does not mean no older versions exist. */
export async function listShotCandidates(scope: ShotScope, options: { maxPages?: number; shouldContinue?: CreativeContinuationGuard } = {}): Promise<{ candidates: ShotCandidate[]; truncated: boolean }> {
  const candidates = new Map<string, ShotCandidate>()
  const maxPages = Math.max(1, options.maxPages ?? 50)
  let scanned = 0
  for (let page = 1; page <= maxPages; page += 1) {
    assertCurrent(options.shouldContinue)
    const result = await listLibraryAssets({ page, pageSize: 100 })
    assertCurrent(options.shouldContinue)
    scanned += result.assets.length
    for (const asset of result.assets) {
      const candidate = candidateFromLibraryAsset(asset as CandidateLibraryAsset, scope)
      if (candidate && !candidates.has(candidate.key)) candidates.set(candidate.key, candidate)
    }
    if (result.assets.length < 100 || scanned >= result.total) return { candidates: [...candidates.values()], truncated: false }
  }
  return { candidates: [...candidates.values()], truncated: true }
}

export type RegisterShotCandidateInput = {
  scope: ShotScope
  media: MediaResult
  taskId: string
  resultIndex?: number
  model?: string
  prompt?: string
  title?: string
  shouldContinue?: CreativeContinuationGuard
}

/** Save actual media in the existing asset library, with explicit shot provenance. */
export async function registerShotCandidate(input: RegisterShotCandidateInput): Promise<ShotCandidate> {
  assertCurrent(input.shouldContinue)
  const { scope, media } = input
  if (media.kind !== 'image' && media.kind !== 'video') throw new StudioApiError('镜头候选只支持图片或视频', 400)
  const resultIndex = input.resultIndex ?? 0
  if (!scope.projectId || !scope.episodeId || !scope.shotId || !Number.isInteger(resultIndex) || resultIndex < 0) throw new StudioApiError('候选版本的镜头标识无效', 400)
  const url = stableMediaUrl(media.url)
  const storageKey = mediaStorageKey(url)
  if (!url || !storageKey) throw new StudioApiError('结果尚未持久保存到素材服务器，暂时不能登记候选版本', 409)
  const key = candidateKey(scope, media.kind, input.taskId, resultIndex)
  const existing = await listShotCandidates(scope, { shouldContinue: input.shouldContinue })
  assertCurrent(input.shouldContinue)
  const match = existing.candidates.find((candidate) => candidate.key === key)
  if (match) return match
  if (existing.truncated) throw new StudioApiError('候选历史较多，尚未完整核对，请稍后重试登记', 409)
  const metadata: CandidateMetadata = { ...scope, version: 1, key, kind: media.kind, taskId: input.taskId, resultIndex, model: input.model, prompt: input.prompt }
  assertCurrent(input.shouldContinue)
  const asset = await createLibraryAsset({
    kind: media.kind,
    title: input.title || '镜头候选版本',
    coverUrl: media.kind === 'image' ? url : media.poster,
    tags: ['镜头候选'], source: 'creative-project',
    data: { storageKey, serverUrl: url, ...(media.kind === 'image' ? { dataUrl: url } : { url }), width: media.width ?? 0, height: media.height ?? 0, bytes: 0, mimeType: media.mimeType || (media.kind === 'image' ? 'image/png' : 'video/mp4') },
    metadata: { creativeCandidate: metadata },
  })
  assertCurrent(input.shouldContinue)
  const saved = candidateFromLibraryAsset(asset as CandidateLibraryAsset, scope)
  if (!saved) throw new StudioApiError('候选素材已保存，但服务端未保留镜头关联，请刷新核对', 502)
  return saved
}

/** Preserve the previously adopted output before another generation replaces its task pointer. */
export async function registerAdoptedShotCandidate(project: DramaProject, episodeId: string, shotId: string, kind: 'image' | 'video', shouldContinue?: CreativeContinuationGuard): Promise<ShotCandidate | null> {
  assertCurrent(shouldContinue)
  const shot = project.episodes.find((episode) => episode.id === episodeId)?.shots.find((item) => item.id === shotId)
  if (!shot) throw new StudioApiError('镜头不存在', 404)
  const media = adoptedShotMedia(shot, kind)
  if (!media) return null
  const scope = { projectId: project.id, episodeId, shotId }
  const existing = await listShotCandidates(scope, { shouldContinue })
  assertCurrent(shouldContinue)
  const match = existing.candidates.find((candidate) => candidate.kind === kind && candidate.url === media.url)
  if (match) return match
  if (existing.truncated) throw new StudioApiError('尚未完整核对已采用版本，请稍后重试', 409)
  // The shot task pointer may already refer to a newer, unadopted generation.
  // Only an existing candidate can prove which task produced this URL.
  return registerShotCandidate({ scope, media, taskId: `legacy:${media.url}`, prompt: kind === 'image' ? shot.imagePrompt : shot.videoPrompt, title: `${shot.title} · 已采用版本`, shouldContinue })
}

/** Result URL aliases describe one output, not separate candidates. Prefer the persisted server URL. */
export function normalizeCandidateMedia(kind: 'image' | 'video', result: unknown): MediaResult[] {
  if (typeof result === 'string') return stableMediaUrl(result) ? [{ kind, url: result }] : []
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const record = result as Record<string, unknown>
  const rows = Array.isArray(record.results) && record.results.length ? record.results : Array.isArray(record.assets) && record.assets.length ? record.assets : [record]
  const seen = new Set<string>()
  return rows.flatMap((entry): MediaResult[] => {
    if (typeof entry === 'string') entry = { url: entry }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const value = entry as Record<string, unknown>
    const urls = [value.serverUrl, value.url, value.dataUrl, value.remoteUrl, value.videoUrl].map(stableMediaUrl).filter(Boolean)
    const url = urls.find((candidate) => mediaStorageKey(candidate)) || urls[0]
    if (!url || seen.has(url)) return []
    seen.add(url)
    return [{ kind, url, width: positiveNumber(value.width), height: positiveNumber(value.height), poster: stableMediaUrl(value.posterUrl || value.poster) || undefined, mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined }]
  })
}

export async function uploadCreativeReference(file: File, shouldContinue?: CreativeContinuationGuard): Promise<DramaSourceAsset> {
  assertCurrent(shouldContinue)
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null
  if (!kind) throw new StudioApiError('请选择图片、视频或音频参考文件', 400)
  const uploaded = await uploadPersistentAsset(file, kind)
  assertCurrent(shouldContinue)
  const asset = await createLibraryAsset({ kind, title: file.name, source: 'creative-reference', tags: ['创作参考'], data: { storageKey: uploaded.key, serverUrl: uploaded.url, ...(kind === 'image' ? { dataUrl: uploaded.url } : { url: uploaded.url }), bytes: uploaded.bytes, mimeType: uploaded.mimeType, width: 0, height: 0 } })
  assertCurrent(shouldContinue)
  return { id: asset.id, type: kind, title: asset.title, storageKey: uploaded.key, serverUrl: uploaded.url, mimeType: uploaded.mimeType }
}

export async function getRenderCapability(): Promise<boolean> {
  const payload = await request<Envelope<{ available: boolean }>>('/api/drama/render-capability')
  return dataOf(payload).available === true
}

export async function createProjectRender(project: DramaProject, episodeId: string): Promise<DramaRenderTask> {
  const episode = project.episodes.find((item) => item.id === episodeId)
  if (!episode?.shots.length || episode.shots.some((shot) => !stableMediaUrl(shot.videoUrl))) throw new StudioApiError('请先为每个镜头采用一个视频版本', 400)
  if (episode.shots.some((shot) => shot.audioMode === 'voiceover' && !stableMediaUrl(shot.audioUrl))) throw new StudioApiError('部分镜头的配音尚未完成', 400)
  const payload = await request<Envelope<DramaRenderTask>>('/api/drama/render', {
    method: 'POST', body: JSON.stringify({ projectId: project.id, conversationId: project.creativeConversationId, title: project.title, ratio: project.ratio, shots: episode.shots.map((shot) => ({ videoUrl: shot.videoUrl, audioMode: shot.audioMode || 'source', audioUrl: shot.audioUrl, subtitle: shot.subtitle || shot.dialogue || shot.narration, duration: shot.duration })) }),
  })
  return dataOf(payload)
}

export async function getProjectRender(id: string): Promise<DramaRenderTask> {
  return dataOf(await request<Envelope<DramaRenderTask>>(`/api/drama/render/${encodeURIComponent(id)}`))
}

export type CreativeProjectVersion = { id: string; projectId: string; version: number; reason: string; createdAt: string }

export async function listProjectVersions(projectId: string): Promise<CreativeProjectVersion[]> {
  return dataOf(await request<Envelope<{ versions: CreativeProjectVersion[] }>>(`/api/drama/projects/${encodeURIComponent(projectId)}/versions`)).versions
}

export async function createProjectVersion(project: DramaProject, reason: string): Promise<CreativeProjectVersion> {
  return dataOf(await request<Envelope<{ version: CreativeProjectVersion }>>(`/api/drama/projects/${encodeURIComponent(project.id)}/versions`, { method: 'POST', body: JSON.stringify({ reason, snapshot: project }) })).version
}

export async function restoreProjectVersion(projectId: string, versionId: string): Promise<DramaProject> {
  return dataOf(await request<Envelope<{ project: DramaProject }>>(`/api/drama/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`, { method: 'POST' })).project
}

export async function exportProjectJianying(projectId: string, input: { episodeId: string; draftPath: string; version: '5' | '6' }): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`/api/drama/projects/${encodeURIComponent(projectId)}/export-jianying`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new StudioApiError(payload.msg || '剪映草稿导出失败', response.status)
  }
  const encoded = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  let fileName = '创作项目_剪映草稿.zip'
  try { if (encoded) fileName = decodeURIComponent(encoded) } catch { /* Keep the safe fallback filename. */ }
  return { blob: await response.blob(), fileName }
}

function positiveNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}
