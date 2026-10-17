'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Eraser,
  Expand,
  GripVertical,
  Layers3,
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
  showHeader?: boolean
  /** Visual treatment for the editor surface. */
  theme?: 'dark' | 'light'
}

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type MaskRegion = { id: number; x: number; y: number }
type MaskSnapshot = { dataUrl: string; regions: MaskRegion[] }

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
    guide: '扩展画布边缘并补全画面，适合横幅、封面和社交媒体比例。',
    placeholder: '例如：向左右扩展画面，延续天空和建筑，主体保持原位',
    defaultPrompt: '向画布边缘自然扩展，延续原图的光影、色彩和透视',
    status: '已切换到扩图，描述需要扩展的方向和内容',
    submitLabel: '生成扩图',
    maskHint: '可用画笔标记需要优先补全的边缘',
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
  showHeader = true,
  theme = 'dark',
}: ImageEditorPanelProps) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const historyRef = useRef<MaskSnapshot[]>([])
  const historyIndexRef = useRef(-1)
  const drawingRef = useRef(false)
  const startPointRef = useRef<Point | null>(null)
  const nextRegionIdRef = useRef(1)
  const maskRegionsRef = useRef<MaskRegion[]>([])
  const [operation, setOperation] = useState<ImageEditOperation>(initialOperation)
  const [tool, setTool] = useState<ImageEditorTool>('brush')
  const [prompt, setPrompt] = useState(initialPrompt)
  const [brushSize, setBrushSize] = useState(initialBrushSize)
  const [brushColor, setBrushColor] = useState('#8fe9d5')
  const [maskRevision, setMaskRevision] = useState(0)
  const [maskRegions, setMaskRegions] = useState<MaskRegion[]>([])
  const [draftRect, setDraftRect] = useState<Rect | null>(null)
  const [status, setStatus] = useState(operationMeta[initialOperation].status)
  const [isSaving, setIsSaving] = useState(false)

  const hasMask = maskRevision >= 0 && historyIndexRef.current > 0
  const canUndo = historyIndexRef.current > 0
  const canRedo = historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1
  const selectedMeta = operationMeta[operation]

  const updateMaskRegions = useCallback((next: MaskRegion[]) => {
    maskRegionsRef.current = next
    setMaskRegions(next)
  }, [])

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
    historyIndexRef.current -= 1
    const snapshot = historyRef.current[historyIndexRef.current]
    const canvas = maskRef.current
    if (canvas && snapshot) restoreMaskSnapshot(canvas, snapshot.dataUrl)
    if (snapshot) {
      updateMaskRegions(snapshot.regions)
      nextRegionIdRef.current = Math.max(0, ...snapshot.regions.map((region) => region.id)) + 1
    }
    setMaskRevision((revision) => revision + 1)
  }, [canUndo, updateMaskRegions])

  const redo = useCallback(() => {
    if (!canRedo) return
    historyIndexRef.current += 1
    const snapshot = historyRef.current[historyIndexRef.current]
    const canvas = maskRef.current
    if (canvas && snapshot) restoreMaskSnapshot(canvas, snapshot.dataUrl)
    if (snapshot) {
      updateMaskRegions(snapshot.regions)
      nextRegionIdRef.current = Math.max(0, ...snapshot.regions.map((region) => region.id)) + 1
    }
    setMaskRevision((revision) => revision + 1)
  }, [canRedo, updateMaskRegions])

  const clearMask = useCallback(() => {
    const canvas = maskRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    historyRef.current = [{ dataUrl: canvas.toDataURL('image/png'), regions: [] }]
    historyIndexRef.current = 0
    nextRegionIdRef.current = 1
    updateMaskRegions([])
    setMaskRevision((revision) => revision + 1)
    setStatus('已清空标记')
  }, [updateMaskRegions])

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
    const point = pointFromEvent(event)
    if (!point || tool === 'move') return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    startPointRef.current = point
    const canvas = maskRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    if (tool === 'brush') {
      const region = { id: nextRegionIdRef.current++, x: point.x, y: point.y }
      updateMaskRegions([...maskRegionsRef.current, region])
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
  }

  const selectOperation = (next: ImageEditOperation) => {
    const previousMeta = operationMeta[operation]
    setOperation(next)
    onOperationChange?.(next)
    if (!prompt.trim() || prompt.trim() === previousMeta.defaultPrompt) {
      setPrompt(operationMeta[next].defaultPrompt)
    }
    setStatus(operationMeta[next].status)
    if (next === 'erase') setTool('eraser')
    if (next === 'inpaint' || next === 'remove-background') setTool('brush')
  }

  const submit = async () => {
    setStatus('正在提交编辑请求…')
    const canvas = maskRef.current
    const basePrompt = prompt.trim() || selectedMeta.defaultPrompt
    const regionPrompt = maskRegions.length > 0
      ? `请按照画面上的标注编号处理：${maskRegions.map((region) => `区域 ${region.id}`).join('、')}。提示词中的“区域 N”对应画面上同编号位置。`
      : ''
    const request: ImageEditRequest = {
      operation,
      prompt: [basePrompt, regionPrompt].filter(Boolean).join('\n\n'),
      maskDataUrl: canvas && hasMask ? canvas.toDataURL('image/png') : undefined,
      imageUrl: imageSrc,
      brushSize,
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
          <span className={styles.operationGuideMode}>{operation === 'to-video' ? '整图首帧' : selectedMeta.maskHint ? '可选蒙版' : '当前图片'}</span>
        </div>
        <p>{selectedMeta.guide}</p>
        {selectedMeta.maskHint && <p className={styles.operationGuideHint}>{selectedMeta.maskHint}</p>}
      </div>

      <div className={styles.workspace}>
        <section className={styles.stage} aria-label="图片编辑画布">
          {!imageSrc ? <p className={styles.stageEmpty}>暂无图片</p> : (
            <div className={styles.mediaFrame}>
              <img ref={imageRef} src={imageSrc} alt={alt} className={styles.image} onLoad={initializeMask} onClick={onImageClick} draggable={false} />
              <canvas
                ref={maskRef}
                className={`${styles.maskCanvas} ${tool === 'rect' ? styles.maskCanvasRect : tool === 'move' ? styles.maskCanvasMove : styles.maskCanvasBrush}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                aria-label="编辑蒙版"
              />
              {maskRegions.length > 0 && <div className={styles.regionMarkers} aria-label="标记区域编号">
                {maskRegions.map((region) => (
                  <span
                    key={region.id}
                    className={styles.regionMarker}
                    style={{ left: `${(region.x / Math.max(1, maskRef.current?.width || 1)) * 100}%`, top: `${(region.y / Math.max(1, maskRef.current?.height || 1)) * 100}%` }}
                  >
                    {region.id}
                  </span>
                ))}
              </div>}
              {maskStyle && <span className={styles.draftRect} style={maskStyle} aria-hidden="true" />}
            </div>
          )}
          <div className={styles.floatingTools} role="toolbar" aria-label="编辑工具">
            <span className={styles.toolbarHandle} aria-hidden="true"><GripVertical /></span>
            <button type="button" className={`${styles.toolButton} ${tool === 'brush' ? styles.toolButtonActive : ''}`} onClick={() => setTool('brush')} aria-pressed={tool === 'brush'} title="画笔"><Paintbrush aria-hidden="true" /><span>画笔</span></button>
            <button type="button" className={`${styles.toolButton} ${tool === 'eraser' ? styles.toolButtonActive : ''}`} onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'} title="橡皮擦"><Eraser aria-hidden="true" /><span>橡皮</span></button>
            <button type="button" className={`${styles.toolButton} ${tool === 'move' ? styles.toolButtonActive : ''}`} onClick={() => setTool('move')} aria-pressed={tool === 'move'} title="移动预览"><MousePointer2 aria-hidden="true" /><span>移动</span></button>
            <span className={styles.toolDivider} aria-hidden="true" />
            <button type="button" className={styles.iconButton} onClick={undo} disabled={!canUndo} aria-label="撤销" title="撤销"><Undo2 aria-hidden="true" /></button>
            <button type="button" className={styles.iconButton} onClick={redo} disabled={!canRedo} aria-label="重做" title="重做"><Redo2 aria-hidden="true" /></button>
            <button type="button" className={styles.iconButton} onClick={clearMask} disabled={!hasMask} aria-label="清空标记" title="清空标记"><Trash2 aria-hidden="true" /></button>
            <span className={styles.toolDivider} aria-hidden="true" />
            <label className={styles.sizeControl} title="画笔大小"><Minus aria-hidden="true" /><input type="range" min="4" max="160" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="画笔大小" /><span>{brushSize}px</span></label>
            <input type="color" className={styles.colorControl} value={brushColor} onChange={(event) => setBrushColor(event.target.value)} aria-label="标记颜色" title="标记颜色" />
          </div>
        </section>

        <section className={styles.promptArea} aria-label="编辑提示词">
          <div className={styles.promptLabel}><span>{operation === 'to-video' ? '描述视频动作和镜头' : '告诉 AI 要怎么改'}</span><span className={styles.promptHint}>{operation === 'to-video' ? '当前图片作为首帧' : '支持自然语言描述'}</span></div>
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
            <button type="button" className={`${styles.actionButton} ${styles.secondaryAction}`} onClick={clearMask} disabled={!hasMask}><Trash2 aria-hidden="true" /><span>清除标记</span></button>
            {onSaveVersion && <button type="button" className={`${styles.actionButton} ${styles.secondaryAction}`} onClick={saveVersion} disabled={isSaving}><Save aria-hidden="true" /><span>{isSaving ? '保存中…' : '保存'}</span></button>}
          </div>
          <button type="button" className={`${styles.actionButton} ${styles.primaryAction}`} onClick={submit}><WandSparkles aria-hidden="true" /><span>{selectedMeta.submitLabel}</span></button>
        </div>
      </footer>
    </aside>
  )
}

export default ImageEditorPanel
