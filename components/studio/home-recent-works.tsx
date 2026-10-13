'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, Clapperboard, PanelsTopLeft, RefreshCw } from 'lucide-react'
import { listDramaProjects, type DramaProjectSummary } from '@/lib/studio/api'
import { subscribeAccountData } from '@/lib/studio/account-data-sync'
import { useStudio } from '@/lib/studio/store'
import { MediaThumb } from './ui'

type RecentProject = { id: string; title: string; cover: string; updatedAt: string; kind: 'creative' | 'canvas'; href: string }

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '继续编辑' : `${new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)} 更新`
}

function projectCover(project: DramaProjectSummary) {
  return project.cover?.kind === 'video' ? '' : project.cover?.url || project.coverUrl || ''
}

/** 展示服务端创作项目和已有画布，不把节点数量伪装成镜头数或生成进度。 */
export function RecentWorks() {
  const { state } = useStudio()
  const [dramas, setDramas] = useState<DramaProjectSummary[]>([])
  const [loadedFor, setLoadedFor] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const connected = state.backendStatus === 'connected'

  useEffect(() => subscribeAccountData(() => setRevision((value) => value + 1)), [])
  useEffect(() => {
    let disposed = false
    setDramas([])
    setLoadedFor('')
    setError('')
    if (!connected) { setLoading(false); return }
    setLoading(true)
    void listDramaProjects().then((result) => {
      if (!disposed) { setDramas(result.projects ?? []); setLoadedFor(state.user.id) }
    }).catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : '项目读取失败')
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [connected, state.user.id, revision])

  const projects: RecentProject[] = connected ? [
    ...(loadedFor === state.user.id ? dramas : []).map((project): RecentProject => ({ id: project.id, title: project.title, cover: projectCover(project), updatedAt: project.updatedAt, kind: 'creative', href: `/projects/${encodeURIComponent(project.id)}` })),
    ...state.projects.map((project): RecentProject => ({ id: project.id, title: project.title, cover: project.cover, updatedAt: project.updatedAt, kind: 'canvas', href: `/canvas/${encodeURIComponent(project.id)}` })),
  ].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)).slice(0, 4) : []

  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="recent-title" className="text-sm font-semibold text-foreground">接着上次的想法</h2>
          <p className="mt-1 text-xs text-muted-foreground">最近编辑的项目与画布。</p>
        </div>
        <Link href="/projects" className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">全部项目<ArrowRight className="size-3.5" aria-hidden="true" /></Link>
      </div>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"><p className="text-muted-foreground">部分项目暂时无法读取：{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted"><RefreshCw className="size-3.5" aria-hidden="true" />重新读取</button></div>}
      {projects.length ? (
        <ul aria-label="最近项目列表" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          {projects.map((project) => {
            const Icon = project.kind === 'creative' ? Clapperboard : PanelsTopLeft
            return <li key={`${project.kind}-${project.id}`} className="min-w-0"><Link href={project.href} className="studio-surface group flex h-full flex-col overflow-hidden transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"><MediaThumb src={project.cover} alt="" fallback={project.title} className="aspect-[16/10] w-full shrink-0" /><span className="flex min-w-0 flex-1 flex-col gap-2 p-3.5"><span className="truncate text-sm font-medium">{project.title}</span><span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3" aria-hidden="true" />{project.kind === 'creative' ? '创作项目' : '自由画布'}<span className="ml-auto">{dateLabel(project.updatedAt)}</span></span></span></Link></li>
          })}
        </ul>
      ) : loading || state.backendStatus === 'checking' ? <p role="status" className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">正在读取最近项目…</p> : !error && (
        <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center">
          <p className="text-sm font-medium">{connected ? '第一件作品，从这里开始' : state.backendStatus === 'offline' ? '暂时无法读取最近项目' : '登录后继续你的项目'}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{connected ? '选择「做一件完整作品」，保存提纲和参考，开始整理镜头。' : state.backendStatus === 'offline' ? '服务暂时不可用，恢复连接后即可继续。' : '项目、参考素材和创作记录会跟随你的账户保存。'}</p>
        </div>
      )}
    </section>
  )
}
