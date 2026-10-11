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
  const media = data.media
  const kindLabel = data.kind === 'asset' ? '资产' : '参考素材'

  return (
    <div className="group relative" style={{ width: NODE_SIZE.media.width }} data-selected={selected} data-node-kind={data.kind}>
      <NodeHandles />
      <NodeAnchors nodeId={id} />
      <article
        className={cn(
          'flex flex-col gap-2.5 rounded-2xl border bg-neutral-950 p-2.5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.5)] transition-colors',
          selected ? 'border-white' : 'border-white/15 hover:border-white/35',
        )}
      >
        <header className="flex items-center gap-2 px-0.5">
          <span className="text-[11px] tracking-[0.14em] text-neutral-500 uppercase">{kindLabel}</span>
        </header>
        {media ? <MediaPreview media={media} /> : <EmptyMedia onPick={() => setAssetPanel(true, id)} />}
        <div className="flex items-center gap-2 px-0.5">
          <TitleEditor nodeId={id} title={media?.title ?? kindLabel} className="text-xs text-neutral-200" />
        </div>
        {media ? (
          <button type="button" onClick={() => setAssetPanel(true, id)} className="nodrag flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/15 text-xs text-neutral-200 transition-colors hover:bg-white/10">
            <FolderOpen className="size-3.5" aria-hidden="true" />
            替换素材
          </button>
        ) : null}
      </article>
    </div>
  )
})

function MediaPreview({ media }: { media: NodeReference }) {
  if (media.mediaKind === 'image') {
    return <img src={media.url} alt={media.title} loading="lazy" decoding="async" draggable={false} className="block aspect-[4/3] w-full rounded-xl bg-black object-cover" />
  }
  if (media.mediaKind === 'video') {
    return <video src={media.url} controls playsInline preload="metadata" aria-label={media.title} className="nowheel nodrag block aspect-video w-full rounded-xl bg-black" />
  }
  return <audio src={media.url} controls preload="none" aria-label={media.title} className="nowheel nodrag w-full" />
}

function EmptyMedia({ onPick }: { onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="nodrag flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 text-neutral-400 transition-colors hover:border-white/50 hover:text-white"
    >
      <span className="flex items-center gap-2">
        <ImageIcon className="size-4" aria-hidden="true" />
        <Video className="size-4" aria-hidden="true" />
      </span>
      <span className="text-xs">从资产库选择或上传</span>
    </button>
  )
}
