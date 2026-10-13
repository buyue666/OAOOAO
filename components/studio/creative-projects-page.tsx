'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Clapperboard, LoaderCircle, PanelsTopLeft, Plus, RefreshCw, Search, X } from 'lucide-react'
import { listCanvasProjects, listDramaProjects, type CanvasSummary, type DramaProjectSummary } from '@/lib/studio/api'
import { subscribeAccountData } from '@/lib/studio/account-data-sync'
import { resolveLinkedDramaProjectId } from '@/lib/studio/drama-link'
import { useStudio } from '@/lib/studio/store'
import { cn } from '@/lib/utils'
import { CreativeProjectStarter } from './creative-project-starter'
import { MediaThumb } from './ui'

type ProjectRow = {
  id: string
  title: string
  kind: 'creative' | 'canvas'
  href: string
  updatedAt: string
  cover?: { kind: 'image' | 'video'; url: string }
  canvases: CanvasSummary[]
}
type ProjectSnapshot = { accountId: string; dramas: DramaProjectSummary[]; canvases: CanvasSummary[]; loading: boolean; errors: string[] }
type ProjectFilter = 'all' | 'creative' | 'canvas'

const filters: Array<{ value: ProjectFilter; label: string }> = [{ value: 'all', label: '全部' }, { value: 'creative', label: '创作项目' }, { value: 'canvas', label: '自由画布' }]

async function readAllProjects<T>(readPage: (params: { page: number; pageSize: number }) => Promise<{ projects: T[]; total: number }>, isCurrent: () => boolean): Promise<T[]> {
  const result: T[] = []
  let page = 1
  let total = Infinity
  while (isCurrent() && (page - 1) * 100 < total) {
    const response = await readPage({ page, pageSize: 100 })
    if (!isCurrent()) return []
    result.push(...response.projects)
    total = Math.max(0, Number(response.total) || 0)
    if (response.projects.length < 100) break
    page += 1
  }
  return result
}

function updatedLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '继续编辑' : `${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)} 更新`
}

function projectRows(dramas: DramaProjectSummary[], canvases: CanvasSummary[], filter: ProjectFilter): ProjectRow[] {
  const dramaById = new Map(dramas.map((project) => [project.id, project]))
  const canvasById = new Map(canvases.map((project) => [project.id, project]))
  const dramaCandidates = [...dramaById.values()]
  const linked = new Map<string, CanvasSummary[]>()
  const independent: CanvasSummary[] = []
  for (const canvas of canvasById.values()) {
    const dramaId = resolveLinkedDramaProjectId(canvas.id, dramaCandidates, canvas.sourceHandoffId)
    if (dramaId) linked.set(dramaId, [...(linked.get(dramaId) ?? []), canvas])
    else independent.push(canvas)
  }
  const creativeRows: ProjectRow[] = filter === 'canvas' ? [] : [...dramaById.values()].map((project) => ({ id: project.id, title: project.title, kind: 'creative', href: `/projects/${encodeURIComponent(project.id)}`, updatedAt: project.updatedAt, cover: project.cover ?? (project.coverUrl ? { kind: 'image', url: project.coverUrl } : undefined), canvases: linked.get(project.id) ?? [] }))
  const canvasRows: ProjectRow[] = filter === 'creative' ? [] : (filter === 'canvas' ? [...canvasById.values()] : independent).map((project) => ({ id: project.id, title: project.title, kind: 'canvas', href: `/canvas/${encodeURIComponent(project.id)}`, updatedAt: project.updatedAt, cover: project.cover, canvases: [] }))
  return [...creativeRows, ...canvasRows].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
}

