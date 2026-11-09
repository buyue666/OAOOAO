const teamPath = /^\/teams\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/projects\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?(?:\/|$)/i
export function workspaceIdentity(pathname: string) { const match = teamPath.exec(pathname); return match ? { teamId: match[1], projectId: match[2] || undefined } : null }

export function parseWorkspaceIdentity(raw: string | null): { teamId: string; projectId?: string } | null {
  if (!raw) return null
  try { const value = JSON.parse(raw); if (!value || typeof value.teamId !== 'string') return null; const parsed = workspaceIdentity(`/teams/${value.teamId}${value.projectId ? `/projects/${value.projectId}` : ''}`); return parsed && parsed.teamId === value.teamId && (!value.projectId || parsed.projectId === value.projectId) ? parsed : null } catch { return null }
}

export function workspaceDestination(pathname: string, identity: { teamId: string; projectId?: string } | null) {
  if (!identity || workspaceIdentity(pathname)) return pathname
  const scope = `/teams/${identity.teamId}${identity.projectId ? `/projects/${identity.projectId}` : ''}`
  if (/^\/(?:studio|image|video|agent|canvas|drama|tools|skills)(?:\/|$)/.test(pathname)) return workspaceHref(scope, '/studio')
  if (/^\/projects(?:\/|$)/.test(pathname)) return workspaceHref(scope, '/projects')
  if (pathname === '/assets') return workspaceHref(scope, '/assets')
  if (pathname === '/works' || pathname === '/tasks') return workspaceHref(scope, '/works')
  if (pathname === '/settings') return workspaceHref(scope, '/settings')
  if (pathname === '/account' || pathname === '/credits') return `/teams/${identity.teamId}?tab=usage`
  return pathname
}

/** Creation links carry the current team's server-authorized project scope. */
export function workspaceHref(pathname: string, target: string) {
  const match = teamPath.exec(pathname)
  if (!match) return target
  const team = `/teams/${match[1]}`, project = match[2] ? `${team}/projects/${match[2]}` : undefined
  if (['/studio', '/image', '/video', '/agent'].includes(target)) return project ? `${project}/canvas` : `${team}?tab=projects&intent=create`
  if (target === '/projects') return `${team}?tab=projects`
  if (target === '/assets') return project ? `${project}?tab=assets` : `${team}?tab=projects&intent=assets`
  if (target === '/works') return project ? `${project}?tab=generation` : `${team}?tab=projects&intent=history`
  if (target === '/settings') return `${team}?tab=settings`
  return target
}
