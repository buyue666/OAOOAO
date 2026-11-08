'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Box, Check, ChevronDown, Clapperboard, FolderOpen, Image as ImageIcon, Info, LayoutDashboard, Library, Loader2, Paperclip, Puzzle, ScanLine, Search, Shirt, ShoppingBag, Sparkles, UserRound, X } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { useUiText } from '@/lib/studio/i18n'
import { useLibraryAssets } from '@/lib/studio/use-account-data'
import { libraryAssetToReferenceAsset } from '@/lib/studio/reference-assets'
import { toggleCanvasSkill, type CanvasSkill } from '@/lib/studio/canvas-skills'
import { directorScenes, directorStarters, type DirectorScene } from '@/lib/studio/director-workspace'
import { assistantContextLabel, type AssistantContext } from '@/lib/studio/director-context'
import type { AgentRun } from '@/lib/studio/generation-types'
import { cn } from '@/lib/utils'
import { CanvasSkillLibrary } from '@/components/free-canvas/canvas-skill-library'
import { PromptReferenceInput } from './prompt-reference-input'
import { ReferenceLibraryDialog } from './workspace-kit'
import { ControlButton, Modal, Tooltip } from './ui'

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const toolClass = cn('inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9', focus)

export type DirectorReference = { id: string; title: string; file?: File; preview?: string; uploaded?: { key: string; url: string; bytes: number; mimeType: string }; assetId?: string; status: 'uploading' | 'ready' | 'error'; error?: string }
export type DirectorDraft = { input: string; refs: DirectorReference[]; skills: CanvasSkill[]; scene: DirectorScene }

