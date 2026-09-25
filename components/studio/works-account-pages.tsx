'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Check, CircleDollarSign, Clock3, Copy, CreditCard, Download, ExternalLink, FolderPlus, Image as ImageIcon, KeyRound, Link2, Loader2, LockKeyhole, Mail, Package, Palette, Pencil, RefreshCw, Send, ShieldCheck, Sparkles, UserRound, Users, Video, WandSparkles } from 'lucide-react'
import { ControlButton, KeyValue, MediaThumb, Modal, Notice, PageHeader, SectionHeading, SegmentedControl, StatusBadge } from './ui'
import { useStudio } from '@/lib/studio/store'
import { moneyLabel, StudioApiError } from '@/lib/studio/api'
import {
  cancelAccountOrder,
  currentLedgerMonth,
  ledgerCategoryLabels,
  ledgerCategoryOf,
  listPointRecords,
  requestEmailCode,
  resetPasswordByEmail,
  resumeCheckout,
  summarizeLedgerMonth,
  updatePassword,
  updateProfile,
  type PointRecord,
} from '@/lib/studio/account-api'
import { useLedgerSummary, useReferralCenter, useServerOrders, useServerWorks } from '@/lib/studio/use-account-data'
import type { StudioWork } from '@/lib/studio/account-api'
import type { StudioSkin } from '@/lib/studio/types'
import { cn } from '@/lib/utils'

/* ------------------------------- 我的作品 ------------------------------- */

/**
 * 作品页。
 *
 * 早先这里读的是 `state.works`（本地演示数据），所以后端已有 60 条成功记录时
 * 「我的作品」仍然显示 0。现在作品直接来自后端生成记录里带结果资产的条目，
 * 刷新、重新登录、换浏览器都能恢复；本地缓存只用于加速，不作为索引。
 */
