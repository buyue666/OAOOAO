'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { QrCode, RefreshCw } from 'lucide-react'
import { request, type WechatLoginSession } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { useWechatLogin } from '@/lib/studio/use-wechat-login'
import { ControlButton, SectionHeading, StatusBadge } from './ui'

type BindingStatus = { bound: boolean; available: boolean; appId: string; canBind: boolean }

/** Account-specific QR binding never infers identity from a nickname or email. */
export function AccountWechat() {
  const { state, refreshSession } = useStudio()
  const accountId = state.user.id
  const available = state.backendStatus === 'connected' && state.sessionSettings?.wechatLoginEnabled === true
  const [status, setStatus] = useState<{ accountId: string; value: BindingStatus } | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const scope = useRef({ accountId, available, version: 0 })
  if (scope.current.accountId !== accountId || scope.current.available !== available) scope.current = { accountId, available, version: scope.current.version + 1 }
  const revision = useRef(0)
  const visible = status?.accountId === accountId && available ? status.value : null
  const load = useCallback(async () => {
    if (!available) return
    const at = ++revision.current, epoch = scope.current.version
    const current = () => revision.current === at && scope.current.version === epoch
    setReading(true); setError(''); setStatus(null)
    try {
      const value = await request<BindingStatus>('/api/account/wechat-official')
      if (current()) setStatus({ accountId, value })
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : '微信绑定状态读取失败。') }
    finally { if (current()) setReading(false) }
  }, [accountId, available])
  useEffect(() => { setPassword(''); void load(); return () => { revision.current++ } }, [load])
  const qr = useWechatLogin({
    active: available && !!visible?.canBind && !visible.bound,
    scopeKey: accountId,
    expectedUserId: accountId,
    createSession: async () => {
      const submitted = password
      if (!submitted) throw new Error('请先填写当前账户密码。')
      setPassword('')
      return request<WechatLoginSession>('/api/account/wechat-official/bind-sessions', { method: 'POST', body: JSON.stringify({ password: submitted }) })
    },
    refreshSession,
    navigate: () => { void load() },
  })
  if (!available) return null
  async function begin(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await qr.begin('/settings') }
  return <section id="wechat-binding" className="studio-surface scroll-mt-20 p-5" aria-label="微信绑定">
    <SectionHeading title="微信登录与绑定" description="验证当前账户密码后，用自己的微信扫码绑定。后续可直接扫码登录这个账户。" />
    {reading ? <p role="status" className="mt-4 text-sm text-muted-foreground">正在读取微信绑定状态…</p> : visible?.bound ? <div className="mt-4 space-y-2"><StatusBadge tone="success">已绑定微信</StatusBadge><p className="text-xs leading-5 text-muted-foreground">微信扫码会登录当前账户，不会创建新账户。此处不提供自动替换或解除绑定。</p></div> : visible?.canBind ? <form onSubmit={begin} className="mt-4 space-y-4 border-t border-border pt-4">
      {qr.session ? <div className="space-y-3"><p role="status" className="text-sm">{qr.status === 'authorized' || qr.status === 'consumed' ? '正在确认绑定…' : qr.status === 'expired' ? '二维码已过期，请重新验证密码获取。' : '请用要绑定的微信扫描二维码'}</p><img src={qr.session.qrCodeUrl} width={224} height={224} alt="绑定当前账户的微信二维码" referrerPolicy="no-referrer" className="mx-auto size-56 max-w-full rounded-lg border border-border bg-white p-2 object-contain" /><ControlButton type="button" variant="secondary" onClick={qr.close} disabled={qr.loading}>关闭二维码</ControlButton></div> : <><label className="flex max-w-md flex-col gap-2 text-sm"><span>当前账户密码</span><input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={qr.loading} className="studio-field h-10 rounded-lg border border-border bg-background px-3 text-sm" /></label><ControlButton type="submit" variant="primary" disabled={!password || qr.loading}><QrCode className="size-4" />{qr.loading ? '正在验证…' : '验证密码并获取绑定二维码'}</ControlButton></>}
      <p className="text-xs leading-5 text-muted-foreground">绑定只关联当前账户；已绑定其他账户的微信不能合并或覆盖。密码仅用于本次服务端验证，不会保存在页面中。</p>
    </form> : visible ? <p className="mt-4 text-sm text-muted-foreground">微信绑定暂不可用，请稍后重新读取。</p> : null}
    {(error || qr.error) && <p role="alert" className="mt-3 text-sm text-destructive">{error || qr.error}</p>}
    {qr.retryable && <ControlButton type="button" variant="secondary" className="mt-3" disabled={qr.loading} onClick={() => void qr.retry()}>重试确认绑定</ControlButton>}
    {!qr.session && <ControlButton type="button" variant="ghost" size="sm" className="mt-3" disabled={reading || qr.loading} onClick={() => void load()}><RefreshCw className="size-3.5" />重新读取绑定状态</ControlButton>}
  </section>
}
