import type { LibraryAssetView } from './account-api'

export type CanvasSkill = { id: string; title: string; prompt: string }
export const MAX_CANVAS_SKILLS = 8
export const MAX_SKILL_PROMPT = 4000
export const MAX_SKILL_MARKDOWN_BYTES = 64 * 1024

export type CanvasSkillDraft = {
  title: string
  summary: string
  scenarios: string
  usage: string
  output: string
  instructions: string
}

export function emptyCanvasSkillDraft(): CanvasSkillDraft {
  return { title: '', summary: '', scenarios: '', usage: '', output: '', instructions: '' }
}

/** One authoritative prompt is consumed by both generation nodes and the server-side Agent. */
export function canvasSkillDraftPrompt(draft: CanvasSkillDraft): string {
  const context = [
    ['简介', draft.summary], ['适用场景', draft.scenarios],
    ['使用方式', draft.usage], ['输出要求', draft.output],
  ].filter(([, value]) => value.trim()).map(([label, value]) => `【${label}】\n${value.trim()}`)
  const instructions = draft.instructions.trim()
  return context.length ? [...context, instructions ? `【技能指令】\n${instructions}` : ''].filter(Boolean).join('\n\n') : instructions
}

export function canvasSkillDraftError(draft: CanvasSkillDraft): string | null {
  if (Object.values(draft).some((value) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) return '技能说明含有非文本控制字符，请移除后再保存'
  if (!draft.title.trim()) return '请填写技能名称'
  if (draft.title.trim().length > 80 || /[\r\n]/.test(draft.title)) return '技能名称应为单行，最多 80 个字符'
  if (draft.summary.trim().length > 240) return '简介最多 240 个字符'
  if (!draft.instructions.trim()) return '请填写技能指令'
  const length = canvasSkillDraftPrompt(draft).length
  if (length > MAX_SKILL_PROMPT) return `完整执行指令为 ${length} 个字符，超过 ${MAX_SKILL_PROMPT} 上限，请精简说明或指令`
  return null
}

export function canvasSkillAssetInput(draft: CanvasSkillDraft) {
  const error = canvasSkillDraftError(draft)
  if (error) throw new Error(error)
  const normalized = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as CanvasSkillDraft
  return {
    kind: 'text' as const, title: normalized.title, source: 'canvas-skill', tags: ['技能'],
    data: { skillVersion: 2, prompt: canvasSkillDraftPrompt(normalized), skillDraft: normalized },
  }
}

/** Never replace the executable prompt with stale or malformed editor metadata. */
export function canvasSkillDraftOf(asset: LibraryAssetView): CanvasSkillDraft | null {
  const skill = canvasSkillOf(asset)
  if (!skill) return null
  const raw = asset.data.skillDraft
  if (asset.data.skillVersion === 2 && raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    const keys = ['summary', 'scenarios', 'usage', 'output', 'instructions'] as const
    if (keys.every((key) => typeof record[key] === 'string')) {
      const draft = { title: asset.title, ...Object.fromEntries(keys.map((key) => [key, record[key]])) } as CanvasSkillDraft
      if (canvasSkillDraftPrompt(draft) === skill.prompt) return draft
    }
  }
  return { ...emptyCanvasSkillDraft(), title: skill.title, instructions: skill.prompt }
}

/** Portable text only. JSON-quoted scalars are also valid YAML scalars; no executable bundle is produced. */
export function exportCanvasSkillMarkdown(draft: CanvasSkillDraft): string {
  const error = canvasSkillDraftError(draft)
  if (error) throw new Error(error)
  const fields = [
    ['name', draft.title], ['description', draft.summary], ['scenarios', draft.scenarios],
    ['usage', draft.usage], ['output', draft.output],
  ]
  return ['---', 'oao-skill-version: 2', ...fields.map(([key, value]) => `${key}: ${JSON.stringify(value.trim())}`), '---', '', draft.instructions.trim(), ''].join('\n')
}

/** Reads a small scalar-only Markdown header. Unknown metadata remains inert and is not executed. */
export function importCanvasSkillMarkdown(source: string, fileName = 'SKILL.md'): CanvasSkillDraft {
  if (!/^skill\.md$/i.test(fileName)) throw new Error('请选择单个 SKILL.md 文本文件；不支持 ZIP 或多文件技能包')
  if (source.length > MAX_SKILL_MARKDOWN_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source)) throw new Error('文件过大或包含非文本内容，请使用不超过 64 KB 的 SKILL.md')
  let body = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  const metadata: Record<string, string> = Object.create(null)
  const supported = new Set(['name', 'description', 'scenarios', 'usage', 'output', 'oao-skill-version'])
  if (body.startsWith('---\n')) {
    const lines = body.split('\n')
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (end < 0) throw new Error('SKILL.md 的说明头缺少结束分隔线 ---')
    for (let index = 1; index < end; index++) {
      const entry = /^([\w-]+):\s*(.*)$/.exec(lines[index])
      if (!entry || !supported.has(entry[1])) continue
      const [, key, raw] = entry
      if (key in metadata) throw new Error(`SKILL.md 重复定义了 ${key}`)
      let value = raw.trim()
      if (/^[|>][-+]?$/.test(value)) {
        const folded = value.startsWith('>')
        const block: string[] = []
        while (index + 1 < end && (/^\s/.test(lines[index + 1]) || !lines[index + 1])) block.push(lines[++index].trim())
        value = block.join(folded ? ' ' : '\n').trim()
      } else if (value.startsWith('"')) {
        try { value = JSON.parse(value) as string } catch { throw new Error(`SKILL.md 的 ${key} 引号格式无效`) }
        if (typeof value !== 'string') throw new Error(`SKILL.md 的 ${key} 必须是文本`)
      } else if (value.startsWith("'")) {
        if (!value.endsWith("'") || value.length < 2) throw new Error(`SKILL.md 的 ${key} 引号格式无效`)
        value = value.slice(1, -1).replace(/''/g, "'")
      } else if (/^[\[{]/.test(value)) throw new Error(`SKILL.md 的 ${key} 必须是文本，不能是对象或列表`)
      metadata[key] = value
    }
    body = lines.slice(end + 1).join('\n').trim()
  }
  let title = metadata.name ?? ''
  const heading = /^#\s+([^\n]+)(?:\n|$)/.exec(body)
  if (!title && heading) { title = heading[1].trim(); body = body.slice(heading[0].length).trim() }
  const draft: CanvasSkillDraft = {
    title: title || '导入的技能', summary: metadata.description ?? '', scenarios: metadata.scenarios ?? '',
    usage: metadata.usage ?? '', output: metadata.output ?? '', instructions: body,
  }
  const error = canvasSkillDraftError(draft)
  if (error) throw new Error(error)
  return draft
}

/** Skills are explicitly labelled instruction assets, never arbitrary text results. */
export function canvasSkillOf(asset: LibraryAssetView): CanvasSkill | null {
  if (asset.kind !== 'text' || !(asset.source === 'canvas-skill' || asset.data.skillVersion === 1 || asset.data.skillVersion === 2 || asset.tags.includes('技能'))) return null
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
