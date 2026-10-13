'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { ArrowUp, Bot, Check, CheckCircle2, ChevronDown, ChevronUp, CircleDashed, Layers3, Loader2, Pause, Play, Puzzle, RefreshCw, Square, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStudio } from '@/lib/studio/store'
import { filterModelsByCapability } from '@/lib/studio/studio-models'
import { useCanvasActions } from '../canvas-context'
import { useCanvasStore } from '../canvas-store'
import { NODE_SIZE } from '../node-factory'
import { isAgentRunTerminal } from '../use-agent-actions'
import type { AgentFlowNode, AgentStep } from '../types'
import { NodeAnchors, NodeHandles } from './node-kit'

const RUN_STATUS_LABEL: Record<string, string> = { planning: '正在规划', awaiting_approval: '待确认计划', running: '正在执行', paused: '已暂停', unconfirmed: '提交待确认', completed: '已完成', failed: '运行失败', cancelled: '已取消' }
const STEP_STATUS_LABEL: Record<string, string> = { pending: '等待', queued: '排队', running: '执行中', processing: '执行中', completed: '完成', success: '完成', failed: '失败', error: '失败', cancelled: '已取消' }
const BUTTON = 'nodrag inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40'

export const AgentNode = memo(function AgentNode({ id, data, selected }: NodeProps<AgentFlowNode>) {
  const actions = useCanvasActions()
  const { state } = useStudio()
  const updateNodeData = useCanvasStore((store) => store.updateNodeData)
  const beginEdit = useCanvasStore((store) => store.beginEdit)
  const updateInternals = useUpdateNodeInternals()
  const actionLock = useRef(false)
  const [pendingAction, setPendingAction] = useState(false)
  const running = data.runStatus === 'planning' || data.runStatus === 'running' || (Boolean(data.runId) && !isAgentRunTerminal(data.runStatus) && data.runStatus !== 'paused' && data.runStatus !== 'awaiting_approval')
  const waiting = data.runStatus === 'paused' || data.runStatus === 'awaiting_approval'
  const deliveryPending = Boolean(data.runId) && isAgentRunTerminal(data.runStatus) && (data.deliveredRunId !== data.runId || Boolean(data.deliveryError))
  const locked = running || waiting || deliveryPending || data.runStatus === 'unconfirmed' || pendingAction
  const hasModel = filterModelsByCapability(state.models, 'text').length > 0
  const canRun = data.prompt.trim().length > 0 && !running && !waiting && !deliveryPending && !pendingAction && hasModel
  const skills = data.skills ?? []
  const completed = data.steps.filter((step) => ['completed', 'success'].includes(step.status)).length
  const collapsed = Boolean(data.collapsed)
  useEffect(() => { updateInternals(id) }, [collapsed, id, updateInternals])
  const perform = async (action: () => Promise<void>) => {
    if (actionLock.current) return
    actionLock.current = true; setPendingAction(true)
    try { await action() } finally { actionLock.current = false; setPendingAction(false) }
  }

  return (
    <div className="group relative [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-white" style={{ width: NODE_SIZE.agent.width }} data-selected={selected} data-node-kind="agent">
      <NodeHandles />
      <NodeAnchors nodeId={id} />
      <article aria-label="画布 Agent" className={cn('overflow-hidden rounded-[22px] border bg-[#15171b] text-neutral-100 shadow-[0_16px_45px_rgba(0,0,0,0.32)] transition-[border-color,box-shadow] focus-within:border-white/55', selected ? 'border-white/65 ring-4 ring-white/[0.05]' : 'border-white/[0.14] hover:border-white/30')}>
        <header className="flex items-center gap-3 px-4 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#22252b]"><Bot className="size-5 text-neutral-200" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold tracking-wide">画布助手</h3><p className="mt-0.5 text-[10px] tracking-[0.16em] text-neutral-500">OAO AGENT</p></div>
          <span role="status" className={cn('rounded-md px-2 py-1 text-[10px]', running ? 'bg-white/10 text-white' : data.runStatus === 'failed' ? 'bg-amber-400/10 text-amber-200' : 'text-neutral-400')}>{RUN_STATUS_LABEL[data.runStatus ?? ''] ?? '准备就绪'}</span>
          <button type="button" aria-label={collapsed ? '展开 Agent' : '折叠 Agent'} aria-expanded={!collapsed} aria-controls={`agent-body-${id}`} onClick={() => updateNodeData(id, { collapsed: !collapsed })} className="nodrag flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white">{collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</button>
        </header>
        {collapsed ? <p className="truncate border-t border-white/[0.06] px-4 py-3 text-xs text-neutral-400">{data.prompt || '展开后输入任务，选择技能并制定计划'}</p> : (
          <div id={`agent-body-${id}`} className="flex flex-col gap-3 px-4 pb-4">
            <div className="flex items-center gap-2 border-y border-white/[0.06] py-2.5 text-[10px] text-neutral-500" aria-label="先制定计划，再确认执行，最后回到画布">
              <span className={cn('flex items-center gap-1.5', (!data.runStatus || data.runStatus === 'planning') && 'text-neutral-200')}><span className="font-mono">01</span> 制定计划</span><span className="h-px flex-1 bg-white/10" /><span className={cn('flex items-center gap-1.5', waiting && 'text-neutral-200')}><span className="font-mono">02</span> 确认执行</span><span className="h-px flex-1 bg-white/10" /><span className={cn('flex items-center gap-1.5', data.runStatus === 'completed' && 'text-neutral-200')}><span className="font-mono">03</span> 生成结果</span>
            </div>
            <div className="nodrag nowheel rounded-xl border border-white/10 bg-[#0d0f12] px-3 pt-3 focus-within:border-white/40 focus-within:ring-2 focus-within:ring-white/5">
              <label htmlFor={`agent-prompt-${id}`} className="sr-only">Agent 指令</label>
              <textarea id={`agent-prompt-${id}`} value={data.prompt} rows={4} maxLength={16000} placeholder="想在这张画布上创作什么？\n例如：为这组素材设计 3 个连贯镜头。" disabled={locked} onFocus={() => beginEdit()} onChange={(event) => updateNodeData(id, { prompt: event.target.value })} onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canRun) { event.preventDefault(); void perform(() => actions.startAgent(id)) } }} className="nodrag nowheel min-h-28 max-h-72 w-full resize-y bg-transparent text-[13px] leading-6 text-neutral-100 outline-none placeholder:text-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400" />
              <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] py-2.5">
                <button type="button" disabled={locked} onClick={() => actions.selectSkills(id)} className={`${BUTTON} border border-white/10 text-neutral-300 hover:bg-white/5`}><Puzzle className="size-3.5" />{skills.length ? `${skills.length} 个技能` : '选择技能'}</button>
                <span className="ml-auto text-[10px] text-neutral-600">⌘ / Ctrl + Enter</span>
              </div>
            </div>
            {skills.length ? <ul aria-label="已选技能" className="flex flex-wrap gap-1.5">{skills.map((skill) => <li key={skill.id} className="flex max-w-full items-center gap-1 rounded-md border border-white/10 bg-white/[0.035] py-1 pr-1 pl-2 text-[11px] text-neutral-300"><Puzzle className="mr-0.5 size-3 shrink-0 text-neutral-500" /><span className="truncate" title={skill.prompt}>{skill.title}</span><button type="button" aria-label={`移除技能 ${skill.title}`} disabled={locked} onClick={() => updateNodeData(id, { skills: skills.filter((item) => item.id !== skill.id) }, { history: true })} className="nodrag rounded p-0.5 hover:bg-white/10 disabled:opacity-30"><X className="size-3" /></button></li>)}</ul> : null}
            <details className="nodrag text-xs text-neutral-500"><summary className="cursor-pointer rounded py-1.5 text-[11px] outline-offset-2 focus-visible:outline-white"><Layers3 className="mr-1.5 inline size-3.5" />读取整张画布{data.context.length ? ` · ${data.context.length} 个对象` : ''}</summary><p className="pt-1 leading-5">使用当前画布的节点、提示词、素材和连线来制定计划。</p>{data.context.length ? <ul className="mt-2 flex flex-wrap gap-1">{data.context.map((title, index) => <li key={`${title}-${index}`} className="max-w-full truncate rounded bg-white/5 px-2 py-1">{title}</li>)}</ul> : null}</details>
            {!hasModel ? <p className="rounded-lg border border-white/10 px-3 py-2 text-xs leading-5 text-neutral-400">尚未配置可用的文本模型，请联系管理员后再运行。</p> : null}
            {data.failure ? <p role="alert" className="rounded-lg border border-amber-300/20 bg-amber-400/5 px-3 py-2.5 text-xs leading-5 text-amber-100">{data.failure}</p> : null}
            {data.deliveryError ? <p role="alert" className="rounded-lg border border-amber-300/20 px-3 py-2.5 text-xs leading-5 text-amber-100">{data.deliveryError}</p> : deliveryPending ? <p role="status" className="text-xs leading-5 text-neutral-400">正在接收并保存运行结果…</p> : null}
            {data.runStatus === 'awaiting_approval' && data.planApproval ? <div className="rounded-xl border border-white/15 bg-white/[0.04] p-3"><p className="text-xs font-medium">计划已就绪 · {data.steps.length} 个步骤</p><p className="mt-1.5 text-xs leading-5 text-neutral-400">预计消耗 {data.planApproval.totalPoints} 积分，确认后开始执行。</p></div> : null}
            {data.steps.length ? <section aria-label="执行进度" className="rounded-xl border border-white/[0.08] p-3"><div className="mb-3 flex justify-between text-[11px] text-neutral-500"><span>执行步骤</span><span>{completed} / {data.steps.length}</span></div><ol className="flex max-h-60 flex-col gap-2 overflow-y-auto nowheel">{data.steps.map((step, index) => <StepRow key={step.id} step={step} index={index} />)}</ol></section> : null}
            <div className="nodrag flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] pt-3">
              {data.deliveryError && data.runId ? <button type="button" onClick={() => actions.refreshAgent(id)} className={`${BUTTON} border border-white/20 text-white hover:bg-white/10`}><RefreshCw className="size-3.5" />重试接收结果</button> : null}
              {pendingAction ? <Loader2 className="mr-auto size-4 animate-spin text-neutral-500" aria-label="正在提交操作" /> : data.pointsCost !== null ? <span className="mr-auto text-[10px] text-neutral-500">已用 {data.pointsCost} 积分</span> : null}
              {(running || waiting) && data.runId ? <button type="button" disabled={pendingAction} onClick={() => void perform(() => actions.cancelAgent(id))} className={`${BUTTON} text-neutral-400 hover:bg-white/5`}><Square className="size-3" />取消</button> : null}
              {running && data.runId ? <><button type="button" disabled={pendingAction} aria-label="刷新 Agent 进度" onClick={() => actions.refreshAgent(id)} className={`${BUTTON} text-neutral-400 hover:bg-white/5`}><RefreshCw className="size-3.5" /></button><button type="button" disabled={pendingAction} onClick={() => void perform(() => actions.pauseAgent(id))} className={`${BUTTON} border border-white/15 text-white hover:bg-white/10`}><Pause className="size-3.5" />暂停</button></> : null}
              {data.runStatus === 'awaiting_approval' ? <button type="button" disabled={pendingAction} onClick={() => void perform(() => actions.approveAgent(id))} className={`${BUTTON} bg-neutral-100 font-medium text-neutral-950 hover:bg-white`}><Check className="size-3.5" />确认执行</button> : data.runStatus === 'paused' ? <button type="button" disabled={pendingAction} onClick={() => void perform(() => actions.resumeAgent(id))} className={`${BUTTON} bg-neutral-100 font-medium text-neutral-950 hover:bg-white`}><Play className="size-3.5" />继续执行</button> : !running ? <button type="button" disabled={!canRun} onClick={() => void perform(() => actions.startAgent(id))} className={`${BUTTON} bg-neutral-100 font-medium text-neutral-950 hover:bg-white`}><ArrowUp className="size-4" />{data.runStatus === 'unconfirmed' ? '确认上次提交' : '生成计划'}</button> : !data.runId ? <span className="flex items-center gap-2 text-xs text-neutral-400"><Loader2 className="size-3.5 animate-spin" />正在生成计划</span> : null}
            </div>
          </div>
        )}
      </article>
    </div>
  )
})

function StepRow({ step, index }: { step: AgentStep; index: number }) {
  const done = step.status === 'completed' || step.status === 'success'
  const failed = step.status === 'failed' || step.status === 'error'
  const active = step.status === 'running' || step.status === 'processing'
  const Icon = done ? CheckCircle2 : failed ? XCircle : active ? Loader2 : CircleDashed
  return <li className="flex items-start gap-2 text-xs"><Icon className={cn('mt-0.5 size-3.5 shrink-0', failed ? 'text-amber-200' : 'text-neutral-400', active && 'animate-spin')} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="break-words leading-5 text-neutral-200">{index + 1}. {step.title}</p>{step.error ? <p className="mt-1 break-words text-[11px] leading-5 text-amber-200">{step.error}</p> : null}</div><span className="shrink-0 pt-0.5 text-[10px] text-neutral-500">{STEP_STATUS_LABEL[step.status] ?? step.status}</span></li>
}
