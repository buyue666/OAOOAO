'use client'

import { useUiText } from '@/lib/studio/i18n'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, FileAudio, FileText, FileVideo, Image as ImageIcon, Plus, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ComposerSlashSkill = {
  id: string
  label: string
  prompt: string
  mode?: 'agent' | 'image' | 'video'
}

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
  isFileCompatible?: (file: File) => boolean
  incompatibleLabel?: string
  slashSkills?: readonly ComposerSlashSkill[]
  onSelectSlashSkill?: (skill: ComposerSlashSkill) => void
  className?: string
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/**
 * 创作描述：参考素材卡片左置倾角叠放，紧邻无框输入区，
 * 支持拖拽、粘贴与 `/` 快捷技能唤起，输入法组合态不会误触提交。
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
  isFileCompatible,
  incompatibleLabel,
  slashSkills,
  onSelectSlashSkill,
  className,
}: PromptComposerProps) {
  const tx = useUiText()
  const [dragging, setDragging] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const dragDepth = useRef(0)
  const tileInputRef = useRef<HTMLInputElement>(null)
  const [tilePreview, setTilePreview] = useState('')

  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setTilePreview('')
      return
    }
    const firstImage = files.find((file) => file.type.startsWith('image/') && typeof Blob !== 'undefined' && file instanceof Blob)
    if (!firstImage) {
      setTilePreview('')
      return
    }
    const url = URL.createObjectURL(firstImage)
    setTilePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [files])

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
          className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[20px] border-2 border-dashed border-studio-accent bg-background/95 text-sm font-medium text-studio-accent"
        >
          {tx('松开添加参考素材')}
        </div>
      )}

      <div className="flex items-start gap-3.5 px-4 pt-4 pb-2 sm:gap-4 sm:px-5 sm:pt-5">
        <button
          type="button"
          disabled={files.length >= maxFiles}
          onClick={() => tileInputRef.current?.click()}
          aria-label={files.length ? tx('继续添加参考素材 ({0}/{1})', [files.length, maxFiles]) : tx('添加参考素材')}
          className={cn(
            'group/tile relative flex size-[70px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-2xl border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50 sm:size-[78px]',
            '-rotate-3 hover:rotate-0',
            tilePreview
              ? 'border-border/80 bg-muted shadow-sm'
              : 'border-dashed border-foreground/15 bg-foreground/[0.04] text-muted-foreground hover:border-foreground/30 hover:bg-foreground/[0.07] hover:text-foreground',
          )}
        >
          {tilePreview ? (
            <>
              <img src={tilePreview} alt="" className="size-full object-cover" />
              <span className="absolute inset-0 bg-black/25 transition-colors group-hover/tile:bg-black/40" />
              <span className="relative z-10 flex size-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                <Plus className="size-4" aria-hidden="true" />
              </span>
              {files.length > 1 && (
                <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                  {files.length}
                </span>
              )}
            </>
          ) : (
            <>
              <Plus className="size-5 transition-transform duration-150 group-hover/tile:scale-110" aria-hidden="true" />
              <span className="mt-1 text-[11px] font-medium">{files.length ? `${files.length}/${maxFiles}` : tx('上传参考')}</span>
            </>
          )}
        </button>

        <input
          ref={tileInputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            mergeIncoming(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />

        <div className="relative min-w-0 flex-1">
          <textarea
            id="home-prompt"
            aria-label={tx('创作描述')}
            value={value}
            onChange={(event) => {
              const next = event.target.value
              onChange(next)
              if (slashSkills?.length) {
                setSlashOpen(next === '/' || /(?:^|\s)\/$/.test(next))
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && slashOpen) {
                setSlashOpen(false)
                return
              }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                onSubmitShortcut()
              }
            }}
            placeholder={placeholder}
            rows={4}
            className="block min-h-[86px] w-full resize-none bg-transparent py-1 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/80 sm:min-h-[98px]"
          />

          {slashOpen && slashSkills && slashSkills.length > 0 && (
            <div
              role="listbox"
              aria-label={tx('快捷技能模板')}
              className="lg-glass-overlay motion-panel absolute left-0 top-[calc(100%+4px)] z-40 w-full max-w-[380px] rounded-2xl border border-border p-1.5 shadow-[var(--lg-shadow-4)]"
            >
              <p className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{tx('选择一个创作技能')}</p>
              {slashSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setSlashOpen(false)
                    onSelectSlashSkill?.(skill)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <Sparkles className="size-3.5 shrink-0 text-studio-accent" aria-hidden="true" />
                  <span className="truncate">/ {tx(skill.label)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="px-4 pb-2 pt-1 sm:px-5">
          <ReferenceMaterials
            files={files}
            onFilesChange={onFilesChange}
            accept={accept}
            maxFiles={maxFiles}
            isFileCompatible={isFileCompatible}
            incompatibleLabel={incompatibleLabel}
            hideAddButton
          />
        </div>
      )}

      {fileError && (
        <p role="alert" className="mx-4 mb-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs leading-5 text-destructive sm:mx-5">
          {fileError}
        </p>
      )}
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
  hideAddButton?: boolean
}

/** 参考素材展示缩略图与移除按钮，追加新文件或移除单个文件无需重选整批。 */
export function ReferenceMaterials({
  files,
  onFilesChange,
  accept,
  maxFiles = 12,
  isFileCompatible,
  incompatibleLabel,
  hideAddButton = false,
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
    <div role="group" aria-label={tx('参考素材')} className="flex min-w-0 flex-wrap items-center gap-1.5">
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
              'inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-1.5 text-xs',
              compatible ? 'border-border bg-muted/60 text-foreground' : 'border-dashed border-border/80 bg-muted/30 text-muted-foreground',
            )}
          >
            {url ? (
              <img src={url} alt="" className={cn('size-5 shrink-0 rounded-full object-cover', !compatible && 'opacity-50')} />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
                <Icon className="size-3" aria-hidden="true" />
              </span>
            )}
            <span className="max-w-32 truncate">{file.name}</span>
            {!compatible && incompatibleLabel && (
              <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{incompatibleLabel}</span>
            )}
            <button
              type="button"
              aria-label={tx('移除参考 {0}', [file.name])}
              onClick={() => onFilesChange(files.filter((item) => item !== file))}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        )
      })}
      {!hideAddButton && (
        <>
          <button
            type="button"
            disabled={files.length >= maxFiles}
            onClick={() => inputRef.current?.click()}
            className="studio-jimeng-pill disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden="true" />
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
        </>
      )}
    </div>
  )
}

type InspirationScene = { title: string; description: string; src: string; tag: string }

type InspirationShortcutsProps<T extends InspirationScene> = {
  scenes: readonly T[]
  onSelect: (scene: T) => void
  className?: string
}

/** 灵感模板：16:9 缩略图、类型标签与「继续创作」入口。 */
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
