'use client'

import type { FormEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ControlButton, IconAction, MediaThumb, Notice, SegmentedControl, StatusBadge, Tooltip } from './ui'

/**
 * 「从素材库选择」每次展示的素材数量。
 *
 * 早先写死 `assets.slice(0, 8)`：素材库超过 8 条后，后面的素材用户**永远看不到**，
 * 也无法搜索。现在改为可搜索 + 可「加载更多」，不再静默截断。
 */
const REFERENCE_PAGE_SIZE = 8

/** 把 "16:9" 这类比例转成 CSS aspect-ratio，保证媒体区域尺寸稳定、不产生布局跳动。 */
export function ratioToCss(ratio: string) {
  const [width, height] = ratio.split(':').map((value) => Number.parseFloat(value))
  if (!width || !height) return '16 / 9'
  return `${width} / ${height}`
}

/**
 * 工作台骨架：桌面端左侧固定 320px 参数面板（可独立滚动、生成按钮常驻），
 * 右侧为自适应预览区；移动端预览优先，参数收进可折叠面板，生成按钮吸底。
 */
export function WorkspaceShell({
  params,
  stage,
  stageToolbar,
  onSubmit,
  submitLabel,
  credits,
  submitDisabled,
  notice,
  paramsTitle = '创作参数',
  paramsHint,
}: {
  params: ReactNode
  stage: ReactNode
  stageToolbar?: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  credits: number
  submitDisabled?: boolean
  notice?: ReactNode
  paramsTitle?: string
  paramsHint?: string
}) {
  const [paramsOpen, setParamsOpen] = useState(false)

  return (
    <form onSubmit={onSubmit} className="studio-workspace-shell studio-gradient-workspace mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 py-5 sm:px-5 md:gap-5 md:px-8 md:py-6 xl:h-[calc(100dvh-60px)] xl:overflow-hidden xl:[contain:paint] xl:px-10">
      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="order-2 hidden min-h-0 min-w-0 xl:order-1 xl:block">
          <div className="studio-surface flex h-full min-h-0 flex-col">

            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">{paramsTitle}</h2>
              {paramsHint && <span className="truncate text-[11px] text-muted-foreground">{paramsHint}</span>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{params}</div>
            <div className="shrink-0 border-t border-border px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">预计消耗</span>
                <span className="font-semibold tabular-nums text-studio-accent">{credits} 积分</span>
              </div>
              <ControlButton type="submit" variant="primary" size="lg" className="mt-3 w-full" disabled={submitDisabled}>
                {submitLabel}
              </ControlButton>
            </div>
          </div>
        </aside>

        <section className="order-1 min-h-0 min-w-0 overscroll-contain xl:order-2 xl:overflow-y-auto xl:pr-1">
          {stageToolbar}
          {stage}
          {notice}

          <div className="mt-4 xl:hidden">
            <button
              type="button"
              onClick={() => setParamsOpen((value) => !value)}
              aria-expanded={paramsOpen}
              aria-controls="workspace-mobile-params"
              className="studio-surface flex h-11 w-full items-center justify-between gap-3 px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60"
            >
              <span className="flex items-center gap-2">
                {paramsTitle}
                <span className="text-xs font-normal text-muted-foreground">{credits} 积分</span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', paramsOpen && 'rotate-180')} aria-hidden="true" />
            </button>
            {paramsOpen && (
              <div id="workspace-mobile-params" className="studio-surface motion-panel mt-3 p-4">
                {params}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5 xl:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground">预计消耗</p>
          <p className="text-sm font-semibold tabular-nums text-studio-accent">{credits} 积分</p>
        </div>
        <ControlButton type="submit" variant="primary" size="lg" className="min-w-0 flex-1 sm:min-w-32 sm:flex-none" disabled={submitDisabled}>
          {submitLabel}
        </ControlButton>
      </div>
    </form>
  )
}

/** 参数分组：统一 4/8px 间距与分割线，避免每个页面各写一套。 */
export function ParamSection({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-foreground">
          {title}
          {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
        </h3>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * 参数选项网格：窄参数面板里替代横向滚动的分段控制器。
 * 选中态同时用边框、底色和文字对比表达，不依赖单一颜色。
 */
export function OptionGrid({
  value,
  onChange,
  options,
  columns = 2,
  label,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string; hint?: string }>
  columns?: 2 | 3
  label?: string
}) {
  return (
    <div className={cn('grid gap-1.5', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-9 min-w-0 flex-col items-start justify-center gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60',
              selected
                ? 'border-studio-accent bg-studio-accent/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-studio-accent/40 hover:text-foreground',
            )}
          >
            <span className="w-full truncate text-xs font-medium">{option.label}</span>
            {option.hint && <span className="w-full truncate text-[10px] text-muted-foreground">{option.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}

export interface UploadItem {
  id: string
  name: string
  size: number
  preview: string
  progress: number
  status: 'uploading' | 'done' | 'failed' | 'cancelled'
  kind?: 'image' | 'video'
  dataUrl?: string
  error?: string
}

type UploadKind = 'image' | 'video'

const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const VIDEO_ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']
const IMAGE_MAX_FILE_SIZE = 12 * 1024 * 1024
const VIDEO_MAX_FILE_SIZE = 200 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('文件读取失败'))
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 参考素材上传：整块区域可拖拽、可点击选择、支持多文件与拖动排序。
 * 上传进度、失败、取消、重试、删除都在同一张缩略图网格里表达，不依赖颜色单独传达状态。
 */
export function ReferenceUploader({
  items,
  onItemsChange,
  maxFiles = 6,
  kind = 'image',
  label,
  emptyText,
  selectLabel = '选择文件',
  hint,
}: {
  items: UploadItem[]
  onItemsChange: (items: UploadItem[]) => void
  maxFiles?: number
  kind?: UploadKind
  label?: string
  emptyText?: string
  selectLabel?: string
  hint?: string
}) {
  const [dragging, setDragging] = useState(false)
  const acceptedTypes = kind === 'video' ? VIDEO_ACCEPTED_TYPES : IMAGE_ACCEPTED_TYPES
  const maxFileSize = kind === 'video' ? VIDEO_MAX_FILE_SIZE : IMAGE_MAX_FILE_SIZE
  const uploadHint = hint ?? (kind === 'video' ? 'MP4 / MOV / WEBM，单个不超过 200 MB' : 'PNG / JPG / WEBP，单个不超过 12 MB')
  const uploadEmptyText = emptyText ?? (kind === 'video' ? '拖拽视频到此处，或点击选择' : '拖拽文件到此处，或点击选择')
  const [message, setMessage] = useState<{ tone: 'warning' | 'accent'; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragIndex = useRef<number | null>(null)
  const itemsRef = useRef(items)
  const changeRef = useRef(onItemsChange)
  itemsRef.current = items
  changeRef.current = onItemsChange

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = itemsRef.current
      if (!current.some((item) => item.status === 'uploading')) return
      changeRef.current(
        current.map((item) => {
          if (item.status !== 'uploading') return item
          const next = Math.min(100, item.progress + 14 + Math.random() * 20)
          const ready = Boolean(item.dataUrl)
          return next >= 100 && ready ? { ...item, progress: 100, status: 'done' as const } : { ...item, progress: Math.min(92, next) }
        }),
      )
    }, 320)
    return () => window.clearInterval(timer)
  }, [])

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList)
    const accepted: UploadItem[] = []
    const acceptedFiles: Array<{ item: UploadItem; file: File }> = []
    const problems: string[] = []
    const existing = new Set(items.map((item) => `${item.name}:${item.size}`))
    let duplicates = 0

    for (const file of incoming) {
      const key = `${file.name}:${file.size}`
      if (existing.has(key)) {
        duplicates += 1
        continue
      }
      if (!acceptedTypes.includes(file.type)) {
        problems.push(`${file.name} 格式不支持`)
        continue
      }
      if (file.size > maxFileSize) {
        problems.push(`${file.name} 超过 ${kind === 'video' ? '200 MB' : '12 MB'}`)
        continue
      }
      if (items.length + accepted.length >= maxFiles) {
        problems.push(`最多 ${maxFiles} 个参考文件`)
        break
      }
      existing.add(key)
      const item: UploadItem = {
        id: `upload-${Date.now()}-${accepted.length}`,
        name: file.name,
        size: file.size,
        preview: URL.createObjectURL(file),
        progress: 0,
        status: 'uploading',
        kind,
      }
      accepted.push(item)
      acceptedFiles.push({ item, file })
    }

    if (accepted.length) onItemsChange([...items, ...accepted])
    if (acceptedFiles.length) {
      void Promise.all(acceptedFiles.map(async ({ item, file }) => {
        try {
          const dataUrl = await readFileAsDataUrl(file)
          changeRef.current(itemsRef.current.map((current) => current.id === item.id ? { ...current, dataUrl, progress: Math.max(current.progress, 96) } : current))
        } catch (error) {
          changeRef.current(itemsRef.current.map((current) => current.id === item.id ? { ...current, status: 'failed' as const, error: error instanceof Error ? error.message : '文件读取失败' } : current))
        }
      }))
    }

    const notes: string[] = []
    if (duplicates) notes.push(`${duplicates} 个重复文件已跳过`)
    if (problems.length) notes.push(problems.slice(0, 2).join('，'))
    if (notes.length) setMessage({ tone: 'warning', text: notes.join('；') })
    else if (accepted.length) setMessage({ tone: 'accent', text: `已添加 ${accepted.length} 个参考文件` })
    else setMessage(null)
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    onItemsChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeItem(id: string) {
    const target = items.find((item) => item.id === id)
    if (target?.preview.startsWith('blob:')) URL.revokeObjectURL(target.preview)
    onItemsChange(items.filter((item) => item.id !== id))
  }

  function reorder(from: number, to: number) {
    if (from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onItemsChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-foreground">{label}</p>
          <span className="text-[10px] text-muted-foreground">{kind === 'video' ? '视频文件' : '图片文件'}</span>
        </div>
      )}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center transition-colors duration-200',
          dragging ? 'border-studio-accent bg-studio-accent/10' : 'border-border bg-muted/40',
        )}
      >
        <span className={cn('flex size-9 items-center justify-center rounded-md transition-colors duration-200', dragging ? 'bg-studio-accent/15 text-studio-accent' : 'bg-muted text-muted-foreground')}>
          <Upload className="size-4" aria-hidden="true" />
        </span>
        <p className="text-xs font-medium text-foreground">{dragging ? '松开即可添加文件' : uploadEmptyText}</p>
        <p className="text-[11px] leading-5 text-muted-foreground">{uploadHint} · 最多 {maxFiles} 个</p>
        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles > 1}
          accept={acceptedTypes.join(',')}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files?.length) addFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <ControlButton type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          <Plus className="size-3.5" aria-hidden="true" />
          {selectLabel}
        </ControlButton>
      </div>

      {message && (
        <Notice tone={message.tone}>
          {message.tone === 'warning' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
          {message.text}
        </Notice>
      )}

      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" aria-label="已添加的参考素材">
          {items.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={() => {
                dragIndex.current = index
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (dragIndex.current !== null) reorder(dragIndex.current, index)
                dragIndex.current = null
              }}
              className="group relative min-w-0"
            >
              <div className="relative overflow-hidden rounded-md border border-border bg-muted">
                {/* 保持原始比例，不做强制裁切变形 */}
                {item.kind === 'video' ? (
                  <video
                    src={item.preview}
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={item.name}
                    className="block max-h-32 w-full object-contain"
                  />
                ) : (
                  <img src={item.preview} alt={item.name} className="block max-h-32 w-full object-contain" />
                )}
                {item.status === 'uploading' && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-studio-ink/30">
                    <div className="h-full bg-studio-accent transition-[width] duration-200 ease-out" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.status === 'failed' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-studio-ink/70 px-1 text-center">
                    <AlertTriangle className="size-3.5 text-studio-warn" aria-hidden="true" />
                    <span className="text-[10px] leading-4 text-studio-ink-foreground">上传失败</span>
                  </div>
                )}
                {item.status === 'cancelled' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-studio-ink/60 text-[10px] text-studio-ink-foreground">已取消</div>
                )}
                <span className="absolute left-1 top-1 flex size-5 items-center justify-center rounded bg-studio-ink/70 text-[10px] font-medium text-studio-ink-foreground" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                  <Tooltip label="拖动排序">
                    <span className="flex size-5 cursor-grab items-center justify-center rounded bg-studio-ink/70 text-studio-ink-foreground">
                      <GripVertical className="size-3" aria-hidden="true" />
                    </span>
                  </Tooltip>
                  <IconAction label={`删除 ${item.name}`} onClick={() => removeItem(item.id)} className="size-5 bg-studio-ink/70 text-studio-ink-foreground hover:bg-studio-ink/90 hover:text-studio-ink-foreground">
                    <Trash2 className="size-3" aria-hidden="true" />
                  </IconAction>
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] text-muted-foreground" title={item.name}>{item.name}</p>
              <p className="truncate text-[10px] text-muted-foreground/80">
                {item.status === 'uploading' ? `上传中 ${Math.round(item.progress)}%` : item.status === 'done' ? formatSize(item.size) : item.status === 'failed' ? '可重试' : '已取消'}
              </p>
              {item.status === 'uploading' && (
                <button type="button" onClick={() => updateItem(item.id, { status: 'cancelled' })} className="mt-0.5 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  取消
                </button>
              )}
              {(item.status === 'failed' || item.status === 'cancelled') && (
                <button type="button" onClick={() => updateItem(item.id, { status: 'uploading', progress: 0 })} className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-studio-accent underline-offset-2 hover:underline">
                  <RefreshCw className="size-2.5" aria-hidden="true" />
                  重试
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 素材库选择：与上传区共用同一份选中状态，支持搜索与分页，缩略图网格不出现原生横向滚动条。 */
export function ReferencePicker({
  assets,
  selectedIds,
  onToggle,
  maxReferences,
  libraryState,
  libraryMessage,
  libraryTotal,
  onReload,
  onLoadMore,
  loadingMore,
  onSearch,
  serverSearch,
}: {
  assets: Array<{ id: string; title: string; src: string; poster?: string; kind: string; fallback: string; tags?: string[] }>
  selectedIds: string[]
  /**
   * 切换选中状态。
   *
   * 回调**同时给出 id 与完整素材对象**：调用方需要在选中那一刻把
   * 素材的媒体地址快照下来（而不是事后再回候选池按 id 反查）。
   * 反查的写法会让"当前搜索结果里没有的已选素材"在提交时被静默丢弃。
   */
  onToggle: (id: string, asset: { id: string; title: string; src: string; kind: string }) => void
  maxReferences: number
  /** 素材库读取状态；区分「加载失败」与「真的没有素材」，不把失败显示成 0。 */
  libraryState?: 'idle' | 'loading' | 'ready' | 'unauthenticated' | 'error'
  libraryMessage?: string
  /** 服务端返回的素材总数：用于「加载更多」，不做「只显示前几个」的静默截断。 */
  libraryTotal?: number
  onReload?: () => void
  /** 服务端已加载的条数：本地全部展示完之后，继续按页读取。 */
  onLoadMore?: () => void
  loadingMore?: boolean
  /** 服务端搜索：关键词变化时的回调（带防抖，避免每次按键都打接口）。 */
  onSearch?: (keyword: string) => void
  /** 为 true 时按下回车把关键词交给服务端搜索。 */
  serverSearch?: boolean
}) {
  const [keyword, setKeyword] = useState('')
  const [visible, setVisible] = useState(REFERENCE_PAGE_SIZE)
  /** 缩略图加载失败的素材不渲染成占位块，直接跳过并如实计数。 */
  const [brokenIds, setBrokenIds] = useState<string[]>([])

  // 已加载的素材变多/换了一批时重置分页，避免停留在「上次加载更多」的位置。
  useEffect(() => { setVisible(REFERENCE_PAGE_SIZE) }, [assets])

  /**
   * 提交搜索（回车 / 清除按钮）。
   *
   * **此前的缺陷**：非空关键词只执行 `setKeyword(next)`，从不调用 `onSearch`；
   * 而 `serverSearch` 模式下本地过滤又被跳过（见下方 `matched`），
   * 于是「按回车」既不请求服务端、也不本地过滤 —— 实测列表条目数完全不变。
   * 「清空」分支倒是调用了 `onSearch('')`，所以只有「搜索」这一条路是断的。
   *
   * 现在：
   *  - 非空 → 交给 `onSearch`（由调用方驱动服务端 keyword 查询）；
   *  - 空   → `onSearch('')` 恢复完整列表；
   *  - 两者都重置本地分页游标，避免停在上一次的「加载更多」位置。
   */
  const submitSearch = (value: string) => {
    const next = value.trim()
    setKeyword(next)
    setVisible(REFERENCE_PAGE_SIZE)
    onSearch?.(next)
  }

  const matched = assets.filter((asset) => {
    if (brokenIds.includes(asset.id)) return false
    if (!keyword.trim() || serverSearch) return true
    const haystack = `${asset.title} ${(asset.tags ?? []).join(' ')}`.toLowerCase()
    return haystack.includes(keyword.trim().toLowerCase())
  })
  const shown = matched.slice(0, visible)
  const loading = libraryState === 'loading'
  const failed = libraryState === 'error'
  const total = Math.max(0, libraryTotal ?? assets.length)
  const hiddenLocally = matched.length - shown.length
  const hiddenOnServer = Math.max(0, total - assets.length)

  return (
    <div className="flex flex-col gap-2" data-testid="reference-picker">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground" data-testid="reference-picker-status">
          从素材库选择 · 已选 {selectedIds.length}/{maxReferences} · 可选 {shown.length}{total > shown.length ? `/${total}` : ''}
        </p>
        {onReload && (
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} aria-hidden="true" />
            刷新素材
          </button>
        )}
      </div>
      {/*
        这里**不能**用 `<form>`：ReferencePicker 渲染在 `WorkspaceShell` 的外层
        `<form onSubmit={submit}>` 内部，嵌套 form 是非法 HTML，会导致
        React 水合失败（实测报 `In HTML, <form> cannot be a descendant of <form>`
        + `Hydration failed because the server rendered HTML didn't match the client`，
        整个 /image 与 /video 子树被客户端重新生成）。
        改用等价的 div + 受控输入：回车提交、清除按钮行为与原来一致。
      */}
      <div
        role="search"
        className="flex h-8 items-center gap-2 border border-border bg-card px-2.5 text-muted-foreground focus-within:border-studio-accent/60"
      >
        <span className="sr-only">搜索素材</span>
        <input
          value={keyword}
          onChange={(event) => { setKeyword(event.target.value); if (serverSearch && !event.target.value.trim()) onSearch?.('') }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitSearch(keyword) } }}
          placeholder={serverSearch ? '按名称搜索素材，回车查询' : '按名称或标签搜索素材'}
          data-testid="reference-picker-search"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {keyword && (
          <button type="button" onClick={() => submitSearch('')} aria-label="清除搜索" className="text-muted-foreground hover:text-foreground">
            <X className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {shown.length ? (
        <div className="grid grid-cols-4 gap-2">
          {shown.map((asset) => {
            const selected = selectedIds.includes(asset.id)
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => onToggle(asset.id, { id: asset.id, title: asset.title, src: asset.src, kind: asset.kind })}
                aria-pressed={selected}
                aria-label={`${selected ? '取消选择' : '选择'} ${asset.title}`}
                title={`${asset.title}${asset.src ? ` · ${asset.src}` : ''}`}
                data-testid="reference-picker-item"
                data-asset-id={asset.id}
                data-asset-url={asset.src}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-md border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60',
                  selected ? 'border-studio-accent' : 'border-border hover:border-studio-accent/50',
                )}
              >
                <MediaThumb onLoadError={() => setBrokenIds((current) => (current.includes(asset.id) ? current : [...current, asset.id]))} src={asset.src} poster={asset.poster} kind={asset.kind === 'video' ? 'video' : 'image'} alt={asset.title} fallback={asset.fallback} className="size-full" />
                {selected && (
                  <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-studio-accent text-studio-accent-foreground">
                    <Check className="size-2.5" aria-hidden="true" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-[11px] leading-5 text-muted-foreground">
          {failed
            ? `素材库读取失败：${libraryMessage || '请稍后重试'}`
            : loading
              ? '正在读取素材库…'
              : libraryState === 'unauthenticated'
                ? '未登录：登录后可使用已上传的素材。'
                : keyword.trim()
                  ? `没有匹配「${keyword.trim()}」的素材。`
                  : '素材库里还没有图片素材。可先到「素材库」上传，或换用支持参考图的模型。'}
        </p>
      )}
      {shown.length < matched.length && (
        <button
          type="button"
          onClick={() => setVisible((current) => current + REFERENCE_PAGE_SIZE)}
          data-testid="reference-picker-more"
          className="h-8 w-full border border-border text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:border-studio-accent/50 hover:text-foreground"
        >
          加载更多（还有 {matched.length - shown.length} 条）
        </button>
      )}
      {!hiddenLocally && hiddenOnServer > 0 && onLoadMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          data-testid="reference-picker-load-more"
          className="h-8 w-full border border-border text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:border-studio-accent/50 hover:text-foreground disabled:opacity-60"
        >
          {loadingMore ? '正在读取…' : `从服务器加载更多（还有 ${hiddenOnServer} 条）`}
        </button>
      )}
    </div>
  )
}

/**
 * 结果舞台：单图 / 多结果 / 对比共用同一容器尺寸，
 * 等待、失败、完成三种状态切换时不会改变高度，避免布局跳动。
 */
export function ResultStage({
  view,
  onViewChange,
  viewOptions,
  ratio,
  status,
  statusLabel,
  onRetry,
  children,
  emptyHint,
  isEmpty,
}: {
  view: string
  onViewChange: (value: string) => void
  viewOptions: Array<{ value: string; label: string; icon?: ReactNode }>
  ratio: string
  status: 'idle' | 'queued' | 'processing' | 'failed' | 'done'
  statusLabel: string
  onRetry?: () => void
  children: ReactNode
  emptyHint: string
  isEmpty?: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge tone={status === 'failed' ? 'warning' : status === 'done' ? 'success' : status === 'idle' ? 'neutral' : 'accent'}>{statusLabel}</StatusBadge>
          <span className="truncate text-xs text-muted-foreground">输出比例 {ratio}</span>
        </div>
        <SegmentedControl value={view} onChange={onViewChange} options={viewOptions} />
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border bg-studio-workspace p-2 shadow-sm sm:p-3 md:p-4">
        <div className="relative w-full" style={{ aspectRatio: ratioToCss(ratio) }}>
          {isEmpty ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-studio-ink-line px-6 text-center">
              <ImageIcon className="size-5 text-studio-ink-muted" aria-hidden="true" />
              <p className="text-xs leading-5 text-studio-ink-muted">{emptyHint}</p>
            </div>
          ) : (
            children
          )}

          {(status === 'queued' || status === 'processing') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-studio-ink/70" aria-live="polite">
              <Loader2 className="size-5 animate-spin text-studio-accent motion-reduce:animate-none" aria-hidden="true" />
              <p className="text-xs font-medium text-studio-ink-foreground">{statusLabel}</p>
              <div className="h-1 w-40 overflow-hidden rounded-full bg-studio-ink-line">
                <div className="studio-waiting h-full w-1/3 rounded-full bg-studio-accent" />
              </div>
            </div>
          )}

          {status === 'failed' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-studio-ink/75 px-6 text-center" aria-live="polite">
              <AlertTriangle className="size-5 text-studio-warn" aria-hidden="true" />
              <p className="text-xs leading-5 text-studio-ink-foreground">{statusLabel}</p>
              {onRetry && (
                <ControlButton type="button" variant="secondary" size="sm" onClick={onRetry}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  重试
                </ControlButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 结果操作条：复用参数、送入画布、加入项目等操作紧贴结果区域。 */
export function ResultActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>
}

/** 任务队列：生成队列、进度和实际结果清晰区分。 */
export function TaskQueue({ tasks, emptyText }: { tasks: Array<{ id: string; title: string; status: string; stage: string; credits: number }>; emptyText: string }) {
  if (tasks.length === 0) return <p className="text-xs leading-5 text-muted-foreground">{emptyText}</p>
  return (
    <ul className="flex flex-col">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              task.status === 'processing' || task.status === 'queued' ? 'bg-studio-accent' : task.status === 'failed' ? 'bg-studio-warn' : 'bg-success',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{task.title}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{task.stage}</p>
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{task.credits > 0 ? `${task.credits} 积分` : '—'}</span>
        </li>
      ))}
    </ul>
  )
}

export { X as CloseIcon }
