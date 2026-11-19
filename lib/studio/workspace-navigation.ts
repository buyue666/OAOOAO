const teamPath = /^\/teams\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/projects\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?(?:\/|$)/i
export type WorkspaceIdentity = { teamId: string; projectId?: string }
export function workspaceIdentity(pathname: string): WorkspaceIdentity | null { const match = teamPath.exec(pathname); return match ? { teamId: match[1], projectId: match[2] || undefined } : null }
export function workspaceRoot({ teamId, projectId }: WorkspaceIdentity) { return `/teams/${teamId}${projectId ? `/projects/${projectId}` : ''}` }
export function workspaceSection(pathname: string) {
  const identity = workspaceIdentity(pathname)
  return identity ? pathname.slice(workspaceRoot(identity).length) || '/teams' : pathname
}

export function parseWorkspaceIdentity(raw: string | null): { teamId: string; projectId?: string } | null {
  if (!raw) return null
  try { const value = JSON.parse(raw); if (!value || typeof value.teamId !== 'string') return null; const parsed = workspaceIdentity(`/teams/${value.teamId}${value.projectId ? `/projects/${value.projectId}` : ''}`); return parsed && parsed.teamId === value.teamId && (!value.projectId || parsed.projectId === value.projectId) ? parsed : null } catch { return null }
}

export function workspaceDestination(pathname: string, identity: WorkspaceIdentity | null) {
  if (!identity || workspaceIdentity(pathname)) return pathname
  if (/^\/(?:studio|image|video|agent|canvas|drama|tools|skills|projects|assets|works|tasks|settings)(?:\/|$)/.test(pathname)) return workspaceHref(workspaceRoot(identity), pathname)
  if (pathname === '/account' || pathname === '/credits') return `/teams/${identity.teamId}?tab=usage`
  return pathname
}

/** Creation links carry the current team's server-authorized project scope. */
export function workspaceHref(pathname: string, target: string) {
  const identity = workspaceIdentity(pathname)
  if (!identity) return target
  const team = `/teams/${identity.teamId}`, scope = workspaceRoot(identity), project = identity.projectId ? scope : undefined
  if (target === '/studio') return `${scope}/studio`
  if (target === '/image' || target === '/video') return `${scope}/studio${target}`
  if (/^\/canvas(?:\/|$)/.test(target)) return project ? `${project}/canvas` : `${scope}/studio/canvas`
  if (/^\/(?:agent|drama|tools|skills)(?:\/|$)/.test(target)) return `${scope}/studio/features`
  if (/^\/projects(?:\/|$)/.test(target)) return `${team}?tab=projects`
  if (target === '/assets') return project ? `${project}?tab=assets` : `${team}?tab=projects&intent=assets`
  if (target === '/works' || target === '/tasks') return project ? `${project}?tab=generation` : `${team}?tab=projects&intent=history`
  if (target === '/settings') return `${team}?tab=settings`
  return target
}
