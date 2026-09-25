'use client'

/**
 * OAOOAO 真实生成任务状态。
 *
 * 设计要点：
 * - 任务列表由后端返回，本地只保留最近任务 ID 以便刷新后恢复（localStorage）。
 * - 活跃任务通过轮询后端详情推进状态，成功/失败/取消后停止轮询。
 * - 未登录时任务创建会被后端拒绝，这里把错误原样抛出，不伪造成功。
 * - 积分余额优先使用后端响应头返回的实时值，避免前端自行推断扣费。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  cancelGenerationTask as cancelTaskRequest,
  classifyOutcome,
  createAgentRun,
  createAudioTask,
  createImageTask,
  createTextTask,
  createVideoTask,
  getAgentRun,
  getGenerationTask,
  isActiveStatus,
  isTerminalStatus,
  newClientRequestId,
  normalizeTaskResult,
  outcomeOfTask,
  recoverGenerationTask as recoverTaskRequest,
  retryAgentRunTask,
  type RequestOutcome,
} from './generation-api'
import type {
  AgentRun,
  AudioGenerationInput,
  GenerationKind,
  GenerationStatus,
  GenerationTask,
  GenerationTaskView,
  ImageGenerationInput,
  PointsSnapshot,
  RetryInput,
  TextGenerationInput,
  VideoGenerationInput,
} from './generation-types'
import { getSession, StudioApiError } from './api'
import { bumpAccountData } from './account-data-sync'
import { useStudio } from './store'
import {
  readCachedTasks,
  writeCachedTasks,
  readPendingSubmissions as readPendingSubmissionsFromCache,
  writePendingSubmissions as writePendingSubmissionsToCache,
} from './task-cache'

const storageKey = 'oaooao-live-tasks'
/** 轮询间隔：正常 2.5 秒，查询失败后按指数退避到 30 秒，避免持续打后端。 */
const POLL_INTERVAL_MS = 2500
const POLL_BACKOFF_MAX_MS = 30_000
/**
 * 定时器步长。
 *
 * 固定步长只负责「叫醒」检查，真正决定某个任务这次查不查的是它自己的
 * `nextPollAt`（按任务独立退避）。早先用「全局退避间隔 + 一次性查询所有任务」，
 * 导致单个任务的失败会拖慢健康任务，且已达失败上限的任务仍被批量查询。
 */
const POLL_TICK_MS = 1000
/**
 * 单个任务的最长等待时间从**任务在后端的开始时间**起算，
 * 而不是从组件挂载或刷新页面起算，否则刷新页面就会重置等待窗口。
 */
const MAX_TASK_AGE_MS = 45 * 60 * 1000
/** 查询连续失败到该次数后停止自动轮询，改为需要用户手动重新检查。 */
const MAX_QUERY_FAILURES = 6

/**
 * 同一次用户操作允许并发提交的最大批次。
 *
 * 批量生图需要同时提交多个任务（后端一次只产出一张），因此提交锁必须是
 * **按批次**而不是全局单请求：否则批量的第 2 个请求会被自己的锁拒绝。
 * 上限用于防止误用（例如循环里无限提交）。
 */
const MAX_CONCURRENT_SUBMITS = 8

type LocalTask = {
  id: string
  kind: GenerationKind
  title: string
  prompt: string
  model: string
  createdAt: number
  retryInput?: RetryInput
  /** 后端给出的任务开始时间，用于跨刷新计算真实等待时长。 */
  startedAt?: number
  /** 本次创作的幂等标识；网络重试必须复用同一个值。 */
  clientRequestId: string
  attemptNo?: number
  /**
   * 未确认提交：请求可能已到达后端但响应丢失。
   *
   * 此时**没有服务器任务 ID**，`id` 仅作为本地占位标识（等于 clientRequestId）。
   * 这类记录必须进入可见任务列表，否则用户找不到恢复入口；
   * 并且绝不能用这个 `id` 去调用任务详情接口。
   */
  unconfirmed?: boolean
  /**
   * 发起该提交的账号。
   *
   * 缓存键本身已按账号隔离，这里再显式记一份：
   * 恢复入口、缓存内容与「重新提交」都必须能判断「这条记录是否属于当前账号」，
   * 不能仅依赖「键名恰好对上」。
   */
  ownerUserId?: string
}

/** 未确认占位记录的本地 ID 前缀：用于与真实服务器任务 ID 区分。 */
const UNCONFIRMED_PREFIX = 'unconfirmed:'

function unconfirmedLocalId(clientRequestId: string) {
  return `${UNCONFIRMED_PREFIX}${clientRequestId}`
}

function isUnconfirmedId(id: string) {
  return id.startsWith(UNCONFIRMED_PREFIX)
}

export type GenerationError = {
  message: string
  status?: number
  code?: 'unauthenticated' | 'insufficient' | 'conflict' | 'unknown'
  /** 本次错误对应的请求性质；unavailable 表示结果未知。 */
  outcome?: RequestOutcome
  /** true 表示不能据此判断任务失败，需要重试或手动重新检查。 */
  indeterminate?: boolean
  taskId?: string
}

export type GenerationContextValue = {
  /** 后端返回的真实任务；本地仅保存标题等展示信息。 */
  tasks: GenerationTaskView[]
  activeCount: number
  loading: boolean
  lastError: GenerationError | null
  lastNotice: string | null
  points: PointsSnapshot | null
  /** 后端不可用或未登录时为 true，页面据此显示“本地预览”。 */
  localOnly: boolean
  running: boolean
  /** 查询侧是否处于「结果未知」状态：上游可能仍在生成，不能当成失败。 */
  queryUnavailable: boolean
  createImage: (input: ImageGenerationInput) => Promise<GenerationTaskView>
  createVideo: (input: VideoGenerationInput) => Promise<GenerationTaskView>
  createAudio: (input: AudioGenerationInput) => Promise<GenerationTaskView>
  createText: (input: TextGenerationInput) => Promise<GenerationTaskView>
  runAgent: (input: { prompt: string; surface: 'chat' | 'canvas' | 'drama'; projectId?: string; assetIds?: string[] }) => Promise<AgentRun>
  getAgent: (id: string) => Promise<AgentRun>
  cancelAgent: (run: AgentRun, action: 'pause' | 'resume' | 'retry' | 'cancel') => Promise<AgentRun>
  cancelTask: (task: GenerationTaskView) => Promise<void>
  retryTask: (task: GenerationTaskView) => Promise<void>
  recoverTask: (task: GenerationTaskView) => Promise<void>
  retryAgentTask: (runId: string, taskId: string) => Promise<void>
  refresh: () => Promise<void>
  dismissError: () => void
  setNotice: (text: string | null) => void
  /** 重新提交一个「结果未知」的创建请求，复用原 clientRequestId 避免重复扣费。 */
  resubmit: (task: GenerationTaskView) => Promise<void>
  /** 是否存在可安全恢复的未确认提交（决定界面是否显示「重新提交」）。 */
  canResubmit: (task: GenerationTaskView) => boolean
}

