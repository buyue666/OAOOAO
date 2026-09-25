'use client'

/**
 * 当前画布项目关联的**真实短剧项目**。
 *
 * 背景（本轮复现的真实缺陷）：
 * 剧本页与分镜页是从**画布项目**进入的（`/projects/<canvasProjectId>/script`），
 * 但真正能承载剧本、分镜与生成结果的只有**短剧项目**（`/api/drama/projects/<dramaId>`）。
 * 早先这两个页面读的是本地演示数据（`mock-data.ts` 里 key 为 `aurora` 的 shots），
 * 「保存」只改本地 React state，刷新后自然什么都不剩。
 *
 * 这里刻意把三种状态分开，避免把「没有关联」误报成错误、也避免顺手造一个短剧项目：
 *  - 画布项目**没有**对应短剧项目 → `state: 'unlinked'`（正常状态，提供创建入口）；
 *  - 短剧接口失败 → `state: 'error'` + 后端原文；
 *  - 未登录 → `state: 'unauthenticated'`。
 *
 * 竞态：账号或项目变化时用 `createWriteGuard()` 的令牌作废在途响应，
 * 上一个项目的迟到响应不会写进新项目的界面（与 `use-account-data.ts` 同一套约定）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createWriteGuard, subscribeAccountData } from './account-data-sync'
import {
  StudioApiError,
  getCanvasProject,
  getDramaProject,
  listDramaProjects,
  saveDramaProject,
} from './api'
import { resolveLinkedDramaProjectId } from './drama-link'
import type { DramaProject } from './drama-types'
import { useStudio } from './store'

/**
 * 加载状态。
 *
 * `unlinked` 是本 hook 专有的：它表示「这个画布项目本来就没有短剧项目」，
 * 与 `error`（读取失败）和 `ready`（读到了）都必须区分开。
 */
export type DramaLinkState = 'idle' | 'loading' | 'ready' | 'unlinked' | 'unauthenticated' | 'error'

function classify(reason: unknown): { state: DramaLinkState; message: string } {
  if (reason instanceof StudioApiError) {
    if (reason.outcome === 'expired') return { state: 'unauthenticated', message: '登录状态已失效，请重新登录。' }
    if (reason.outcome === 'not-found') return { state: 'error', message: `${reason.message}（短剧项目可能已被删除）` }
    if (reason.isIndeterminate) return { state: 'error', message: `${reason.message}（数据未确认，可重试）` }
    return { state: 'error', message: reason.message }
  }
  return { state: 'error', message: reason instanceof Error ? reason.message : '短剧项目加载失败' }
}

export function useLinkedDramaProject(canvasProjectId: string, options: { enabled?: boolean } = {}) {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected'
  const userId = state.user.id
  const enabled = options.enabled !== false
  const [revision, setRevision] = useState(0)
  const [project, setProject] = useState<DramaProject | null>(null)
  const [dramaProjectId, setDramaProjectId] = useState<string | null>(null)
  const [state_, setState] = useState<DramaLinkState>('idle')
  const [message, setMessage] = useState('')
  const guardRef = useRef(createWriteGuard())

  useEffect(() => subscribeAccountData(() => setRevision((value) => value + 1)), [])

  const load = useCallback(async () => {
    if (!enabled || !canvasProjectId) {
      // 没有项目上下文时保持 idle：既不报错，也不假装「没有短剧项目」。
      guardRef.current.invalidate()
      setState('idle')
      setProject(null)
      setDramaProjectId(null)
      setMessage('')
      return
    }
    if (!connected) {
      setState('unauthenticated')
      setProject(null)
      setDramaProjectId(null)
      return
    }
    const token = guardRef.current.begin()
    setState('loading')
    setMessage('')
    try {
      /**
       * 画布项目里的 `sourceHandoffId` 是最准确的关联凭据（后端自己写入的），
       * 只有它读不到时才退回「去掉 canvas- 前缀」的推导。
       */
      const canvasProject = await getCanvasProject(canvasProjectId).catch(() => null)
      if (!guardRef.current.isCurrent(token)) return
      const listed = await listDramaProjects()
      if (!guardRef.current.isCurrent(token)) return
      const linkedId = resolveLinkedDramaProjectId(
        canvasProjectId,
        listed.projects.map((item) => item.id),
        canvasProject?.sourceHandoffId,
      )
      if (!linkedId) {
        setProject(null)
        setDramaProjectId(null)
        setState('unlinked')
        return
      }
      const loaded = await getDramaProject(linkedId)
      if (!guardRef.current.isCurrent(token)) return
      setProject(loaded)
      setDramaProjectId(linkedId)
      setState('ready')
    } catch (reason) {
      if (!guardRef.current.isCurrent(token)) return
      const classified = classify(reason)
      setState(classified.state)
      setMessage(classified.message)
      setProject(null)
      setDramaProjectId(null)
    }
  }, [canvasProjectId, connected, enabled])

  useEffect(() => {
    void load()
    return () => { guardRef.current.invalidate() }
    // 账号变化、刷新信号、项目变化都必须重新读取。
  }, [load, revision, userId])

  /**
   * 保存短剧项目。
   *
   * `mutate` 拿到当前项目并返回要提交的新项目，由调用方保证 `episodes` 完整
   * （后端缺少 episodes 会直接 400）。返回后端确认后的项目。
   *
   * **版本**：提交的是 `base.updatedAt`，也就是本 hook 真正加载到内存的那一版
   * （可能是页面刚打开时读的，也可能已被本地的乐观更新推进过），
   * 绝不在这里重新 GET 一个「最新版本」再覆盖 —— 那正是用户明确拒绝的
   * 「自动重读后覆盖」，会把并发窗口重新打开。
   *
   * 失败时**原样抛出**后端原因：界面必须保留草稿并显示真实错误。
   * 其中 409（`StudioApiError.status === 409`）表示别的窗口已经先写入，
   * 本 hook **不做任何自动重试**，由界面提示冲突、让用户决定。
   */
  const save = useCallback(async (mutate: (current: DramaProject) => DramaProject): Promise<DramaProject> => {
    if (!dramaProjectId) throw new StudioApiError('当前画布项目没有关联的短剧项目，无法保存', 409)
    const base = project
    if (!base) throw new StudioApiError('短剧项目尚未加载完成，请稍后重试', 409)
    const saved = await saveDramaProject(dramaProjectId, mutate(base), base.updatedAt)
    setProject(saved)
    return saved
  }, [dramaProjectId, project])

  /** 本地替换（分镜任务写回后立刻更新视图，不必再打一次读接口）。 */
  const replace = useCallback((next: DramaProject) => setProject(next), [])

  return { project, dramaProjectId, state: state_, message, reload: load, save, replace }
}

/**
 * 由短剧项目取出当前分集。
 *
 * `activeEpisodeId` 可能指向已被删除的分集，因此取不到时回落到第一集——
 * 这与后端 `normalizeProject` 的口径一致（`activeEpisodeId` 最终一定落在真实存在的分集上）。
 */
export function activeEpisodeOf(project: DramaProject | null) {
  if (!project || !project.episodes?.length) return null
  return project.episodes.find((episode) => episode.id === project.activeEpisodeId) ?? project.episodes[0]
}
