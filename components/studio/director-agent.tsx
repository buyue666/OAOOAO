'use client'

import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CirclePause,
  CirclePlay,
  Clapperboard,
  Coins,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createAgentPlan } from '@/lib/studio/mock-service'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import type { AgentRun, AgentRunTask } from '@/lib/studio/generation-types'
import type { AgentPlan, AgentStep } from '@/lib/studio/types'
import { cn } from '@/lib/utils'
import { ControlButton, IconAction, Modal, Notice, SidePanel, StatusBadge, Tooltip, type Tone } from './ui'

const threadKey = 'oaooao-agent-thread'
const HIGH_COST_THRESHOLD = 60

interface AgentMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  planId?: string
  refs?: string[]
  createdAt: number
  /** 真实 Agent 运行标识；有值表示这条消息对应后端任务。 */
  runId?: string
}

const runStatusMeta: Record<AgentRun['status'], { label: string; tone: Tone }> = {
  planning: { label: '规划中', tone: 'accent' },
  running: { label: '执行中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'warning' },
  cancelled: { label: '已取消', tone: 'muted' },
}

const runTaskStatusMeta: Record<string, { label: string; tone: Tone }> = {
  pending: { label: '排队中', tone: 'neutral' },
  running: { label: '生成中', tone: 'accent' },
  success: { label: '完成', tone: 'success' },
  error: { label: '失败', tone: 'warning' },
  cancelled: { label: '已取消', tone: 'muted' },
}

const stepMeta: Record<AgentStep['status'], { label: string; tone: Tone }> = {
  pending: { label: '待确认', tone: 'neutral' },
  running: { label: '执行中', tone: 'accent' },
  completed: { label: '完成', tone: 'success' },
  failed: { label: '失败', tone: 'warning' },
}

const planMeta: Record<AgentPlan['status'], { label: string; tone: Tone }> = {
  draft: { label: '待确认', tone: 'neutral' },
  running: { label: '执行中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'warning' },
}

const suggestions = ['把这场雪地重逢拆成 6 个镜头', '为极光之后设计主视觉与海报', '给预告片补一段 8 秒的镜头运动']

/** 对话记录写入独立的本地键，刷新后仍可回溯，且不改动现有业务数据结构。 */
function useAgentThread() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(threadKey)
      if (raw) setMessages(JSON.parse(raw) as AgentMessage[])
    } catch {
      setMessages([])
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    window.localStorage.setItem(threadKey, JSON.stringify(messages.slice(-40)))
  }, [messages, ready])

  return { messages, setMessages, ready }
}

function buildSteps(prompt: string): AgentStep[] {
  return [
    { id: 'step-01', label: '理解创作意图', detail: `解析「${prompt.slice(0, 18)}」的场景、主体与情绪`, status: 'pending' },
    { id: 'step-02', label: '拆解镜头与素材', detail: '给出镜头序列、参考素材与模型建议', status: 'pending' },
    { id: 'step-03', label: '生成候选结果', detail: '按确认后的参数创建生成任务', status: 'pending' },
    { id: 'step-04', label: '回写项目', detail: '把选中的结果加入项目与分镜', status: 'pending' },
  ]
}

