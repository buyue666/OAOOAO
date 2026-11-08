'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FolderOpen, ImageIcon, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '../canvas-store'
import { NODE_SIZE } from '../node-factory'
import type { MediaFlowNode, NodeReference } from '../types'
import { NodeAnchors, NodeHandles, TitleEditor } from './node-kit'

export const MediaNode = memo(function MediaNode({ id, data, selected }: NodeProps<MediaFlowNode>) {
  const setAssetPanel = useCanvasStore((store) => store.setAssetPanel)
  const readOnly = useCanvasStore(store => store.workspace?.readOnly ?? false)
  const media = data.media
  const kindLabel = data.kind === 'asset' ? '资产' : '参考素材'

  return (
    <div className="group relative" style={{ width: NODE_SIZE.media.width }} data-selected={selected} data-node-kind={data.kind}>
      <NodeHandles />
      <NodeAnchors nodeId={id} />
      <article
        className={cn(
          'flex flex-col gap-2.5 rounded-2xl border bg-card p-2.5 text-foreground shadow-md transition-colors',
          selected ? 'border-primary' : 'border-border hover:border-primary/40',
        )}
      >
        <header className="flex items-center gap-2 px-0.5">
          <span className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{kindLabel}</span>
        </header>
        {media ? <MediaPreview media={media} onOpenEditor={media.mediaKind === 'image' ? () => useCanvasStore.getState().openImageEditor({ nodeId: id, source: 'media', url: media.url, title: media.title }) : undefined} /> : <EmptyMedia onPick={() => setAssetPanel(true, id)} />}
        <div className="flex items-center gap-2 px-0.5">
          <TitleEditor nodeId={id} title={data.title || media?.title || kindLabel} className="text-xs text-foreground" />
        </div>
        {media && !readOnly ? (
          <button type="button" onClick={() => setAssetPanel(true, id)} className="nodrag flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border text-xs text-foreground transition-colors hover:bg-muted">
            <FolderOpen className="size-3.5" aria-hidden="true" />
            替换素材
          </button>
        ) : null}
      </article>
    </div>
  )
})

function MediaPreview({ media, onOpenEditor }: { media: NodeReference; onOpenEditor?: () => void }) {
  if (media.mediaKind === 'image') {
    return <button type="button" onClick={onOpenEditor} aria-label={`预览${media.title}`} title="打开图片" className="nodrag block w-full cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><img src={media.url} alt={media.title} loading="lazy" decoding="async" draggable={false} className="block aspect-square w-full rounded-xl bg-muted object-contain" /></button>
  }
  if (media.mediaKind === 'video') {
    return <video src={media.url} controls controlsList="nodownload" playsInline preload="metadata" aria-label={media.title} className="nowheel nodrag block aspect-video w-full rounded-xl bg-background" />
  }
  return <audio src={media.url} controls preload="none" aria-label={media.title} className="nowheel nodrag w-full" />
}

function EmptyMedia({ onPick }: { onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="nodrag flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
    >
      <span className="flex items-center gap-2">
        <ImageIcon className="size-4" aria-hidden="true" />
        <Video className="size-4" aria-hidden="true" />
      </span>
      <span className="text-xs">从资产库选择或上传</span>
    </button>
  )
}
