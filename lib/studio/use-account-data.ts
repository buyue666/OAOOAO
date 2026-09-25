'use client'

/**
 * 账户侧服务端数据读取。
 *
 * 设计要点：
 * - 服务端是唯一事实来源；本地缓存只用于「先显示上次结果」，不作为索引。
 * - 未登录 / 会话过期 / 接口失败分别暴露不同状态，页面据此区分展示，
 *   绝不把接口失败显示成真实的 0（那会让用户以为没有作品或没有消费）。
 * - 读取按账号隔离，切换账号不会读到上一个账号的作品。
 * - **统一刷新**：任务完成、素材上传、项目变化都会 `bumpAccountData()`，
 *   这里订阅后自动重新读取，因此不再需要刷新页面。
 * - **竞态防护用世代令牌**而不是 `activeRef` 布尔值：布尔值在快速切换账号时
 *   会把旧账号的迟到响应写进新账号的界面（本轮复现并修复）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  findExistingWorkIds,
  listAllLibraryAssetIds,
  listAllWorks,
  listGenerationHistory,
  summarizePointRecords,
  getReferralCenter,
  listAccountOrders,
  listLibraryAssets,
  type GenerationHistoryItem,
  type LedgerSummary,
  type ReferralCenter,
  type StudioWork,
  type BillingOrderView,
  type LibraryAssetView,
} from './account-api'
import { StudioApiError } from './api'
import { accountDataEpoch, createWriteGuard, subscribeAccountData } from './account-data-sync'
import { completeEvidence, scopedEvidence, unavailableEvidence, WORK_ID_PREFIX, type LiveSourceEvidence } from './reference-selection'
import { useStudio } from './store'

/** 数据读取状态。`error` 与「空数据」必须分开，空数据处理成 0 会误导用户。 */
export type LoadState = 'idle' | 'loading' | 'ready' | 'unauthenticated' | 'error'

function classify(reason: unknown): { state: LoadState; message: string } {
  if (reason instanceof StudioApiError) {
    if (reason.outcome === 'expired') return { state: 'unauthenticated', message: '登录状态已失效，请重新登录。' }
    if (reason.isIndeterminate) return { state: 'error', message: `${reason.message}（数据未确认，可重试）` }
    return { state: 'error', message: reason.message }
  }
  return { state: 'error', message: reason instanceof Error ? reason.message : '数据加载失败' }
}

/**
 * 订阅「账户数据已变化」并返回自增的刷新计数。
 *
 * 把刷新做成计数而不是直接调 load：这样 load 仍是 `useCallback`，
 * 依赖里加上计数即可，避免订阅回调持有过期的闭包。
 */
function useAccountDataRevision() {
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeAccountData(() => setRevision((value) => value + 1)), [])
  return revision
}

/**
 * 作品列表。
 *
 * 作品来自后端生成记录里「成功且有结果资产」的条目，因此刷新、重新登录、
 * 换浏览器都能恢复，不依赖本地缓存。
 */
export function useServerWorks(options: { pageSize?: number; maxPages?: number; kind?: string; enabled?: boolean } = {}) {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected'
  const userId = state.user.id
  const enabled = options.enabled !== false
  const revision = useAccountDataRevision()
  const [works, setWorks] = useState<StudioWork[]>([])
  const [state_, setState] = useState<LoadState>('idle')
  const [message, setMessage] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [total, setTotal] = useState(0)
  const guardRef = useRef(createWriteGuard())

  const load = useCallback(async () => {
    if (!enabled) return
    if (!connected) {
      setState('unauthenticated')
      setWorks([])
      setTotal(0)
      return
    }
    const token = guardRef.current.begin()
    setState('loading')
    setMessage('')
    try {
      const result = await listAllWorks({ pageSize: options.pageSize, maxPages: options.maxPages, kind: options.kind })
      if (!guardRef.current.isCurrent(token)) return
      setWorks(result.works)
      setTotal(result.total)
      setTruncated(result.truncated)
      setState('ready')
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setState(classified.state)
      setMessage(classified.message)
      // 失败时保留上一次成功的结果，但状态标记为错误，页面会显示提示而不是假装为空。
    }
  }, [connected, enabled, options.kind, options.maxPages, options.pageSize])

  /**
   * 定向校验已选作品是否仍然存在，返回存活证据。
   *
   * `ids` 为空 → 不发请求（避免"没有选择也去遍历作品库"）。
   * 读取失败 / 未读到底 → `unavailable`：调用方**保留**已选，不把失败当删除。
   *
   * 证据带**查询范围**（`scopedEvidence(ids, found)`）：只回答了"传入的这些 id 在不在"。
   * 调用方若在这之后又选了新作品，那一条**不在范围内**，
   * 不能被本证据判成"已删除"（本轮复现的竞态）。
   */
  const verifyWorkIds = useCallback(async (ids: readonly string[]): Promise<LiveSourceEvidence> => {
    if (!connected) return unavailableEvidence()
    if (!ids.length) return completeEvidence([])
    const token = guardRef.current.begin()
    try {
      const result = await findExistingWorkIds(ids, { kind: options.kind })
      /** 迟到的旧请求：不作为证据（避免覆盖更新的结果）。 */
      if (!guardRef.current.isCurrent(token)) return unavailableEvidence()
      if (!result.complete) return unavailableEvidence()
      return scopedEvidence(ids, result.found)
    } catch {
      return unavailableEvidence()
    }
  }, [connected, options.kind])

  useEffect(() => {
    void load()
    return () => { guardRef.current.invalidate() }
    // 账号变化、刷新信号、登录状态变化都必须重新读取。
  }, [load, revision, userId])

  return { works, total, truncated, state: state_, message, reload: load, verifyWorkIds }
}

