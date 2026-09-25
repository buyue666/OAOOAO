'use client'

/**
 * 画布入口页。
 *
 * 为什么需要它：侧边栏与首页都提供「自由画布」入口，而画布必须绑定一个
 * **真实项目**。早先入口直接写死 `/canvas/aurora`（演示项目），
 * 真实账号下该请求返回 404，用户看到的是一个加载失败的空页面。
 *
 * 这里按真实数据解析目标项目：
 *  1. 已有选中项目 → 直接进入；
 *  2. 已有项目列表 → 进入第一个（属于当前用户）；
 *  3. 一个都没有 → **为本用户新建一个**画布项目后进入；
 *  4. 未登录 → 明确提示登录，不伪造一个本地项目。
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ControlButton, EmptyState } from './ui'
import { listCanvasProjects } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'

export function CanvasIndexPage() {
  const router = useRouter()
  const { state, createProject } = useStudio()
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  /** 防止 StrictMode 下的重复执行产生两个项目。 */
  const startedRef = useRef(false)
  /**
   * 项目列表是否已经**从服务端加载完成**。
   *
   * `backendStatus === 'connected'` 只说明会话拿到了，项目列表可能还在请求中。
   * 此时 `state.projects` 仍是**演示数据**（含演示项目 `aurora`），
   * 用它跳转就会落到 `/canvas/aurora`（服务端不存在 → 404）。
   * 实测：项目请求与跳转几乎同时发生，跳转先于响应到达。
   *
   * 因此这里显式等待列表请求结束（成功或失败），再决定目标项目。
   */
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  useEffect(() => {
    if (state.backendStatus === 'checking') return
    if (state.backendStatus !== 'connected') { setProjectsLoaded(true); return }
    let cancelled = false
    listCanvasProjects()
      .then(() => { if (!cancelled) setProjectsLoaded(true) })
      .catch(() => { if (!cancelled) setProjectsLoaded(true) })
    return () => { cancelled = true }
  }, [state.backendStatus])

  useEffect(() => {
    if (startedRef.current) return
    if (state.backendStatus === 'checking') return
    // 已连接时必须等真实项目列表就绪，否则会用到演示数据。
    if (state.backendStatus === 'connected' && !projectsLoaded) return
    startedRef.current = true

    // 未登录 / 后端不可用：不创建项目，明确提示。
    if (state.backendStatus === 'unauthenticated') { setError('unauthenticated'); return }
    if (state.backendStatus === 'offline') { setError('后端暂时不可用，无法创建或读取画布项目。请稍后重试。'); return }

    /**
     * 已连接：只使用**真实存在**的项目。
     *
     * 必须校验 `selectedProjectId` 确实在项目列表里：
     * 它可能来自 localStorage 的旧值（例如老版本写死的演示项目 `aurora`），
     * 直接跳过去仍会 404。失效时回落到列表里的第一个真实项目。
     */
    const exists = state.projects.some((project) => project.id === state.selectedProjectId)
    const target = exists ? state.selectedProjectId : state.projects[0]?.id
    if (target) { router.replace(`/canvas/${target}`); return }

    // 已连接且确实没有项目：为当前用户新建一个。
    setCreating(true)
    void createProject('新建画布项目')
      .then((project) => router.replace(`/canvas/${project.id}`))
      .catch((reason) => setError(reason instanceof Error ? reason.message : '创建画布项目失败'))
      .finally(() => setCreating(false))
  }, [createProject, projectsLoaded, router, state.backendStatus, state.projects, state.selectedProjectId])

  if (error === 'unauthenticated') {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-10">
        <EmptyState
          title="请先登录"
          description="画布需要绑定属于你的项目，登录后即可创建并进入。"
          action={<ControlButton variant="primary" onClick={() => router.push('/login')}>去登录</ControlButton>}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-10">
        <EmptyState
          title="无法打开画布"
          description={error}
          action={<ControlButton variant="secondary" onClick={() => router.push('/projects')}>前往项目列表</ControlButton>}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <p className="text-sm text-muted-foreground" role="status">{creating ? '正在为你创建画布项目…' : '正在打开画布…'}</p>
    </div>
  )
}
