'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { GroupFlowNode } from '../types'
import { TitleEditor } from './node-kit'

export const GroupNode = memo(function GroupNode({ id, data, selected, width, height }: NodeProps<GroupFlowNode>) {
  return (
    <div
      data-node-kind="group"
      data-selected={selected}
      className={cn('rounded-3xl border border-dashed bg-white/[0.02] transition-colors', selected ? 'border-white/70' : 'border-white/20')}
      style={{ width, height }}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="shrink-0 text-[11px] tracking-[0.14em] text-neutral-500 uppercase">分组</span>
        <TitleEditor nodeId={id} title={data.title} className="text-xs text-neutral-300" />
      </div>
    </div>
  )
})
