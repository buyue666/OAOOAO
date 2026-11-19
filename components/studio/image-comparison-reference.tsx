'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Columns2, Library, Maximize2, Upload, X } from 'lucide-react'
import { useUiText } from '@/lib/studio/i18n'
import { ControlButton, IconAction, MediaThumb, Modal } from './ui'
import { ReferencePicker } from './workspace-kit'

type ComparisonImage = { id: string; title: string; src: string; source: 'library' | 'upload' }
type LibraryProps = Omit<Parameters<typeof ReferencePicker>[0], 'selectedIds' | 'onToggle' | 'maxReferences' | 'replaceSelection'>

/** Preview references never become generation inputs or change the selected result. */
export function useImageComparisonReference(ownerId: string) {
  const [selection, setSelection] = useState<{ ownerId: string; image: ComparisonImage } | null>(null)
  const image = selection?.ownerId === ownerId ? selection.image : null
  useEffect(() => { setSelection(current => current?.ownerId === ownerId ? current : null) }, [ownerId])
  useEffect(() => () => {
    if (selection?.image.source === 'upload') URL.revokeObjectURL(selection.image.src)
  }, [selection])
  const change = useCallback((next: ComparisonImage | null) => setSelection(next ? { ownerId, image: next } : null), [ownerId])
  return [image, change] as const
}

export function ImageComparisonReference({ image, onChange, library, fallback }: {
  image: ComparisonImage | null
  onChange: (image: ComparisonImage | null) => void
  library: LibraryProps
  fallback?: ReactNode
}) {
  const tx = useUiText()
  const input = useRef<HTMLInputElement>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [error, setError] = useState('')

  function upload(file?: File) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'].includes(file.type)) {
      setError(tx('请选择 PNG、JPG、WEBP、GIF、AVIF 或 BMP 图片。'))
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setError(tx('对比参考图不能超过 12 MB。'))
      return
    }
    const src = URL.createObjectURL(file)
    onChange({ id: src, title: file.name, src, source: 'upload' })
    setError('')
  }

  return (
    <section aria-label={tx('对比参考图')} className="flex min-h-64 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card/45" data-testid="image-comparison-reference">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={image?.title}>
          {tx(image ? 'B · 对比参考图' : 'B · 对比图片')}
          {image && <span className="ml-2 text-muted-foreground">{image.title}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <ControlButton type="button" variant="secondary" size="sm" onClick={() => setLibraryOpen(true)}><Library className="size-3.5" aria-hidden="true" />{tx('从素材库选择')}</ControlButton>
          <ControlButton type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}><Upload className="size-3.5" aria-hidden="true" />{tx('上传参考图')}</ControlButton>
          {image && <IconAction label={tx('移除对比参考图')} onClick={() => { onChange(null); setError(''); setPreviewOpen(false) }}><X className="size-4" aria-hidden="true" /></IconAction>}
        </div>
        <input ref={input} className="sr-only" tabIndex={-1} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" aria-label={tx('上传对比参考图')} onChange={event => { upload(event.target.files?.[0]); event.target.value = '' }} />
      </div>
      {error && <p role="alert" className="px-3 py-2 text-xs leading-5 text-studio-warn">{error}</p>}
      <div className="relative min-h-0 flex-1">
        {image ? (
          <button type="button" onClick={() => setPreviewOpen(true)} aria-label={tx('放大对比参考图')} className="group relative flex size-full min-h-56 items-center justify-center bg-studio-workspace focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-studio-accent">
            <MediaThumb src={image.src} alt={image.title} kind="image" fallback={tx('参考图加载失败，请替换图片。')} className="absolute inset-0 size-full [&_img]:object-contain" />
            <span className="absolute bottom-3 right-3 rounded-md bg-studio-ink/80 p-2 text-studio-ink-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Maximize2 className="size-4" aria-hidden="true" /></span>
          </button>
        ) : fallback || (
          <div className="flex size-full min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
            <Columns2 className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">{tx('添加一张对比参考图')}</p>
            <p className="max-w-64 text-xs leading-6 text-muted-foreground">{tx('从素材库选择或上传图片，与当前生成结果并排对比。')}</p>
          </div>
        )}
      </div>
      <Modal open={libraryOpen} title={tx('选择对比参考图')} description={tx('选择一张图片用于对比，不会修改生成参数。')} onClose={() => setLibraryOpen(false)} className="sm:max-w-3xl">
        <ReferencePicker {...library} maxReferences={1} replaceSelection selectedIds={image?.source === 'library' ? [image.id] : []} onToggle={(_, asset) => {
          if (!asset.src || !['image', 'scene'].includes(asset.kind)) return
          onChange({ id: asset.id, title: asset.title, src: asset.src, source: 'library' })
          setError(''); setLibraryOpen(false)
        }} />
      </Modal>
      <Modal open={previewOpen && Boolean(image)} title={tx('预览对比参考图')} description={image?.title} onClose={() => setPreviewOpen(false)} className="sm:max-w-5xl">
        {image && <MediaThumb src={image.src} alt={image.title} kind="image" fallback={tx('参考图加载失败，请替换图片。')} className="h-[70dvh] w-full bg-studio-workspace [&_img]:object-contain" />}
      </Modal>
    </section>
  )
}
