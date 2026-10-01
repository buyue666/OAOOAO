'use client'

import { FormEvent, useState, type ChangeEvent } from 'react'
import { useEffect } from 'react'
import Image from 'next/image'
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, QrCode, Send, UserRound } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { consumeWechatLoginSession, createWechatLoginSession, getWechatLoginStatus, login, StudioApiError, type WechatLoginSession, type WechatLoginStatus } from '@/lib/studio/api'
import { registerAccount, requestEmailCode, resetPasswordByEmail } from '@/lib/studio/account-api'
import { useStudio } from '@/lib/studio/store'
import { useLocale } from '@/lib/studio/i18n'
import { ControlButton, Notice } from './ui'

type Mode = 'login' | 'register' | 'reset'

/**
 * 登录 / 注册 / 重置密码。
 *
 * 三个流程都调用真实后端接口：
 * - 登录成功后立即同步会话、模型目录与积分，客户端导航不再需要整页刷新；
 * - 注册使用后端注册开关与邀请码；
 * - 重置密码必须通过邮箱验证码，前端不会伪造「已验证」。
 */
export function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshSession, state } = useStudio()
  const { t } = useLocale()
  const initialMode: Mode = searchParams.get('mode') === 'reset' ? 'reset' : searchParams.get('mode') === 'register' ? 'register' : 'login'
  const [mode, setMode] = useState<Mode>(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [email, setEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [referralCode, setReferralCode] = useState(searchParams.get('ref') ?? '')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [mfaRequired, setMfaRequired] = useState(false)
  const wechatLoginEnabled = state.sessionSettings?.wechatLoginEnabled === true
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [wechatSession, setWechatSession] = useState<WechatLoginSession | null>(null)
  const [wechatStatus, setWechatStatus] = useState<WechatLoginStatus['status']>('pending')
  const [wechatLoading, setWechatLoading] = useState(false)
  const [wechatError, setWechatError] = useState('')

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setNotice('')
    setMfaRequired(false)
    setTotpCode('')
    setShowPassword(false)
    setShowNewPassword(false)
    setShowConfirmPassword(false)
  }

  function closeWechatLogin() {
    if (wechatLoading) return
    setWechatSession(null)
    setWechatStatus('pending')
    setWechatError('')
  }

  async function beginWechatLogin() {
    setWechatError('')
    setWechatLoading(true)
    try {
      const next = searchParams.get('next')
      const result = await createWechatLoginSession(next?.startsWith('/') && !next.startsWith('//') ? next : '/')
      setWechatSession(result)
      setWechatStatus('pending')
    } catch (reason) {
      setWechatError(reason instanceof StudioApiError && reason.status === 501 ? '微信扫码登录尚未开启，请使用账号密码登录。' : reason instanceof Error ? reason.message : '微信二维码生成失败')
    } finally {
      setWechatLoading(false)
    }
  }

  useEffect(() => {
    if (mode !== 'login' || !wechatSession || wechatStatus !== 'pending') return
    let active = true
    const poll = async () => {
      try {
        const result = await getWechatLoginStatus(wechatSession.sessionId)
        if (active) setWechatStatus(result.status)
      } catch (reason) {
        if (active) setWechatError(reason instanceof Error ? reason.message : '微信登录状态读取失败')
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [mode, wechatSession, wechatStatus])

  useEffect(() => {
    if (mode !== 'login' || !wechatSession || wechatStatus !== 'authorized' || wechatLoading) return
    let active = true
    setWechatLoading(true)
    void consumeWechatLoginSession(wechatSession.sessionId)
      .then(async (result) => {
        if (!active) return
        setWechatStatus('consumed')
        await refreshSession()
        const target = result.returnTo?.startsWith('/') && !result.returnTo.startsWith('//') && !result.returnTo.includes('\\') ? result.returnTo : '/'
        router.replace(target)
      })
      .catch((reason) => { if (active) setWechatError(reason instanceof Error ? reason.message : '微信登录失败') })
      .finally(() => { if (active) setWechatLoading(false) })
    return () => { active = false }
  }, [mode, refreshSession, router, wechatLoading, wechatSession, wechatStatus])

  async function sendCode(purpose: 'register' | 'password-reset') {
    if (!email.trim()) { setError('请先填写邮箱。'); return }
    setLoading(true); setError(''); setNotice('')
    try {
      await requestEmailCode({ purpose, email: email.trim() })
      setNotice(t('authEmailCodeRequested'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码发送失败')
    } finally {
      setLoading(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(''); setNotice('')
    if (mode === 'login') {
      if (!username.trim() || !password) { setError('请输入用户名和密码。'); return }
      if (mfaRequired && !totpCode.trim()) { setError('请输入管理员动态验证码。'); return }
    } else if (mode === 'register') {
      if (!username.trim() || !password) { setError('请输入用户名和密码。'); return }
      if (password.length < 8) { setError('密码至少 8 位。'); return }
      if (!policyAccepted) { setError('请先同意服务条款与隐私政策。'); return }
      if (!email.trim()) { setError('注册必须填写邮箱地址。'); return }
      if (!emailCode.trim()) { setError('请先获取并填写邮箱验证码。'); return }
    } else {
      if (!email.trim() || !emailCode.trim() || !newPassword) { setError('请填写邮箱、验证码和新密码。'); return }
      if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致。'); return }
      if (newPassword.length < 8) { setError('新密码至少 8 位。'); return }
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        await login(username.trim(), password, mfaRequired ? totpCode.trim() : undefined)
        // 登录成功后立即在客户端同步会话、模型目录与积分。
        // 只 dispatch 用户不够：模型目录为空会让工作台继续显示演示模型与「本地预览」。
        await refreshSession()
        const next = searchParams.get('next')
        router.replace(next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/')
      } else if (mode === 'register') {
        await registerAccount({
          username: username.trim(),
          password,
          email: email.trim() || undefined,
          emailCode: email.trim() ? emailCode.trim() || undefined : undefined,
          referralCode: referralCode.trim() || undefined,
          policyAccepted,
        })
        // 注册成功后直接登录，避免让用户重复输入一次密码。
        await login(username.trim(), password)
        await refreshSession()
        router.replace('/')
      } else {
        await resetPasswordByEmail({ email: email.trim(), code: emailCode.trim(), newPassword })
        setNotice('密码已重置，请使用新密码登录。')
        setPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setEmailCode('')
        setMode('login')
      }
    } catch (reason) {
      const payload = reason instanceof StudioApiError && reason.payload && typeof reason.payload === 'object' ? reason.payload as { mfaRequired?: unknown } : undefined
      if (mode === 'login' && reason instanceof StudioApiError && reason.status === 401 && payload?.mfaRequired === true) {
        setMfaRequired(true)
        setError('该管理员账号已启用动态安全验证，请输入验证码后再次登录。')
        return
      }
      setError(reason instanceof Error ? reason.message : mode === 'login' ? '登录失败，请稍后重试。' : mode === 'register' ? '注册失败，请稍后重试。' : '密码重置失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  const title = mode === 'login' ? '登录' : mode === 'register' ? '创建账户' : '重置密码'
  const description = mode === 'login'
    ? t('authLoginDescription')
    : mode === 'register'
      ? t('authRegisterDescription')
      : t('authResetDescription')

  return (
    <main className="oao-auth-page flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-foreground">
      {/* 登录页背景光晕：纯装饰层，不参与布局。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-0"
        style={{ background: 'radial-gradient(760px 420px at 50% -10%, color-mix(in srgb, var(--studio-accent) 10%, transparent), transparent 70%)' }}
      />
      <section className="relative w-full max-w-md">
        <div className="mb-8 flex items-center gap-4">
          <Image src="/media/brand/oao-logo-transparent.png" alt="OAO" width={126} height={30} priority className="h-8 w-auto max-w-[150px] dark:invert" />
        </div>
        <div className="lg-glass motion-panel p-6 sm:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          {error && <Notice tone="warning"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />{error}</Notice>}
          {notice && <Notice tone="accent"><Check className="mt-0.5 size-3.5 shrink-0" />{notice}</Notice>}

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            {mode !== 'reset' && (
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium">用户名{mode === 'register' ? '（登录名，注册后不可修改）' : '或邮箱'}</span>
                <span className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="studio-field h-11 w-full border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </span>
              </label>
            )}

            {mode === 'login' && (
              <>
                <PasswordField label="密码" autoComplete="current-password" value={password} visible={showPassword} onChange={(event) => setPassword(event.target.value)} onToggle={() => setShowPassword((value) => !value)} />
                {mfaRequired && <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">管理员动态验证码</span>
                  <input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="请输入 6 位验证码" className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                  <span className="text-[11px] leading-5 text-muted-foreground">{t('authMfaHelp')}</span>
                </label>}
              </>
            )}

            {mode === 'register' && (
              <>
                <PasswordField label="密码（至少 8 位）" autoComplete="new-password" value={password} visible={showPassword} onChange={(event) => setPassword(event.target.value)} onToggle={() => setShowPassword((value) => !value)} />
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">邀请码（可选）</span>
                  <input value={referralCode} onChange={(event) => setReferralCode(event.target.value)} placeholder={t('authReferralPlaceholder')} className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </label>
              </>
            )}

            {(mode === 'register' || mode === 'reset') && (
              <>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">邮箱{mode === 'register' ? '（必填，用于验证账号）' : ''}</span>
                  <span className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="studio-field h-11 w-full border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                  </span>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">邮箱验证码{mode === 'register' ? '（必填）' : ''}</span>
                  <span className="flex gap-2">
                    <input inputMode="numeric" autoComplete="one-time-code" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} className="studio-field h-11 min-w-0 flex-1 border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                    <ControlButton type="button" variant="secondary" className="h-11 shrink-0" onClick={() => void sendCode(mode === 'register' ? 'register' : 'password-reset')} disabled={loading || !email.trim()}>
                      <Send className="size-4" />获取验证码
                    </ControlButton>
                  </span>
                </label>
              </>
            )}

            {mode === 'reset' && (
              <>
                <PasswordField label="新密码（至少 8 位）" autoComplete="new-password" value={newPassword} visible={showNewPassword} onChange={(event) => setNewPassword(event.target.value)} onToggle={() => setShowNewPassword((value) => !value)} />
                <PasswordField label="确认新密码" autoComplete="new-password" value={confirmPassword} visible={showConfirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onToggle={() => setShowConfirmPassword((value) => !value)} />
              </>
            )}

            {mode === 'register' && (
              <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <input type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-studio-accent" />
                <span>我已阅读并同意服务条款与隐私政策。</span>
              </label>
            )}

            <ControlButton type="submit" variant="primary" className="mt-2 h-11 w-full" disabled={loading}>
              {loading ? '正在处理…' : mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '重置密码'}
              {!loading && <ArrowRight className="size-4" />}
            </ControlButton>
          </form>

          {mode === 'login' && wechatLoginEnabled && (
            <div className="mt-5 border-t border-border pt-5">
              {!wechatSession ? (
                <ControlButton type="button" variant="secondary" className="h-11 w-full" onClick={() => void beginWechatLogin()} disabled={loading || wechatLoading}>
                  <QrCode className="size-4" />{wechatLoading ? '正在准备二维码…' : '微信扫码登录'}
                </ControlButton>
              ) : (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">微信扫码登录</p><p className="mt-1 text-xs text-muted-foreground">{wechatStatus === 'pending' ? '请使用微信扫描二维码' : wechatStatus === 'authorized' || wechatStatus === 'consumed' ? '授权成功，正在登录…' : wechatStatus === 'unlinked' ? '该微信尚未关联账号' : '二维码已过期，请重新获取'}</p></div><button type="button" onClick={closeWechatLogin} className="text-xs text-muted-foreground hover:text-foreground" disabled={wechatLoading}>关闭</button></div>
                  <div className="mx-auto mt-4 flex size-56 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2">{wechatSession.qrCodeUrl && <img src={wechatSession.qrCodeUrl} alt="微信登录二维码" className="size-full object-contain" referrerPolicy="no-referrer" />}</div>
                  {wechatStatus === 'unlinked' && <p className="mt-3 text-center text-xs text-muted-foreground">{t('authWechatUnlinked')}</p>}
                  {wechatStatus === 'expired' && <ControlButton type="button" variant="secondary" className="mt-3 h-9 w-full" onClick={() => { closeWechatLogin(); void beginWechatLogin() }}>重新获取二维码</ControlButton>}
                  {wechatError && <p role="alert" className="mt-3 text-xs text-destructive">{wechatError}</p>}
                </div>
              )}
              {wechatError && !wechatSession && <p role="alert" className="mt-2 text-xs text-destructive">{wechatError}</p>}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs">
            {mode === 'login' ? (
              <>
                <button type="button" onClick={() => switchMode('register')} className="text-studio-accent hover:underline">注册新账户</button>
                <button type="button" onClick={() => switchMode('reset')} className="text-muted-foreground hover:text-foreground hover:underline">忘记密码</button>
              </>
            ) : (
              <button type="button" onClick={() => switchMode('login')} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
                <ArrowLeft className="size-3.5" />返回登录
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function PasswordField({
  label,
  autoComplete,
  value,
  visible,
  onChange,
  onToggle,
}: {
  label: string
  autoComplete: string
  value: string
  visible: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onToggle: () => void
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-medium">{label}</span>
      <span className="relative">
        <input type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} className="studio-field h-11 w-full border border-border bg-background px-3 pr-11 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
        <button type="button" onClick={onToggle} aria-label={visible ? '隐藏密码' : '显示密码'} title={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/50">
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </span>
    </label>
  )
}
