'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Clapperboard, FileText, Loader2, Plus, RefreshCw } from 'lucide-react'
import { createDramaProject, listDramaProjects, type DramaProjectSummary } from '@/lib/studio/api'
import { cn } from '@/lib/utils'
import { ControlButton, EmptyState, Notice, PageHeader, SectionHeading, StatusBadge } from './ui'
import { dramaField, DramaField } from './drama-editors'
import { dramaWorkspaceStages } from '@/lib/studio/drama-production'

export function DramaPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<DramaProjectSummary[]>([]), [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState(''), [sourceText, setSourceText] = useState(''), [style, setStyle] = useState('电影感写实')
  const [ratio, setRatio] = useState('9:16'), [targetEpisodes, setTargetEpisodes] = useState(5), [episodeSeconds, setEpisodeSeconds] = useState(60)
  const createLock = useRef(false), handoff = useRef('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const result = await listDramaProjects(); setProjects(result.projects || []); setTotal(result.total || 0) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '短剧项目加载失败') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  async function create() {
    if (!title.trim() || createLock.current) return
    createLock.current = true; setCreating(true); setError('')
    if (!handoff.current) handoff.current = `drama-create:${crypto.randomUUID()}`
    try {
      const project = await createDramaProject({ title: title.trim(), summary: sourceText.trim().slice(0, 1000), style, ratio, sourceHandoffId: handoff.current, brief: { sourceText: sourceText.trim(), genre: '', audience: '', tone: '', targetEpisodes, episodeSeconds } })
      router.push(`/drama/${encodeURIComponent(project.id)}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '短剧项目创建失败') }
    finally { createLock.current = false; setCreating(false) }
  }
  return <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-6 px-4 py-5 md:px-7 md:py-7">
    <PageHeader eyebrow="短剧制作" title="把故事，拍成一部短剧。" description="从原文分析到分集剧本、角色设定、镜头设计和成片，按你的节奏逐步完成。" actions={<ControlButton variant="primary" size="lg" onClick={() => setCreateOpen(value => !value)}><Plus className="size-4" />{createOpen ? '收起创建' : '新建短剧'}</ControlButton>} />
    <div className="grid grid-cols-3 gap-3">{[['全部短剧', total], ['进行中', projects.filter(project => project.status !== 'archived').length], ['已记录镜头', projects.reduce((sum, project) => sum + (project.shotCount || 0), 0)]].map(([label, value]) => <div key={label} className="studio-surface rounded-xl p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
    {createOpen && <section className="studio-surface rounded-2xl p-4 sm:p-6" aria-labelledby="drama-create-title" data-testid="drama-create-panel"><SectionHeading title="创建短剧项目" description="先保存故事资料，进入项目后逐步分析、拆集和制作。" /><div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"><div className="space-y-4"><DramaField label="项目名称" value={title} onChange={setTitle} placeholder="为这个故事起个名字" /><DramaField label="故事原文 / 一句话创意" rows={8} value={sourceText} onChange={value => setSourceText(value.slice(0, 100000))} placeholder="粘贴故事原文，或先写下你的故事创意。进入项目后可以继续完善。" /></div><div className="space-y-4"><DramaField label="视觉风格" value={style} onChange={setStyle} /><div className="grid gap-4 sm:grid-cols-2"><DramaField label="目标集数" type="number" min={1} max={60} value={targetEpisodes} onChange={value => setTargetEpisodes(Math.max(1, Math.min(60, Number(value) || 1)))} /><DramaField label="单集时长（秒）" type="number" min={5} max={1800} value={episodeSeconds} onChange={value => setEpisodeSeconds(Math.max(5, Math.min(1800, Number(value) || 60)))} /></div><label className="block text-xs font-medium">画面比例<select value={ratio} onChange={event => setRatio(event.target.value)} className={cn(dramaField, 'studio-select mt-1.5')}><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></label><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs font-medium">接下来，你可以</p><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">{dramaWorkspaceStages.map((stage, index) => <span key={stage.id} className="text-xs text-muted-foreground"><span className="mr-2 text-studio-accent">{index + 1}</span>{stage.label}</span>)}</div></div></div></div><div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4"><ControlButton onClick={() => setCreateOpen(false)} disabled={creating}>取消</ControlButton><ControlButton variant="primary" onClick={() => void create()} disabled={!title.trim() || creating}>{creating ? <Loader2 className="size-3.5 animate-spin" /> : <Clapperboard className="size-3.5" />}{creating ? '正在创建' : '创建并进入制作'}</ControlButton></div></section>}
    {error && <Notice tone="danger">{error}</Notice>}
    <section><SectionHeading title="我的短剧" description="故事、分集、角色和镜头独立保存在各自项目中。" action={<ControlButton variant="ghost" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />刷新</ControlButton>} />
      {loading ? <p className="flex min-h-44 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在加载短剧项目…</p> : !projects.length ? <div className="mt-4"><EmptyState title="从第一个故事开始" description="创建项目后，每一步都可以手动编辑，也可以让 AI 协助完成。" action={<ControlButton variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-3.5" />新建短剧</ControlButton>} /></div> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{projects.map(project => <Link key={project.id} href={`/drama/${encodeURIComponent(project.id)}`} className="studio-surface studio-surface-interactive group min-w-0 rounded-2xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-studio-accent/8 text-studio-accent"><Clapperboard className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h3 className="truncate text-sm font-semibold">{project.title}</h3><StatusBadge tone={project.status === 'archived' ? 'muted' : 'accent'}>{project.status === 'archived' ? '已归档' : '进行中'}</StatusBadge></div><p className="mt-2 text-xs text-muted-foreground">继续剧本、镜头与制作</p></div></div><div className="mt-5 flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground"><span><FileText className="mr-1 inline size-3.5" />{project.shotCount || 0} 镜头</span><span><CalendarDays className="mr-1 inline size-3.5" />{new Date(project.updatedAt || project.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span><span className="ml-auto text-studio-accent">进入制作 →</span></div></Link>)}</div>}
    </section>
  </div>
}
