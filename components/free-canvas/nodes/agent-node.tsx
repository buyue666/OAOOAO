'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Bot, CheckCircle2, CircleDashed, Loader2, Sparkles, Square, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasActions } from '../canvas-context'
import { useCanvasStore } from '../canvas-store'
import { NODE_SIZE } from '../node-factory'
import { isAgentRunTerminal } from '../use-agent-actions'
import type { AgentFlowNode, AgentStep } from '../types'
import { NodeAnchors, NodeHandles } from './node-kit'

const RUN_STATUS_LABEL: Record<string, string> = {
  planning: '规划中',
  awaiting_approval: '等待确认',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const STEP_STATUS_LABEL: Record<string, string> = {
  pending: '等待',
  queued: '排队',
  running: '执行中',
  processing: '执行中',
  completed: '完成',
  success: '完成',
  failed: '失败',
  error: '失败',
  cancelled: '已取消',
}

export const AgentNode = memo(function AgentNode({ id, data, selected }: NodeProps<AgentFlowNode>) {
  const actions = useCanvasActions()
  const updateNodeData = useCanvasStore((store) => store.updateNodeData)
  const running = data.runStatus === 'planning' || data.runStatus === 'running' || data.runStatus === 'paused' || data.runStatus === 'awaiting_approval'
    || (Boolean(data.runId) && !isAgentRunTerminal(data.runStatus))
  const canRun = data.prompt.trim().length > 0 && !running

  return (
    <div className="group relative" style={{ width: NODE_SIZE.agent.width }} data-selected={selected} data-node-kind="agent">
      <NodeHandles />
      <NodeAnchors nodeId={id} />
      <article
        className={cn(
          'flex flex-col gap-3 rounded-2xl border bg-neutral-950 p-3 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] transition-colors',
          selected ? 'border-white' : 'border-white/15 hover:border-white/35',
        )}
      >
        <header className="flex items-center gap-2">
          <Bot className="size-4 text-neutral-400" aria-hidden="true" />
          <h3 className="text-sm font-medium">OAO Agent</h3>
          {data.runStatus ? (
            <span className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300" aria-live="polite">
              {RUN_STATUS_LABEL[data.runStatus] ?? data.runStatus}
            </span>
          ) : null}
        </header>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] tracking-[0.12em] text-neutral-500 uppercase">读取的画布对象</span>
          {data.context.length ? (
            <ul className="flex flex-wrap gap-1">
              {data.context.slice(0, 6).map((title, index) => (
                <li key={`${title}-${index}`} className="max-w-full truncate rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-neutral-300">{title}</li>
              ))}
              {data.context.length > 6 ? <li className="px-1 text-[11px] text-neutral-500">+{data.context.length - 6}</li> : null}
            </ul>
          ) : (
            <p className="text-[11px] text-neutral-500">运行时读取当前画布的节点、素材、提示词与连线。</p>
          )}
        </div>

        <div className="nodrag nowheel flex flex-col gap-2.5 rounded-xl border border-white/10 bg-black p-2.5 focus-within:border-white/50">
          <textarea
            value={data.prompt}
            rows={2}
            aria-label="Agent 指令"
            placeholder="告诉 Agent 要在这张画布上完成什么"
            disabled={running}
            onChange={(event) => updateNodeData(id, { prompt: event.target.value })}
            className="nodrag nowheel min-h-11 w-full resize-none bg-transparent text-sm leading-relaxed text-white placeholder:text-neutral-600 focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-end gap-1.5">
            {running && data.runId ? (
              <button type="button" onClick={() => void actions.cancelAgent(id)} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs text-white hover:bg-white/10">
                <Square className="size-3 fill-current" aria-hidden="true" />
                取消运行
              </button>
            ) : null}
            {data.runStatus === 'awaiting_approval' ? (
              <button type="button" onClick={() => void actions.approveAgent(id)} className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-black hover:bg-neutral-200">
                确认执行
              </button>
            ) : null}
            {!running ? (
              <button type="button" onClick={() => void actions.startAgent(id)} disabled={!canRun} className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-40">
                <Sparkles className="size-3.5" aria-hidden="true" />
                运行
              </button>
            ) : (
              <span className="flex h-8 items-center gap-1.5 text-xs text-neutral-400">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                运行中
                {data.runId ? (
                  <button type="button" onClick={() => actions.refreshAgent(id)} className="ml-1 h-7 rounded-md px-2 text-white hover:bg-white/10">
                    刷新进度
                  </button>
                ) : null}
              </span>
            )}
          </div>
        </div>

        {data.steps.length ? (
          <ul aria-label="执行步骤" className="flex flex-col gap-1.5">
            {data.steps.map((step) => <StepRow key={step.id} step={step} />)}
          </ul>
        ) : null}

        {data.failure ? (
          <p role="alert" className="rounded-lg border border-white/20 px-2.5 py-2 text-xs leading-relaxed text-neutral-200">{data.failure}</p>
        ) : null}

        {data.pointsCost !== null && data.runStatus ? (
          <p className="text-[11px] text-neutral-500">本次运行消耗 {data.pointsCost} 积分</p>
        ) : null}
      </article>
    </div>
  )
})

function StepRow({ step }: { step: AgentStep }) {
  const done = step.status === 'completed' || step.status === 'success'
  const failed = step.status === 'failed' || step.status === 'error'
  const Icon = done ? CheckCircle2 : failed ? XCircle : step.status === 'running' || step.status === 'processing' ? Loader2 : CircleDashed
  return (
    <li className="flex items-center gap-2 text-xs">
      <Icon className={cn('size-3.5 shrink-0 text-neutral-400', (step.status === 'running' || step.status === 'processing') && 'animate-spin')} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-neutral-200">{step.title}</span>
      <span className="shrink-0 text-[11px] text-neutral-500">{STEP_STATUS_LABEL[step.status] ?? step.status}</span>
    </li>
  )
}
