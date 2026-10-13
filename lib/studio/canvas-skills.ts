import type { LibraryAssetView } from './account-api'

export type CanvasSkill = { id: string; title: string; prompt: string }
export const MAX_CANVAS_SKILLS = 8
export const MAX_SKILL_PROMPT = 4000

/** Skills are explicitly labelled instruction assets, never arbitrary text results. */
export function canvasSkillOf(asset: LibraryAssetView): CanvasSkill | null {
  if (asset.kind !== 'text' || !(asset.source === 'canvas-skill' || asset.data.skillVersion === 1 || asset.tags.includes('技能'))) return null
  const prompt = typeof asset.data.prompt === 'string' ? asset.data.prompt.trim() : typeof asset.data.text === 'string' ? asset.data.text.trim() : ''
  return prompt && prompt.length <= MAX_SKILL_PROMPT ? { id: asset.id, title: asset.title, prompt } : null
}

export function composeSkillPrompt(prompt: string, skills: readonly CanvasSkill[]) {
  return [prompt.trim(), ...skills.map((skill) => `【技能：${skill.title}】\n${skill.prompt.trim()}`)].filter(Boolean).join('\n\n')
}

export function toggleCanvasSkill(selected: readonly CanvasSkill[], skill: CanvasSkill): CanvasSkill[] {
  if (selected.some((item) => item.id === skill.id)) return selected.filter((item) => item.id !== skill.id)
  if (selected.length >= MAX_CANVAS_SKILLS) throw new Error(`最多选择 ${MAX_CANVAS_SKILLS} 个技能`)
  return [...selected, skill]
}

/** Fetch every required skill before submission; missing/deleted skills never run from stale snapshots. */
export async function resolveCanvasSkills(ids: readonly string[], loadPage: (page: number) => Promise<{ assets: LibraryAssetView[]; total: number }>) {
  const wanted = [...new Set(ids)]
  if (wanted.length > MAX_CANVAS_SKILLS) throw new Error(`最多选择 ${MAX_CANVAS_SKILLS} 个技能`)
  if (!wanted.length) return []
  const found = new Map<string, CanvasSkill>()
  let scanned = 0
  for (let page = 1; page <= 50; page++) {
    const result = await loadPage(page)
    for (const asset of result.assets) {
      const skill = canvasSkillOf(asset)
      if (skill && wanted.includes(skill.id)) found.set(skill.id, skill)
    }
    scanned += result.assets.length
    if (wanted.every((id) => found.has(id))) return wanted.map((id) => found.get(id)!)
    if (scanned >= result.total || result.assets.length === 0) throw new Error('所选技能已删除或内容无效，请重新选择技能')
  }
  throw new Error('技能库尚未读取完整，请稍后重试')
}
