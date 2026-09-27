'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Clapperboard, FileText, Loader2, Save, Sparkles, Users, WandSparkles } from 'lucide-react'
import { getDramaProject, saveDramaProject } from '@/lib/studio/api'
import type { DramaEpisode, DramaProject } from '@/lib/studio/drama-types'
import { ControlButton, EmptyState, Notice, SectionHeading, StatusBadge } from './ui'

type DetailTab = 'script' | 'storyboard' | 'assets'

function activeEpisode(project: DramaProject | null, id: string) {
  if (!project?.episodes?.length) return null
  return project.episodes.find((episode) => episode.id === id) ?? project.episodes[0]
}

function episodeScript(episode: DramaEpisode | null) {
  return episode?.script || episode?.outline || ''
}

export function DramaDetailPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<DramaProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<DetailTab>('script')
  const [episodeId, setEpisodeId] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [style, setStyle] = useState('')
  const [script, setScript] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void getDramaProject(projectId).then((loaded) => {
      if (cancelled) return
      setProject(loaded)
      setTitle(loaded.title)
      setSummary(loaded.summary)
      setStyle(loaded.style)
      const first = loaded.episodes?.find((episode) => episode.id === loaded.activeEpisodeId) ?? loaded.episodes?.[0]
      setEpisodeId(first?.id ?? '')
      setScript(episodeScript(first ?? null))
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '短剧项目加载失败')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [projectId])

  const episode = useMemo(() => activeEpisode(project, episodeId), [episodeId, project])

  function selectEpisode(nextId: string) {
    const next = activeEpisode(project, nextId)
    setEpisodeId(nextId)
    setScript(episodeScript(next))
    setNotice('')
  }

  async function save() {
    if (!project || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const nextEpisodes = project.episodes.map((item) => item.id === episode?.id ? { ...item, script } : item)
      const saved = await saveDramaProject(project.id, { ...project, title: title.trim() || project.title, summary, style, activeEpisodeId: episode?.id ?? project.activeEpisodeId, episodes: nextEpisodes }, project.updatedAt)
      setProject(saved)
      setNotice('已保存，刷新页面后内容仍会保留。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '短剧项目保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="mx-auto flex min-h-[calc(100dvh-60px)] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在加载短剧项目…</div>

  if (!project) return <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-5 py-16"><div className="studio-surface p-7 text-center"><p className="text-sm font-semibold text-foreground">无法打开短剧项目</p><p className="mt-2 text-xs leading-5 text-destructive">{error || '项目不存在或不属于当前账号。'}</p><Link href="/drama" className="mt-5 inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted">返回短剧制作</Link></div></div>

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 py-5 md:px-7 md:py-7">
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href="/drama" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />短剧制作</Link>
          <div className="mt-3 flex items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-studio-accent/20 bg-studio-accent/10 text-studio-accent"><Clapperboard className="size-5" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-semibold tracking-[-0.035em] text-foreground md:text-2xl">{title || project.title}</h1><StatusBadge tone={project.status === 'archived' ? 'muted' : 'accent'}>{project.status === 'archived' ? '已归档' : '进行中'}</StatusBadge></div><p className="mt-1 truncate text-xs text-muted-foreground">{summary || '还没有填写故事简介'}</p></div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><ControlButton variant="secondary" onClick={() => setTab('assets')}><Users className="size-3.5" />角色与素材</ControlButton><ControlButton variant="primary" onClick={() => void save()} disabled={saving}><Save className="size-3.5" />{saving ? '正在保存' : '保存项目'}</ControlButton></div>
      </header>

      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success"><Check className="mr-1.5 inline size-4" />{notice}</Notice>}

      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
        <aside className="studio-surface h-fit p-2" aria-label="短剧分集">
          <p className="px-2.5 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">分集</p>
          <div className="space-y-1">{project.episodes.map((item, index) => <button key={item.id} type="button" onClick={() => selectEpisode(item.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${item.id === episode?.id ? 'bg-studio-accent/12 text-studio-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current/25 text-[10px]">{item.episodeNumber ?? index + 1}</span><span className="min-w-0 flex-1 truncate">{item.title || `第 ${index + 1} 集`}</span></button>)}</div>
          {project.episodes.length === 0 && <p className="px-2.5 py-4 text-xs leading-5 text-muted-foreground">还没有分集，可以先回到列表生成大纲。</p>}
        </aside>

        <main className="min-w-0">
          <div className="studio-segmented flex w-fit max-w-full items-center gap-1 border border-border bg-muted p-1" role="tablist" aria-label="短剧工作区"><button type="button" role="tab" aria-selected={tab === 'script'} onClick={() => setTab('script')} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${tab === 'script' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><FileText className="size-3.5" />剧本</button><button type="button" role="tab" aria-selected={tab === 'storyboard'} onClick={() => setTab('storyboard')} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${tab === 'storyboard' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><Clapperboard className="size-3.5" />分镜</button><button type="button" role="tab" aria-selected={tab === 'assets'} onClick={() => setTab('assets')} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${tab === 'assets' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><Users className="size-3.5" />角色与场景</button></div>
          {tab === 'script' && <section className="studio-surface mt-4 p-4 md:p-5"><SectionHeading title={episode?.title || '剧本正文'} description={episode ? '在这里直接编辑当前分集，保存后写回短剧项目。' : '当前项目还没有分集正文。'} /><textarea value={script} onChange={(event) => setScript(event.target.value)} disabled={!episode} placeholder="输入这一集的剧本正文、场景和对白…" className="studio-field mt-4 min-h-[420px] w-full resize-y border border-border bg-card px-3 py-3 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15 disabled:cursor-not-allowed disabled:opacity-60" /></section>}
          {tab === 'storyboard' && <section className="mt-4 space-y-3"><SectionHeading title="分镜" description="镜头生成和状态都留在当前短剧项目内。" />{episode?.shots?.length ? episode.shots.map((shot, index) => <article key={shot.id} className="studio-surface p-4"><div className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-foreground">{shot.title || `镜头 ${index + 1}`}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{shot.description || shot.imagePrompt || '还没有镜头描述。'}</p></div><StatusBadge tone={shot.generationStatus === 'success' ? 'success' : shot.generationStatus === 'error' ? 'danger' : 'muted'}>{shot.generationStatus === 'success' ? '已完成' : shot.generationStatus === 'error' ? '需重试' : '待生成'}</StatusBadge></div></article>) : <EmptyState title="还没有分镜" description="先在剧本页完善当前分集，后续可在这里继续整理镜头。" action={<ControlButton variant="secondary" size="sm" onClick={() => setTab('script')}><FileText className="size-3.5" />编辑剧本</ControlButton>} />}</section>}
          {tab === 'assets' && <section className="mt-4 space-y-3"><SectionHeading title="角色与场景" description="短剧资产独立于自由画布和通用素材库。" /><div className="grid gap-3 sm:grid-cols-3"><div className="studio-surface p-4"><p className="text-xs text-muted-foreground">角色</p><p className="mt-2 text-2xl font-semibold text-foreground">{project.characters.length}</p></div><div className="studio-surface p-4"><p className="text-xs text-muted-foreground">场景</p><p className="mt-2 text-2xl font-semibold text-foreground">{project.scenes.length}</p></div><div className="studio-surface p-4"><p className="text-xs text-muted-foreground">道具</p><p className="mt-2 text-2xl font-semibold text-foreground">{project.props.length}</p></div></div><EmptyState title="资产编辑区已就绪" description="角色与场景会随着剧本拆解逐步补充，当前数据会随项目一起保存。" /></section>}
        </main>

        <aside className="space-y-4">
          <section className="studio-surface p-4"><SectionHeading title="项目设置" /><div className="mt-4 space-y-3"><label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">项目名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} className="studio-field h-9 w-full border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /></label><label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">故事简介</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="studio-field min-h-20 w-full resize-y border border-border bg-card px-3 py-2 text-sm leading-5 text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /></label><label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">视觉风格</span><input value={style} onChange={(event) => setStyle(event.target.value)} className="studio-field h-9 w-full border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" /></label><p className="text-xs leading-5 text-muted-foreground">比例：<span className="font-medium text-foreground">{project.ratio || '9:16'}</span></p></div></section>
          <section className="lg-glass rounded-xl border border-border p-4"><div className="flex items-center gap-2"><WandSparkles className="size-4 text-studio-accent" /><h2 className="text-sm font-semibold text-foreground">独立生产线</h2></div><p className="mt-2 text-xs leading-5 text-muted-foreground">短剧项目在这里完成剧本、分镜和资产整理。自由画布是另一套独立的生成系统，不会把节点偷偷送到其他页面。</p><div className="mt-3 flex items-start gap-2 text-xs text-success"><Check className="mt-0.5 size-3.5 shrink-0" />保存后刷新仍可继续编辑</div></section>
        </aside>
      </div>
    </div>
  )
}
