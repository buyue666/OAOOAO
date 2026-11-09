import type { PromptReference } from './prompt-references'

export type AgentFileKind = PromptReference['type']
export const AGENT_FILE_LIMIT = 12
export const AGENT_FILE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/ogg,.txt,.md,.markdown,.json,.csv,.srt,.vtt'
const textExtensions = /\.(txt|md|markdown|json|csv|srt|vtt)$/i

export function agentFileKind(file: { name: string; type: string }): AgentFileKind | undefined {
  if (textExtensions.test(file.name)) return 'text'
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) return 'image'
  if (['video/mp4', 'video/webm'].includes(file.type)) return 'video'
  if (['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg'].includes(file.type)) return 'audio'
}

export function validateAgentFiles(files: readonly { name: string; type: string; size: number }[], count: number) {
  if (count + files.length > AGENT_FILE_LIMIT) return `一次最多添加 ${AGENT_FILE_LIMIT} 个参考文件。`
  for (const file of files) {
    const kind = agentFileKind(file)
    if (!kind) return `「${file.name}」暂不支持。请选择图片、MP4 / WebM 视频、音频或 TXT / Markdown / JSON / CSV / 字幕文件。`
    const limit = kind === 'text' ? 1 : kind === 'image' ? 20 : 100
    if (file.size > limit * 1024 * 1024) return `「${file.name}」超过 ${limit} MB 限制。`
  }
  return ''
}

/** Quoted names make references unambiguous even when a filename contains spaces or @. */
export function agentPromptReferences<T extends { id: string; title: string; kind?: AgentFileKind; preview?: string; status?: string }>(files: readonly T[]): PromptReference[] {
  const counts = new Map<string, number>()
  return files.map(file => {
    const name = file.title.replace(/[「」\r\n]/g, ' ').trim().slice(0, 120) || '未命名文件'
    const ordinal = (counts.get(name) || 0) + 1
    counts.set(name, ordinal)
    return { id: file.id, name: file.title, type: file.kind || 'image', preview: file.preview, ready: !file.status || file.status === 'ready', ...(file.kind ? { mention: `@「${name}${ordinal > 1 ? ` · ${ordinal}` : ''}」` } : {}) }
  })
}

export function normalizeAgentText(text: string) {
  const content = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!content || content.includes('\u0000')) throw new Error('文件没有可读取的文本，请检查文件内容和 UTF-8 编码。')
  if (content.length > 24000) throw new Error('文档超过 24,000 字符，请拆分后再添加。')
  return content
}
