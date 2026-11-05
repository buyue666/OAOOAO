export type PromptReference = {id: string; name: string; type: 'image' | 'video' | 'audio'; preview?: string; ready?: boolean}

export function referenceMentionQuery(value: string, caret: number): {start: number; query: string} | undefined {
  const prefix = value.slice(0, caret)
  const match = /@([^\s@]*)$/.exec(prefix)
  return match ? {start: prefix.length - match[0].length, query: match[1]} : undefined
}

export function insertReferenceMention(value: string, start: number, end: number, index: number) {
  const mention = `@${index + 1} `
  return {value: value.slice(0, start) + mention + value.slice(end), caret: start + mention.length}
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
