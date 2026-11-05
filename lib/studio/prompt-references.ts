export type PromptReference = {id: string; name: string; type: 'image' | 'video' | 'audio'; preview?: string; ready?: boolean}
type ReferenceKind = {type?: string}

export function referenceMentionLabel(references: readonly ReferenceKind[], index: number) {
  const reference = references[index]
  if (!reference) return `@${index + 1}`
  const type = reference.type || 'image'
  if (!['image', 'video', 'audio'].includes(type)) return `@${index + 1}`
  const ordinal = references.slice(0, index + 1).filter(reference => (reference.type || 'image') === type).length
  return `@${type === 'image' ? '图' : type === 'video' ? '视频' : '音频'}${ordinal}`
}

/** Friendly labels are display text; requests retain the provider's global @N order. */
export function promptReferenceMentions(value: string, references: readonly ReferenceKind[]) {
  const mentions: Array<{start: number; end: number; text: string; index: number}> = []
  for (const match of value.matchAll(/@(?:(图|图片|视频|音频))?([1-9]\d*)(?![\dA-Za-z_])/gu)) {
    const ordinal = Number(match[2]) - 1
    const type = match[1] === '图' || match[1] === '图片' ? 'image' : match[1] === '视频' ? 'video' : 'audio'
    const index = match[1] ? references.map((reference, index) => ({reference, index})).filter(item => (item.reference.type || 'image') === type)[ordinal]?.index : ordinal
    if (index === undefined || !references[index]) continue
    mentions.push({start: match.index!, end: match.index! + match[0].length, text: match[0], index})
  }
  return mentions
}

export function serializePromptReferences(value: string, references: readonly ReferenceKind[]) {
  let output = '', end = 0
  for (const mention of promptReferenceMentions(value, references)) {
    output += value.slice(end, mention.start) + `@${mention.index + 1}`
    end = mention.end
  }
  return output + value.slice(end)
}

export function referenceMentionQuery(value: string, caret: number): {start: number; query: string} | undefined {
  const prefix = value.slice(0, caret)
  const match = /@([^\s@]*)$/.exec(prefix)
  return match ? {start: prefix.length - match[0].length, query: match[1]} : undefined
}

export function insertReferenceMention(value: string, start: number, end: number, index: number, references?: readonly ReferenceKind[]) {
  const label = references ? referenceMentionLabel(references, index) : `@${index + 1}`
  const suffix = value.slice(end), separator = /^\s/.test(suffix) ? '' : ' '
  return {value: value.slice(0, start) + label + separator + suffix, caret: start + label.length + (suffix.startsWith(' ') ? 1 : separator.length)}
}

/** Match the exact order used when constructing the request's references array. */
export function orderedPromptReferences(mode: string, groups: {first: PromptReference[]; last: PromptReference[]; source: PromptReference[]; references: PromptReference[]}, acceptTextReferences = true): PromptReference[] {
  if (mode === 'first') return groups.first
  if (mode === 'ends') return [...groups.first, ...groups.last]
  if (mode === 'mixed') return [...groups.first, ...groups.last, ...groups.references]
  if (mode === 'edit') return groups.source
  if (mode === 'references' || (mode === 'text' && acceptTextReferences)) return groups.references
  return []
}
