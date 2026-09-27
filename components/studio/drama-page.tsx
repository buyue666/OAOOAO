'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CalendarDays, Check, Clapperboard, FileText, Loader2, Plus, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { createDramaProject, listDramaProjects, type DramaProjectSummary } from '@/lib/studio/api'
import { ControlButton, EmptyState, Notice, PageHeader, SectionHeading, StatusBadge } from './ui'
import { cn } from '@/lib/utils'

type OutlineEpisode = { title?: string; script?: string }

function requestId(prefix: string) {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${uuid}`
}

function formatDate(value: string) {
  if (!value) return '刚刚更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

function statusLabel(status: string) {
  return status === 'archived' ? '已归档' : status === 'active' ? '进行中' : status || '草稿'
}

function statusTone(status: string): 'accent' | 'muted' | 'neutral' {
  return status === 'archived' ? 'muted' : status === 'active' ? 'accent' : 'neutral'
}

function projectSummary(project: DramaProjectSummary) {
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    shotCount: project.shotCount,
    coverUrl: project.coverUrl,
  }
}

export function DramaPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<DramaProjectSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [notice, setNotice] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [style, setStyle] = useState('电影感国漫')
  const [ratio, setRatio] = useState('9:16')
  const [idea, setIdea] = useState('')
  const [draftEpisodes, setDraftEpisodes] = useState<OutlineEpisode[]>([])

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listDramaProjects()
      setProjects(result.projects ?? [])
      setTotal(result.total ?? result.projects?.length ?? 0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '短剧项目加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadProjects() }, [loadProjects])

  const activeCount = useMemo(() => projects.filter((project) => project.status !== 'archived').length, [projects])
  const shotCount = useMemo(() => projects.reduce((sum, project) => sum + (project.shotCount ?? 0), 0), [projects])

  function resetCreateForm() {
    setTitle('')
    setSummary('')
    setStyle('电影感国漫')
    setRatio('9:16')
    setIdea('')
    setDraftEpisodes([])
    setNotice('')
  }

  async function generateOutline() {
    if (!idea.trim() || drafting) return
    setDrafting(true)
    setNotice('')
    try {
      const response = await fetch('/api/drama/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId('drama-outline'), phase: 'outline', idea: idea.trim() }),
      })
      const payload = await response.json().catch(() => ({})) as {
        data?: { title?: string; summary?: string; style?: string; episodes?: OutlineEpisode[] }
        msg?: string
      }
      if (!response.ok || !payload.data?.episodes?.length) throw new Error(payload.msg || '短剧大纲生成失败')
      if (payload.data.title) setTitle(payload.data.title)
      if (payload.data.summary) setSummary(payload.data.summary)
      if (payload.data.style) setStyle(payload.data.style)
      setDraftEpisodes(payload.data.episodes)
      setNotice(`已生成 ${payload.data.episodes.length} 集大纲，创建时会一并写入项目。`)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '短剧大纲生成失败')
    } finally {
      setDrafting(false)
    }
  }

  async function create() {
    if (!title.trim() || creating) return
    setCreating(true)
    setNotice('')
    try {
      const project = await createDramaProject({
        title: title.trim(),
        summary: summary.trim(),
        style: style.trim(),
        ratio,
        initialScript: draftEpisodes[0]?.script?.trim() || undefined,
      })
      setProjects((current) => [projectSummary(project), ...current.filter((item) => item.id !== project.id)])
      setTotal((current) => current + 1)
      setCreateOpen(false)
      resetCreateForm()
      router.push(`/drama/${project.id}`)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '短剧项目创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-6 px-4 py-5 md:px-7 md:py-7">
      <PageHeader
        eyebrow="短剧生产线"
        title="短剧制作"
        description="从一句故事开始，完成剧本、角色、分镜与成片。短剧项目独立保存，不会把画布或图片视频任务混在一起。"
        actions={<ControlButton variant="primary" size="lg" onClick={() => { setCreateOpen((value) => !value); setNotice('') }}><Plus className="size-4" aria-hidden="true" />{createOpen ? '收起创建面板' : '新建短剧'}</ControlButton>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="lg-raised p-4"><p className="text-xs text-muted-foreground">全部短剧</p><p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{total}</p><p className="mt-1 text-xs text-muted-foreground">当前账号的生产线</p></div>
        <div className="lg-raised p-4"><p className="text-xs text-muted-foreground">进行中</p><p className="mt-1 text-2xl font-semibold tabular-nums text-studio-accent">{activeCount}</p><p className="mt-1 text-xs text-muted-foreground">可继续编辑与生成</p></div>
        <div className="lg-raised p-4"><p className="text-xs text-muted-foreground">已记录镜头</p><p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{shotCount}</p><p className="mt-1 text-xs text-muted-foreground">来自已加载的短剧项目</p></div>
      </div>

      {createOpen && (
        <section className="lg-glass rounded-xl border border-border p-4 shadow-[var(--lg-shadow-2)] md:p-5" aria-labelledby="drama-create-title" data-testid="drama-create-panel">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-studio-accent">创建生产线</p>
            <h2 id="drama-create-title" className="text-lg font-semibold text-foreground">先把故事说清楚</h2>
            <p className="text-sm leading-6 text-muted-foreground">可以直接填写项目，也可以先用一句话生成大纲，再确认后进入短剧编辑器。</p>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <div className="space-y-3">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">一句话故事</span><textarea value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="例如：雨夜里的修表匠，发现每一块表都停在同一个时间。" className="studio-field min-h-24 w-full resize-y border border-border bg-card px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /></label>
              <div className="flex flex-wrap items-center gap-2">
                <ControlButton variant="glass" size="sm" disabled={!idea.trim() || drafting} onClick={() => void generateOutline()}>{drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} {drafting ? '正在生成大纲' : '生成大纲'}</ControlButton>
                {draftEpisodes.length > 0 && <span className="text-xs text-success"><Check className="mr-1 inline size-3.5" />已暂存 {draftEpisodes.length} 集</span>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-foreground">项目名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雨停之前" className="studio-field h-9 w-full border border-border bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /></label>
              <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-foreground">故事简介</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="人物、冲突和目标" className="studio-field min-h-16 w-full resize-y border border-border bg-card px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /></label>
              <label><span className="mb-1.5 block text-xs font-medium text-foreground">视觉风格</span><input value={style} onChange={(event) => setStyle(event.target.value)} className="studio-field h-9 w-full border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /></label>
              <label><span className="mb-1.5 block text-xs font-medium text-foreground">画面比例</span><select value={ratio} onChange={(event) => setRatio(event.target.value)} className="studio-select studio-field h-9 w-full border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></label>
            </div>
          </div>
          {(notice || error) && <Notice tone={error ? 'danger' : 'neutral'}>{error || notice}</Notice>}
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4"><ControlButton variant="ghost" onClick={() => { setCreateOpen(false); resetCreateForm() }}>取消</ControlButton><ControlButton variant="primary" disabled={!title.trim() || creating} onClick={() => void create()}>{creating ? <Loader2 className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}{creating ? '正在创建' : '创建并进入'}</ControlButton></div>
        </section>
      )}

      {error && !createOpen && <Notice tone="danger"><AlertCircle className="mr-1.5 inline size-4" />{error}<button type="button" className="ml-2 underline underline-offset-2" onClick={() => void loadProjects()}>重试</button></Notice>}

      <section aria-labelledby="drama-list-title">
        <SectionHeading title="我的短剧" description="每个项目都有独立的剧本、角色、分镜和成片状态。" action={<ControlButton variant="ghost" size="sm" onClick={() => void loadProjects()} disabled={loading}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />刷新</ControlButton>} />
        {loading ? (
          <div className="mt-4 flex min-h-48 items-center justify-center border border-dashed border-border text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在加载短剧项目…</div>
        ) : projects.length === 0 ? (
          <div className="mt-4"><EmptyState title="还没有短剧项目" description="从一句故事开始，创建你的第一条短剧生产线。" action={<ControlButton variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-3.5" />新建第一个短剧</ControlButton>} /></div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link key={project.id} href={`/drama/${project.id}`} className="studio-surface studio-surface-interactive group min-w-0 overflow-hidden p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-studio-accent/20 bg-studio-accent/10 text-studio-accent"><Clapperboard className="size-5" aria-hidden="true" /></div>
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="truncate text-sm font-semibold text-foreground group-hover:text-studio-accent">{project.title || '未命名短剧'}</h3><StatusBadge tone={statusTone(project.status)}>{statusLabel(project.status)}</StatusBadge></div><p className="mt-1 truncate text-xs text-muted-foreground">{project.id}</p></div>
                </div>
                <div className="mt-5 flex items-center gap-4 border-t border-border/70 pt-3 text-xs text-muted-foreground"><span><FileText className="mr-1 inline size-3.5" />{project.shotCount ?? 0} 个镜头</span><span><CalendarDays className="mr-1 inline size-3.5" />{formatDate(project.updatedAt || project.createdAt)}</span><span className="ml-auto text-studio-accent opacity-0 transition-opacity group-hover:opacity-100">进入制作 →</span></div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
