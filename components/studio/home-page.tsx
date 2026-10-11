'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Image as ImageIcon, MessageSquareText, Video } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { readIntentFiles, saveCreateIntent } from '@/lib/studio/create-intent'
import { cn } from '@/lib/utils'
import { InspirationShortcuts, PromptComposer } from './home-composer'
import { GenerationPanel, parseSeconds } from './home-generation-panel'
import { RecentWorks } from './home-recent-works'

type CreateMode = 'agent' | 'image' | 'video' | 'text'

/** 创作模式与目标工作台。文本模式沿用导演 Agent 的执行入口。 */
const modes: Array<{ id: CreateMode; label: string; href: string; icon: typeof Video }> = [
  { id: 'video', label: '视频', href: '/video', icon: Video },
  { id: 'image', label: '图片', href: '/image', icon: ImageIcon },
  { id: 'text', label: '文本', href: '/agent', icon: MessageSquareText },
  { id: 'agent', label: 'Agent', href: '/agent', icon: Bot },
]

const placeholders: Record<CreateMode, string> = {
  video: '描述镜头、主体、动作与氛围，例如：雨夜的霓虹街道，镜头缓慢推进，主角回头看向镜头',
  image: '描述主体、风格、光线与构图，例如：午后阳光下的陶瓷花瓶，柔和侧光，浅灰背景',
  text: '输入要撰写、改写或总结的内容，例如：为新品写一段 80 字的产品介绍',
  agent: '描述目标与约束，例如：为一支 30 秒的新品短片拆出分镜、文案和素材清单',
}

