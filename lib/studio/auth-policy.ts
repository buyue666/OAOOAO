export type PolicyKind = 'terms' | 'privacy'
const authPaths = new Set(['/register', '/login', '/forgot-password'])

/** Only route context belongs in a policy URL, never form values or credentials. */
export function authPolicyReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return null
  try {
    const url = new URL(value, 'https://policy.invalid')
    if (url.origin !== 'https://policy.invalid' || !authPaths.has(url.pathname)) return null
    const query = new URLSearchParams()
    for (const key of ['mode', 'ref', 'next']) {
      const item = url.searchParams.get(key)
      if (item && item.length <= 2000) query.set(key, item)
    }
    return url.pathname + (query.size ? '?' + query : '')
  } catch { return null }
}

export function authPolicyReturnLabel(path: string) {
  const url = new URL(path, 'https://policy.invalid')
  return url.pathname === '/register' || url.searchParams.get('mode') === 'register' ? '返回注册' : url.pathname === '/forgot-password' || url.searchParams.get('mode') === 'reset' ? '返回找回密码' : '返回登录'
}

export function authPolicyLink(kind: PolicyKind, configured: unknown, returnPath: string, origin: string) {
  let url: URL
  try {
    const raw = typeof configured === 'string' ? configured.trim() : ''
    url = new URL(raw || '/' + kind, origin)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || raw.startsWith('//') || /[\\\u0000-\u001f]/.test(raw)) throw Error('Invalid policy link')
  } catch { url = new URL('/' + kind, origin) }
  const inline = url.origin === origin && url.pathname === '/' + kind
  if (inline) {
    const context = authPolicyReturnPath(returnPath)
    if (context) url.searchParams.set('returnTo', context)
    return { href: url.pathname + url.search + url.hash, inline: true }
  }
  return { href: url.href, inline: false }
}

type PolicyWindow = Pick<Window, 'history' | 'location' | 'addEventListener' | 'removeEventListener'>
/** Keep registration mounted; browser Back closes reading before leaving the form. */
export function createAuthPolicyNavigation(target: PolicyWindow, onChange: (kind: PolicyKind | null) => void) {
  const owner = 'policy-' + Math.random().toString(36).slice(2)
  let closing = false
  const ownEntry = () => {
    const entry = target.history.state?.oaoAuthPolicy
    return entry?.owner === owner && ['terms', 'privacy'].includes(entry.kind) ? entry : null
  }
  const onPop = () => { closing = false; onChange(ownEntry()?.kind ?? null) }
  target.addEventListener('popstate', onPop)
  return {
    open(kind: PolicyKind) {
      if (closing) return
      const previous = ownEntry()
      const state = { ...target.history.state, oaoAuthPolicy: { owner, kind, returnHash: previous?.returnHash ?? target.location.hash } }
      const href = target.location.pathname + target.location.search + '#policy-' + kind
      if (previous) target.history.replaceState(state, '', href)
      else target.history.pushState(state, '', href)
      onChange(kind)
    },
    close() {
      if (closing) return
      onChange(null)
      if (ownEntry()) { closing = true; target.history.back() }
    },
    dispose() { target.removeEventListener('popstate', onPop) },
  }
}
