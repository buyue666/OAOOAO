'use client'

import { createContext, useContext, type MouseEvent as ReactMouseEvent } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Image as ImageIcon, Plus, Sparkles, Type, Video } from 'lucide-react'
import type { CanvasNodeData } from '@/lib/studio/types'
import { cn } from '@/lib/utils'
import { MediaThumb } from './ui'

export type CanvasNodeExpandDirection = 'before' | 'after'

export type CanvasNodeActions = {
  onExpand: (nodeId: string, direction: CanvasNodeExpandDirection, event: ReactMouseEvent<HTMLButtonElement>) => void
}

export const CanvasNodeActionsContext = createContext<CanvasNodeActions | null>(null)

export function CanvasNode({ id, data, selected }: NodeProps<Node<CanvasNodeData>>) {
  const actions = useContext(CanvasNodeActionsContext)
  const icon = data.kind === 'image' ? <ImageIcon className="size-3.5" aria-hidden="true" /> : data.kind === 'video' ? <Video className="size-3.5" aria-hidden="true" /> : data.kind === 'task' ? <Sparkles className="size-3.5" aria-hidden="true" /> : <Type className="size-3.5" aria-hidden="true" />
  const typeLabel = data.kind === 'image' ? '图片' : data.kind === 'video' ? '视频' : data.kind === 'task' ? 'Agent' : '文字'
  const assetLabel = data.assetCategory === 'character' ? '角色' : data.assetCategory === 'scene' ? '场景' : data.assetCategory === 'prop' ? '道具' : data.assetCategory === 'style' ? '风格' : ''
  const expand = (direction: CanvasNodeExpandDirection) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    actions?.onExpand(id, direction, event)
  }
  return (
    <div data-node-id={id} data-canvas-node-kind={data.kind} className={cn('oao-canvas-node-shell', selected && 'is-selected')}>
      {actions && <>
        <button type="button" className="oao-canvas-node-expand oao-canvas-node-expand-before" aria-label={`在${data.title}之前添加节点`} title="在前面添加节点" onClick={expand('before')}><Plus className="size-3.5" aria-hidden="true" /></button>
        <button type="button" className="oao-canvas-node-expand oao-canvas-node-expand-after" aria-label={`在${data.title}之后添加节点`} title="添加下一个节点" onClick={expand('after')}><Plus className="size-3.5" aria-hidden="true" /></button>
      </>}
      <article className="oao-canvas-node w-[286px] overflow-hidden rounded-[16px] border shadow-[0_18px_38px_rgba(0,0,0,.32)]">
        <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-[#bfeee2]" />
        <div className="oao-canvas-node-header flex items-center gap-2 border-b px-3 py-2.5">
          <span className="oao-canvas-node-icon flex size-7 shrink-0 items-center justify-center rounded-lg">{icon}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold">{data.title}</p><p className="mt-0.5 text-[10px] text-[var(--canvas-dim)]">{typeLabel}{assetLabel ? ` · ${assetLabel}` : ''}{data.model ? ` · ${data.model}` : ''}</p></div>
          {data.status && <span className="oao-canvas-node-status">{data.status}</span>}
        </div>
        {data.src ? <MediaThumb src={data.src} poster={data.poster} alt={data.title} fallback={data.title} kind={data.kind === 'video' ? 'video' : 'image'} className="h-40 rounded-none" /> : <div className={cn('oao-canvas-node-copy flex min-h-[104px] flex-col justify-between gap-3 px-3 py-3.5 text-xs leading-5', data.kind === 'task' && 'oao-canvas-node-task')}><p className="line-clamp-4">{data.content || data.prompt || data.detail}</p><span className="oao-canvas-node-hint">双击节点编辑 · 右键生成</span></div>}
        {data.src && <div className="oao-canvas-node-meta flex items-center justify-between gap-2 px-3 py-2.5"><p className="min-w-0 truncate text-[10px]">{data.detail}</p>{data.prompt && <span className="oao-canvas-node-hint shrink-0">提示词</span>}</div>}
        <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-[#bfeee2]" />
      </article>
    </div>
  )
}

export const nodeTypes = { canvas: CanvasNode }
