/**
 * Resolve a canvas project to a drama project from the current account's list.
 * New projects share sourceHandoffId; their project IDs can be unrelated.
 * Older records may only encode the association in their IDs, so retain those
 * client compatibility rules without inventing a project that is not listed.
 */
const CANVAS_PREFIX = 'canvas-'
const DRAMA_PREFIX = 'drama-'

/** Legacy handoff shapes, including a drama episode exported to a canvas. */
export function matchesDramaProject(handoff: string, dramaProjectId: string): boolean {
  if (!handoff || !dramaProjectId) return false
  if (handoff.startsWith(`${dramaProjectId}-`)) return true
  if (handoff.startsWith(`${DRAMA_PREFIX}${dramaProjectId}-`)) return true
  if (handoff === dramaProjectId) return true
  return dramaProjectId === `${DRAMA_PREFIX}${handoff}`
}

/** Prefer the saved association; only derive it from the ID for older records. */
export function canvasHandoffFromProjectId(canvasProjectId: string, sourceHandoffId?: string): string {
  const explicit = typeof sourceHandoffId === 'string' ? sourceHandoffId.trim() : ''
  if (explicit) return explicit
  const id = typeof canvasProjectId === 'string' ? canvasProjectId.trim() : ''
  if (!id) return ''
  return id.startsWith(CANVAS_PREFIX) ? id.slice(CANVAS_PREFIX.length) : id
}

export type DramaLinkCandidate = { id: string; sourceHandoffId?: string }

/** Return null for an absent or ambiguous link; the caller decides whether to create one. */
export function resolveLinkedDramaProjectId(canvasProjectId: string, dramaProjects: readonly (string | DramaLinkCandidate)[], sourceHandoffId?: string): string | null {
  const handoff = canvasHandoffFromProjectId(canvasProjectId, sourceHandoffId)
  if (!handoff) return null
  const candidates = dramaProjects.map((project) => typeof project === 'string' ? { id: project } : project)
  const explicit = new Set(candidates.filter((project) => project.sourceHandoffId?.trim() === handoff && project.id.trim()).map((project) => project.id.trim()))
  if (explicit.size) return explicit.size === 1 ? [...explicit][0] : null
  let matched: string | null = null
  for (const candidate of candidates) {
    const id = candidate.id.trim()
    // A saved, different origin defeats the old same-suffix shortcut. An
    // episode handoff can still name a drama with its own earlier origin.
    if (id === `${DRAMA_PREFIX}${handoff}` && candidate.sourceHandoffId?.trim() && candidate.sourceHandoffId.trim() !== handoff) continue
    if (!matchesDramaProject(handoff, id)) continue
    // IDs may contain hyphens: choose the longest complete candidate, never split.
    if (!matched || id.length > matched.length) matched = id
  }
  return matched
}

/** Handoff sent by the client when exporting a drama episode to a canvas. */
export function dramaCanvasHandoffId(dramaProjectId: string, episodeId?: string): string {
  const project = String(dramaProjectId || '').trim()
  const episode = String(episodeId || '').trim()
  if (!project) return ''
  if (!episode) return project.slice(0, 160)
  return `drama-${project}-${episode}`.slice(0, 160)
}

/** Legacy ID shape only; new canvas IDs must be read from the API response. */
export function canvasProjectIdFromHandoff(handoffId: string): string {
  const handoff = String(handoffId || '').trim()
  return handoff ? `${CANVAS_PREFIX}${handoff}` : ''
}
