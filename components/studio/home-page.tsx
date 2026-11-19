'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bot, Clapperboard, Image as ImageIcon, Layers3, Puzzle, Sparkles, Video, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStudio } from '@/lib/studio/store'
import { defaultModelFor, filterModelsByCapability, imageQualityOptions, qualityLabel, ratioLabel } from '@/lib/studio/studio-models'
import { availableTeamModels } from '@/lib/studio/team-generation'
import { selectableVideoDurations } from '@/lib/studio/video-policy'
import { AGENT_FILE_ACCEPT, AGENT_FILE_LIMIT, validateAgentFiles } from '@/lib/studio/agent-files'
import { readIntentFiles, saveCreateIntent } from '@/lib/studio/create-intent'
import type { ModelConfig } from '@/lib/studio/types'
import { workspaceHref, workspaceRoot } from '@/lib/studio/workspace-navigation'
import type { TeamProject, TeamSummary } from '@/lib/studio/team-types'
import { useSiteBrand } from '@/components/site-brand'
import { SiteFooter } from '@/components/site-footer'
import { PromptComposer } from './home-composer'
import { GenerationPanel, parseSeconds } from './home-generation-panel'
import { RecentWorks } from './home-recent-works'
import { PluginProjectStarter } from './plugins/plugin-workspaces'
import { TeamProjects } from './team-projects'

type EntryMode = 'agent' | 'image' | 'video' | 'project'

const directions: ReadonlyArray<{
  title: string
  mode: EntryMode
  modeLabel: string
  brief: string
  icon: LucideIcon
}> = [
  {
    title: '让产品成为主角',
    mode: 'agent',
    modeLabel: '创作助手',
    brief: '制作一支 15 秒的产品短片。用三个镜头分别表现产品的整体造型、材质细节和使用场景，保持产品外观一致。',
    icon: Layers3,
  },
  {
    title: '视觉概念与主画面探索',
    mode: 'image',
    modeLabel: '图片生成',
    brief: '雨夜东京街角的复古咖啡馆橱窗，暖黄色室内灯光洒在湿润的石板路上，玻璃上挂着细密水珠，电影感构图与柔和胶片质感。',
    icon: ImageIcon,
  },
  {
    title: '讲一个有转折的镜头',
    mode: 'video',
    modeLabel: '视频生成',
    brief: '清晨海边，一位旅人沿沙滩慢慢前行，海风轻拂衣摆，镜头从远景平稳推进到侧脸近景，暖色逆光，写实电影质感。',
    icon: Clapperboard,
  },
]

const IMAGE_FILE_LIMIT = 6
const IMAGE_FILE_MAX_BYTES = 20 * 1024 * 1024

function supportedChoice(value: string, choices: string[]) {
  return choices.includes(value) ? value : choices[0] ?? value
}

function isMediaCompatibleImage(file: File) {
  return file.type.startsWith('image/') && file.size <= IMAGE_FILE_MAX_BYTES
}

function groupByProvider(models: ModelConfig[], fallbackLabel: string) {
  const groups: Record<string, ModelConfig[]> = {}
  for (const model of models) {
    const key = model.provider || fallbackLabel
    if (!groups[key]) groups[key] = []
    groups[key].push(model)
  }
  return groups
}

