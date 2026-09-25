'use client'

/**
 * 生成任务的本地缓存（按账号隔离）。
 *
 * 从 `generation-store.tsx` 拆出来是为了打破循环依赖：
 * store 需要在退出登录／切换账号时清理任务缓存，而 generation-store 又依赖 store。
 * 这里只做纯粹的存储读写，不依赖任何 React 上下文。
 *
 * 设计要点：
 * - 每个账号一个键（`oaooao-live-tasks:<userId>`），未登录为 `:anonymous`，
 *   因此退出 A 登录 B 后 B 读不到 A 的任务标题、提示词与未确认提交；
 * - 本地缓存只用于「刷新后恢复展示」，后端仍是唯一事实来源；
 * - 未确认提交单独持久化，刷新后仍能用**同一幂等标识**安全重试。
 */
import { accountScopedKey, pruneScopedKeys } from './session'

export const taskCacheBase = 'oaooao-live-tasks'

export type CachedTaskSeed = {
  id: string
  kind: string
  title: string
  prompt: string
  model: string
  createdAt: number
  startedAt?: number
  clientRequestId: string
  attemptNo?: number
  retryInput?: unknown
  /**
   * 未确认提交的占位记录。
   *
   * `true` 表示这条记录**还没有服务器任务 ID**（`id` 此时等于 clientRequestId）。
   * 它必须出现在可见的任务列表里，用户才能点击「重新提交」；
   * 同时任何逻辑都不得拿 `id` 去查询服务器（那会查到错误的东西或 404）。
   */
  unconfirmed?: boolean
}

/** 未确认提交超过该时长不再尝试自动恢复，避免长期堆积。 */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHED_TASKS = 60
const MAX_PENDING = 20

function scopedKey(userId: string | null | undefined) {
  return accountScopedKey(taskCacheBase, userId)
}

function pendingKey(userId: string | null | undefined) {
  return accountScopedKey(`${taskCacheBase}-pending`, userId)
}

export function readCachedTasks<T extends CachedTaskSeed = CachedTaskSeed>(userId: string | null | undefined): T[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(scopedKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : []
  } catch {
    return []
  }
}

export function writeCachedTasks(userId: string | null | undefined, tasks: CachedTaskSeed[]) {
  if (typeof window === 'undefined') return
  const key = scopedKey(userId)
  try {
    window.localStorage.setItem(key, JSON.stringify(tasks.slice(0, MAX_CACHED_TASKS)))
    // 只保留当前账号的缓存键，避免本地存储随账号切换无限增长。
    pruneScopedKeys(taskCacheBase, key)
  } catch {
    // 存储不可用时不影响任务本身，后端仍是事实来源。
  }
}

export function readPendingSubmissions<T extends CachedTaskSeed = CachedTaskSeed>(userId: string | null | undefined): Map<string, T> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.localStorage.getItem(pendingKey(userId))
    if (!raw) return new Map()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const entries = parsed
      .filter((item): item is { clientRequestId: string; local: T; at: number } => Boolean(item?.clientRequestId && item?.local))
      .filter((item) => Date.now() - Number(item.at || 0) < PENDING_TTL_MS)
    return new Map(entries.map((item) => [item.clientRequestId, item.local]))
  } catch {
    return new Map()
  }
}

export function writePendingSubmissions<T extends CachedTaskSeed = CachedTaskSeed>(userId: string | null | undefined, pending: Map<string, T>) {
  if (typeof window === 'undefined') return
  const key = pendingKey(userId)
  try {
    const entries = [...pending.entries()].map(([clientRequestId, local]) => ({ clientRequestId, local, at: Date.now() }))
    window.localStorage.setItem(key, JSON.stringify(entries.slice(0, MAX_PENDING)))
    pruneScopedKeys(`${taskCacheBase}-pending`, key)
  } catch {
    // 存储不可用时不阻塞提交流程。
  }
}

/**
 * 清理某个账号的全部任务缓存。
 * 退出登录或切换账号时调用，确保下一个登录者看不到上一个账号的内容
 * （包括任务提示词、失败占位、未确认提交）。
 */
export function clearScopedTaskCache(userId: string | null | undefined) {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.removeItem(scopedKey(userId))
    window.localStorage.removeItem(pendingKey(userId))
  } catch {
    // 存储不可用时忽略。
  }
}
