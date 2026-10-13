import type { DramaEpisode, DramaNamedAsset, DramaProject, DramaShot } from './drama-types'
import type { GenerationReference, MediaResult } from './generation-types'

export type ShotScope = { projectId: string; episodeId: string; shotId: string }
export type ShotCandidate = ShotScope & {
  id: string
  key: string
  kind: 'image' | 'video'
  taskId: string
  resultIndex: number
  url: string
  width?: number
  height?: number
  model?: string
  prompt?: string
  createdAt: string
}

/** Tuple encoding avoids ambiguous IDs when project and shot IDs contain separators. */
export function candidateKey(scope: ShotScope, kind: 'image' | 'video', taskId: string, resultIndex: number) {
  return JSON.stringify([scope.projectId, scope.episodeId, scope.shotId, kind, taskId, resultIndex])
}

export function newCreativeShot(order: number, input: Partial<DramaShot> = {}): DramaShot {
  return {
    order,
    title: `镜头 ${order}`,
    description: '', sourceText: '', shotBoundary: '', dialogue: '', narration: '',
    utterances: [], imagePrompt: '', videoPrompt: '', cameraMotion: '', duration: 5,
    characterIds: [], propIds: [], clueIds: [],
    ...input,
    id: `shot-${crypto.randomUUID()}`,
  }
}

export function updateCreativeShot(project: DramaProject, episodeId: string, shotId: string, patch: Partial<DramaShot>): DramaProject {
  const episode = project.episodes.find((item) => item.id === episodeId)
  const target = episode?.shots.find((shot) => shot.id === shotId)
  if (!episode || !target) throw new Error('镜头不存在，无法保存修改')
  const renderFields = ['videoUrl', 'duration', 'subtitle', 'dialogue', 'narration', 'audioMode', 'audioUrl'] as const
  const changesRender = renderFields.some((key) => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== target[key])
  return {
    ...project,
    episodes: project.episodes.map((item) => item.id !== episodeId ? item : {
      ...item,
      ...(changesRender ? { renderTask: undefined } : {}),
      shots: item.shots.map((shot) => shot.id !== shotId ? shot : { ...shot, ...patch, id: shot.id }),
    }),
  }
}

/** Choosing a result changes only its exact shot; no other shot or project fields are replaced. */
export function adoptShotCandidate(project: DramaProject, episodeId: string, shotId: string, candidate: ShotCandidate): DramaProject {
  if (candidate.projectId !== project.id || candidate.episodeId !== episodeId || candidate.shotId !== shotId) throw new Error('候选版本不属于当前镜头')
  if (!stableMediaUrl(candidate.url)) throw new Error('候选版本没有可持久保存的媒体地址')
  return updateCreativeShot(project, episodeId, shotId, candidate.kind === 'image' ? {
    storyboardImageUrl: candidate.url,
    storyboardStatus: 'success',
    storyboardTaskId: candidate.taskId || undefined,
    storyboardError: undefined,
    storyboardImageWidth: candidate.width,
    storyboardImageHeight: candidate.height,
  } : {
    videoUrl: candidate.url,
    generationStatus: 'success',
    generationTaskId: candidate.taskId || undefined,
    generationError: undefined,
  })
}

export function stableMediaUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  return /^(https?:\/\/|\/(?!\/))/i.test(url) ? url : ''
}

/** These are the backend's registered local-media routes; arbitrary remote paths are not storage keys. */
export function mediaStorageKey(value: string): string | null {
  let path: string
  try { path = new URL(value, 'http://local.invalid').pathname } catch { return null }
  const match = path.match(/^\/api\/(?:generation-log-assets|reference-assets)\/(.+)$/)
  if (!match) return null
  let key: string
  try { key = match[1].split('/').map(decodeURIComponent).join('/') } catch { return null }
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\u0000-\u001f]/.test(key)) return null
  return key
}

