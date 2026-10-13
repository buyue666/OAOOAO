import type { DramaProject, DramaShot } from './drama-types'
import { newCreativeShot, updateCreativeShot } from './creative-project'

const MAX_DRAFT_LENGTH = 2 * 1024 * 1024
export type CreativeDraftBackup = { version: 1; accountId: string; projectId: string; baseUpdatedAt: string; savedAt: string; draft: DramaProject }

export function creativeDraftStorageKey(accountId: string, projectId: string) {
  return `oao:creative-draft:${JSON.stringify([accountId, projectId])}`
}

export function serializeCreativeDraft(accountId: string, base: DramaProject, draft: DramaProject): string {
  const value: CreativeDraftBackup = { version: 1, accountId, projectId: base.id, baseUpdatedAt: base.updatedAt, savedAt: new Date().toISOString(), draft }
  const raw = JSON.stringify(value)
  if (!parseCreativeDraft(raw, accountId, base.id)) throw new Error('草稿内容无效或过大，无法在当前浏览器备份')
  return raw
}

/** Session storage is external input; reject malformed shapes and foreign account/project records. */
export function parseCreativeDraft(raw: string | null, accountId: string, projectId: string): CreativeDraftBackup | null {
  if (!raw || raw.length > MAX_DRAFT_LENGTH || !accountId || !projectId) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!record(value) || value.version !== 1 || value.accountId !== accountId || value.projectId !== projectId || !date(value.baseUpdatedAt) || !date(value.savedAt)) return null
  const draft = value.draft
  if (!record(draft) || draft.id !== projectId || !Array.isArray(draft.episodes) || !draft.episodes.length || draft.episodes.length > 1000) return null
  const episodeIds = new Set<string>()
  const shotIds = new Set<string>()
  for (const episode of draft.episodes) {
    if (!record(episode) || !id(episode.id) || episodeIds.has(episode.id) || !text(episode.script, 200000) || !Array.isArray(episode.shots) || episode.shots.length > 10000) return null
    episodeIds.add(episode.id)
    for (const shot of episode.shots) {
      if (!record(shot) || !id(shot.id) || shotIds.has(shot.id)) return null
      shotIds.add(shot.id)
      if (!['title', 'description', 'imagePrompt', 'videoPrompt'].every((key) => text(shot[key], 20000))) return null
      if (shot.subtitle !== undefined && !text(shot.subtitle, 20000)) return null
      if (typeof shot.duration !== 'number' || !Number.isFinite(shot.duration) || shot.duration < 1 || shot.duration > 3600) return null
      if (!['characterIds', 'propIds', 'clueIds'].every((key) => Array.isArray(shot[key]) && (shot[key] as unknown[]).length <= 10000 && (shot[key] as unknown[]).every(id))) return null
      if (shot.sceneId !== undefined && !id(shot.sceneId)) return null
    }
  }
  return value as unknown as CreativeDraftBackup
}

/** Restore only fields this editor lets people edit. Media, task IDs, billing and server metadata remain authoritative. */
export function restoreCreativeDraft(base: DramaProject, backup: CreativeDraftBackup): DramaProject {
  if (backup.projectId !== base.id || backup.draft.id !== base.id || backup.baseUpdatedAt !== base.updatedAt) throw new Error('服务器项目已更新，请先下载旧草稿，再手动合并修改')
  if (backup.draft.episodes.length !== base.episodes.length || base.episodes.some((episode) => !backup.draft.episodes.some((item) => item.id === episode.id))) throw new Error('草稿分集与服务器项目不一致')
  let restored = base
  for (const episode of base.episodes) {
    const saved = backup.draft.episodes.find((item) => item.id === episode.id)!
    if (episode.shots.some((shot) => !saved.shots.some((item) => item.id === shot.id))) throw new Error('草稿缺少服务器已有镜头，无法自动恢复')
    const known = new Set(episode.shots.map((shot) => shot.id))
    const additions = saved.shots.filter((shot) => !known.has(shot.id)).map((shot, index) => ({ ...newCreativeShot(episode.shots.length + index + 1, editableShot(shot)), id: shot.id }))
    if (additions.some((shot) => base.episodes.some((item) => item.shots.some((existing) => existing.id === shot.id)))) throw new Error('草稿镜头归属与服务器项目不一致')
    restored = { ...restored, episodes: restored.episodes.map((item) => item.id !== episode.id ? item : {
      ...item,
      ...(saved.script !== episode.script ? { script: saved.script, scriptRichContent: undefined } : {}),
      ...(additions.length ? { shots: [...item.shots, ...additions], renderTask: undefined } : {}),
    }) }
    for (const shot of saved.shots) restored = updateCreativeShot(restored, episode.id, shot.id, editableShot(shot))
  }
  return restored
}

function editableShot(shot: DramaShot): Partial<DramaShot> {
  return {
    title: shot.title, description: shot.description, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt,
    duration: shot.duration, subtitle: shot.subtitle, characterIds: shot.characterIds, propIds: shot.propIds, clueIds: shot.clueIds, sceneId: shot.sceneId,
  }
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max }
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value) }
function date(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
