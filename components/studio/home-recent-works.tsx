'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, Clapperboard, PanelsTopLeft, RefreshCw } from 'lucide-react'
import { listDramaProjects, type DramaProjectSummary } from '@/lib/studio/api'
import { subscribeAccountData } from '@/lib/studio/account-data-sync'
import { useStudio } from '@/lib/studio/store'
import { usePlugins } from '@/lib/studio/plugin-context'
import { cn } from '@/lib/utils'
import { MediaThumb } from './ui'

type RecentProject = { id: string; title: string; cover: string; updatedAt: string; kind: 'creative' | 'canvas'; href: string }
type FilterKind = 'all' | 'creative' | 'canvas'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '继续编辑' : `${new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)} 更新`
}

function projectCover(project: DramaProjectSummary) {
  return project.cover?.kind === 'video' ? '' : project.cover?.url || project.coverUrl || ''
}

/** 展示服务端创作项目和已有画布，带极简分类筛选条，卡片保持实心可读表面。 */
export function RecentWorks() {
  const tx = useUiText()
  const { state } = useStudio()
  const plugins = usePlugins()
  const dramaInstalled = plugins.isInstalled('drama')
  const canvasInstalled = plugins.isInstalled('canvas')
  const [dramas, setDramas] = useState<DramaProjectSummary[]>([])
  const [loadedFor, setLoadedFor] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState<FilterKind>('all')
  const connected = state.backendStatus === 'connected'

  useEffect(() => subscribeAccountData(() => setRevision((value) => value + 1)), [])
  useEffect(() => {
    let disposed = false
    setDramas([])
    setLoadedFor('')
    setError('')
    if (!connected || !dramaInstalled) { setLoading(false); return }
    setLoading(true)
    void listDramaProjects().then((result) => {
      if (!disposed) { setDramas(result.projects ?? []); setLoadedFor(state.user.id) }
    }).catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : '项目读取失败')
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [connected, state.user.id, revision, dramaInstalled])

  const allProjects: RecentProject[] = connected ? [
    ...(dramaInstalled && loadedFor === state.user.id ? dramas : []).map((project): RecentProject => ({ id: project.id, title: project.title, cover: projectCover(project), updatedAt: project.updatedAt, kind: 'creative', href: `/projects/${encodeURIComponent(project.id)}` })),
    ...(canvasInstalled ? state.projects : []).map((project): RecentProject => ({ id: project.id, title: project.title, cover: project.cover, updatedAt: project.updatedAt, kind: 'canvas', href: `/canvas/${encodeURIComponent(project.id)}` })),
  ].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)) : []

  const projects = (filter === 'all' ? allProjects : allProjects.filter((item) => item.kind === filter)).slice(0, 4)

  if (!dramaInstalled && !canvasInstalled) return null

  const filterTabs: Array<{ id: FilterKind; label: string }> = [
    { id: 'all', label: '全部项目' },
    ...(dramaInstalled ? [{ id: 'creative' as const, label: '创作项目' }] : []),
    ...(canvasInstalled ? [{ id: 'canvas' as const, label: '自由画布' }] : []),
  ]

  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="recent-title" className="mr-1 text-sm font-semibold tracking-[-0.01em] text-foreground">{tx('最近项目')}</h2>
          <div role="group" aria-label={tx('项目筛选')} className="flex flex-wrap items-center gap-1">
            {filterTabs.map((tab) => {
              const active = filter === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    'h-7 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                    active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {tx(tab.label)}
                </button>
              )
            })}
          </div>
        </div>
        <Link prefetch={false} href="/projects" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
          {tx('全部项目')}<ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
          <p className="text-muted-foreground">{tx('部分项目暂时无法读取：')}{error}</p>
          <button type="button" onClick={() => setRevision((value) => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 hover:bg-muted">
            <RefreshCw className="size-3.5" aria-hidden="true" />{tx('重新读取')}
          </button>
        </div>
      )}

      {projects.length ? (
        <ul aria-label={tx('最近项目列表')} className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          {projects.map((project) => {
            const Icon = project.kind === 'creative' ? Clapperboard : PanelsTopLeft
            return (
              <li key={`${project.kind}-${project.id}`} className="min-w-0">
                <Link
                  prefetch={false}
                  href={project.href}
                  className="studio-surface studio-surface-interactive group flex h-full flex-col overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <MediaThumb src={project.cover} alt="" fallback={project.title} className="aspect-[16/10] w-full shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
                    <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon className="size-3" aria-hidden="true" />
                      {project.kind === 'creative' ? tx('创作项目') : tx('自由画布')}
                      <span className="ml-auto">{dateLabel(project.updatedAt)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : loading || state.backendStatus === 'checking' ? (
        <p role="status" className="rounded-2xl border border-border/60 bg-card/50 px-5 py-6 text-center text-xs text-muted-foreground">{tx('正在读取最近项目…')}</p>
      ) : !error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {connected ? tx('暂无匹配项目') : state.backendStatus === 'offline' ? tx('暂时无法读取最近项目') : tx('登录后即可同步保存你的创作项目与画布')}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {connected ? tx('切换上方「完整作品」标签，或前往自由画布创建新作品。') : state.backendStatus === 'offline' ? tx('服务暂时不可用，恢复连接后即可继续。') : tx('项目、参考素材与生成记录都会跟随你的账户云端保存。')}
            </p>
          </div>
          {!connected && (
            <Link prefetch={false} href="/login" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-colors hover:bg-foreground/90">
              {tx('立即登录')}<ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
