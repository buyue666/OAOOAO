'use client'

import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Coins, Info, Loader2, RefreshCw, RotateCcw, Undo2 } from 'lucide-react'
import { useGeneration } from '@/lib/studio/generation-store'
import { isActiveStatus } from '@/lib/studio/generation-api'
import type { GenerationKind, GenerationTaskView } from '@/lib/studio/generation-types'
import { cn } from '@/lib/utils'
import { ControlButton, MediaThumb, Notice, StatusBadge, type Tone } from './ui'

const statusMeta: Record<string, { label: string; tone: Tone }> = {
  pending: { label: '排队中', tone: 'neutral' },
  running: { label: '生成中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warning' },
  success: { label: '已完成', tone: 'success' },
  error: { label: '失败', tone: 'warning' },
  cancelled: { label: '已取消', tone: 'muted' },
}

export function taskStatusMeta(status?: string) {
  return statusMeta[status ?? ''] ?? { label: status || '未知', tone: 'neutral' as Tone }
}

function formatTime(value: number) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

/** 本地预览提示：未登录或后端不可用时明确告知，不伪装成真实结果。 */
export function LocalPreviewNotice({ what = '生成' }: { what?: string }) {
  const { localOnly } = useGeneration()
  return (
    <Notice tone="warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        当前处于<strong className="font-medium">本地预览</strong>：后端不可用或未登录，{what}不会真正提交。
        下方示例结果仅用于界面预览，登录后才会调用真实模型并扣除积分。
      </span>
      {localOnly && <span className="sr-only">后端连接已标记为不可用</span>}
    </Notice>
  )
}

/**
 * 生成错误提示。
 *
 * 必须区分「确实被拒绝」与「结果未知」：
 * 网络中断 / 5xx / 超时时后端**可能已经创建了任务并扣费**，
 * 此时显示「生成失败：后端拒绝了这次请求」是错误结论——它同时暗示了
 * 「没生成」「没扣费」两件系统并不知道的事。这类情况改为中性的「提交结果未确认」。
 */
export function GenerationErrorNotice() {
  const { lastError, dismissError } = useGeneration()
  if (!lastError) return null
  const indeterminate = Boolean(lastError.indeterminate)
  const hint = lastError.code === 'unauthenticated' ? '请先登录后再创建生成任务。'
    : lastError.code === 'insufficient' ? '积分不足或没有该模型的调用权限。'
      : lastError.code === 'conflict' ? '任务状态已变化，请刷新后重试。'
        : indeterminate ? '请求可能已经生效：后端或许已创建任务并扣费。请到任务中心用同一标识重新提交或重新检查，不要直接重发。'
          : '后端拒绝了这次请求。'
  return (
    <Notice tone="warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1" data-testid={indeterminate ? 'generation-indeterminate' : 'generation-error'}>
        <span className="block font-medium">{indeterminate ? '提交结果未确认：' : '生成失败：'}{lastError.message}</span>
        <span className="mt-0.5 block text-[11px]">{hint}{lastError.status ? `（HTTP ${lastError.status}）` : ''}</span>
      </span>
      <button type="button" onClick={dismissError} className="shrink-0 text-[11px] underline">关闭</button>
    </Notice>
  )
}

/**
 * 查询不可用提示。
 *
 * 网络错误或 5xx 只说明「没问到状态」，上游可能仍在生成。
 * 这里明确区分「查询失败」与「生成失败」，避免用户以为任务已失败或已退款。
 */
export function QueryUnavailableNotice() {
  const { queryUnavailable, refresh, loading } = useGeneration()
  if (!queryUnavailable) return null
  return (
    <Notice tone="warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">暂时无法查询任务状态</span>
        <span className="mt-0.5 block text-[11px] leading-5">
          这不代表任务失败：上游可能仍在生成。系统会按退避策略自动重试；你也可以手动重新检查。
          积分是否退回以服务端记录为准，离线期间不会自行判定退款。
        </span>
      </span>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="shrink-0 text-[11px] underline disabled:opacity-60">
        {loading ? '检查中…' : '立即重试'}
      </button>
    </Notice>
  )
}