export function WorksPage() {
  const { works, total, truncated, state, message, reload } = useServerWorks()
  const [filter, setFilter] = useState('全部')
  const [loading, setLoading] = useState(false)
  const visible = useMemo(() => (filter === '全部' ? works : works.filter((work) => work.kind === filter)), [filter, works])

  if (state === 'unauthenticated') {
    return (
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
        <PageHeader eyebrow="作品" title="我的作品" description="生成结果、项目关系和发布状态都在这里继续管理。" />
        <Notice tone="warning">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">登录后才会显示属于你的作品。未登录时不会用演示数据填充。</span>
          <Link href="/login?next=/works" className="shrink-0 text-[11px] underline">前往登录</Link>
        </Notice>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
      <PageHeader
        eyebrow="作品"
        title="我的作品"
        description="结果来自后端生成记录中成功且带结果资产的任务。"
        actions={(
          <>
            <ControlButton variant="secondary" onClick={() => { setLoading(true); void reload().finally(() => setLoading(false)) }} disabled={loading || state === 'loading'}>
              <RefreshCw className={cn('size-4', (loading || state === 'loading') && 'animate-spin')} />刷新
            </ControlButton>
            <Link href="/image" className="inline-flex h-9 items-center gap-2 rounded-lg border border-studio-accent bg-studio-accent px-3 text-sm font-medium text-studio-accent-foreground hover:bg-studio-accent/85"><Sparkles className="size-4" />开始新创作</Link>
          </>
        )}
      />
      {message && <Notice tone="warning">{message}</Notice>}
      {truncated && <Notice tone="neutral">记录较多，当前只读取了最近一批结果。继续翻页会加载更多。</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <SegmentedControl value={filter} onChange={setFilter} options={[{ value: '全部', label: '全部' }, { value: 'image', label: '图片', icon: <ImageIcon className="size-3.5" /> }, { value: 'video', label: '视频', icon: <Video className="size-3.5" /> }]} />
        <span className="text-xs text-muted-foreground">{state === 'loading' ? '正在读取…' : `${visible.length} 件作品`}</span>
      </div>
      {state === 'loading' && !works.length ? (
        <div className="studio-surface flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />正在读取后端生成结果
        </div>
      ) : state === 'error' && !works.length ? (
        <Notice tone="warning">
          <span className="min-w-0 flex-1">作品暂时无法读取：{message}</span>
          <button type="button" onClick={() => void reload()} className="shrink-0 text-[11px] underline">重试</button>
        </Notice>
      ) : visible.length === 0 ? (
        <div className="studio-surface flex flex-col items-center gap-2 border-dashed py-12 text-center">
          <p className="text-sm font-medium">还没有生成成功的作品</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">在图片或视频工作台提交生成后，成功的结果会自动出现在这里。后端记录共 {total} 条。</p>
          <Link href="/image" className="mt-2 text-xs text-studio-accent underline">前往图片工作台</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((work) => <WorkCard key={work.id} work={work} />)}
        </div>
      )}
    </div>
  )
}

/** 作品卡片：支持预览、下载、复用参数、发送到画布、加入项目。 */
function WorkCard({ work }: { work: StudioWork }) {
  const { state, dispatch } = useStudio()
  const [preview, setPreview] = useState(false)
  const [notice, setNotice] = useState('')
  const ratio = work.kind === 'video' ? '16:9' : '1:1'

  function download() {
    if (!work.src) return
    const anchor = document.createElement('a')
    anchor.href = work.src
    anchor.download = `${work.title || 'oaooao-result'}.${work.kind === 'video' ? 'mp4' : 'png'}`
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  /** 复用参数：把结果带回工作台，由工作台继续用同一组参数创作。 */
  function reuseParams() {
    try {
      window.localStorage.setItem('oaooao-reuse-params', JSON.stringify({
        kind: work.kind,
        prompt: work.prompt,
        model: work.model,
        taskId: work.taskId ?? work.id,
        createdAt: Date.now(),
      }))
    } catch {
      // 存储不可用时仍可跳转工作台，只是不能预填参数。
    }
  }

  /** 发送到画布：写入待接收的结果，画布页读取后作为节点插入。 */
  function sendToCanvas() {
    try {
      const key = 'oaooao-canvas-handoff'
      const existing = JSON.parse(window.localStorage.getItem(key) || '[]')
      const list = Array.isArray(existing) ? existing : []
      const entry = { id: work.id, kind: work.kind, title: work.title, src: work.src, poster: work.poster, prompt: work.prompt, model: work.model }
      window.localStorage.setItem(key, JSON.stringify([entry, ...list.filter((item: { id?: string }) => item?.id !== work.id)].slice(0, 40)))
      setNotice('已发送到画布，打开画布即可插入该结果。')
    } catch {
      setNotice('浏览器存储不可用，无法发送到画布。')
    }
  }

  /** 加入项目：把结果登记为当前选中项目的素材。 */
  function addToProject() {
    const projectId = state.selectedProjectId
    const project = state.projects.find((item) => item.id === projectId)
    if (!project) {
      setNotice('当前没有可用项目，请先在项目页创建或选择项目。')
      return
    }
    dispatch({
      type: 'ADD_WORK_TO_PROJECT',
      projectId,
      work: {
        id: `work-${work.id}`,
        kind: work.kind === 'video' ? 'video' : 'image',
        title: work.title,
        src: work.src,
        poster: work.poster,
        fallback: work.fallback,
        tags: ['来自作品'],
        size: '',
        status: '可用',
        projectIds: [projectId],
        referencedBy: [],
        createdAt: new Date().toISOString(),
      },
    })
    setNotice(`已加入项目「${project.title}」。`)
  }

  return (
    <article className="studio-surface studio-surface-interactive group overflow-hidden">
      <MediaThumb
        src={work.src}
        poster={work.poster}
        kind={work.kind === 'video' ? 'video' : 'image'}
        alt={work.title}
        fallback={work.fallback}
        className="aspect-[4/3]"
        overlay={<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-studio-ink/80 to-transparent px-3 pb-2.5 pt-8"><StatusBadge solid tone="success">已完成</StatusBadge><span className="text-[10px] text-studio-ink-muted">{ratio}</span></div>}
      />
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-foreground" title={work.title}>{work.title}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{work.model || '未记录模型'}{work.createdAt ? ` · ${new Date(work.createdAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ControlButton variant="secondary" size="sm" onClick={() => setPreview(true)}><ExternalLink className="size-3.5" />预览</ControlButton>
          <ControlButton variant="ghost" size="sm" onClick={download}><Download className="size-3.5" />下载</ControlButton>
          <Link href={work.kind === 'video' ? '/video' : '/image'} onClick={reuseParams} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Copy className="size-3.5" />复用参数</Link>
          <ControlButton variant="ghost" size="sm" onClick={sendToCanvas}><WandSparkles className="size-3.5" />发到画布</ControlButton>
          <ControlButton variant="ghost" size="sm" onClick={addToProject}><FolderPlus className="size-3.5" />加入项目</ControlButton>
        </div>
        {notice && <p className="mt-2 text-[11px] text-studio-accent" aria-live="polite">{notice}</p>}
      </div>
      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title={work.title}
        description={`生成于 ${work.createdAt ? new Date(work.createdAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间'}${work.durationMs ? ` · 耗时 ${Math.round(work.durationMs / 1000)} 秒` : ''}`}
        footer={(
          <>
            <ControlButton variant="ghost" onClick={() => setPreview(false)}>关闭</ControlButton>
            <ControlButton variant="secondary" onClick={download}><Download className="size-3.5" />下载原文件</ControlButton>
            <Link href={work.kind === 'video' ? '/video' : '/image'} onClick={reuseParams} className="inline-flex h-9 items-center gap-2 rounded-lg border border-studio-accent bg-studio-accent px-3 text-sm font-medium text-studio-accent-foreground hover:bg-studio-accent/85"><Copy className="size-4" />复用这组参数</Link>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <MediaThumb src={work.src} poster={work.poster} kind={work.kind === 'video' ? 'video' : 'image'} alt={work.title} fallback={work.fallback} className="aspect-video" />
          {work.prompt && <div><p className="text-xs font-medium text-muted-foreground">创作提示词</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{work.prompt}</p></div>}
          <div className="border-y border-border">
            <KeyValue label="模型" value={work.model || '未记录'} />
            <KeyValue label="类型" value={work.kind === 'video' ? '视频' : work.kind === 'audio' ? '音频' : '图片'} />
            <KeyValue label="任务 ID" value={<span className="font-mono text-[11px]">{work.taskId ?? work.id}</span>} />
          </div>
          <Notice tone="neutral"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />结果地址由后端按账户归属校验，其他账号无法访问。</Notice>
        </div>
      </Modal>
    </article>
  )
}

/* --------------------------------- 广场 --------------------------------- */

/** 广场读取公开作品接口，不再复用我的私有作品列表。 */
export function GalleryPage() {
  const { state } = useStudio()
  const [filter, setFilter] = useState('精选')
  const [items, setItems] = useState<Array<{ id: string; title: string; src?: string; kind: string; author?: string }>>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [active, setActive] = useState<{ id: string; title: string; src?: string; kind: string } | null>(null)

  useEffect(() => {
    let active_ = true
    setLoadState('loading')
    // 公开接口不需要登录；失败时明确说明，不用私有作品冒充公开内容。
    fetch('/api/public/works?page=1&pageSize=24', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.msg || payload?.error || `请求失败（${response.status}）`)
        return payload
      })
      .then((payload) => {
        if (!active_) return
        const raw = payload?.data?.works ?? payload?.data?.items ?? payload?.works ?? payload?.items ?? []
        const list = Array.isArray(raw) ? raw : []
        setItems(list.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? item.slug ?? ''),
          title: String(item.title ?? '未命名作品'),
          src: typeof item.coverUrl === 'string' ? item.coverUrl : typeof item.mediaUrl === 'string' ? item.mediaUrl : undefined,
          kind: String(item.kind ?? 'image'),
          author: typeof item.authorName === 'string' ? item.authorName : undefined,
        })).filter((item: { id: string }) => item.id))
        setLoadState('ready')
      })
      .catch((reason) => {
        if (!active_) return
        setMessage(reason instanceof Error ? reason.message : '公开作品加载失败')
        setLoadState('error')
      })
    return () => { active_ = false }
  }, [])

  const gallery = filter === '全部' ? items : items.filter((item) => filter === '精选' ? true : item.kind === filter)

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
      <PageHeader eyebrow="发现" title="广场" description="浏览 OAOOAO 社区中的公开作品。" actions={<SegmentedControl value={filter} onChange={setFilter} options={[{ value: '精选', label: '精选' }, { value: '全部', label: '全部' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }]} />} />
      {message && <Notice tone="warning">{message}</Notice>}
      {loadState === 'loading' ? (
        <div className="studio-surface flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />正在读取公开作品</div>
      ) : gallery.length === 0 ? (
        <div className="studio-surface flex flex-col items-center gap-2 border-dashed py-12 text-center">
          <p className="text-sm font-medium">{loadState === 'error' ? '公开作品暂时无法读取' : '还没有公开作品'}</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">{loadState === 'error' ? '接口不可用时不会用本地演示作品填充广场。' : '作品被发布后才会出现在这里。'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {gallery.map((work, index) => (
            <button type="button" key={work.id} onClick={() => setActive(work)} className="group text-left">
              <MediaThumb src={work.src} kind={work.kind === 'video' ? 'video' : 'image'} alt={work.title} fallback={work.title} className={index % 5 === 0 ? 'aspect-[4/5]' : 'aspect-[4/3]'} />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">{work.author || '匿名作者'}</span>
                <span className="text-[10px] text-muted-foreground">{work.kind === 'video' ? '视频' : '图片'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      <Modal open={Boolean(active)} onClose={() => setActive(null)} title={active?.title ?? '作品详情'} description="公开作品预览" footer={<ControlButton variant="ghost" onClick={() => setActive(null)}>关闭</ControlButton>}>
        <MediaThumb src={active?.src} kind={active?.kind === 'video' ? 'video' : 'image'} alt={active?.title ?? '作品'} fallback={active?.title ?? '作品'} className="aspect-video" />
      </Modal>
      {state.backendStatus !== 'connected' && <Notice tone="neutral">未登录也可以浏览公开作品；发布与互动需要登录。</Notice>}
    </div>
  )
}

/* ------------------------------- 账户页面 ------------------------------- */

export function AccountPage() {
  const { state } = useStudio()
  const [tab, setTab] = useState('profile')
  const [notice, setNotice] = useState('')
  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
      <PageHeader eyebrow="账户" title="账户与套餐" description="管理个人信息、安全、积分和消费记录。" actions={<Link href="/plans" className="inline-flex h-9 items-center gap-2 rounded-lg border border-studio-accent bg-studio-accent px-3 text-sm font-medium text-studio-accent-foreground hover:bg-studio-accent/85"><CircleDollarSign className="size-4" />购买套餐</Link>} />
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {[{ id: 'profile', label: '资料与安全', icon: UserRound }, { id: 'credits', label: '积分与消费', icon: CircleDollarSign }, { id: 'orders', label: '订单记录', icon: Package }, { id: 'invite', label: '邀请好友', icon: Users }].map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} onClick={() => setTab(id)} className={tab === id ? 'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-studio-accent/12 px-3 text-left text-xs font-medium text-studio-accent lg:w-full' : 'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground lg:w-full'}><Icon className="size-4" />{label}</button>
          ))}
        </nav>
        <section className="min-w-0">
          {tab === 'profile' && <ProfilePanel state={state} onNotice={setNotice} />}
          {tab === 'credits' && <CreditsPanel state={state} />}
          {tab === 'orders' && <OrdersPanel />}
          {tab === 'invite' && <InvitePanel onNotice={setNotice} />}
          {notice && <Notice tone="accent"><Check className="mt-0.5 size-3.5 shrink-0" />{notice}</Notice>}
        </section>
      </div>
    </div>
  )
}