export function DirectorComposer({ inputId, draft, setInput, setSkills, context, disabled, canSubmit, submitting, connected, canPlan, onSubmit, onUpload, onRemoveReference, onRetryUpload, onPickReference, onSelectProject, error, recovery, storageNotice, compact = false }: {
  inputId: string; draft: DirectorDraft; setInput: (value: string) => void; setSkills: (skills: CanvasSkill[]) => void; context: AssistantContext;
  disabled: boolean; canSubmit: boolean; submitting: boolean; connected: boolean; canPlan: boolean;
  onSubmit: () => void; onUpload: () => void; onRemoveReference: (id: string) => void; onRetryUpload: (reference: DirectorReference) => void;
  onPickReference: (asset: { id: string; title: string; src: string }) => void; onSelectProject?: (id?: string) => void;
  error?: string; recovery?: ReactNode; storageNotice?: ReactNode; compact?: boolean;
}) {
  const { state } = useStudio()
  const tx = useUiText()
  const [picker, setPicker] = useState<'assets' | 'skills' | 'project' | null>(null)
  const [projectKeyword, setProjectKeyword] = useState('')
  const scene = directorScenes.find(item => item.id === draft.scene) ?? directorScenes[0]
  const projects = state.backendStatus === 'connected' ? state.projects.filter(project => `${project.title} ${project.description}`.toLowerCase().includes(projectKeyword.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : []
  const closePicker = () => setPicker(null)
  return <>
    <form onSubmit={event => { event.preventDefault(); onSubmit() }} className={cn('agent-composer min-w-0', compact && 'agent-composer-compact')}>
      {error && <p role="alert" className="mb-3 rounded-xl border border-studio-warn/25 bg-studio-warn/8 p-3 text-xs leading-5">{error}</p>}
      {storageNotice}
      {recovery}
      <div className="overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-[0_8px_32px_color-mix(in_srgb,var(--foreground)_4%,transparent)] focus-within:border-studio-accent/50 focus-within:ring-2 focus-within:ring-studio-accent/10 sm:rounded-[22px] sm:p-4">
        {(draft.refs.length > 0 || draft.skills.length > 0) && <div className="mb-3 flex flex-wrap gap-2" aria-label={tx('已选择的素材与技能')}>
          {draft.refs.map((reference, index) => <div key={reference.id} className="max-w-full rounded-lg border border-border bg-muted/35 p-1.5 text-xs">
            <div className="flex items-center gap-2">
              {reference.preview ? <img src={reference.preview} alt="" className="size-8 rounded object-contain" loading="lazy" /> : <ImageIcon className="m-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0"><span className="prompt-reference-mention rounded px-1 py-0.5">@图{index + 1}</span><span className="mt-1 block max-w-36 truncate text-[11px] text-muted-foreground" title={reference.title}>{reference.title}</span></span>
              {reference.status === 'uploading' ? <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-label={tx('上传中')} /> : reference.status === 'error' ? <button type="button" className={cn('min-h-9 px-1 text-destructive underline', focus)} disabled={!connected || disabled} onClick={() => onRetryUpload(reference)}>{tx('重试')}</button> : <Check className="size-3.5 shrink-0 text-studio-accent" aria-label={tx('已就绪')} />}
              <button type="button" disabled={disabled} onClick={() => onRemoveReference(reference.id)} aria-label={tx('移除参考 {0}', [reference.title])} className={cn('flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40', focus)}><X className="size-3.5" /></button>
            </div>
            {reference.error && <p role="alert" className="mt-1 max-w-64 text-xs text-destructive">{reference.error}</p>}
          </div>)}
          {draft.skills.map(skill => <span key={skill.id} className="inline-flex max-w-full items-center gap-1.5 self-start rounded-lg bg-studio-accent/10 px-2 py-1 text-xs text-studio-accent"><Puzzle className="size-3.5 shrink-0" aria-hidden="true" /><span className="max-w-40 truncate" title={skill.title}>{skill.title}</span><button type="button" disabled={disabled} onClick={() => setSkills(draft.skills.filter(item => item.id !== skill.id))} aria-label={tx('移除技能 {0}', [skill.title])} className={cn('flex size-8 shrink-0 items-center justify-center rounded hover:bg-studio-accent/10 disabled:opacity-40', focus)}><X className="size-3.5" /></button></span>)}
        </div>}
        <label htmlFor={inputId} className="sr-only">{tx('告诉创作助手你的想法')}</label>
        <PromptReferenceInput id={inputId} value={draft.input} onChange={value => setInput(value.slice(0, 4000))} references={draft.refs.map(reference => ({ id: reference.id, name: reference.title, type: 'image', preview: reference.preview, ready: reference.status === 'ready' }))} disabled={disabled} compact={compact} appearance="composer" placeholder={tx(context.projectTitle ? '针对这个项目，你想探索或调整什么？' : scene.placeholder)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit() } }} />
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/50 pt-2.5">
          <button type="button" className={toolClass} onClick={onUpload} disabled={disabled || !connected || draft.refs.length >= 4}><Paperclip className="size-4" aria-hidden="true" />{tx('上传')}</button>
          <button type="button" className={toolClass} onClick={() => setPicker('assets')} disabled={disabled || !connected}><Library className="size-4" aria-hidden="true" />{tx('素材库')}{draft.refs.length > 0 && <span className="text-[10px]">{draft.refs.length}/4</span>}</button>
          <button type="button" className={toolClass} onClick={() => setPicker('skills')} disabled={disabled || !connected}><Puzzle className="size-4" aria-hidden="true" />{tx('技能')}{draft.skills.length > 0 && <span>{draft.skills.length}</span>}</button>
          {onSelectProject && <button type="button" className={cn(toolClass, context.projectId && 'text-studio-accent')} onClick={() => setPicker('project')} disabled={disabled || !connected || draft.refs.some(reference => reference.status === 'uploading')}><FolderOpen className="size-4" aria-hidden="true" /><span>{tx(context.projectId ? '切换项目' : '关联项目')}</span><ChevronDown className="size-3" aria-hidden="true" /></button>}
          <span className="flex-1" />
          <button type="submit" disabled={!canSubmit} className={cn('ml-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-studio-accent px-4 text-xs font-semibold text-studio-accent-foreground shadow-sm transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40 max-[480px]:mt-1 max-[480px]:w-full sm:min-h-10', focus)}>{submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{tx(submitting ? '正在提交' : '生成任务方案')}</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-2 px-1 text-[11px] leading-5 text-muted-foreground">
        <span className="inline-flex min-w-0 items-start gap-1.5"><FolderOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{assistantContextLabel(context)}</span></span>
        <Tooltip label={tx('文字规划单独计费；查看方案后，再确认后续生成步骤。')}><span className="inline-flex items-center gap-1"><Info className="size-3.5" aria-hidden="true" />{tx('规划与生成分开计费')}</span></Tooltip>
      </div>
      {!connected || !canPlan ? <p role="status" className="mt-2 px-1 text-xs leading-5 text-muted-foreground">{!connected ? state.backendStatus === 'unauthenticated' ? <Link href="/login" className="underline">{tx('登录后使用创作助手')}</Link> : tx('服务暂不可用，恢复连接后可提交。') : <>{tx('暂未配置可用的文字规划模型。')}{state.user.role === 'admin' ? <Link href="/admin/channels" className="ml-1 text-studio-accent underline">{tx('前往模型设置')}</Link> : tx('请联系管理员。')}</>}</p> : <p className="mt-2 px-1 text-[11px] leading-5 text-muted-foreground">{tx('输入 @ 引用素材 · Ctrl / ⌘ + Enter 提交 · 最多 4 张参考图')}</p>}
    </form>
    {picker === 'assets' && <DirectorAssetDialog selected={draft.refs} onClose={closePicker} onToggle={onPickReference} />}
    <Modal open={picker === 'skills'} title={tx('选择创作技能')} description={tx('选择的技能会用于本次规划，提交前可以移除。')} onClose={closePicker} className="sm:max-w-2xl" footer={<ControlButton onClick={closePicker}>{tx('完成选择')}</ControlButton>}>
      {picker === 'skills' && <CanvasSkillLibrary selected={draft.skills} onToggle={skill => setSkills(toggleCanvasSkill(draft.skills, skill))} />}
    </Modal>
    <Modal open={picker === 'project'} title={tx('关联项目')} description={tx('关联后读取该项目的已有上下文；对话记录按项目独立保存。')} onClose={closePicker} className="sm:max-w-xl">
      <label className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-background px-3"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label={tx('搜索项目')} placeholder={tx('搜索项目')} value={projectKeyword} onChange={event => setProjectKeyword(event.target.value)} /></label>
      <div className="space-y-2"><button type="button" onClick={() => { closePicker(); onSelectProject?.() }} className={cn('flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm', !context.projectId ? 'border-studio-accent bg-studio-accent/5' : 'border-border hover:bg-muted', focus)}>{tx('不关联项目')}{!context.projectId && <Check className="size-4 shrink-0 text-studio-accent" aria-label={tx('已选择')} />}</button>
        {projects.map(project => <button type="button" key={project.id} onClick={() => { closePicker(); onSelectProject?.(project.id) }} className={cn('flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left', context.projectId === project.id ? 'border-studio-accent bg-studio-accent/5' : 'border-border hover:bg-muted', focus)}><FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{project.title}</span>{project.description && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{project.description}</span>}</span>{context.projectId === project.id && <Check className="size-4 shrink-0 text-studio-accent" aria-label={tx('已选择')} />}</button>)}
        {!projects.length && <p className="py-6 text-center text-sm text-muted-foreground">{tx(projectKeyword ? '没有匹配的项目。' : '还没有项目，可以先在这里描述创作需求。')}</p>}
      </div>
    </Modal>
  </>
}

function DirectorAssetDialog({ selected, onClose, onToggle }: { selected: DirectorReference[]; onClose: () => void; onToggle: (asset: { id: string; title: string; src: string }) => void }) {
  const tx = useUiText()
  const [keyword, setKeyword] = useState('')
  const library = useLibraryAssets({ kind: 'image', keyword, pageSize: 60 })
  const assets = useMemo(() => library.assets.map(libraryAssetToReferenceAsset).filter(asset => asset.src), [library.assets])
  return <ReferenceLibraryDialog open title={tx('选择参考图片')} onClose={onClose} assets={assets} selectedIds={selected.flatMap(reference => reference.assetId ? [reference.assetId] : [])} onToggle={(_, asset) => onToggle(asset)} maxReferences={Math.max(0, 4 - selected.filter(reference => !reference.assetId).length)} libraryState={library.state} libraryMessage={library.message} libraryTotal={library.total} onReload={() => void library.reload()} onLoadMore={library.hasMore ? () => void library.loadMore() : undefined} loadingMore={library.loadingMore} onSearch={setKeyword} serverSearch />
}

export function DirectorWorkspaceView({ scene, onScene, onStarter, composer, conversation, panel, runs, selectedRunId, onSelectRun, hasMessages, clearButton, children }: {
  scene: DirectorScene; onScene: (value: DirectorScene) => void; onStarter: (scene: DirectorScene, prompt: string) => void;
  composer: ReactNode; conversation: ReactNode; panel: ReactNode; runs: Array<{ id: string; title: string; status?: AgentRun['status'] }>;
  selectedRunId?: string; onSelectRun: (id: string) => void; hasMessages: boolean; clearButton: ReactNode; children?: ReactNode;
}) {
  const tx = useUiText()
  const { state } = useStudio()
  const selectedScene = directorScenes.find(item => item.id === scene) ?? directorScenes[0]
  const recent = state.backendStatus === 'connected' ? [...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3) : []
  const starterIcons = [Clapperboard, ShoppingBag, UserRound]
  const tools = [
    { label: '图片生成', href: '/image', icon: ImageIcon }, { label: '视频生成', href: '/video', icon: Clapperboard },
    { label: '自由画布', href: '/canvas', icon: LayoutDashboard }, { label: '图片复刻', href: '/tools/remix', icon: ScanLine },
    { label: 'AI 换装', href: '/tools/tryon', icon: Shirt }, { label: '3D 导演台', href: '/projects', icon: Box },
  ]
  return <section className={cn('agent-workspace flex min-h-0 w-full flex-1 flex-col', hasMessages ? 'gap-4' : 'gap-0')} aria-label={tx('创作助手')}>
    {hasMessages ? <>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-studio-accent">{tx('创作助手')}</p><h1 className="mt-1 text-xl font-semibold tracking-tight">{tx('把想法，变成下一步。')}</h1></div>{clearButton}</header>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,.85fr)_minmax(0,1.15fr)]">
        <div className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-border bg-card/60 lg:overflow-hidden"><div className="border-b border-border px-4 py-3 text-xs font-medium">{tx('对话与需求')}</div>{conversation}<div className="shrink-0 border-t border-border p-3">{composer}</div></div>
        <div className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-border bg-card lg:overflow-hidden"><div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border p-4"><h2 className="text-sm font-semibold">{tx('任务方案与结果')}</h2><label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="sr-only">{tx('选择任务方案')}</span><select className="max-w-[240px] min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" value={selectedRunId || ''} onChange={event => onSelectRun(event.target.value)} aria-label={tx('选择任务方案')}>{runs.map((run, index) => <option key={run.id} value={run.id}>{index + 1}. {run.title.slice(0, 45)}</option>)}</select></label></div><div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{panel}</div></div>
      </div>
    </> : <div className="w-full pb-8">
      <div role="group" aria-label={tx('创作场景')} className="mx-auto flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-2xl bg-muted/50 p-1">
        {directorScenes.map(item => <button type="button" key={item.id} aria-pressed={scene === item.id} onClick={() => onScene(item.id)} className={cn('min-h-11 rounded-xl border px-3.5 text-xs transition-colors sm:min-h-9 sm:px-5', scene === item.id ? 'border-border bg-card font-semibold text-studio-accent shadow-sm' : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground', focus)}>{tx(item.label)}</button>)}
      </div>
      <header className="mx-auto flex max-w-3xl flex-col items-center pb-7 pt-10 text-center sm:pt-14"><p className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-studio-accent"><Sparkles className="size-4" aria-hidden="true" />{tx('你的创作搭档')}</p><h1 className="text-balance text-3xl font-semibold tracking-[-.04em] sm:text-4xl">{tx(selectedScene.title)}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{tx(selectedScene.description)}</p></header>
      <div className="mx-auto max-w-[920px]">{composer}</div>
      <nav aria-label={tx('常用创作工具')} className="mx-auto flex max-w-[960px] flex-wrap justify-center gap-2 py-7">{tools.map(tool => <Link key={tool.href} href={tool.href} className={cn('inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-xs text-foreground transition-colors hover:border-studio-accent/50 hover:bg-studio-accent/5 sm:min-h-10', focus)}><tool.icon className="size-4 text-muted-foreground" aria-hidden="true" />{tx(tool.label)}<ArrowUpRight className="size-3 text-muted-foreground/60" aria-hidden="true" /></Link>)}</nav>
      <section className="mx-auto max-w-[1100px] pt-4" aria-label={tx(recent.length ? '最近项目' : '创作起点')}>
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-medium">{tx(recent.length ? '继续你的创作' : '试试这样开始')}</h2>{recent.length > 0 ? <Link href="/projects" className={cn('inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground', focus)}>{tx('全部项目')}<ArrowRight className="size-3.5" aria-hidden="true" /></Link> : <span className="text-[11px] text-muted-foreground max-sm:hidden">{tx('先填入需求，再由你确认')}</span>}</div>
        <div className="grid gap-3 sm:grid-cols-3">{recent.length > 0 ? recent.map(project => <Link key={project.id} href={`/projects/${encodeURIComponent(project.id)}`} className={cn('group flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:border-studio-accent/40', focus)}><span className="mb-4 inline-flex size-9 items-center justify-center rounded-xl bg-studio-accent/8 text-studio-accent"><FolderOpen className="size-4" aria-hidden="true" /></span><h3 className="truncate text-sm font-medium" title={project.title}>{project.title}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{project.description || tx('打开项目，继续整理内容与画面。')}</p><span className="mt-4 flex items-center gap-1 text-[11px] text-studio-accent">{tx('继续创作')}<ArrowRight className="size-3" aria-hidden="true" /></span></Link>) : directorStarters.map((starter, index) => { const Icon = starterIcons[index]; return <button type="button" key={starter.scene} onClick={() => onStarter(starter.scene, starter.prompt)} className={cn('group flex min-w-0 flex-col items-start rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-studio-accent/40', focus)}><span className="mb-4 inline-flex size-9 items-center justify-center rounded-xl bg-studio-accent/8 text-studio-accent"><Icon className="size-4" aria-hidden="true" /></span><span className="text-sm font-medium">{tx(starter.title)}</span><span className="mt-1 text-xs leading-5 text-muted-foreground">{tx(starter.description)}</span><ArrowDownLeft className="mt-4 size-4 text-muted-foreground group-hover:text-studio-accent" aria-hidden="true" /></button> })}</div>
        {recent.length > 0 && <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">{directorStarters.map(starter => <button key={starter.scene} type="button" onClick={() => onStarter(starter.scene, starter.prompt)} className={cn('min-h-9 rounded text-xs text-muted-foreground hover:text-studio-accent', focus)}>{tx(starter.title)}<ArrowUpRight className="ml-1 inline size-3" aria-hidden="true" /></button>)}</div>}
      </section>
    </div>}
    {children}
  </section>
}
