'use client'

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Image as ImageIcon, Sparkles, Type, Video } from 'lucide-react'
import type { CanvasNodeData } from '@/lib/studio/types'
import { cn } from '@/lib/utils'
import { MediaThumb } from './ui'

export function CanvasNode({ data, selected }: NodeProps<Node<CanvasNodeData>>) {
  return (
    <div data-node-id={data.title} className={cn('oao-canvas-node w-56 overflow-hidden rounded-[14px] border shadow-[0_18px_38px_rgba(0,0,0,.32)]', selected ? 'is-selected' : '')}>
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-[#bfeee2]" />
      <div className="oao-canvas-node-header flex items-center gap-2 border-b px-3 py-2">
        <span className="oao-canvas-node-icon flex size-6 items-center justify-center rounded-md">
          {data.kind === 'image' ? <ImageIcon className="size-3.5" aria-hidden="true" /> : data.kind === 'video' ? <Video className="size-3.5" aria-hidden="true" /> : data.kind === 'task' ? <Sparkles className="size-3.5" aria-hidden="true" /> : <Type className="size-3.5" aria-hidden="true" />}
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">{data.title}</p>
      </div>
      {data.src && <MediaThumb src={data.src} poster={data.poster} alt={data.title} fallback={data.title} kind={data.kind === 'video' ? 'video' : 'image'} className="h-28 rounded-none" />}
      {!data.src && <div className="oao-canvas-node-copy flex flex-col gap-3 px-3 py-4 text-xs leading-5"><p>{data.detail}</p>{data.status && <span className="oao-canvas-node-status self-start">{data.status}</span>}</div>}
      {data.src && (
        <div className="oao-canvas-node-meta flex items-center justify-between gap-2 px-3 py-2">
          <p className="truncate text-[10px]">{data.detail}</p>
          {data.status && <span className="oao-canvas-node-status">{data.status}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-[#bfeee2]" />
    </div>
  )
}

export const nodeTypes = { canvas: CanvasNode }