const GenerationContext = createContext<GenerationContextValue | null>(null)

/* ------------------------------ 本地缓存（按账号隔离） ------------------------------ */

// 缓存读写实现见 `./task-cache`：那里是纯存储逻辑，且被 store 复用于
// 「退出登录 / 切换账号时清理上一个账号的任务缓存」。
const readLocalTasks = (userId: string | null) => readCachedTasks<LocalTask>(userId)
const writeLocalTasks = (userId: string | null, tasks: LocalTask[]) => writeCachedTasks(userId, tasks)
const readPendingSubmissions = (userId: string | null) => readPendingSubmissionsFromCache<LocalTask>(userId)
const writePendingSubmissions = (userId: string | null, pending: Map<string, LocalTask>) => writePendingSubmissionsToCache(userId, pending)

function toError(reason: unknown, taskId?: string): GenerationError {
  if (reason instanceof StudioApiError) {
    /**
     * 402 是「余额/配额不足」：确定性拒绝，不是网络问题。
     * 早先后端用 429 表示积分不足，客户端把它归到「结果未知」，
     * 于是界面提示「稍后重试」并自动重试——而余额不足重试不会成功。
     */
    const insufficient = reason.status === 402 || /积分不足|余额不足|配额不足/.test(reason.message)
    const code: GenerationError['code'] = reason.status === 401 ? 'unauthenticated' : insufficient || reason.status === 403 ? 'insufficient' : reason.status === 409 ? 'conflict' : 'unknown'
    const outcome = reason.outcome
    return { message: reason.message, status: reason.status, code, outcome: outcome === 'unknown' ? undefined : outcome, indeterminate: reason.isIndeterminate, taskId }
  }
  // 非 StudioApiError 的异常（含 fetch 抛出的网络错误）同样属于结果未知。
  return { message: reason instanceof Error ? reason.message : '生成请求失败', code: 'unknown', outcome: 'unavailable', indeterminate: true, taskId }
}

/** `toView` 需要的展示信息：本地记录和已有任务视图都能满足。 */
type ViewSeed = {
  title?: string
  prompt?: string
  model?: string
  createdAt?: number
  startedAt?: number
  retryInput?: RetryInput
}

/** 后端不一定返回 createdAt；用本地记录兜底，保证等待窗口不会因刷新而无限延长。 */
function taskStartedAt(task: GenerationTask, local: ViewSeed | undefined) {
  const remote = Number((task as { createdAt?: unknown }).createdAt)
  if (Number.isFinite(remote) && remote > 0) return remote
  return local?.startedAt || local?.createdAt || Date.now()
}

function toView(kind: GenerationKind, task: GenerationTask, local: ViewSeed | undefined): GenerationTaskView {
  const { media, text } = normalizeTaskResult(kind, task.result)
  const pointsCost = Number(task.pointsCost) || 0
  return {
    ...task,
    kind,
    title: local?.title || task.model || `${kind} 任务`,
    prompt: local?.prompt || '',
    // 任务开始时间来自后端或本地首次记录，跨刷新保持稳定。
    createdAt: taskStartedAt(task, local),
    updatedAt: Date.now(),
    media,
    text,
    pointsCost,
    retryInput: local?.retryInput,
  }
}

