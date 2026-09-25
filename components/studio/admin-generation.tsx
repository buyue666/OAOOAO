'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Eye, RefreshCw, RotateCcw, ShieldAlert, Undo2 } from 'lucide-react'
import { cancelGenerationTask, listGenerationOperations, recoverGenerationTask, retryAgentSubTask, reviewGenerationTask, type ReviewAction } from '@/lib/studio/admin-api'
import type { AdminGenerationOperations, AdminGenerationTask } from '@/lib/studio/admin-types'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminCell,
  AdminDefinition,
  AdminDrawer,
  AdminError,
  AdminField,
  AdminInput,
  AdminNotice,
  AdminPagination,
  AdminRow,
  AdminSectionCard,
  AdminSelect,
  AdminStat,
  AdminTable,
  AdminTextarea,
  TableMessageRow,
  executionPhaseLabels,
  formatAdminDate,
  formatAdminDuration,
  formatAdminNumber,
  labelOf,
  statusTone,
  surfaceLabels,
  taskStatusLabels,
  taskTypeLabels,
  useConfirm,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

const statusOptions = [
  ['', '全部状态'], ['pending', '排队中'], ['running', '执行中'], ['paused', '已暂停'], ['success', '成功'], ['error', '失败'], ['cancelled', '已取消'],
] as const