/** 生成历史（含未成功任务），用于任务中心与服务端分页。 */
export function useServerHistory(options: { pageSize?: number; maxPages?: number; enabled?: boolean } = {}) {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected'
  const userId = state.user.id
  const enabled = options.enabled !== false
  const revision = useAccountDataRevision()
  const [items, setItems] = useState<GenerationHistoryItem[]>([])
  const [state_, setState] = useState<LoadState>('idle')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const pageSize = options.pageSize ?? 24
  const guardRef = useRef(createWriteGuard())

  const load = useCallback(async () => {
    if (!enabled) return
    if (!connected) {
      setState('unauthenticated')
      setItems([])
      return
    }
    const token = guardRef.current.begin()
    setState('loading')
    setMessage('')
    try {
      const result = await listGenerationHistory({ page: 1, pageSize })
      if (!guardRef.current.isCurrent(token)) return
      setItems(result.items)
      setTotal(result.total)
      setPage(1)
      setState('ready')
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setState(classified.state)
      setMessage(classified.message)
    }
  }, [connected, enabled, pageSize])

  /** 服务端分页：继续读取下一页，而不是只展示首页。 */
  const loadMore = useCallback(async () => {
    if (!connected || loadingMore) return
    const token = guardRef.current.begin()
    setLoadingMore(true)
    try {
      const next = page + 1
      const result = await listGenerationHistory({ page: next, pageSize })
      if (!guardRef.current.isCurrent(token)) return
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...result.items.filter((item) => !seen.has(item.id))]
      })
      setTotal(result.total)
      setPage(next)
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setMessage(classified.message)
    } finally {
      setLoadingMore(false)
    }
  }, [connected, loadingMore, page, pageSize])

  useEffect(() => {
    void load()
    return () => { guardRef.current.invalidate() }
  }, [load, revision, userId])

  return { items, total, page, pageSize, hasMore: items.length < total, state: state_, message, reload: load, loadMore, loadingMore }
}

/** 积分流水统计。金额来自后端 `/api/points`，逐页聚合，不用生成日志估算。 */
export function useLedgerSummary(options: { maxPages?: number } = {}) {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected'
  const userId = state.user.id
  const revision = useAccountDataRevision()
  const [summary, setSummary] = useState<LedgerSummary | null>(null)
  const [state_, setState] = useState<LoadState>('idle')
  const [message, setMessage] = useState('')
  const guardRef = useRef(createWriteGuard())

  const load = useCallback(async () => {
    if (!connected) {
      setState('unauthenticated')
      setSummary(null)
      return
    }
    const token = guardRef.current.begin()
    setState('loading')
    setMessage('')
    try {
      const result = await summarizePointRecords({ maxPages: options.maxPages })
      if (!guardRef.current.isCurrent(token)) return
      setSummary(result)
      setState('ready')
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setState(classified.state)
      setMessage(classified.message)
      // 保留上一次结果但标记错误：宁可显示「暂时不可用」也不显示成 0。
    }
  }, [connected, options.maxPages])

  useEffect(() => {
    void load()
    return () => { guardRef.current.invalidate() }
  }, [load, revision, userId])

  return { summary, state: state_, message, reload: load }
}

