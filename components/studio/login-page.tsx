'use client'

import { FormEvent, useEffect, useState } from 'react'
import { SiteBrand, useSiteBrand } from '@/components/site-brand'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, LockKeyhole, Mail, QrCode, Send, UserRound } from 'lucide-react'
import { login, StudioApiError } from '@/lib/studio/api'
import { useWechatLogin } from '@/lib/studio/use-wechat-login'
import { registerAccount, requestEmailCode, resetPasswordByEmail } from '@/lib/studio/account-api'
import { useStudio } from '@/lib/studio/store'
import { useLocale } from '@/lib/studio/i18n'
import { cn } from '@/lib/utils'
import { AuthBrandPanel } from './auth-brand-panel'
import { AuthField, AuthInput, AuthPasswordInput } from './auth-fields'
import { ControlButton, Notice } from './ui'

export type AuthMode = 'login' | 'register' | 'reset'

type FieldKey = 'username' | 'password' | 'totp' | 'email' | 'emailCode' | 'newPassword' | 'confirmPassword' | 'policy'
type FieldErrors = Partial<Record<FieldKey, string>>

const modePaths: Record<AuthMode, string> = { login: '/login', register: '/register', reset: '/forgot-password' }
const fieldIds: Record<FieldKey, string> = {
  username: 'auth-username',
  password: 'auth-password',
  totp: 'auth-totp',
  email: 'auth-email',
  emailCode: 'auth-email-code',
  newPassword: 'auth-new-password',
  confirmPassword: 'auth-confirm-password',
  policy: 'auth-policy',
}
const CODE_COOLDOWN_SECONDS = 60

function parseMode(value: string | null): AuthMode {
  if (value === 'register') return 'register'
  if (value === 'reset') return 'reset'
  return 'login'
}

/** 只允许站内相对路径作为登录后的跳转目标，防止开放重定向。 */
function safeNextPath(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/'
}