export function AdminGenerationPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const canManage = session.can('generation.manage')

  const [data, setData] = useState<AdminGenerationOperations | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [acting, setActing] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminGenerationTask | null>(null)
  const [reviewing, setReviewing] = useState<AdminGenerationTask | null>(null)

  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [surface, setSurface] = useState('')
  const [channelId, setChannelId] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true); setError('')
    listGenerationOperations({ page, pageSize: 20, type, status, surface, search: query })
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : '生成记录加载失败'))
      .finally(() => setLoading(false))
  }, [page, type, status, surface, query, reloadKey])

  useEffect(() => { void load() }, [load])

  const channelOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const channel of data?.channels ?? []) ids.add(channel.id)
    return Array.from(ids).sort()
  }, [data?.channels])

  const items = useMemo(() => {
    const list = data?.items ?? []
    const from = start ? new Date(`${start}T00:00:00`).getTime() : null
    const to = end ? new Date(`${end}T23:59:59.999`).getTime() : null
    return list.filter((task) => {
      if (channelId && task.channelId !== channelId) return false
      if (from !== null && task.createdAt < from) return false
      if (to !== null && task.createdAt > to) return false
      return true
    })
  }, [channelId, data?.items, end, start])

  const runAction = useCallback(async (task: AdminGenerationTask, action: 'cancel' | 'recover' | 'retry') => {
    setActing(`${task.id}:${action}`); setError(''); setMessage('')
    try {
      if (action === 'cancel') await cancelGenerationTask(task)
      else if (action === 'recover') await recoverGenerationTask(task)
      else await retryAgentSubTask(task)
      setMessage(action === 'cancel' ? '任务已取消，上游结果不会被删除。' : action === 'recover' ? '已重新检查上游状态。' : '失败子任务已重新提交。')
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setActing(null)
    }
  }, [load])

  const requestCancel = useCallback((task: AdminGenerationTask) => {
    confirm.confirm({
      title: '取消该生成任务？',
      description: '仅终止本地调度与计费，不会删除上游已经产生的素材。仍在处理中的任务不会被删除。',
      confirmLabel: '确认取消任务',
      tone: 'danger',
      onConfirm: () => runAction(task, 'cancel'),
    })
  }, [confirm, runAction])

  const summary = data?.summary
  const upstreamSucceededDownstreamFailed = items.filter((task) => task.status === 'error' && task.leaseExpired && task.upstreamTaskId).length

  return (
    <div className="flex flex-col gap-5">
      {confirm.dialog}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStat label="记录总数" value={formatAdminNumber(summary?.total)} detail="当前查询范围" />
        <AdminStat label="进行中" value={formatAdminNumber(summary?.active)} detail={`排队 ${formatAdminNumber(summary?.byStatus.pending)} · 执行 ${formatAdminNumber(summary?.byStatus.running)}`} tone="warning" />
        <AdminStat label="成功 / 失败" value={`${formatAdminNumber(summary?.success)} / ${formatAdminNumber(summary?.failed)}`} detail={`平均耗时 ${formatAdminDuration(summary?.averageDurationMs)}`} tone="success" />
        <AdminStat label="积分消耗" value={formatAdminNumber(summary?.totalPointsCost)} detail="实际记录的消耗合计" />
      </div>

      <AdminSectionCard title="查询条件" description="按用户、模型、渠道、任务类型、状态和时间筛选。时间与渠道为本地过滤，其余条件由后端过滤。">
        <div className="flex flex-wrap items-end gap-2">
          <AdminField label="关键词" className="w-full sm:w-64">
            <AdminInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="用户、模型或提示词" onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); setQuery(search) } }} />
          </AdminField>
          <AdminField label="任务类型" className="w-36">
            <AdminSelect value={type} onChange={(event) => { setPage(1); setType(event.target.value) }}>
              <option value="">全部类型</option><option value="agent">导演 Agent</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option><option value="text">文本</option>
            </AdminSelect>
          </AdminField>
          <AdminField label="状态" className="w-32">
            <AdminSelect value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }}>
              {statusOptions.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </AdminSelect>
          </AdminField>
          <AdminField label="来源" className="w-32">
            <AdminSelect value={surface} onChange={(event) => { setPage(1); setSurface(event.target.value) }}>
              <option value="">全部来源</option><option value="chat">对话</option><option value="canvas">画布</option><option value="drama">短剧</option>
            </AdminSelect>
          </AdminField>
          <AdminField label="渠道" className="w-40">
            <AdminSelect value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              <option value="">全部渠道</option>
              {channelOptions.map((id) => <option key={id} value={id}>{id}</option>)}
            </AdminSelect>
          </AdminField>
          <AdminField label="开始日期" className="w-40"><AdminInput type="date" value={start} onChange={(event) => setStart(event.target.value)} /></AdminField>
          <AdminField label="结束日期" className="w-40"><AdminInput type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></AdminField>
          <ControlButton variant="primary" onClick={() => { setPage(1); setQuery(search) }}>查询</ControlButton>
          <ControlButton variant="secondary" onClick={() => { setStart(''); setEnd(''); setChannelId(''); setSurface(''); setStatus(''); setType(''); setSearch(''); setQuery(''); setPage(1) }}>重置</ControlButton>
          <ControlButton variant="secondary" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>
        </div>
      </AdminSectionCard>

      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}
      {upstreamSucceededDownstreamFailed > 0 && (
        <AdminNotice tone="warning">检测到 {upstreamSucceededDownstreamFailed} 条任务上游已返回任务 ID 但本地执行失败或超时，请展开详情执行“重新检查上游”或“人工确认”。</AdminNotice>
      )}

      <AdminTable columns={['请求', '用户', '模型 / 渠道', '状态', '执行阶段', '耗时', '积分', '时间', '操作']} minWidth={1180} caption="生成任务列表">
        {items.map((task) => (
          <AdminRow key={task.id}>
            <AdminCell className="max-w-[260px]">
              <p className="truncate font-medium" title={task.prompt}>{task.prompt || task.id}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{task.id.slice(0, 8)} · {labelOf(taskTypeLabels, task.type)}{task.surface ? ` · ${labelOf(surfaceLabels, task.surface)}` : ''}</p>
            </AdminCell>
            <AdminCell className="text-xs">{task.displayName || task.username || '-'}{task.accountId ? <span className="mt-1 block font-mono text-[11px] text-muted-foreground">#{task.accountId}</span> : null}</AdminCell>
            <AdminCell className="max-w-[200px]">
              <p className="truncate text-xs">{task.model || '-'}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{task.channelId || task.provider || '-'}</p>
            </AdminCell>
            <AdminCell>
              <StatusBadge tone={statusTone(task.status)}>{labelOf(taskStatusLabels, task.status)}</StatusBadge>
              {task.error && <p className="mt-1 max-w-52 truncate text-[11px] text-destructive" title={task.error}>{task.error}</p>}
            </AdminCell>
            <AdminCell className="text-xs">
              <span>{labelOf(executionPhaseLabels, task.executionPhase)}</span>
              {task.leaseExpired && <p className="mt-1 text-[11px] text-studio-warn">租约已超时</p>}
              {task.lastUpstreamStatus && <p className="mt-1 text-[11px] text-muted-foreground">上游：{task.lastUpstreamStatus}</p>}
            </AdminCell>
            <AdminCell className="text-xs">{formatAdminDuration(task.durationMs)}</AdminCell>
            <AdminCell className="text-xs">{formatAdminNumber(task.pointsCost)}</AdminCell>
            <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(task.createdAt)}</AdminCell>
            <AdminCell>
              <div className="flex flex-wrap items-center gap-1.5">
                <ControlButton variant="secondary" size="sm" onClick={() => setDetail(task)}><Eye className="size-3.5" />详情</ControlButton>
                {canManage && task.canCancel && (
                  <ControlButton variant="danger" size="sm" disabled={acting === `${task.id}:cancel`} onClick={() => requestCancel(task)}><Ban className="size-3.5" />取消</ControlButton>
                )}
                {canManage && (task.status === 'error' || task.leaseExpired) && ['text', 'image', 'video', 'audio'].includes(task.type) && (
                  <ControlButton variant="secondary" size="sm" disabled={acting === `${task.id}:recover`} onClick={() => void runAction(task, 'recover')}><Undo2 className="size-3.5" />重新检查</ControlButton>
                )}
                {canManage && task.type === 'agent' && task.retryTaskId && (
                  <ControlButton variant="secondary" size="sm" disabled={acting === `${task.id}:retry`} onClick={() => void runAction(task, 'retry')}><RotateCcw className="size-3.5" />重试子任务</ControlButton>
                )}
                {canManage && task.canReview && (
                  <ControlButton variant="primary" size="sm" onClick={() => setReviewing(task)}><ShieldAlert className="size-3.5" />人工确认</ControlButton>
                )}
              </div>
            </AdminCell>
          </AdminRow>
        ))}
        {!items.length && <TableMessageRow colSpan={9} loading={loading} error={error} empty="没有匹配的生成记录" />}
      </AdminTable>

      <AdminPagination page={page} pageSize={20} total={data?.total ?? 0} loading={loading} onChange={setPage} />

      {detail && <TaskDetailDrawer task={detail} onClose={() => setDetail(null)} onReview={canManage && detail.canReview ? () => { setReviewing(detail); setDetail(null) } : undefined} />}
      {reviewing && <ReviewDialog task={reviewing} onClose={() => setReviewing(null)} onDone={(text) => { setMessage(text); setReviewing(null); load() }} />}
    </div>
  )
}

