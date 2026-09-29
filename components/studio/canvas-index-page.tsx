'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, LayoutPanelTop, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStudio } from '@/lib/studio/store'
import { ControlButton, EmptyState, MediaThumb, StatusBadge } from './ui'

/** 画布管理页：用户先看到自己的画布，再决定进入哪一个，不自动跳到演示项目。 */
export function CanvasIndexPage() {
  const router = useRouter()
  const { state, createProject, deleteProject } = useStudio()
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function createCanvas() {
    if (creating) return
    const name = title.trim() || '未命名画布'
    setCreating(true)
    setError('')
    try {
      const project = await createProject(name)
      router.push(`/canvas/${project.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建画布失败')
    } finally {
      setCreating(false)
    }
  }

  async function removeCanvas(id: string) {
    if (deleting) return
    if (!window.confirm('删除后无法恢复，确定删除这张画布吗？')) return
    setDeleting(id)
    setError('')
    try {
      await deleteProject(id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除画布失败')
    } finally {
      setDeleting(null)
    }
  }

  if (state.backendStatus === 'checking' || !state.hydrated) {
    return <div className="flex min-h-[60vh] items-center justify-center px-4"><p className="text-sm text-muted-foreground" role="status">正在加载你的画布…</p></div>
  }

  if (state.backendStatus === 'unauthenticated') {
    return <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-10"><EmptyState title="请先登录" description="画布需要绑定属于你的项目，登录后即可创建并进入。" action={<ControlButton variant="primary" onClick={() => router.push('/login')}>去登录</ControlButton>} /></div>
  }

  return (
    <div className="oao-canvas-index mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-studio-accent">创作空间</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">自由画布</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">把参考素材、文字、生成任务和 Agent 连接在同一张自由画布上。</p></div>
        <ControlButton variant="primary" onClick={() => { setCreateOpen((value) => !value); setTitle(''); setError('') }}><Plus className="size-4" aria-hidden="true" />新建画布</ControlButton>
      </header>

      {createOpen && <form className="oao-canvas-create-bar lg-glass flex flex-col gap-3 p-3 sm:flex-row sm:items-center" onSubmit={(event) => { event.preventDefault(); void createCanvas() }}><LayoutPanelTop className="hidden size-5 shrink-0 text-studio-accent sm:block" aria-hidden="true" /><label htmlFor="new-canvas-title" className="sr-only">画布名称</label><input id="new-canvas-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给这张画布起个名字，例如：品牌主视觉" className="studio-field h-10 min-w-0 flex-1 border border-border bg-background/60 px-3 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /><div className="flex shrink-0 gap-2"><ControlButton type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>取消</ControlButton><ControlButton type="submit" variant="primary" size="sm" disabled={creating}>{creating ? '创建中…' : '进入画布'}<ArrowRight className="size-3.5" aria-hidden="true" /></ControlButton></div></form>}
      {error && <p className="studio-notice studio-notice-warning" role="alert">{error}</p>}

      {state.projects.length ? <section aria-label="我的画布" className="oao-canvas-index-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{state.projects.map((project) => <article key={project.id} className="oao-canvas-index-card group lg-glass overflow-hidden"><Link href={`/canvas/${project.id}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/70"><div className="relative aspect-[16/9] overflow-hidden bg-muted">{project.cover ? <MediaThumb src={project.cover} alt={project.title} fallback={project.title} className="h-full w-full [&_img]:transition-transform [&_img]:duration-500 group-hover:[&_img]:scale-105" /> : <div className="oao-canvas-empty-cover"><Sparkles aria-hidden="true" /><span>从空白画布开始</span></div>}<span className="absolute left-3 top-3"><StatusBadge solid tone="accent">自由画布</StatusBadge></span></div><div className="flex items-start gap-3 p-4"><span className="oao-canvas-index-icon"><LayoutPanelTop aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold text-foreground">{project.title}</strong><span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />{project.updatedAt}更新 · {project.shotCount} 个节点</span></span><ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" aria-hidden="true" /></div></Link><div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5"><span className="text-[11px] text-muted-foreground">节点、素材与任务会自动保存</span><button type="button" aria-label={`删除${project.title}`} title="删除画布" className="oao-canvas-index-delete rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" disabled={deleting === project.id} onClick={() => void removeCanvas(project.id)}><Trash2 className="size-3.5" aria-hidden="true" /></button></div></article>)}</section> : <EmptyState title="还没有画布" description="创建第一张画布，把生成、参考素材和 Agent 放在一起工作。" action={<ControlButton variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden="true" />创建第一张画布</ControlButton>} />}
    </div>
  )
}
