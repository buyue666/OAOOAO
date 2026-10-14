import type { WechatLoginSession, WechatLoginStatus } from './api'

export type WechatLoginView = { session: WechatLoginSession | null; status: WechatLoginStatus['status']; loading: boolean; error: string; retryable: boolean }
type Dependencies = {
  active: () => boolean
  create: (returnTo: string, policyAccepted: boolean) => Promise<WechatLoginSession>
  read: (id: string) => Promise<WechatLoginStatus>
  consume: (id: string) => Promise<{ user: { id: string }; returnTo: string }>
  refresh: () => Promise<{ status: string }>
  navigate: (path: string) => void
  changed: (view: WechatLoginView) => void
}

export function safeLoginReturnPath(value: string | null | undefined) {
  return value?.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : '/studio'
}

/** One QR session owns all reads and its one-time exchange. Loading is never an effect dependency. */
export function createWechatLoginFlow(deps: Dependencies) {
  let version = 0, busy = false, reading = false, timer: ReturnType<typeof setTimeout> | undefined
  let exchanged: { user: { id: string }; returnTo: string } | undefined
  let view: WechatLoginView = { session: null, status: 'pending', loading: false, error: '', retryable: false }
  const publish = (patch: Partial<WechatLoginView>) => { view = { ...view, ...patch }; deps.changed(view) }
  const current = (revision: number) => version === revision && deps.active()
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const expired = () => !view.session || Date.parse(view.session.expiresAt) <= Date.now()
  const fail = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback

  async function exchange(revision: number) {
    const id = view.session?.sessionId
    if (!id || busy || !current(revision)) return
    busy = true; clearTimer(); publish({ loading: true, error: '', retryable: false })
    try {
      const result = exchanged ?? await deps.consume(id)
      if (!current(revision)) return
      exchanged = result
      publish({ status: 'consumed' })
      const session = await deps.refresh()
      if (!current(revision)) return
      if (session.status !== 'connected') {
        publish({ error: '微信验证已完成，账户状态暂未同步。请点击重试继续登录。', retryable: true })
        return
      }
      deps.navigate(safeLoginReturnPath(result.returnTo))
    } catch (reason) {
      if (current(revision)) publish({ error: fail(reason, '微信登录结果暂未确认，请重试。'), retryable: true })
    } finally {
      if (current(revision)) { busy = false; publish({ loading: false }) }
    }
  }

  async function poll(revision: number) {
    const id = view.session?.sessionId
    if (!id || reading || !current(revision)) return
    if (expired()) { publish({ status: 'expired', error: '', retryable: false }); return }
    reading = true
    try {
      const result = await deps.read(id)
      if (!current(revision)) return
      reading = false
      publish({ status: result.status, error: '', retryable: false })
      if (result.status === 'authorized' || result.status === 'consumed') { await exchange(revision); return }
      if (result.status !== 'pending') return
    } catch (reason) {
      if (!current(revision)) return
      publish({ error: fail(reason, '微信状态读取失败，请重试。'), retryable: true })
      return
    } finally { if (current(revision)) reading = false }
    if (current(revision)) timer = setTimeout(() => { timer = undefined; void poll(revision) }, Math.max(1, Math.min(2000, Date.parse(view.session!.expiresAt) - Date.now())))
  }

  return {
    snapshot: () => view,
    cancel() { version++; busy = false; reading = false; exchanged = undefined; clearTimer() },
    close() { version++; busy = false; reading = false; exchanged = undefined; clearTimer(); publish({ session: null, status: 'pending', loading: false, error: '', retryable: false }) },
    async begin(returnTo: string, policyAccepted = false) {
      if (!deps.active() || busy) return
      const revision = ++version; busy = true; reading = false; exchanged = undefined; clearTimer()
      publish({ session: null, status: 'pending', loading: true, error: '', retryable: false })
      try {
        const session = await deps.create(safeLoginReturnPath(returnTo), policyAccepted)
        if (!current(revision)) return
        if (!session.sessionId || !session.qrCodeUrl || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error('未返回有效的微信二维码，请重新获取。')
        publish({ session, loading: false })
        busy = false
        void poll(revision)
      } catch (reason) {
        if (current(revision)) publish({ error: fail(reason, '微信二维码生成失败，请重试。') })
      } finally { if (current(revision)) { busy = false; publish({ loading: false }) } }
    },
    async retry() {
      if (!deps.active() || busy || !view.session) return
      clearTimer()
      if (view.status === 'authorized' || view.status === 'consumed') await exchange(version)
      else await poll(version)
    },
  }
}
