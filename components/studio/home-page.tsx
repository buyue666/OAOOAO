'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bot, Clapperboard, Image as ImageIcon, Puzzle, Video, type LucideIcon } from 'lucide-react'
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
import { SiteFooter } from '@/components/site-footer'
import { PromptComposer, type ComposerSlashSkill } from './home-composer'
import { GenerationPanel, parseSeconds } from './home-generation-panel'
import { RecentWorks } from './home-recent-works'
import { HomeShowcase, type ShowcasePreset } from './home-showcase'
import { PluginProjectStarter } from './plugins/plugin-workspaces'
import { TeamProjects } from './team-projects'

type EntryMode = 'agent' | 'image' | 'video' | 'project'

const QUICK_SKILLS: ReadonlyArray<ComposerSlashSkill & { mode: Exclude<EntryMode, 'project'> }> = [
  {
    id: 'product-short',
    label: '产品质感短片',
    mode: 'agent',
    prompt: '制作一支 15 秒的产品短片。用三个镜头分别表现产品的整体造型、材质细节和使用场景，保持产品外观一致。',
  },
  {
    id: 'cinema-long-take',
    label: '电影级长镜头运镜',
    mode: 'video',
    prompt: '清晨海边，一位旅人沿沙滩慢慢前行，海风轻拂衣摆，镜头从远景平稳推进到侧脸近景，暖色逆光，写实电影质感。',
  },
  {
    id: 'storyboard',
    label: '创作分镜',
    mode: 'agent',
    prompt: '为一段 30 秒的都市深夜邂逅短片设计 6 个连续分镜，明确景别、机位运动、灯光色调和人物情绪转折。',
  },
  {
    id: 'style-master',
    label: '视觉概念主画面',
    mode: 'image',
    prompt: '雨夜东京街角的复古咖啡馆橱窗，暖黄色室内灯光洒在湿润的石板路上，玻璃上挂着细密水珠，电影感构图与柔和胶片质感。',
  },
  {
    id: 'narrative-director',
    label: '叙事短片导演',
    mode: 'agent',
    prompt: '围绕「失而复得的旧怀表」撰写 4 幕短片大纲，拆解出核心角色设定与关键场景参考图需求。',
  },
  {
    id: 'micro-expression',
    label: '情绪特写镜头',
    mode: 'video',
    prompt: '室内窗边柔光特写，人物听到远处脚步声后眼神从平静转为微惊，浅景深虚化背景，胶片电影质感。',
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

  function applyQuickBrief(nextPrompt: string, nextMode?: EntryMode) {
    setPrompt(nextPrompt)
    if (nextMode && (!team || nextMode !== 'agent')) {
      setMode(nextMode === 'project' ? (team ? 'image' : 'agent') : nextMode)
    }
    setStartError('')
    requestAnimationFrame(() => {
      const input = document.getElementById('home-prompt')
      input?.focus()
      input?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  function handlePresetApply(preset: ShowcasePreset) {
    applyQuickBrief(preset.prompt, preset.mode)
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
    ? { href: '/agent', label: '直接进入' }
    : mode === 'image'
      ? { href: href('/image'), label: '图片工作台' }
      : mode === 'video'
        ? { href: href('/video'), label: '视频工作台' }
        : { href: href('/projects'), label: '全部项目' }

  const placeholders: Record<Exclude<EntryMode, 'project'>, string> = {
    agent: tx('输入想法、剧本或上传参考，支持 / 唤起技能，和创作助手一起构思…'),
    image: tx('描述画面主体、场景、光线、风格与构图，或点击左侧卡片上传参考图…'),
    video: tx('描述主体动作、镜头运动与画面氛围，也可上传参考图作为首帧或画面参考…'),
  }

  const heroTitle = team
    ? `${team.name}${project ? ` · ${project.title}` : ''}，${tx('今天想创作什么？')}`
    : tx('你好，今天想要创作什么？')

  const displayedSkills = team ? QUICK_SKILLS.filter((skill) => skill.mode !== 'agent') : QUICK_SKILLS

  return (
    <div className="studio-home mx-auto flex w-full max-w-[1160px] flex-col gap-10 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-10">
      <section className="flex flex-col items-center">
        <h1 className="text-center text-[26px] font-semibold tracking-[-0.03em] text-foreground sm:text-[32px]">
          {heroTitle}
        </h1>
        {!canCreate && (
          <p className="mt-2.5 text-center text-sm text-muted-foreground">
            {tx('你是审阅成员，可以查看已授权的项目和生成结果。')}
          </p>
        )}

        {canCreate && (
          <>
            <div role="group" aria-label={tx('创作方式')} className="studio-jimeng-switcher mt-5 max-w-full overflow-x-auto">
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
                      'studio-jimeng-tab shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                      active && 'studio-jimeng-tab-active',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{tx(entry.title)}</span>
                  </button>
                )
              })}
            </div>

            <div data-tour="creator" role="region" aria-label={tx('开始创作')} className="studio-jimeng-composer mt-5 w-full max-w-[900px]">
              {mode === 'project' ? (
                <div className="p-5 sm:p-6">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{team ? tx('新建团队项目') : tx('创建完整作品')}</span>
                    <Link
                      prefetch={false}
                      href={directEntry.href}
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {tx(directEntry.label)}<ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                  {team ? (
                    <TeamProjects team={team} intent="create" />
                  ) : (
                    <PluginProjectStarter
                      brief={prompt}
                      onBriefChange={setPrompt}
                      initialFiles={compatibleFiles}
                    />
                  )}
                </div>
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
                    isFileCompatible={mode === 'agent' ? undefined : isMediaCompatibleImage}
                    incompatibleLabel={mode === 'agent' ? undefined : tx('仅创作助手')}
                    slashSkills={displayedSkills}
                    onSelectSlashSkill={(skill) => {
                      applyQuickBrief(skill.prompt, skill.mode)
                    }}
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
                    creditNote={team ? tx('进入工作台后按实际参数核对积分') : undefined}
                    compatibilityNote={compatibilityNote}
                    submitLabel={mode === 'agent' ? tx('开始创作') : mode === 'image' ? tx('生成图片') : tx('生成视频')}
                    directHref={directEntry.href}
                    directLabel={directEntry.label}
                    hideSkillsLink={Boolean(team)}
                    canStart={canStart}
                    starting={starting}
                    startError={startError}
                  />
                </form>
              )}
            </div>

            <div className="mt-4 flex w-full max-w-[900px] flex-wrap items-center justify-center gap-2" aria-label={tx('快捷灵感技能')}>
              {displayedSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => applyQuickBrief(skill.prompt, skill.mode)}
                  className="studio-jimeng-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <span>/ {tx(skill.label)}</span>
                </button>
              ))}
              {!team && (
                <Link
                  prefetch={false}
                  href="/skills"
                  className="studio-jimeng-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <span>{tx('更多技能')}</span>
                  <ArrowRight className="size-3" aria-hidden="true" />
                </Link>
              )}
            </div>
          </>
        )}
      </section>

      {team ? (
        <div className="flex justify-center">
          <Link prefetch={false} href={href('/tools')} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <Puzzle className="size-4" aria-hidden="true" />{tx('功能中心')}<ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          <HomeShowcase onApplyPreset={handlePresetApply} />
          <RecentWorks />
        </>
      )}

      <SiteFooter placement="studio" />
    </div>
  )
}
