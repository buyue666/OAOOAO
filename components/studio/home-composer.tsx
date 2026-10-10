'use client'

import { useRef } from 'react'
import { ArrowRight, Paperclip } from 'lucide-react'
import { MediaThumb } from './ui'

type PromptComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmitShortcut: () => void
}

/** 创作描述是工作台唯一的大号输入区；输入法组合态不会触发快捷提交。 */
export function PromptComposer({ value, onChange, onSubmitShortcut }: PromptComposerProps) {
  return (
    <section className="studio-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <label htmlFor="home-prompt" className="text-sm font-semibold text-foreground">创作描述</label>
        <span className="hidden text-xs text-muted-foreground sm:inline">⌘/Ctrl + Enter 直接开始</span>
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
        placeholder="描述你想创作的画面、镜头或故事……"
        className="block min-h-[200px] w-full resize-y bg-transparent px-5 py-4 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground"
      />
    </section>
  )
}

type ReferenceMaterialsProps = {
  files: File[]
  onFilesChange: (files: File[]) => void
}

/** 参考素材独立成区：文件以清单呈现，重新选择即整批替换。 */
export function ReferenceMaterials({ files, onFilesChange }: ReferenceMaterialsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openPicker = () => inputRef.current?.click()

  return (
    <section aria-labelledby="reference-title" className="studio-surface flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="reference-title" className="text-sm font-semibold text-foreground">参考素材</h2>
          <p className="mt-1 text-xs text-muted-foreground">可选。选择的文件会随创作描述一起带入工作台。</p>
        </div>
        <button
          type="button"
          onClick={openPicker}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Paperclip className="size-4" aria-hidden="true" />选择文件
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
      />

      {files.length > 0 ? (
        <ul aria-label="已添加的参考素材" className="flex flex-wrap gap-2">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground">
              <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{file.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          className="flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors duration-150 hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          点击选择参考图片或视频
        </button>
      )}
    </section>
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
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="inspiration-title" className="text-sm font-semibold text-foreground">灵感模板</h2>
        <p className="text-xs text-muted-foreground">选择后自动填入描述并切换模式</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
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