export function GenerationNotice() {
  const { lastNotice, setNotice } = useGeneration()
  if (!lastNotice) return null
  return (
    <Notice tone="accent">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1" aria-live="polite">{lastNotice}</span>
      <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-[11px] underline">关闭</button>
    </Notice>
  )
}

function TaskActions({ task, compact }: { task: GenerationTaskView; compact?: boolean }) {
  const { cancelTask, retryTask, recoverTask, resubmit, canResubmit } = useGeneration()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  /** 取消 / 重试 / 重新检查都直接作用于后端任务，失败时展示后端返回的原因。 */
  const run = useCallback(async (action: 'cancel' | 'retry' | 'recover' | 'resubmit') => {
    setBusy(action); setError('')
    try {
      if (action === 'cancel') await cancelTask(task)
      else if (action === 'retry') await retryTask(task)
      else if (action === 'resubmit') await resubmit(task)
      else await recoverTask(task)
      setConfirming(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }, [cancelTask, recoverTask, resubmit, retryTask, task])

  const canCancel = isActiveStatus(task.status)
  const canRecover = task.status === 'error'
  /** 查询失败但未达上限：状态未知，允许手动重新检查而不是判定失败。 */
  const queryFailed = (task.queryFailures ?? 0) > 0 && (task.queryFailures ?? 0) < (task.queryFailureLimit ?? 6)
  const queryExhausted = (task.queryFailures ?? 0) >= (task.queryFailureLimit ?? 6)
  /**
   * 未确认提交（响应丢失）：**必须立即**提供恢复入口，而不是等查询失败达上限。
   *
   * 上一轮的缺陷正是这里：`resubmitAvailable = queryExhausted && canResubmit(task)`，
   * 而未确认占位任务从未被轮询（没有服务器 ID），`queryFailures` 永远是 undefined，
   * 因此恢复按钮永远不显示——用户只能看到提示却无法操作。
   */
  const unconfirmed = Boolean(task.unconfirmed) || task.id.startsWith('unconfirmed:')
  const hasOriginalIdentity = canResubmit(task)
  const resubmitAvailable = hasOriginalIdentity && (unconfirmed || queryExhausted)
  /** 未确认任务不能取消或重新检查（没有服务器任务 ID）。 */
  const canCancelTask = canCancel && !unconfirmed

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {canCancelTask && !confirming && (
          <ControlButton size="sm" variant="danger" disabled={busy !== null} onClick={() => setConfirming(true)}>
            <Ban className="size-3.5" aria-hidden="true" />取消任务
          </ControlButton>
        )}
        {confirming && (
          <>
            <span className="text-[11px] text-muted-foreground">取消后上游已产生的素材不会被删除，确认取消？</span>
            <ControlButton size="sm" variant="danger" disabled={busy !== null} onClick={() => void run('cancel')}>{busy === 'cancel' ? '取消中' : '确认取消'}</ControlButton>
            <ControlButton size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirming(false)}>返回</ControlButton>
          </>
        )}
        {task.status === 'error' && (
          <ControlButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('retry')}>
            <RotateCcw className="size-3.5" aria-hidden="true" />{busy === 'retry' ? '提交中' : '重试'}
          </ControlButton>
        )}
        {canRecover && (
          <ControlButton size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('recover')}>
            <Undo2 className="size-3.5" aria-hidden="true" />{busy === 'recover' ? '检查中' : '重新检查上游'}
          </ControlButton>
        )}
        {/* 提交结果未确认：复用原幂等标识重试，后端会返回原任务而不是新建。 */}
        {resubmitAvailable && (
          <ControlButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('resubmit')}>
            <RotateCcw className="size-3.5" aria-hidden="true" />{busy === 'resubmit' ? '重试中' : '重新提交'}
          </ControlButton>
        )}
        {queryExhausted && (
          <ControlButton size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('recover')}>
            <Undo2 className="size-3.5" aria-hidden="true" />{busy === 'recover' ? '检查中' : '重新检查'}
          </ControlButton>
        )}
      </div>
      {/* 未确认提交：给出醒目、可操作的恢复入口与「不会重复扣费」的说明。 */}
      {unconfirmed && (
        <div className="rounded-md border border-studio-warn/40 bg-studio-warn/10 p-2.5" role="status">
          <p className="text-[11px] font-medium text-studio-warn">提交结果未确认（响应丢失）</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            服务端可能已经创建了任务并扣费。点击「重新提交」会使用<strong className="font-medium">同一个请求标识</strong>重试，
            后端按该标识去重，因此只会有一个任务、只扣一次费用；若已创建则直接返回原任务。
          </p>
          {!hasOriginalIdentity && (
            <p className="mt-1 text-[11px] leading-5 text-destructive">
              找不到原始请求标识，出于避免重复扣费的考虑不提供自动重试。请到作品列表确认结果是否已生成。
            </p>
          )}
        </div>
      )}
      {queryFailed && !queryExhausted && (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          查询失败 {task.queryFailures} 次，仍在自动重试（不代表任务失败）。
        </p>
      )}
      {queryExhausted && !unconfirmed && (
        <p className="text-[11px] text-studio-warn">
          已连续 {task.queryFailures} 次无法确认状态，自动轮询已暂停。任务可能仍在上游生成，请点击「重新检查」查询上游结果
          {resubmitAvailable ? '，或用「重新提交」按原标识重试（不会重复创建任务或重复扣费）。' : '。'}
        </p>
      )}
      {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
      {!compact && task.needsReview && <p className="text-[11px] text-studio-warn">上游创建结果待确认：{task.reviewReason || '请联系管理员在该任务的人工接管中处理。'}</p>}
    </div>
  )
}

