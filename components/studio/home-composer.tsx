'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef } from 'react'
import { ArrowRight, Paperclip, Puzzle } from 'lucide-react'
import { cn } from '@/lib/utils'

type PromptComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmitShortcut: () => void
  files: File[]
  onFilesChange: (files: File[]) => void
  placeholder: string
  className?: string
}

/**
 * 创作描述：工作台的主输入区。参考素材与技能库入口紧贴输入框，
 * 用户不必离开输入区就能补充素材。输入法组合态不会触发快捷提交。
 */
export function PromptComposer({ value, onChange, onSubmitShortcut, files, onFilesChange, placeholder, className }: PromptComposerProps) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
        <label htmlFor="home-prompt" className="text-sm font-semibold text-foreground">创作描述</label>
        <p className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Ctrl/⌘ + Enter 开始创作</span>
          <span className="tabular-nums">{value.length} 字</span>
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
        className="mt-3 block min-h-[160px] w-full resize-y bg-transparent px-5 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground lg:min-h-[220px]"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3">
        <ReferenceMaterials files={files} onFilesChange={onFilesChange} />
        <Link
          href="/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Puzzle className="size-3.5" aria-hidden="true" />
          技能库
          <span className="sr-only">（在新标签页打开）</span>
        </Link>
      </div>
    </div>
  )
}

type ReferenceMaterialsProps = {
  files: File[]
  onFilesChange: (files: File[]) => void
}

/** 参考素材以文件标签呈现；重新选择即整批替换。 */
export function ReferenceMaterials({ files, onFilesChange }: ReferenceMaterialsProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div role="group" aria-label="参考素材" className="flex min-w-0 flex-wrap items-center gap-2">
      {files.map((file) => (
        <span key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground">
          <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{file.name}</span>
        </span>
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Paperclip className="size-3.5" aria-hidden="true" />
        {files.length ? '替换参考素材' : '添加参考图片或视频'}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
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
  return (
    <section aria-labelledby="inspiration-title" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="min-w-0">
        <h2 id="inspiration-title" className="text-sm font-semibold text-foreground">灵感模板</h2>
        <p className="mt-1 text-xs text-muted-foreground">选择模板后，描述会填入上方输入区，并切换到对应的创作模式。</p>
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
                  继续创作
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
