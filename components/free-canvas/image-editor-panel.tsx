'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Crop,
  Eraser,
  Expand,
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
}

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }

const operations: Array<{ value: ImageEditOperation; label: string; icon: typeof Sparkles }> = [
  { value: 'inpaint', label: '标记改图', icon: WandSparkles },
  { value: 'remove-background', label: '抠图', icon: Scissors },
  { value: 'erase', label: '擦除', icon: Eraser },
  { value: 'outpaint', label: '扩图', icon: Expand },
  { value: 'enhance', label: '高清修复', icon: Sparkles },
  { value: 'layers', label: '分图层', icon: Layers3 },
  { value: 'to-video', label: '转视频', icon: Video },
]

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
}: ImageEditorPanelProps) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const drawingRef = useRef(false)
  const startPointRef = useRef<Point | null>(null)
  const [operation, setOperation] = useState<ImageEditOperation>(initialOperation)
  const [tool, setTool] = useState<ImageEditorTool>('brush')
  const [prompt, setPrompt] = useState(initialPrompt)
  const [brushSize, setBrushSize] = useState(initialBrushSize)
  const [brushColor, setBrushColor] = useState('#8fe9d5')
  const [maskRevision, setMaskRevision] = useState(0)
  const [draftRect, setDraftRect] = useState<Rect | null>(null)
  const [status, setStatus] = useState('可在图片上涂抹或框选')
  const [isSaving, setIsSaving] = useState(false)

  const hasMask = maskRevision >= 0 && historyIndexRef.current > 0
  const canUndo = historyIndexRef.current > 0
  const canRedo = historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1

  const initializeMask = useCallback(() => {
    const image = imageRef.current
    const canvas = maskRef.current
    if (!image || !canvas) return
    const width = image.naturalWidth || image.clientWidth || 1
    const height = image.naturalHeight || image.clientHeight || 1
    canvas.width = width
    canvas.height = height
    const snapshot = emptyMaskSnapshot(canvas)
    historyRef.current = [snapshot]
    historyIndexRef.current = 0
    setMaskRevision((revision) => revision + 1)
    setDraftRect(null)
  }, [])

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
    nextHistory.push(snapshot)
    historyRef.current = nextHistory.slice(-30)
    historyIndexRef.current = historyRef.current.length - 1
    setMaskRevision((revision) => revision + 1)
  }, [])

  const undo = useCallback(() => {
    if (!canUndo) return
    historyIndexRef.current -= 1
    const snapshot = historyRef.current[historyIndexRef.current]
    const canvas = maskRef.current
    if (canvas && snapshot) restoreMaskSnapshot(canvas, snapshot)
    setMaskRevision((revision) => revision + 1)
  }, [canUndo])

  const redo = useCallback(() => {
    if (!canRedo) return
    historyIndexRef.current += 1
    const snapshot = historyRef.current[historyIndexRef.current]
    const canvas = maskRef.current
    if (canvas && snapshot) restoreMaskSnapshot(canvas, snapshot)
    setMaskRevision((revision) => revision + 1)
  }, [canRedo])

  const clearMask = useCallback(() => {
    const canvas = maskRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    historyRef.current = [canvas.toDataURL('image/png')]
    historyIndexRef.current = 0
    setMaskRevision((revision) => revision + 1)
    setStatus('已清空标记')
  }, [])

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
    setOperation(next)
    onOperationChange?.(next)
    if (next === 'erase') setTool('eraser')
    if (next === 'inpaint' || next === 'remove-background') setTool('brush')
  }

  const submit = async () => {
    setStatus('正在提交编辑请求…')
    const canvas = maskRef.current
    const request: ImageEditRequest = {
      operation,
      prompt: prompt.trim(),
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
    <aside className={`${styles.panel}${className ? ` ${className}` : ''}`} aria-label={title}>
      <header className={styles.header}>
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
      </header>

      <nav className={styles.operations} aria-label="图片操作">
        {operations.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" className={`${styles.operationButton} ${operation === value ? styles.operationButtonActive : ''}`} onClick={() => selectOperation(value)} aria-pressed={operation === value}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

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
              {maskStyle && <span className={styles.draftRect} style={maskStyle} aria-hidden="true" />}
            </div>
          )}
          <div className={styles.floatingTools} role="toolbar" aria-label="编辑工具">
            <button type="button" className={`${styles.toolButton} ${tool === 'brush' ? styles.toolButtonActive : ''}`} onClick={() => setTool('brush')} aria-pressed={tool === 'brush'} title="画笔"><Paintbrush aria-hidden="true" /><span>画笔</span></button>
            <button type="button" className={`${styles.toolButton} ${tool === 'eraser' ? styles.toolButtonActive : ''}`} onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'} title="橡皮擦"><Eraser aria-hidden="true" /><span>橡皮</span></button>
            <button type="button" className={`${styles.toolButton} ${tool === 'rect' ? styles.toolButtonActive : ''}`} onClick={() => setTool('rect')} aria-pressed={tool === 'rect'} title="矩形选区"><Crop aria-hidden="true" /><span>选区</span></button>
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
          <div className={styles.promptLabel}><span>告诉 AI 要怎么改</span><span className={styles.promptHint}>{operation === 'to-video' ? '将当前图片作为首帧' : '支持自然语言描述'}</span></div>
          <textarea className={styles.promptTextarea} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把圈选区域改成金色机械臂，保持原来的光影和构图" />
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
          </div>
          <button type="button" className={`${styles.actionButton} ${styles.primaryAction}`} onClick={submit}><WandSparkles aria-hidden="true" /><span>{operation === 'to-video' ? '生成视频' : '提交编辑'}</span></button>
        </div>
      </footer>
    </aside>
  )
}

export default ImageEditorPanel
