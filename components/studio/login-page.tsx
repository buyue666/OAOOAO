'use client'

import { FormEvent, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Mail, Send, Sparkles, UserRound } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { login } from '@/lib/studio/api'
import { registerAccount, requestEmailCode, resetPasswordByEmail } from '@/lib/studio/account-api'
import { useStudio } from '@/lib/studio/store'
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
  const { refreshSession } = useStudio()
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
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setNotice('')
  }

  async function sendCode(purpose: 'register' | 'password-reset') {
    if (!email.trim()) { setError('请先填写邮箱。'); return }
    setLoading(true); setError(''); setNotice('')
    try {
      await requestEmailCode({ purpose, email: email.trim() })
      // 后端不会把验证码回传给浏览器；这里只说明请求已发出，不声称邮箱已验证。
      setNotice('验证码发送请求已提交。若站点未配置邮件服务，请联系管理员获取验证码。')
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
    } else if (mode === 'register') {
      if (!username.trim() || !password) { setError('请输入用户名和密码。'); return }
      if (password.length < 8) { setError('密码至少 8 位。'); return }
      if (!policyAccepted) { setError('请先同意服务条款与隐私政策。'); return }
    } else {
      if (!email.trim() || !emailCode.trim() || !newPassword) { setError('请填写邮箱、验证码和新密码。'); return }
      if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致。'); return }
      if (newPassword.length < 8) { setError('新密码至少 8 位。'); return }
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        await login(username.trim(), password, totpCode.trim() || undefined)
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
      setError(reason instanceof Error ? reason.message : mode === 'login' ? '登录失败，请稍后重试。' : mode === 'register' ? '注册失败，请稍后重试。' : '密码重置失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  const title = mode === 'login' ? '登录' : mode === 'register' ? '创建账户' : '重置密码'
  const description = mode === 'login'
    ? '登录后可同步画布、套餐、订单和积分。'
    : mode === 'register'
      ? '注册后即可使用真实模型生成，并获得新用户额度（以服务端配置为准）。'
      : '通过邮箱验证码重置密码。验证码由服务端校验，前端不会跳过验证。'

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-foreground">
      <section className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-studio-accent text-studio-accent-foreground"><Sparkles className="size-5" /></span>
          <div><p className="text-lg font-semibold">OAOOAO Studio</p><p className="text-xs text-muted-foreground">连接你的真实创作账户</p></div>
        </div>
        <div className="studio-surface p-6 sm:p-8">
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
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">密码</span>
                  <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">管理员 MFA（如启用）</span>
                  <input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="可留空" className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </label>
              </>
            )}

            {mode === 'register' && (
              <>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">密码（至少 8 位）</span>
                  <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">邀请码（可选）</span>
                  <input value={referralCode} onChange={(event) => setReferralCode(event.target.value)} placeholder="填写后奖励由服务端结算" className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </label>
              </>
            )}

            {(mode === 'register' || mode === 'reset') && (
              <>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">邮箱{mode === 'register' ? '（可选，填写后需验证码）' : ''}</span>
                  <span className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="studio-field h-11 w-full border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                  </span>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">邮箱验证码</span>
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
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">新密码（至少 8 位）</span>
                  <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium">确认新密码</span>
                  <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="studio-field h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
                </label>
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
        <p className="mt-4 text-center text-xs text-muted-foreground">未配置后端时仍可浏览本地预览；真实数据需要登录。</p>
      </section>
    </main>
  )
}
