'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Copy, CreditCard, ExternalLink, FolderPlus, Image as ImageIcon, KeyRound, Link2, Loader2, LockKeyhole, Mail, Package, Pencil, RefreshCw, Send, Sparkles, UserRound, Users, Video, WandSparkles } from 'lucide-react'
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
import type { GenerationAsset, StudioWork } from '@/lib/studio/account-api'
import { cn } from '@/lib/utils'
import { addMediaToProject } from '@/lib/studio/project-media'
import { MediaDownloadButton } from './media-download-button'
import { AccountWechat } from './account-wechat'
import { writeReuseParams } from '@/lib/studio/reuse-params'
import { writeWorkHandoff } from '@/lib/studio/work-handoff'
import { formatPointsExpiry } from '@/lib/studio/check-in-rules'
import { pointRecordBreakdown } from '@/lib/studio/ledger'

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
  const groupedVisible = useMemo(() => {
    const seen = new Set<string>()
    return visible.filter((work) => {
      const key = work.groupId ?? work.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [visible])

  if (state === 'unauthenticated') {
    return (
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
        <PageHeader eyebrow="作品" title="我的作品" description="生成结果、项目关系和发布状态都在这里继续管理。" />
        <Notice tone="warning">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">登录后才会显示属于你的作品。</span>
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
        description="这里集中管理已经生成并保存结果的作品。"
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
        <span className="text-xs text-muted-foreground">{state === 'loading' ? '正在读取…' : `${groupedVisible.length} 件作品`}</span>
      </div>
      {state === 'loading' && !works.length ? (
        <div className="studio-surface flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />正在读取生成结果
        </div>
      ) : state === 'error' && !works.length ? (
        <Notice tone="warning">
          <span className="min-w-0 flex-1">作品暂时无法读取：{message}</span>
          <button type="button" onClick={() => void reload()} className="shrink-0 text-[11px] underline">重试</button>
        </Notice>
      ) : groupedVisible.length === 0 ? (
        <div className="studio-empty-state flex flex-col items-center justify-center gap-2 border border-dashed border-border px-5 py-12 text-center">
          <p className="text-sm font-medium">还没有生成成功的作品</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">在图片或视频工作台提交生成后，成功的结果会自动出现在这里。当前记录共 {total} 条。</p>
          <Link href="/image" className="mt-2 text-xs text-studio-accent underline">前往图片工作台</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {groupedVisible.map((work) => <WorkCard key={work.groupId ?? work.id} work={work} />)}
        </div>
      )}
    </div>
  )
}

/** 作品卡片：支持预览、下载、复用参数、发送到画布、加入项目。 */
function WorkCard({ work }: { work: StudioWork }) {
  const { state } = useStudio()
  const [preview, setPreview] = useState(false)
  const [activeAssetIndex, setActiveAssetIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)
  const projectLock = useRef(false)
  const ratio = work.kind === 'video' ? '16:9' : '1:1'
  const openPreview = useCallback(() => setPreview(true), [])
  const closePreview = useCallback(() => setPreview(false), [])
  const resultAssets: GenerationAsset[] = work.assets?.length ? work.assets : [{ url: work.src, poster: work.poster }]
  const activeAsset = resultAssets[Math.min(activeAssetIndex, resultAssets.length - 1)] ?? resultAssets[0]
  const workTitle = work.groupTitle ?? work.title

  useEffect(() => {
    setActiveAssetIndex(0)
  }, [work.groupId, work.id])

  /** 复用参数：把结果带回工作台，由工作台继续用同一组参数创作。 */
  function reuseParams(event: React.MouseEvent<HTMLAnchorElement>) {
    try {
      if (work.kind === 'audio') throw new Error('音频结果请发送到画布继续使用')
      writeReuseParams(window.sessionStorage, state.user.id, {
        kind: work.kind,
        prompt: work.prompt,
        model: work.model,
        taskId: work.taskId ?? work.id,
      })
    } catch (error) {
      event.preventDefault()
      setNotice(error instanceof Error ? error.message : '无法复用参数，请重试')
    }
  }

  /** 发送到画布：写入待接收的结果，画布页读取后作为节点插入。 */
  function sendToCanvas() {
    try {
      writeWorkHandoff(window.sessionStorage, state.user.id, { id: work.id, kind: work.kind, title: work.title, src: work.src })
      setNotice('已准备好，请在当前标签页 15 分钟内打开目标画布。')
    } catch {
      setNotice('浏览器存储不可用，无法发送到画布。')
    }
  }

  /** 加入项目：把结果登记为当前选中项目的素材。 */
  async function addToProject() {
    if (projectLock.current) return
    const projectId = state.selectedProjectId
    const project = state.projects.find((item) => item.id === projectId)
    if (!project) {
      setNotice('当前没有可用项目，请先在项目页创建或选择项目。')
      return
    }
    projectLock.current = true; setProjectBusy(true); setNotice('')
    try {
      const result = await addMediaToProject(projectId, { sourceId: work.src, title: work.title, kind: work.kind, url: work.src, poster: work.poster, prompt: work.prompt, model: work.model })
      setNotice(result.alreadyPresent ? `该作品已在项目「${project.title}」中。` : `已保存到项目「${project.title}」。`)
    } catch (error) { setNotice(error instanceof Error ? `加入项目失败：${error.message}` : '加入项目失败，请重试') }
    finally { projectLock.current = false; setProjectBusy(false) }
  }

  return (
    <article className="studio-surface studio-surface-interactive group overflow-hidden">
      {work.kind === 'audio' ? <div className="flex aspect-[4/3] items-center justify-center bg-muted p-4"><audio src={work.src} controls preload="none" aria-label={work.title} className="w-full" /></div> : <MediaThumb
        src={resultAssets[0].url}
        poster={resultAssets[0].poster}
        kind={work.kind === 'video' ? 'video' : 'image'}
        alt={workTitle}
        fallback={work.fallback}
        className="aspect-[4/3]"
        overlay={<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-studio-ink/80 to-transparent px-3 pb-2.5 pt-8"><StatusBadge solid tone="success">已完成</StatusBadge><span className="text-[10px] text-studio-ink-muted">{ratio}{resultAssets.length > 1 ? ` · ${resultAssets.length} 张` : ''}</span></div>}
      />}
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-foreground" title={workTitle}>{workTitle}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{work.model || '未记录模型'}{work.createdAt ? ` · ${new Date(work.createdAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ControlButton variant="secondary" size="sm" onClick={openPreview} aria-haspopup="dialog"><ExternalLink className="size-3.5" />预览</ControlButton>
          <MediaDownloadButton media={{ url: resultAssets[0].url, kind: work.kind }} title={workTitle} prompt={work.prompt} taskId={work.taskId ?? work.id} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs hover:bg-muted disabled:opacity-50" />
          {work.kind !== 'audio' ? <Link href={work.kind === 'video' ? '/video' : '/image'} onClick={reuseParams} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Copy className="size-3.5" />复用参数</Link> : null}
          <ControlButton variant="ghost" size="sm" onClick={sendToCanvas}><WandSparkles className="size-3.5" />发到画布</ControlButton>
          <ControlButton variant="ghost" size="sm" onClick={() => void addToProject()} disabled={projectBusy}><FolderPlus className="size-3.5" />{projectBusy ? '保存中…' : '加入项目'}</ControlButton>
        </div>
        {notice && <p className="mt-2 text-[11px] text-studio-accent" aria-live="polite">{notice}</p>}
      </div>
      <Modal
        open={preview}
        onClose={closePreview}
        title={workTitle}
        description={`生成于 ${work.createdAt ? new Date(work.createdAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间'}${work.durationMs ? ` · 耗时 ${Math.round(work.durationMs / 1000)} 秒` : ''}${resultAssets.length > 1 ? ` · ${resultAssets.length} 张结果` : ''}`}
        footer={(
          <>
            <ControlButton variant="ghost" onClick={closePreview}>关闭</ControlButton>
            <MediaDownloadButton media={{ url: activeAsset.url, kind: work.kind }} title={`${workTitle} · ${activeAssetIndex + 1}`} prompt={work.prompt} taskId={work.taskId ?? work.id} label="下载作品" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-muted disabled:opacity-50" />
            {work.kind !== 'audio' ? <Link href={work.kind === 'video' ? '/video' : '/image'} onClick={reuseParams} className="inline-flex h-9 items-center gap-2 rounded-lg border border-studio-accent bg-studio-accent px-3 text-sm font-medium text-studio-accent-foreground hover:bg-studio-accent/85"><Copy className="size-4" />复用这组参数</Link> : null}
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          {work.kind === 'audio' ? <audio src={activeAsset.url} controls preload="none" aria-label={workTitle} className="w-full" /> : work.kind === 'video' ? <video src={activeAsset.url} poster={activeAsset.poster} controls playsInline className="max-h-[70vh] w-full rounded-lg bg-black object-contain" aria-label={`${workTitle} 结果 ${activeAssetIndex + 1}`} /> : <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg bg-muted"><img src={activeAsset.url} alt={`${workTitle} 结果 ${activeAssetIndex + 1}`} className="max-h-[70vh] max-w-full object-contain" /></div>}
          {resultAssets.length > 1 && <div className="flex items-center gap-2" aria-label="生成结果浏览">
            <button type="button" onClick={() => setActiveAssetIndex((index) => (index - 1 + resultAssets.length) % resultAssets.length)} className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted" aria-label="上一个结果"><ChevronLeft className="size-4" /></button>
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
              {resultAssets.map((asset, index) => <button key={`${asset.url}-${index}`} type="button" onClick={() => setActiveAssetIndex(index)} aria-label={`查看第 ${index + 1} 个结果`} aria-pressed={activeAssetIndex === index} className={cn('relative size-12 shrink-0 overflow-hidden rounded-md border bg-muted', activeAssetIndex === index ? 'border-studio-accent ring-2 ring-studio-accent/25' : 'border-border')}><img src={asset.url} alt="" className="size-full object-cover" /></button>)}
            </div>
            <button type="button" onClick={() => setActiveAssetIndex((index) => (index + 1) % resultAssets.length)} className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted" aria-label="下一个结果"><ChevronRight className="size-4" /></button>
          </div>}
          {work.prompt && <div><p className="text-xs font-medium text-muted-foreground">创作提示词</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{work.prompt}</p></div>}
          <div className="border-y border-border">
            <KeyValue label="模型" value={work.model || '未记录'} />
            <KeyValue label="类型" value={work.kind === 'video' ? '视频' : work.kind === 'audio' ? '音频' : '图片'} />
            <KeyValue label="任务 ID" value={<span className="font-mono text-[11px]">{work.taskId ?? work.id}</span>} />
          </div>
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
  type PublicWork = { id: string; title: string; summary: string; src?: string; cover?: string; kind: 'image' | 'video'; featured: boolean }
  const [items, setItems] = useState<PublicWork[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [active, setActive] = useState<PublicWork | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active_ = true
    const controller = new AbortController()
    setLoadState('loading'); setMessage(''); setItems([]); setActive(null)
    // 公开接口不需要登录；失败时明确说明，不用私有作品冒充公开内容。
    const query = new URLSearchParams({ page: String(page), limit: '24', sort: 'featured' })
    if (filter === '精选') query.set('featured', 'true')
    else if (filter === 'image' || filter === 'video') query.set('kind', filter)
    fetch(`/api/public/gallery?${query}`, { credentials: 'omit', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.msg || payload?.error || `请求失败（${response.status}）`)
        const result = payload?.data ?? payload
        if (!result || typeof result !== 'object') throw new Error('公开作品响应无效，请重试。')
        return result
      })
      .then((payload) => {
        if (!active_) return
        setEnabled(payload.enabled !== false)
        if (payload.enabled === false) { setItems([]); setTotal(0); setLoadState('ready'); return }
        const raw = payload.items ?? payload.works
        if (!Array.isArray(raw)) throw new Error('公开作品列表格式无效，请重试。')
        const list = Array.isArray(raw) ? raw : []
        setItems(list.filter((item: Record<string, unknown>) => item && (item.kind === 'image' || item.kind === 'video')).map((item: Record<string, unknown>) => ({
          id: String(item.id ?? item.slug ?? ''),
          title: String(item.title ?? '未命名作品'),
          summary: typeof item.summary === 'string' ? item.summary : '',
          src: typeof item.mediaUrl === 'string' ? item.mediaUrl : typeof item.coverUrl === 'string' ? item.coverUrl : undefined,
          cover: typeof item.coverUrl === 'string' ? item.coverUrl : undefined,
          kind: item.kind as 'image' | 'video',
          featured: item.featured === true,
        })).filter((item: { id: string }) => item.id))
        setTotal(Number.isFinite(payload.total) && payload.total >= 0 ? payload.total : list.length)
        if (Number.isFinite(payload.total) && page > Math.max(1, Math.ceil(payload.total / 24))) setPage(Math.max(1, Math.ceil(payload.total / 24)))
        setLoadState('ready')
      })
      .catch((reason) => {
        if (!active_) return
        setMessage(reason instanceof Error ? reason.message : '公开作品加载失败')
        setLoadState('error')
      })
    return () => { active_ = false; controller.abort() }
  }, [filter, page, revision])

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
      <PageHeader eyebrow="发现" title="广场" description="浏览已审核并发布的图片与视频作品。" actions={<SegmentedControl value={filter} onChange={(value) => { setFilter(value); setPage(1) }} options={[{ value: '精选', label: '精选' }, { value: '全部', label: '全部' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }]} />} />
      {message && <Notice tone="warning">{message}</Notice>}
      {loadState === 'loading' ? (
        <div className="studio-surface flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />正在读取公开作品</div>
      ) : !enabled || items.length === 0 ? (
        <div className="studio-empty-state flex flex-col items-center justify-center gap-2 border border-dashed border-border px-5 py-12 text-center">
          <p className="text-sm font-medium">{loadState === 'error' ? '公开作品暂时无法读取' : !enabled ? '公开广场尚未开放' : filter === '精选' ? '暂时没有精选作品' : '还没有符合条件的公开作品'}</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">{loadState === 'error' ? '当前无法读取公开作品，可重新尝试。' : !enabled ? '站点尚未启用安全的公开作品展示。' : '只有已审核、已发布且提供可公开媒体的作品会出现在这里。'}</p>
          {loadState === 'error' ? <ControlButton onClick={() => setRevision((value) => value + 1)}>重新读取</ControlButton> : enabled && filter !== '全部' ? <ControlButton onClick={() => { setFilter('全部'); setPage(1) }}>浏览全部作品</ControlButton> : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((work, index) => (
            <button type="button" key={work.id} onClick={() => setActive(work)} className="group text-left">
              <MediaThumb src={work.src} poster={work.cover} kind={work.kind} alt={work.title} fallback={work.title} className={index % 5 === 0 ? 'aspect-[4/5]' : 'aspect-[4/3]'} />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{work.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{work.featured ? '精选 · ' : ''}{work.kind === 'video' ? '视频' : '图片'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {loadState === 'ready' && enabled && total > 24 && <nav aria-label="公开作品分页" className="flex items-center justify-center gap-3"><ControlButton disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</ControlButton><span className="text-xs text-muted-foreground">第 {page} / {Math.max(1, Math.ceil(total / 24))} 页 · {total} 件作品</span><ControlButton disabled={page * 24 >= total} onClick={() => setPage((value) => value + 1)}>下一页</ControlButton></nav>}
      <Modal open={Boolean(active)} onClose={() => setActive(null)} title={active?.title ?? '作品详情'} description={active?.summary || '公开作品预览'} footer={<ControlButton variant="ghost" onClick={() => setActive(null)}>关闭</ControlButton>}>
        <MediaThumb src={active?.src} poster={active?.cover} kind={active?.kind === 'video' ? 'video' : 'image'} alt={active?.title ?? '作品'} fallback={active?.title ?? '作品'} className="aspect-video" />
      </Modal>
      {state.backendStatus !== 'connected' && <Notice tone="neutral">这里仅展示已审核发布的作品，无需登录即可浏览。</Notice>}
    </div>
  )
}

/* ------------------------------- 账户页面 ------------------------------- */

export function AccountPage() {
  const { state } = useStudio()
  const [tab, setTab] = useState('profile')
  const [notice, setNotice] = useState('')
  const rechargeEnabled = state.sessionSettings?.operationMode === 'commercial'
  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
      <PageHeader eyebrow="账户" title="账户与套餐" description="管理个人信息、安全、积分和消费记录。" actions={rechargeEnabled ? <div className="flex flex-wrap gap-2"><Link href="/credits?returnTo=%2Faccount" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><CircleDollarSign className="size-4" />购买积分</Link><Link href="/plans?returnTo=%2Faccount" className="inline-flex h-9 items-center gap-2 rounded-lg border border-foreground bg-foreground px-3 text-sm font-medium text-background shadow-[var(--lg-shadow-2)] transition-opacity duration-150 hover:opacity-90"><CircleDollarSign className="size-4" />购买套餐</Link></div> : undefined} />
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* 账户分区导航：桌面为纵向列表，移动端横向滚动；选中态与侧栏导航保持同一语言。 */}
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" data-mobile-scroll aria-label="账户分区">
          {[{ id: 'profile', label: '资料与安全', icon: UserRound }, { id: 'credits', label: '积分与消费', icon: CircleDollarSign }, { id: 'orders', label: '订单记录', icon: Package }, { id: 'invite', label: '邀请好友', icon: Users }].map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'true' : undefined}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60 lg:w-full',
                tab === id
                  ? 'bg-studio-accent/12 text-studio-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--studio-accent)_22%,transparent)]'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4" />{label}
            </button>
          ))}
        </nav>
        <section className="min-w-0">
          {tab === 'profile' && <ProfilePanel state={state} onNotice={setNotice} />}
          {tab === 'credits' && <CreditsPanel key={state.user.id} state={state} rechargeEnabled={rechargeEnabled} />}
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
          description={connected ? '资料来自当前登录账户。' : '登录后即可查看和管理账户资料。'}
          action={connected ? <ControlButton variant="secondary" size="sm" onClick={() => setEditing((value) => !value)} disabled={busy}><Pencil className="size-3.5" />{editing ? '取消编辑' : '编辑'}</ControlButton> : <Link href="/login?next=/account" className="text-xs underline">前往登录</Link>}
        />
        <div className="mt-5 flex items-center gap-4">
          <img src={state.user.avatar} alt={state.user.name} className="size-16 rounded-full object-cover" />
          <div>
            <p className="text-base font-semibold text-foreground">{connected ? state.user.name : '未登录'}</p>
            <p className="mt-1 text-sm text-muted-foreground">{connected ? (state.user.email || '未设置邮箱') : '登录后显示账户邮箱'}</p>
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
            <Notice tone="neutral"><Mail className="mt-0.5 size-3.5 shrink-0" />邮箱状态将在验证码通过后更新。</Notice>
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
        <SectionHeading title="安全" description={connected ? '登录状态已受保护。' : '登录后可管理账户安全设置。'} />
        <div className="mt-3 border-t border-border">
          <KeyValue label="修改密码" value={connected ? <ControlButton variant="ghost" size="sm" onClick={() => setPasswordOpen((value) => !value)}><LockKeyhole className="size-3.5" />{passwordOpen ? '收起' : '修改密码'}</ControlButton> : <span className="text-xs text-muted-foreground">需要登录</span>} />
          <KeyValue label="找回密码" value={<Link href="/login?mode=reset" className="text-xs text-studio-accent underline">通过邮箱重置</Link>} />
          {connected && state.sessionSettings?.wechatLoginEnabled === true && <KeyValue label="微信登录" value={<Link href="/settings#wechat-binding" className="text-xs text-studio-accent underline">管理微信绑定</Link>} />}
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
function CreditsPanel({ state, rechargeEnabled }: { state: ReturnType<typeof useStudio>['state']; rechargeEnabled: boolean }) {
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
  const bucketDisplay = (value: number | undefined) => connected && typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
  const timedExpiry = connected ? formatPointsExpiry(state.user.timedPointsExpiresAt) : null

  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone="warning"><span className="min-w-0 flex-1">积分统计暂时不可用：{message}</span><button type="button" onClick={() => void reload()} className="shrink-0 text-[11px] underline">重试</button></Notice>}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">可用积分</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-studio-accent">{connected ? state.credits.toLocaleString() : '—'}</p>{rechargeEnabled ? <Link href="/credits?returnTo=%2Faccount" className="mt-3 inline-flex text-xs font-medium text-studio-accent hover:underline">购买积分 <ArrowUpRight className="ml-1 size-3.5" /></Link> : <p className="mt-3 text-xs text-muted-foreground">自用模式暂不开放充值</p>}</div>
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}已消费</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{display(monthConsume)}</p><p className="mt-3 text-xs text-muted-foreground">{loadState === 'ready' ? '按积分流水统计' : '统计暂时不可用'}</p></div>
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}已退回</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{display(monthRefund)}</p><p className="mt-3 text-xs text-muted-foreground">{loadState === 'ready' ? '按积分流水类型统计，不按金额正负推断' : '统计暂时不可用'}</p></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}充值</p><p className="mt-1.5 text-xl font-semibold text-foreground">{display(monthRecharge)}</p></div>
        <div className="studio-surface p-4"><p className="text-xs text-muted-foreground">{monthLabel}赠送</p><p className="mt-1.5 text-xl font-semibold text-foreground">{display(monthGrant)}</p></div>
      </div>

      <div className="studio-surface p-4">
        <h3 className="text-sm font-medium">可用积分构成</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">{([['永久积分', state.user.permanentPointsBalance], ['每日自动额度', state.user.dailyPointsBalance], ['限时积分', state.user.timedPointsBalance]] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{bucketDisplay(value)}</dd></div>)}</dl>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">限时签到奖励按领取时的规则到期。{timedExpiry ? `最近一批将于 ${timedExpiry} 到期（北京时间）。` : '具体奖励有效期以领取记录为准。'}每日自动额度独立刷新。</p>
      </div>

      <div className="studio-surface p-5">
        <SectionHeading title="流水明细" description="按消费、退款、充值、赠送与过期分类查看积分变化。" />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="py-3 font-medium">说明</th><th className="py-3 font-medium">类型</th><th className="py-3 font-medium">金额</th><th className="py-3 font-medium">时间</th></tr></thead>
            <tbody>
              {records.slice(0, 10).map((record) => {
                const category = ledgerCategoryOf(record.type, { amount: record.amount, idempotencyKey: record.idempotencyKey })
                const breakdown = pointRecordBreakdown(record)
                const expiry = formatPointsExpiry(record.expiresAt)
                return (
                  <tr key={record.id} className="border-b border-border/60 last:border-b-0">
                    <td className="max-w-[280px] py-3 text-sm text-foreground"><p className="truncate" title={record.description}>{record.description || record.model || record.id}</p>{expiry && <p className="mt-1 text-[11px] text-muted-foreground">有效期至 {expiry}（北京时间）</p>}{Number(record.expiredRefundPoints) > 0 && <p className="mt-1 text-[11px] text-muted-foreground">另有 {record.expiredRefundPoints?.toLocaleString('zh-CN')} 限时积分已到期，未恢复</p>}</td>
                    <td className="py-3 text-xs text-muted-foreground">{ledgerCategoryLabels[category]}</td>
                    <td className={cn('py-3 text-xs', Number(record.amount) < 0 ? 'text-foreground' : 'text-studio-accent')}><span>{Number(record.amount) > 0 ? '+' : ''}{Number(record.amount).toLocaleString()}</span>{breakdown && <p className="mt-1 max-w-60 text-[11px] text-muted-foreground">{breakdown}</p>}</td>
                    <td className="py-3 text-xs text-muted-foreground">{record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {recordsState === 'loading' && <p className="py-6 text-center text-xs text-muted-foreground">正在读取积分流水…</p>}
          {recordsState === 'error' && <p className="py-6 text-center text-xs text-destructive">{recordsMessage}</p>}
          {recordsState === 'ready' && !records.length && <p className="py-6 text-center text-xs text-muted-foreground">暂无积分流水</p>}
        </div>
        {summary && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            本次统计范围：{summary.scanned} 条流水、{summary.scannedPages} 页
            {summary.firstDate ? `，${summary.firstDate} 至 ${summary.lastDate}` : ''}
            {summary.truncated ? '。流水较多，尚未覆盖全部历史，继续刷新会扩大范围。' : '。已覆盖全部历史流水。'}
          </p>
        )}
      </div>
      <Notice tone="neutral"><CreditCard className="mt-0.5 size-3.5 shrink-0" />实际扣费与退款以积分流水为准。</Notice>
    </div>
  )
}

/* ------------------------------- 订单记录 ------------------------------- */

function OrdersPanel() {
  const { orders, pending, state: loadState, message, reload } = useServerOrders()
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [checkout, setCheckout] = useState<{ orderNo: string; kind: string; instructions?: string; url?: string; qrContent?: string } | null>(null)

  if (loadState === 'unauthenticated') {
    return <Notice tone="neutral"><span className="min-w-0 flex-1">登录后查看订单记录。</span><Link href="/login?next=/account" className="shrink-0 text-[11px] underline">前往登录</Link></Notice>
  }

  /** 继续支付：为待支付订单重新获取支付参数，本地只支持 manual 渠道。 */
  async function resume(orderId: string, provider: string, orderNo: string) {
    setBusyId(orderId); setActionError(''); setNotice('')
    try {
      const result = await resumeCheckout(orderId, provider || 'manual')
      setCheckout({ orderNo, kind: result.kind, instructions: result.instructions, url: result.url, qrContent: result.qrContent })
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
            <KeyValue label="支付方式" value={checkout.kind === 'manual' ? '人工确认' : checkout.kind} />
            {checkout.kind === 'manual' && <p className="whitespace-pre-wrap break-words text-sm">{checkout.instructions?.trim() || '请联系管理员获取本订单的付款说明。'}</p>}
            {checkout.url && <a href={checkout.url} target="_blank" rel="noopener noreferrer" className="text-xs text-studio-accent underline">打开支付页面</a>}
            {checkout.qrContent && <p className="break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">{checkout.qrContent}</p>}
            <Notice tone="neutral">当前订单需要人工确认支付，请按页面提示完成后等待处理。</Notice>
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
        <SectionHeading title="邀请好友" description="邀请码、链接与奖励规则会随账户状态同步。" />
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
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{link || '暂未生成邀请链接'}</span>
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
      <Notice tone="neutral"><Users className="mt-0.5 size-3.5 shrink-0" />奖励会在被邀请人完成有效支付后结算。</Notice>
    </div>
  )
}

/* -------------------------------- 设置页 -------------------------------- */

export function SettingsPage() {
  const { state, toggleTheme, refreshSession } = useStudio()
  const connected = state.backendStatus === 'connected'
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [noticeTone, setNoticeTone] = useState<'success' | 'warning'>('success')
  const syncLock = useRef(false)
  const syncEpoch = useRef(0)
  const accountRef = useRef(state.user.id)
  accountRef.current = state.user.id
  useEffect(() => {
    syncEpoch.current += 1; syncLock.current = false; setRefreshing(false); setNotice('')
    return () => { syncEpoch.current += 1 }
  }, [state.user.id])

  /** 手动同步会话：接口失败时明确提示，不显示成「已同步」。 */
  async function sync() {
    if (syncLock.current) return
    syncLock.current = true
    const token = syncEpoch.current
    const accountId = state.user.id
    const current = () => token === syncEpoch.current && accountRef.current === accountId
    setRefreshing(true); setNotice('')
    try {
      const result = await refreshSession()
      if (!current()) return
      setNoticeTone(result.status === 'connected' ? 'success' : 'warning')
      setNotice(result.status === 'connected' ? '已重新同步账户、模型目录与积分。' : result.status === 'unauthenticated' ? '当前未登录，请登录后同步账户数据。' : result.status === 'superseded' ? '本次同步已被另一笔更新替代，请以当前账户状态为准。' : `同步失败：${result.error || '服务暂时不可用，请稍后重试。'}`)
    } catch (reason) {
      if (!current()) return
      setNoticeTone('warning')
      setNotice(reason instanceof Error ? `同步失败：${reason.message}` : '同步失败，请稍后重试。')
    } finally {
      if (current()) { syncLock.current = false; setRefreshing(false) }
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-5 py-6 md:px-8 xl:px-10">
      <PageHeader eyebrow="偏好设置" title="设置" description="管理主题、界面质感与账户同步。" />
      <AccountWechat key={state.user.id} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="studio-surface p-5">
          <SectionHeading title="外观" description="浅色与深色主题共用同一套层级、间距与强调色，切换主题不会改变布局。" />
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <div><p className="text-sm font-medium text-foreground">当前主题</p><p className="mt-1 text-xs text-muted-foreground">{state.theme === 'dark' ? '深色' : '浅色'}</p></div>
            <ControlButton variant="secondary" size="sm" onClick={toggleTheme}>{state.theme === 'dark' ? '切换浅色' : '切换深色'}</ControlButton>
          </div>
        </div>
        <div className="studio-surface p-5">
          <SectionHeading title="账户与数据" description={connected ? '账户数据与界面偏好。' : '登录后即可查看账户数据。'} />
          <div className="mt-4 border-t border-border pt-2">
            <KeyValue label="账户状态" value={<StatusBadge tone={connected ? 'success' : 'neutral'}>{connected ? '已同步' : state.backendStatus === 'checking' ? '正在读取' : state.backendStatus === 'offline' ? '暂时无法连接' : '未登录'}</StatusBadge>} />
            <KeyValue label="模型目录" value={state.liveModels.length ? `${state.liveModels.length} 个可用模型` : '暂未获取模型'} />
            <KeyValue label="可用积分" value={connected ? state.credits.toLocaleString() : '—'} />
            <KeyValue label="重新同步" value={<ControlButton variant="ghost" size="sm" onClick={sync} disabled={refreshing}><RefreshCw className={cn('size-3.5', refreshing && 'animate-spin motion-reduce:animate-none')} />{refreshing ? '同步中…' : '立即同步'}</ControlButton>} />
          </div>
          {!connected && <Notice tone="neutral">{state.backendStatus === 'offline' ? '服务暂时无法连接，恢复连接后可重新同步。' : '登录后可查看完整账户数据。'}</Notice>}
        </div>
      </div>
      <div className="studio-surface p-5">
        <SectionHeading title="界面质感" description="当前统一使用液态玻璃结构，导航、浮层与创作输入区保持同一套透光层级。" />
        <div className="mt-4 flex items-center gap-3 border-t border-border pt-4 text-sm">
          <span className="size-3 rounded-full bg-studio-accent shadow-[0_0_0_5px_color-mix(in_srgb,var(--studio-accent)_14%,transparent)]" aria-hidden="true" />
          <span className="font-medium text-foreground">液态玻璃</span>
          <span className="text-xs text-muted-foreground">已固定为当前界面风格</span>
        </div>
      </div>
      {notice && <Notice tone={noticeTone === 'success' ? 'accent' : 'warning'}>{noticeTone === 'success' && <Check className="mt-0.5 size-3.5 shrink-0" />}{notice}</Notice>}
    </div>
  )
}