export function HomePage({ team, project }: { team?: TeamSummary; project?: TeamProject } = {}) {
  const tx = useUiText()
  const router = useRouter()
  const brand = useSiteBrand()
  const { state, estimateCredits, defaultModels } = useStudio()
  const href = (target: string) => team ? workspaceHref(workspaceRoot({ teamId: team.id, projectId: project?.id }), target) : target
  const canCreate = team?.role !== 'reviewer'

  const [mode, setMode] = useState<EntryMode>(team ? 'image' : 'agent')
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState('')
  const [startError, setStartError] = useState('')
  const [starting, setStarting] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const submitLock = useRef(false)

  const liveModels = useMemo(
    () => team ? availableTeamModels(state.liveModels, team.modelIds, state.sessionSettings, team.subscriptionExpiresAt) : state.liveModels,
    [state.liveModels, state.sessionSettings, team],
  )
  const imageModels = useMemo(() => filterModelsByCapability(liveModels, 'image'), [liveModels])
  const videoModels = useMemo(() => filterModelsByCapability(liveModels, 'video'), [liveModels])

  const [imageModelId, setImageModelId] = useState(() => defaultModelFor('image', state.sessionSettings, imageModels))
  const [videoModelId, setVideoModelId] = useState(() => defaultModelFor('video', state.sessionSettings, videoModels))
  const [imageRatio, setImageRatio] = useState(defaultModels.imageSize || '16:9')
  const [imageResolution, setImageResolution] = useState('1K')
  const [imageQuality, setImageQuality] = useState('auto')
  const [videoRatio, setVideoRatio] = useState('16:9')
  const [videoQuality, setVideoQuality] = useState(defaultModels.videoQuality || '720')
  const [videoSeconds, setVideoSeconds] = useState<number>(defaultModels.videoSeconds || 5)

  useEffect(() => {
    if (!imageModels.length) return
    setImageModelId((current) => imageModels.some((item) => item.id === current && !item.subscriptionLocked) ? current : defaultModelFor('image', state.sessionSettings, imageModels))
  }, [imageModels, state.sessionSettings])

  useEffect(() => {
    if (!videoModels.length) return
    setVideoModelId((current) => videoModels.some((item) => item.id === current && !item.subscriptionLocked) ? current : defaultModelFor('video', state.sessionSettings, videoModels))
  }, [videoModels, state.sessionSettings])

  const selectedImageModel = useMemo(
    () => imageModels.find((item) => item.id === imageModelId && !item.subscriptionLocked) ?? imageModels.find((item) => !item.subscriptionLocked),
    [imageModelId, imageModels],
  )
  const selectedVideoModel = useMemo(
    () => videoModels.find((item) => item.id === videoModelId && !item.subscriptionLocked) ?? videoModels.find((item) => !item.subscriptionLocked),
    [videoModelId, videoModels],
  )

  const imageRatioOptions = useMemo(
    () => selectedImageModel?.capabilities.ratios.length ? selectedImageModel.capabilities.ratios : [],
    [selectedImageModel],
  )
  const imageResolutionOptions = useMemo(
    () => selectedImageModel?.capabilities.resolutions?.length ? selectedImageModel.capabilities.resolutions : ['1K'],
    [selectedImageModel],
  )
  const imageQualityOptionsList = useMemo(
    () => selectedImageModel ? imageQualityOptions(selectedImageModel, imageResolution) : [],
    [selectedImageModel, imageResolution],
  )

  useEffect(() => {
    if (!selectedImageModel) return
    if (imageRatioOptions.length) setImageRatio((current) => supportedChoice(current, imageRatioOptions))
    if (imageResolutionOptions.length) setImageResolution((current) => supportedChoice(current, imageResolutionOptions))
  }, [selectedImageModel, imageRatioOptions, imageResolutionOptions])

  useEffect(() => {
    if (imageQualityOptionsList.length) setImageQuality((current) => supportedChoice(current, imageQualityOptionsList))
  }, [imageQualityOptionsList])

  const videoRatioOptions = useMemo(
    () => selectedVideoModel?.capabilities.ratios.length ? selectedVideoModel.capabilities.ratios : [],
    [selectedVideoModel],
  )
  const videoQualityOptions = useMemo(
    () => selectedVideoModel?.capabilities.qualities.length ? selectedVideoModel.capabilities.qualities : [],
    [selectedVideoModel],
  )
  const videoAllowedDurations = useMemo(
    () => selectableVideoDurations(selectedVideoModel, videoQuality, 'text'),
    [selectedVideoModel, videoQuality],
  )
  const videoDurationRule = useMemo(() => {
    const rule = selectedVideoModel?.capabilities.videoPolicy?.durationRules?.[videoQuality]
    if (!rule) return null
    if (rule.mode === 'range' && rule.min !== undefined && rule.max !== undefined) {
      return { min: rule.min, max: rule.max }
    }
    return null
  }, [selectedVideoModel, videoQuality])
  const videoFixedDuration = useMemo(() => {
    if (videoDurationRule) return null
    return videoAllowedDurations.length === 1 ? videoAllowedDurations[0] : null
  }, [videoAllowedDurations, videoDurationRule])

  useEffect(() => {
    if (!selectedVideoModel) return
    if (videoRatioOptions.length) setVideoRatio((current) => supportedChoice(current, videoRatioOptions))
    if (videoQualityOptions.length) setVideoQuality((current) => supportedChoice(current, videoQualityOptions))
  }, [selectedVideoModel, videoRatioOptions, videoQualityOptions])

  useEffect(() => {
    if (videoDurationRule) {
      setVideoSeconds((current) => Math.max(videoDurationRule.min, Math.min(videoDurationRule.max, Number.isFinite(current) ? current : videoDurationRule.min)))
      return
    }
    if (videoAllowedDurations.length) {
      const parsedChoices = videoAllowedDurations.map((item) => parseSeconds(item)).filter((item): item is number => item !== null)
      if (parsedChoices.length && !parsedChoices.includes(videoSeconds)) setVideoSeconds(parsedChoices[0])
    }
  }, [videoAllowedDurations, videoDurationRule, videoSeconds])

  useEffect(() => {
    setDropdownOpen(false)
    setFileError('')
    setStartError('')
  }, [mode])

  useEffect(() => {
    if (!dropdownOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [dropdownOpen])

  const activeModels = mode === 'video' ? videoModels : mode === 'image' ? imageModels : []
  const selectedModel = mode === 'video' ? selectedVideoModel : mode === 'image' ? selectedImageModel : undefined
  const groupedModels = useMemo(() => groupByProvider(activeModels, tx('可用模型')), [activeModels, tx])

  const compatibleFiles = useMemo(() => {
    if (mode === 'agent') return files.slice(0, AGENT_FILE_LIMIT)
    return files.filter(isMediaCompatibleImage).slice(0, IMAGE_FILE_LIMIT)
  }, [files, mode])

  const incompatibleCount = files.length - compatibleFiles.length
  const compatibilityNote = mode !== 'agent' && mode !== 'project' && incompatibleCount > 0
    ? compatibleFiles.length
      ? tx('已保留 {0} 个仅创作助手支持的素材或超限文件；进入工作台将带入 {1} 张参考图片。', [incompatibleCount, compatibleFiles.length])
      : tx('当前模式仅支持 20 MB 以内的参考图片；你添加的文件仍保留在这里，切回「创作助手」即可使用。')
    : ''

  const estimatedCredits = useMemo(() => {
    if (mode === 'agent') return null
    if (team) return null
    if (!selectedModel) return null
    if (mode === 'image') return estimateCredits(selectedModel.id, { ratio: imageRatio, quality: imageQuality, count: 1 })
    if (mode === 'video') return estimateCredits(selectedModel.id, { ratio: videoRatio, quality: videoQuality, duration: `${videoSeconds} 秒`, count: 1 })
    return null
  }, [estimateCredits, imageQuality, imageRatio, mode, selectedModel, team, videoQuality, videoRatio, videoSeconds])

  const canStart = Boolean(prompt.trim() || compatibleFiles.length > 0)

  function handleFilesChange(nextFiles: File[]) {
    setFileError('')
    setStartError('')
    if (mode === 'agent') {
      const validation = validateAgentFiles(nextFiles, 0)
      if (validation) {
        setFileError(validation)
        return
      }
      setFiles(nextFiles)
      return
    }
    const invalid = nextFiles.find((file) => !file.type.startsWith('image/'))
    if (invalid && !files.includes(invalid)) {
      setFileError(tx('「{0}」不是图片文件；图片与视频入口仅支持添加图片参考，更多格式请切换到「创作助手」。', [invalid.name]))
      return
    }
    const oversized = nextFiles.find((file) => file.type.startsWith('image/') && file.size > IMAGE_FILE_MAX_BYTES)
    if (oversized && !files.includes(oversized)) {
      setFileError(tx('「{0}」超过 20 MB，请压缩后重试。', [oversized.name]))
      return
    }
    const nextCompatibleImages = nextFiles.filter(isMediaCompatibleImage)
    if (nextCompatibleImages.length > IMAGE_FILE_LIMIT) {
      setFileError(tx('图片与视频入口最多带入 {0} 张参考图片。', [IMAGE_FILE_LIMIT]))
      return
    }
    setFiles(nextFiles.slice(0, AGENT_FILE_LIMIT))
  }

  async function startCreation() {
    if (submitLock.current || starting || mode === 'project') return
    if (!canStart) {
      setStartError(tx('请先输入创作描述或添加兼容的参考素材。'))
      return
    }
    if ((mode === 'image' || mode === 'video') && !selectedModel) {
      setStartError(tx('当前暂无可用模型，请联系管理员配置后再试。'))
      return
    }
    submitLock.current = true
    setStarting(true)
    setStartError('')
    try {
      const { files: intentFiles, failed } = await readIntentFiles(compatibleFiles)
      if (failed.length && !prompt.trim() && !intentFiles.length) {
        setStartError(tx('参考文件读取失败：{0}', [failed.join('、')]))
        submitLock.current = false
        setStarting(false)
        return
      }
      const result = saveCreateIntent({
        mode,
        prompt: prompt.trim(),
        files: intentFiles,
        teamId: team?.id,
        projectId: project?.id,
        settings: mode === 'image' && selectedModel ? {
          model: selectedModel.id,
          ratio: imageRatio,
          resolution: imageResolution,
          quality: imageQuality,
        } : mode === 'video' && selectedModel ? {
          model: selectedModel.id,
          ratio: videoRatio,
          quality: videoQuality,
          seconds: videoSeconds,
        } : undefined,
      })
      if (!result.saved) {
        setStartError(tx('浏览器暂存空间已满，请精简描述或移除部分参考文件后重试。'))
        submitLock.current = false
        setStarting(false)
        return
      }
      router.push(mode === 'agent' ? '/agent' : href(mode === 'image' ? '/image' : '/video'))
    } catch (reason) {
      setStartError(reason instanceof Error ? reason.message : tx('进入工作台失败，请重试。'))
      submitLock.current = false
      setStarting(false)
    }
  }

  const modeTabs: ReadonlyArray<{ id: EntryMode; title: string; icon: LucideIcon }> = team
    ? [
        { id: 'image', title: '图片生成', icon: ImageIcon },
        { id: 'video', title: '视频生成', icon: Video },
        { id: 'project', title: '团队项目', icon: Clapperboard },
      ]
    : [
        { id: 'agent', title: '创作助手', icon: Bot },
        { id: 'image', title: '图片生成', icon: ImageIcon },
        { id: 'video', title: '视频生成', icon: Video },
        { id: 'project', title: '完整作品', icon: Clapperboard },
      ]

  const directEntry = mode === 'agent'
    ? { href: '/agent', label: '直接打开创作助手' }
    : mode === 'image'
      ? { href: href('/image'), label: '直接打开图片工作台' }
      : mode === 'video'
        ? { href: href('/video'), label: '直接打开视频工作台' }
        : { href: href('/projects'), label: '浏览全部项目' }

  const placeholders: Record<Exclude<EntryMode, 'project'>, string> = {
    agent: tx('描述你想完成的画面、短片或故事，支持上传参考图、视频、音频或剧本，先一起梳理方向并确认生成计划…'),
    image: tx('描述画面主体、场景、光线、风格与构图，或添加参考图继续修改…'),
    video: tx('描述主体动作、镜头运动与画面氛围，也可添加图片作为首帧或画面参考…'),
  }

  const modeHints: Record<Exclude<EntryMode, 'project'>, string> = {
    agent: tx('支持图片、视频、音频与文档'),
    image: tx('最多带入 6 张参考图片'),
    video: tx('图片参考将带入视频工作台'),
  }

  return (
    <div className="studio-home mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 pb-16 pt-7 sm:px-6 lg:px-8 lg:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {team ? `${team.name} · ${tx('团队空间')}${project ? ` / ${project.title}` : ''}` : <>{brand.title} {tx('· 创作空间')}</>}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">{tx('今天，做点什么？')}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {tx(team
              ? canCreate
                ? '先在这里写下描述或添加参考，随时切换图片、视频或团队项目，把同一份想法带入对应流程。'
                : '你是审阅成员，可以查看已授权的项目和生成结果。'
              : '先在这里写下想法或添加参考，再随时切换创作助手、图片、视频或完整作品。')}
          </p>
        </div>
        <Link prefetch={false} href={href('/works')} className="inline-flex min-h-11 items-center gap-2 rounded-md py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
          {tx('继续上次的生成')}<ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </header>

      {canCreate && (
        <section data-tour="creator" className="studio-surface" aria-label={tx('开始创作')}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
            <div role="group" aria-label={tx('创作方式')} className="flex flex-wrap gap-1">
              {modeTabs.map((entry) => {
                const Icon = entry.icon
                const active = mode === entry.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMode(entry.id)}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                      active ? 'bg-foreground text-background shadow-xs' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {tx(entry.title)}
                  </button>
                )
              })}
            </div>
            <Link
              prefetch={false}
              href={directEntry.href}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {tx(directEntry.label)}<ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>

          {mode === 'project' ? (
            team ? (
              <div className="p-5 sm:p-7">
                <TeamProjects team={team} intent="create" />
              </div>
            ) : (
              <PluginProjectStarter
                brief={prompt}
                onBriefChange={setPrompt}
                initialFiles={compatibleFiles}
              />
            )
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void startCreation()
              }}
            >
              <PromptComposer
                value={prompt}
                onChange={(next) => {
                  setPrompt(next)
                  if (startError) setStartError('')
                }}
                onSubmitShortcut={() => void startCreation()}
                files={files}
                onFilesChange={handleFilesChange}
                placeholder={placeholders[mode]}
                accept={mode === 'agent' ? AGENT_FILE_ACCEPT : 'image/*'}
                maxFiles={AGENT_FILE_LIMIT}
                fileError={fileError}
                modeHint={modeHints[mode]}
                hideSkillsLink={Boolean(team)}
                isFileCompatible={mode === 'agent' ? undefined : isMediaCompatibleImage}
                incompatibleLabel={mode === 'agent' ? undefined : tx('仅创作助手')}
              />
              <GenerationPanel
                mode={mode}
                selectedModel={selectedModel}
                modelOptions={activeModels}
                groupedModels={groupedModels}
                dropdownOpen={dropdownOpen}
                pickerRef={pickerRef}
                onToggleDropdown={() => setDropdownOpen((open) => !open)}
                onSelectModel={(id) => {
                  if (mode === 'video') setVideoModelId(id)
                  else setImageModelId(id)
                  setDropdownOpen(false)
                }}
                ratioOptions={mode === 'video' ? videoRatioOptions : imageRatioOptions}
                ratio={mode === 'video' ? videoRatio : imageRatio}
                onRatioChange={(value) => {
                  if (mode === 'video') setVideoRatio(value)
                  else setImageRatio(value)
                }}
                formatRatio={(value) => ratioLabel(value, selectedModel?.capabilities.outputDimensions, mode === 'image' ? imageResolution : undefined, selectedModel?.capabilities.outputDimensionsByResolution)}
                resolutionOptions={mode === 'image' ? imageResolutionOptions : undefined}
                resolution={mode === 'image' ? imageResolution : undefined}
                onResolutionChange={mode === 'image' ? setImageResolution : undefined}
                qualityOptions={mode === 'video' ? videoQualityOptions : imageQualityOptionsList}
                quality={mode === 'video' ? videoQuality : imageQuality}
                onQualityChange={(value) => {
                  if (mode === 'video') setVideoQuality(value)
                  else setImageQuality(value)
                }}
                formatQuality={(value) => qualityLabel(value, selectedModel?.capabilities.qualityLabels)}
                durationOptions={videoAllowedDurations}
                durationRange={videoDurationRule}
                fixedDuration={videoFixedDuration}
                seconds={videoSeconds}
                onSecondsChange={setVideoSeconds}
                onSecondsCommit={() => {
                  if (!videoDurationRule) return
                  setVideoSeconds((current) => Math.max(videoDurationRule.min, Math.min(videoDurationRule.max, Number.isFinite(current) ? Math.round(current) : videoDurationRule.min)))
                }}
                estimatedCredits={estimatedCredits}
                creditNote={team ? tx('进入团队项目工作台后按实际参数核对积分') : undefined}
                compatibilityNote={compatibilityNote}
                submitLabel={mode === 'agent' ? tx('进入创作助手') : mode === 'image' ? tx('带入图片工作台') : tx('带入视频工作台')}
                canStart={canStart}
                starting={starting}
                startError={startError}
              />
            </form>
          )}
        </section>
      )}

      {team ? (
        <Link prefetch={false} href={href('/tools')} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <Puzzle className="size-4" aria-hidden="true" />{tx('功能中心')}<ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <>
          <section aria-labelledby="directions-title">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="directions-title" className="text-sm font-semibold">{tx('从一个方向开始')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{tx('点击任意方向，描述会填入上方输入框并切换到对应模式，随时可再切换。')}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {directions.map((direction) => {
                const Icon = direction.icon
                return (
                  <button
                    key={direction.title}
                    type="button"
                    onClick={() => {
                      setPrompt(direction.brief)
                      setMode(direction.mode)
                      setStartError('')
                      requestAnimationFrame(() => {
                        const input = document.getElementById('home-prompt')
                        input?.focus()
                        input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                      })
                    }}
                    className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{tx(direction.title)}</span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{tx(direction.brief)}</span>
                      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-studio-accent">
                        <Sparkles className="size-3" aria-hidden="true" />{tx('填入并切至')}{tx(direction.modeLabel)}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          </section>

          <RecentWorks />
        </>
      )}

      <SiteFooter placement="studio" />
    </div>
  )
}