function StepRow({
  step,
  index,
  editing,
  onEdit,
  onSave,
  onCancelEdit,
  onSetStatus,
}: {
  step: AgentStep
  index: number
  editing: boolean
  onEdit: () => void
  onSave: (label: string, detail: string) => void
  onCancelEdit: () => void
  onSetStatus: (status: AgentStep['status']) => void
}) {
  const [label, setLabel] = useState(step.label)
  const [detail, setDetail] = useState(step.detail)
  const meta = stepMeta[step.status]

  useEffect(() => {
    setLabel(step.label)
    setDetail(step.detail)
  }, [step.detail, step.label])

  return (
    <li className="flex items-start gap-2.5 border-b border-border/60 py-2.5 last:border-b-0">
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium',
          step.status === 'completed' && 'bg-success/12 text-success',
          step.status === 'running' && 'bg-studio-accent/12 text-studio-accent',
          step.status === 'failed' && 'bg-studio-warn/12 text-studio-warn',
          step.status === 'pending' && 'border border-border text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {step.status === 'completed' ? <Check className="size-3" /> : step.status === 'running' ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> : step.status === 'failed' ? <AlertTriangle className="size-3" /> : index + 1}
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex flex-col gap-2">
            <label className="sr-only" htmlFor={`step-label-${step.id}`}>步骤名称</label>
            <input
              id={`step-label-${step.id}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="studio-field h-8 w-full border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
            />
            <label className="sr-only" htmlFor={`step-detail-${step.id}`}>步骤说明</label>
            <textarea
              id={`step-detail-${step.id}`}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              rows={2}
              className="studio-field w-full resize-none border border-border bg-background px-2 py-1.5 text-[11px] leading-5 text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
            />
            <div className="flex gap-1.5">
              <ControlButton type="button" size="sm" variant="primary" onClick={() => onSave(label.trim() || step.label, detail.trim() || step.detail)}>保存</ControlButton>
              <ControlButton type="button" size="sm" variant="ghost" onClick={onCancelEdit}>取消</ControlButton>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate text-xs font-medium text-foreground">{step.label}</p>
              <StatusBadge tone={meta.tone} className="shrink-0">{meta.label}</StatusBadge>
            </div>
            <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{step.detail}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-colors duration-150 hover:text-foreground">
                <Pencil className="size-2.5" aria-hidden="true" />
                修改
              </button>
              {step.status !== 'completed' && (
                <button type="button" onClick={() => onSetStatus('completed')} className="text-[10px] text-muted-foreground transition-colors duration-150 hover:text-foreground">标记完成</button>
              )}
              {step.status !== 'failed' && (
                <button type="button" onClick={() => onSetStatus('failed')} className="text-[10px] text-muted-foreground transition-colors duration-150 hover:text-foreground">标记失败</button>
              )}
              {step.status === 'failed' && (
                <button type="button" onClick={() => onSetStatus('running')} className="inline-flex items-center gap-1 text-[10px] text-studio-accent transition-colors duration-150 hover:underline">
                  <RotateCcw className="size-2.5" aria-hidden="true" />
                  重试
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * 真实 Agent 运行面板：展示后端返回的运行状态、子任务、积分与取消/暂停/重试操作。
 * 所有按钮都直接调用后端，失败时把原因展示给用户。
 */
function AgentRunPanel({ run, onControl, onRetryTask }: { run: AgentRun; onControl: (action: 'pause' | 'resume' | 'retry' | 'cancel') => Promise<void>; onRetryTask: (taskId: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const meta = runStatusMeta[run.status] ?? { label: run.status, tone: 'neutral' as Tone }
  const active = run.status === 'planning' || run.status === 'running'
  const done = run.tasks.filter((task) => task.status === 'success').length

  async function run_(key: string, action: () => Promise<void>) {
    setBusy(key)
    try { await action() } finally { setBusy(null) }
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">真实 Agent 任务</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{run.id.slice(0, 12)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {active && <Loader2 className="size-3.5 animate-spin text-studio-accent motion-reduce:animate-none" aria-hidden="true" />}
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-y border-border py-2 text-[11px] text-muted-foreground">
        <span>子任务 {done}/{run.tasks.length} 完成</span>
        <span>{run.pointsCost ? `消耗 ${run.pointsCost} 积分` : '暂无积分消耗'}</span>
      </div>

      {run.cancellation && <p className="text-[11px] text-studio-warn">正在取消，仍有 {run.cancellation.pendingCount} 个子任务待确认。</p>}

      {run.tasks.length > 0 && (
        <ul className="flex flex-col" aria-live="polite">
          {run.tasks.map((task) => <AgentRunTaskRow key={task.id} task={task} onRetry={() => run_(task.id, () => onRetryTask(task.id))} busy={busy === task.id} />)}
        </ul>
      )}

      {run.tasks.length === 0 && active && <p className="text-[11px] text-muted-foreground">Agent 正在规划镜头与素材，稍后会列出具体子任务。</p>}

      <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
        {run.status === 'running' && (
          <ControlButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run_('pause', () => onControl('pause'))}>
            <CirclePause className="size-3.5" aria-hidden="true" />{busy === 'pause' ? '暂停中' : '暂停'}
          </ControlButton>
        )}
        {run.status === 'paused' && (
          <ControlButton size="sm" variant="primary" disabled={busy !== null} onClick={() => void run_('resume', () => onControl('resume'))}>
            <CirclePlay className="size-3.5" aria-hidden="true" />{busy === 'resume' ? '恢复中' : '继续执行'}
          </ControlButton>
        )}
        {run.status === 'failed' && run.tasks.length === 0 && (
          <ControlButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run_('retry', () => onControl('retry'))}>
            <RotateCcw className="size-3.5" aria-hidden="true" />{busy === 'retry' ? '重试中' : '整体重试'}
          </ControlButton>
        )}
        {active && (
          <ControlButton size="sm" variant="danger" disabled={busy !== null} onClick={() => void run_('cancel', () => onControl('cancel'))}>
            <X className="size-3.5" aria-hidden="true" />{busy === 'cancel' ? '取消中' : '取消任务'}
          </ControlButton>
        )}
      </div>
    </div>
  )
}

function AgentRunTaskRow({ task, onRetry, busy }: { task: AgentRunTask; onRetry: () => void; busy: boolean }) {
  const meta = runTaskStatusMeta[task.status] ?? { label: task.status, tone: 'neutral' as Tone }
  return (
    <li className="flex items-start gap-2.5 border-b border-border/60 py-2 last:border-b-0">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground">
        {task.status === 'success' ? <Check className="size-3 text-success" /> : task.status === 'running' ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-foreground">{task.title}</p>
          <StatusBadge tone={meta.tone} className="shrink-0">{meta.label}</StatusBadge>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{task.type} · {task.model}{task.seconds ? ` · ${task.seconds} 秒` : ''}{task.count && task.count > 1 ? ` · ${task.count} 张` : ''}</p>
        {task.error && <p className="mt-1 line-clamp-2 text-[10px] text-destructive" title={task.error}>{task.error}</p>}
        {task.status === 'error' && (
          <button type="button" onClick={onRetry} disabled={busy} className="mt-1 inline-flex items-center gap-1 text-[10px] text-studio-accent transition-colors hover:underline disabled:opacity-50">
            <RotateCcw className="size-2.5" aria-hidden="true" />{busy ? '重试中' : '重试该子任务'}
          </button>
        )}
      </div>
    </li>
  )
}

/** 执行计划面板：桌面端放在右侧抽屉，移动端由 SidePanel 自动变成全屏 Sheet。 */
export function AgentPlanPanel({ planId, onNotice, hideTitle = false }: { planId: string | null; onNotice?: (text: string) => void; hideTitle?: boolean }) {
  const { state, dispatch } = useStudio()
  const router = useRouter()
  const [editingStep, setEditingStep] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const plan = state.agentPlans.find((item) => item.id === planId)

  if (!plan) return <p className="px-4 py-6 text-xs leading-5 text-muted-foreground">还没有执行计划。在下方输入创作想法，Agent 会先给出可确认的步骤。</p>

  const meta = planMeta[plan.status]
  const nextStep = plan.steps.find((step) => step.status === 'pending' || step.status === 'running')
  const completed = plan.steps.filter((step) => step.status === 'completed').length
  const highCost = plan.credits >= HIGH_COST_THRESHOLD

  function setSteps(steps: AgentStep[], status: AgentPlan['status'] = plan!.status) {
    dispatch({ type: 'UPDATE_AGENT_PLAN', planId: plan!.id, status, steps })
  }

  function start() {
    if (highCost) {
      setConfirmOpen(true)
      return
    }
    setSteps(plan!.steps.map((step, index) => (index === 0 ? { ...step, status: 'running' } : step)), 'running')
  }

  function advance() {
    const index = plan!.steps.findIndex((step) => step.status === 'running' || step.status === 'pending')
    if (index < 0) return
    const steps = plan!.steps.map((step, stepIndex) => {
      if (stepIndex === index) return { ...step, status: 'completed' as const }
      if (stepIndex === index + 1) return { ...step, status: 'running' as const }
      return step
    })
    setSteps(steps, steps.every((step) => step.status === 'completed') ? 'completed' : 'running')
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {!hideTitle && <p className="text-sm font-semibold text-foreground">{plan.title}</p>}
          <p className={cn('text-[11px] leading-5 text-muted-foreground', !hideTitle && 'mt-1')}>{plan.context}</p>
        </div>
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
      </div>

      <div className="grid grid-cols-2 gap-2 border-y border-border py-3">
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="size-3.5 text-studio-accent" aria-hidden="true" />{plan.model}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Coins className="size-3.5 text-studio-warn" aria-hidden="true" />预计 {plan.credits} 积分</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 className="size-3.5" aria-hidden="true" />{completed}/{plan.steps.length} 步完成</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Bot className="size-3.5" aria-hidden="true" />{plan.scope}</span>
      </div>

      {highCost && plan.status === 'draft' && (
        <Notice tone="warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          这次执行预计消耗 {plan.credits} 积分，属于高成本操作，需要你确认后才会开始。
        </Notice>
      )}

      <ul className="flex flex-col" aria-live="polite">
        {plan.steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            editing={editingStep === step.id}
            onEdit={() => setEditingStep(step.id)}
            onCancelEdit={() => setEditingStep(null)}
            onSave={(label, detail) => {
              setSteps(plan.steps.map((item) => (item.id === step.id ? { ...item, label, detail } : item)))
              setEditingStep(null)
            }}
            onSetStatus={(status) => setSteps(plan.steps.map((item) => (item.id === step.id ? { ...item, status } : item)))}
          />
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {plan.status === 'draft' && (
          <ControlButton variant="primary" size="sm" onClick={start}>
            <CirclePlay className="size-3.5" aria-hidden="true" />
            确认执行
          </ControlButton>
        )}
        {plan.status === 'running' && (
          <>
            <ControlButton variant="primary" size="sm" onClick={advance} disabled={!nextStep}>
              <Check className="size-3.5" aria-hidden="true" />
              执行下一步
            </ControlButton>
            <ControlButton variant="ghost" size="sm" onClick={() => dispatch({ type: 'UPDATE_AGENT_PLAN', planId: plan.id, status: 'paused' })}>
              <CirclePause className="size-3.5" aria-hidden="true" />
              暂停后续
            </ControlButton>
          </>
        )}
        {plan.status === 'paused' && (
          <ControlButton variant="primary" size="sm" onClick={() => dispatch({ type: 'UPDATE_AGENT_PLAN', planId: plan.id, status: 'running' })}>
            <CirclePlay className="size-3.5" aria-hidden="true" />
            继续执行
          </ControlButton>
        )}
        {(plan.status === 'completed' || plan.status === 'failed') && (
          <ControlButton variant="secondary" size="sm" onClick={() => setSteps(plan.steps.map((step) => ({ ...step, status: 'pending' as const })), 'draft')}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            重新规划
          </ControlButton>
        )}
      </div>

      {plan.status === 'completed' && (
        <section className="border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold text-foreground">结果去向</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">把这次结果继续送入图片、视频、分镜或画布，不需要重新描述。</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <ControlButton size="sm" variant="ghost" onClick={() => router.push('/image')}><ImageIcon className="size-3.5" aria-hidden="true" />送入图片</ControlButton>
            <ControlButton size="sm" variant="ghost" onClick={() => router.push('/video')}><Video className="size-3.5" aria-hidden="true" />送入视频</ControlButton>
            <ControlButton size="sm" variant="ghost" onClick={() => router.push(state.selectedProjectId ? `/projects/${state.selectedProjectId}/storyboard` : '/projects')}><Clapperboard className="size-3.5" aria-hidden="true" />加入分镜</ControlButton>
            <ControlButton size="sm" variant="ghost" onClick={() => router.push('/canvas')}><Send className="size-3.5" aria-hidden="true" />送入画布</ControlButton>
          </div>
        </section>
      )}

      <Modal
        open={confirmOpen}
        title="确认高成本操作"
        description={`这次执行预计消耗 ${plan.credits} 积分，确认后才会开始。`}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <ControlButton variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>取消</ControlButton>
            <ControlButton
              variant="primary"
              size="sm"
              onClick={() => {
                setConfirmOpen(false)
                setSteps(plan.steps.map((step, index) => (index === 0 ? { ...step, status: 'running' } : step)), 'running')
                onNotice?.('已确认执行，Agent 开始按步骤推进。')
              }}
            >
              确认并开始
            </ControlButton>
          </>
        }
      >
        <p className="text-xs leading-5 text-muted-foreground">执行过程中可以随时暂停，也可以单独修改某一步，不需要整体重新确认。</p>
      </Modal>
    </div>
  )
}

/**
 * 导演 Agent 工作区：中央是持续对话与创作记录，底部是固定输入区。
 * 计划默认内联在对话里；传入 onOpenPlan 时改为在右侧抽屉中查看与编辑。
 */
export function DirectorAgent({
  projectId,
  context = '当前项目 · 选中镜头',
  onOpenPlan,
  showHeader = true,
  emptyStateLayout = 'grid',
  compact = false,
}: {
  projectId?: string
  context?: string
  onOpenPlan?: (planId: string) => void
  showHeader?: boolean
  emptyStateLayout?: 'grid' | 'stacked'
  compact?: boolean
}) {
  const { state, dispatch, estimateCredits, liveReady } = useStudio()
  const { runAgent, getAgent, cancelAgent, retryAgentTask, lastError, lastNotice, setNotice: setGenerationNotice } = useGeneration()
  const { messages, setMessages, ready } = useAgentThread()
  const [input, setInput] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, AgentRun>>(() => ({}))
  const [submitting, setSubmitting] = useState(false)
  const [runError, setRunError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const projectTitle = projectId ? state.projects.find((project) => project.id === projectId)?.title : undefined
  const planCredits = useMemo(() => estimateCredits('motion-03', { duration: '8 秒', quality: '高清' }), [estimateCredits])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length])

  /** 对活跃的真实 Agent 运行进行轮询，完成后停止。 */
  const activeRunIds = useMemo(() => messages.filter((message) => message.runId).map((message) => message.runId!).filter((id) => {
    const run = runs[id]
    return run ? ['planning', 'running', 'paused'].includes(run.status) : true
  }), [messages, runs])

  useEffect(() => {
    if (!liveReady || !activeRunIds.length) return
    let cancelled = false
    const timer = window.setInterval(async () => {
      for (const id of activeRunIds) {
        try {
          const run = await getAgent(id)
          if (!cancelled) setRuns((current) => ({ ...current, [id]: run }))
        } catch {
          // 单次轮询失败不影响其他任务，下一次会重试。
        }
      }
    }, 3000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [activeRunIds, getAgent, liveReady])

  async function send(text: string) {
    const value = text.trim()
    if (!value) return
    const now = Date.now()

    // 后端可用时创建真实 Agent 运行；失败时保留错误，不生成假的执行计划。
    if (liveReady) {
      setSubmitting(true); setRunError('')
      try {
        const run = await runAgent({ prompt: value, surface: projectId ? 'canvas' : 'chat', ...(projectId ? { projectId } : {}), ...(refs.length ? { assetIds: refs } : {}) })
        setRuns((current) => ({ ...current, [run.id]: run }))
        setMessages((current) => [
          ...current,
          { id: `msg-user-${now}`, role: 'user', text: value, refs: refs.length ? [...refs] : undefined, createdAt: now },
          {
            id: `msg-agent-${now}`,
            role: 'agent',
            text: `已创建真实 Agent 任务，正在按「${run.prompt.slice(0, 24)}」拆解镜头与素材。可以在下方查看子任务进度，完成后结果会写入项目。`,
            runId: run.id,
            createdAt: now + 1,
          },
        ])
        setInput('')
        setRefs([])
        setGenerationNotice(null)
      } catch (reason) {
        setRunError(reason instanceof Error ? reason.message : 'Agent 任务创建失败')
      } finally {
        setSubmitting(false)
      }
      return
    }

    const plan: AgentPlan = {
      ...createAgentPlan(context, `${projectTitle ?? '当前创作'} · ${value.slice(0, 20)}`),
      steps: buildSteps(value),
      credits: planCredits,
    }
    dispatch({ type: 'ADD_AGENT_PLAN', plan })
    setMessages((current) => [
      ...current,
      { id: `msg-user-${now}`, role: 'user', text: value, refs: refs.length ? [...refs] : undefined, createdAt: now },
      {
        id: `msg-agent-${now}`,
        role: 'agent',
        text: `本地预览：我把这个想法拆成了 ${plan.steps.length} 个步骤，不会调用真实模型。登录后 Agent 会创建真实任务并消耗积分。`,
        planId: plan.id,
        createdAt: now + 1,
      },
    ])
    setInput('')
    setRefs([])
    setNotice(null)
    onOpenPlan?.(plan.id)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    send(input)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {showHeader && (
        <div className={cn('flex shrink-0 items-center justify-between gap-3 border-b border-border', compact ? 'px-3 py-2.5' : 'px-4 py-3')}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-studio-accent/12 text-studio-accent">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">导演 Agent</p>
              <p className="truncate text-[11px] text-muted-foreground">{context}</p>
            </div>
          </div>
          {messages.length > 0 && (
            <Tooltip label="清空对话记录">
              <IconAction label="清空对话记录" onClick={() => setMessages([])}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconAction>
            </Tooltip>
          )}
        </div>
      )}

      <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-3 py-3' : 'px-4 py-5 md:px-6')}>
        {ready && messages.length === 0 ? (
          <div className={cn('flex items-start', compact ? 'py-1' : 'py-2 md:py-5')}>
            <div className={cn('grid w-full items-start', compact ? 'grid-cols-1 gap-4' : 'gap-7', !compact && (emptyStateLayout === 'stacked' ? 'grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_260px]'))}>
              <section className={cn('px-1', compact ? 'py-1' : 'py-2 md:px-3')}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-studio-accent text-studio-accent-foreground">
                      <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                    <p className="truncate text-xs text-muted-foreground">从一句想法开始，逐步确认每一个镜头</p>
                  </div>
                  <StatusBadge tone="accent">可开始</StatusBadge>
                </div>
                <h2 className={cn('max-w-xl text-balance font-semibold tracking-[-0.04em] text-foreground', compact ? 'mt-3 text-lg leading-7' : 'mt-6 text-2xl md:text-3xl')}>把一个镜头，变成一段可执行的创作计划。</h2>
                <p className={cn('max-w-2xl text-muted-foreground', compact ? 'mt-2 text-xs leading-5' : 'mt-3 text-sm leading-6')}>Agent 会先理解意图，再把镜头、素材、模型和积分拆成可编辑的步骤。确认之后才会创建任务，创作节奏始终由你掌控。</p>
                <div className={cn('grid gap-2', compact ? 'mt-3 grid-cols-1 gap-1.5' : 'mt-5 sm:grid-cols-3')}>
                  {suggestions.map((item, index) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => send(item)}
                      className={cn('studio-surface studio-surface-interactive group flex flex-col items-start justify-between text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60', compact ? 'min-h-0 gap-1.5 p-2.5' : 'min-h-20 gap-3 p-3')}
                    >
                      <span className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        0{index + 1}
                        <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                      <span className="text-xs leading-5 text-foreground">{item}</span>
                    </button>
                  ))}
                </div>
              </section>
              <aside className={cn('border-border', compact ? 'border-t pt-4' : 'md:py-2', !compact && (emptyStateLayout === 'stacked' ? 'border-t pt-5 lg:border-l lg:border-t-0 lg:pl-5' : 'lg:border-l lg:pl-5'))}>
                <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Agent 工作流</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">确认点清晰可见</p>
                  </div>
                  <StatusBadge>预览</StatusBadge>
                </div>
                <ol className="mt-1">
                  {[
                    ['01', '理解创作意图', '主体 · 情绪 · 场景'],
                    ['02', '拆解镜头与素材', '镜头序列 · 参考图'],
                    ['03', '生成候选结果', '模型 · 比例 · 积分'],
                    ['04', '回写项目', '分镜 · 画布 · 成片'],
                  ].map(([number, label, detail]) => (
                    <li key={number} className="flex gap-3 border-b border-border/70 py-2.5 last:border-b-0">
                      <span className="text-[10px] font-semibold text-studio-accent">{number}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">{label}</p>
                        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[10px] text-muted-foreground">
                  <Coins className="size-3.5 text-studio-warn" aria-hidden="true" />
                  <span>生成前显示预计积分，避免意外消耗</span>
                </div>
              </aside>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) =>
              message.role === 'user' ? (
                <li key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg border border-studio-accent/25 bg-studio-accent/10 px-3 py-2">
                    <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">{message.text}</p>
                    {message.refs && message.refs.length > 0 && (
                      <p className="mt-1.5 text-[10px] text-muted-foreground">参考素材：{message.refs.join('、')}</p>
                    )}
                  </div>
                </li>
              ) : (
                <li key={message.id} className="flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-studio-accent/12 text-studio-accent">
                      <Bot className="size-3" aria-hidden="true" />
                    </span>
                    <p className="min-w-0 text-xs leading-5 text-foreground">{message.text}</p>
                  </div>
                  {message.runId && runs[message.runId] && (
                    <div className="studio-surface ml-7 overflow-hidden">
                      <AgentRunPanel
                        run={runs[message.runId]}
                        onControl={async (action) => {
                          try {
                            const updated = await cancelAgent(runs[message.runId!], action)
                            setRuns((current) => ({ ...current, [message.runId!]: updated }))
                          } catch (reason) {
                            setRunError(reason instanceof Error ? reason.message : 'Agent 操作失败')
                          }
                        }}
                        onRetryTask={async (taskId) => {
                          try {
                            await retryAgentTask(message.runId!, taskId)
                            const updated = await getAgent(message.runId!)
                            setRuns((current) => ({ ...current, [message.runId!]: updated }))
                          } catch (reason) {
                            setRunError(reason instanceof Error ? reason.message : '子任务重试失败')
                          }
                        }}
                      />
                    </div>
                  )}
                  {message.runId && !runs[message.runId] && (
                    <div className="studio-surface ml-7 flex items-center gap-2 px-3 py-2.5 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" />正在读取 Agent 任务状态
                    </div>
                  )}
                  {message.planId && (
                    <div className="studio-surface ml-7 overflow-hidden">
                      {onOpenPlan ? (
                        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground">本地预览计划已生成</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">不会调用真实模型。登录后 Agent 会创建真实任务。</p>
                          </div>
                          <ControlButton size="sm" variant="secondary" onClick={() => onOpenPlan(message.planId!)}>查看计划</ControlButton>
                        </div>
                      ) : (
                        <AgentPlanPanel planId={message.planId} onNotice={setNotice} />
                      )}
                    </div>
                  )}
                </li>
              ),
            )}
          </ol>
        )}
      </div>

      {notice && (
        <div className="shrink-0 px-4 pb-2">
          <Notice tone="accent">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span aria-live="polite">{notice}</span>
          </Notice>
        </div>
      )}

      {runError && (
        <div className="shrink-0 px-4 pb-2">
          <Notice tone="warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span role="alert" className="min-w-0 flex-1">Agent 请求失败：{runError}</span>
            <button type="button" onClick={() => setRunError('')} className="shrink-0 text-[11px] underline">关闭</button>
          </Notice>
        </div>
      )}

      {lastError && (
        <div className="shrink-0 px-4 pb-2">
          <Notice tone="warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span role="alert" className="min-w-0 flex-1">后端返回：{lastError.message}</span>
          </Notice>
        </div>
      )}

      {lastNotice && (
        <div className="shrink-0 px-4 pb-2">
          <Notice tone="accent"><span aria-live="polite">{lastNotice}</span></Notice>
        </div>
      )}

      <form onSubmit={submit} className={cn('shrink-0 border-t border-border bg-card', compact ? 'px-3 py-2.5' : 'px-4 py-3')}>
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            <Layers3 className="size-2.5" aria-hidden="true" />
            {projectTitle ?? '当前项目'}
          </span>
          {refs.map((ref) => (
            <span key={ref} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {ref}
              <button type="button" onClick={() => setRefs((current) => current.filter((item) => item !== ref))} aria-label={`移除参考素材 ${ref}`} className="text-muted-foreground hover:text-foreground">
                <X className="size-2.5" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
        <div className={cn('grid items-end gap-2', compact ? 'grid-cols-[32px_minmax(0,1fr)_36px]' : 'grid-cols-[36px_minmax(0,1fr)_40px]')}>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              const names = Array.from(event.target.files ?? []).map((file) => file.name)
              if (names.length) setRefs((current) => [...current, ...names].slice(0, 4))
              event.target.value = ''
            }}
          />
          <Tooltip label="添加参考素材">
            <IconAction label="添加参考素材" onClick={() => fileRef.current?.click()} className="size-9 shrink-0 border border-border">
              <Paperclip className="size-4" aria-hidden="true" />
            </IconAction>
          </Tooltip>
          <label htmlFor={compact ? 'canvas-agent-input' : 'agent-input'} className="sr-only">创作想法</label>
          <textarea
            id={compact ? 'canvas-agent-input' : 'agent-input'}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                send(input)
              }
            }}
            rows={2}
            placeholder={compact ? '描述镜头想法，Enter 发送' : '描述创作想法，Enter 发送，Shift + Enter 换行'}
            className="studio-field min-h-9 min-w-0 flex-1 resize-none border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
          />
          <ControlButton type="submit" variant="primary" size="lg" className="size-11 !p-0 shrink-0" disabled={!input.trim() || submitting} aria-label="发送给导演 Agent">
            {submitting ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="size-6" aria-hidden="true" />}
          </ControlButton>
        </div>
      </form>
    </div>
  )
}

/** 独立页面使用：对话居中，计划放在右侧抽屉（移动端自动变成全屏 Sheet）。 */
export function DirectorAgentWorkspace({ projectId, context }: { projectId?: string; context?: string }) {
  const { state } = useStudio()
  const [planId, setPlanId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const plan = state.agentPlans.find((item) => item.id === planId)

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DirectorAgent projectId={projectId} context={context} onOpenPlan={setPlanId} showHeader={false} />
      </div>
      <SidePanel
        open={Boolean(planId)}
        onClose={() => setPlanId(null)}
        title={plan?.title ?? '执行计划'}
        description={plan ? `${planMeta[plan.status].label} · 预计 ${plan.credits} 积分` : undefined}
      >
        <AgentPlanPanel planId={planId} onNotice={setNotice} hideTitle />
      </SidePanel>
      {notice && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <Notice tone="accent">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span aria-live="polite">{notice}</span>
          </Notice>
        </div>
      )}
    </>
  )
}