export function GenerationProvider({ children }: { children: ReactNode }) {
  const { state: studioState, refreshSession } = useStudio()
  /**
   * 当前账号标识：所有本地缓存与在途请求都绑定它。
   * 账号变化时必须废弃旧账号的异步结果，否则 A 的响应会写进 B 的界面。
   */
  const userId = studioState.user.id || null
  const sessionEpochRef = useRef(0)
  /**
   * 当前账号标识的**实时引用**。
   *
   * `userId` 是渲染期的闭包值；异步回调（迟到响应）里读到的可能是旧的闭包。
   * 判断「这次响应是否还属于当前账号」必须读 ref，否则退出再登录后
   * 仍会拿旧闭包与旧 epoch 比较，得出错误的「仍然有效」结论。
   */
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  const [localTasks, setLocalTasks] = useState<LocalTask[]>([])
  const [tasks, setTasks] = useState<GenerationTaskView[]>([])
  const [points, setPoints] = useState<PointsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [localOnly, setLocalOnly] = useState(false)
  const [queryUnavailable, setQueryUnavailable] = useState(false)
  const [lastError, setLastError] = useState<GenerationError | null>(null)
  const [lastNotice, setLastNotice] = useState<string | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const pollingRef = useRef(false)
  /**
   * 在途创建请求计数。
   *
   * 批量提交会并发发起多个创建请求，因此不能用布尔锁（会拒绝自己的批次）。
   * 这里改成计数 + 上限：既阻止「双击产生两条任务」，也允许一次合法批量。
   * 用户侧的双击防护由工作台的提交按钮禁用共同保证。
   */
  const inflightSubmitsRef = useRef(0)
  /** 每个任务连续查询失败的次数，用于指数退避与停止自动轮询。 */
  const queryFailuresRef = useRef(new Map<string, number>())
  /**
   * 每个任务的下一次可查询时间戳（按任务独立退避）。
   *
   * 与 `queryFailuresRef` 配合：失败次数决定退避长度，该时间戳决定
   * 「这一轮要不要查这个任务」。因此一个任务的失败不会拖慢其他任务，
   * 达到上限的任务也不会因为别人还活跃而被继续查询。
   */
  const nextPollAtRef = useRef(new Map<string, number>())
  /** 保留结果未知的任务 ID，供手动恢复使用。 */
  const indeterminateRef = useRef(new Set<string>())
  /** 未确认提交：key 为 clientRequestId，持久化后刷新仍可安全重试。 */
  const pendingSubmissionsRef = useRef(new Map<string, LocalTask>())
  /**
   * 未确认占位任务（可见状态）。
   *
   * 这是「未确认提交」接入界面的关键：只把请求存进 ref/缓存是不够的，
   * 用户看不到、点不到。这里把它作为一等任务状态暴露出去，
   * 并随账号变化从缓存重建，因此刷新后仍然可见可操作。
   */
  const [unconfirmedTasks, setUnconfirmedTasks] = useState<GenerationTaskView[]>([])

  /** 把未确认提交转换成可见的占位任务视图（状态为 pending，且带可恢复标记）。 */
  const unconfirmedToView = useCallback((local: LocalTask): GenerationTaskView => ({
    id: unconfirmedLocalId(local.clientRequestId),
    kind: local.kind,
    status: 'pending',
    model: local.model,
    title: local.title,
    prompt: local.prompt,
    createdAt: local.startedAt || local.createdAt || Date.now(),
    updatedAt: Date.now(),
    media: [],
    pointsCost: 0,
    retryInput: local.retryInput,
    // 这些字段驱动界面显示「提交结果未确认」与「重新提交」入口。
    unconfirmed: true,
    canRetry: false,
    error: '提交结果未确认：请求可能已经生效，服务端可能已创建任务。请点击「重新提交」按同一标识重试，系统不会重复创建任务或重复扣费。',
  } as GenerationTaskView), [])

  /**
   * 从 pending 映射重建可见占位任务。
   *
   * 额外按 `ownerUserId` 过滤：映射本身已随账号切换重建，
   * 但缓存读取、并发写入都可能带入别的账号的条目，
   * 因此这里再做一次归属校验，**只展示属于当前账号的未确认提交**。
   */
  const syncUnconfirmedTasks = useCallback(() => {
    const currentUserId = userIdRef.current
    setUnconfirmedTasks(
      [...pendingSubmissionsRef.current.values()]
        .filter((item) => !item.ownerUserId || !currentUserId || item.ownerUserId === currentUserId)
        .map(unconfirmedToView),
    )
  }, [unconfirmedToView])

  // 账号切换：重载该账号的缓存与未确认提交，并废弃上一个账号的在途结果。
  useEffect(() => {
    sessionEpochRef.current += 1
    /**
     * 通知账户数据 hooks：账户已变，在途响应一律作废并重新读取。
     * 只清空本组件状态是不够的——作品/历史/流水等 hooks 各自持有在途请求，
     * 上一个账号的迟到响应会把旧数据写进新账号界面。
     */
    bumpAccountData()
    setLocalTasks(readLocalTasks(userId))
    pendingSubmissionsRef.current = readPendingSubmissions(userId)
    // 刷新后必须能从缓存恢复可见的未确认占位，否则用户找不到恢复入口。
    syncUnconfirmedTasks()
    queryFailuresRef.current = new Map()
    nextPollAtRef.current = new Map()
    indeterminateRef.current = new Set()
    // 切换账号时清空展示状态，避免上一个账号的任务短暂出现在新账号界面。
    setTasks([])
    setPoints(null)
    setQueryUnavailable(false)
    setLastError(null)
    setLastNotice(null)
  }, [syncUnconfirmedTasks, userId])

  const remember = useCallback((entry: LocalTask) => {
    setLocalTasks((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 60)
      writeLocalTasks(userId, next)
      return next
    })
  }, [userId])

  const applyPoints = useCallback((snapshot: PointsSnapshot) => {
    if (snapshot.remaining === undefined && snapshot.permanent === undefined && snapshot.daily === undefined) return
    setPoints((current) => ({ ...current, ...snapshot }))
  }, [])

  /**
   * 从后端刷新一个任务；返回 null 表示任务在后端已不存在。
   *
   * `epoch` 是发起请求时的会话世代：响应回来时若账号已切换，
   * **不得写入任何状态**——不只是 `setTasks`，`applyPoints` 与提示也会污染新账号
   * （积分是账号级数据，把 A 的余额写进 B 的界面属于串号）。
   * 因此这里把 epoch 作为必需参数，并在写状态前逐处校验。
   */
  const loadTask = useCallback(async (kind: GenerationKind, id: string, local: LocalTask | undefined, epoch: number): Promise<GenerationTaskView | null> => {
    if (kind === 'agent') return null
    const response = await getGenerationTask(kind, id)
    const stale = epoch !== sessionEpochRef.current
    if (stale) return null
    applyPoints(response.points)
    if (response.data?.task?.warning) setLastNotice(String(response.data.task.warning))
    return toView(kind, response.data.task, local)
  }, [applyPoints])

  /**
   * 轮询所有活跃任务。
   *
   * 查询失败不再被当成任务失败：
   * - 5xx / 429 / 网络中断 → 保留任务原状态，标记为「结果未知」并指数退避重试；
   * - 404 → 任务在后端不存在（已过期清理），标注为不可用；
   * - 401/403 → 会话失效，停止轮询并提示重新登录；
   * - 超过最大失败次数 → 停止自动轮询，保留状态等待用户手动重新检查。
   */
  const refresh = useCallback(async () => {
    if (pollingRef.current) return
    const epoch = sessionEpochRef.current
    /**
     * 只轮询**已确认**的任务。
     *
     * 未确认占位没有服务器任务 ID（其 `id` 是本地占位标识），
     * 拿它去查询会打到错误路径 / 返回 404，必须排除。
     */
    const all = readLocalTasks(userId).filter((entry) => !entry.unconfirmed && !isUnconfirmedId(entry.id))
    /**
     * **按任务**决定本次要不要查询。
     *
     * 早先只用一个全局间隔，然后一次性查询所有任务，于是：
     *  - 某个任务已经连续失败到上限（应停止轮询），
     *    但只要还有别的任务活跃，它仍然会被继续批量查询，失败上限形同虚设；
     *  - 退避间隔取「最慢的那个任务」，导致健康的任务也被拖慢。
     * 现在每个任务自带 `nextPollAt`，到点才查、到达上限直接跳过。
     */
    const due = all.filter((entry) => {
      const failures = queryFailuresRef.current.get(entry.id) ?? 0
      if (failures >= MAX_QUERY_FAILURES) return false
      return (nextPollAtRef.current.get(entry.id) ?? 0) <= Date.now()
    })
    if (!due.length) {
      /**
       * 没有到期的任务：如果所有任务都已达上限，清掉当前的展示列表即可；
       * 仍有任务在等待下一轮时保留原状态，由定时器稍后再查。
       */
      if (all.every((entry) => (queryFailuresRef.current.get(entry.id) ?? 0) >= MAX_QUERY_FAILURES) && all.length) {
        const known = tasks.filter((task) => all.some((item) => item.id === task.id))
        if (known.length) setTasks(known)
      }
      return
    }
    pollingRef.current = true
    setLoading(true)
    try {
      let sawIndeterminate = false
      const settled = await Promise.all(due.map(async (entry) => {
        try {
          const view = await loadTask(entry.kind, entry.id, entry, epoch)
          // 账号已切换：丢弃该任务的任何状态更新（包括失败计数）。
          if (epoch !== sessionEpochRef.current) return null
          queryFailuresRef.current.delete(entry.id)
          indeterminateRef.current.delete(entry.id)
          // 成功后回到正常间隔。
          nextPollAtRef.current.set(entry.id, Date.now() + POLL_INTERVAL_MS)
          return view
        } catch (reason) {
          // 请求期间切换了账号：不写任何状态。
          if (epoch !== sessionEpochRef.current) return null
          const error = toError(reason, entry.id)
          if (error.code === 'unauthenticated') {
            setLastError(error)
            setLocalOnly(true)
            // 会话失效时保留上一次已知状态，不把任务改写成失败。
            return tasks.find((item) => item.id === entry.id) ?? null
          }
          if (error.outcome === 'not-found') {
            queryFailuresRef.current.delete(entry.id)
            nextPollAtRef.current.delete(entry.id)
            return toView(entry.kind, { id: entry.id, kind: entry.kind, status: 'error', model: entry.model, error: '任务在后端已不存在或已过期' }, entry)
          }
          if (error.indeterminate) {
            sawIndeterminate = true
            indeterminateRef.current.add(entry.id)
            const failures = (queryFailuresRef.current.get(entry.id) || 0) + 1
            queryFailuresRef.current.set(entry.id, failures)
            /**
             * 该任务自己的退避：失败越多间隔越长（2.5s → 5s → 10s → 20s → 30s）。
             * 这是「按任务独立退避」的落点，与其他任务的失败次数无关。
             */
            const backoff = Math.min(POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS * 2 ** Math.min(failures, 4))
            nextPollAtRef.current.set(entry.id, Date.now() + backoff)
            const known = tasks.find((item) => item.id === entry.id)
            // 已经拿到终态的任务不因一次查询失败而回退。
            if (known && isTerminalStatus(known.status)) return known
            const base = known ?? toView(entry.kind, { id: entry.id, kind: entry.kind, status: 'pending', model: entry.model }, entry)
            return {
              ...base,
              error: failures >= MAX_QUERY_FAILURES
                ? `已连续 ${failures} 次无法查询任务状态（${error.message}）。已停止自动重试，请手动重新检查上游是否已产生结果。`
                : `暂时无法查询任务状态（${error.message}）。上游可能仍在生成，系统会自动重试；也可以手动重新检查。`,
              queryFailures: failures,
              queryFailureLimit: MAX_QUERY_FAILURES,
              canRetry: false,
            } as GenerationTaskView
          }
          queryFailuresRef.current.delete(entry.id)
          nextPollAtRef.current.delete(entry.id)
          return toView(entry.kind, { id: entry.id, kind: entry.kind, status: 'error', model: entry.model, error: error.message }, entry)
        }
      }))
      // 账号已切换时丢弃这批结果，避免旧账号的数据写进新账号界面。
      if (epoch !== sessionEpochRef.current) return
      /**
       * 合并：本次查询到的任务更新状态，未到期的任务保留上一次结果。
       * 早先直接 `setTasks(next)` 会把「没查的任务」整体删掉，
       * 于是退避中的任务会从界面上消失。
       */
      const updated = settled.filter((item): item is GenerationTaskView => Boolean(item))
      const updatedIds = new Set(updated.map((item) => item.id))
      const kept = tasks.filter((task) => !updatedIds.has(task.id) && all.some((entry) => entry.id === task.id))
      const merged = [...updated, ...kept]
      merged.sort((a, b) => b.createdAt - a.createdAt)
      setTasks(merged)
      setQueryUnavailable(sawIndeterminate)
      setLocalOnly(false)
    } finally {
      pollingRef.current = false
      setLoading(false)
    }
  }, [loadTask, tasks, userId])

  useEffect(() => {
    if (!localTasks.length) { setTasks([]); return }
    void refresh()
    // 仅在任务集合变化时重新拉取；refresh 自身随 tasks 变化，避免把它放进依赖造成循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTasks.length, userId])

  /**
   * 自适应轮询。
   *
   * 关键：判定「是否继续轮询」与「退避多久」都**按任务**计算。
   * 定时器用固定的小步长（1 秒）只负责「叫醒」，真正决定某个任务这次查不查
   * 由 `nextPollAtRef` + 失败次数决定，因此：
   *  - 达到失败上限的任务不再被查询，也不会因为其他任务仍活跃而被继续批量查询；
   *  - 单个任务退避变慢不会拖慢健康任务。
   */
  useEffect(() => {
    const stillPolling = (task: GenerationTaskView) => {
      const failures = task.queryFailures ?? 0
      // 结果未知且未达上限：继续轮询以确认状态。
      if (failures > 0) return failures < MAX_QUERY_FAILURES
      // 未出现查询失败时，只有活跃状态需要轮询。
      return isActiveStatus(task.status)
    }
    const active = tasks.some(stillPolling)
    if (!active) {
      if (pollTimerRef.current) { window.clearInterval(pollTimerRef.current); pollTimerRef.current = null }
      return
    }
    if (pollTimerRef.current) return
    /** 步长固定：由每个任务的 `nextPollAt` 决定实际查询频率。 */
    pollTimerRef.current = window.setInterval(() => {
      // 等待窗口从任务自身的开始时间算起，页面刷新不会延长或重置它。
      const now = Date.now()
      // 只对仍需要轮询的任务判定超时；单个过期任务不能阻止其他任务继续查询。
      const overdue = tasks.filter((task) => stillPolling(task) && now - task.createdAt > MAX_TASK_AGE_MS)
      if (overdue.length) {
        setLastNotice(`有 ${overdue.length} 个任务等待超过 ${Math.round(MAX_TASK_AGE_MS / 60000)} 分钟，已停止自动轮询。请手动重新检查上游状态。`)
        // 只停止过期任务的轮询，其他任务继续。
        for (const task of overdue) {
          queryFailuresRef.current.set(task.id, MAX_QUERY_FAILURES)
          nextPollAtRef.current.set(task.id, Number.POSITIVE_INFINITY)
        }
        setTasks((current) => current.map((task) => overdue.some((item) => item.id === task.id)
          ? { ...task, queryFailures: MAX_QUERY_FAILURES, queryFailureLimit: MAX_QUERY_FAILURES }
          : task))
        return
      }
      void refresh()
    }, POLL_TICK_MS)
    return () => {
      if (pollTimerRef.current) { window.clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    }
  }, [refresh, tasks])

  /**
   * 统一的任务创建入口。
   *
   * 防重复提交分三层：
   * 1. **工作台提交按钮**在提交期间禁用（用户双击的直接防线）；
   * 2. **在途计数上限**：`inflightSubmitsRef` 达到上限才拒绝，因此一次合法的
   *    批量操作（4 个并发批次）不会被自己的锁拒绝，而无限循环仍被拦住；
   * 3. **幂等标识**：网络失败后重试复用同一个 clientRequestId，后端返回第一次
   *    创建的任务，不会产生第二条任务，也不会重复扣费。
   *
   * **账号隔离**：本函数在**每一个写状态的位置**都校验 `epoch` 与发起账号
   * （见 `stillCurrent`）。此前只有成功路径校验，`catch` 里写未确认任务、
   * 写缓存、写提示、`finally` 改 `running` 都没有保护，于是
   * 「A 提交 → 退出 A → 登录 B → 释放 A 的 503」会把 A 的未确认任务与提示词
   * 写进 B 的界面与缓存（实测复现）。
   */
  const submit = useCallback(async (
    kind: GenerationKind,
    local: LocalTask,
    request: (identity: { clientRequestId: string; attemptNo?: number }) => Promise<{ data: { task: GenerationTask; warning?: string }; points: PointsSnapshot }>,
  ) => {
    if (inflightSubmitsRef.current >= MAX_CONCURRENT_SUBMITS) {
      throw new StudioApiError(`同时提交的任务过多（上限 ${MAX_CONCURRENT_SUBMITS}），请等待部分任务确认后再试`, 409, { outcome: 'rejected' })
    }
    inflightSubmitsRef.current += 1
    const epoch = sessionEpochRef.current
    /** 本次请求的发起账号：所有状态写入都必须仍属于它。 */
    const ownerUserId = userId
    /**
     * 迟到的响应是否可以写状态。
     *
     * 同时校验会话世代与发起账号——只比较世代不够：
     * 退出再登录**同一账号**也会推进世代，但那种情况下写入是安全的；
     * 反过来，账号已变时即便世代偶然相同也绝不能写。
     */
    const stillCurrent = () => epoch === sessionEpochRef.current && ownerUserId === userIdRef.current
    setRunning(true); setLastError(null); setLastNotice(null)
    try {
      const response = await request({ clientRequestId: local.clientRequestId, attemptNo: local.attemptNo })
      // 账号已切换：丢弃这次响应，避免写入新账号的界面与缓存。
      if (!stillCurrent()) throw new StudioApiError('账号已切换，本次提交结果已忽略', 409, { outcome: 'rejected' })
      applyPoints(response.points)
      const task = response.data.task
      if (!task?.id) throw new StudioApiError('后端没有返回任务标识', 502, { outcome: 'unavailable' })
      const warning = response.data.warning
      pendingSubmissionsRef.current.delete(local.clientRequestId)
      writePendingSubmissions(ownerUserId, pendingSubmissionsRef.current)
      syncUnconfirmedTasks()
      indeterminateRef.current.delete(local.clientRequestId)
      remember({ ...local, id: task.id, model: task.model || local.model, startedAt: Date.now() })
      const view = toView(kind, task, { ...local, startedAt: Date.now() })
      setTasks((current) => [view, ...current.filter((item) => item.id !== task.id)])
      setLocalOnly(false)
      if (warning) setLastNotice(String(warning))
      return view
    } catch (reason) {
      const error = toError(reason)
      /**
       * 账号已切换：**不写任何状态**（错误、提示、未确认任务、缓存都不写），
       * 只把错误抛给调用方。旧账号的恢复信息若已持久化，它属于旧账号的缓存键，
       * 换回该账号仍能看到；绝不能落到当前账号的界面或缓存里。
       */
      if (!stillCurrent()) throw error
      setLastError(error)
      if (error.code === 'unauthenticated') setLocalOnly(true)
      if (error.indeterminate) {
        // 请求可能已经到达后端：保留原参数与幂等标识，**持久化并暴露为可见占位任务**，
        // 用户因此能看到「提交结果未确认」并点击「重新提交」；
        // 刷新后从缓存重建，恢复入口不会消失。
        const pending: LocalTask = { ...local, unconfirmed: true, id: unconfirmedLocalId(local.clientRequestId), ownerUserId: ownerUserId ?? undefined }
        pendingSubmissionsRef.current.set(local.clientRequestId, pending)
        writePendingSubmissions(ownerUserId, pendingSubmissionsRef.current)
        syncUnconfirmedTasks()
        indeterminateRef.current.add(local.clientRequestId)
        setQueryUnavailable(true)
        setLastNotice('提交结果未确认：请求可能已经生效。请在下方任务卡片点击「重新提交」按同一标识重试，系统不会重复创建任务或重复扣费。')
      }
      throw error
    } finally {
      inflightSubmitsRef.current = Math.max(0, inflightSubmitsRef.current - 1)
      /**
       * `running` 影响的是「当前界面是否显示提交中」。
       * 账号已切换时不能改它——那会把新账号的按钮状态按旧账号的请求收尾。
       */
      if (stillCurrent() && inflightSubmitsRef.current === 0) setRunning(false)
    }
  }, [applyPoints, remember, syncUnconfirmedTasks])

  const createImage = useCallback((input: ImageGenerationInput) => submit('image', {
    id: '', kind: 'image', clientRequestId: input.clientRequestId || newClientRequestId('image'), title: input.title || `图片生成 · ${input.prompt.slice(0, 16)}`, prompt: input.prompt, model: input.model || '', createdAt: Date.now(), retryInput: { kind: 'image', input },
  }, (identity) => createImageTask({ ...input, ...identity })), [submit])

  const createVideo = useCallback((input: VideoGenerationInput) => submit('video', {
    id: '', kind: 'video', clientRequestId: input.clientRequestId || newClientRequestId('video'), title: `视频生成 · ${input.prompt.slice(0, 16)}`, prompt: input.prompt, model: input.model || '', createdAt: Date.now(), retryInput: { kind: 'video', input },
  }, (identity) => createVideoTask({ ...input, ...identity })), [submit])

  const createAudio = useCallback((input: AudioGenerationInput) => submit('audio', {
    id: '', kind: 'audio', clientRequestId: input.clientRequestId || newClientRequestId('audio'), title: `音频生成 · ${input.prompt.slice(0, 16)}`, prompt: input.prompt, model: input.model || '', createdAt: Date.now(), retryInput: { kind: 'audio', input },
  }, (identity) => createAudioTask({ ...input, ...identity })), [submit])

  /**
   * 文本任务。
   *
   * 后端已补齐幂等路径（`context.clientRequestId` + 幂等请求头），
   * 因此这里与图片/视频一致地传入幂等标识：网络重试复用同一标识时
   * 后端返回第一次创建的任务，不会重复创建也不会重复扣费。
   */
  const createText = useCallback((input: TextGenerationInput) => submit('text', {
    id: '', kind: 'text', clientRequestId: input.clientRequestId || newClientRequestId('text'), title: `文本生成 · ${input.prompt.slice(0, 16)}`, prompt: input.prompt, model: input.model || '', createdAt: Date.now(), retryInput: { kind: 'text', input },
  }, (identity) => createTextTask({ ...input, ...identity })), [submit])

  /**
   * 取消任务。
   *
   * 与提交同样需要账号校验：取消的响应里带 `points`（账号级数据）与新任务状态，
   * 迟到时会污染已切换后的账号。因此这里在写任何状态前校验 `stillCurrent()`。
   */
  const cancelTask = useCallback(async (task: GenerationTaskView) => {
    if (task.unconfirmed || isUnconfirmedId(task.id)) {
      throw new StudioApiError('该提交还没有服务器任务标识，无法取消。请使用「重新提交」按原标识恢复。', 409, { outcome: 'rejected' })
    }
    const epoch = sessionEpochRef.current
    const ownerUserId = userIdRef.current
    const stillCurrent = () => epoch === sessionEpochRef.current && ownerUserId === userIdRef.current
    setLastError(null)
    try {
      const response = await cancelTaskRequest(task.kind as 'image' | 'video' | 'audio' | 'text', task.id)
      // 账号已切换：只丢弃结果，不写积分/任务/提示。
      if (!stillCurrent()) throw new StudioApiError('账号已切换，本次取消结果已忽略', 409, { outcome: 'rejected' })
      applyPoints(response.points)
      queryFailuresRef.current.delete(task.id)
      nextPollAtRef.current.delete(task.id)
      indeterminateRef.current.delete(task.id)
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...toView(task.kind, response.data.task, item) } : item))
      setLastNotice('任务已取消，上游已产生的素材不会被删除。')
    } catch (reason) {
      if (stillCurrent()) setLastError(toError(reason, task.id))
      throw reason
    }
  }, [applyPoints])

  /**
   * 手动重新检查上游状态。
   *
   * 同样必须校验账号：响应带积分与新状态，且随后还会触发一次全量 `refresh()`；
   * 若账号已切换，这些都属于上一个账号。
   */
  const recoverTask = useCallback(async (task: GenerationTaskView) => {
    // 未确认占位没有服务器任务 ID，查询它没有意义（会打到错误路径）。
    if (task.unconfirmed || isUnconfirmedId(task.id)) {
      throw new StudioApiError('该提交还没有服务器任务标识，请使用「重新提交」按原标识恢复', 409, { outcome: 'rejected' })
    }
    const epoch = sessionEpochRef.current
    const ownerUserId = userIdRef.current
    const stillCurrent = () => epoch === sessionEpochRef.current && ownerUserId === userIdRef.current
    setLastError(null)
    try {
      // 重新检查只查询上游已有结果，不会隐式创建新任务，因此不会重复扣费。
      const response = await recoverTaskRequest(task.kind as 'image' | 'video' | 'audio' | 'text', task.id)
      if (!stillCurrent()) throw new StudioApiError('账号已切换，本次检查结果已忽略', 409, { outcome: 'rejected' })
      applyPoints(response.points)
      queryFailuresRef.current.delete(task.id)
      // 手动重新检查必须立刻可查，不能被之前的退避时间挡住。
      nextPollAtRef.current.set(task.id, 0)
      indeterminateRef.current.delete(task.id)
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...toView(task.kind, response.data.task, item) } : item))
      setLastNotice('已重新检查上游状态。')
      await refresh()
    } catch (reason) {
      if (stillCurrent()) setLastError(toError(reason, task.id))
      throw reason
    }
  }, [applyPoints, refresh])

  /**
   * 重新提交一个「结果未知」的创建请求。
   *
   * 必须复用**原来的 clientRequestId**，后端才会返回第一次创建的任务而不是新建一条。
   * 关键：绝不能把服务器返回的 `task.id` 当作 clientRequestId 兜底——两者语义不同，
   * 用 task.id 去提交等于换了一个新标识，会真的创建第二个任务并重复扣费。
   * 因此找不到原标识时宁可明确拒绝，并提示用户去任务中心手动重新检查。
   */
  /**
   * 按 clientRequestId 取回未确认提交的原始参数。
   * 兼容两种传入：占位任务 ID（`unconfirmed:<clientRequestId>`）与 clientRequestId 本身。
   */
  const findPending = useCallback((idOrRequestId: string) => {
    const direct = pendingSubmissionsRef.current.get(idOrRequestId)
    if (direct) return direct
    if (isUnconfirmedId(idOrRequestId)) {
      return pendingSubmissionsRef.current.get(idOrRequestId.slice(UNCONFIRMED_PREFIX.length))
    }
    return [...pendingSubmissionsRef.current.values()].find((item) => item.id === idOrRequestId || item.clientRequestId === idOrRequestId)
  }, [])

  /**
   * 重新提交一个「结果未知」的创建请求。
   *
   * 必须复用**原来的 clientRequestId**，后端才会返回第一次创建的任务而不是新建一条。
   * 关键：绝不能把服务器返回的 `task.id` 当作 clientRequestId 兜底——两者语义不同，
   * 用 task.id 去提交等于换了一个新标识，会真的创建第二个任务并重复扣费。
   * 因此找不到原标识时宁可明确拒绝，并提示用户去任务中心手动重新检查。
   *
   * **账号边界**：`findPending` 只读取当前账号的 pending 映射（它随账号切换重建），
   * 因此 B 的映射里不会有 A 的条目；这里再加一道显式校验，
   * 防止「切回同一账号」以外的任何情况下把别人的草稿提交出去。
   */
  const resubmit = useCallback(async (task: GenerationTaskView) => {
    const local = findPending(task.id) ?? findPending(task.clientRequestId ?? '')
    if (!local) {
      throw new StudioApiError(
        '找不到这次提交的原始标识，无法安全重试。请点击「重新检查」查询上游是否已产生结果，避免重复扣费。',
        409,
        { outcome: 'rejected' },
      )
    }
    if (local.ownerUserId && local.ownerUserId !== userIdRef.current) {
      throw new StudioApiError('该提交属于其他账号，无法在当前账号下重试。', 409, { outcome: 'rejected' })
    }
    setLastError(null)
    // 复用原 clientRequestId：后端按它去重，因此只会返回第一次创建的任务。
    if (local.retryInput?.kind === 'image') await createImage({ ...local.retryInput.input, clientRequestId: local.clientRequestId })
    else if (local.retryInput?.kind === 'video') await createVideo({ ...local.retryInput.input, clientRequestId: local.clientRequestId })
    else if (local.retryInput?.kind === 'audio') await createAudio({ ...local.retryInput.input, clientRequestId: local.clientRequestId })
    // 文本任务的后端幂等路径已补齐，因此同样可以按原标识安全重试。
    else if (local.retryInput?.kind === 'text') await createText({ ...local.retryInput.input, clientRequestId: local.clientRequestId })
    else throw new StudioApiError('该类型任务不支持按原标识重试，请重新发起创作', 409, { outcome: 'rejected' })
  }, [createAudio, createImage, createText, createVideo, findPending])

  /** 是否存在可安全恢复的未确认提交（供界面决定是否显示「重新提交」）。 */
  const canResubmit = useCallback((task: GenerationTaskView) => {
    return Boolean(findPending(task.id) ?? findPending(task.clientRequestId ?? ''))
  }, [findPending])

  /** 失败任务重试：使用相同参数重新创建一个后端任务。 */
  const retryTask = useCallback(async (task: GenerationTaskView) => {
    setLastError(null)
    try {
      if (task.needsReview) throw new Error('上游结果待确认，请先重新检查任务，避免重复扣费')
      if (task.canRetry === false) throw new Error('当前任务不允许重试')
      const retryInput = task.retryInput
      // 重试是一次**新的**创作，必须使用新的 clientRequestId，否则会被后端当成旧任务直接返回。
      if (retryInput?.kind === 'image') await createImage({ ...retryInput.input, clientRequestId: newClientRequestId('image') })
      else if (retryInput?.kind === 'video') await createVideo({ ...retryInput.input, clientRequestId: newClientRequestId('video') })
      else if (retryInput?.kind === 'audio') await createAudio({ ...retryInput.input, clientRequestId: newClientRequestId('audio') })
      else if (retryInput?.kind === 'text') await createText(retryInput.input)
      else if (task.kind === 'image') await createImage({ prompt: task.prompt, model: task.model, clientRequestId: newClientRequestId('image') })
      else if (task.kind === 'video') await createVideo({ prompt: task.prompt, model: task.model, clientRequestId: newClientRequestId('video') })
      else if (task.kind === 'audio') await createAudio({ prompt: task.prompt, model: task.model, clientRequestId: newClientRequestId('audio') })
      else if (task.kind === 'text') await createText({ prompt: task.prompt, model: task.model })
      setLastNotice(retryInput ? '已按原参数重新提交。' : '历史任务缺少完整参数，已使用模型和提示词重新提交。')
    } catch (reason) {
      setLastError(toError(reason, task.id))
      throw reason
    }
  }, [createAudio, createImage, createText, createVideo])

  /**
   * 运行 Agent。
   *
   * Agent 响应同样带积分（账号级）并会驱动界面；迟到时必须丢弃，
   * 且 `finally` 里的 `setRunning(false)` 也不能动新账号的按钮状态。
   */
  const runAgent = useCallback(async (input: { prompt: string; surface: 'chat' | 'canvas' | 'drama'; projectId?: string; assetIds?: string[] }) => {
    const epoch = sessionEpochRef.current
    const ownerUserId = userIdRef.current
    const stillCurrent = () => epoch === sessionEpochRef.current && ownerUserId === userIdRef.current
    setRunning(true); setLastError(null); setLastNotice(null)
    try {
      const response = await createAgentRun(input)
      if (!stillCurrent()) throw new StudioApiError('账号已切换，本次 Agent 请求结果已忽略', 409, { outcome: 'rejected' })
      applyPoints(response.points)
      setLocalOnly(false)
      return response.data.run
    } catch (reason) {
      const error = toError(reason)
      if (stillCurrent()) {
        setLastError(error)
        if (error.code === 'unauthenticated') setLocalOnly(true)
      }
      throw error
    } finally {
      if (stillCurrent()) setRunning(false)
    }
  }, [applyPoints])

  const getAgent = useCallback(async (id: string) => {
    const response = await getAgentRun(id)
    return response.data.run
  }, [])

  /** Agent 控制（暂停/继续/重试/取消）：迟到响应不得写入新账号的错误状态。 */
  const cancelAgent = useCallback(async (run: AgentRun, action: 'pause' | 'resume' | 'retry' | 'cancel') => {
    const epoch = sessionEpochRef.current
    const ownerUserId = userIdRef.current
    const stillCurrent = () => epoch === sessionEpochRef.current && ownerUserId === userIdRef.current
    setLastError(null)
    try {
      const response = await (await import('./generation-api')).controlAgentRun(run.id, action)
      return response.data.run
    } catch (reason) {
      if (stillCurrent()) setLastError(toError(reason, run.id))
      throw reason
    }
  }, [])

  /** Agent 子任务重试：同上。 */
  const retryAgentTask = useCallback(async (runId: string, taskId: string) => {
    const epoch = sessionEpochRef.current
    const ownerUserId = userIdRef.current
    const stillCurrent = () => epoch === sessionEpochRef.current && ownerUserId === userIdRef.current
    setLastError(null)
    try {
      await retryAgentRunTask(runId, taskId)
    } catch (reason) {
      if (stillCurrent()) setLastError(toError(reason, runId))
      throw reason
    }
  }, [])

  const dismissError = useCallback(() => setLastError(null), [])

  /**
   * 暴露给界面的任务列表 = 已确认任务 + 未确认占位。
   *
   * 未确认占位必须出现在同一列表里，否则用户看不到恢复入口
   * （这正是上一轮「缓存里有记录但找不到按钮」的直接原因）。
   * 未确认项排在最前，提示用户先处理。
   */
  const visibleTasks = useMemo(() => [...unconfirmedTasks, ...tasks], [tasks, unconfirmedTasks])

  const activeCount = tasks.filter((task) => isActiveStatus(task.status)).length

  /**
   * 任务进入终态时自动同步一次会话与账户数据。
   *
   * 页头积分、账户页余额、作品列表与素材库来自不同的数据源，若只在手动刷新时更新，
   * 用户会看到「生成已完成但积分/作品/预览还是旧的」。实测：任务卡已显示「已完成」，
   * 结果舞台仍停在空态，必须刷新页面才恢复。
   *
   * 这里做两件事：
   *  1. `refreshSession()` 刷新积分与账户信息；
   *  2. `bumpAccountData()` 通知作品／历史／素材／流水 hooks 重新读取。
   * 两者都在「有任务刚结束」时触发，因此**不必等所有任务结束**：
   * 多任务部分完成时，每个任务结束都会各自触发一次。
   */
  const previousActiveRef = useRef(0)
  const previousSuccessRef = useRef(0)
  useEffect(() => {
    const previousActive = previousActiveRef.current
    previousActiveRef.current = activeCount
    const successCount = tasks.filter((task) => task.status === 'success' && (task.media?.length ?? 0) > 0).length
    const previousSuccess = previousSuccessRef.current
    previousSuccessRef.current = successCount
    // 活跃数下降（有任务结束）或成功结果增加（拿到新产物）都说明账户数据已变化。
    const settled = previousActive > 0 && activeCount < previousActive
    const produced = successCount > previousSuccess
    if (settled || produced) {
      void refreshSession()
      bumpAccountData()
    }
  }, [activeCount, refreshSession, tasks])

  const value = useMemo<GenerationContextValue>(() => ({
    tasks: visibleTasks,
    activeCount,
    loading,
    lastError,
    lastNotice,
    points,
    localOnly,
    running,
    queryUnavailable,
    createImage,
    createVideo,
    createAudio,
    createText,
    runAgent,
    getAgent,
    cancelAgent,
    cancelTask,
    retryTask,
    recoverTask,
    retryAgentTask,
    refresh,
    dismissError,
    setNotice: setLastNotice,
    resubmit,
    canResubmit,
  }), [activeCount, canResubmit, cancelAgent, cancelTask, createAudio, createImage, createText, createVideo, dismissError, getAgent, lastError, lastNotice, loading, localOnly, points, queryUnavailable, recoverTask, refresh, resubmit, retryAgentTask, retryTask, runAgent, running, visibleTasks])

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>
}

export function useGeneration() {
  const context = useContext(GenerationContext)
  if (!context) throw new Error('useGeneration 必须在 GenerationProvider 内使用')
  return context
}

/** 会话可用性与积分：供页面区分“真实可用”和“本地预览”。 */
export function useStudioAvailability() {
  const [state, setState] = useState<{ checked: boolean; authenticated: boolean; points: number | null }>({ checked: false, authenticated: false, points: null })
  useEffect(() => {
    let active = true
    getSession()
      .then((session) => { if (active) setState({ checked: true, authenticated: Boolean(session.user), points: session.user ? Number(session.user.pointsBalance) || 0 : null }) })
      .catch(() => { if (active) setState({ checked: true, authenticated: false, points: null }) })
    return () => { active = false }
  }, [])
  return state
}

export { isActiveStatus, isTerminalStatus }
export type { GenerationStatus }
