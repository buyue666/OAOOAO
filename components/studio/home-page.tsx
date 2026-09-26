'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Bot, Check, ChevronDown, Image as ImageIcon, MessageSquareText, Paperclip, SlidersHorizontal, Sparkles, Video } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { readIntentFiles, saveCreateIntent } from '@/lib/studio/create-intent'
import { cn } from '@/lib/utils'
import { MediaThumb, StatusBadge, Tooltip, type Tone } from './ui'

type CreateMode = 'agent' | 'image' | 'video' | 'text' | 'drama'

/**
 * 创作模式 → 目标工作台。
 *
 * 短剧不再指向写死的 `/projects/aurora/script`：那是一个**固定项目**，
 * 对没有该项目的用户会跳到空页面，也可能打开别人的项目。
 * 短剧入口改为「当前用户真实项目」的解析（见 `startCreation`）。
 */
const modes: Array<{ id: CreateMode; label: string; href: string; icon: typeof Video }> = [
  { id: 'video', label: '视频', href: '/video', icon: Video },
  { id: 'image', label: '图片', href: '/image', icon: ImageIcon },
  { id: 'text', label: '文本', href: '/agent', icon: MessageSquareText },
  { id: 'agent', label: 'Agent', href: '/agent', icon: Bot },
  { id: 'drama', label: '短剧', href: '/projects', icon: Sparkles },
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

export function HomePage() {
  const router = useRouter()
  const { state, createProject } = useStudio()
  const [mode, setMode] = useState<CreateMode>('agent')
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [parametersOpen, setParametersOpen] = useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [ratio, setRatio] = useState('')
  const [quality, setQuality] = useState('')
  const [seconds, setSeconds] = useState(8)
  /** 跳转中：避免重复点击创建出多个项目。 */
  const [starting, setStarting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const groupedModels = modelOptions.reduce<Record<string, typeof modelOptions>>((groups, item) => {
    const key = item.provider || '可用模型'
    groups[key] = [...(groups[key] ?? []), item]
    return groups
  }, {})
  const modelPickerRef = useRef<HTMLDivElement>(null)

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
   * 解析短剧要打开的项目。
   *
   * 优先用当前选中的项目；没有则用当前用户的第一个真实项目；
   * 一个都没有时**为本用户新建一个**，而不是跳到固定的 aurora。
   */
  async function resolveDramaProject(): Promise<string | null> {
    if (state.selectedProjectId && state.projects.some((project) => project.id === state.selectedProjectId)) {
      return state.selectedProjectId
    }
    if (state.projects.length) return state.projects[0].id
    if (state.backendStatus !== 'connected') return null
    const created = await createProject(`${prompt.trim().slice(0, 18) || '新建'}短剧项目`)
    return created.id
  }

  /**
   * 开始创作。
   *
   * 早先这里只 `router.push(activeMode.href)`，**提示词、参考文件、模式全部丢失**：
   * 用户到工作台看到的是写死的示例提示词，自己刚输入的内容被静默替换。
   * 现在把意图写入 `create-intent`，工作台读取后套用到表单。
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
        const projectId = await resolveDramaProject()
        if (!projectId) {
          window.alert('短剧需要项目上下文，但当前未登录，无法创建项目。请先登录后再试。')
          return
        }
        const result = saveCreateIntent({ mode, prompt: prompt.trim(), files: intentFiles, projectId, settings })
        if (!result.saved) window.alert('浏览器存储不可用，创作描述与参考文件未能传递到工作台。')
        else if (failed.length || result.droppedFiles) window.alert(`有 ${failed.length + result.droppedFiles} 个参考文件未能传递（读取失败或超出浏览器存储上限）。`)
        router.push(`/projects/${projectId}/script`)
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
    <div className="studio-home flex min-h-[calc(100dvh-60px)] flex-col">
      <section className="flex flex-col items-center px-4 pb-8 pt-10 sm:pb-10 sm:pt-14">
        <div className="w-full max-w-[980px] text-center">
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.045em] text-foreground sm:text-[42px] sm:leading-[1.1]">从一个想法开始</h1>

          <div className="studio-home-mode-switcher mx-auto mt-6 inline-flex max-w-full items-center gap-1 overflow-x-auto p-1" role="tablist" aria-label="创作模式">
            {visibleModes.map((item) => {
              const Icon = item.icon
              return <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} onClick={() => setMode(item.id)} className={cn('studio-home-mode-tab inline-flex h-10 shrink-0 items-center gap-2 px-4 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70', mode === item.id ? 'studio-home-mode-tab-active text-foreground' : 'text-muted-foreground hover:text-foreground')}><Icon className="size-4" aria-hidden="true" />{item.label}{item.id === 'agent' && <span className="size-1.5 rounded-full bg-studio-accent" aria-hidden="true" />}</button>
            })}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              startCreation()
            }}
            className="studio-home-prompt motion-panel mx-auto mt-7 w-full max-w-[920px] p-3 text-left sm:p-4"
          >
            <label htmlFor="home-prompt" className="sr-only">创作描述</label>
            <textarea
              id="home-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault()
                  startCreation()
                }
              }}
              placeholder="描述你想创作的画面、镜头或故事……"
              className="min-h-[76px] w-full resize-none bg-transparent px-2 py-1 text-left text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none sm:min-h-[84px]"
            />
            {files.length > 0 && <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">已添加 {files.length} 个参考文件</p>}
            {parametersOpen && mode !== 'agent' && mode !== 'text' && (
              <div className="studio-home-inline-params" aria-label="生成参数">
                <span className="studio-home-inline-params-title">生成参数</span>
                <label className="studio-home-param-field"><span>比例</span><select value={ratio} onChange={(event) => setRatio(event.target.value)} aria-label="比例"><option value="">自动</option>{ratioOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="studio-home-param-field"><span>清晰度</span><select value={quality} onChange={(event) => setQuality(event.target.value)} aria-label="清晰度"><option value="">自动</option>{qualityOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                {mode === 'video' && <label className="studio-home-param-field"><span>时长</span><select value={`${seconds} 秒`} onChange={(event) => { const value = Number(event.target.value.match(/\d+(?:\.\d+)?/)?.[0] || 8); setSeconds(value) }} aria-label="时长">{durationOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
                <span className="studio-home-param-summary">{selectedModel?.shortName || '自动模型'}{files.length ? ` · ${files.length} 个参考` : ''}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 px-1 pt-2 sm:flex-nowrap sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pb-0.5">
                <input ref={fileInputRef} type="file" multiple className="hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
                <Tooltip label="上传参考素材">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="上传参考素材"
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  >
                    <Paperclip className="size-4" aria-hidden="true" />
                    <span>上传参考</span>
                  </button>
                </Tooltip>
                <div ref={modelPickerRef} className="relative min-w-0 shrink">
                  <button type="button" onClick={() => setModelDropdownOpen((value) => !value)} aria-label="选择模型" aria-expanded={modelDropdownOpen} aria-haspopup="listbox" className="inline-flex h-9 min-w-0 max-w-[230px] items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
                    <Sparkles className="size-4 shrink-0 text-studio-accent" aria-hidden="true" />
                    <span className="truncate">{selectedModel ? `${selectedModel.shortName} · ${selectedModel.creditCost || 0} 积分` : mode === 'text' ? '导演 Agent 自动选择' : '选择模型'}</span>
                    <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', modelDropdownOpen && 'rotate-180')} aria-hidden="true" />
                  </button>
                  {modelDropdownOpen && (
                    <div className="studio-home-model-menu absolute bottom-[calc(100%+8px)] left-0 z-30 w-[min(360px,calc(100vw-32px))] overflow-hidden p-1.5 text-left" role="listbox" aria-label="可选模型">
                      {modelOptions.length ? Object.entries(groupedModels).map(([provider, items]) => (
                        <div key={provider} className="studio-home-model-group">
                          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{provider}</p>
                          {items.map((item) => (
                            <button key={item.id} type="button" role="option" aria-selected={selectedModel?.id === item.id} onClick={() => { setSelectedModelId(item.id); setModelDropdownOpen(false) }} className={cn('studio-home-model-option flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', selectedModel?.id === item.id && 'studio-home-model-option-active')}>
                              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-studio-accent"><Sparkles className="size-3.5" aria-hidden="true" /></span>
                              <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-semibold text-foreground">{item.name}</span>{selectedModel?.id === item.id && <Check className="size-3.5 shrink-0 text-studio-accent" aria-hidden="true" />}</span><span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">{item.description || '当前可用模型'}</span><span className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground"><span className="rounded-full bg-muted px-1.5 py-0.5">{item.capabilities.ratios.slice(0, 2).join(' · ') || '自动比例'}</span>{item.capabilities.durations.length > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5">{item.capabilities.durations.slice(0, 2).join(' · ')}</span>}<span className="rounded-full bg-studio-accent/10 px-1.5 py-0.5 text-studio-accent">{item.creditCost || 0} 积分起</span></span></span>
                            </button>
                          ))}
                        </div>
                      )) : <div className="px-3 py-4 text-xs leading-5 text-muted-foreground">{mode === 'text' ? '文本由导演 Agent 自动编排。' : '当前模式暂无可用模型，请检查后台渠道配置。'}</div>}
                    </div>
                  )}
                </div>
                <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
                <span className="hidden text-xs text-muted-foreground sm:inline">{mode === 'video' ? '16:9 · 8 秒' : mode === 'image' ? '1:1 · 自动清晰度' : mode === 'text' ? '长文本创作' : '自动编排'}</span>
                <button
                  type="button"
                  aria-label="调整生成参数"
                  aria-expanded={parametersOpen}
                  onClick={() => setParametersOpen((value) => !value)}
                  className={cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70', parametersOpen && 'bg-muted text-foreground')}
                >
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  <span>{parametersOpen ? '收起参数' : '参数'}</span>
                </button>
              </div>
              <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
                <span className="hidden text-[11px] text-muted-foreground sm:inline">⌘/Ctrl + Enter</span>
                <button
                  type="submit"
                  aria-label="开始创作"
                  className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:flex-none"
                >
                  <span>开始创作</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </form>

          <section aria-label="灵感快捷项" className="mx-auto mt-4 w-full max-w-[920px]">
            <div className="studio-scroll-x flex items-center gap-2 overflow-x-auto pb-1 sm:justify-center">
              {sceneShortcuts.map((scene) => (
                <button
                  key={scene.title}
                  type="button"
                  onClick={() => selectScene(scene)}
                  className="studio-home-shortcut group flex min-w-[156px] shrink-0 items-center gap-2 px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:min-w-[180px]"
                >
                  <MediaThumb
                    src={scene.src}
                    alt={scene.title}
                    fallback={scene.title}
                    className="size-10 shrink-0 rounded-[12px] [&_img]:transition-transform [&_img]:duration-300 [&_img]:ease-out group-hover:[&_img]:scale-105"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{scene.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{modes.find((item) => item.id === scene.mode)?.label}</span>
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section aria-labelledby="continue-title" className="bg-background">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 pb-7 pt-2 sm:px-6 sm:pb-9 sm:pt-4 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <h2 id="continue-title" className="text-base font-medium tracking-[-0.02em] text-foreground sm:text-lg">最近项目</h2>
            <Link href="/projects" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
              全部项目
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          <div className="studio-home-project-grid grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3" data-count={recentProjects.length}>
            {recentProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="lg-raised relative block overflow-hidden">
                  <MediaThumb
                    src={demoProjectCovers[project.id] ?? project.cover}
                    alt={project.title}
                    fallback={project.title}
                    className="aspect-video w-full [&_img]:transition-transform [&_img]:duration-300 [&_img]:ease-out group-hover:[&_img]:scale-105"
                  />
                  <span className="absolute left-2 top-2">
                    <StatusBadge solid tone={projectTones[project.status] ?? 'neutral'}>{project.status}</StatusBadge>
                  </span>
                </span>
                <span className="mt-2 flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0">{project.type}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{project.shotCount} 个镜头</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{project.updatedAt}更新</span>
                    {project.status === '进行中' && (
                      <span className="ml-auto shrink-0 tabular-nums text-[11px] font-medium text-muted-foreground" aria-label={`完成度 ${project.progress}%`}>
                        {project.progress}%
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            ))}
          </div>

          {runningTask && (
            <Link href="/tasks" aria-live="polite" className="studio-surface studio-surface-interactive flex min-w-0 items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" aria-hidden="true" />
              <span className="truncate text-foreground">{runningTask.title}</span>
              <span className="hidden shrink-0 sm:inline">· {runningTask.stage}</span>
              <span className="ml-auto shrink-0">查看任务</span>
            </Link>
          )}
        </div>
      </section>

    </div>
  )
}
