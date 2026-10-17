'use client'

import type { FormEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  Bot,
  Check,
  Columns2,
  Copy,
  Image as ImageIcon,
  Layers3,
  Maximize2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Video,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DirectorAgent } from './director-agent'
import { MediaDownloadButton } from './media-download-button'
import {
  ControlButton,
  IconAction,
  MediaThumb,
  Modal,
  Notice,
  SelectField,
  SidePanel,
  StatusBadge,
  Tooltip,
} from './ui'
import {
  OptionGrid,
  ParamSection,
  ReferencePicker,
  ReferenceUploader,
  ResultActions,
  ResultStage,
  WorkspaceShell,
  ratioToCss,
  type UploadItem,
} from './workspace-kit'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { GenerationErrorNotice, GenerationNotice, LiveTaskList, LocalPreviewNotice } from './live-generation'
import { defaultModelFor, filterModelsByCapability, imageQualityOptions, qualityLabel, ratioDimension } from '@/lib/studio/studio-models'
import { accountDataEpoch } from '@/lib/studio/account-data-sync'
import { useServerWorks, useLibraryAssets } from '@/lib/studio/use-account-data'
import { useVideoReferenceLibrary } from '@/lib/studio/use-video-reference-library'
import type { StudioWork } from '@/lib/studio/account-api'
import { createLibraryAsset } from '@/lib/studio/account-api'
import { libraryAssetToReferenceAsset, mergeReferenceAssets, workToReferenceAsset } from '@/lib/studio/reference-assets'
/**
 * 已选参考素材用**独立快照**保存（含地址），不再只存 id 后回到候选池反查。
 * 详见 `lib/studio/reference-selection.ts` 的文件头说明。
 */
import {
  clampSelections,
  completeEvidence,
  createReconcileRound,
  describeReconcile,
  reconcileWithSources,
  selectionSourceOf,
  selectionsToReferences,
  toggleSelection,
  unavailableEvidence,
  WORK_ID_PREFIX,
  type LiveSourceEvidence,
  type SelectedReference,
  type SelectionSourceKind,
} from '@/lib/studio/reference-selection'
import type { Asset, GenerationSettings, ModelConfig, Work } from '@/lib/studio/types'
import { publishReferenceAsset } from '@/lib/studio/generation-api'
import { buildVideoReferences } from '@/lib/studio/video-references'
import { ImageEditorPanel, type ImageEditRequest, type ImageEditorVersion } from '@/components/free-canvas/image-editor-panel'
import type { GenerationReference } from '@/lib/studio/generation-types'
import { hasDeliverable } from '@/lib/studio/result-delivery'
import { addMediaToProject, listProjectReferencedSourceIds, type ProjectMediaInput } from '@/lib/studio/project-media'
import { consumeCreateIntent, dataUrlToFile, type IntentFile } from '@/lib/studio/create-intent'
import { consumeReuseParams, type ReuseParams } from '@/lib/studio/reuse-params'
import { readImageSize } from '@/lib/studio/account-api'
import { cn } from '@/lib/utils'

/**
 * 把界面上的「生成方式」选项解析成后端 `kind`。
 * `auto` 保持原有行为：带参考图时走编辑，否则走文生图。
 */
function resolveGenerationKind(choice: string | undefined, referenceCount: number): 'generation' | 'edit' {
  if (choice === 'generation') return 'generation'
  if (choice === 'edit') return 'edit'
  return referenceCount ? 'edit' : 'generation'
}

/**
 * 把首页传来的参考文件转成工作台的上传项。
 *
 * 首页已经把文件读成 data URL，因此这里**不需要用户再选一次**；
 * 逐个读取真实尺寸用于预览；单个失败如实报告，不影响其它文件。
 */
