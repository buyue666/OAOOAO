'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Bot, Check, ChevronDown, Coins, Image as ImageIcon, MessageSquareText, Paperclip, Puzzle, Sparkles, Video } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { readIntentFiles, saveCreateIntent } from '@/lib/studio/create-intent'
import { cn } from '@/lib/utils'
import { MediaThumb, StatusBadge, Tooltip, type Tone } from './ui'
import { ModelIcon } from './model-icon'

type CreateMode = 'agent' | 'image' | 'video' | 'text' | 'drama'

/**
 * 创作模式 → 目标工作台。
 *
 * 短剧入口使用独立的 `/drama` 生产线；不会借用画布项目上下文。
 */
const modes: Array<{ id: CreateMode; label: string; href: string; icon: typeof Video }> = [
  { id: 'video', label: '视频', href: '/video', icon: Video },
  { id: 'image', label: '图片', href: '/image', icon: ImageIcon },
  { id: 'text', label: '文本', href: '/agent', icon: MessageSquareText },
  { id: 'agent', label: 'Agent', href: '/agent', icon: Bot },
  { id: 'drama', label: '短剧', href: '/drama', icon: Sparkles },
]

const visibleModes = modes.filter((item) => item.id !== 'drama')

const sceneShortcuts: Array<{ title: string; description: string; src: string; prompt: string; mode: CreateMode }> = [
  {
    title: '角色设计',
    description: '形象、服装与表情设定',
    src: '/media/scene-character.png',
    prompt: '设计一位原创年轻探险者角色，补充服装、表情和转身视图，保持角色造型一致',
    mode: 'image',
  },
  {
    title: '产品短片',
    description: '商品展示与镜头运动',
    src: '/media/scene-product.png',
    prompt: '为银色头戴式耳机制作一支产品短片，深色摄影棚，轮廓光，镜头环绕产品移动',
    mode: 'video',
  },
  {
    title: '电影分镜',
    description: '情节节奏与镜头序列',
    src: '/media/scene-storyboard.png',
    prompt: '把一场发生在深夜火车站的重逢戏拆成电影分镜，包含远景、人物反应和细节特写',
    mode: 'drama',
  },
]

/**
 * 演示项目的封面映射。
 *
 * **只对演示项目 ID 生效**：真实项目（后端返回的 UUID）没有本地封面，
 * 直接用项目自带的 `cover`，不会因为「名字碰巧相同」而套上别人的图片。
 */
const demoProjectCovers: Record<string, string> = {
  aurora: '/media/project-aurora.png',
  northline: '/media/project-northline.png',
  'quiet-room': '/media/project-quiet-room.png',
  'red-shift': '/media/project-red-shift.png',
}

const projectTones: Record<string, Tone> = {
  进行中: 'accent',
  已完成: 'success',
  已归档: 'muted',
}

const selectClass = 'h-8 min-w-0 cursor-pointer rounded-md border border-transparent bg-transparent px-2 text-sm text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:border-studio-accent/60 focus-visible:ring-2 focus-visible:ring-studio-accent/25'
const toolbarButtonClass = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/25'

/** 把形如「4-12 秒」「4~12」的时长描述解析为可连续取值的范围；枚举值返回 null。 */
function parseDurationRange(options: string[]) {
  for (const option of options) {
    const match = option.match(/(\d+(?:\.\d+)?)\s*[-~–至到]\s*(\d+(?:\.\d+)?)/)
    if (match) return { min: Number(match[1]), max: Number(match[2]) }
  }
  return null
}