/** 资料与安全：真实调用资料更新、密码修改、邮箱验证码接口。 */
function ProfilePanel({ state, onNotice }: { state: ReturnType<typeof useStudio>['state']; onNotice: (value: string) => void }) {
  const { refreshSession } = useStudio()
  const connected = state.backendStatus === 'connected'
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(state.user.name)
  const [bio, setBio] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [codeSent, setCodeSent] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // 账号切换后重置表单，避免把上一个账号的输入带给新账号。
  useEffect(() => {
    setDisplayName(state.user.name)
    setBio('')
    setNewEmail('')
    setEmailCode('')
    setEditing(false)
    setError('')
  }, [state.user.id, state.user.name])

  async function sendEmailCode() {
    if (!newEmail.trim()) { setError('请先填写新邮箱。'); return }
    setBusy(true); setError(''); setCodeSent('')
    try {
      await requestEmailCode({ purpose: 'email-change', email: newEmail.trim() })
      // 后端只在真正投递成功时返回 ok；这里如实说明，不谎称「邮箱已验证」。
      setCodeSent('验证码已提交发送请求。若站点未配置邮件服务，请向管理员获取验证码。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码发送失败')
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile() {
    setBusy(true); setError('')
    try {
      await updateProfile({
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        email: newEmail.trim() || undefined,
        emailCode: newEmail.trim() ? emailCode.trim() : undefined,
      })
      await refreshSession()
      setEditing(false)
      setNewEmail('')
      setEmailCode('')
      setCodeSent('')
      onNotice('资料已更新。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料更新失败')
    } finally {
      setBusy(false)
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致。'); return }
    if (newPassword.length < 8) { setError('新密码至少 8 位。'); return }
    setBusy(true); setError('')
    try {
      await updatePassword({ currentPassword, newPassword })
      setPasswordOpen(false)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      // 后端修改密码后会清除会话，因此必须重新读取会话状态，而不是继续显示旧登录态。
      await refreshSession()
      onNotice('密码已修改，会话已失效，请使用新密码重新登录。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '密码修改失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="warning">{error}</Notice>}
      <div className="studio-surface p-5">
        <SectionHeading
          title="个人资料"
          description={connected ? '资料来自当前登录账户。' : '未登录时没有真实账户资料。'}
          action={connected ? <ControlButton variant="secondary" size="sm" onClick={() => setEditing((value) => !value)} disabled={busy}><Pencil className="size-3.5" />{editing ? '取消编辑' : '编辑'}</ControlButton> : <Link href="/login?next=/account" className="text-xs underline">前往登录</Link>}
        />
        <div className="mt-5 flex items-center gap-4">
          <img src={state.user.avatar} alt={state.user.name} className="size-16 rounded-full object-cover" />
          <div>
            <p className="text-base font-semibold text-foreground">{connected ? state.user.name : '未登录'}</p>
            <p className="mt-1 text-sm text-muted-foreground">{connected ? (state.user.email || '未设置邮箱') : '登录后显示真实账户'}</p>
            <div className="mt-2"><StatusBadge tone="accent">{connected ? state.user.plan : '未登录'}</StatusBadge></div>
          </div>
        </div>
        {editing ? (
          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">昵称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="studio-field h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">简介</span><textarea rows={3} value={bio} onChange={(event) => setBio(event.target.value)} className="studio-field w-full resize-none border border-border bg-background p-3 text-sm outline-none focus:border-studio-accent/60" /></label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">新邮箱（需验证码）</span><input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="留空表示不修改" className="studio-field h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">邮箱验证码</span><input value={emailCode} onChange={(event) => setEmailCode(event.target.value)} className="studio-field h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60" /></label>
              <div className="flex items-end"><ControlButton variant="secondary" size="sm" onClick={sendEmailCode} disabled={busy || !newEmail.trim()}><Send className="size-3.5" />获取验证码</ControlButton></div>
            </div>
            {codeSent && <p className="text-[11px] text-muted-foreground">{codeSent}</p>}
            <Notice tone="neutral"><Mail className="mt-0.5 size-3.5 shrink-0" />邮箱状态由后端确认；前端不会在验证码通过前显示「已验证」。</Notice>
            <div className="flex justify-end gap-2"><ControlButton variant="ghost" onClick={() => setEditing(false)} disabled={busy}>取消</ControlButton><ControlButton variant="primary" onClick={saveProfile} disabled={busy}>{busy ? '保存中…' : '保存资料'}</ControlButton></div>
          </div>
        ) : (
          <div className="mt-5 border-t border-border pt-2">
            <KeyValue label="账户 ID" value={connected ? state.user.id : '—'} />
            <KeyValue label="角色" value={connected ? (state.user.role === 'admin' ? '管理员' : '用户') : '—'} />
          </div>
        )}
      </div>

      <div className="studio-surface p-5">
        <SectionHeading title="安全" description={connected ? '登录状态由后端会话管理。' : '登录后可使用真实账户安全设置。'} />
        <div className="mt-3 border-t border-border">
          <KeyValue label="修改密码" value={connected ? <ControlButton variant="ghost" size="sm" onClick={() => setPasswordOpen((value) => !value)}><LockKeyhole className="size-3.5" />{passwordOpen ? '收起' : '修改密码'}</ControlButton> : <span className="text-xs text-muted-foreground">登录后可用</span>} />
          <KeyValue label="找回密码" value={<Link href="/login?mode=reset" className="text-xs text-studio-accent underline">通过邮箱重置</Link>} />
        </div>
        {passwordOpen && (
          <div className="mt-3 flex flex-col gap-3 border-t border-border pt-4">
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">当前密码</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="studio-field h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">新密码（至少 8 位）</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="studio-field h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">确认新密码</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="studio-field h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-studio-accent/60" /></label>
            <div className="flex justify-end gap-2"><ControlButton variant="ghost" onClick={() => setPasswordOpen(false)} disabled={busy}>取消</ControlButton><ControlButton variant="primary" onClick={changePassword} disabled={busy || !currentPassword || !newPassword}>{busy ? '提交中…' : '确认修改'}</ControlButton></div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------ 积分与消费 ------------------------------ */

/**
 * 积分与消费。
 *
 * 关键修复：金额来自 `/api/points` 积分流水，而不是生成日志。
 * 早先读的 `pointsCost` / `pointsRefunded` 在后端记录里并不存在，
 * 因此 80 条记录全部被算成 0。现在按后端给出的 type 分类统计，
 * 并且逐页聚合，不只统计第一页。
 */
function CreditsPanel({ state }: { state: ReturnType<typeof useStudio>['state'] }) {
  const connected = state.backendStatus === 'connected'
  const { summary, state: loadState, message, reload } = useLedgerSummary({ maxPages: 40 })
  const [records, setRecords] = useState<PointRecord[]>([])
  const [recordsState, setRecordsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [recordsMessage, setRecordsMessage] = useState('')

  useEffect(() => {
    let active = true
    if (!connected) { setRecords([]); setRecordsState('ready'); return }
    setRecordsState('loading')
    listPointRecords({ page: 1, pageSize: 50 })
      .then((result) => { if (active) { setRecords(result.records); setRecordsState('ready') } })
      .catch((reason) => { if (active) { setRecordsMessage(reason instanceof Error ? reason.message : '积分流水加载失败'); setRecordsState('error') } })
    return () => { active = false }
  }, [connected, state.user.id])

  // 月度统计按业务时区（Asia/Shanghai）取月，避免 UTC 与北京时间跨月错位。
  const monthKey = currentLedgerMonth()
  const monthSummary = summary ? summarizeLedgerMonth(summary, monthKey) : null
  const monthConsume = monthSummary?.consume ?? 0
  const monthRefund = monthSummary?.refund ?? 0
  const monthRecharge = monthSummary?.recharge ?? 0
  const monthGrant = monthSummary?.grant ?? 0

  // 接口失败时显示占位符而不是 0，避免把「读不到」呈现成「真的是 0」。
  const display = (value: number) => loadState === 'loading' ? '…' : loadState === 'ready' ? value.toLocaleString() : '—'
  const [monthYear, monthNumber] = monthKey.split('-')
  const monthLabel = `${monthYear} 年 ${Number(monthNumber)} 月`

  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone="warning"><span className="min-w-0 flex-1">积分统计暂时不可用：{message}</span><button type="button" onClick={() => void reload()} className="shrink-0 text-[11px] underline">重试</button></Notice>}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">可用积分</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-studio-accent">{connected ? state.credits.toLocaleString() : '—'}</p><Link href="/plans" className="mt-3 inline-flex text-xs font-medium text-studio-accent hover:underline">购买套餐 <ArrowUpRight className="ml-1 size-3.5" /></Link></div>
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}已消费</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{display(monthConsume)}</p><p className="mt-3 text-xs text-muted-foreground">{loadState === 'ready' ? '按积分流水统计' : connected ? '统计暂时不可用' : '登录后显示真实统计'}</p></div>
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}已退回</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{display(monthRefund)}</p><p className="mt-3 text-xs text-muted-foreground">{loadState === 'ready' ? '按积分流水类型统计，不按金额正负推断' : connected ? '统计暂时不可用' : '登录后显示真实统计'}</p></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}充值</p><p className="mt-1.5 text-xl font-semibold text-foreground">{display(monthRecharge)}</p></div>
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}赠送</p><p className="mt-1.5 text-xl font-semibold text-foreground">{display(monthGrant)}</p></div>
      </div>

      <div className="studio-surface p-5">
        <SectionHeading title="流水明细" description="记录来自后端积分流水接口，类型区分消费、退款、充值、赠送与过期。" />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="py-3 font-medium">说明</th><th className="py-3 font-medium">类型</th><th className="py-3 font-medium">金额</th><th className="py-3 font-medium">时间</th></tr></thead>
            <tbody>
              {records.slice(0, 10).map((record) => {
                const category = ledgerCategoryOf(record.type, { amount: record.amount, idempotencyKey: record.idempotencyKey })
                return (
                  <tr key={record.id} className="border-b border-border/60 last:border-b-0">
                    <td className="max-w-[280px] truncate py-3 text-sm text-foreground" title={record.description}>{record.description || record.model || record.id}</td>
                    <td className="py-3 text-xs text-muted-foreground">{ledgerCategoryLabels[category]}</td>
                    <td className={cn('py-3 text-xs', Number(record.amount) < 0 ? 'text-foreground' : 'text-studio-accent')}>{Number(record.amount) > 0 ? '+' : ''}{Number(record.amount).toLocaleString()}</td>
                    <td className="py-3 text-xs text-muted-foreground">{record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {recordsState === 'loading' && <p className="py-6 text-center text-xs text-muted-foreground">正在读取积分流水…</p>}
          {recordsState === 'error' && <p className="py-6 text-center text-xs text-destructive">{recordsMessage}</p>}
          {recordsState === 'ready' && !records.length && <p className="py-6 text-center text-xs text-muted-foreground">{connected ? '暂无积分流水' : '登录后显示真实积分流水'}</p>}
        </div>
        {summary && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            本次统计范围：{summary.scanned} 条流水、{summary.scannedPages} 页
            {summary.firstDate ? `，${summary.firstDate} 至 ${summary.lastDate}` : ''}
            {summary.truncated ? '。流水较多，尚未覆盖全部历史，继续刷新会扩大范围。' : '。已覆盖全部历史流水。'}
          </p>
        )}
      </div>
      <Notice tone="neutral"><CreditCard className="mt-0.5 size-3.5 shrink-0" />实际扣费与退款以服务端积分流水为准。</Notice>
    </div>
  )
}

/* ------------------------------- 订单记录 ------------------------------- */

function OrdersPanel() {
  const { orders, pending, state: loadState, message, reload } = useServerOrders()
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [checkout, setCheckout] = useState<{ orderNo: string; kind: string; url?: string; qrContent?: string } | null>(null)

  if (loadState === 'unauthenticated') {
    return <Notice tone="neutral"><span className="min-w-0 flex-1">登录后查看订单记录。</span><Link href="/login?next=/account" className="shrink-0 text-[11px] underline">前往登录</Link></Notice>
  }

  /** 继续支付：为待支付订单重新获取支付参数，本地只支持 manual 渠道。 */
  async function resume(orderId: string, provider: string, orderNo: string) {
    setBusyId(orderId); setActionError(''); setNotice('')
    try {
      const result = await resumeCheckout(orderId, provider || 'manual')
      setCheckout({ orderNo, kind: result.kind, url: result.url, qrContent: result.qrContent })
      setNotice('已重新获取支付参数。支付完成后请点击「刷新状态」。')
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '获取支付参数失败')
    } finally {
      setBusyId('')
    }
  }

  async function cancel(orderId: string) {
    setBusyId(orderId); setActionError('')
    try {
      await cancelAccountOrder(orderId, '用户主动取消')
      setNotice('订单已取消。')
      await reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '取消订单失败')
    } finally {
      setBusyId('')
    }
  }

  const labels: Record<string, string> = { pending: '待支付', paid: '已支付', canceled: '已取消', closed: '已关闭', refunding: '退款中', refunded: '已退款' }

  return (
    <section className="min-w-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">订单记录</h2>
        <ControlButton variant="secondary" size="sm" onClick={() => void reload()} disabled={loadState === 'loading'}>
          <RefreshCw className={cn('size-3.5', loadState === 'loading' && 'animate-spin')} />刷新状态
        </ControlButton>
      </div>
      {message && <Notice tone="warning">{message}</Notice>}
      {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
      {notice && <Notice tone="accent">{notice}</Notice>}
      {pending.length > 0 && (
        <Notice tone="neutral">
          <Clock3 className="mt-0.5 size-3.5 shrink-0" />
          有 {pending.length} 笔待支付订单，可以继续支付或取消。
        </Notice>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border">
            <tr>{['订单号', '商品', '金额', '状态', '时间', '操作'].map((header) => <th key={header} className="p-3 font-medium">{header}</th>)}</tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-border">
                <td className="p-3 font-mono text-xs">{order.orderNo || order.id}</td>
                <td className="p-3">{order.subject}</td>
                <td className="p-3">{moneyLabel(Number(order.amountCents), String(order.currency || 'CNY'))}</td>
                <td className="p-3"><StatusBadge tone={order.status === 'paid' ? 'success' : order.status === 'pending' ? 'accent' : 'neutral'}>{labels[order.status] || order.status}</StatusBadge></td>
                <td className="p-3 text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                <td className="p-3">
                  {order.status === 'pending' ? (
                    <div className="flex flex-wrap gap-1.5">
                      <ControlButton variant="secondary" size="sm" onClick={() => void resume(order.id, order.provider || 'manual', order.orderNo)} disabled={busyId === order.id}><CreditCard className="size-3.5" />继续支付</ControlButton>
                      <ControlButton variant="ghost" size="sm" onClick={() => void cancel(order.id)} disabled={busyId === order.id}>取消订单</ControlButton>
                    </div>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
            {!orders.length && <tr><td colSpan={6} className="p-6 text-center text-xs text-muted-foreground">{loadState === 'loading' ? '正在读取订单…' : loadState === 'error' ? '订单暂时无法读取' : '暂无订单'}</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal open={Boolean(checkout)} onClose={() => setCheckout(null)} title="继续支付" description={checkout?.orderNo} footer={<ControlButton variant="ghost" onClick={() => setCheckout(null)}>关闭</ControlButton>}>
        {checkout && (
          <div className="flex flex-col gap-3">
            <KeyValue label="支付方式" value={checkout.kind === 'manual' ? '人工确认（本地环境）' : checkout.kind} />
            {checkout.url && <a href={checkout.url} target="_blank" rel="noopener noreferrer" className="text-xs text-studio-accent underline">打开支付页面</a>}
            {checkout.qrContent && <p className="break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">{checkout.qrContent}</p>}
            <Notice tone="neutral">本地环境只启用人工支付渠道。真实在线支付需要在具备支付资质后单独开通。</Notice>
          </div>
        )}
      </Modal>
    </section>
  )
}

/* ------------------------------- 邀请好友 ------------------------------- */

/**
 * 邀请中心。
 *
 * 早先这里是硬编码的演示链接 `MIRA24`、已邀请 12 人、待发放 240 积分。
 * 现在全部来自后端 `/api/referrals`：邀请码、链接、关系与奖励都由服务端给出。
 */
function InvitePanel({ onNotice }: { onNotice: (value: string) => void }) {
  const { center, state: loadState, message } = useReferralCenter()
  const [copyState, setCopyState] = useState('')

  /**
   * 邀请链接必须指向用户实际使用的入口。
   *
   * 后端按「它自己收到的 Host」生成链接，经反向代理后可能得到后端内部地址
   * （例如 http://127.0.0.1:3200/invite/VZ0001），用户打不开。
   * 路径与邀请码保持后端原样，只把 origin 换成当前前端入口。
   */
  const link = useMemo(() => {
    if (!center?.link) return ''
    try {
      const parsed = new URL(center.link)
      if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) {
        return `${window.location.origin}${parsed.pathname}${parsed.search}`
      }
      return center.link
    } catch {
      // 后端返回的链接不可解析时，用邀请码自行拼一个可用的本地入口。
      return center.code && typeof window !== 'undefined' ? `${window.location.origin}/invite/${encodeURIComponent(center.code)}` : center.link
    }
  }, [center?.code, center?.link])

  const stats = center?.stats

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopyState('邀请链接已复制。')
      onNotice('邀请链接已复制。')
    } catch {
      setCopyState('浏览器未授权剪贴板，请手动复制下面的链接。')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="studio-surface p-5">
        <SectionHeading title="邀请好友" description="邀请码、链接与奖励规则全部来自服务端。" />
        {message && <Notice tone="warning">{message}</Notice>}
        {loadState === 'unauthenticated' ? (
          <Notice tone="neutral"><span className="min-w-0 flex-1">登录后才会显示属于你的邀请码。</span><Link href="/login?next=/account" className="shrink-0 text-[11px] underline">前往登录</Link></Notice>
        ) : loadState === 'loading' ? (
          <p className="mt-4 text-xs text-muted-foreground">正在读取邀请数据…</p>
        ) : !center ? (
          <p className="mt-4 text-xs text-muted-foreground">当前站点没有可用的邀请计划。</p>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{link || '服务端未返回邀请链接'}</span>
              <ControlButton variant="secondary" size="sm" onClick={copyLink} disabled={!link}><Copy className="size-3.5" />复制</ControlButton>
            </div>
            {copyState && <p className="text-[11px] text-muted-foreground" aria-live="polite">{copyState}</p>}
            <div className="grid gap-3 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">邀请码</p><p className="mt-1 font-mono text-lg font-semibold text-foreground">{center.code || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">已邀请</p><p className="mt-1 text-2xl font-semibold text-foreground">{stats?.registrations ?? 0}</p></div>
              <div><p className="text-xs text-muted-foreground">已结算奖励</p><p className="mt-1 text-2xl font-semibold text-studio-accent">{stats?.settled ?? 0}</p></div>
              <div><p className="text-xs text-muted-foreground">待结算</p><p className="mt-1 text-2xl font-semibold text-foreground">{stats?.pending ?? 0}</p></div>
            </div>
            <div className="border-t border-border pt-2">
              <KeyValue label="邀请人奖励" value={center.program.enabled ? `${center.program.inviterPoints} 积分` : '邀请计划未启用'} />
              <KeyValue label="被邀请人奖励" value={center.program.enabled ? `${center.program.inviteePoints} 积分（${center.program.inviteeRewardType === 'daily' ? '每日' : '永久'}）` : '—'} />
              <KeyValue label="最低有效支付" value={`${moneyLabel(center.program.minimumPaidCents, 'CNY')}`} />
              <KeyValue label="冷却期" value={`${center.program.coolingOffDays} 天`} />
            </div>
          </div>
        )}
      </div>
      <Notice tone="neutral"><Users className="mt-0.5 size-3.5 shrink-0" />奖励只在被邀请人完成有效支付后由服务端结算，前端不会自行发放。</Notice>
    </div>
  )
}

/* -------------------------------- 设置页 -------------------------------- */

function SkinPicker({ skin, onChange }: { skin: StudioSkin; onChange: (skin: StudioSkin) => void }) {
  const options: Array<{ value: StudioSkin; label: string; description: string; gradient: string }> = [
    { value: 'gradient', label: '渐变创作', description: '深色画布、冷暖渐变与创作感边框', gradient: 'linear-gradient(135deg, #ff9d7d 0%, #f5d78e 38%, #a9e7d1 68%, #83cfff 100%)' },
    { value: 'minimal', label: '黑白极简', description: '保留当前中性黑白灰界面', gradient: 'linear-gradient(135deg, #ffffff 0%, #d4d4d8 55%, #18181b 100%)' },
  ]
  const selectedOption = options.find((option) => option.value === skin) ?? options[0]

  return (
    <div className="studio-surface p-5">
      <SectionHeading title="界面皮肤" description="渐变创作会应用到整个产品界面；黑白极简保留中性灰白工作区。" />
      <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2" role="radiogroup" aria-label="界面皮肤">
        {options.map((option) => {
          const selected = option.value === skin
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60',
                selected ? 'border-studio-accent bg-studio-accent/10' : 'border-border bg-card hover:bg-muted',
              )}
            >
              <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg border border-white/15" style={{ background: option.gradient }} aria-hidden="true">
                <Palette className={cn('size-4', option.value === 'gradient' ? 'text-[#10151a]' : 'text-[#ffffff]')} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{option.label}</span>
                  {selected && <Check className="size-3.5 text-studio-accent" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">当前启用：<span className="font-medium text-foreground">{selectedOption.label}</span> · 视觉样式会同步到整个产品界面</p>
    </div>
  )
}

export function SettingsPage() {
  const { state, setSkin, toggleTheme, refreshSession } = useStudio()
  const connected = state.backendStatus === 'connected'
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  /** 手动同步会话：接口失败时明确提示，不显示成「已同步」。 */
  async function sync() {
    setRefreshing(true); setNotice('')
    try {
      await refreshSession()
      setNotice('已从后端重新读取账户、模型目录与积分。')
    } catch (reason) {
      setNotice(reason instanceof Error ? `同步失败：${reason.message}` : '同步失败，请稍后重试。')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
      <PageHeader eyebrow="偏好设置" title="设置" description="管理主题、界面偏好与账户同步。" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="studio-surface p-5">
          <SectionHeading title="外观" description="渐变创作会随浅色与深色主题切换，保留同一套彩色创作语言。" />
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <div><p className="text-sm font-medium text-foreground">当前主题</p><p className="mt-1 text-xs text-muted-foreground">{state.theme === 'dark' ? '深色' : '浅色'}</p></div>
            <ControlButton variant="secondary" size="sm" onClick={toggleTheme}>{state.theme === 'dark' ? '切换浅色' : '切换深色'}</ControlButton>
          </div>
        </div>
        <div className="studio-surface p-5">
          <SectionHeading title="账户与数据" description={connected ? '数据来自后端账户，本地只缓存界面偏好。' : '未登录，界面使用本地预览数据。'} />
          <div className="mt-4 border-t border-border pt-2">
            <KeyValue label="账户状态" value={<StatusBadge tone={connected ? 'success' : 'neutral'}>{connected ? '已连接后端' : '未登录'}</StatusBadge>} />
            <KeyValue label="模型目录" value={state.liveModels.length ? `${state.liveModels.length} 个后端模型` : '未获取到后端模型'} />
            <KeyValue label="可用积分" value={connected ? state.credits.toLocaleString() : '—'} />
            <KeyValue label="重新同步" value={<ControlButton variant="ghost" size="sm" onClick={sync} disabled={refreshing}><RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />{refreshing ? '同步中…' : '立即同步'}</ControlButton>} />
          </div>
          {!connected && <Notice tone="neutral">未登录时工作台显示本地预览，真实数据需要登录后读取。</Notice>}
        </div>
      </div>
      <SkinPicker skin={state.skin} onChange={(skin) => { setSkin(skin); setNotice(`已切换为${skin === 'gradient' ? '渐变创作' : '黑白极简'}，整个产品界面已同步更新。`) }} />
      {notice && <Notice tone="accent"><Check className="mt-0.5 size-3.5 shrink-0" />{notice}</Notice>}
    </div>
  )
}
