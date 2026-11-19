'use client'

import { useUiText } from '@/lib/studio/i18n'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, FileAudio, FileText, FileVideo, Image as ImageIcon, Paperclip, Puzzle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type PromptComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmitShortcut: () => void
  files: File[]
  onFilesChange: (files: File[]) => void
  placeholder: string
  accept?: string
  maxFiles?: number
  fileError?: string
  modeHint?: string
  hideSkillsLink?: boolean
  isFileCompatible?: (file: File) => boolean
  incompatibleLabel?: string
  className?: string
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/**
 * 创作描述：工作台的主输入区。参考素材与技能库入口紧贴输入框，
 * 支持拖拽与粘贴素材，输入法组合态不会触发快捷提交。
 */
export function PromptComposer({
  value,
  onChange,
  onSubmitShortcut,
  files,
  onFilesChange,
  placeholder,
  accept,
  maxFiles = 12,
  fileError,
  modeHint,
  hideSkillsLink = false,
  isFileCompatible,
  incompatibleLabel,
  className,
}: PromptComposerProps) {
  const tx = useUiText()
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  function mergeIncoming(incoming: File[]) {
    if (!incoming.length) return
    const next = [...files]
    for (const file of incoming) {
      if (next.length >= maxFiles) break
      if (!next.some((item) => fileKey(item) === fileKey(file))) next.push(file)
    }
    onFilesChange(next)
  }

  return (
    <div
      className={cn('relative flex min-w-0 flex-col', className)}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        mergeIncoming(Array.from(event.dataTransfer.files))
      }}
      onPaste={(event) => {
        const pasted = Array.from(event.clipboardData.files)
        if (!pasted.length) return
        event.preventDefault()
        mergeIncoming(pasted)
      }}
    >
      {dragging && (
        <div
          role="status"
          className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-studio-accent bg-background/95 text-sm font-medium text-studio-accent"
        >
          {tx('松开添加参考素材')}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <label htmlFor="home-prompt" className="text-sm font-semibold text-foreground">{tx('创作描述')}</label>
        <p className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{tx('Ctrl/⌘ + Enter 开始创作')}</span>
          <span className="tabular-nums">{value.length} {tx('字')}</span>
        </p>
      </div>
      <textarea
        id="home-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            onSubmitShortcut()
          }
        }}
        placeholder={placeholder}
        rows={5}
        className="mt-2.5 block min-h-[152px] w-full resize-y bg-transparent px-5 pb-3 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground lg:min-h-[196px]"
      />
      {fileError && (
        <p role="alert" className="mx-5 mb-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-1.5 text-xs leading-5 text-destructive">
          {fileError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-border px-4 py-3">
        <ReferenceMaterials
          files={files}
          onFilesChange={onFilesChange}
          accept={accept}
          maxFiles={maxFiles}
          isFileCompatible={isFileCompatible}
          incompatibleLabel={incompatibleLabel}
        />
        <div className="flex flex-wrap items-center gap-3">
          {modeHint && <span className="text-xs text-muted-foreground">{modeHint}</span>}
          {!hideSkillsLink && (
            <Link
              href="/skills"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <Puzzle className="size-3.5" aria-hidden="true" />
              {tx('技能中心')}<span className="sr-only">{tx('（在新标签页打开）')}</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

type ReferenceMaterialsProps = {
  files: File[]
  onFilesChange: (files: File[]) => void
  accept?: string
  maxFiles?: number
  isFileCompatible?: (file: File) => boolean
  incompatibleLabel?: string
}

/** 参考素材展示缩略图与移除按钮，追加新文件或移除单个文件无需重选整批。 */
export function ReferenceMaterials({
  files,
  onFilesChange,
  accept,
  maxFiles = 12,
  isFileCompatible,
  incompatibleLabel,
}: ReferenceMaterialsProps) {
  const tx = useUiText()
  const inputRef = useRef<HTMLInputElement>(null)

  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
    const next = new Map<string, string>()
    const created: string[] = []
    for (const file of files) {
      if (file.type.startsWith('image/') && typeof Blob !== 'undefined' && file instanceof Blob) {
        const url = URL.createObjectURL(file)
        next.set(fileKey(file), url)
        created.push(url)
      }
    }
    setPreviewUrls(next)
    return () => {
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [files])

  function addFiles(incoming: File[]) {
    if (!incoming.length) return
    const next = [...files]
    for (const file of incoming) {
      if (next.length >= maxFiles) break
      if (!next.some((item) => fileKey(item) === fileKey(file))) next.push(file)
    }
    onFilesChange(next)
  }

  return (
    <div role="group" aria-label={tx('参考素材')} className="flex min-w-0 flex-wrap items-center gap-2">
      {files.map((file) => {
        const key = fileKey(file)
        const isImage = file.type.startsWith('image/')
        const url = previewUrls.get(key) || ''
        const compatible = isFileCompatible ? isFileCompatible(file) : true
        const Icon = file.type.startsWith('video/') ? FileVideo : file.type.startsWith('audio/') ? FileAudio : isImage ? ImageIcon : FileText
        return (
          <span
            key={key}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-lg border py-1 pl-1.5 pr-1 text-xs',
              compatible ? 'border-border bg-card text-foreground' : 'border-dashed border-border/80 bg-muted/40 text-muted-foreground',
            )}
          >
            {url ? (
              <img src={url} alt="" className={cn('size-6 shrink-0 rounded object-cover', !compatible && 'opacity-50')} />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
            )}
            <span className="max-w-36 truncate">{file.name}</span>
            {!compatible && incompatibleLabel && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{incompatibleLabel}</span>
            )}
            <button
              type="button"
              aria-label={tx('移除参考 {0}', [file.name])}
              onClick={() => onFilesChange(files.filter((item) => item !== file))}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        )
      })}
      <button
        type="button"
        disabled={files.length >= maxFiles}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip className="size-3.5" aria-hidden="true" />
        {files.length ? tx('继续添加 ({0}/{1})', [files.length, maxFiles]) : tx('添加参考素材')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
    </div>
  )
}

type InspirationScene = { title: string; description: string; src: string; tag: string }

type InspirationShortcutsProps<T extends InspirationScene> = {
  scenes: readonly T[]
  onSelect: (scene: T) => void
  className?: string
}

/** 灵感模板：16:9 缩略图、类型标签与「继续创作」入口。选择后把描述填入输入区并切换模式。 */
export function InspirationShortcuts<T extends InspirationScene>({ scenes, onSelect, className }: InspirationShortcutsProps<T>) {
  const tx = useUiText()
  return (
    <section aria-labelledby="inspiration-title" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="min-w-0">
        <h2 id="inspiration-title" className="text-sm font-semibold text-foreground">{tx('灵感模板')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{tx('选择模板后，描述会填入上方输入区，并切换到对应的创作模式。')}</p>
      </div>
      <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:snap-none md:grid-cols-3 md:overflow-visible">
        {scenes.map((scene) => (
          <li key={scene.title} className="w-[78%] shrink-0 snap-start sm:w-[46%] md:w-auto md:min-w-0">
            <article className="studio-surface flex h-full flex-col overflow-hidden">
              <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                <Image src={scene.src} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
                <span className="absolute left-3 top-3 rounded-md bg-background px-2 py-0.5 text-xs font-medium text-foreground">{scene.tag}</span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{scene.title}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{scene.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(scene)}
                  className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  {tx('继续创作')}<ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