export function HomePage() {
  const router = useRouter()
  const { state, estimateCredits } = useStudio()
  const [mode, setMode] = useState<CreateMode>('agent')
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [ratio, setRatio] = useState('')
  const [quality, setQuality] = useState('')
  const [seconds, setSeconds] = useState(8)
  /** 跳转中：避免重复点击创建出多个项目。 */
  const [starting, setStarting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const activeMode = modes.find((item) => item.id === mode) ?? modes[0]
  const runningTask = state.tasks.find((task) => task.status === 'processing' || task.status === 'queued')
  const recentProjects = state.projects.slice(0, 4)
  const capability = mode === 'image' ? 'image' : mode === 'video' ? 'video' : mode === 'text' ? 'text' : undefined
  const modelOptions = capability
    ? (state.liveModels.length ? state.liveModels : state.models).filter((item) => item.capability === capability || item.kind === capability)
    : []
  const selectedModel = modelOptions.find((item) => item.id === selectedModelId) ?? modelOptions[0]
  const ratioOptions = selectedModel?.capabilities.ratios.length ? selectedModel.capabilities.ratios : mode === 'video' ? ['16:9', '9:16', '1:1'] : ['1:1', '4:5', '16:9']
  const qualityOptions = selectedModel?.capabilities.qualities.length ? selectedModel.capabilities.qualities : mode === 'video' ? ['720', '1080'] : ['auto', 'high']
  const durationOptions = selectedModel?.capabilities.durations.length ? selectedModel.capabilities.durations : ['5 秒', '8 秒', '10 秒']
  const durationRange = parseDurationRange(durationOptions)
  const fixedDuration = durationOptions.length === 1 && !durationRange ? durationOptions[0] : null
  const groupedModels = modelOptions.reduce<Record<string, typeof modelOptions>>((groups, item) => {
    const key = item.provider || '可用模型'
    groups[key] = [...(groups[key] ?? []), item]
    return groups
  }, {})
  const estimatedCredits = selectedModel && mode !== 'text' && mode !== 'agent'
    ? estimateCredits(selectedModel.id, { quality: quality || undefined, duration: mode === 'video' ? `${seconds} 秒` : undefined })
    : null

  useEffect(() => {
    const nextRatio = selectedModel?.capabilities.ratios[0] || (mode === 'video' ? '16:9' : '1:1')
    const nextQuality = selectedModel?.capabilities.qualities[0] || (mode === 'video' ? '720' : 'auto')
    setRatio((current) => ratioOptions.includes(current) ? current : nextRatio)
    setQuality((current) => qualityOptions.includes(current) ? current : nextQuality)
    const firstDuration = selectedModel?.capabilities.durations[0]?.match(/\d+(?:\.\d+)?/)?.[0]
    if (firstDuration) setSeconds(Number(firstDuration))
  }, [mode, selectedModel?.id, ratioOptions, qualityOptions, selectedModel?.capabilities.durations])

  useEffect(() => {
    if (!modelDropdownOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (target && modelPickerRef.current?.contains(target)) return
      setModelDropdownOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelDropdownOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [modelDropdownOpen])

  /**
   * 开始创作。
   *
   * 早先这里只 `router.push(activeMode.href)`，**提示词、参考文件、模式全部丢失**：
   * 用户到工作台看到的是写死的示例提示词，自己刚输入的内容被静默替换。
   * 现在把意图写��� `create-intent`，工作台读取后套用到表单。
   */
  async function startCreation() {
    if (starting) return
    setStarting(true)
    try {
      const { files: intentFiles, failed } = await readIntentFiles(files)
      const settings = {
        model: selectedModel?.id,
        ratio: ratio || undefined,
        quality: quality || undefined,
        seconds: mode === 'video' ? seconds : undefined,
      }
      if (mode === 'drama') {
        // 短剧是独立的生产线入口，不再借用画布项目上下文。
        router.push('/drama')
        return
      }
      // 文本模式沿用导演 Agent 的执行入口，但保留独立的首页模式语义。
      const result = saveCreateIntent({ mode: mode === 'text' ? 'agent' : mode, prompt: prompt.trim(), files: intentFiles, settings })
      if (!result.saved) {
        // 存储不可用时必须如实告知，否则用户会以为内容已经带过去了。
        window.alert('浏览器存储不可用，创作描述与参考文件未能传递到工作台，请在工作台重新填写。')
      } else if (failed.length || result.droppedFiles) {
        window.alert(`有 ${failed.length + result.droppedFiles} 个参考文件未能传递（读取失败或超出浏览器存储上限）。`)
      }
      router.push(mode === 'text' ? '/agent' : activeMode.href)
    } finally {
      setStarting(false)
    }
  }

  function selectScene(scene: (typeof sceneShortcuts)[number]) {
    setMode(scene.mode)
    setPrompt(scene.prompt)
    document.getElementById('home-prompt')?.focus()
  }

  return (
    <div className="studio-home flex min-h-[calc(100dvh-56px)] flex-col">
      <section aria-labelledby="home-title" className="mx-auto flex w-full max-w-[880px] flex-col items-center px-4 pb-10 pt-10 sm:pt-14">
        <h1 id="home-title" className="text-center text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">从一个想法开始</h1>

        <div role="tablist" aria-label="创作模式" className="mt-6 grid w-full grid-cols-4 gap-1 rounded-lg border border-border bg-card p-1 shadow-[var(--lg-shadow-1)] sm:inline-flex sm:w-auto sm:items-center">
          {visibleModes.map((item) => {
            const Icon = item.icon
            const active = mode === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(item.id)}
                className={cn(
                  'inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/40 sm:gap-2 sm:px-3.5',
                  active ? 'bg-studio-accent/12 text-studio-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
                {item.id === 'agent' && <span className="size-1.5 rounded-full bg-studio-accent" aria-hidden="true" />}
              </button>
            )
          })}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void startCreation()
          }}
          className="mt-6 w-full rounded-xl border border-border bg-card shadow-[var(--lg-shadow-2)] transition-[border-color,box-shadow] duration-150 focus-within:border-studio-accent/50 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--studio-accent)_12%,transparent)]"
        >
          <label htmlFor="home-prompt" className="sr-only">创作描述</label>
          <textarea
            id="home-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                void startCreation()
              }
            }}
            placeholder="描述你想创作的画面、镜头或故事……"
            className="block min-h-[104px] w-full resize-none rounded-t-xl bg-transparent px-4 pb-2 pt-4 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground sm:min-h-[120px]"
          />
          {files.length > 0 && (
            <ul aria-label="已添加的参考素材" className="flex flex-wrap gap-1.5 px-4 pb-3">
              {files.map((file) => (
                <li key={`${file.name}-${file.size}`} className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{file.name}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-2">
            <input ref={fileInputRef} type="file" multiple className="hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className={toolbarButtonClass}>
              <Paperclip className="size-4" aria-hidden="true" />
              参考素材{files.length > 0 && <span className="tabular-nums">· {files.length}</span>}
            </button>
            <Link href="/skills" className={toolbarButtonClass}>
              <Puzzle className="size-4" aria-hidden="true" />
              技能
            </Link>

            <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />

            {mode === 'text' || mode === 'agent' ? (
              <span className="px-2 text-sm text-muted-foreground">由导演 Agent 自动编排</span>
            ) : (
              <>
                <div ref={modelPickerRef} className="relative min-w-0">
                  <button
                    type="button"
                    onClick={() => setModelDropdownOpen((value) => !value)}
                    aria-label="选择模型"
                    aria-expanded={modelDropdownOpen}
                    aria-haspopup="listbox"
                    className={cn(toolbarButtonClass, 'max-w-[260px] text-foreground')}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-studio-accent"><ModelIcon model={selectedModel} /></span>
                    <span className="truncate whitespace-nowrap">{selectedModel ? selectedModel.shortName || selectedModel.name : '选择模型'}</span>
                    <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-150', modelDropdownOpen && 'rotate-180')} aria-hidden="true" />
                  </button>
                  {modelDropdownOpen && (
                    <div role="listbox" aria-label="可选模型" className="lg-glass-overlay motion-panel absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-[min(420px,60dvh)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-border p-1.5 text-left shadow-[var(--lg-shadow-4)]">
                      {modelOptions.length ? Object.entries(groupedModels).map(([provider, items]) => (
                        <div key={provider} className="border-b border-border/70 pb-1 last:border-b-0 last:pb-0">
                          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{provider}</p>
                          {items.map((item) => {
                            const selected = selectedModel?.id === item.id
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => { setSelectedModelId(item.id); setModelDropdownOpen(false) }}
                                className={cn('flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none', selected && 'bg-studio-accent/10')}
                              >
                                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-studio-accent"><ModelIcon model={item} /></span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                                    {selected && <Check className="size-3.5 shrink-0 text-studio-accent" aria-hidden="true" />}
                                  </span>
                                  <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description || '当前可用模型'}</span>
                                  <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                                    {item.capabilities.ratios.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{item.capabilities.ratios.slice(0, 3).join(' / ')}</span>}
                                    {item.capabilities.durations.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{item.capabilities.durations.slice(0, 3).join(' / ')}</span>}
                                    <span className="rounded bg-studio-accent/10 px-1.5 py-0.5 text-studio-accent">{item.creditCost || 0} 积分起</span>
                                  </span>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )) : <div className="px-3 py-4 text-xs leading-5 text-muted-foreground">当前模式暂无可用模型，请检查后台渠道配置。</div>}
                    </div>
                  )}
                </div>

                {ratioOptions.length > 0 && (
                  <label className="inline-flex items-center">
                    <span className="sr-only">比例</span>
                    <select value={ratio} onChange={(event) => setRatio(event.target.value)} className={selectClass}>
                      {ratioOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                )}
                {qualityOptions.length > 0 && (
                  <label className="inline-flex items-center">
                    <span className="sr-only">清晰度</span>
                    <select value={quality} onChange={(event) => setQuality(event.target.value)} className={selectClass}>
                      {qualityOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                )}

                {mode === 'video' && (fixedDuration ? (
                  <span className="px-2 text-sm text-foreground tabular-nums">{fixedDuration}</span>
                ) : durationRange ? (
                  <label className="inline-flex items-center gap-1.5 px-1 text-sm text-foreground">
                    <span className="sr-only">时长（秒）</span>
                    <input
                      type="number"
                      min={durationRange.min}
                      max={durationRange.max}
                      step={1}
                      value={seconds}
                      onChange={(event) => setSeconds(Number(event.target.value))}
                      onBlur={() => setSeconds((current) => Math.min(durationRange.max, Math.max(durationRange.min, Number.isFinite(current) ? current : durationRange.min)))}
                      className="h-8 w-16 rounded-md border border-border bg-background px-2 text-sm tabular-nums outline-none focus-visible:border-studio-accent/60 focus-visible:ring-2 focus-visible:ring-studio-accent/25"
                    />
                    <span className="whitespace-nowrap text-xs text-muted-foreground">秒（{durationRange.min}–{durationRange.max} 秒）</span>
                  </label>
                ) : (
                  <label className="inline-flex items-center">
                    <span className="sr-only">时长</span>
                    <select value={`${seconds} 秒`} onChange={(event) => setSeconds(Number(event.target.value.match(/\d+(?:\.\d+)?/)?.[0] || 8))} className={selectClass}>
                      {durationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                ))}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-muted/50 px-4 py-3">
            <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <Coins className="size-4 shrink-0 text-studio-accent" aria-hidden="true" />
              {estimatedCredits !== null ? (
                <span>预计消耗 <span className="font-semibold tabular-nums text-foreground">{estimatedCredits.toLocaleString()} 积分</span></span>
              ) : (
                <span>{mode === 'drama' ? '分镜与成片按实际生成计费' : '按实际运行计费'}</span>
              )}
              <span className="hidden text-xs text-muted-foreground lg:inline">· ⌘/Ctrl + Enter</span>
            </p>
            <button
              type="submit"
              disabled={starting}
              aria-label="开始创作"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60"
            >
              <span>开始创作</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </form>

        <section aria-label="灵感模板" className="mt-4 grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
          {sceneShortcuts.map((scene) => (
            <button
              key={scene.title}
              type="button"
              onClick={() => selectScene(scene)}
              className="group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-2 pr-3 text-left transition-colors duration-150 hover:border-studio-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/40"
            >
              <MediaThumb
                src={scene.src}
                alt=""
                fallback={scene.title}
                className="size-10 shrink-0 rounded-md [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-105"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{scene.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{scene.description}</span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground" aria-hidden="true" />
            </button>
          ))}
        </section>
      </section>

      <section aria-labelledby="recent-title" className="mx-auto w-full max-w-[1120px] px-4 pb-10 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 border-t border-border pt-8">
          <h2 id="recent-title" className="text-lg font-semibold tracking-[-0.02em] text-foreground">最近作品</h2>
          <Link href="/works" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
            全部作品
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        {recentProjects.length ? (
          <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-4" aria-label="最近作品列表">
            {recentProjects.map((project) => (
              <li key={project.id} className="min-w-0">
                <Link href={`/projects/${project.id}`} className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  <span className="relative block overflow-hidden rounded-lg border border-border bg-card">
                    <MediaThumb
                      src={demoProjectCovers[project.id] ?? project.cover}
                      alt=""
                      fallback={project.title}
                      className="aspect-[4/3] w-full [&_img]:transition-transform [&_img]:duration-300 [&_img]:ease-out group-hover:[&_img]:scale-[1.03]"
                    />
                    <span className="absolute left-2 top-2">
                      <StatusBadge solid tone={projectTones[project.status] ?? 'neutral'}>{project.status}</StatusBadge>
                    </span>
                  </span>
                  <span className="mt-2.5 flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0">{project.type}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{project.updatedAt} 更新</span>
                      {project.status === '进行中' && (
                        <Tooltip label={`完成度 ${project.progress}%`}>
                          <span className="ml-auto shrink-0 tabular-nums text-xs font-medium text-foreground">{project.progress}%</span>
                        </Tooltip>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-5 flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border px-5 text-center">
            <p className="text-sm font-medium text-foreground">还没有作品</p>
            <p className="mt-1 text-xs text-muted-foreground">从上方输入一个想法，生成的作品会出现在这里。</p>
          </div>
        )}

        {runningTask && (
          <Link href="/tasks" aria-live="polite" className="studio-surface mt-6 flex min-w-0 items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-studio-accent motion-reduce:animate-none" aria-hidden="true" />
            <span className="truncate text-foreground">{runningTask.title}</span>
            <span className="hidden shrink-0 sm:inline">· {runningTask.stage}</span>
            <span className="ml-auto shrink-0">查看任务</span>
          </Link>
        )}
      </section>
    </div>
  )
}
