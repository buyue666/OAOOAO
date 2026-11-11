import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import type { CanvasBackendProject, CanvasSummary } from '@/lib/studio/api'
import { isStudioPreview } from '@/lib/studio/preview-mode'
import { teamCanvasRoot, type CanvasWorkspace } from './canvas-workspace'

type LoadOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }

function backendUrlFor(pathWithQuery: string) {
  const configured = process.env.OAOAO_BACKEND_URL?.trim()
  if (!configured) return null
  const target = new URL(configured)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('后端服务地址必须使用 HTTP 或 HTTPS')
  const requested = new URL(pathWithQuery, 'http://localhost')
  target.pathname = `${target.pathname.replace(/\/$/, '')}${requested.pathname}`
  target.search = requested.search
  return target
}

/**
 * 服务端首屏读取画布数据：把浏览器的 Cookie 原样转发给后端，与 /api 代理的鉴权方式一致。
 * 数据随页面一起渲染，客户端不需要在挂载后再发起请求。
 */
async function loadFromBackend<T>(pathWithQuery: string, allowUnwrapped = false): Promise<LoadOutcome<T>> {
  // cookies() 必须在读取环境变量之前调用。这样即使构建时没有注入后端地址，
  // 页面也会保持动态渲染，不会把“后端服务未配置”错误固化进静态 HTML。
  const cookieHeader = (await cookies()).toString()
  let target: URL | null
  try {
    target = backendUrlFor(pathWithQuery)
  } catch {
    return { kind: 'error', message: '后端服务地址无效，请检查 OAOAO_BACKEND_URL' }
  }
  if (!target && !process.env.DATABASE_URL) return { kind: 'error', message: '后端服务未配置' }

  let response: Response
  try {
    if (target) {
      response = await fetch(target, {
        headers: { accept: 'application/json', cookie: cookieHeader },
        cache: 'no-store',
      })
    } else {
      const { handleEmbeddedRequest } = await import('@/lib/server/embedded-backend')
      response = await handleEmbeddedRequest(new Request(new URL(pathWithQuery, 'http://embedded.internal'), {
        headers: { accept: 'application/json', cookie: cookieHeader },
      }))
    }
  } catch {
    return { kind: 'error', message: '后端连接失败，请稍后重试' }
  }
  if (response.status === 401) return { kind: 'unauthorized' }
  if (response.status === 404) return { kind: 'not-found' }

  const decoded: unknown = await response.json().catch(() => null)
  const payload = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
    ? decoded as { code?: number; msg?: string; error?: string; data?: T }
    : null
  if (!response.ok || payload?.error || (typeof payload?.code === 'number' && payload.code !== 0)) {
    return { kind: 'error', message: payload?.msg || payload?.error || `画布服务返回 ${response.status}` }
  }
  // Account endpoints return their data directly; project endpoints use { data }.
  // Keep this explicit so an unrelated HTTP 200 payload is never an empty canvas.
  const data = payload && 'data' in payload ? payload.data : allowUnwrapped ? payload : null
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { kind: 'error', message: '画布服务数据格式异常，请稍后重试' }
  }
  return { kind: 'ok', data: data as T }
}

/** Check before reading tool data; uninstalled canvas routes stay light. */
export async function loadCanvasPluginAccess(): Promise<{ installed: boolean; error: string | null }> {
  const outcome = await loadFromBackend<{ installedPlugins: string[] }>('/api/account/plugins', true)
  if (outcome.kind === 'unauthorized') {
    if (isStudioPreview()) return { installed: false, error: null }
    redirect('/login')
  }
  if (outcome.kind !== 'ok') return { installed: false, error: outcome.kind === 'error' ? outcome.message : '插件状态读取失败' }
  if (!Array.isArray(outcome.data.installedPlugins) || outcome.data.installedPlugins.some(id => typeof id !== 'string')) {
    return { installed: false, error: '插件状态数据格式异常，请稍后重试' }
  }
  return { installed: outcome.data.installedPlugins.includes('canvas'), error: null }
}

export async function loadCanvasSummaries(): Promise<{ projects: CanvasSummary[]; error: string | null }> {
  const outcome = await loadFromBackend<{ projects: CanvasSummary[] }>('/api/canvas/projects?page=1&pageSize=100')
  if (outcome.kind === 'unauthorized') {
    if (isStudioPreview()) return { projects: [], error: null }
    redirect('/login')
  }
  if (outcome.kind !== 'ok') {
    return { projects: [], error: outcome.kind === 'error' ? outcome.message : '画布列表不存在' }
  }
  return { projects: outcome.data.projects ?? [], error: null }
}

export async function loadCanvasProject(projectId: string): Promise<{ project: CanvasBackendProject | null; error: string | null }> {
  const outcome = await loadFromBackend<{ project: CanvasBackendProject }>(`/api/canvas/projects/${encodeURIComponent(projectId)}`)
  if (outcome.kind === 'unauthorized') {
    if (isStudioPreview()) return { project: null, error: '免登录预览不读取个人画布，请登录后打开已保存的项目。' }
    redirect('/login')
  }
  if (outcome.kind === 'not-found') notFound()
  if (outcome.kind !== 'ok') return { project: null, error: outcome.kind === 'error' ? outcome.message : null }
  return { project: outcome.data.project, error: null }
}

export async function loadTeamCanvas(teamId: string, projectId: string) {
  const outcome = await loadFromBackend<{ project: CanvasBackendProject; workspace: CanvasWorkspace }>(`${teamCanvasRoot({ teamId, projectId })}/canvas`)
  if (outcome.kind === 'unauthorized') redirect('/login')
  if (outcome.kind === 'not-found') notFound()
  if (outcome.kind !== 'ok') return { project: null, workspace: undefined, error: outcome.kind === 'error' ? outcome.message : '无法打开团队画布' }
  return { ...outcome.data, error: null }
}