export function shotAssets(project: DramaProject, shot: DramaShot): DramaNamedAsset[] {
  return [
    ...project.characters.filter((asset) => shot.characterIds.includes(asset.id)),
    ...project.scenes.filter((asset) => shot.sceneId === asset.id),
    ...project.props.filter((asset) => shot.propIds.includes(asset.id)),
    ...project.clues.filter((asset) => shot.clueIds.includes(asset.id)),
  ]
}

export function shotReferences(project: DramaProject, shot: DramaShot, kind: 'image' | 'video' = 'image'): GenerationReference[] {
  if (kind === 'video' && stableMediaUrl(shot.storyboardImageUrl)) return [{ name: `${shot.title} · 已采用分镜`, type: 'image', url: shot.storyboardImageUrl, role: 'first_frame' }]
  const refs: GenerationReference[] = shotAssets(project, shot).flatMap((asset) => {
    const primary = asset.references?.find((ref) => ref.id === asset.primaryReferenceId) ?? asset.references?.[0]
    const url = stableMediaUrl(primary?.url || asset.referenceImageUrl)
    return url ? [{ name: asset.name, type: 'image', url }] : []
  })
  for (const asset of project.sourceAssets ?? []) {
    const url = stableMediaUrl(asset.serverUrl || asset.remoteUrl)
    if (asset.type === 'image' && url) refs.push({ name: asset.title, type: 'image', url })
  }
  return refs.filter((ref, index) => refs.findIndex((item) => item.url === ref.url) === index)
}

export function buildShotPrompt(project: DramaProject, shot: DramaShot, kind: 'image' | 'video', direction = ''): string {
  const prompt = (kind === 'image' ? shot.imagePrompt : shot.videoPrompt)?.trim() || shot.description.trim()
  if (!prompt) throw new Error('请先填写这个镜头的画面描述')
  return [
    prompt,
    project.style ? `作品风格：${project.style}` : '',
    ...shotAssets(project, shot).map((asset) => [
      `${asset.name}：${asset.description}`,
      asset.profile?.visualIdentity,
      asset.profile?.styling,
      asset.profile?.colorPalette,
      asset.profile?.consistencyRules ? `必须保持：${asset.profile.consistencyRules}` : '',
    ].filter(Boolean).join('；')),
    direction.trim() ? `本次调整：${direction.trim()}` : '',
  ].filter(Boolean).join('\n')
}

export function assetAffectedShots(project: DramaProject, assetId: string): Array<ShotScope & { title: string }> {
  return project.episodes.flatMap((episode) => episode.shots.flatMap((shot) => (
    shot.characterIds.includes(assetId) || shot.propIds.includes(assetId) || shot.clueIds.includes(assetId) || shot.sceneId === assetId
      ? [{ projectId: project.id, episodeId: episode.id, shotId: shot.id, title: shot.title }]
      : []
  )))
}

export function buildProjectSrt(episode: DramaEpisode): string {
  let elapsed = 0
  let index = 0
  return episode.shots.flatMap((shot) => {
    const start = elapsed
    elapsed += Math.max(1, Number(shot.duration) || 5) * 1000
    const text = (shot.subtitle || shot.dialogue || shot.narration || '').trim()
    if (!text) return []
    index += 1
    return [`${index}\n${srtTime(start)} --> ${srtTime(elapsed)}\n${text}\n`]
  }).join('\n')
}

function srtTime(milliseconds: number) {
  const value = Math.round(milliseconds)
  return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')},${String(value % 1000).padStart(3, '0')}`
}

export function adoptedShotMedia(shot: DramaShot, kind: 'image' | 'video'): MediaResult | null {
  const url = stableMediaUrl(kind === 'image' ? shot.storyboardImageUrl : shot.videoUrl)
  return url ? { kind, url, ...(kind === 'image' ? { width: shot.storyboardImageWidth, height: shot.storyboardImageHeight } : {}) } : null
}