/** 邀请中心：邀请码、链接、关系与奖励全部来自后端。 */
export function useReferralCenter() {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected'
  const userId = state.user.id
  const revision = useAccountDataRevision()
  const [center, setCenter] = useState<ReferralCenter | null>(null)
  const [state_, setState] = useState<LoadState>('idle')
  const [message, setMessage] = useState('')
  const guardRef = useRef(createWriteGuard())

  const load = useCallback(async () => {
    if (!connected) {
      setState('unauthenticated')
      setCenter(null)
      return
    }
    const token = guardRef.current.begin()
    setState('loading')
    setMessage('')
    try {
      const result = await getReferralCenter({ pageSize: 20 })
      if (!guardRef.current.isCurrent(token)) return
      setCenter(result)
      setState('ready')
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setState(classified.state)
      setMessage(classified.message)
    }
  }, [connected])

  useEffect(() => {
    void load()
    return () => { guardRef.current.invalidate() }
  }, [load, revision, userId])

  return { center, state: state_, message, reload: load }
}

/** 订单记录，包含待支付订单以便继续支付。 */
export function useServerOrders() {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected'
  const userId = state.user.id
  const revision = useAccountDataRevision()
  const [orders, setOrders] = useState<BillingOrderView[]>([])
  const [state_, setState] = useState<LoadState>('idle')
  const [message, setMessage] = useState('')
  const guardRef = useRef(createWriteGuard())

  const load = useCallback(async () => {
    if (!connected) {
      setState('unauthenticated')
      setOrders([])
      return
    }
    const token = guardRef.current.begin()
    setState('loading')
    setMessage('')
    try {
      const result = await listAccountOrders({ page: 1, pageSize: 50 })
      if (!guardRef.current.isCurrent(token)) return
      setOrders(result.orders)
      setState('ready')
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setState(classified.state)
      setMessage(classified.message)
    }
  }, [connected])

  useEffect(() => {
    void load()
    return () => { guardRef.current.invalidate() }
  }, [load, revision, userId])

  const pending = useMemo(() => orders.filter((order) => order.status === 'pending'), [orders])
  return { orders, pending, state: state_, message, reload: load }
}

/**
 * 素材库（服务端持久化）。
 *
 * 素材来自 `/api/library-assets`（用户上传与生成的落库素材），
 * 刷新、重新登录、换浏览器都能恢复；不再只读本地演示数据。
 *
 * 同时暴露**服务端分页**（`loadMore` / `hasMore`）：素材库超过一页时，
 * 调用方可以继续读取下一页，而不是只看到第一页就以为「素材就这么多」。
 */