function TaskDetailDrawer({ task, onClose, onReview }: { task: AdminGenerationTask; onClose: () => void; onReview?: () => void }) {
  return (
    <AdminDrawer
      open
      onClose={onClose}
      title="任务详情"
      description={`${task.id}`}
      footer={onReview ? <ControlButton variant="primary" onClick={onReview}><ShieldAlert className="size-3.5" />人工确认</ControlButton> : undefined}
    >
      <div className="flex flex-col gap-4">
        <AdminSectionCard title="任务状态" className="p-4">
          <AdminDefinition label="状态" value={<StatusBadge tone={statusTone(task.status)}>{labelOf(taskStatusLabels, task.status)}</StatusBadge>} />
          <AdminDefinition label="执行阶段" value={labelOf(executionPhaseLabels, task.executionPhase)} />
          <AdminDefinition label="上游状态" value={task.lastUpstreamStatus} />
          <AdminDefinition label="租约" value={task.leaseExpired ? `已超时（${formatAdminDate(task.leaseUntil)}）` : formatAdminDate(task.leaseUntil)} />
          <AdminDefinition label="最近心跳" value={formatAdminDate(task.lastHeartbeatAt)} />
          <AdminDefinition label="最近轮询" value={formatAdminDate(task.lastPollAt)} />
          <AdminDefinition label="下次轮询" value={formatAdminDate(task.nextPollAt)} />
          <AdminDefinition label="Worker" value={task.workerId} mono />
          <AdminDefinition label="上游任务 ID" value={task.upstreamTaskId} mono />
        </AdminSectionCard>

        <AdminSectionCard title="请求信息" className="p-4">
          <AdminDefinition label="请求 ID" value={task.id} mono />
          <AdminDefinition label="用户" value={`${task.displayName || task.username || '-'}${task.accountId ? ` (#${task.accountId})` : ''}`} />
          <AdminDefinition label="任务类型" value={labelOf(taskTypeLabels, task.type)} />
          <AdminDefinition label="来源" value={labelOf(surfaceLabels, task.surface)} />
          <AdminDefinition label="逻辑模型" value={task.model} />
          <AdminDefinition label="渠道 / 协议" value={`${task.channelId || '-'} · ${task.provider || '-'}`} />
          <AdminDefinition label="耗时" value={formatAdminDuration(task.durationMs)} />
          <AdminDefinition label="积分消耗" value={task.pointsBreakdown ? `合计 ${formatAdminNumber(task.pointsBreakdown.total)}（规划 ${formatAdminNumber(task.pointsBreakdown.planner)} · 子任务 ${formatAdminNumber(task.pointsBreakdown.childTasks)}）` : formatAdminNumber(task.pointsCost)} />
          <AdminDefinition label="创建时间" value={formatAdminDate(task.createdAt)} />
          <AdminDefinition label="更新时间" value={formatAdminDate(task.updatedAt)} />
          <AdminDefinition label="运行标识" value={task.runId} mono />
        </AdminSectionCard>

        <AdminSectionCard title="完整请求内容" className="p-4">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 text-xs leading-5">{task.prompt || '该任务没有保存提示词内容。'}</pre>
        </AdminSectionCard>

        {task.error && (
          <AdminSectionCard title="错误原因" className="p-4">
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">{task.error}</pre>
          </AdminSectionCard>
        )}

        <AdminSectionCard title="上游尝试记录" description="每次重试都会记录渠道、模型、耗时与结果。" className="p-4">
          {task.attempts?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="text-muted-foreground"><tr>{['次数', '渠道', '模型', '结果', '耗时', '积分'].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {task.attempts.map((attempt) => (
                    <tr key={attempt.attemptNo} className="border-t border-border">
                      <td className="py-2 pr-3">#{attempt.attemptNo}</td>
                      <td className="py-2 pr-3 font-mono">{attempt.channelId || '-'}</td>
                      <td className="max-w-[140px] truncate py-2 pr-3">{attempt.model || '-'}</td>
                      <td className="py-2 pr-3"><StatusBadge tone={statusTone(attempt.status)}>{attempt.status === 'succeeded' ? '成功' : attempt.status === 'failed' ? '失败' : '执行中'}</StatusBadge>{attempt.error && <p className="mt-1 max-w-52 truncate text-destructive" title={attempt.error}>{attempt.error}</p>}</td>
                      <td className="py-2 pr-3">{formatAdminDuration(attempt.completedAt && attempt.startedAt ? attempt.completedAt - attempt.startedAt : undefined)}</td>
                      <td className="py-2 pr-3">{formatAdminNumber(attempt.pointsCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-muted-foreground">该任务没有重试记录。</p>}
        </AdminSectionCard>

        <AdminSectionCard title="退款与补偿状态" description="积分退还会在任务失败时由后台自动执行，可在此核对当前结果。" className="p-4">
          <AdminDefinition label="积分消耗" value={formatAdminNumber(task.pointsCost)} />
          <AdminDefinition label="任务结果" value={task.status === 'error' ? '失败，后台将按计费规则处理退款' : task.status === 'cancelled' ? '已取消，未消耗不予扣费' : '成功，已正常结算'} />
          <AdminDefinition label="上游任务 ID" value={task.upstreamTaskId ? '已保存，可用于追回结果' : '未保存'} />
        </AdminSectionCard>
      </div>
    </AdminDrawer>
  )
}

function ReviewDialog({ task, onClose, onDone }: { task: AdminGenerationTask; onClose: () => void; onDone: (message: string) => void }) {
  const [action, setAction] = useState<ReviewAction['action']>('resume_upstream')
  const [value, setValue] = useState(task.upstreamTaskId || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true); setError('')
    try {
      const payload: ReviewAction = action === 'resume_upstream'
        ? { action, upstreamTaskId: value.trim() }
        : action === 'provide_result'
          ? { action, result: value.trim() }
          : { action, reason: value.trim() || undefined }
      if (action !== 'confirm_failed' && !value.trim()) throw new Error(action === 'resume_upstream' ? '请填写上游任务 ID' : '请填写结果地址或文本')
      await reviewGenerationTask(task, payload)
      onDone(action === 'confirm_failed' ? '任务已确认失败并结束。' : '已交给后台继续处理。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '接管失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminDrawer
      open
      onClose={onClose}
      width="sm:max-w-lg"
      title="人工确认待处理任务"
      description="创建请求的结果无法自动确认时，系统会停止重复创建，由管理员决定后续动作。"
      footer={<>
        <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
        <ControlButton variant={action === 'confirm_failed' ? 'danger' : 'primary'} onClick={() => void submit()} disabled={busy}>{busy ? '处理中' : action === 'confirm_failed' ? '确认结束任务' : '确认并继续'}</ControlButton>
      </>}
    >
      <div className="flex flex-col gap-4">
        <AdminNotice tone="warning">接管操作只会继续查询、补录已有结果或明确结束任务，不会重复创建新的上游任务。</AdminNotice>
        <AdminField label="处理方式">
          <AdminSelect value={action} onChange={(event) => { const next = event.target.value as ReviewAction['action']; setAction(next); setValue(next === 'resume_upstream' ? (task.upstreamTaskId || '') : '') }}>
            <option value="resume_upstream">继续查询上游任务</option>
            <option value="provide_result">补录已有结果</option>
            <option value="confirm_failed">确认上游未创建，结束任务</option>
          </AdminSelect>
        </AdminField>
        {action === 'confirm_failed'
          ? <AdminField label="结束原因" hint="可选，将写入任务错误信息与审计日志。"><AdminTextarea rows={3} value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如：上游确认未创建任务" /></AdminField>
          : <AdminField label={action === 'resume_upstream' ? '上游任务 ID' : '结果地址或文本'} hint={action === 'provide_result' ? '文本任务填文本内容，媒体任务填 https(s)、data: 或站内媒体路径。' : '用于继续轮询的上游任务标识。'}>
            <AdminInput value={value} onChange={(event) => setValue(event.target.value)} />
          </AdminField>}
        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
      </div>
    </AdminDrawer>
  )
}