async function ingestIntentFiles(
  files: IntentFile[],
  setUploads: React.Dispatch<React.SetStateAction<UploadItem[]>>,
  setNotice: (value: { tone: 'neutral' | 'warning' | 'accent'; text: string } | null) => void,
) {
  const failed: string[] = []
  for (const file of files) {
    const restored = dataUrlToFile(file)
    if (!restored) { failed.push(file.name); continue }
    const size = await readImageSize(restored).catch(() => null)
    const item: UploadItem = {
      id: `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: restored.size,
      preview: file.dataUrl,
      progress: 100,
      status: 'done',
      kind: file.type.startsWith('video') ? 'video' : 'image',
      dataUrl: file.dataUrl,
      ...(size ? { dimensions: `${size.width}×${size.height}` } : {}),
    }
    setUploads((current) => [...current, item])
  }
  if (failed.length) setNotice({ tone: 'warning', text: `有 ${failed.length} 个参考文件读取失败：${failed.join('、')}` })
}

const imageViewOptions = [
  { value: 'single', label: '单图', icon: <ImageIcon className="size-3.5" aria-hidden="true" /> },
  { value: 'grid', label: '多结果', icon: <Layers3 className="size-3.5" aria-hidden="true" /> },
  { value: 'compare', label: '对比', icon: <Columns2 className="size-3.5" aria-hidden="true" /> },
]

const videoViewOptions = [
  { value: 'single', label: '当前结果', icon: <Video className="size-3.5" aria-hidden="true" /> },
  { value: 'grid', label: '全部结果', icon: <Layers3 className="size-3.5" aria-hidden="true" /> },
]

/** Preview history is independent of how many results the next request will create. */
export function previewWorks(works: Work[], view: string, selectedId: string | null) {
  const selected = works.find((work) => work.id === selectedId) ?? works[0]
  if (!selected) return []
  if (view === 'single') return [selected]
  if (view === 'compare') return [selected, ...works.filter((work) => work.id !== selected.id)].slice(0, 2)
  return works
}

export function generationBlockReason(backendStatus: string, hasModel: boolean, credits: number, balance: number) {
  if (backendStatus === 'checking') return '正在连接生成服务…'
  if (backendStatus === 'unauthenticated') return '登录后即可开始生成。'
  if (backendStatus !== 'connected') return '生成服务暂时无法连接，请稍后重试。'
  if (!hasModel) return '当前没有可用模型，请联系管理员配置后再试。'
  if (Number.isFinite(balance) && Number.isFinite(credits) && credits > balance) return `积分不足：预计需要 ${credits} 积分，当前余额 ${balance}。`
  return ''
}

export function supportedChoice(value: string, choices: string[]) {
  return choices.includes(value) ? value : choices[0] ?? value
}

export function resolveReusedParameters(params: ReuseParams, models: Pick<ModelConfig, 'id' | 'name' | 'shortName'>[]) {
  const exact = models.find((model) => model.id === params.model)
  const named = models.filter((model) => model.name === params.model || model.shortName === params.model)
  const modelId = exact?.id ?? (named.length === 1 ? named[0].id : undefined)
  const missingModel = Boolean(params.model && !modelId)
  const changed = [params.prompt ? '提示词' : '', modelId ? '模型' : ''].filter(Boolean).join('与')
  return {
    prompt: params.prompt, modelId,
    notice: { tone: missingModel ? 'warning' as const : 'accent' as const, text: `${changed ? `已带入${changed}。` : ''}${missingModel ? '原模型当前不可用，保留现选模型；请核对模型后再生成。' : '请核对其余参数后再生成。'}` },
  }
}

function useWorkReuseParams({ kind, accountId, connected, models, prompt, protectDraft, setPrompt, setModelId, setNotice }: {
  kind: ReuseParams['kind']; accountId: string; connected: boolean; models: ModelConfig[]; prompt: string
  protectDraft: { current: boolean }
  setPrompt: (value: string) => void; setModelId: (value: string) => void
  setNotice: (value: { tone: 'neutral' | 'warning' | 'accent'; text: string } | null) => void
}) {
  const consumedAccount = useRef('')
  const promptRef = useRef(prompt)
  promptRef.current = prompt
  const [pending, setPending] = useState<{ accountId: string; params: ReuseParams } | null>(null)
  const apply = useCallback((params: ReuseParams) => {
    const resolved = resolveReusedParameters(params, models)
    if (resolved.prompt) setPrompt(resolved.prompt)
    if (resolved.modelId) setModelId(resolved.modelId)
    setNotice(resolved.notice)
    setPending(null)
  }, [models, setPrompt, setModelId, setNotice])
  useEffect(() => {
    if (!connected || !accountId || consumedAccount.current === accountId) return
    consumedAccount.current = accountId
    setPending(null)
    try {
      const result = consumeReuseParams(window.sessionStorage, accountId, kind)
      if (result.status === 'invalid') { setNotice({ tone: 'warning', text: result.message }); return }
      if (result.status !== 'ready') return
      // A slow session response must never overwrite text typed in the meantime.
      if (promptRef.current.trim() || protectDraft.current) setPending({ accountId, params: result.params })
      else apply(result.params)
    } catch {
      setNotice({ tone: 'warning', text: '浏览器暂时无法读取待复用参数，请回到原记录重试。' })
    }
  }, [accountId, connected, kind, apply, protectDraft, setNotice])
  const available = pending?.accountId === accountId && connected
  return {
    pending: available,
    applyPending: () => { if (available && pending) apply(pending.params) },
    dismiss: () => setPending(null),
  }
}

function ReuseDraftNotice({ apply, dismiss }: { apply: () => void; dismiss: () => void }) {
  return <Notice tone="neutral"><div className="flex min-w-0 flex-col gap-2"><p className="text-xs leading-5">已收到作品参数。套用会替换当前描述及可用的原模型，其他参数请自行核对。</p><div className="flex flex-wrap gap-2"><ControlButton type="button" size="sm" onClick={apply}>套用作品参数</ControlButton><ControlButton type="button" size="sm" variant="secondary" onClick={dismiss}>保留当前草稿</ControlButton></div></div></Notice>
}

/** 结果卡片：媒体轻微放大、操作按钮渐显，选中态用描边表达而不遮挡素材。 */function ResultTile({
  work,
  ratio,
  selected,
  onSelect,
  onOpen,
  label,
  className,
  fit = false,
}: {
  work: Work
  ratio: string
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  label: string
  className?: string
  fit?: boolean
}) {
  return (
    <div className={cn('group relative min-w-0 overflow-hidden rounded-lg border bg-studio-ink', selected ? 'border-studio-accent ring-1 ring-inset ring-studio-accent' : 'border-studio-ink-line', className)}>
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`选择 ${label}`} className={cn('block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent', fit && 'h-full')}>
        <span className={cn('block w-full', fit && 'h-full')} style={fit ? undefined : { aspectRatio: ratioToCss(work.ratio || ratio) }}>
          <MediaThumb
            src={work.src}
            poster={work.poster}
            kind={work.kind === 'video' ? 'video' : 'image'}
            alt={work.title}
            fallback="预览加载失败，可打开详情或重试下载"
            className="size-full [&_img]:object-contain [&_video]:object-contain"
          />
        </span>
      </button>
      <span className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <span className="rounded bg-studio-ink/75 px-1.5 py-0.5 text-[10px] font-medium text-studio-ink-foreground">{label}</span>
        {selected && (
          <span className="flex size-4 items-center justify-center rounded-full bg-studio-accent text-studio-accent-foreground">
            <Check className="size-2.5" aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-studio-ink/90 to-transparent px-2 pb-2 pt-6 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:has-[[role=alert]]:opacity-100">
        <span className="truncate text-[10px] text-studio-ink-foreground">{work.model}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          <Tooltip label="预览">
            <IconAction label={`预览 ${work.title}`} onClick={onOpen} className="size-6 text-studio-ink-foreground hover:bg-studio-ink-surface hover:text-studio-ink-foreground">
              <Maximize2 className="size-3" aria-hidden="true" />
            </IconAction>
          </Tooltip>
          <MediaDownloadButton media={{ url: work.src, kind: work.kind }} title={work.title} iconOnly className="flex size-6 items-center justify-center rounded text-studio-ink-foreground hover:bg-studio-ink-surface hover:text-studio-ink-foreground disabled:opacity-50" />
          <Tooltip label="更多操作">
            <IconAction label={`${work.title} 的更多操作`} onClick={onOpen} className="size-6 text-studio-ink-foreground hover:bg-studio-ink-surface hover:text-studio-ink-foreground">
              <MoreHorizontal className="size-3" aria-hidden="true" />
            </IconAction>
          </Tooltip>
        </span>
      </span>
    </div>
  )
}

function getMediaRatio(ratio: string) {
  const [width, height] = ratio.split(':').map((value) => Number.parseFloat(value))
  return width > 0 && height > 0 ? width / height : 16 / 9
}

function getRenderedMediaRatio(media: HTMLDivElement, fallbackRatio: string) {
  const image = media.querySelector<HTMLImageElement>('img')
  if (image?.naturalWidth && image.naturalHeight) return image.naturalWidth / image.naturalHeight

  const video = media.querySelector<HTMLVideoElement>('video')
  if (video?.videoWidth && video.videoHeight) return video.videoWidth / video.videoHeight

  return getMediaRatio(fallbackRatio)
}

function getPanBounds(width: number, height: number, zoom: number, mediaRatio: number) {
  const viewportRatio = width / height
  const mediaWidth = viewportRatio > mediaRatio ? height * mediaRatio : width
  const mediaHeight = viewportRatio > mediaRatio ? height : width / mediaRatio
  return {
    maxX: Math.max(0, (mediaWidth * zoom - width) / 2),
    maxY: Math.max(0, (mediaHeight * zoom - height) / 2),
  }
}

function clampPan(pan: { x: number; y: number }, bounds: { maxX: number; maxY: number }) {
  return {
    x: Math.min(bounds.maxX, Math.max(-bounds.maxX, pan.x)),
    y: Math.min(bounds.maxY, Math.max(-bounds.maxY, pan.y)),
  }
}

function ZoomableMedia({ work }: { work: Work }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const mediaRef = useRef<HTMLDivElement>(null)

  const clampToMediaBounds = useCallback((nextPan: { x: number; y: number }, nextZoom = zoom) => {
    const media = mediaRef.current
    if (!media || media.offsetWidth === 0 || media.offsetHeight === 0) return nextPan
    return clampPan(nextPan, getPanBounds(media.offsetWidth, media.offsetHeight, nextZoom, getRenderedMediaRatio(media, work.ratio)))
  }, [work.ratio, zoom])

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return

    const keepPanInBounds = () => setPan((currentPan) => clampToMediaBounds(currentPan))
    const image = media.querySelector('img')
    const video = media.querySelector('video')
    keepPanInBounds()
    image?.addEventListener('load', keepPanInBounds)
    video?.addEventListener('loadedmetadata', keepPanInBounds)
    const observer = new ResizeObserver(keepPanInBounds)
    observer.observe(media)
    return () => {
      image?.removeEventListener('load', keepPanInBounds)
      video?.removeEventListener('loadedmetadata', keepPanInBounds)
      observer.disconnect()
    }
  }, [clampToMediaBounds, work.poster, work.src])

  const updateZoom = (nextZoom: number) => {
    const next = Math.min(4, Math.max(1, Math.round(nextZoom * 10) / 10))
    setZoom(next)
    setPan((currentPan) => next === 1 ? { x: 0, y: 0 } : clampToMediaBounds(currentPan, next))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    setDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setPan(clampToMediaBounds({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }))
  }

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setDragging(false)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    updateZoom(zoom + (event.deltaY > 0 ? -0.1 : 0.1))
  }

  return (
    <div
      className={cn('relative h-[min(68dvh,720px)] select-none overflow-hidden overscroll-contain rounded-sm bg-studio-ink touch-none', zoom > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in')}
      role="region"
      onDragStart={(event) => event.preventDefault()}
      aria-label={`图片详情预览，当前缩放 ${Math.round(zoom * 100)}%`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onWheel={handleWheel}
      onDoubleClick={() => updateZoom(zoom > 1 ? 1 : 2)}
    >
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-2 sm:p-4">
        <div
          ref={mediaRef}
          className="size-full origin-center will-change-transform"
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, transition: dragging ? 'none' : 'transform 180ms ease-out' }}
        >
          <MediaThumb src={work.src} poster={work.poster} kind={work.kind === 'video' ? 'video' : 'image'} alt={work.title} fallback={work.fallback} className="size-full [&_img]:object-contain [&_video]:object-contain" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <span className="rounded-md bg-studio-ink/80 px-2.5 py-1.5 text-[11px] font-medium text-studio-ink-foreground">
          {zoom > 1 ? '拖动查看细节' : '滚轮或双击放大'}
        </span>
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-studio-ink-foreground/15 bg-studio-ink/80 p-1 text-studio-ink-foreground shadow-lg">
          <IconAction label="缩小" onClick={() => updateZoom(zoom - 0.5)} disabled={zoom <= 1} className="size-7 text-studio-ink-foreground hover:bg-studio-ink-surface hover:text-studio-ink-foreground disabled:opacity-40">
            <ZoomOut className="size-3.5" aria-hidden="true" />
          </IconAction>
          <span className="min-w-11 text-center text-[11px] font-medium tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <IconAction label="放大" onClick={() => updateZoom(zoom + 0.5)} disabled={zoom >= 4} className="size-7 text-studio-ink-foreground hover:bg-studio-ink-surface hover:text-studio-ink-foreground disabled:opacity-40">
            <ZoomIn className="size-3.5" aria-hidden="true" />
          </IconAction>
          <span className="mx-0.5 h-4 w-px bg-studio-ink-foreground/20" aria-hidden="true" />
          <IconAction label="重置缩放" onClick={() => { updateZoom(1); setPan({ x: 0, y: 0 }) }} className="size-7 text-studio-ink-foreground hover:bg-studio-ink-surface hover:text-studio-ink-foreground">
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </IconAction>
        </div>
      </div>
    </div>
  )
}

function ResultDetailModal({ work, onClose, onNotice }: { work: Work | null; onClose: () => void; onNotice: (text: string) => void }) {
  const router = useRouter()
  const [zoomed, setZoomed] = useState(false)
  if (!work) return null

  const closeModal = () => {
    if (zoomed) {
      setZoomed(false)
    } else {
      onClose()
    }
  }

  return (
    <Modal
      open
      title={zoomed ? `${work.title} · 放大预览` : work.title}
      description={zoomed ? '使用按钮或滚轮放大，拖动画面查看细节。' : `${work.kind === 'image' ? '图片' : '视频'} · ${work.model} · ${work.ratio}`}
      onClose={closeModal}
      className={zoomed ? 'max-w-[min(96vw,1100px)]' : undefined}
      footer={
        zoomed ? (
          <ControlButton variant="secondary" size="sm" onClick={() => setZoomed(false)}>
            返回详情
          </ControlButton>
        ) : (
          <>
            <ControlButton variant="secondary" size="sm" onClick={() => onNotice('当前结果参数已保留，可直接在工作台继续调整。')}>
              <Copy className="size-3.5" aria-hidden="true" />
              复用参数
            </ControlButton>
            {/**
              * 结果详情里的画布入口。
              * 早先写死 `/canvas/aurora`（演示项目，真实账号下 404）；
              * 现在进入画布入口页，由它解析当前用户的真实项目。
              */}
            <ControlButton variant="secondary" size="sm" onClick={() => router.push('/canvas')}>
              <Send className="size-3.5" aria-hidden="true" />
              送入画布
            </ControlButton>
            <ControlButton variant="primary" size="sm" onClick={() => onNotice('请在结果舞台使用「加入项目」，那里会真实写入所选项目。')}>
              <Plus className="size-3.5" aria-hidden="true" />
              加入项目
            </ControlButton>
            <MediaDownloadButton media={{ url: work.src, kind: work.kind }} title={work.title} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted disabled:opacity-50" />
          </>
        )
      }
    >
      {zoomed ? (
        <ZoomableMedia work={work} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label={`放大查看 ${work.title}`}
            className="group relative block w-full overflow-hidden rounded-lg border border-border bg-studio-workspace text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"
          >
            <div style={{ aspectRatio: ratioToCss(work.ratio) }}>
              <MediaThumb src={work.src} poster={work.poster} kind={work.kind === 'video' ? 'video' : 'image'} alt={work.title} fallback={work.fallback} className="size-full" />
            </div>
            <span className="pointer-events-none absolute inset-0 flex items-end justify-end bg-studio-ink/0 p-3 transition-colors duration-200 group-hover:bg-studio-ink/25 group-focus-visible:bg-studio-ink/25">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-studio-ink/80 px-2.5 py-1.5 text-xs font-medium text-studio-ink-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                <Maximize2 className="size-3.5" aria-hidden="true" />
                放大预览
              </span>
            </span>
          </button>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="flex justify-between gap-2 border-b border-border/60 py-2"><dt className="text-muted-foreground">状态</dt><dd className="font-medium text-foreground">{work.status}</dd></div>
            <div className="flex justify-between gap-2 border-b border-border/60 py-2"><dt className="text-muted-foreground">更新时间</dt><dd className="font-medium text-foreground">{work.updatedAt}</dd></div>
          </dl>
        </>
      )}
    </Modal>
  )
}

export function ImageWorkspace() {
  const { state, estimateCredits, liveModels, liveReady, defaultModels } = useStudio()
  const generation = useGeneration()
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const intentDraft = useRef(false)
  const imageModelList = useMemo(() => filterModelsByCapability(liveModels, 'image'), [liveModels])
  const videoModelList = useMemo(() => filterModelsByCapability(liveModels, 'video'), [liveModels])
  /** 真实生成结果：既作为参考素材候选，也作为结果舞台的展示来源。 */
  const serverWorksResult = useServerWorks({ pageSize: 24, kind: 'image' })
  /** 素材库搜索词（服务端 keyword 参数）：素材超过一页时用户仍能找到目标素材。 */
  const [libraryKeyword, setLibraryKeyword] = useState('')
  /**
   * 真实素材库：用户上传并落库的素材。
   *
   * 早先图片工作台只读「后端生成结果」，**从未调用素材库接口**，
   * 于是用户在 /assets 上传的图片在这里选不到，「从素材库选择」永远是空网格。
   * 视频工作台早已用 `useLibraryAssets` 修好同类问题，这里与之对齐。
   */
  const serverLibrary = useLibraryAssets({ pageSize: 60, kind: 'image', keyword: libraryKeyword })
  const [modelId, setModelId] = useState(() => imageModelList[0]?.id ?? '')
  const [ratio, setRatio] = useState(defaultModels.imageSize || '16:9')
  const [resolution, setResolution] = useState('1K')
  // 1K 只接受 auto；保持首屏状态与清晰度约束一致，避免先渲染一个旧的中文质量值。
  const [quality, setQuality] = useState('auto')
  const [count, setCount] = useState(String(defaultModels.imageCount || 4))
  const [view, setView] = useState('grid')
  const [advanced, setAdvanced] = useState(false)
  /**
   * 已选参考素材（**完整快照**，含媒体地址）。
   *
   * 早先只存 id，提交时回到候选池反查地址；候选池由搜索结果驱动，
   * 于是「选 A → 搜索 B → 提交」时 A 查不到、被静默丢弃。
   * 现在选中即固化快照，搜索结果只决定候选列表、不决定已选集合。
   */
  const [selectedRefs, setSelectedRefs] = useState<SelectedReference[]>([])
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [notice, setNotice] = useState<{ tone: 'neutral' | 'warning' | 'accent'; text: string } | null>(null)
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const [editorWork, setEditorWork] = useState<Work | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  /** 提交锁：从点击生成到后端确认之前，禁止再次提交，避免双击产生两条任务。 */
  const [submitting, setSubmitting] = useState(false)
  /** 项目写入进行中：避免重复点击产生重复节点。 */
  const [projectBusy, setProjectBusy] = useState(false)
  /** 当前项目里已经引用的媒体标识，用于如实显示「已加入」。 */
  const [referencedIds, setReferencedIds] = useState<string[]>([])
  /**
   * 高级参数只保留后端真正支持的项。
   * 早先的「风格强度 / 随机种子」下拉的 onChange 是空实现，属无效控件，已移除。
   * 这里只暴露会随请求提交、且影响真实结果的参数。
   */
  const [advancedValues, setAdvancedValues] = useState<Record<string, string>>({})

  // 拿到真实模型目录后自动切到后端默认模型，避免继续使用演示模型 ID。
  useEffect(() => {
    if (!imageModelList.length) return
    setModelId((current) => imageModelList.some((item) => item.id === current) ? current : defaultModelFor('image', state.sessionSettings, imageModelList))
  }, [imageModelList, state.sessionSettings])

  /**
   * 套用首页传来的创作意图。
   *
   * 早先工作台的提示词是**写死的示例文案**，首页输入的内容完全丢失。
   * 现在：有意图时用用户输入替换示例；并把首页选的参考文件转成上传项。
   * `consumeCreateIntent` 读取即清除，因此不会在刷新后重复套用。
   */
  useEffect(() => {
    const intent = consumeCreateIntent('image')
    if (!intent) return
    intentDraft.current = true
    if (intent.prompt.trim()) setPrompt(intent.prompt)
    if (intent.settings?.model) setModelId(intent.settings.model)
    if (intent.settings?.ratio) setRatio(intent.settings.ratio)
    if (intent.settings?.quality) setQuality(intent.settings.quality)
    if (intent.files.length) {
      void ingestIntentFiles(intent.files, setUploads, setNotice)
    }
    setNotice({ tone: 'accent', text: `已带入首页的创作描述${intent.files.length ? `与 ${intent.files.length} 个参考文件` : ''}。` })
    // 只在挂载时消费一次意图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reused = useWorkReuseParams({ kind: 'image', accountId: state.user.id, connected: state.backendStatus === 'connected', models: imageModelList, prompt, protectDraft: intentDraft, setPrompt, setModelId, setNotice })

  const model = imageModelList.find((item) => item.id === modelId) ?? imageModelList[0]
  const ratioOptions = model?.capabilities.ratios.length ? model.capabilities.ratios : ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9']
  const resolutionOptions = model?.capabilities.resolutions?.length ? model.capabilities.resolutions : ['1K']
  const qualityOptions = useMemo(() => imageQualityOptions(model, resolution), [model, resolution])
  const ratioCards = useMemo(() => ratioOptions.map((item) => ({
    value: item,
    label: item,
    hint: ratioDimension(item, model?.capabilities.outputDimensions, resolution, model?.capabilities.outputDimensionsByResolution),
  })), [model, ratioOptions, resolution])
  const credits = model ? estimateCredits(model.id, { ratio, quality, count: Number(count) }) : 0
  const submitBlock = generationBlockReason(state.backendStatus, Boolean(model), credits, state.credits)
  /**
   * 后端图片任务一次请求只产出一张图，因此批量数量来自后端 `maxBatchSize`：
   * 上限为 1 时不提供多张选项，避免界面给出后端无法满足的参数。
   */
  const maxBatch = Math.max(1, model?.capabilities.maxBatchSize ?? 1)
  const countOptions = useMemo(() => Array.from({ length: maxBatch }, (_, index) => String(index + 1)), [maxBatch])
  // 切换模型后重新校验数量：新模型上限更低时必须回落到允许值。
  useEffect(() => {
    setCount((current) => (Number(current) > maxBatch ? String(maxBatch) : current))
  }, [maxBatch])
  useEffect(() => {
    if (!model) return
    setRatio((current) => supportedChoice(current, model.capabilities.ratios.length ? model.capabilities.ratios : ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9']))
    setResolution((current) => supportedChoice(current, model.capabilities.resolutions?.length ? model.capabilities.resolutions : ['1K']))
  }, [model])
  useEffect(() => {
    setQuality((current) => supportedChoice(current, qualityOptions))
  }, [qualityOptions])

  /**
   * 高级参数只列出后端确实支持、并且会真实提交的参数。
   * 没有对应后端字段的控件一律不显示，避免给出无效选项。
   */
  const advancedParameters = useMemo(() => {
    const parameters: Array<{ key: string; label: string; current: string; options: Array<{ value: string; label: string }> }> = []
    // 只有模型支持参考图（= 支持编辑）时才提供生成方式选择，该值会真实提交给后端 kind 字段。
    if (model?.capabilities.editing) {
      parameters.push({
        key: 'kind',
        label: '生成方式',
        current: advancedValues.kind ?? 'auto',
        options: [
          { value: 'auto', label: '自动（有参考图时走编辑）' },
          { value: 'generation', label: '始终文生图' },
          { value: 'edit', label: '始终按编辑处理' },
        ],
      })
    }
    return parameters
  }, [advancedValues.kind, model?.capabilities.editing])
  const liveImageTasks = generation.tasks.filter((task) => task.kind === 'image')
  const liveLatest = liveImageTasks[0]
  /**
   * 结果舞台的展示来源。
   *
   * 真实账户下必须用后端结果；早先只读 `state.works`（本地演示数据），
   * 因此后端已有结果时预览区仍然空白，只能显示「还没有结果」。
   * 这里把后端结果放在前面，本地条目仅用于未登录预览。
   */
  const stageWorks = useMemo<Work[]>(() => {
    if (serverWorksResult.state === 'unauthenticated') return []
    return serverWorksResult.works.map((work) => ({
      id: work.id,
      kind: (work.kind === 'video' ? 'video' : 'image') as Work['kind'],
      title: work.title,
      src: work.src,
      poster: work.poster,
      fallback: work.fallback,
      model: work.model ?? '',
      ratio,
      // 后端成功结果在结果舞台上就是已完成；本地预览条目使用自己的状态值。
      status: '已发布' as Work['status'],
      prompt: work.prompt,
      createdAt: work.createdAt ?? new Date().toISOString(),
      updatedAt: work.createdAt ?? new Date().toISOString(),
      duration: work.durationMs ? `${Math.round(work.durationMs / 1000)} 秒` : undefined,
    }))
  }, [ratio, serverWorksResult.state, serverWorksResult.works])

  /**
   * 本次会话中已完成、但可能还没出现在作品列表里的任务结果。
   *
   * 作品列表来自后端生成记录，写入与列表刷新之间存在时间差；
   * 若只依赖它，用户会看到「任务卡已完成但舞台还是空的」。
   * 这里把任务自带的媒体直接并入舞台，做到「完成即可见」。
   */
  const completedTaskWorks = useMemo<Work[]>(() => {
    return liveImageTasks
      .filter((task) => hasDeliverable(task))
      .flatMap((task) => task.media.map((media, index) => ({
        id: `${task.id}#${index}`,
        kind: (media.kind === 'video' ? 'video' : 'image') as Work['kind'],
        title: task.title,
        src: media.url,
        poster: media.poster,
        fallback: media.poster || media.url,
        model: task.model,
        ratio,
        status: '已发布' as Work['status'],
        prompt: task.prompt,
        createdAt: new Date(task.createdAt).toISOString(),
        updatedAt: new Date(task.updatedAt).toISOString(),
      })))
  }, [liveImageTasks, ratio])

  /** 舞台来源 = 已完成任务（最新） + 后端作品；按 id 去重，任务结果优先。 */
  const stageSource = useMemo<Work[]>(() => {
    const seen = new Set<string>()
    const merged: Work[] = []
    for (const work of [...completedTaskWorks, ...stageWorks]) {
      // 同一个后端结果可能既在任务里又在作品列表里，URL 相同即视为同一条。
      const key = work.src || work.id
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(work)
    }
    return merged
  }, [completedTaskWorks, stageWorks])
  const latestLiveMedia = liveLatest?.media ?? []
  // 真实任务可用时，舞台状态与文案来自后端任务；否则回落到本地预览状态。
  const stageStatus: 'idle' | 'queued' | 'processing' | 'failed' | 'done' = liveLatest
    ? liveLatest.status === 'pending' ? 'queued' : liveLatest.status === 'running' ? 'processing' : liveLatest.status === 'error' ? 'failed' : liveLatest.status === 'success' ? 'done' : 'idle'
    : stageSource.length > 0 ? 'done' : 'idle'
  const stageLabel = liveLatest
    ? liveLatest.unconfirmed ? '提交结果待确认' : ({ pending: '已提交，等待处理', running: '生成中', paused: '已暂停', success: '已完成', error: '生成失败', cancelled: '已取消' } as Record<string, string>)[liveLatest.status] ?? liveLatest.status
    : stageSource.length ? '已完成' : '等待创作'
  const selectedWork = stageSource.find((work) => work.id === selectedWorkId) ?? stageSource[0]
  const visibleWorks = previewWorks(stageSource, view, selectedWorkId)
  /**
   * 参考素材候选池（真实来源）。
   *
   * 真实来源 = 后端素材库（用户上传的持久素材）+ 后端已生成的作品，
   * 两者按 URL 去重；只有未登录时才回落到本地演示素材，
   * 避免真实账户下「从素材库选择」是空的。
   */
  const serverReferenceAssets = useMemo<Asset[]>(() => mergeReferenceAssets([
    serverLibrary.assets.map(libraryAssetToReferenceAsset),
    serverWorksResult.works.map(workToReferenceAsset),
  ]), [serverLibrary.assets, serverWorksResult.works])

  /**
   * 当前模型允许的参考图数量。
   *
   * `0` **只**在后端明确声明不支持参考图时出现（见 `lib/studio/studio-models.ts`：
   * 未配置 `capabilityProfile` 时用保守默认值而不是 0，因为后端在没有 profile 时
   * 实际上会受理带参考图的请求）。因此这里用 0 隐藏入口是安全的；
   * 若把「未配置」也映射成 0，用户报的「选不到上传素材」会变成「根本没有入口」。
   */
  const referenceSelectionLimit = Math.max(0, model?.capabilities.maxReferences ?? 0)

  /**
   * 参考素材候选池。
   *
   * **不能**在「服务端结果为空」时无条件回落到本地演示素材：
   * `serverReferenceAssets.length === 0` 有三种完全不同的含义——
   *   a) 还没登录取不到真实数据 → 此时用演示素材做预览是合理的；
   *   b) 已登录、素材库已就绪，只是**当前搜索确实没有匹配**（或库真的是空的）
   *      → 回落到演示素材会凭空冒出 8 张本地图，让人以为「搜索没生效」；
   *   c) 正在按新关键词重新加载 → 此时**必须保留服务端来源**，不能切回演示素材。
   *
   * 实测踩到两处：(b) 搜索不存在的关键词后仍旧显示 8 条；
   * (c) 搜索触发的 loading 窗口里切回演示素材，
   *     导致归属校验池瞬间不含已选素材，**把用户的已选清空了**。
   *
   * 因此判定改为「是否曾经/正在从服务端取数」：
   * 只有 `idle`（未开始）与 `unauthenticated`（未登录）才用演示素材；
   * `loading` / `ready` / `error` 一律以服务端结果为准（含空结果）。
   */
  const libraryUsable = serverLibrary.state !== 'idle' && serverLibrary.state !== 'unauthenticated'

  const referencePool = useMemo<Asset[]>(() => {
    const pool = libraryUsable ? serverReferenceAssets : []
    // 图片工作台的参考素材只能是图片：视频/音频选了也不能作为参考图提交。
    return pool.filter((asset) => asset.kind === 'image' || asset.kind === 'scene')
  }, [libraryUsable, serverReferenceAssets])

  /**
   * **已选素材的存活校验**（按来源分别判定）。
   *
   * 三条硬约束，每条都对应一个真实缺陷：
   *  1. **只校验已选中的条目**：没有已选就不发请求，
   *     因此切换搜索词不会触发整库遍历（旧实现挂在挂载时整库遍历）；
   *  2. **只有拿到完整证据才判定删除**：`verifyLibraryIds` 逐页读全才算 `complete`，
   *     分页被截断/失败/未登录一律 `unavailable` → 保留已选。
   *     旧实现只读第一页（后端 pageSize 上限 100）就当全集，
   *     素材超过 100 条时第 101 条起全被误报已删除；
   *  3. **按来源分开判定**：生成作品（`generated-*`）不在素材库里，
   *     用素材库的 id 集合去校验它必然误判。作品的存活由 `useServerWorks`
   *     的**已加载完整性**决定（未截断才算证据）。
   */
  /**
   * 作品列表的**内容签名**。
   *
   * 不能用 `works.length` 判断"作品列表是否变了"：
   * 删除 A、同时新增 B 时长度完全相同，但内容已经变了，
   * 用长度做依赖会让校验**不重跑**，A 永远清不掉（本轮要求之一）。
   */
  const worksSignature = useMemo(
    () => serverWorksResult.works.map((work) => work.id).join(','),
    [serverWorksResult.works],
  )

  /**
   * **校验批次**：每次存活校验发号，只有最新一批可以写入。
   *
   * 为什么必须有（本轮缺陷）：一次校验由两个来源**并行**组成，
   * `Promise.all` 要等最慢的那个。等待期间用户可能又选了新素材，
   * 触发更新的批次。若旧批次最后返回还照旧写入，
   * 就会出现"旧结果覆盖新结果"——实测表现为**已选 2 变 1、B 被误报已删除**。
   *
   * 批次号同时携带**账号世代**与**选择版本**，
   * 因此"账号切换"与"选择变化"都能让旧批次失效（见 `isBatchCurrent`）。
   */
  const verifyBatchRef = useRef(0)
  const userId = state.user?.id ?? ''
  /** 已选集合的版本号：任何一次选择变化都自增，用于识别"批次已过期"。 */
  const selectionVersionRef = useRef(0)
  useEffect(() => { selectionVersionRef.current += 1 }, [selectedRefs.map((item) => item.id).join(',')])

  /**
   * **一轮校验的累计器**。
   *
   * 一次用户操作会分成多个批次（移除条目本身又会触发下一批），
   * 若每批各自 `setNotice`，后一批会把"刚刚移除了什么"覆盖掉（本轮 P3）。
   * 这里按"轮"累计，只对外给一条汇总通知。
   */
  const roundRef = useRef(createReconcileRound())

  const openBatch = useCallback((options: { manual?: boolean } = {}) => {
    verifyBatchRef.current += 1
    roundRef.current.begin(selectedRefs.map((item) => item.id), options)
    return {
      id: verifyBatchRef.current,
      epoch: accountDataEpoch(),
      userId,
      version: selectionVersionRef.current,
      /** 本批次发起时的已选快照：判定与提示都基于它（纯计算，不在 setState 里做副作用）。 */
      selections: selectedRefs,
    }
  }, [selectedRefs, userId])

  const isBatchCurrent = useCallback((batch: { id: number; epoch: number; userId: string; version: number }) => (
    batch.id === verifyBatchRef.current
    && batch.epoch === accountDataEpoch()
    && batch.userId === (state.user?.id ?? '')
    /** 选择上下文变过 → 本批次的选择快照已过期（例如用户刚取消了某个选择）。 */
    && batch.version === selectionVersionRef.current
  ), [state.user?.id])

  /**
   * 应用一批证据（唯一入口，自动校验与手动刷新共用）。
   *
   * 三条硬约束：
   *  1. **只有最新批次能写入**：旧批次的选择快照、通知都不允许覆盖新批次状态；
   *  2. **判定与通知都在 setState 之外算完**（纯函数 `reconcileWithSources` /
   *     `describeReconcile`），状态更新函数只做"按 id 过滤"这一件纯事 ——
   *     在 updater 里 `setNotice` 会让 React 的更新函数带副作用，
   *     并且删除提示与失败提示互相覆盖（本轮 P3）；
   *  3. **一轮只给一条汇总通知**：把本批结果累计进本轮，删除与失败一起说明。
   */
  const applyEvidence = useCallback((
    batch: { id: number; epoch: number; userId: string; version: number; selections: SelectedReference[] },
    libraryEvidence: LiveSourceEvidence,
    workEvidence: LiveSourceEvidence,
  ) => {
    if (!isBatchCurrent(batch)) return false
    const report = reconcileWithSources(batch.selections, { library: libraryEvidence, work: workEvidence })
    const unavailableSources: SelectionSourceKind[] = [
      ...(libraryEvidence.status === 'unavailable' ? (['library'] as SelectionSourceKind[]) : []),
      ...(workEvidence.status === 'unavailable' ? (['work'] as SelectionSourceKind[]) : []),
    ]
    roundRef.current.accumulate({ ...report, unavailableSources })
    const removedIds = new Set(report.removed.map((item) => item.id))
    if (removedIds.size) {
      /** 先登记"这些是我们自己移除的"，随后的批次才不会被误判成"用户取消了选择"。 */
      roundRef.current.noteSelfPruned(removedIds)
      setSelectedRefs((current) => {
        const kept = current.filter((item) => !removedIds.has(item.id))
        return kept.length === current.length ? current : kept
      })
    }
    const notice = describeReconcile(roundRef.current.get())
    if (notice) setNotice(notice)
    return true
  }, [isBatchCurrent])

  /**
   * 「刷新素材」：刷新候选池用到的**全部来源**，并用**本次刷新后的结果**做存活判定。
   *
   * 此前的缺陷：按钮只调用 `serverLibrary.reload()`，
   * 而生成作品的存在性判定仍读 `useServerWorks` 里的**旧列表** ——
   * 于是"刷新没有重新请求 generation-logs"，已删除的作品既留在候选列表里、
   * 也留在已选中，提交继续携带它的旧地址。
   */
  const [refreshing, setRefreshing] = useState(false)
  const refreshSources = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    /** 发号在**请求之前**：这样等待期间产生的新选择会让本批次过期。 */
    /** `manual` → 用户主动刷新，开新的一轮汇总。 */
    const batch = openBatch({ manual: true })
    try {
      /** 只校验**已选中的**作品 id：未选中的不需要证据，也就不必遍历作品库。 */
      const workIds = batch.selections.filter((item) => selectionSourceOf(item) === 'work').map((item) => item.id)
      /**
       * 两个来源**并行**刷新，各自返回本次刷新后的证据。
       * 两个可见列表也都要重载，否则候选池仍显示已删除的条目。
       */
      const [libraryEvidence, workEvidence] = await Promise.all([
        serverLibrary.reloadForLiveness(),
        serverWorksResult.verifyWorkIds(workIds),
      ])
      void serverLibrary.reload()
      void serverWorksResult.reload()
      /**
       * 组合结果**应用前**重新核对批次：刷新期间新选的素材由更新的批次负责，
       * 本批次不得据此判定删除（否则新选择会被误删）。
       */
      applyEvidence(batch, libraryEvidence, workEvidence)
    } finally {
      setRefreshing(false)
    }
  }, [applyEvidence, openBatch, refreshing, serverLibrary, serverWorksResult])

  /**
   * 已选集合变化 / 作品列表内容变化 / 收到增删信号时做一次存活收敛。
   *
   * 作品来源用 `verifyWorkIds` 做**定向**校验（只查已选 id、找到即提前结束），
   * 而不是拿可能被截断的 `serverWorksResult.works` 当证据 ——
   * 本机作品数远超展示上限，用列表当证据会永远"不完整"，
   * 已删除的作品就永远清不掉。
   */
  useEffect(() => {
    if (!selectedRefs.length) return
    const batch = openBatch()
    const libraryIds = batch.selections.filter((item) => selectionSourceOf(item) === 'library').map((item) => item.id)
    const workIds = batch.selections.filter((item) => selectionSourceOf(item) === 'work').map((item) => item.id)
    void (async () => {
      const [libraryEvidence, workEvidence] = await Promise.all([
        libraryIds.length ? serverLibrary.verifyLibraryIds(libraryIds) : Promise.resolve(completeEvidence([])),
        serverWorksResult.verifyWorkIds(workIds),
      ])
      applyEvidence(batch, libraryEvidence, workEvidence)
    })()
    // 只在"已选集合本身 / 作品**内容** / 增删信号"变化时校验；
    // 搜索结果变化不触发（避免每次输入都遍历全库）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRefs.map((item) => item.id).join(','), worksSignature, serverLibrary.liveVerifyTick, userId])

  /**
   * 模型上限变化时的收缩。
   *
   * 切到上限更低的模型必须回落，否则界面显示已选 N 张、后端却按能力过滤。
   * 如实提示移除了多少张，不静默丢弃。
   *
   * 与 `applyEvidence` 同一原则：**判定与提示都在 setState 之外算完**，
   * 状态更新函数只做纯过滤。
   */
  useEffect(() => {
    const { next, removed } = clampSelections(selectedRefs, referenceSelectionLimit)
    if (!removed.length) return
    const keep = new Set(next.map((item) => item.id))
    setSelectedRefs((current) => current.filter((item) => keep.has(item.id)))
    setNotice({ tone: 'warning', text: `当前模型最多支持 ${referenceSelectionLimit} 个参考素材，已移除超出的 ${removed.length} 个。` })
    // 只在模型上限变化时收缩；已选变化由上面那条校验 effect 负责。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceSelectionLimit])

  async function resolveImageReferences(): Promise<GenerationReference[]> {
    if (uploads.some((item) => item.status !== 'done')) throw new Error('参考素材仍在读取，请稍候再生成')
    if (uploads.length + selectedRefs.length > referenceSelectionLimit) throw new Error(`当前模型最多支持 ${referenceSelectionLimit} 个参考素材，请移除多余文件后重试。`)
    /**
     * 已选素材 → 提交给后端的 references。
     *
     * **直接读已选快照里的地址**，不再从候选池按 id 反查。
     * 反查的写法会让"当前搜索结果里没有的已选素材"解析失败并被静默丢弃
     * （本轮缺陷：选 A → 搜索 B → 提交时不再携带 A）。
     * 规则见 `lib/studio/reference-selection.ts`（可单独测试的纯函数）。
     */
    const libraryReferences = selectionsToReferences(selectedRefs, {
      max: referenceSelectionLimit,
      type: () => 'image',
    })
    const uploadedReferences = await Promise.all(uploads.filter((item) => item.dataUrl).map(async (item) => ({
      name: item.name,
      type: 'image',
      url: await publishReferenceAsset('image', item.dataUrl as string),
    })))
    return [...libraryReferences, ...uploadedReferences]
  }

  /**
   * 项目写入。
   *
   * 早先「加入项目」「送入画布」只是提示文案 + 写死 `/canvas/aurora`，
   * 既不落库也不管当前项目是哪个。现在真实写入项目画布，并如实报告结果：
   * 已存在、写入失败、未选择项目分别给出不同提示，绝不假装成功。
   */
  function mediaOf(work: Work): ProjectMediaInput {
    return {
      // 用后端结果 URL 作为稳定标识：同一结果重复加入不会产生重复节点。
      sourceId: work.src,
      title: work.title || '未命名结果',
      kind: work.kind === 'video' ? 'video' : 'image',
      url: work.src,
      poster: work.poster,
      prompt: work.prompt,
      model: work.model,
      detail: work.prompt,
    }
  }

  const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId)

  async function addToProject(): Promise<boolean> {
    if (!selectedWork) return false
    if (state.backendStatus !== 'connected') {
      setNotice({ tone: 'warning', text: '未登录：无法写入项目。请先登录后再加入项目。' })
      return false
    }
    if (!state.selectedProjectId) {
      setNotice({ tone: 'warning', text: '还没有选择项目。请先到「项目」新建或选择一个项目。' })
      return false
    }
    setProjectBusy(true)
    try {
      const result = await addMediaToProject(state.selectedProjectId, mediaOf(selectedWork))
      setReferencedIds((current) => current.includes(selectedWork.src) ? current : [...current, selectedWork.src])
      setNotice({
        tone: result.alreadyPresent ? 'neutral' : 'accent',
        text: result.alreadyPresent
          ? `该结果已经在「${selectedProject?.title ?? state.selectedProjectId}」中，未重复添加。`
          : `已加入「${selectedProject?.title ?? state.selectedProjectId}」，刷新或换浏览器都能看到。`,
      })
      return true
    } catch (reason) {
      // 后端失败必须如实显示原因，不能弹「已加入」。
      setNotice({ tone: 'warning', text: `加入项目失败：${reason instanceof Error ? reason.message : '未知错误'}` })
      return false
    } finally {
      setProjectBusy(false)
    }
  }

  async function sendToCanvas() {
    const added = await addToProject()
    if (added && state.selectedProjectId) router.push(`/canvas/${state.selectedProjectId}`)
  }

  const editorVersions = useMemo<ImageEditorVersion[]>(() => (
    stageSource
      .filter((work) => work.kind === 'image')
      .map((work) => ({ id: work.id, imageUrl: work.src, label: work.id === editorWork?.id ? '当前图片' : work.title }))
  ), [editorWork?.id, stageSource])

  const submitImageEditor = useCallback(async (request: ImageEditRequest) => {
    const work = editorWork
    if (!work) return
    const source = request.imageUrl.startsWith('data:')
      ? ({ type: 'image', dataUrl: request.imageUrl } as const)
      : ({ type: 'image', url: request.imageUrl } as const)
    if (request.operation === 'to-video') {
      const videoModel = videoModelList.find((item) => item.id === defaultModelFor('video', state.sessionSettings, videoModelList)) ?? videoModelList[0]
      const videoRatio = videoModel?.capabilities.ratios.includes(work.ratio) ? work.ratio : videoModel?.capabilities.ratios[0] ?? '16:9'
      await generation.createVideo({
        prompt: request.prompt,
        model: videoModel?.id,
        ratio: videoRatio,
        seconds: 8,
        references: [source],
        surface: 'chat',
        projectId: state.selectedProjectId,
      })
      setNotice({ tone: 'accent', text: '已提交转视频任务，可在任务记录查看进度。' })
      return
    }
    await generation.createImage({
      prompt: request.prompt,
      model: work.model || model?.id,
      ratio: work.ratio || ratio,
      resolution,
      quality,
      kind: 'edit',
      references: [source],
      edit: {
        operation: request.operation,
        ...(request.maskDataUrl ? { mask: { type: 'image', dataUrl: request.maskDataUrl } as const } : {}),
      },
      surface: 'chat',
      projectId: state.selectedProjectId,
      title: `编辑：${work.title}`,
    })
    setNotice({ tone: 'accent', text: `已提交${request.operation === 'outpaint' ? '扩图' : request.operation === 'enhance' ? '高清修复' : request.operation === 'layers' ? '分图层' : '图片编辑'}任务，可在任务记录查看结果。` })
  }, [editorWork, generation, model?.id, quality, ratio, resolution, state.selectedProjectId, state.sessionSettings, videoModelList])

  const saveEditorVersion = useCallback(async (imageUrl: string) => {
    if (!editorWork) return
    await createLibraryAsset({
      kind: 'image',
      title: `${editorWork.title} 编辑版`.slice(0, 120),
      source: 'image-editor',
      tags: ['图片编辑'],
      data: { serverUrl: imageUrl, dataUrl: imageUrl, mediaKind: 'image', assetRole: 'general' },
    })
    setNotice({ tone: 'accent', text: '已保存到资产库。' })
  }, [editorWork])

  /** 当前项目已引用的媒体，用于按钮文案如实反映状态。 */
  const currentReferenced = Boolean(selectedWork && referencedIds.includes(selectedWork.src))

  /** 切换项目时重新读取该项目已引用的媒体，保证「已加入」状态真实。 */
  useEffect(() => {
    let cancelled = false
    if (state.backendStatus !== 'connected' || !state.selectedProjectId) { setReferencedIds([]); return }
    listProjectReferencedSourceIds(state.selectedProjectId)
      .then((ids) => { if (!cancelled) setReferencedIds(ids) })
      .catch(() => { if (!cancelled) setReferencedIds([]) })
    return () => { cancelled = true }
  }, [state.backendStatus, state.selectedProjectId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitBlock) { setNotice({ tone: 'warning', text: submitBlock }); return }
    if (!prompt.trim()) {
      setNotice({ tone: 'warning', text: '请先输入画面描述。' })
      return
    }
    // 后端可用时提交真实任务；失败时保留后端返回的原因，不落入演示流程。
    if (liveReady) {
      if (submitting) return
      setSubmitting(true)
      try {
        const references = await resolveImageReferences()
        // 生成数量由后端能力上限决定：后端图片任务一次只产出一张，
        // 需要多张时按数量拆成多个批次任务，每个批次使用独立的幂等标识。
        const batch = Math.max(1, Math.min(Number(count) || 1, maxBatch))
        const results = await Promise.allSettled(Array.from({ length: batch }, (_, index) => generation.createImage({
          prompt: prompt.trim(),
          model: model?.id,
          ratio,
          resolution,
          quality,
          count: 1,
          references,
          kind: resolveGenerationKind(advancedValues.kind, references.length),
          title: batch > 1 ? `图片生成 · ${prompt.trim().slice(0, 14)} · ${index + 1}/${batch}` : `图片生成 · ${prompt.trim().slice(0, 18)}`,
          projectId: state.selectedProjectId,
          surface: 'chat',
        })))
        const failures = results.filter((result) => result.status === 'rejected')
        const succeeded = results.length - failures.length
        if (!succeeded) {
          setNotice({ tone: 'warning', text: '任务提交失败，请查看上方错误原因后重试。' })
        } else if (failures.length) {
          // 部分成功必须如实说明，不能显示为全部成功。
          const reason = failures[0].status === 'rejected' && failures[0].reason instanceof Error ? failures[0].reason.message : '部分批次提交失败'
          setNotice({ tone: 'warning', text: `已提交 ${succeeded}/${results.length} 个任务，其余失败：${reason}` })
        } else {
          setNotice({ tone: 'accent', text: batch > 1 ? `已提交 ${batch} 个任务到后端，进度与结果会在下方实时更新。` : '任务已提交到后端，进度与结果会在下方实时更新。' })
        }
      } catch (reason) {
        setNotice({ tone: 'warning', text: reason instanceof Error ? reason.message : '任务提交失败，请查看错误原因后重试。' })
      } finally {
        setSubmitting(false)
      }
      return
    }
    setNotice({ tone: 'warning', text: '生成服务暂时不可用，请稍后重试。' })
  }

  /**
   * 切换某个候选素材的已选状态（图片工作台）。
   *
   * 传入**完整候选对象**而不是 id：选中时就把地址快照下来，
   * 之后搜索/分页/空结果都不再影响已选（这是本轮缺陷的修复要点）。
   * `toggleSelection` 同时负责去重与按上限截断。
   */
  function toggleReference(asset: Asset) {
    setSelectedRefs((current) => toggleSelection(current, asset, Math.max(0, referenceSelectionLimit - uploads.length)))
  }

  const params = (
    <div className="flex flex-col gap-4">
      {reused.pending && <ReuseDraftNotice apply={reused.applyPending} dismiss={reused.dismiss} />}
      <ParamSection title="提示词">
        <label htmlFor="image-prompt" className="sr-only">画面描述</label>
        <textarea
          id="image-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          placeholder="描述你想看到的画面"
          className="studio-field w-full resize-none border border-border bg-background p-3 text-sm leading-6 text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
        />
      </ParamSection>

      <ParamSection title="模型">
        <SelectField label="图像模型" value={model?.id ?? ''} onChange={setModelId} disabled={!imageModelList.length} options={imageModelList.map((item) => ({ value: item.id, label: `${item.shortName} · ${item.creditCost} 积分/次` }))} />
        {!model && <p className="mt-2 text-xs leading-5 text-muted-foreground" role="status">{submitBlock}</p>}
        {liveReady && <p className="mt-2 text-[11px] leading-5 text-muted-foreground">模型与计费以当前账户配置为准；实际扣费以任务结果为准。</p>}
      </ParamSection>

      <ParamSection title="输出">
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-xs font-medium text-foreground">比例</p>
            <OptionGrid value={ratio} onChange={setRatio} options={ratioCards} columns={3} label="图片比例" />
          </div>
          <div className="grid grid-cols-2 gap-3">
          <SelectField label="清晰度" value={resolution} onChange={setResolution} options={resolutionOptions.map((item) => ({ value: item, label: item }))} />
          <SelectField label="图片质量" value={quality} onChange={setQuality} options={qualityOptions.map((item) => ({ value: item, label: qualityLabel(item, model?.capabilities.qualityLabels) }))} />
          {maxBatch > 1 ? (
            <SelectField label="生成数量" value={count} onChange={setCount} options={countOptions.map((item) => ({ value: item, label: `${item} 张` }))} className="col-span-2" hint={`当前模型最多 ${maxBatch} 张，超出部分会按批次分多次提交。`} />
          ) : (
            <div className="col-span-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium text-foreground">生成数量固定为 1 张</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">当前模型每次只产出一张结果，需要多张请更换支持批量的模型。</p>
            </div>
          )}
          </div>
        </div>
      </ParamSection>

      <ParamSection title="参考素材" hint={`${selectedRefs.length}/${referenceSelectionLimit}`}>
        <div className="flex flex-col gap-3">
          {referenceSelectionLimit > 0 && <ReferenceUploader items={uploads} onItemsChange={setUploads} maxFiles={Math.max(0, referenceSelectionLimit - selectedRefs.length)} />}
          {/*
           * 模型不接受参考图时不显示「从素材库选择」：
           * 早先无论模型能力如何都会渲染选择器，用户选中的素材最终被后端按能力丢弃。
           */}
          {referenceSelectionLimit > 0 ? (
            <ReferencePicker
              assets={referencePool}
              selectedIds={selectedRefs.map((item) => item.id)}
              onToggle={(_, asset) => toggleReference(asset as Asset)}
              maxReferences={referenceSelectionLimit}
              libraryState={serverLibrary.state}
              libraryMessage={serverLibrary.message}
              libraryTotal={serverLibrary.total}
              onReload={() => { void refreshSources() }}
              onLoadMore={() => { void serverLibrary.loadMore() }}
              loadingMore={serverLibrary.loadingMore}
              onSearch={setLibraryKeyword}
              serverSearch
            />
          ) : (
            <p className="text-[11px] leading-5 text-muted-foreground">当前模型不接受参考图，因此不提供素材库选择。请换用支持参考图的模型。</p>
          )}
        </div>
      </ParamSection>

      <ParamSection
        title="高级参数"
        action={
          <button
            type="button"
            onClick={() => setAdvanced((value) => !value)}
            aria-expanded={advanced}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <SlidersHorizontal className="size-3" aria-hidden="true" />
            {advanced ? '收起' : '展开'}
          </button>
        }
      >
        {advanced ? (
          <div className="grid grid-cols-2 gap-3">
            {advancedParameters.map((parameter) => (
              <SelectField
                key={parameter.key}
                label={parameter.label}
                value={parameter.current}
                onChange={(value) => setAdvancedValues((current) => ({ ...current, [parameter.key]: value }))}
                options={parameter.options}
              />
            ))}
            <p className="col-span-2 text-[11px] leading-5 text-muted-foreground">只显示当前模型支持的选项，未支持的参数不会保留空白区域。</p>
          </div>
        ) : (
          <p className="text-[11px] leading-5 text-muted-foreground">高级参数默认使用模型推荐值；展开后可覆盖当前会话的默认值。</p>
        )}
      </ParamSection>
    </div>
  )

  const stage = (
    <div className="flex flex-col gap-4">
      <ResultStage
        view={view}
        onViewChange={setView}
        viewOptions={imageViewOptions}
        resultCount={stageSource.length}
        ratio={ratio}
        status={stageStatus}
        statusLabel={stageLabel}
        /**
         * 舞台上的「重试」。
         *
         * 此前只弹一句「已重新提交上一次失败的生成任务。」，**什么都没提交**——
         * 典型的「假按钮」。这里改为真正重试：优先重试最近一条失败的真实任务
         * （`generation.retryTask` 会复用原参数）；没有可重试任务时如实说明，
         * 而不是假装已重试。
         */
        onRetry={() => {
          const failed = liveImageTasks.find((task) => task.status === 'error' && task.canRetry !== false)
          if (!failed) {
            setNotice({ tone: 'warning', text: '当前没有可重试的失败任务。历史任务可在「任务中心」中重试。' })
            return
          }
          setNotice({ tone: 'accent', text: `正在按原参数重试「${failed.title}」…` })
          void generation.retryTask(failed)
            .then(() => setNotice({ tone: 'accent', text: '已按原参数重新提交。' }))
            .catch((reason) => setNotice({ tone: 'warning', text: `重试失败：${reason instanceof Error ? reason.message : '未知错误'}` }))
        }}
        /**
         * 「空」判定必须看**真实来源**，不能看本地演示数据。
         * 早先用 `imageWorks.length === 0`（真实账号下恒为 0），
         * 于是任务已完成、后端已有结果时舞台仍然显示空态，必须刷新才恢复。
         */
        isEmpty={stageSource.length === 0}
        emptyHint={serverWorksResult.state === 'loading' ? '正在读取已有结果…' : serverWorksResult.state === 'error' ? '暂时无法读取结果，请刷新页面重试。' : '写下画面描述，在创作参数中选择模型。完成的图片会自动出现在这里。'}
      >
        {view === 'single' && selectedWork && (
          <ResultTile work={selectedWork} ratio={ratio} fit selected label="当前结果" onSelect={() => setEditorWork(selectedWork)} onOpen={() => setEditorWork(selectedWork)} className="size-full" />
        )}
        {view === 'grid' && (
          <div className={cn('grid min-h-full content-start gap-2', visibleWorks.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
            {visibleWorks.map((work, index) => (
              <ResultTile
                key={work.id}
                work={work}
                ratio={ratio}
                selected={work.id === selectedWork?.id}
                label={work.id === selectedWork?.id ? '当前选择' : `结果 ${index + 1}`}
                onSelect={() => { setSelectedWorkId(work.id); setEditorWork(work) }}
                onOpen={() => setEditorWork(work)}
              />
            ))}
          </div>
        )}
        {view === 'compare' && (
          <div className="grid min-h-full grid-cols-1 content-start gap-2 sm:grid-cols-2">
            {visibleWorks.slice(0, 2).map((work, index) => (
              <ResultTile
                key={work.id}
                work={work}
                ratio={ratio}
                selected={work.id === selectedWork?.id}
                label={index === 0 ? 'A · 当前结果' : 'B · 对比结果'}
                onSelect={() => { setSelectedWorkId(work.id); setEditorWork(work) }}
                onOpen={() => setEditorWork(work)}
              />
            ))}
            {visibleWorks.length < 2 && <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center text-xs leading-6 text-muted-foreground"><Columns2 className="size-5" aria-hidden="true" />再生成一张图片，即可并排比较。</div>}
          </div>
        )}
      </ResultStage>

      <ResultActions>
        <ControlButton size="sm" variant="ghost" disabled={!selectedWork} onClick={() => {
          if (!selectedWork) return
          /**
           * 「复用参数」：把当前结果的提示词与模型写回左侧表单。
           * 早先只弹一句「已复制当前结果的生成参数。」，什么都没复制。
           */
          setPrompt(selectedWork.prompt || prompt)
          if (selectedWork.model && imageModelList.some((item) => item.id === selectedWork.model)) setModelId(selectedWork.model)
          setNotice({ tone: 'accent', text: `已复用参数：${selectedWork.prompt ? `提示词「${selectedWork.prompt.slice(0, 20)}」` : '（该结果没有记录提示词）'}${selectedWork.model ? ` · 模型 ${selectedWork.model}` : ''}` })
        }}>
          <Copy className="size-3.5" aria-hidden="true" />
          复用参数
        </ControlButton>
        <ControlButton size="sm" variant="ghost" disabled={!selectedWork || projectBusy} onClick={() => void sendToCanvas()}>
          <Send className="size-3.5" aria-hidden="true" />
          送入画布
        </ControlButton>
        <ControlButton size="sm" variant="ghost" disabled={!selectedWork || projectBusy} onClick={() => void addToProject()}>
          <Plus className="size-3.5" aria-hidden="true" />
          {projectBusy ? '处理中…' : '加入项目'}
        </ControlButton>
        <MediaDownloadButton media={{ url: selectedWork?.src ?? '', kind: 'image' }} title={selectedWork?.title ?? '作品'} disabled={!selectedWork} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs hover:bg-muted disabled:opacity-50" />
        <ControlButton size="sm" variant="ghost" onClick={() => setAgentOpen(true)}>
          <Bot className="size-3.5" aria-hidden="true" />
          导演 Agent
        </ControlButton>
        <ControlButton size="sm" variant="ghost" onClick={() => router.push('/tasks')}>
          <ArrowDownToLine className="size-3.5" aria-hidden="true" />
          任务记录
        </ControlButton>
      </ResultActions>

      <section aria-labelledby="image-queue" className="studio-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="image-queue" className="text-xs font-semibold text-foreground">生成任务</h2>
          <span className="text-[11px] text-muted-foreground">{liveImageTasks.length} 条任务</span>
        </div>
        <div className="mt-2">
          <LiveTaskList kinds={['image']} limit={4} compact emptyHint="还没有图片任务" />
        </div>
      </section>

      {!liveReady && <LocalPreviewNotice what="图片生成" />}
      <GenerationErrorNotice />
      <GenerationNotice />

      {notice && (
        <Notice tone={notice.tone}>
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span aria-live="polite">{notice.text}</span>
        </Notice>
      )}
    </div>
  )

  return (
    <>
      <WorkspaceShell
        params={params}
        stage={stage}
        onSubmit={submit}
        submitLabel={submitting ? '正在提交…' : '开始生成'}
        credits={credits}
        submitDisabled={!prompt.trim() || submitting || Boolean(submitBlock)}
        submitHint={submitBlock || (!prompt.trim() ? '先写下你想生成的画面。' : undefined)}
        paramsTitle="图片参数"
        paramsHint={model ? `${model.shortName} · ${count} 张` : '暂无可用模型'}
      />
      <SidePanel open={agentOpen} onClose={() => setAgentOpen(false)} title="导演 Agent" description="基于当前图片参数继续拆解镜头与素材">
        <DirectorAgent context="图片工作台 · 极光之后" />
      </SidePanel>
      <SidePanel
        open={Boolean(editorWork)}
        onClose={() => setEditorWork(null)}
        title="图片编辑"
        description={editorWork?.title}
        width="lg:w-[720px] lg:max-w-[720px]"
      >
        {editorWork && <ImageEditorPanel
          imageSrc={editorWork.src}
          title={editorWork.title}
          description="画笔、涂抹、扩图、高清修复、分图层和转视频"
          versions={editorVersions}
          activeVersionId={editorWork.id}
          showHeader={false}
          className="!w-full !min-w-0 !border-l-0"
          onClose={() => setEditorWork(null)}
          onSubmit={submitImageEditor}
          onSaveVersion={saveEditorVersion}
          onVersionSelect={(version) => {
            const next = stageSource.find((work) => work.id === version.id)
            if (next) setEditorWork(next)
          }}
        />}
      </SidePanel>
    </>
  )
}

export function VideoWorkspace() {
  const { state, estimateCredits, liveModels, liveReady, defaultModels } = useStudio()
  const generation = useGeneration()
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const intentDraft = useRef(false)
  const videoModelList = useMemo(() => filterModelsByCapability(liveModels, 'video'), [liveModels])
  const [modelId, setModelId] = useState(() => videoModelList[0]?.id ?? '')
  const [mode, setMode] = useState('text')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(`${defaultModels.videoSeconds || 8} 秒`)
  const [quality, setQuality] = useState(defaultModels.videoQuality || '高清')
  const [view, setView] = useState('single')
  const [advanced, setAdvanced] = useState(false)
  /**
   * 视频工作台的四组已选素材，全部改用**完整快照**（含地址）。
   *
   * 与图片工作台同一原因：只存 id 再回候选池反查，
   * 会让「搜索后不在结果里」的已选素材在提交时被静默丢弃。
   * 首帧/尾帧/源视频/多参考各自的**角色与顺序**都由数组顺序保留。
   */
  const [selectedRefs, setSelectedRefs] = useState<SelectedReference[]>([])
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [firstFrameUploads, setFirstFrameUploads] = useState<UploadItem[]>([])
  const [lastFrameUploads, setLastFrameUploads] = useState<UploadItem[]>([])
  const [sourceVideoUploads, setSourceVideoUploads] = useState<UploadItem[]>([])
  const [firstFrameRef, setFirstFrameRef] = useState<SelectedReference[]>([])
  const [lastFrameRef, setLastFrameRef] = useState<SelectedReference[]>([])
  const [sourceVideoRef, setSourceVideoRef] = useState<SelectedReference[]>([])
  const [notice, setNotice] = useState<{ tone: 'neutral' | 'warning' | 'accent'; text: string } | null>(null)
  const [detailWork, setDetailWork] = useState<Work | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [failedVideoSrc, setFailedVideoSrc] = useState('')
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  /** 提交锁：后端确认之前禁止重复提交，视频任务尤其不能被重复扣费。 */
  const [submitting, setSubmitting] = useState(false)
  /** 项目写入进行中：避免重复点击产生重复节点。 */
  const [projectBusy, setProjectBusy] = useState(false)
  const [referencedIds, setReferencedIds] = useState<string[]>([])
  /**
   * 视频结果与参考素材的**真实来源**。
   *
   * 早先这里直接读 `state.works` / `state.assets`（本地演示数据），
   * 真实账号下恒为空 —— 于是「生成完成但结果舞台空白」「参考素材选不到真实素材」，
   * 必须刷新页面才可能恢复。现在与图片工作台一致，读后端作品与素材库。
   */
  const serverWorksResult = useServerWorks({ pageSize: 24, kind: 'video' })
  /** 素材库搜索词（服务端 keyword 参数）：素材超过一页时用户仍能找到目标素材。 */
  const [libraryKeyword, setLibraryKeyword] = useState('')
  const serverLibrary = useVideoReferenceLibrary(mode, libraryKeyword)

  useEffect(() => {
    if (!videoModelList.length) return
    setModelId((current) => videoModelList.some((item) => item.id === current) ? current : defaultModelFor('video', state.sessionSettings, videoModelList))
  }, [videoModelList, state.sessionSettings])

  /** 套用首页传来的创作意图（提示词 + 参考文件），替换写死的示例文案。 */
  useEffect(() => {
    const intent = consumeCreateIntent('video')
    if (!intent) return
    intentDraft.current = true
    if (intent.prompt.trim()) setPrompt(intent.prompt)
    if (intent.settings?.model) setModelId(intent.settings.model)
    if (intent.settings?.ratio) setRatio(intent.settings.ratio)
    if (intent.settings?.quality) setQuality(intent.settings.quality)
    if (intent.settings?.seconds) setDuration(`${intent.settings.seconds} 秒`)
    if (intent.files.length) void ingestIntentFiles(intent.files, setUploads, setNotice)
    setNotice({ tone: 'accent', text: `已带入首页的创作描述${intent.files.length ? `与 ${intent.files.length} 个参考文件` : ''}。` })
    // 只在挂载时消费一次意图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reused = useWorkReuseParams({ kind: 'video', accountId: state.user.id, connected: state.backendStatus === 'connected', models: videoModelList, prompt, protectDraft: intentDraft, setPrompt, setModelId, setNotice })

  const model = videoModelList.find((item) => item.id === modelId) ?? videoModelList[0]
  const capabilities = model?.capabilities ?? { textToMedia: true, firstFrame: false, lastFrame: false, multiReference: false, editing: false, durations: [], ratios: [], qualities: [], maxReferences: 0 }
  useEffect(() => {
    if (!model) return
    setRatio((current) => supportedChoice(current, model.capabilities.ratios))
    setQuality((current) => supportedChoice(current, model.capabilities.qualities))
    setDuration((current) => supportedChoice(current, model.capabilities.durations))
  }, [model])
  const modeOptions = useMemo(
    () =>
      [
        { value: 'text', label: '文生视频', supported: capabilities.textToMedia },
        { value: 'first', label: '首帧', supported: capabilities.firstFrame },
        { value: 'ends', label: '首尾帧', supported: capabilities.firstFrame && capabilities.lastFrame },
        { value: 'references', label: '多参考', supported: capabilities.multiReference },
        { value: 'edit', label: '视频编辑', supported: capabilities.editing },
      ].filter((option) => option.supported),
    [capabilities],
  )
  /**
   * 参考素材候选池。
   *
   * 真实来源 = 后端素材库（用户上传的持久素材）+ 后端已生成的作品。
   * 只有未登录时才回落到本地演示素材，避免真实账户下「选不到任何素材」。
   */
  const serverReferenceAssets = useMemo<Asset[]>(() => {
    // 上传素材与生成结果可能指向同一个文件，按 URL 去重后只出现一次（见 mergeReferenceAssets）。
    return mergeReferenceAssets([
      serverLibrary.assets.map(libraryAssetToReferenceAsset),
      serverWorksResult.works.map((work) => ({ ...workToReferenceAsset(work), title: work.title || '生成视频' })),
    ])
  }, [serverLibrary.assets, serverWorksResult.works])

  const referencePool = useMemo(() => {
    /**
     * 与图片工作台同一规则：`loading` / `ready` / `error` 一律以服务端结果为准
     * （含「搜索无匹配」的空结果），只有 `idle` / 未登录才回落本地演示素材。
     * 否则会出现两类问题（图片工作台实测踩到）：
     *  - 搜索无结果时凭空冒出演示素材，看起来像搜索没生效；
     *  - 搜索触发的 loading 窗口里切回演示素材，把已选素材误清空。
     */
    const libraryUsable = serverLibrary.state !== 'unauthenticated'
    const pool = libraryUsable ? serverReferenceAssets : []
    if (mode === 'edit') return pool.filter((asset) => asset.kind === 'video')
    if (mode === 'references') return pool.filter((asset) => ['image', 'video', 'scene'].includes(asset.kind))
    return pool.filter((asset) => ['image', 'scene'].includes(asset.kind))
  }, [mode, serverLibrary.state, serverReferenceAssets])
  const referenceSelectionLimit = mode === 'first' || mode === 'edit' ? 1 : mode === 'ends' ? 2 : capabilities.maxReferences

  useEffect(() => {
    if (!modeOptions.some((option) => option.value === mode)) setMode(modeOptions[0]?.value ?? 'text')
  }, [mode, modeOptions])

  /**
   * 与图片工作台同一规则：按**来源**分别校验存活，且只有拿到完整证据才判定删除。
   * 四组已选（多参考 / 首帧 / 尾帧 / 源视频）一起校验。
   */
  const selectionKey = [
    ...selectedRefs.map((item) => item.id),
    ...firstFrameRef.map((item) => item.id),
    ...lastFrameRef.map((item) => item.id),
    ...sourceVideoRef.map((item) => item.id),
  ].join(',')

  /**
   * 作品列表的**内容签名**（不能用长度：删除 A 同时新增 B 时长度不变）。
   */
  const worksSignature = useMemo(
    () => serverWorksResult.works.map((work) => work.id).join(','),
    [serverWorksResult.works],
  )

  /**
   * 四组已选（多参考 / 首帧 / 尾帧 / 源视频）的批次与收敛入口。
   *
   * 与图片工作台**完全同一套规则**（见图片工作台处的详细说明）：
   *  - 批次发号 + 应用前核对（账号世代、选择版本）；
   *  - 判定与通知在 setState 之外算完，updater 只做纯过滤；
   *  - 定向证据只在其**查询范围**内判定删除。
   */
  const verifyBatchRef = useRef(0)
  const videoUserId = state.user?.id ?? ''
  const selectionVersionRef = useRef(0)
  useEffect(() => { selectionVersionRef.current += 1 }, [selectionKey])
  /** 与图片工作台一致的"一轮一条汇总通知"（见该处说明）。 */
  const roundRef = useRef(createReconcileRound())

  const openBatch = useCallback((options: { manual?: boolean } = {}) => {
    verifyBatchRef.current += 1
    roundRef.current.begin(selectionKey ? selectionKey.split(',') : [], options)
    return {
      id: verifyBatchRef.current,
      epoch: accountDataEpoch(),
      userId: videoUserId,
      version: selectionVersionRef.current,
      selections: [...selectedRefs, ...firstFrameRef, ...lastFrameRef, ...sourceVideoRef],
    }
  }, [firstFrameRef, lastFrameRef, selectedRefs, selectionKey, sourceVideoRef, videoUserId])
  const isBatchCurrent = useCallback((batch: { id: number; epoch: number; userId: string; version: number }) => (
    batch.id === verifyBatchRef.current
    && batch.epoch === accountDataEpoch()
    && batch.userId === (state.user?.id ?? '')
    && batch.version === selectionVersionRef.current
  ), [state.user?.id])

  const applyEvidence = useCallback((
    batch: { id: number; epoch: number; userId: string; version: number; selections: SelectedReference[] },
    libraryEvidence: LiveSourceEvidence,
    workEvidence: LiveSourceEvidence,
  ) => {
    if (!isBatchCurrent(batch)) return false
    const report = reconcileWithSources(batch.selections, { library: libraryEvidence, work: workEvidence })
    const unavailableSources: SelectionSourceKind[] = [
      ...(libraryEvidence.status === 'unavailable' ? (['library'] as SelectionSourceKind[]) : []),
      ...(workEvidence.status === 'unavailable' ? (['work'] as SelectionSourceKind[]) : []),
    ]
    roundRef.current.accumulate({ ...report, unavailableSources })
    const removedIds = new Set(report.removed.map((item) => item.id))
    if (removedIds.size) {
      roundRef.current.noteSelfPruned(removedIds)
      const prune = (setter: typeof setSelectedRefs) => setter((current) => {
        const kept = current.filter((item) => !removedIds.has(item.id))
        return kept.length === current.length ? current : kept
      })
      prune(setSelectedRefs)
      prune(setFirstFrameRef)
      prune(setLastFrameRef)
      prune(setSourceVideoRef)
    }
    const notice = describeReconcile(roundRef.current.get())
    if (notice) setNotice(notice)
    return true
  }, [isBatchCurrent])

  /**
   * 「刷新素材」：与图片工作台**完全一致**的规则 —— 刷新全部来源，
   * 并用本次刷新后的结果做存活判定（见图片工作台处的详细说明）。
   * 首帧 / 尾帧 / 源视频 / 多参考四组选择器共用它。
   */
  const [refreshing, setRefreshing] = useState(false)
  const refreshSources = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    /** 四组已选一起取作品 id：首帧/尾帧/源视频/多参考共用同一条刷新规则。 */
    const batch = openBatch({ manual: true })
    try {
      const workIds = batch.selections.filter((item) => selectionSourceOf(item) === 'work').map((item) => item.id)
      const [libraryEvidence, workEvidence] = await Promise.all([
        serverLibrary.reloadForLiveness(batch.selections.filter((item) => selectionSourceOf(item) === 'library').map((item) => item.id)),
        serverWorksResult.verifyWorkIds(workIds),
      ])
      void serverLibrary.reload()
      void serverWorksResult.reload()
      applyEvidence(batch, libraryEvidence, workEvidence)
    } finally {
      setRefreshing(false)
    }
  }, [applyEvidence, openBatch, refreshing, serverLibrary, serverWorksResult])

  useEffect(() => {
    const all = [...selectedRefs, ...firstFrameRef, ...lastFrameRef, ...sourceVideoRef]
    if (!all.length) return
    const batch = openBatch()
    void (async () => {
      const libraryIds = batch.selections.filter((item) => selectionSourceOf(item) === 'library').map((item) => item.id)
      const workIds = batch.selections.filter((item) => selectionSourceOf(item) === 'work').map((item) => item.id)
      /** 与图片工作台一致：作品来源走**定向**校验，不用可能被截断的列表当证据。 */
      const [libraryEvidence, workEvidence] = await Promise.all([
        libraryIds.length ? serverLibrary.verifyLibraryIds(libraryIds) : Promise.resolve(completeEvidence([])),
        serverWorksResult.verifyWorkIds(workIds),
      ])
      applyEvidence(batch, libraryEvidence, workEvidence)
    })()
    // 只在已选集合、作品**内容**或增删信号变化时校验；搜索结果变化不触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, worksSignature, serverLibrary.liveVerifyTick, videoUserId])

  /**
   * 模型/模式上限变化时收缩四组已选（首帧/尾帧/源视频各 1 个，多参考按模型上限）。
   *
   * 与图片工作台同一原则：判定在 setState 之外算完，updater 只做纯过滤。
   */
  useEffect(() => {
    const prune = (setter: typeof setSelectedRefs, current: readonly SelectedReference[], max: number) => {
      const { next, removed } = clampSelections(current, max)
      if (!removed.length) return
      const keep = new Set(next.map((item) => item.id))
      setter((live) => {
        const kept = live.filter((item) => keep.has(item.id))
        return kept.length === live.length ? live : kept
      })
    }
    prune(setSelectedRefs, selectedRefs, referenceSelectionLimit)
    prune(setFirstFrameRef, firstFrameRef, 1)
    prune(setLastFrameRef, lastFrameRef, 1)
    prune(setSourceVideoRef, sourceVideoRef, 1)
    // 只在模型/模式上限变化时收缩；已选变化由上面的校验 effect 负责。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceSelectionLimit])

  const settings: GenerationSettings = { modelId: model?.id ?? modelId, ratio, quality, duration, mode }
  const credits = model ? estimateCredits(model.id, settings) : 0
  const submitBlock = generationBlockReason(state.backendStatus, Boolean(model), credits, state.credits)
  const videoWorks = useMemo<Work[]>(() => (serverWorksResult.state === 'unauthenticated'
    ? []
    : serverWorksResult.works.map((work) => ({
        id: work.id,
        kind: 'video' as Work['kind'],
        title: work.title,
        src: work.src,
        poster: work.poster,
        fallback: work.fallback,
        model: work.model ?? '',
        ratio,
        status: '已发布' as Work['status'],
        prompt: work.prompt,
        createdAt: work.createdAt ?? new Date().toISOString(),
        updatedAt: work.createdAt ?? new Date().toISOString(),
        duration: work.durationMs ? `${Math.round(work.durationMs / 1000)} 秒` : undefined,
      }))), [ratio, serverWorksResult.state, serverWorksResult.works])
  const liveVideoTasks = generation.tasks.filter((task) => task.kind === 'video')
  const liveLatest = liveVideoTasks[0]
  /** 本次会话已完成但还没进入作品列表的视频结果，做到「完成即可见」。 */
  const completedVideoWorks = useMemo<Work[]>(() => liveVideoTasks
    .filter((task) => hasDeliverable(task))
    .flatMap((task) => task.media.map((media, index) => ({
      id: `${task.id}#${index}`,
      kind: 'video' as Work['kind'],
      title: task.title,
      src: media.url,
      poster: media.poster,
      fallback: media.poster || media.url,
      model: task.model,
      ratio,
      status: '已发布' as Work['status'],
      prompt: task.prompt,
      createdAt: new Date(task.createdAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
    }))), [liveVideoTasks, ratio])
  const stageSource = useMemo<Work[]>(() => {
    const seen = new Set<string>()
    return [...completedVideoWorks, ...videoWorks].filter((work) => (seen.has(work.src) ? false : (seen.add(work.src), true)))
  }, [completedVideoWorks, videoWorks])
  const stageStatus: 'idle' | 'queued' | 'processing' | 'failed' | 'done' = liveLatest
    ? liveLatest.status === 'pending' ? 'queued' : liveLatest.status === 'running' ? 'processing' : liveLatest.status === 'error' ? 'failed' : liveLatest.status === 'success' ? 'done' : 'idle'
    : stageSource.length > 0 ? 'done' : 'idle'
  const stageLabel = liveLatest
    ? liveLatest.unconfirmed ? '提交结果待确认' : ({ pending: '已提交，等待处理', running: '生成中', paused: '已暂停', success: '已完成', error: '生成失败', cancelled: '已取消' } as Record<string, string>)[liveLatest.status] ?? liveLatest.status
    : stageSource.length ? '已完成' : '等待创作'
  const currentWork = stageSource.find((work) => work.id === selectedVideoId) ?? stageSource[0]
  const videoReady = Boolean(currentWork) && currentWork?.status !== '处理中'
  const videoFailed = Boolean(currentWork && currentWork.src === failedVideoSrc)
  const referenceLabel = mode === 'first' ? '首帧输入' : mode === 'ends' ? '首尾帧输入' : mode === 'references' ? '多参考素材' : mode === 'edit' ? '编辑源视频' : '参考素材'

  async function publishUploads(items: UploadItem[], type: 'image' | 'video', role: GenerationReference['role'] = 'reference'): Promise<GenerationReference[]> {
    if (items.some((item) => item.status !== 'done')) throw new Error('参考素材仍在读取，请稍候再生成')
    return Promise.all(items.filter((item) => item.dataUrl).map(async (item) => ({
      name: item.name,
      type,
      role,
      url: await publishReferenceAsset(type, item.dataUrl as string),
    })))
  }

  async function resolveVideoReferences(): Promise<GenerationReference[]> {
    if ((mode === 'text' || mode === 'references') && selectedRefs.length + uploads.length > capabilities.maxReferences) {
      throw new Error(`参考素材最多 ${capabilities.maxReferences} 个，请减少上传或选择的素材`)
    }
    /**
     * 已选素材直接由**快照**解析，不再回候选池按 id 反查。
     *
     * 反查的写法会让"当前搜索结果里没有的已选素材"解析失败并被静默丢弃
     * （本轮缺陷：选 A → 搜索 B → 提交时 A 不见了）。
     * 各角色的 type 由素材自身类型决定（视频素材作为源视频、图片作为帧/参考）。
     */
    const asReference = (
      item: SelectedReference,
      role: GenerationReference['role'],
    ): GenerationReference => ({
      name: item.title,
      type: item.kind === 'video' ? 'video' : 'image',
      role,
      url: item.src,
    })
    return buildVideoReferences({
      mode,
      first: mode === 'first' || mode === 'ends' ? [...firstFrameRef.map((item) => asReference(item, 'reference')), ...await publishUploads(firstFrameUploads, 'image')] : [],
      last: mode === 'ends' ? [...lastFrameRef.map((item) => asReference(item, 'reference')), ...await publishUploads(lastFrameUploads, 'image')] : [],
      source: mode === 'edit' ? [...sourceVideoRef.map((item) => asReference(item, 'reference')), ...await publishUploads(sourceVideoUploads, 'video')] : [],
      references: mode === 'text' || mode === 'references' ? [...selectedRefs.map((item) => asReference(item, 'reference')), ...await publishUploads(uploads, 'image')] : [],
      maxReferences: capabilities.maxReferences,
    })
  }

  /**
   * 视频结果的项目写入。
   *
   * 早先「加入分镜」只弹「已加入极光之后分镜。」、「送入画布」写死 `/canvas/aurora`，
   * 都不落库也不管当前项目。现在与图片工作台共用同一套真实写入。
   */
  const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId)
  async function addVideoToProject(): Promise<boolean> {
    if (!currentWork) return false
    if (state.backendStatus !== 'connected') {
      setNotice({ tone: 'warning', text: '未登录：无法写入项目。请先登录后再加入项目。' })
      return false
    }
    if (!state.selectedProjectId) {
      setNotice({ tone: 'warning', text: '还没有选择项目。请先到「项目」新建或选择一个项目。' })
      return false
    }
    setProjectBusy(true)
    try {
      const result = await addMediaToProject(state.selectedProjectId, {
        sourceId: currentWork.src,
        title: currentWork.title || '未命名视频',
        kind: 'video',
        url: currentWork.src,
        poster: currentWork.poster,
        prompt: currentWork.prompt,
        model: currentWork.model,
        detail: currentWork.prompt,
      })
      setReferencedIds((current) => current.includes(currentWork.src) ? current : [...current, currentWork.src])
      setNotice({
        tone: result.alreadyPresent ? 'neutral' : 'accent',
        text: result.alreadyPresent
          ? `该视频已经在「${selectedProject?.title ?? state.selectedProjectId}」中，未重复添加。`
          : `已加入「${selectedProject?.title ?? state.selectedProjectId}」，刷新或换浏览器都能看到。`,
      })
      return true
    } catch (reason) {
      setNotice({ tone: 'warning', text: `加入项目失败：${reason instanceof Error ? reason.message : '未知错误'}` })
      return false
    } finally {
      setProjectBusy(false)
    }
  }

  async function sendVideoToCanvas() {
    const added = await addVideoToProject()
    if (added && state.selectedProjectId) router.push(`/canvas/${state.selectedProjectId}`)
  }

  /** 切换项目时重新读取已引用媒体。 */
  useEffect(() => {
    let cancelled = false
    if (state.backendStatus !== 'connected' || !state.selectedProjectId) { setReferencedIds([]); return }
    listProjectReferencedSourceIds(state.selectedProjectId)
      .then((ids) => { if (!cancelled) setReferencedIds(ids) })
      .catch(() => { if (!cancelled) setReferencedIds([]) })
    return () => { cancelled = true }
  }, [state.backendStatus, state.selectedProjectId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitBlock) { setNotice({ tone: 'warning', text: submitBlock }); return }
    if (!prompt.trim()) {
      setNotice({ tone: 'warning', text: '请先输入镜头描述。' })
      return
    }
    if (liveReady) {
      if (submitting) return
      setSubmitting(true)
      const seconds = Number.parseInt(duration, 10)
      try {
        const references = await resolveVideoReferences()
        await generation.createVideo({
          prompt: prompt.trim(),
          model: model?.id,
          ratio,
          quality,
          seconds: Number.isFinite(seconds) ? seconds : undefined,
          references,
          projectId: state.selectedProjectId,
          surface: 'chat',
        })
        setNotice({ tone: 'accent', text: '视频任务已提交到后端，长任务会在后台继续轮询。' })
      } catch (reason) {
        setNotice({ tone: 'warning', text: reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : '视频任务提交失败' })
      } finally {
        setSubmitting(false)
      }
      return
    }
    setNotice({ tone: 'warning', text: '生成服务暂时不可用，请稍后重试。' })
  }

  /**
   * 单选取材（首帧 / 尾帧 / 源视频）：点已选的取消，点别的替换。
   *
   * 同样按**快照**保存地址，切模式或搜索都不会让它失效。
   */
  function pickSingle(
    setter: React.Dispatch<React.SetStateAction<SelectedReference[]>>,
    asset: Asset,
  ) {
    setter((current) => (current.some((item) => item.id === asset.id) ? [] : toggleSelection(current, asset, 1)))
  }

  const referenceHint = mode === 'ends'
    ? `${firstFrameUploads.length + firstFrameRef.length}/1 首帧 · ${lastFrameUploads.length + lastFrameRef.length}/1 尾帧`
    : mode === 'first' ? `${firstFrameUploads.length + firstFrameRef.length}/1`
      : mode === 'edit' ? `${sourceVideoUploads.length + sourceVideoRef.length}/1`
        : `${selectedRefs.length + uploads.length}/${referenceSelectionLimit}`

  /** 切换已选（视频工作台的多参考模式）：同样按快照保存，不依赖当前搜索结果。 */
  function toggleReference(asset: Asset) {
    setSelectedRefs((current) => toggleSelection(current, asset, Math.max(0, referenceSelectionLimit - uploads.length)))
  }

  const params = (
    <div className="flex flex-col gap-4">
      {reused.pending && <ReuseDraftNotice apply={reused.applyPending} dismiss={reused.dismiss} />}
      <ParamSection title="生成模式">
        <OptionGrid value={mode} onChange={setMode} options={modeOptions} label="生成模式" />
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">当前模型不支持的模式不会显示，也不会留下空白区域。</p>
      </ParamSection>

      <ParamSection title="镜头描述">
        <label htmlFor="video-prompt" className="sr-only">镜头描述</label>
        <textarea
          id="video-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          placeholder="描述镜头运动、主体动作与氛围"
          className="studio-field w-full resize-none border border-border bg-background p-3 text-sm leading-6 text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
        />
      </ParamSection>

      <ParamSection title="模型">
        <SelectField label="视频模型" value={model?.id ?? ''} onChange={setModelId} disabled={!videoModelList.length} options={videoModelList.map((item) => ({ value: item.id, label: `${item.shortName} · ${item.creditCost} 积分/次` }))} />
        {!model && <p className="mt-2 text-xs leading-5 text-muted-foreground" role="status">{submitBlock}</p>}
      </ParamSection>

      <ParamSection title="输出">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="比例" value={ratio} onChange={setRatio} options={capabilities.ratios.map((item) => ({ value: item, label: item }))} />
          <SelectField label="时长" value={duration} onChange={setDuration} options={capabilities.durations.map((item) => ({ value: item, label: item }))} />
          <SelectField label="清晰度" value={quality} onChange={setQuality} options={capabilities.qualities.map((item) => ({ value: item, label: item }))} className="col-span-2" />
        </div>
      </ParamSection>

      <ParamSection title={referenceLabel} hint={referenceHint}>
        {mode === 'first' && (
          <div className="flex flex-col gap-3">
            <ReferenceUploader
              items={firstFrameUploads}
              onItemsChange={(items) => { setFirstFrameUploads(items); if (items.length) setFirstFrameRef([]) }}
              maxFiles={1}
              kind="image"
              label="首帧图片"
              emptyText="上传首帧图片"
              selectLabel="选择首帧"
              hint="PNG / JPG / WEBP，单个不超过 12 MB"
            />
            <ReferencePicker assets={referencePool} selectedIds={firstFrameRef.map((item) => item.id)} onToggle={(_, asset) => { pickSingle(setFirstFrameRef, asset as Asset); setFirstFrameUploads([]) }} maxReferences={1} libraryState={serverLibrary.state} libraryMessage={serverLibrary.message} libraryTotal={referencePool.length + serverLibrary.remaining} onReload={() => { void refreshSources() }} onLoadMore={serverLibrary.hasMore ? () => { void serverLibrary.loadMore() } : undefined} loadingMore={serverLibrary.loadingMore} onSearch={setLibraryKeyword} serverSearch />
          </div>
        )}
        {mode === 'ends' && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReferenceUploader
                items={firstFrameUploads}
                onItemsChange={(items) => { setFirstFrameUploads(items); if (items.length) setFirstFrameRef([]) }}
                maxFiles={1}
                kind="image"
                label="首帧图片"
                emptyText="上传首帧"
                selectLabel="选择首帧"
                hint="PNG / JPG / WEBP，单个不超过 12 MB"
              />
              <ReferenceUploader
                items={lastFrameUploads}
                onItemsChange={(items) => { setLastFrameUploads(items); if (items.length) setLastFrameRef([]) }}
                maxFiles={1}
                kind="image"
                label="尾帧图片"
                emptyText="上传尾帧"
                selectLabel="选择尾帧"
                hint="PNG / JPG / WEBP，单个不超过 12 MB"
              />
            </div>
            <div><p className="mb-2 text-xs font-medium">首帧素材</p><ReferencePicker assets={referencePool} selectedIds={firstFrameRef.map((item) => item.id)} onToggle={(_, asset) => { pickSingle(setFirstFrameRef, asset as Asset); setFirstFrameUploads([]) }} maxReferences={1} libraryState={serverLibrary.state} libraryMessage={serverLibrary.message} libraryTotal={referencePool.length + serverLibrary.remaining} onReload={() => { void refreshSources() }} onLoadMore={serverLibrary.hasMore ? () => { void serverLibrary.loadMore() } : undefined} loadingMore={serverLibrary.loadingMore} onSearch={setLibraryKeyword} serverSearch /></div>
            <div><p className="mb-2 text-xs font-medium">尾帧素材</p><ReferencePicker assets={referencePool} selectedIds={lastFrameRef.map((item) => item.id)} onToggle={(_, asset) => { pickSingle(setLastFrameRef, asset as Asset); setLastFrameUploads([]) }} maxReferences={1} libraryState={serverLibrary.state} libraryMessage={serverLibrary.message} libraryTotal={referencePool.length + serverLibrary.remaining} onReload={() => { void refreshSources() }} onLoadMore={serverLibrary.hasMore ? () => { void serverLibrary.loadMore() } : undefined} loadingMore={serverLibrary.loadingMore} onSearch={setLibraryKeyword} serverSearch /></div>
          </div>
        )}
        {mode === 'edit' && (
          <div className="flex flex-col gap-3">
            <ReferenceUploader
              items={sourceVideoUploads}
              onItemsChange={(items) => { setSourceVideoUploads(items); if (items.length) setSourceVideoRef([]) }}
              maxFiles={1}
              kind="video"
              label="待编辑视频"
              emptyText="上传待编辑视频"
              selectLabel="选择视频"
              hint="MP4 / MOV / WEBM，单个不超过 200 MB"
            />
            <ReferencePicker assets={referencePool} selectedIds={sourceVideoRef.map((item) => item.id)} onToggle={(_, asset) => { pickSingle(setSourceVideoRef, asset as Asset); setSourceVideoUploads([]) }} maxReferences={1} libraryState={serverLibrary.state} libraryMessage={serverLibrary.message} libraryTotal={referencePool.length + serverLibrary.remaining} onReload={() => { void refreshSources() }} onLoadMore={serverLibrary.hasMore ? () => { void serverLibrary.loadMore() } : undefined} loadingMore={serverLibrary.loadingMore} onSearch={setLibraryKeyword} serverSearch />
          </div>
        )}
        {(mode === 'text' || mode === 'references') && (
          <div className="flex flex-col gap-3">
            {capabilities.maxReferences > 0 ? <><ReferenceUploader items={uploads} onItemsChange={setUploads} maxFiles={Math.max(0, capabilities.maxReferences - selectedRefs.length)} hint="PNG / JPG / WEBP，单个不超过 12 MB" />
            <ReferencePicker assets={referencePool} selectedIds={selectedRefs.map((item) => item.id)} onToggle={(_, asset) => toggleReference(asset as Asset)} maxReferences={referenceSelectionLimit} libraryState={serverLibrary.state} libraryMessage={serverLibrary.message} libraryTotal={referencePool.length + serverLibrary.remaining} onReload={() => { void refreshSources() }} onLoadMore={serverLibrary.hasMore ? () => { void serverLibrary.loadMore() } : undefined} loadingMore={serverLibrary.loadingMore} onSearch={setLibraryKeyword} serverSearch /></> : <p className="text-xs leading-5 text-muted-foreground">当前模型使用文字描述生成视频，不支持参考素材。</p>}
          </div>
        )}
      </ParamSection>

      <ParamSection
        title="高级参数"
        action={
          <button
            type="button"
            onClick={() => setAdvanced((value) => !value)}
            aria-expanded={advanced}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <SlidersHorizontal className="size-3" aria-hidden="true" />
            {advanced ? '收起' : '展开'}
          </button>
        }
      >
        {advanced ? (
          <div className="flex flex-col gap-3">
            {/* 只列出后端视频任务真实接受、并且会提交的参数。 */}
            <SelectField label="清晰度" value={quality} onChange={setQuality} options={(capabilities.qualities.length ? capabilities.qualities : ['480', '720', '1080']).map((item) => ({ value: item, label: qualityLabel(item, model?.capabilities.qualityLabels) }))} />
            <p className="text-[11px] leading-5 text-muted-foreground">运动强度、镜头稳定等参数后端当前不接受，因此不提供无效控件。</p>
          </div>
        ) : (
          <p className="text-[11px] leading-5 text-muted-foreground">高级参数默认使用模型推荐值，展开后可覆盖清晰度。</p>
        )}
      </ParamSection>
    </div>
  )

  const stage = (
    <div className="flex flex-col gap-4">
      <ResultStage
        view={view}
        onViewChange={setView}
        viewOptions={videoViewOptions}
        mediaKind="video"
        resultCount={stageSource.length}
        ratio={ratio}
        status={stageStatus}
        statusLabel={stageLabel}
        /** 舞台「重试」：与图片工作台一致，真正重试而不是只弹提示。 */
        onRetry={() => {
          const failed = liveVideoTasks.find((task) => task.status === 'error' && task.canRetry !== false)
          if (!failed) {
            setNotice({ tone: 'warning', text: '当前没有可重试的失败任务。历史任务可在「任务中心」中重试。' })
            return
          }
          setNotice({ tone: 'accent', text: `正在按原参数重试「${failed.title}」…` })
          void generation.retryTask(failed)
            .then(() => setNotice({ tone: 'accent', text: '已按原参数重新提交。' }))
            .catch((reason) => setNotice({ tone: 'warning', text: `重试失败：${reason instanceof Error ? reason.message : '未知错误'}` }))
        }}
        /** 与图片工作台一致：空判定看真实来源，不看本地演示数据。 */
        isEmpty={stageSource.length === 0}
        emptyHint={serverWorksResult.state === 'loading' ? '正在读取已有结果…' : serverWorksResult.state === 'error' ? '暂时无法读取结果，请刷新页面重试。' : '描述主体动作与镜头运动，在创作参数中选择模型。完成的视频会在这里播放。'}
      >
        {view === 'single' && currentWork && (
          <div className="size-full">
            {videoReady && !videoFailed ? (
              <video
                key={currentWork.src}
                className="size-full rounded-lg bg-studio-ink object-contain"
                src={currentWork.src}
                poster={currentWork.poster}
                controls
                controlsList="nodownload"
                playsInline
                preload="metadata"
                onError={() => setFailedVideoSrc(currentWork.src)}
                aria-label={`${currentWork.title} 视频结果`}
              />
            ) : (
              <div className="relative size-full">
                <MediaThumb src={currentWork.poster} alt={`${currentWork.title} 封面`} fallback={currentWork.fallback} className="size-full" />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-studio-ink/90 to-transparent px-3 pb-3 pt-8">
                  <span className="text-[11px] text-studio-ink-foreground">{videoFailed ? '视频加载失败，已显示封面' : '视频生成中，完成后可播放'}</span>
                  {videoFailed ? <ControlButton size="sm" variant="secondary" onClick={() => setFailedVideoSrc('')}>重新加载</ControlButton> : <StatusBadge tone="accent">处理中</StatusBadge>}
                </span>
              </div>
            )}
          </div>
        )}
        {view === 'grid' && (
          <div className="grid min-h-full grid-cols-2 content-start gap-2">
            {stageSource.map((work, index) => (
              <ResultTile key={work.id} work={work} ratio={ratio} selected={work.id === currentWork?.id} label={work.id === currentWork?.id ? '当前结果' : `结果 ${index + 1}`} onSelect={() => { setSelectedVideoId(work.id); setView('single') }} onOpen={() => setDetailWork(work)} />
            ))}
          </div>
        )}
      </ResultStage>

      <ResultActions>
        <ControlButton size="sm" variant="ghost" disabled={!currentWork} onClick={() => {
          if (!currentWork) return
          // 与图片工作台一致：真正把参数写回表单，而不是只弹提示。
          setPrompt(currentWork.prompt || prompt)
          if (currentWork.model && videoModelList.some((item) => item.id === currentWork.model)) setModelId(currentWork.model)
          if (currentWork.duration) setDuration(currentWork.duration)
          setNotice({ tone: 'accent', text: `已复用参数：${currentWork.prompt ? `提示词「${currentWork.prompt.slice(0, 20)}」` : '（该结果没有记录提示词）'}${currentWork.model ? ` · 模型 ${currentWork.model}` : ''}` })
        }}>
          <Copy className="size-3.5" aria-hidden="true" />
          复用参数
        </ControlButton>
        <ControlButton size="sm" variant="ghost" disabled={!currentWork || projectBusy} onClick={() => void addVideoToProject()}>
          <Plus className="size-3.5" aria-hidden="true" />
          {projectBusy ? '处理中…' : '加入项目'}
        </ControlButton>
        <ControlButton size="sm" variant="ghost" disabled={!currentWork || projectBusy} onClick={() => void sendVideoToCanvas()}>
          <Send className="size-3.5" aria-hidden="true" />
          送入画布
        </ControlButton>
        <MediaDownloadButton media={{ url: currentWork?.src ?? '', kind: 'video' }} title={currentWork?.title ?? '作品'} disabled={!currentWork} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs hover:bg-muted disabled:opacity-50" />
        <ControlButton size="sm" variant="ghost" onClick={() => setAgentOpen(true)}>
          <Bot className="size-3.5" aria-hidden="true" />
          导演 Agent
        </ControlButton>
        <ControlButton size="sm" variant="ghost" onClick={() => router.push('/tasks')}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          任务记录
        </ControlButton>
      </ResultActions>

      <section aria-labelledby="video-queue" className="studio-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="video-queue" className="text-xs font-semibold text-foreground">生成任务</h2>
          <span className="text-[11px] text-muted-foreground">{liveVideoTasks.length} 条任务</span>
        </div>
        <div className="mt-2">
          <LiveTaskList kinds={['video']} limit={4} compact emptyHint="还没有视频任务" />
        </div>
      </section>

      {!liveReady && <LocalPreviewNotice what="视频生成" />}
      <GenerationErrorNotice />
      <GenerationNotice />

      {notice && (
        <Notice tone={notice.tone}>
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span aria-live="polite">{notice.text}</span>
        </Notice>
      )}
    </div>
  )

  return (
    <>
      <WorkspaceShell
        params={params}
        stage={stage}
        onSubmit={submit}
        submitLabel={submitting ? '正在提交…' : '开始生成'}
        credits={credits}
        submitDisabled={!prompt.trim() || submitting || Boolean(submitBlock)}
        submitHint={submitBlock || (!prompt.trim() ? '先描述主体动作与镜头运动。' : undefined)}
        paramsTitle="视频参数"
        paramsHint={model ? `${model.shortName} · ${duration}` : '暂无可用模型'}
      />
      <SidePanel open={agentOpen} onClose={() => setAgentOpen(false)} title="导演 Agent" description="基于当前视频参数继续拆解镜头与素材">
        <DirectorAgent context="视频工作台 · 极光之后" />
      </SidePanel>
      <ResultDetailModal work={detailWork} onClose={() => setDetailWork(null)} onNotice={(text) => setNotice({ tone: 'accent', text })} />
    </>
  )
}