export function useLibraryAssets(options: { pageSize?: number; kind?: string; keyword?: string } = {}) {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected'
  const userId = state.user.id
  const revision = useAccountDataRevision()
  const [assets, setAssets] = useState<LibraryAssetView[]>([])
  const [state_, setState] = useState<LoadState>('idle')
  const [message, setMessage] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  /**
   * **素材库来源**的存活证据（按需计算，不随搜索词重算）。
   *
   * 为什么不再用"启动时取一次 liveIds"：
   *  - 旧实现请求 `page=1&pageSize=500`，但后端把 `pageSize` 限制在 **100**，
   *    拿到的其实只是第一页；素材超过 100 条时，第 101 条之后全被误判为已删除；
   *  - 而且它在挂载时就整库遍历，与"用户其实只选了 1 个素材"这一事实不成比例。
   *
   * 现在改为：调用方传入**需要校验的 id**，只有非空时才真正去读，
   * 并且**逐页读全**（`listAllLibraryAssetIds`）才算 `complete`；
   * 分页被截断 / 请求失败 / 未登录一律降级为 `unavailable`，调用方据此**不判定删除**。
   */
  const liveGuardRef = useRef(createWriteGuard())
  const pageSize = options.pageSize ?? 60
  const guardRef = useRef(createWriteGuard())

  const verifyLibraryIds = useCallback(async (ids: readonly string[]): Promise<LiveSourceEvidence> => {
    if (!connected) return unavailableEvidence()
    /** 没有需要校验的 id → 不必读整个库（这是"搜索时不遍历全库"的关键）。 */
    if (!ids.length) return completeEvidence([])
    const token = liveGuardRef.current.begin()
    try {
      const result = await listAllLibraryAssetIds({ kind: options.kind })
      if (!liveGuardRef.current.isCurrent(token)) return unavailableEvidence()
      /** 分页没读全 → 证据不完整，绝不能据此判定删除。 */
      if (result.truncated) return unavailableEvidence()
      /** 读的是**全集** → 范围是 `'all'`，未命中的 id 确实已删除。 */
      return completeEvidence(result.ids)
    } catch {
      /** 读取失败 → 证据不可用（保持已选，宁可多留也不误删）。 */
      return unavailableEvidence()
    }
  }, [connected, options.kind])

  /**
   * 「请重新校验已选素材存活」的信号。
   *
   * 为什么需要显式信号：校验只在**已选集合变化**或**素材被增删**时才该跑。
   *  - 已选变化：由调用方监听已选本身；
   *  - 素材增删：删除发生在素材库页面或别处，本站点只收到"刷新素材"的点击
   *    或 `bumpAccountData()`；这两种情况都自增本计数器。
   *
   * 刻意**不**随 `keyword` 变化：否则每敲一个字都要遍历整个素材库
   * （素材多时是明显浪费，而且搜索结果本来就不参与存活判定）。
   */
  const [liveVerifyTick, setLiveVerifyTick] = useState(0)
  const requestLiveVerify = useCallback(() => setLiveVerifyTick((current) => current + 1), [])

  /**
   * 刷新素材库并**返回本次刷新后的存活证据**。
   *
   * 与 `verifyLibraryIds` 的区别：后者是为了"校验已选"而额外读一次；
   * 这里用的是**刷新本身**的结果，避免"刚发起刷新就拿旧数据判定"。
   * 同一个 `liveGuardRef` 保证连续刷新时只有最后一次生效
   * （迟到的旧响应会被 `isCurrent` 挡掉）。
   */
  const reloadForLiveness = useCallback(async (): Promise<LiveSourceEvidence> => {
    if (!connected) return unavailableEvidence()
    const token = liveGuardRef.current.begin()
    try {
      const result = await listAllLibraryAssetIds({ kind: options.kind })
      if (!liveGuardRef.current.isCurrent(token)) return unavailableEvidence()
      if (result.truncated) return unavailableEvidence()
      /** 素材库这条路径读的是**全集**，因此范围是 `'all'`。 */
      return completeEvidence(result.ids)
    } catch {
      return unavailableEvidence()
    }
  }, [connected, options.kind])

  const load = useCallback(async () => {
    if (!connected) {
      setState('unauthenticated')
      setAssets([])
      setTotal(0)
      return
    }
    const token = guardRef.current.begin()
    setState('loading')
    setMessage('')
    try {
      const result = await listLibraryAssets({ page: 1, pageSize, kind: options.kind, keyword: options.keyword })
      if (!guardRef.current.isCurrent(token)) return
      setAssets(result.assets)
      setTotal(result.total)
      setPage(1)
      setState('ready')
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setState(classified.state)
      setMessage(classified.message)
    }
  }, [connected, options.kind, options.keyword, pageSize])

  /** 服务端分页：继续读取下一页并按 id 去重，不覆盖已加载的素材。 */
  const loadMore = useCallback(async () => {
    if (!connected || loadingMore) return
    const token = guardRef.current.begin()
    setLoadingMore(true)
    try {
      const next = page + 1
      const result = await listLibraryAssets({ page: next, pageSize, kind: options.kind, keyword: options.keyword })
      if (!guardRef.current.isCurrent(token)) return
      setAssets((current) => {
        const seen = new Set(current.map((asset) => asset.id))
        return [...current, ...result.assets.filter((asset) => !seen.has(asset.id))]
      })
      setTotal(result.total)
      setPage(next)
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setMessage(classified.message)
    } finally {
      setLoadingMore(false)
    }
  }, [connected, loadingMore, options.kind, options.keyword, page, pageSize])

  useEffect(() => {
    void load()
    return () => { guardRef.current.invalidate() }
  }, [load, revision, userId])

  return {
    assets,
    total,
    page,
    pageSize,
    hasMore: assets.length < total,
    state: state_,
    message,
    reload: load,
    loadMore,
    loadingMore,
    /**
     * 校验给定的素材库 id 是否仍然存在。
     *
     * 只有"逐页读全且成功"才返回可判定的证据（`complete` / `empty`）；
     * 其余情况返回 `unavailable`，调用方**不得**据此删除已选。
     * 传入空数组时不会发起任何请求。
     */
    verifyLibraryIds,
    /** 刷新素材库并返回**本次刷新后**的存活证据（供「刷新素材」与作品来源配合使用）。 */
    reloadForLiveness,
    /** 已选素材的存活校验信号：素材被增删 / 点了「刷新素材」后自增。 */
    liveVerifyTick,
    requestLiveVerify,
  }
}

export { accountDataEpoch }
