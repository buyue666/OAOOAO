'use client'

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Eraser,
  Expand,
  CornerDownLeft,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Layers3,
  Maximize2,
  Minus,
  MousePointer2,
  Paintbrush,
  Redo2,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  Video,
  WandSparkles,
  X,
  Save,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import styles from './image-editor-panel.module.css'

export type ImageEditorTool = 'brush' | 'eraser' | 'rect' | 'move'
export type ImageEditOperation = 'inpaint' | 'remove-background' | 'erase' | 'outpaint' | 'enhance' | 'layers' | 'to-video'

export interface ImageEditRequest {
  operation: ImageEditOperation
  prompt: string
  maskDataUrl?: string
  imageUrl: string
  brushSize: number
  /** Per-region instructions and optional reference images uploaded in the marker composer. */
  regions?: ImageEditorRegion[]
  /** Target output ratio for outpaint; omitted means preserve the source ratio. */
  ratio?: '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'
  /** Optional model and image settings selected in the editor. */
  model?: string
  resolution?: string
  quality?: string
}

export type ImageEditorRegion = { id: number; prompt?: string; referenceImageDataUrl?: string }

/** Model and capability data used by the editor settings strip. Kept small so
 * the canvas editor can opt out without importing the studio model registry. */
export type ImageEditorModelOption = {
  id: string
  label: string
  /** The operation family this model can serve. Omitted keeps backwards compatibility. */
  capability?: 'image' | 'video'
  icon?: ReactNode
  ratios?: string[]
  resolutions?: string[]
  qualities?: string[]
  qualityLabels?: Record<string, string>
}

export interface ImageEditorVersion {
  id: string
  imageUrl: string
  label?: string
}

export interface ImageEditorPanelProps {
  /** Image URL or data URL to edit. */
  imageSrc: string
  alt?: string
  title?: string
  description?: string
  className?: string
  initialOperation?: ImageEditOperation
  initialPrompt?: string
  initialBrushSize?: number
  versions?: ImageEditorVersion[]
  activeVersionId?: string
  onClose?: () => void
  onSubmit?: (request: ImageEditRequest) => void | Promise<void>
  onSaveVersion?: (imageSrc: string) => void | Promise<void>
  onVersionSelect?: (version: ImageEditorVersion) => void
  onImageClick?: () => void
  onOperationChange?: (operation: ImageEditOperation) => void
  /** Called after region descriptions are confirmed so the parent prompt can stay in sync. */
  onRegionPromptChange?: (regions: ImageEditorRegion[]) => void
  /** Optional image-to-image model choices. The first matching initialModelId is selected. */
  modelOptions?: ImageEditorModelOption[]
  initialModelId?: string
  /** Optional video defaults used when switching this image editor to video. */
  initialVideoModelId?: string
  initialVideoQuality?: string
  initialResolution?: string
  initialQuality?: string
  showHeader?: boolean
  /** Visual treatment for the editor surface. */
  theme?: 'dark' | 'light'
}

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type MaskRegion = ImageEditorRegion & { x: number; y: number }
type MaskSnapshot = { dataUrl: string; regions: MaskRegion[] }
type PanPoint = { x: number; y: number }
type OutpaintRatio = 'original' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'

const outpaintRatioOptions: Array<{ value: OutpaintRatio; label: string; width?: number; height?: number }> = [
  { value: 'original', label: '原比例' },
  { value: '1:1', label: '1:1', width: 1, height: 1 },
  { value: '3:2', label: '3:2', width: 3, height: 2 },
  { value: '2:3', label: '2:3', width: 2, height: 3 },
  { value: '4:3', label: '4:3', width: 4, height: 3 },
  { value: '16:9', label: '16:9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', width: 9, height: 16 },
  { value: '3:4', label: '3:4', width: 3, height: 4 },
  { value: '21:9', label: '21:9', width: 21, height: 9 },
]

const operations: Array<{ value: ImageEditOperation; label: string; icon: typeof Sparkles }> = [
  { value: 'inpaint', label: '标记改图', icon: WandSparkles },
  { value: 'remove-background', label: '抠图', icon: Scissors },
  { value: 'erase', label: '擦除', icon: Eraser },
  { value: 'outpaint', label: '扩图', icon: Expand },
  { value: 'enhance', label: '变清晰', icon: Sparkles },
  { value: 'layers', label: '分图层', icon: Layers3 },
  { value: 'to-video', label: '变视频', icon: Video },
]

type OperationMeta = {
  guide: string
  placeholder: string
  defaultPrompt: string
  status: string
  submitLabel: string
  maskHint?: string
}

const operationMeta: Record<ImageEditOperation, OperationMeta> = {
  inpaint: {
    guide: '先在画面上涂抹需要修改的区域，再描述你想替换的内容，可用区域编号对应不同位置。',
    placeholder: '例如：把区域 1 改成金色机械臂，把区域 2 改成蓝色玻璃，保持原来的光影和构图',
    defaultPrompt: '保持原来的光影和构图，只修改标记区域',
    status: '已切换到标记改图，请在图片上标记区域',
    submitLabel: '提交改图',
    maskHint: '会把标记区域作为蒙版发送给图片模型',
  },
  'remove-background': {
    guide: '自动识别主体并移除背景，适合制作透明 PNG 素材。',
    placeholder: '例如：保留人物和手提箱，边缘干净，输出透明背景',
    defaultPrompt: '保留主体，移除背景并输出透明背景',
    status: '已切换到抠图，可直接提交或标记需要保留的区域',
    submitLabel: '开始抠图',
    maskHint: '不标记时由模型自动识别主体',
  },
  erase: {
    guide: '涂抹要擦除的物体，模型会补全被移除区域的背景。',
    placeholder: '例如：擦除画面中的路人，补全后面的街道纹理',
    defaultPrompt: '擦除标记区域，并自然补全周围背景',
    status: '已切换到擦除，请用橡皮工具涂抹目标',
    submitLabel: '提交擦除',
    maskHint: '橡皮工具会从蒙版中减去区域，适合精细调整',
  },
  outpaint: {
    guide: '选择新的画幅比例，原图会居中放入扩展画布，再由模型补全留白区域。',
    placeholder: '例如：向左右扩展画面，延续天空和建筑，主体保持原位',
    defaultPrompt: '向画布边缘自然扩展，延续原图的光影、色彩和透视',
    status: '已切换到扩图，描述需要扩展的方向和内容',
    submitLabel: '生成扩图',
    maskHint: '画布中的虚线区域是待补全的扩展范围',
  },
  enhance: {
    guide: '提升清晰度、细节和纹理，同时尽量保持原图构图与主体不变。',
    placeholder: '例如：提升人像细节和发丝清晰度，保持肤色自然，不改变构图',
    defaultPrompt: '提升整体清晰度和细节，保持原图构图、色彩和主体不变',
    status: '已切换到高清修复，可补充想强化的细节',
    submitLabel: '变清晰',
    maskHint: '不标记时处理整张图片，标记后只强化指定区域',
  },
  layers: {
    guide: '尝试把主体、背景和前景拆成便于继续编辑的图层。',
    placeholder: '例如：将人物、桌面和背景墙拆成独立图层，保留遮挡关系',
    defaultPrompt: '识别主体、前景和背景并拆分为可单独编辑的图层，保留遮挡关系',
    status: '已切换到分图层，请描述想拆分的对象',
    submitLabel: '生成图层',
    maskHint: '可标记需要重点拆分的主体；最终结果取决于图片模型能力',
  },
  'to-video': {
    guide: '把当前图片作为首帧生成短视频，描述镜头运动、主体动作或环境变化。',
    placeholder: '例如：镜头缓慢推进，人物抬头看向远处，头发被微风吹动',
    defaultPrompt: '让画面产生自然、平滑的轻微运动，保持主体外观和镜头构图',
    status: '已切换到转视频，当前图片会作为首帧提交',
    submitLabel: '生成视频',
    maskHint: '转视频使用整张图片作为首帧，涂抹标记不会改变视频范围',
  },
}