export function CreativeProjectsPage() {
  const { state, refreshSession } = useStudio()
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>({ accountId: '', dramas: [], canvases: [], loading: true, errors: [] })
  const [revision, setRevision] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const connected = state.backendStatus === 'connected'
  const accountId = state.user.id

  useEffect(() => subscribeAccountData(() => setRevision((value) => value + 1)), [])
  useEffect(() => {
    let current = true
    if (!connected) {
      setSnapshot({ accountId: '', dramas: [], canvases: [], loading: false, errors: [] })
      return
    }
    setSnapshot({ accountId, dramas: [], canvases: [], loading: true, errors: [] })
    void Promise.allSettled([
      readAllProjects(listDramaProjects, () => current),
      readAllProjects(listCanvasProjects, () => current),
    ]).then(([dramas, canvases]) => {
      if (!current) return
      const errors: string[] = []
      if (dramas.status === 'rejected') errors.push(`创作项目：${dramas.reason instanceof Error ? dramas.reason.message : '读取失败'}`)
      if (canvases.status === 'rejected') errors.push(`自由画布：${canvases.reason instanceof Error ? canvases.reason.message : '读取失败'}`)
      setSnapshot({ accountId, dramas: dramas.status === 'fulfilled' ? dramas.value : [], canvases: canvases.status === 'fulfilled' ? canvases.value : [], loading: false, errors })
    })
    return () => { current = false }
  }, [accountId, connected, revision])

  const current = connected && snapshot.accountId === accountId
  const loading = state.backendStatus === 'checking' || (connected && (!current || snapshot.loading))
  const rows = useMemo(() => current ? projectRows(snapshot.dramas, snapshot.canvases, filter) : [], [current, snapshot.dramas, snapshot.canvases, filter])
  const keyword = search.trim().toLocaleLowerCase()
  const visible = keyword ? rows.filter((project) => project.title.toLocaleLowerCase().includes(keyword) || project.canvases.some((canvas) => canvas.title.toLocaleLowerCase().includes(keyword))) : rows
  const hasErrors = current && snapshot.errors.length > 0

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-medium text-muted-foreground">创作空间</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">我的项目</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">让提纲、参考与镜头留在一起，随时接着创作。</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/canvas" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"><PanelsTopLeft className="size-4" aria-hidden="true" />画布管理</Link>
          <button type="button" aria-expanded={createOpen} aria-controls="creative-project-create" onClick={() => setCreateOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">{createOpen ? <X className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}{createOpen ? '收起创建' : '新建作品项目'}</button>
        </div>
      </header>

      <section id="creative-project-create" hidden={!createOpen} className="studio-surface"><CreativeProjectStarter /></section>

      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="项目类型" className="flex flex-wrap gap-1">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={cn('min-h-9 rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70', filter === item.value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50')}>{item.label}</button>)}</div>
        <div className="flex items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-3"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="搜索项目名称" placeholder="搜索项目名称" value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 min-w-0 w-full bg-transparent text-sm outline-none sm:w-52" /></label><button type="button" disabled={loading} aria-label="刷新项目列表" onClick={() => { if (!connected) void refreshSession(); setRevision((value) => value + 1) }} className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"><RefreshCw className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" /></button></div>
      </div>

      {hasErrors && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-6"><p className="font-medium">部分项目暂时无法读取，已保留能够加载的内容。</p>{snapshot.errors.map((error) => <p key={error} className="text-muted-foreground">{error}</p>)}<button type="button" onClick={() => setRevision((value) => value + 1)} className="mt-2 rounded text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">重新读取</button></div>}

      {loading ? <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在读取项目…</div> : !connected ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center"><p className="text-base font-medium">{state.backendStatus === 'unauthenticated' ? '登录后查看你的项目' : '暂时无法连接项目服务'}</p><p className="mt-2 text-sm text-muted-foreground">{state.backendStatus === 'unauthenticated' ? '项目和参考素材会跟随你的账户保存。' : '请稍后刷新重试，已有项目不会被删除。'}</p>{state.backendStatus === 'unauthenticated' && <Link href="/login" className="mt-5 inline-flex min-h-10 items-center rounded-md bg-foreground px-5 text-sm text-background">登录账户</Link>}</div>
      ) : visible.length ? (
        <ul aria-label="项目列表" className="grid gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => {
            const Icon = project.kind === 'creative' ? Clapperboard : PanelsTopLeft
            return <li key={`${project.kind}-${project.id}`} className="studio-surface min-w-0 overflow-hidden"><Link href={project.href} className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"><MediaThumb src={project.cover?.url} kind={project.cover?.kind} alt="" fallback={project.title} loading="lazy" className="aspect-[16/10] w-full" /><span className="flex flex-col gap-3 p-4"><span className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{project.kind === 'creative' ? '创作项目' : '自由画布'}</span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span><span className="truncate text-base font-semibold">{project.title}</span><span className="text-xs text-muted-foreground">{updatedLabel(project.updatedAt)}</span></span></Link>{project.canvases.length > 0 && <details className="border-t border-border px-4 py-3"><summary className="cursor-pointer text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">关联画布 · {project.canvases.length}</summary><ul className="mt-2 flex flex-col gap-1">{project.canvases.map((canvas) => <li key={canvas.id}><Link href={`/canvas/${encodeURIComponent(canvas.id)}`} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"><PanelsTopLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{canvas.title}</span></Link></li>)}</ul></details>}</li>
          })}
        </ul>
      ) : !hasErrors && (
        <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center"><p className="text-base font-medium">{keyword ? '没有找到匹配的项目' : filter === 'canvas' ? '还没有自由画布' : filter === 'creative' ? '还没有作品项目' : '把下一个想法变成作品'}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{keyword ? '换一个名称试试，或清除搜索查看全部项目。' : '单次生成可以直接开始；需要连续创作时，在这里保存提纲、参考和镜头。'}</p>{keyword ? <button type="button" onClick={() => setSearch('')} className="mt-5 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">清除搜索</button> : filter === 'canvas' ? <Link href="/canvas" className="mt-5 inline-flex rounded-md bg-foreground px-4 py-2 text-sm text-background">打开画布管理</Link> : <button type="button" onClick={() => setCreateOpen(true)} className="mt-5 rounded-md bg-foreground px-4 py-2 text-sm text-background">新建作品项目</button>}</div>
      )}
    </div>
  )
}