const sceneShortcuts: Array<{ title: string; description: string; tag: string; src: string; prompt: string; mode: CreateMode }> = [
  {
    title: '角色设计',
    description: '形象、服装与表情设定',
    tag: '图片',
    src: '/media/scene-character.png',
    prompt: '设计一位原创年轻探险者角色，补充服装、表情和转身视图，保持角色造型一致',
    mode: 'image',
  },
  {
    title: '产品短片',
    description: '商品展示与镜头运动',
    tag: '视频',
    src: '/media/scene-product.png',
    prompt: '为银色头戴式耳机制作一支产品短片，深色摄影棚，轮廓光，镜头环绕产品移动',
    mode: 'video',
  },
  {
    title: '电影分镜',
    description: '情节节奏与镜头序列',
    tag: 'Agent',
    src: '/media/scene-storyboard.png',
    prompt: '把一场发生在深夜火车站的重逢戏拆成电影分镜，包含远景、人物反应和细节特写',
    mode: 'agent',
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

function clampToRange(value: number, range: { min: number; max: number } | null) {
  return range ? Math.min(range.max, Math.max(range.min, value)) : value
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
  const [secondsInput, setSecondsInput] = useState<number | null>(null)
  /** 跳转中：避免重复点击创建出多个项目。 */
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const modelPickerRef = useRef<HTMLDivElement>(null)

  const activeMode = modes.find((item) => item.id === mode) ?? modes[0]
  const runningTask = state.tasks.find((task) => task.status === 'processing' || task.status === 'queued')
  const recentProjects = state.projects.slice(0, 4)
  const capability = mode === 'image' || mode === 'video' ? mode : undefined
  const modelOptions = useMemo(
    () => (capability ? (state.liveModels.length ? state.liveModels : state.models).filter((item) => item.capability === capability || item.kind === capability) : []),
    [capability, state.liveModels, state.models],
  )
  const selectedModel = modelOptions.find((item) => item.id === selectedModelId) ?? modelOptions[0]
  const ratioOptions = useMemo(
    () => (selectedModel?.capabilities.ratios.length ? selectedModel.capabilities.ratios : mode === 'video' ? ['16:9', '9:16', '1:1'] : ['1:1', '4:5', '16:9']),
    [mode, selectedModel],
  )
  const qualityOptions = useMemo(
    () => (selectedModel?.capabilities.qualities.length ? selectedModel.capabilities.qualities : mode === 'video' ? ['720', '1080'] : ['auto', 'high']),
    [mode, selectedModel],
  )
  const durationOptions = useMemo(
    () => (selectedModel?.capabilities.durations.length ? selectedModel.capabilities.durations : ['5 秒', '8 秒', '10 秒']),
    [selectedModel],
  )
  const durationRange = parseDurationRange(durationOptions)
  const fixedDuration = durationOptions.length === 1 && !durationRange ? durationOptions[0] : null
  const ratioValue = ratioOptions.includes(ratio) ? ratio : (ratioOptions[0] ?? '')
  const qualityValue = qualityOptions.includes(quality) ? quality : (qualityOptions[0] ?? '')
  const seconds = clampToRange(secondsInput ?? parseSeconds(durationOptions[0]) ?? 8, durationRange)
  const groupedModels = modelOptions.reduce<Record<string, typeof modelOptions>>((groups, item) => {
    const key = item.provider || '可用模型'
    groups[key] = [...(groups[key] ?? []), item]
    return groups
  }, {})
  const estimatedCredits = selectedModel && (mode === 'image' || mode === 'video')
    ? estimateCredits(selectedModel.id, { quality: qualityValue || undefined, duration: mode === 'video' ? `${seconds} 秒` : undefined })
    : null
  const canStart = Boolean(prompt.trim() || files.length)

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
   * 把创作意图写入 `create-intent`，工作台读取后套用到表单。
   * 存储失败或参考文件未能带入时停留在本页并说明原因，避免用户误以为内容已经带过去。
   */
  async function saveIntentForWorkbench(): Promise<string | null> {
    try {
      const { files: intentFiles, failed } = await readIntentFiles(files)
      const result = saveCreateIntent({
        mode: mode === 'text' ? 'agent' : mode,
        prompt: prompt.trim(),
        files: intentFiles,
        settings: {
          model: selectedModel?.id,
          ratio: ratioValue || undefined,
          quality: qualityValue || undefined,
          seconds: mode === 'video' ? seconds : undefined,
        },
      })
      if (!result.saved) return '浏览器存储不可用，创作描述无法带入工作台。请检查浏览器的存储或隐私设置后重试。'
      const droppedCount = failed.length + result.droppedFiles
      return droppedCount ? `有 ${droppedCount} 个参考文件未能带入工作台（读取失败或超出浏览器存储上限），请减少或压缩文件后重试。` : null
    } catch {
      return '开始创作失败，请稍后重试。'
    }
  }

  async function startCreation() {
    if (starting || !canStart) return
    setStarting(true)
    setStartError('')
    const failure = await saveIntentForWorkbench()
    if (failure) {
      setStartError(failure)
      setStarting(false)
      return
    }
    router.push(activeMode.href)
  }

  function selectScene(scene: (typeof sceneShortcuts)[number]) {
    setMode(scene.mode)
    setPrompt(scene.prompt)
    setStartError('')
    document.getElementById('home-prompt')?.focus()
  }

  return (
    <div className="studio-home mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">创作工作台</p>
        <h1 id="home-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-foreground">开始一次创作</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">选择创作类型，描述画面与镜头，确认模型与参数后开始生成。</p>
      </header>

      <form
        aria-labelledby="home-title"
        onSubmit={(event) => {
          event.preventDefault()
          void startCreation()
        }}
        className="studio-surface flex min-w-0 flex-col"
      >
        <div role="group" aria-label="创作模式" className="flex gap-1 overflow-x-auto border-b border-border p-2">
          {modes.map((item) => {
            const Icon = item.icon
            const active = mode === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(item.id)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                  active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </button>
            )
          })}
        </div>

        <PromptComposer
          value={prompt}
          onChange={setPrompt}
          onSubmitShortcut={() => void startCreation()}
          files={files}
          onFilesChange={setFiles}
          placeholder={placeholders[mode]}
        />

        <GenerationPanel
          mode={mode}
          selectedModel={selectedModel}
          modelOptions={modelOptions}
          groupedModels={groupedModels}
          dropdownOpen={modelDropdownOpen}
          pickerRef={modelPickerRef}
          onToggleDropdown={() => setModelDropdownOpen((value) => !value)}
          onSelectModel={(id) => {
            setSelectedModelId(id)
            setSecondsInput(null)
            setModelDropdownOpen(false)
          }}
          ratioOptions={ratioOptions}
          ratio={ratioValue}
          onRatioChange={setRatio}
          qualityOptions={qualityOptions}
          quality={qualityValue}
          onQualityChange={setQuality}
          durationOptions={durationOptions}
          durationRange={durationRange}
          fixedDuration={fixedDuration}
          seconds={seconds}
          onSecondsChange={(value) => setSecondsInput(Number.isFinite(value) ? value : null)}
          onSecondsCommit={() => setSecondsInput(seconds)}
          estimatedCredits={estimatedCredits}
          canStart={canStart}
          starting={starting}
          startError={startError}
        />
      </form>

      <InspirationShortcuts scenes={sceneShortcuts} onSelect={selectScene} />
      <RecentWorks projects={recentProjects} runningTask={runningTask} />
    </div>
  )
}