function emptyMaskSnapshot(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/png')
}

function restoreMaskSnapshot(canvas: HTMLCanvasElement, source: string) {
  const context = canvas.getContext('2d')
  if (!context) return
  const image = new Image()
  image.onload = () => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
  }
  image.src = source
}

function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取图片'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
}

export function ImageEditorPanel({
  imageSrc,
  alt = '待编辑图片',
  title = '图片编辑',
  description = '标记需要修改的区域，再告诉 AI 想怎么改',
  className,
  initialOperation = 'inpaint',
  initialPrompt = '',
  initialBrushSize = 34,
  versions = [],
  activeVersionId,
  onClose,
  onSubmit,
  onSaveVersion,
  onVersionSelect,
  onImageClick,
  onOperationChange,
  onRegionPromptChange,
  modelOptions = [],
  initialModelId,
  initialVideoModelId,
  initialVideoQuality = '',
  initialResolution = '1K',
  initialQuality = 'auto',
  showHeader = true,
  theme = 'dark',
}: ImageEditorPanelProps) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<MaskSnapshot[]>([])
  const historyIndexRef = useRef(-1)
  const drawingRef = useRef(false)
  const startPointRef = useRef<Point | null>(null)
  const panningRef = useRef(false)
  const spacePressedRef = useRef(false)
  const panStartRef = useRef<Point | null>(null)
  const panOriginRef = useRef<PanPoint>({ x: 0, y: 0 })
  const toolbarDraggingRef = useRef(false)
  const toolbarDragStartRef = useRef<Point | null>(null)
  const toolbarOriginRef = useRef<PanPoint>({ x: 0, y: 0 })
  const regionCloseTimerRef = useRef<number | null>(null)
  const regionOpenFrameRef = useRef<number | null>(null)
  const nextRegionIdRef = useRef(1)
  const maskRegionsRef = useRef<MaskRegion[]>([])
  const [operation, setOperation] = useState<ImageEditOperation>(initialOperation)
  const [tool, setTool] = useState<ImageEditorTool>('brush')
  const [prompt, setPrompt] = useState(initialPrompt)
  const [brushSize, setBrushSize] = useState(initialBrushSize)
  const [brushColor, setBrushColor] = useState('#8fe9d5')
  const [maskRevision, setMaskRevision] = useState(0)
  const [maskRegions, setMaskRegions] = useState<MaskRegion[]>([])
  const [outpaintRatio, setOutpaintRatio] = useState<OutpaintRatio>('original')
  const [editorModelId, setEditorModelId] = useState(initialModelId || modelOptions[0]?.id || '')
  const [editorVideoModelId, setEditorVideoModelId] = useState(initialVideoModelId || modelOptions.find((item) => item.capability === 'video')?.id || '')
  const [editorResolution, setEditorResolution] = useState(initialResolution)
  const [editorQuality, setEditorQuality] = useState(initialQuality)
  const [editorVideoQuality, setEditorVideoQuality] = useState(initialVideoQuality)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<PanPoint>({ x: 0, y: 0 })
  const [toolbarOffset, setToolbarOffset] = useState<PanPoint>({ x: 0, y: 0 })
  const [showMarkers, setShowMarkers] = useState(true)
  const [editingRegionId, setEditingRegionId] = useState<number | null>(null)
  const [editingRegionPrompt, setEditingRegionPrompt] = useState('')
  const [closingRegionId, setClosingRegionId] = useState<number | null>(null)
  const [toolbarDragging, setToolbarDragging] = useState(false)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [hiddenSubmitConfirm, setHiddenSubmitConfirm] = useState(false)
  const [draftRect, setDraftRect] = useState<Rect | null>(null)
  const [status, setStatus] = useState(operationMeta[initialOperation].status)
  const [isSaving, setIsSaving] = useState(false)

  const hasMask = maskRevision >= 0 && historyIndexRef.current > 0
  const canUndo = historyIndexRef.current > 0
  const canRedo = historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1
  const selectedMeta = operationMeta[operation]
  const editorCapability = operation === 'to-video' ? 'video' : 'image'
  const editorModelChoices = useMemo(() => {
    const matching = modelOptions.filter((item) => !item.capability || item.capability === editorCapability)
    return matching.length ? matching : modelOptions
  }, [editorCapability, modelOptions])
  const videoModelChoices = useMemo(() => {
    const matching = modelOptions.filter((item) => item.capability === 'video')
    return matching.length ? matching : modelOptions
  }, [modelOptions])
  const selectedEditorModelId = editorCapability === 'video' ? editorVideoModelId : editorModelId
  const selectedEditorModel = editorModelChoices.find((item) => item.id === selectedEditorModelId) ?? editorModelChoices[0]
  const activeEditorQuality = editorCapability === 'video' ? editorVideoQuality : editorQuality
  const setActiveEditorQuality = editorCapability === 'video' ? setEditorVideoQuality : setEditorQuality
  const editorResolutionOptions = useMemo(() => (
    selectedEditorModel?.resolutions?.length ? selectedEditorModel.resolutions : [initialResolution || '1K']
  ), [initialResolution, selectedEditorModel])
  const editorQualityOptions = useMemo(() => (
    editorCapability === 'image' && editorResolution === '1K'
      ? ['auto']
      : selectedEditorModel?.qualities?.length ? selectedEditorModel.qualities : ['auto']
  ), [editorCapability, editorResolution, selectedEditorModel])

  // Keep the selected model and parameter values valid when switching between
  // image editing and video conversion. This also makes newly loaded backend
  // model lists safe when the original model is no longer available.
  useEffect(() => {
    if (!editorModelChoices.length) return
    setEditorModelId((current) => editorModelChoices.some((item) => item.id === current)
      ? current
      : (editorModelChoices.find((item) => item.id === initialModelId)?.id ?? editorModelChoices[0].id))
  }, [editorModelChoices, initialModelId])
  useEffect(() => {
    if (!videoModelChoices.length) return
    setEditorVideoModelId((current) => videoModelChoices.some((item) => item.id === current)
      ? current
      : (videoModelChoices.find((item) => item.id === initialVideoModelId)?.id ?? videoModelChoices[0].id))
  }, [initialVideoModelId, videoModelChoices])
  useEffect(() => {
    if (editorCapability !== 'image' || !editorResolutionOptions.length) return
    setEditorResolution((current) => editorResolutionOptions.includes(current) ? current : editorResolutionOptions[0])
  }, [editorCapability, editorResolutionOptions])
  useEffect(() => {
    if (!editorQualityOptions.length) return
    setActiveEditorQuality((current) => editorQualityOptions.includes(current) ? current : editorQualityOptions[0])
  }, [editorQualityOptions, setActiveEditorQuality])
  const editorOutpaintRatioOptions = useMemo(() => {
    const supported = selectedEditorModel?.ratios?.filter(Boolean)
    if (!supported?.length) return outpaintRatioOptions
    const supportedSet = new Set(supported)
    return outpaintRatioOptions.filter((option) => option.value === 'original' || supportedSet.has(option.value))
  }, [selectedEditorModel])

  const originalAspectRatio = useMemo(() => {
    const image = imageRef.current
    return image?.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1
  }, [imageSrc, maskRevision])
  const outpaintAspectRatio = useMemo(() => {
    const selected = outpaintRatioOptions.find((option) => option.value === outpaintRatio)
    return selected?.width && selected.height ? selected.width / selected.height : originalAspectRatio
  }, [originalAspectRatio, outpaintRatio])
  const outpaintFrameStyle = operation === 'outpaint'
    ? { '--outpaint-aspect': `${outpaintAspectRatio}` } as CSSProperties
    : undefined
  const mediaFrameStyle: CSSProperties = {
    ...(outpaintFrameStyle ?? {}),
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  }
  const toolbarStyle: CSSProperties = {
    transform: `translate(calc(-50% + ${toolbarOffset.x}px), ${toolbarOffset.y}px)`,
  }

  const updateMaskRegions = useCallback((next: MaskRegion[]) => {
    maskRegionsRef.current = next
    setMaskRegions(next)
  }, [])

  const publishRegionPrompt = useCallback((next: MaskRegion[]) => {
    const summary = next
      .map((region) => `区域 ${region.id}${region.prompt?.trim() ? `：${region.prompt.trim()}` : '：'}${region.referenceImageDataUrl ? '（附参考图）' : ''}`)
      .join('；')
    setPrompt((current) => {
      const marker = '【区域标记】'
      const markerIndex = current.indexOf(marker)
      // Keep the generated marker block inside the editor prompt and remove
      // any leading/trailing whitespace left by a previous draft. This keeps
      // the first marker on the first line instead of showing an empty line.
      const base = (markerIndex >= 0 ? current.slice(0, markerIndex) : current).trim()
      return summary ? `${base}${base ? '\n' : ''}${marker}\n${summary}` : base
    })
    onRegionPromptChange?.(next.map(({ id, prompt: regionPrompt, referenceImageDataUrl }) => ({
      id,
      prompt: regionPrompt,
      referenceImageDataUrl,
    })))
  }, [onRegionPromptChange])

  const closeRegionEditor = useCallback((animated = true) => {
    if (regionOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(regionOpenFrameRef.current)
      regionOpenFrameRef.current = null
    }
    if (regionCloseTimerRef.current !== null) {
      window.clearTimeout(regionCloseTimerRef.current)
      regionCloseTimerRef.current = null
    }
    const regionId = editingRegionId
    if (regionId === null || !animated) {
      setClosingRegionId(null)
      setEditingRegionId(null)
      setEditingRegionPrompt('')
      return
    }
    setClosingRegionId(regionId)
    regionCloseTimerRef.current = window.setTimeout(() => {
      setClosingRegionId(null)
      setEditingRegionId(null)
      setEditingRegionPrompt('')
      regionCloseTimerRef.current = null
    }, 170)
  }, [editingRegionId])

  useEffect(() => () => {
    if (regionCloseTimerRef.current !== null) window.clearTimeout(regionCloseTimerRef.current)
    if (regionOpenFrameRef.current !== null) window.cancelAnimationFrame(regionOpenFrameRef.current)
  }, [])

  const openRegionEditor = useCallback((regionId: number, regionPrompt = '') => {
    closeRegionEditor(false)
    setClosingRegionId(null)
    // Mount immediately after the marker is committed. The marker and composer
    // have separate CSS entry animations, so the badge appears first while the
    // input still reliably opens even when pointer capture ends outside canvas.
    setEditingRegionId(regionId)
    setEditingRegionPrompt(regionPrompt)
  }, [closeRegionEditor])

  const initializeMask = useCallback(() => {
    const image = imageRef.current
    const canvas = maskRef.current
    if (!image || !canvas) return
    const width = image.naturalWidth || image.clientWidth || 1
    const height = image.naturalHeight || image.clientHeight || 1
    canvas.width = width
    canvas.height = height
    const snapshot = emptyMaskSnapshot(canvas)
    historyRef.current = [{ dataUrl: snapshot, regions: [] }]
    historyIndexRef.current = 0
    nextRegionIdRef.current = 1
    updateMaskRegions([])
    if (regionCloseTimerRef.current !== null) {
      window.clearTimeout(regionCloseTimerRef.current)
      regionCloseTimerRef.current = null
    }
    if (regionOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(regionOpenFrameRef.current)
      regionOpenFrameRef.current = null
    }
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setToolbarOffset({ x: 0, y: 0 })
    setShowMarkers(true)
    setClosingRegionId(null)
    setEditingRegionId(null)
    setEditingRegionPrompt('')
    setMaskRevision((revision) => revision + 1)
    setDraftRect(null)
  }, [updateMaskRegions])

  useEffect(() => {
    initializeMask()
  }, [imageSrc, initializeMask])

  useEffect(() => {
    setOperation(initialOperation)
  }, [initialOperation])

  useEffect(() => {
    setPrompt(initialPrompt)
  }, [initialPrompt])

  useEffect(() => {
    setBrushSize(initialBrushSize)
  }, [initialBrushSize])

  useEffect(() => {
    const next = modelOptions.find((item) => item.id === initialModelId)?.id || modelOptions[0]?.id || ''
    setEditorModelId(next)
  }, [initialModelId, modelOptions])

  useEffect(() => {
    setEditorResolution((current) => editorResolutionOptions.includes(current) ? current : editorResolutionOptions[0] || '1K')
  }, [editorResolutionOptions])

  useEffect(() => {
    setEditorQuality((current) => editorQualityOptions.includes(current) ? current : editorQualityOptions[0] || 'auto')
  }, [editorQualityOptions])

  useEffect(() => {
    setOutpaintRatio((current) => editorOutpaintRatioOptions.some((item) => item.value === current) ? current : 'original')
  }, [editorOutpaintRatioOptions])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setLayoutRevision((revision) => revision + 1))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = true
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = false
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const snapshotMask = useCallback(() => {
    const canvas = maskRef.current
    if (!canvas) return
    const snapshot = canvas.toDataURL('image/png')
    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
    nextHistory.push({ dataUrl: snapshot, regions: maskRegionsRef.current.map((region) => ({ ...region })) })
    historyRef.current = nextHistory.slice(-30)
    historyIndexRef.current = historyRef.current.length - 1
    setMaskRevision((revision) => revision + 1)
  }, [])

  const undo = useCallback(() => {
    if (!canUndo) return
    closeRegionEditor(false)
    historyIndexRef.current -= 1
    const snapshot = historyRef.current[historyIndexRef.current]
    const canvas = maskRef.current
    if (canvas && snapshot) restoreMaskSnapshot(canvas, snapshot.dataUrl)
    if (snapshot) {
      updateMaskRegions(snapshot.regions)
      publishRegionPrompt(snapshot.regions)
      nextRegionIdRef.current = Math.max(0, ...snapshot.regions.map((region) => region.id)) + 1
    }
    setMaskRevision((revision) => revision + 1)
  }, [canUndo, closeRegionEditor, publishRegionPrompt, updateMaskRegions])

  const redo = useCallback(() => {
    if (!canRedo) return
    closeRegionEditor(false)
    historyIndexRef.current += 1
    const snapshot = historyRef.current[historyIndexRef.current]
    const canvas = maskRef.current
    if (canvas && snapshot) restoreMaskSnapshot(canvas, snapshot.dataUrl)
    if (snapshot) {
      updateMaskRegions(snapshot.regions)
      publishRegionPrompt(snapshot.regions)
      nextRegionIdRef.current = Math.max(0, ...snapshot.regions.map((region) => region.id)) + 1
    }
    setMaskRevision((revision) => revision + 1)
  }, [canRedo, closeRegionEditor, publishRegionPrompt, updateMaskRegions])

  const clearMask = useCallback(() => {
    const canvas = maskRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    historyRef.current = [{ dataUrl: canvas.toDataURL('image/png'), regions: [] }]
    historyIndexRef.current = 0
    nextRegionIdRef.current = 1
    updateMaskRegions([])
    publishRegionPrompt([])
    closeRegionEditor(false)
    setMaskRevision((revision) => revision + 1)
    setStatus('已清空标记')
  }, [closeRegionEditor, publishRegionPrompt, updateMaskRegions])

  const confirmRegionPrompt = useCallback((animated = true) => {
    if (editingRegionId === null) return
    const promptValue = editingRegionPrompt.trim()
    const nextRegions = maskRegionsRef.current.map((region) => (
      region.id === editingRegionId ? { ...region, prompt: promptValue || undefined } : region
    ))
    updateMaskRegions(nextRegions)
    publishRegionPrompt(nextRegions)
    if (historyIndexRef.current >= 0 && historyRef.current[historyIndexRef.current]) {
      historyRef.current[historyIndexRef.current] = {
        ...historyRef.current[historyIndexRef.current],
        regions: nextRegions.map((region) => ({ ...region })),
      }
    }
    closeRegionEditor(animated)
  }, [closeRegionEditor, editingRegionId, editingRegionPrompt, publishRegionPrompt, updateMaskRegions])

  const handleRegionReferenceUpload = useCallback(async (regionId: number, file?: File) => {
    if (!file || !file.type.startsWith('image/')) return
    try {
      const dataUrl = await readImageAsDataUrl(file)
      const nextRegions = maskRegionsRef.current.map((region) => (
        region.id === regionId ? { ...region, referenceImageDataUrl: dataUrl } : region
      ))
      updateMaskRegions(nextRegions)
      publishRegionPrompt(nextRegions)
      if (historyIndexRef.current >= 0 && historyRef.current[historyIndexRef.current]) {
        historyRef.current[historyIndexRef.current] = {
          ...historyRef.current[historyIndexRef.current],
          regions: nextRegions.map((region) => ({ ...region })),
        }
      }
      setMaskRevision((revision) => revision + 1)
    } catch {
      setStatus('参考图读取失败，请重试')
    }
  }, [publishRegionPrompt, updateMaskRegions])

  const removeRegionReference = useCallback((regionId: number) => {
    const nextRegions = maskRegionsRef.current.map((region) => {
      if (region.id !== regionId || !region.referenceImageDataUrl) return region
      const { referenceImageDataUrl: _removed, ...withoutReference } = region
      return withoutReference
    })
    updateMaskRegions(nextRegions)
    publishRegionPrompt(nextRegions)
    if (historyIndexRef.current >= 0 && historyRef.current[historyIndexRef.current]) {
      historyRef.current[historyIndexRef.current] = {
        ...historyRef.current[historyIndexRef.current],
        regions: nextRegions.map((region) => ({ ...region })),
      }
    }
    setMaskRevision((revision) => revision + 1)
  }, [publishRegionPrompt, updateMaskRegions])

  const pointFromEvent = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = maskRef.current
    if (!canvas) return null
    const bounds = canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return null
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * (canvas.width / bounds.width))),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * (canvas.height / bounds.height))),
    }
  }, [])

  const adjustZoom = (next: number) => {
    setZoom(Math.min(5, Math.max(0.5, Number(next.toFixed(2)))))
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    event.preventDefault()
    adjustZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1))
  }

  const clampToolbarOffset = (next: PanPoint) => {
    const stage = stageRef.current
    const toolbar = toolbarRef.current
    if (!stage || !toolbar) return next
    const maxX = Math.max(0, (stage.clientWidth - toolbar.offsetWidth) / 2 - 8)
    const baseTop = toolbar.offsetTop || 16
    const minY = 8 - baseTop
    const maxY = Math.max(minY, stage.clientHeight - toolbar.offsetHeight - 8 - baseTop)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(minY, next.y)),
    }
  }

  const handleToolbarPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    toolbarDraggingRef.current = true
    setToolbarDragging(true)
    toolbarDragStartRef.current = { x: event.clientX, y: event.clientY }
    toolbarOriginRef.current = toolbarOffset
  }

  const handleToolbarPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!toolbarDraggingRef.current || !toolbarDragStartRef.current) return
    event.preventDefault()
    const start = toolbarDragStartRef.current
    setToolbarOffset(clampToolbarOffset({
      x: toolbarOriginRef.current.x + event.clientX - start.x,
      y: toolbarOriginRef.current.y + event.clientY - start.y,
    }))
  }

  const handleToolbarPointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!toolbarDraggingRef.current) return
    toolbarDraggingRef.current = false
    setToolbarDragging(false)
    toolbarDragStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const drawPoint = useCallback((point: Point) => {
    const canvas = maskRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = brushSize
    if (tool === 'eraser') {
      context.globalCompositeOperation = 'destination-out'
      context.strokeStyle = '#000000'
    } else {
      context.globalCompositeOperation = 'source-over'
      context.strokeStyle = brushColor
    }
    context.lineTo(point.x, point.y)
    context.stroke()
    context.restore()
  }, [brushColor, brushSize, tool])

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'move' || spacePressedRef.current || event.button === 1) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      panningRef.current = true
      panStartRef.current = { x: event.clientX, y: event.clientY }
      panOriginRef.current = pan
      return
    }
    if (event.button !== 0) return
    const point = pointFromEvent(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'brush' && editingRegionId !== null) confirmRegionPrompt(false)
    drawingRef.current = true
    startPointRef.current = point
    const canvas = maskRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    if (tool === 'brush') {
      const region = { id: nextRegionIdRef.current++, x: point.x, y: point.y }
      const nextRegions = [...maskRegionsRef.current, region]
      updateMaskRegions(nextRegions)
      // Put the new region token into the parent prompt immediately. The
      // floating composer then fills in its description as the user confirms it.
      publishRegionPrompt(nextRegions)
      setEditingRegionId(null)
      setEditingRegionPrompt('')
    } else if (tool === 'eraser') {
      const clearRadius = Math.max(brushSize * 1.5, 28)
      updateMaskRegions(maskRegionsRef.current.filter((region) => Math.hypot(region.x - point.x, region.y - point.y) > clearRadius))
    }
    if (tool === 'rect') {
      setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 })
      return
    }
    context.beginPath()
    context.moveTo(point.x, point.y)
    context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2)
    // destination-out uses the source alpha as the erase strength, so the
    // eraser must draw with an opaque color even though the color itself is
    // discarded by the composite operation.
    context.fillStyle = tool === 'eraser' ? '#000000' : brushColor
    if (tool === 'eraser') {
      context.globalCompositeOperation = 'destination-out'
      context.fill()
      context.globalCompositeOperation = 'source-over'
    } else {
      context.fill()
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panningRef.current && panStartRef.current) {
      setPan({
        x: panOriginRef.current.x + event.clientX - panStartRef.current.x,
        y: panOriginRef.current.y + event.clientY - panStartRef.current.y,
      })
      return
    }
    if (!drawingRef.current) return
    const point = pointFromEvent(event)
    const start = startPointRef.current
    if (!point || !start) return
    if (tool === 'rect') {
      setDraftRect({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) })
      return
    }
    drawPoint(point)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panningRef.current) {
      panningRef.current = false
      panStartRef.current = null
      return
    }
    if (!drawingRef.current) return
    drawingRef.current = false
    const point = pointFromEvent(event)
    const start = startPointRef.current
    const canvas = maskRef.current
    const context = canvas?.getContext('2d')
    if (tool === 'rect' && point && start && canvas && context) {
      const rect = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) }
      if (rect.width > 2 && rect.height > 2) {
        context.save()
        context.globalCompositeOperation = 'source-over'
        context.fillStyle = brushColor
        context.fillRect(rect.x, rect.y, rect.width, rect.height)
        context.restore()
      }
      setDraftRect(null)
    }
    startPointRef.current = null
    snapshotMask()
    if (tool === 'brush' && point && start) {
      const nearestRegion = maskRegionsRef.current[maskRegionsRef.current.length - 1]
      if (nearestRegion) {
        openRegionEditor(nearestRegion.id, nearestRegion.prompt ?? '')
      }
    }
  }

  const selectOperation = (next: ImageEditOperation) => {
    const previousMeta = operationMeta[operation]
    setOperation(next)
    onOperationChange?.(next)
    if (!prompt.trim() || prompt.trim() === previousMeta.defaultPrompt) {
      setPrompt(operationMeta[next].defaultPrompt)
    }
    setStatus(operationMeta[next].status)
    closeRegionEditor(false)
    if (next === 'erase') setTool('eraser')
    if (next === 'outpaint') setTool('move')
    if (next === 'inpaint' || next === 'remove-background') setTool('brush')
  }

  const submit = async (confirmedHiddenMarkers = false) => {
    if (!confirmedHiddenMarkers && operation !== 'outpaint' && hasMask && !showMarkers) {
      setHiddenSubmitConfirm(true)
      return
    }
    setStatus('正在提交编辑请求…')
    setHiddenSubmitConfirm(false)
    const canvas = maskRef.current
    const rawPrompt = prompt.trim()
    const markerIndex = rawPrompt.indexOf('【区域标记】')
    const basePrompt = (markerIndex >= 0 ? rawPrompt.slice(0, markerIndex) : rawPrompt).trim() || selectedMeta.defaultPrompt
    const regionPrompt = operation !== 'outpaint' && maskRegions.length > 0
      ? `请按照画面上的标注编号处理：${maskRegions.map((region) => `${region.prompt?.trim() ? `区域 ${region.id}：${region.prompt.trim()}` : `区域 ${region.id}`}${region.referenceImageDataUrl ? '（附有该区域参考图）' : ''}`).join('；')}。提示词中的“区域 N”对应画面上同编号位置。`
      : ''
    const request: ImageEditRequest = {
      operation,
      prompt: [basePrompt, regionPrompt].filter(Boolean).join('\n\n'),
      maskDataUrl: operation !== 'outpaint' && canvas && hasMask ? canvas.toDataURL('image/png') : undefined,
      imageUrl: imageSrc,
      brushSize,
      model: selectedEditorModel?.id || selectedEditorModelId || undefined,
      resolution: editorCapability === 'image' ? (editorResolution || undefined) : undefined,
      quality: activeEditorQuality || undefined,
      regions: operation !== 'outpaint' && maskRegions.length > 0
        ? maskRegions.map((region) => ({ id: region.id, prompt: region.prompt, referenceImageDataUrl: region.referenceImageDataUrl }))
        : undefined,
      ratio: operation === 'outpaint' && outpaintRatio !== 'original' ? outpaintRatio : undefined,
    }
    try {
      await onSubmit?.(request)
      setStatus('已提交，等待生成结果')
    } catch {
      setStatus('提交失败，请稍后重试')
    }
  }

  const saveVersion = async () => {
    if (!onSaveVersion) return
    setIsSaving(true)
    try {
      await onSaveVersion(imageSrc)
      setStatus('已保存为新版本')
    } finally {
      setIsSaving(false)
    }
  }

  const maskStyle = useMemo(() => {
    const canvas = maskRef.current
    if (!canvas || !draftRect) return undefined
    const bounds = canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return undefined
    return {
      left: `${(draftRect.x / canvas.width) * 100}%`,
      top: `${(draftRect.y / canvas.height) * 100}%`,
      width: `${(draftRect.width / canvas.width) * 100}%`,
      height: `${(draftRect.height / canvas.height) * 100}%`,
    }
  }, [draftRect, maskRevision])

  const regionComposerPosition = useMemo(() => {
    if (editingRegionId === null || !showMarkers) return null
    const region = maskRegions.find((item) => item.id === editingRegionId)
    const canvas = maskRef.current
    const stage = stageRef.current
    if (!region || !canvas || !stage || !canvas.width || !canvas.height) return null
    const canvasRect = canvas.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    if (!canvasRect.width || !canvasRect.height || !stageRect.width || !stageRect.height) return null
    const markerX = canvasRect.left - stageRect.left + (region.x / canvas.width) * canvasRect.width
    const markerY = canvasRect.top - stageRect.top + (region.y / canvas.height) * canvasRect.height
    const popupWidth = Math.min(340, Math.max(220, stageRect.width - 16))
    const popupHeight = 56
    const gap = 12
    const minX = 8
    const maxX = Math.max(minX, stageRect.width - popupWidth - 8)
    // Leave a little extra breathing room vertically for the slide-in animation.
    const minY = 14
    const maxY = Math.max(minY, stageRect.height - popupHeight - 14)
    const canRight = markerX + gap + popupWidth <= stageRect.width - 8
    const canLeft = markerX - gap - popupWidth >= 8
    const canBelow = markerY + gap + popupHeight <= stageRect.height - 14
    const canAbove = markerY - gap - popupHeight >= 14
    const left = canRight
      ? markerX + gap
      : canLeft
        ? markerX - gap - popupWidth
        : Math.min(maxX, Math.max(minX, markerX - popupWidth / 2))
    const top = canBelow
      ? markerY + gap
      : canAbove
        ? markerY - gap - popupHeight
        : Math.min(maxY, Math.max(minY, markerY - popupHeight / 2))
    return { left, top, width: popupWidth }
  }, [editingRegionId, layoutRevision, maskRegions, maskRevision, pan, showMarkers, zoom])

  const editingRegion = editingRegionId === null
    ? undefined
    : maskRegions.find((region) => region.id === editingRegionId)

  return (
    <aside className={`${styles.panel}${className ? ` ${className}` : ''}`} data-editor-theme={theme} aria-label={title}>
      {showHeader && <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconButton} onClick={saveVersion} disabled={isSaving || !onSaveVersion} aria-label="保存为新版本" title="保存为新版本">
            <Save aria-hidden="true" />
          </button>
          {onClose && <button type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭图片编辑" title="关闭"><X aria-hidden="true" /></button>}
        </div>
      </header>}

      <nav className={styles.operations} aria-label="图片操作">
        {operations.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" className={`${styles.operationButton} ${operation === value ? styles.operationButtonActive : ''}`} onClick={() => selectOperation(value)} aria-pressed={operation === value}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className={styles.operationGuide} role="note" aria-live="polite">
        <div className={styles.operationGuideTitle}>
          <span>{selectedMeta.submitLabel}</span>
          <span className={styles.operationGuideMode}>{operation === 'to-video' ? '整图首帧' : operation === 'outpaint' ? '新画布预览' : selectedMeta.maskHint ? '可选蒙版' : '当前图片'}</span>
        </div>
        <p>{selectedMeta.guide}</p>
        {selectedMeta.maskHint && <p className={styles.operationGuideHint}>{selectedMeta.maskHint}</p>}
      </div>

      {editorModelChoices.length > 0 && <div className={styles.editorSettingsBar} aria-label="改图参数">
        <label className={styles.editorSettingField}>
          <span>模型</span>
          <span className={styles.editorSettingControl}>
            {selectedEditorModel?.icon && <span className={styles.editorSettingIcon}>{selectedEditorModel.icon}</span>}
            <select value={selectedEditorModel?.id ?? selectedEditorModelId} onChange={(event) => editorCapability === 'video' ? setEditorVideoModelId(event.target.value) : setEditorModelId(event.target.value)} aria-label="改图模型">
              {editorModelChoices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </span>
        </label>
        {(editorCapability === 'image' || selectedEditorModel?.resolutions?.length) && <label className={styles.editorSettingField}>
          <span>清晰度</span>
          <select value={editorResolution} onChange={(event) => setEditorResolution(event.target.value)} aria-label="改图清晰度">
            {editorResolutionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>}
        <label className={styles.editorSettingField}>
          <span>{editorCapability === 'video' ? '视频清晰度' : '图片质量'}</span>
          <select value={activeEditorQuality} onChange={(event) => setActiveEditorQuality(event.target.value)} aria-label={editorCapability === 'video' ? '视频清晰度' : '改图图片质量'}>
            {editorQualityOptions.map((item) => <option key={item} value={item}>{selectedEditorModel?.qualityLabels?.[item] || (item === 'auto' ? '自动' : item)}</option>)}
          </select>
        </label>
      </div>}

      {operation === 'outpaint' && <div className={styles.outpaintRatioBar} role="radiogroup" aria-label="扩图比例">
        <span className={styles.outpaintRatioLabel}>扩图比例</span>
        <div className={styles.outpaintRatioOptions}>
          {editorOutpaintRatioOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.outpaintRatioButton} ${outpaintRatio === option.value ? styles.outpaintRatioButtonActive : ''}`}
              onClick={() => setOutpaintRatio(option.value)}
              role="radio"
              aria-checked={outpaintRatio === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>}

      <div className={styles.workspace}>
        <section ref={stageRef} className={styles.stage} aria-label="图片编辑画布" onWheel={handleWheel}>
          {!imageSrc ? <p className={styles.stageEmpty}>暂无图片</p> : (
            <div className={`${styles.mediaFrame} ${operation === 'outpaint' ? styles.outpaintMediaFrame : ''}`} style={mediaFrameStyle}>
              <img ref={imageRef} src={imageSrc} alt={alt} className={styles.image} onLoad={initializeMask} onClick={onImageClick} draggable={false} />
              <canvas
                ref={maskRef}
                className={`${styles.maskCanvas} ${operation === 'outpaint' ? styles.outpaintMaskCanvas : ''} ${!showMarkers ? styles.maskCanvasHidden : ''} ${tool === 'rect' ? styles.maskCanvasRect : tool === 'move' ? styles.maskCanvasMove : styles.maskCanvasBrush}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                aria-label="编辑蒙版"
              />
              {operation !== 'outpaint' && showMarkers && maskRegions.length > 0 && <div className={styles.regionMarkers} aria-label="标记区域编号">
                {maskRegions.map((region) => (
                  <span key={region.id} className={styles.regionMarkerGroup} style={{ left: `${(region.x / Math.max(1, maskRef.current?.width || 1)) * 100}%`, top: `${(region.y / Math.max(1, maskRef.current?.height || 1)) * 100}%` }}>
                    <button
                      type="button"
                      className={styles.regionMarker}
                      onClick={() => openRegionEditor(region.id, region.prompt ?? '')}
                      aria-label={`编辑区域 ${region.id}`}
                      title={region.prompt ? `区域 ${region.id}：${region.prompt}` : `编辑区域 ${region.id}`}
                    >{region.id}</button>
                  </span>
                ))}
              </div>}
              {operation !== 'outpaint' && maskStyle && <span className={styles.draftRect} style={maskStyle} aria-hidden="true" />}
            </div>
          )}
          {operation !== 'outpaint' && regionComposerPosition && <div className={styles.regionComposerLayer} style={{ left: regionComposerPosition.left, top: regionComposerPosition.top, width: regionComposerPosition.width }}>
            <span className={`${styles.regionComposer} ${closingRegionId === editingRegionId ? styles.regionComposerClosing : ''}`} role="group" aria-label={`编辑区域 ${editingRegionId}`}>
              <span className={styles.regionComposerPrefix} aria-hidden="true">＋</span>
              {editingRegion?.referenceImageDataUrl && <span className={styles.regionReferencePreviewWrap}>
                <img className={styles.regionReferencePreview} src={editingRegion.referenceImageDataUrl} alt="已上传区域参考图" />
                <button
                  type="button"
                  className={styles.regionReferenceRemove}
                  onClick={() => removeRegionReference(editingRegion.id)}
                  aria-label={`删除区域 ${editingRegion.id} 的参考图`}
                  title="删除参考图"
                ><X aria-hidden="true" /></button>
              </span>}
              <input
                autoFocus
                value={editingRegionPrompt}
                onChange={(event) => setEditingRegionPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    confirmRegionPrompt()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeRegionEditor(true)
                  }
                }}
                placeholder="添加标记..."
                aria-label={`区域 ${editingRegionId} 的修改说明`}
              />
              <label className={styles.regionUploadButton} title="上传区域参考图">
                <ImagePlus aria-hidden="true" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (editingRegionId !== null) void handleRegionReferenceUpload(editingRegionId, file)
                  }}
                  aria-label="上传区域参考图"
                />
              </label>
              <button type="button" onClick={() => confirmRegionPrompt()} aria-label={`确认区域 ${editingRegionId}`} title="确认"><CornerDownLeft aria-hidden="true" /></button>
            </span>
          </div>}
          <div ref={toolbarRef} className={`${styles.floatingTools} ${toolbarDragging ? styles.floatingToolsDragging : ''}`} style={toolbarStyle} role="toolbar" aria-label="编辑工具">
            <span
              className={styles.toolbarHandle}
              role="button"
              tabIndex={0}
              aria-label="拖动工具栏"
              title="拖动工具栏"
              onPointerDown={handleToolbarPointerDown}
              onPointerMove={handleToolbarPointerMove}
              onPointerUp={handleToolbarPointerUp}
              onPointerCancel={handleToolbarPointerUp}
            ><GripVertical aria-hidden="true" /></span>
            <button type="button" className={`${styles.toolButton} ${tool === 'brush' ? styles.toolButtonActive : ''}`} onClick={() => setTool('brush')} aria-pressed={tool === 'brush'} aria-label="画笔" title="画笔"><Paintbrush aria-hidden="true" /></button>
            <button type="button" className={`${styles.toolButton} ${tool === 'eraser' ? styles.toolButtonActive : ''}`} onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'} aria-label="橡皮擦" title="橡皮擦"><Eraser aria-hidden="true" /></button>
            <button type="button" className={`${styles.toolButton} ${tool === 'move' ? styles.toolButtonActive : ''}`} onClick={() => setTool('move')} aria-pressed={tool === 'move'} aria-label="移动预览" title="移动预览"><MousePointer2 aria-hidden="true" /></button>
            <span className={styles.toolDivider} aria-hidden="true" />
            <button type="button" className={styles.iconButton} onClick={undo} disabled={!canUndo} aria-label="撤销" title="撤销"><Undo2 aria-hidden="true" /></button>
            <button type="button" className={styles.iconButton} onClick={redo} disabled={!canRedo} aria-label="重做" title="重做"><Redo2 aria-hidden="true" /></button>
            {operation !== 'outpaint' && <button type="button" className={`${styles.cancelDrawButton} ${styles.iconButton}`} onClick={clearMask} disabled={!hasMask} aria-label="取消绘制" title="取消绘制"><X aria-hidden="true" /><span>取消绘制</span></button>}
            <span className={styles.toolDivider} aria-hidden="true" />
            <label className={styles.sizeControl} title="画笔大小"><Minus aria-hidden="true" /><input type="range" min="4" max="160" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="画笔大小" /><span>{brushSize}px</span></label>
            <input type="color" className={styles.colorControl} value={brushColor} onChange={(event) => setBrushColor(event.target.value)} aria-label="标记颜色" title="标记颜色" />
            <span className={styles.toolDivider} aria-hidden="true" />
            <span className={styles.zoomControl} aria-label="画布缩放" title="滚轮缩放；空格+左键或中键拖动平移">
              <button type="button" className={styles.iconButton} onClick={() => adjustZoom(zoom - 0.1)} disabled={zoom <= 0.5} aria-label="缩小" title="缩小"><ZoomOut aria-hidden="true" /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" className={styles.iconButton} onClick={() => adjustZoom(zoom + 0.1)} disabled={zoom >= 5} aria-label="放大" title="放大"><ZoomIn aria-hidden="true" /></button>
              <button type="button" className={styles.iconButton} onClick={resetView} disabled={zoom === 1 && pan.x === 0 && pan.y === 0} aria-label="重置视图" title="重置视图"><Maximize2 aria-hidden="true" /></button>
            </span>
            <span className={styles.panHint}>空格+拖动平移</span>
            {operation !== 'outpaint' && <button type="button" className={`${styles.iconButton} ${!showMarkers ? styles.toolButtonActive : ''}`} onClick={() => setShowMarkers((visible) => !visible)} aria-pressed={!showMarkers} aria-label={showMarkers ? '隐藏标记' : '显示标记'} title={showMarkers ? '隐藏标记' : '显示标记'}>{showMarkers ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</button>}
          </div>
        </section>

        <section className={styles.promptArea} aria-label="编辑提示词">
          <div className={styles.promptLabel}><span>{operation === 'to-video' ? '描述视频动作和镜头' : operation === 'outpaint' ? '描述要扩展的方向和内容' : '告诉 AI 要怎么改'}</span><span className={styles.promptHint}>{operation === 'to-video' ? '当前图片作为首帧' : operation === 'outpaint' ? '当前图片会置于新画布中央' : '支持自然语言描述'}</span></div>
          <textarea className={styles.promptTextarea} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={selectedMeta.placeholder} />
          {versions.length > 0 && (
            <div className={styles.versions} aria-label="图片版本">
              {versions.map((version, index) => (
                <button
                  key={version.id}
                  type="button"
                  className={`${styles.version} ${activeVersionId === version.id ? styles.versionActive : ''}`}
                  onClick={() => onVersionSelect?.(version)}
                  aria-label={`切换到${version.label ?? `版本 ${index + 1}`}`}
                  aria-pressed={activeVersionId === version.id}
                >
                  <img src={version.imageUrl} alt="" aria-hidden="true" />
                  <span className={styles.versionLabel}>{version.label ?? `版本 ${index + 1}`}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className={styles.footer}>
        <span className={styles.status} role="status">{status}</span>
        <div className={styles.footerActions}>
          <div className={styles.quickActions}>
            {operation !== 'outpaint' && <button type="button" className={`${styles.actionButton} ${styles.secondaryAction}`} onClick={clearMask} disabled={!hasMask}><Trash2 aria-hidden="true" /><span>清除标记</span></button>}
            {onSaveVersion && <button type="button" className={`${styles.actionButton} ${styles.secondaryAction}`} onClick={saveVersion} disabled={isSaving}><Save aria-hidden="true" /><span>{isSaving ? '保存中…' : '保存'}</span></button>}
          </div>
          <button type="button" className={`${styles.actionButton} ${styles.primaryAction}`} onClick={() => void submit()}><WandSparkles aria-hidden="true" /><span>{operation === 'outpaint' ? '按新尺寸生成图片' : selectedMeta.submitLabel}</span></button>
        </div>
      </footer>

      {hiddenSubmitConfirm && <div className={styles.confirmBackdrop} role="presentation">
        <div className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="hidden-markers-title">
          <div className={styles.confirmDialogHeader}>
            <strong id="hidden-markers-title">确认提交标记</strong>
            <button type="button" className={styles.iconButton} onClick={() => setHiddenSubmitConfirm(false)} aria-label="取消提交"><X aria-hidden="true" /></button>
          </div>
          <img className={styles.confirmThumbnail} src={imageSrc} alt="当前图片预览" />
          <p className={styles.confirmMessage}>已隐藏标记，但标记会一并提交。</p>
          <div className={styles.confirmActions}>
            <button type="button" className={`${styles.actionButton} ${styles.secondaryAction}`} onClick={() => setHiddenSubmitConfirm(false)}>取消</button>
            <button type="button" className={`${styles.actionButton} ${styles.primaryAction}`} onClick={() => void submit(true)}>确认提交</button>
          </div>
        </div>
      </div>}
    </aside>
  )
}

export default ImageEditorPanel