/** 条款与隐私政策可以是站内路径或 http(s) 外链；其他协议一律不渲染为链接。 */
function policyHref(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * 登录 / 注册 / 重置密码。
 *
 * 三个流程都调用真实后端接口，登录与注册成功后立即同步会话、模型目录与积分。
 * 错误优先显示在对应字段下方；只有无法归属到字段的失败才显示在表单顶部。
 */
export function LoginPage({ mode: routeMode }: { mode?: AuthMode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshSession, state } = useStudio()
  const { t } = useLocale()
  const brand = useSiteBrand()
  const [mode, setMode] = useState<AuthMode>(routeMode ?? parseMode(searchParams.get('mode')))
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const wechatLoginEnabled = state.sessionSettings?.wechatLoginEnabled === true
  const wechatRegistrationEnabled = state.sessionSettings?.wechatRegistrationEnabled === true
  const [wechatPolicyAccepted, setWechatPolicyAccepted] = useState(false)
  const termsHref = policyHref(state.sessionSettings?.site?.termsUrl)
  const privacyHref = policyHref(state.sessionSettings?.site?.privacyUrl)
  const wechat = useWechatLogin({ active: mode === 'login' && wechatLoginEnabled && status === 'idle', refreshSession, navigate: path => router.replace(path) })
  const { session: wechatSession, status: wechatStatus, loading: wechatLoading, error: wechatError } = wechat
  const busy = status !== 'idle' || wechatLoading

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function switchMode(next: AuthMode) {
    wechat.close()
    setMode(next)
    setFieldErrors({})
    setFormError('')
    setNotice('')
    setMfaRequired(false)
    setTotpCode('')
    setStatus('idle')
    setShowPassword(false)
    setShowNewPassword(false)
    setShowConfirmPassword(false)
    const query = new URLSearchParams(searchParams.toString())
    query.delete('mode')
    const suffix = query.toString()
    window.history.replaceState(null, '', `${modePaths[next]}${suffix ? `?${suffix}` : ''}`)
  }

  function closeWechatLogin() {
    wechat.close()
  }

  async function beginWechatLogin() {
    await wechat.begin(safeNextPath(searchParams.get('next')), wechatRegistrationEnabled && wechatPolicyAccepted)
  }

  async function sendCode(purpose: 'register' | 'password-reset') {
    if (!email.trim()) {
      setFieldErrors((current) => ({ ...current, email: '请先填写邮箱。' }))
      return
    }
    setSendingCode(true)
    setFieldErrors((current) => ({ ...current, emailCode: undefined }))
    setFormError('')
    setNotice('')
    try {
      await requestEmailCode({ purpose, email: email.trim() })
      setNotice(t('authEmailCodeRequested'))
      setCooldown(CODE_COOLDOWN_SECONDS)
    } catch (reason) {
      setFieldErrors((current) => ({ ...current, emailCode: reason instanceof Error ? reason.message : '验证码发送失败' }))
    } finally {
      setSendingCode(false)
    }
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (mode === 'login') {
      if (!username.trim()) errors.username = '请输入用户名或邮箱。'
      if (!password) errors.password = '请输入密码。'
      if (mfaRequired && !totpCode.trim()) errors.totp = '请输入管理员动态验证码。'
    } else if (mode === 'register') {
      if (!username.trim()) errors.username = '请输入用户名。'
      if (!email.trim()) errors.email = '注册必须填写邮箱地址。'
      if (!emailCode.trim()) errors.emailCode = '请先获取并填写邮箱验证码。'
      if (!password) errors.password = '请设置密码。'
      else if (password.length < 8) errors.password = '密码至少 8 位。'
      if (!policyAccepted) errors.policy = '请先同意服务条款与隐私政策。'
    } else {
      if (!email.trim()) errors.email = '请填写注册邮箱。'
      if (!emailCode.trim()) errors.emailCode = '请填写邮箱验证码。'
      if (!newPassword) errors.newPassword = '请设置新密码。'
      else if (newPassword.length < 8) errors.newPassword = '新密码至少 8 位。'
      if (newPassword && confirmPassword !== newPassword) errors.confirmPassword = '两次输入的新密码不一致。'
    }
    return errors
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status !== 'idle' || wechatLoading) return
    setFormError('')
    setNotice('')
    const errors = validate()
    setFieldErrors(errors)
    const firstInvalid = Object.keys(errors)[0] as FieldKey | undefined
    if (firstInvalid) {
      document.getElementById(fieldIds[firstInvalid])?.focus()
      return
    }

    wechat.close()
    setStatus('submitting')
    try {
      if (mode === 'login') {
        await login(username.trim(), password, mfaRequired ? totpCode.trim() : undefined)
        // 只 dispatch 用户不够：模型目录为空会让工作台继续显示演示模型与「本地预览」。
        await refreshSession()
        setStatus('success')
        router.replace(safeNextPath(searchParams.get('next')))
      } else if (mode === 'register') {
        await registerAccount({
          username: username.trim(),
          password,
          email: email.trim(),
          emailCode: emailCode.trim(),
          referralCode: referralCode.trim() || undefined,
          policyAccepted,
        })
        // 注册成功后直接登录，避免让用户重复输入一次密码。
        await login(username.trim(), password)
        await refreshSession()
        setStatus('success')
        router.replace('/')
      } else {
        await resetPasswordByEmail({ email: email.trim(), code: emailCode.trim(), newPassword })
        setPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setEmailCode('')
        setStatus('idle')
        switchMode('login')
        setNotice('密码已重置，请使用新密码登录。')
      }
    } catch (reason) {
      setStatus('idle')
      const payload = reason instanceof StudioApiError && reason.payload && typeof reason.payload === 'object' ? reason.payload as { mfaRequired?: unknown } : undefined
      if (mode === 'login' && reason instanceof StudioApiError && reason.status === 401 && payload?.mfaRequired === true) {
        setMfaRequired(true)
        setFieldErrors({ totp: '该管理员账号已启用动态安全验证，请输入验证码后再次登录。' })
        return
      }
      const message = reason instanceof Error ? reason.message : mode === 'login' ? '登录失败，请稍后重试。' : mode === 'register' ? '注册失败，请稍后重试。' : '密码重置失败，请稍后重试。'
      if (mode === 'login') {
        if (reason instanceof StudioApiError && reason.status === 401) setFieldErrors({ password: message })
        else setFormError(message)
      } else if (/验证码/.test(message)) {
        setFieldErrors({ emailCode: message })
      } else {
        setFormError(message)
      }
    }
  }

  const eyebrow = mode === 'login' ? '账户登录' : mode === 'register' ? '新用户注册' : '找回密码'
  const title = mode === 'login' ? '欢迎回来' : mode === 'register' ? '创建账户' : '重置密码'
  const description = mode === 'login' ? t('authLoginDescription').replace(/\bOAO\b/g, () => brand.title) : mode === 'register' ? t('authRegisterDescription') : t('authResetDescription')
  const submitLabel = mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '重置密码'
  const codePurpose = mode === 'register' ? 'register' : 'password-reset'
  const codeButtonLabel = sendingCode ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码'
  const codeDisabled = busy || sendingCode || cooldown > 0 || !email.trim()

  return (
    <main className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
      <AuthBrandPanel />

      <section className="flex min-h-dvh flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5 sm:px-10 lg:px-14">
          <SiteBrand className="shrink-0 lg:hidden" imageClassName="h-7" />
          <Link href="/" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
            <ArrowLeft className="size-4" aria-hidden="true" />返回首页
          </Link>
        </header>

        <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
          <div className="mx-auto flex w-full max-w-[400px] flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>

            {mode !== 'reset' && (
              <div role="tablist" aria-label="账户入口" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(['login', 'register'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    disabled={busy}
                    aria-selected={mode === item}
                    onClick={() => switchMode(item)}
                    className={cn(
                      'h-9 rounded-md text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                      mode === item ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {item === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-4 empty:hidden">
              {formError && <div role="alert"><Notice tone="danger"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{formError}</Notice></div>}
              {notice && <div role="status"><Notice tone="success"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{notice}</Notice></div>}
            </div>

            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              {mode !== 'reset' && (
                <AuthField id={fieldIds.username} label={mode === 'register' ? '用户名（登录名，注册后不可修改）' : '用户名或邮箱'} error={fieldErrors.username}>
                  <span className="relative block">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <AuthInput id={fieldIds.username} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} error={fieldErrors.username} className="pl-10" />
                  </span>
                </AuthField>
              )}

              {mode === 'login' && (
                <>
                  <AuthField id={fieldIds.password} label="密码" error={fieldErrors.password}>
                    <AuthPasswordInput id={fieldIds.password} autoComplete="current-password" value={password} visible={showPassword} onToggle={() => setShowPassword((value) => !value)} onChange={(event) => setPassword(event.target.value)} error={fieldErrors.password} />
                  </AuthField>
                  {mfaRequired && (
                    <AuthField id={fieldIds.totp} label="管理员动态验证码" error={fieldErrors.totp} hint={t('authMfaHelp')}>
                      <AuthInput id={fieldIds.totp} inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="请输入 6 位验证码" error={fieldErrors.totp} />
                    </AuthField>
                  )}
                </>
              )}

              {mode === 'register' && (
                <>
                  <AuthField id={fieldIds.email} label="邮箱（用于验证账号）" error={fieldErrors.email}>
                    <span className="relative block">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <AuthInput id={fieldIds.email} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={fieldErrors.email} className="pl-10" />
                    </span>
                  </AuthField>
                  <AuthField id={fieldIds.emailCode} label="邮箱验证码" error={fieldErrors.emailCode}>
                    <span className="flex gap-2">
                      <AuthInput id={fieldIds.emailCode} inputMode="numeric" autoComplete="one-time-code" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} error={fieldErrors.emailCode} className="min-w-0 flex-1" />
                      <ControlButton type="button" variant="secondary" className="h-11 shrink-0 px-3.5 disabled:opacity-60" onClick={() => void sendCode(codePurpose)} disabled={codeDisabled}>
                        <Send className="size-4" aria-hidden="true" />{codeButtonLabel}
                      </ControlButton>
                    </span>
                  </AuthField>
                  <AuthField id={fieldIds.password} label="密码（至少 8 位）" error={fieldErrors.password}>
                    <AuthPasswordInput id={fieldIds.password} autoComplete="new-password" value={password} visible={showPassword} onToggle={() => setShowPassword((value) => !value)} onChange={(event) => setPassword(event.target.value)} error={fieldErrors.password} />
                  </AuthField>
                  <AuthField id="auth-referral" label="邀请码（可选）">
                    <AuthInput id="auth-referral" value={referralCode} onChange={(event) => setReferralCode(event.target.value)} placeholder={t('authReferralPlaceholder')} />
                  </AuthField>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={fieldIds.policy} className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
                      <input id={fieldIds.policy} type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} aria-invalid={fieldErrors.policy ? true : undefined} className="mt-0.5 size-4 shrink-0 accent-studio-accent" />
                      <span>我已阅读并同意服务条款与隐私政策。</span>
                    </label>
                    {fieldErrors.policy && <p role="alert" className="text-xs leading-5 text-destructive">{fieldErrors.policy}</p>}
                  </div>
                </>
              )}

              {mode === 'reset' && (
                <>
                  <AuthField id={fieldIds.email} label="注册邮箱" error={fieldErrors.email}>
                    <span className="relative block">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <AuthInput id={fieldIds.email} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={fieldErrors.email} className="pl-10" />
                    </span>
                  </AuthField>
                  <AuthField id={fieldIds.emailCode} label="邮箱验证码" error={fieldErrors.emailCode}>
                    <span className="flex gap-2">
                      <AuthInput id={fieldIds.emailCode} inputMode="numeric" autoComplete="one-time-code" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} error={fieldErrors.emailCode} className="min-w-0 flex-1" />
                      <ControlButton type="button" variant="secondary" className="h-11 shrink-0 px-3.5 disabled:opacity-60" onClick={() => void sendCode(codePurpose)} disabled={codeDisabled}>
                        <Send className="size-4" aria-hidden="true" />{codeButtonLabel}
                      </ControlButton>
                    </span>
                  </AuthField>
                  <AuthField id={fieldIds.newPassword} label="新密码（至少 8 位）" error={fieldErrors.newPassword}>
                    <AuthPasswordInput id={fieldIds.newPassword} autoComplete="new-password" value={newPassword} visible={showNewPassword} onToggle={() => setShowNewPassword((value) => !value)} onChange={(event) => setNewPassword(event.target.value)} error={fieldErrors.newPassword} />
                  </AuthField>
                  <AuthField id={fieldIds.confirmPassword} label="确认新密码" error={fieldErrors.confirmPassword}>
                    <AuthPasswordInput id={fieldIds.confirmPassword} autoComplete="new-password" value={confirmPassword} visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((value) => !value)} onChange={(event) => setConfirmPassword(event.target.value)} error={fieldErrors.confirmPassword} />
                  </AuthField>
                </>
              )}

              <ControlButton type="submit" variant="primary" className="mt-2 h-11 w-full text-sm" disabled={busy} aria-busy={busy || undefined}>
                {status === 'success' ? (
                  <><CheckCircle2 className="size-4" aria-hidden="true" />登录成功，正在进入</>
                ) : status === 'submitting' ? (
                  <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在处理…</>
                ) : (
                  <>{submitLabel}<ArrowRight className="size-4" aria-hidden="true" /></>
                )}
              </ControlButton>
            </form>

            {mode === 'login' && wechatLoginEnabled && (
              <section aria-label="微信扫码登录" className="flex flex-col gap-4">
                {wechatRegistrationEnabled && <div className="text-xs leading-5 text-muted-foreground"><label className="flex items-start gap-2"><input type="checkbox" checked={wechatPolicyAccepted} onChange={event => setWechatPolicyAccepted(event.target.checked)} disabled={wechatLoading || !!wechatSession} className="mt-1" /><span>首次使用微信创建账号，我同意 <a href={termsHref || '/terms'} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">服务条款</a> 和 <a href={privacyHref || '/privacy'} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">隐私政策</a>。</span></label><p className="mt-1 pl-5">未勾选仍可登录已绑定账号。修改同意选项前，请先关闭当前二维码。</p></div>}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  <span>或使用微信登录</span>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>
                {!wechatSession ? (
                  <ControlButton type="button" variant="secondary" className="h-11 w-full text-sm" onClick={() => void beginWechatLogin()} disabled={busy || wechatLoading}>
                    <QrCode className="size-4" aria-hidden="true" />{wechatLoading ? '正在准备二维码…' : '微信扫码登录'}
                  </ControlButton>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4">
                    <div className="flex w-full items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">
                        {wechatStatus === 'pending' ? '请使用微信扫描二维码' : wechatStatus === 'authorized' || wechatStatus === 'consumed' ? '授权成功，正在登录…' : wechatStatus === 'unlinked' ? '该微信尚未关联账号' : '二维码已过期，请重新获取'}
                      </p>
                      <button type="button" onClick={closeWechatLogin} disabled={wechatLoading} className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">关闭</button>
                    </div>
                    <div className="flex size-44 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-2">
                      {wechatSession.qrCodeUrl && <img src={wechatSession.qrCodeUrl} alt="微信登录二维码" className="size-full object-contain" referrerPolicy="no-referrer" />}
                    </div>
                    {wechatStatus === 'unlinked' && <p className="text-center text-xs leading-5 text-muted-foreground">{t('authWechatUnlinked')}</p>}
                    {(wechatStatus === 'expired' || wechatStatus === 'unlinked') && (
                      <ControlButton type="button" variant="secondary" className="h-9 w-full text-sm" onClick={() => { closeWechatLogin(); void beginWechatLogin() }}>重新获取二维码</ControlButton>
                    )}
                  </div>
                )}
                {wechatError && <p role="alert" className="text-xs leading-5 text-destructive">{wechatError}</p>}
                {wechat.retryable && <ControlButton type="button" variant="secondary" disabled={wechatLoading} onClick={() => void wechat.retry()}>重试微信登录</ControlButton>}
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              {mode === 'login' && (
                <button type="button" onClick={() => switchMode('reset')} className="text-muted-foreground transition-colors hover:text-foreground hover:underline">忘记密码</button>
              )}
              {mode === 'register' && (
                <p className="text-muted-foreground">
                  已有账户？
                  <button type="button" onClick={() => switchMode('login')} className="ml-1 font-medium text-studio-accent transition-colors hover:underline">去登录</button>
                </p>
              )}
              {mode === 'reset' && (
                <button type="button" onClick={() => switchMode('login')} className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground hover:underline">
                  <ArrowLeft className="size-3.5" aria-hidden="true" />返回登录
                </button>
              )}
            </div>
          </div>
        </div>

        <footer className="px-5 pb-8 text-xs leading-5 text-muted-foreground sm:px-10 lg:px-14">
          <p className="mx-auto max-w-[420px]">
            继续即表示你同意
            {termsHref ? <> <a href={termsHref} className="underline underline-offset-2 hover:text-foreground">服务条款</a></> : ' 服务条款'}
            与
            {privacyHref ? <> <a href={privacyHref} className="underline underline-offset-2 hover:text-foreground">隐私政策</a></> : ' 隐私政策'}
            。
          </p>
        </footer>
      </section>
    </main>
  )
}
