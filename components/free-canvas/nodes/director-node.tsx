'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Camera, Clapperboard, ExternalLink, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasActions } from '../canvas-context'
import { NODE_SIZE } from '../node-factory'
import type { DirectorFlowNode } from '../types'
import { NodeAnchors, NodeHandles, TitleEditor } from './node-kit'

export const DirectorNode = memo(function DirectorNode({ id, data, selected }: NodeProps<DirectorFlowNode>) {
  const actions = useCanvasActions()
  const actors = data.scene.actors.length
  const cameras = data.scene.cameras.length
  const active = data.scene.cameras.find(camera => camera.id === data.scene.activeCameraId)?.name ?? '主机位'
  return (
    <div className="group relative" style={{ width: NODE_SIZE.director.width }} data-node-kind="director" data-selected={selected}>
      <NodeHandles />
      <NodeAnchors nodeId={id} />
      <article className={cn('overflow-hidden rounded-[22px] border bg-[#15171b] text-neutral-100 shadow-[0_16px_45px_rgba(0,0,0,0.32)] transition-[border-color,box-shadow]', selected ? 'border-white/65 ring-4 ring-white/[0.05]' : 'border-white/[0.14] hover:border-white/30')}>
        <header className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-300/10 text-cyan-100"><ScanLine className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><TitleEditor nodeId={id} title={data.title} className="text-sm font-semibold" /><p className="mt-0.5 text-[10px] tracking-[0.14em] text-neutral-500">3D DIRECTOR DESK</p></div>
          <span className="rounded-md bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-100">预演</span>
        </header>
        <div className="relative mx-3 mt-3 h-28 overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_50%_25%,rgba(85,166,255,.22),transparent_55%),linear-gradient(145deg,#10151c,#07090c)]">
          <div className="absolute inset-x-5 top-1/2 border-t border-dashed border-cyan-100/20" />
          <div className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100/45 bg-cyan-100/10 shadow-[0_0_32px_rgba(77,206,255,.25)]" />
          <div className="absolute bottom-2 left-3 flex items-center gap-1 text-[10px] text-neutral-400"><Camera className="size-3" />{active}</div>
          <div className="absolute right-3 bottom-2 text-[10px] text-neutral-500">{data.scene.aspect}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-3 py-3 text-[11px] text-neutral-400"><span className="flex items-center gap-1.5"><Clapperboard className="size-3.5" />{actors} 个角色</span><span className="flex items-center justify-end gap-1.5"><Camera className="size-3.5" />{cameras} 个机位</span></div>
        <div className="border-t border-white/[0.07] px-3 py-3">
          <button type="button" className="nodrag flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-100 text-xs font-medium text-neutral-950 hover:bg-white" onClick={() => actions.openDirector(id)}><ExternalLink className="size-3.5" />打开导演台</button>
        </div>
      </article>
    </div>
  )
})
