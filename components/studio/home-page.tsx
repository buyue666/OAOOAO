'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Image as ImageIcon, MessageSquareText, Puzzle, Sparkles, Video } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { readIntentFiles, saveCreateIntent } from '@/lib/studio/create-intent'
import { cn } from '@/lib/utils'
import { InspirationShortcuts, PromptComposer } from './home-composer'
import { GenerationPanel } from './home-generation-panel'
import { RecentWorks } from './home-recent-works'

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
    <div className="studio-home mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">创作工作台</p>
          <h1 id="home-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-foreground">开始一次创作</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">选择创作类型，描述画面与镜头，确认模型与参数后开始生成。</p>
        </div>
        <Link
          href="/skills"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Puzzle className="size-4" aria-hidden="true" />技能库
        </Link>
      </header>

      <div role="tablist" aria-label="创作模式" className="flex gap-6 overflow-x-auto border-b border-border">
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
                '-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/40',
                active ? 'border-studio-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
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
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <PromptComposer
            value={prompt}
            onChange={setPrompt}
            onSubmitShortcut={() => void startCreation()}
            files={files}
            onFilesChange={setFiles}
          />
          <InspirationShortcuts scenes={sceneShortcuts} onSelect={selectScene} />
        </div>

        <GenerationPanel
          mode={mode}
          modeLabel={activeMode.label}
          selectedModel={selectedModel}
          modelOptions={modelOptions}
          groupedModels={groupedModels}
          dropdownOpen={modelDropdownOpen}
          pickerRef={modelPickerRef}
          onToggleDropdown={() => setModelDropdownOpen((value) => !value)}
          onSelectModel={(id) => {
            setSelectedModelId(id)
            setModelDropdownOpen(false)
          }}
          ratioOptions={ratioOptions}
          ratio={ratio}
          onRatioChange={setRatio}
          qualityOptions={qualityOptions}
          quality={quality}
          onQualityChange={setQuality}
          durationOptions={durationOptions}
          durationRange={durationRange}
          fixedDuration={fixedDuration}
          seconds={seconds}
          onSecondsChange={setSeconds}
          estimatedCredits={estimatedCredits}
          starting={starting}
        />
      </form>

      <div className="border-t border-border pt-8">
        <RecentWorks projects={recentProjects} runningTask={runningTask} />
      </div>
    </div>
  )
}
