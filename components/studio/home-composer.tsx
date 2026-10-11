'use client'

import { useRef } from 'react'
import { ArrowRight, Paperclip } from 'lucide-react'
import { MediaThumb } from './ui'

type PromptComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmitShortcut: () => void
  files: File[]
  onFilesChange: (files: File[]) => void
}

/**
 * 创作输入卡：描述与参考素材属于同一次提交，合并在一张卡片里。
 * 输入法组合态不会触发快捷提交。
 */
export function PromptComposer({ value, onChange, onSubmitShortcut, files, onFilesChange }: PromptComposerProps) {
  return (
    <section aria-labelledby="home-prompt-title" className="studio-surface flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 id="home-prompt-title" className="text-sm font-semibold text-foreground">创作描述</h2>
        <p className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">⌘/Ctrl + Enter 开始创作</span>
          <span className="tabular-nums">{value.length} 字</span>
        </p>
      </div>
      <textarea
        id="home-prompt"
        aria-labelledby="home-prompt-title"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            onSubmitShortcut()
          }
        }}
        placeholder="描述你想创作的画面、镜头或故事……"
        className="block min-h-[220px] w-full resize-y bg-transparent px-5 py-4 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="border-t border-border bg-muted/30 px-5 py-3">
        <ReferenceMaterials files={files} onFilesChange={onFilesChange} />
      </div>
    </section>
  )
}

type ReferenceMaterialsProps = {
  files: File[]
  onFilesChange: (files: File[]) => void
}

/** 参考素材紧贴描述输入，以文件标签呈现；重新选择即整批替换。 */
export function ReferenceMaterials({ files, onFilesChange }: ReferenceMaterialsProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div role="group" aria-label="参考素材" className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-medium text-muted-foreground">参考素材</span>
      {files.map((file) => (
        <span key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground">
          <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{file.name}</span>
        </span>
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Paperclip className="size-3.5" aria-hidden="true" />
        {files.length ? '替换参考' : '添加图片或视频'}
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

type InspirationScene = { title: string; description: string; src: string }

type InspirationShortcutsProps<T extends InspirationScene> = {
  scenes: readonly T[]
  onSelect: (scene: T) => void
}

/** 灵感模板：选择后自动填入描述并切换到对应模式。 */
export function InspirationShortcuts<T extends InspirationScene>({ scenes, onSelect }: InspirationShortcutsProps<T>) {
  return (
    <section aria-labelledby="inspiration-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="inspiration-title" className="text-sm font-semibold text-foreground">灵感模板</h2>
        <p className="text-xs text-muted-foreground">选择后自动填入描述并切换模式</p>
      </div>
      <ul className="grid gap-2">
        {scenes.map((scene) => (
          <li key={scene.title}>
            <button
              type="button"
              onClick={() => onSelect(scene)}
              className="group studio-surface flex w-full min-w-0 items-center gap-3 p-2.5 pr-3 text-left transition-colors duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <MediaThumb
                src={scene.src}
                alt=""
                fallback={scene.title}
                className="size-11 shrink-0 rounded-md [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-105"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{scene.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{scene.description}</span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