/** 单个真实任务的卡片：状态、积分、错误原因、结果与操作。 */
/**
 * 费用文案。
 *
 * 三种情况必须分开，不能混成一句：
 *  - 已知扣费 → 「消耗 N 积分」；
 *  - 已确认终态且确实没扣费（失败/取消且未退款标记）→ 「未产生积分消耗」；
 *  - **费用未知**（结果未确认、查询失败、上游待确认、仍在进行）→ 「费用待确认」。
 * 最后一种情况后端可能已经扣费，显示「未产生积分消耗」等于给用户错误承诺。
 */
function pointsSummary(task: GenerationTaskView): string {
  if (task.pointsCost) return `消耗 ${task.pointsCost} 积分${task.pointsRefunded ? ' · 已退回' : ''}`
  const settled = task.status === 'success' || task.status === 'error' || task.status === 'cancelled'
  const uncertain = Boolean(task.unconfirmed) || task.needsReview || (task.queryFailures ?? 0) > 0
  if (uncertain || !settled) return '费用待确认（以后端账单为准）'
  return task.pointsRefunded ? '未产生积分消耗 · 已退回' : '未产生积分消耗'
}

export function GenerationTaskCard({ task, compact = false }: { task: GenerationTaskView; compact?: boolean }) {
  const unconfirmed = Boolean(task.unconfirmed) || task.id.startsWith('unconfirmed:')
  const meta = unconfirmed ? { label: '提交未确认', tone: 'warning' as Tone } : taskStatusMeta(task.status)
  const active = isActiveStatus(task.status) && !unconfirmed
  /**
   * 该错误是否是「**没问到状态**」而不是「任务失败」。
   *
   * 判据（任一成立即属于查询问题）：
   *  - 有过查询失败计数（`queryFailures > 0`）；
   *  - 已到失败上限（`queryFailures >= queryFailureLimit`）；
   *  - 错误文案本身就是查询类（兼容手动重新检查后的提示）。
   * 这类任务上游可能仍在生成，因此不能显示成「失败原因」。
   */
  const queryIssue = !unconfirmed && task.status !== 'error' && (
    (task.queryFailures ?? 0) > 0
    || /无法查询任务状态|无法确认状态|查询失败|重新检查上游/.test(task.error ?? '')
  )
  return (
    <article className="studio-surface flex flex-col gap-3 p-3" data-unconfirmed={unconfirmed ? 'true' : undefined}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{task.title}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{task.model || '未指定模型'} · {task.id.slice(0, 8)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {active && <Loader2 className="size-3.5 animate-spin text-studio-accent motion-reduce:animate-none" aria-hidden="true" />}
          {task.status === 'success' && <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />}
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
      </header>

      {task.media.length > 0 && (
        <div className={cn('grid gap-2', task.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {task.media.slice(0, compact ? 2 : 4).map((item, index) => (
            <MediaThumb key={`${item.url}-${index}`} src={item.url} poster={item.poster} alt={`${task.title} 结果 ${index + 1}`} fallback="结果未能加载" kind={item.kind === 'video' ? 'video' : 'image'} className={compact ? 'h-24 rounded-md' : 'h-40 rounded-md'} />
          ))}
        </div>
      )}

      {task.text && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-5">{task.text}</p>}

      {task.error && (
        /**
         * 三种情况必须用不同措辞与配色，否则会把「没问到状态」误导成「生成失败」：
         *  1. 未确认提交 → 中性提示（请求可能已生效，不是失败）；
         *  2. **查询失败/达到上限** → 中性提示（上游可能仍在生成，不代表失败）；
         *  3. 真实失败（后端明确拒绝或上游终态失败）→ 才用「失败原因」。
         * 早先只有 1 和 3，于是「已连续 N 次无法查询」被打上「失败原因」并标红，
         * 用户会以为任务已经失败并退款（实测被回归用例抓到）。
         */
        unconfirmed
          ? <p className="rounded-md border border-studio-warn/40 bg-studio-warn/10 p-2 text-[11px] leading-5 text-studio-warn" role="status">{task.error}</p>
          : queryIssue
            ? <p className="rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-5 text-muted-foreground" role="status" data-testid="task-query-issue">{task.error}</p>
            : <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-5 text-destructive" role="alert">失败原因：{task.error}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1" data-testid="task-points">
          <Coins className="size-3 text-studio-warn" aria-hidden="true" />
          {/**
            * 费用文案必须区分「确实没扣费」与「还不知道扣没扣」。
            *
            * 早先写成 `pointsCost ? ... : '未产生积分消耗'`，于是
            * 「结果未知 / 正在查询 / 等待上游确认」全都被显示成「未产生积分消耗」——
            * 而这时后端可能已经扣费，等于向用户承诺了一件系统并不知道的事。
            */}
          {pointsSummary(task)}
        </span>
        <span>{formatTime(task.createdAt)}</span>
      </div>

      {task.executionPhase && <p className="text-[10px] text-muted-foreground">执行阶段：{task.executionPhase}</p>}

      <TaskActions task={task} compact={compact} />
    </article>
  )
}

/**
 * 真实生成任务列表。按类型过滤后展示，并包含刷新、加载、空数据与错误状态。
 */
export function LiveTaskList({ kinds, limit = 6, compact = false, emptyHint }: { kinds?: GenerationKind[]; limit?: number; compact?: boolean; emptyHint?: string }) {
  const { tasks, loading, refresh, activeCount } = useGeneration()
  const visible = useMemo(() => {
    const list = kinds?.length ? tasks.filter((task) => kinds.includes(task.kind)) : tasks
    return list.slice(0, limit)
  }, [kinds, limit, tasks])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          真实任务 {visible.length} 条{activeCount > 0 ? ` · ${activeCount} 条进行中` : ''}
        </p>
        <ControlButton size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />刷新
        </ControlButton>
      </div>

      {loading && !visible.length && (
        <div className="studio-surface flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />正在读取后端任务
        </div>
      )}

      {visible.map((task) => <GenerationTaskCard key={task.id} task={task} compact={compact} />)}

      {!loading && !visible.length && (
        <div className="studio-surface flex flex-col items-center justify-center border-dashed py-8 text-center">
          <p className="text-xs font-medium">{emptyHint || '还没有真实生成任务'}</p>
          <p className="mt-1 max-w-sm text-[11px] leading-5 text-muted-foreground">填写参数并点击生成后，任务会提交到后端并在这里显示进度、结果与积分消耗。</p>
        </div>
      )}
    </div>
  )
}
