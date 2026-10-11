import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import type { CanvasBackendProject, CanvasSummary } from '@/lib/studio/api'

type LoadOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }

function backendUrlFor(pathWithQuery: string) {
  const configured = process.env.OAOAO_BACKEND_URL?.trim()
  if (!configured) return null
  const target = new URL(configured)
  const requested = new URL(pathWithQuery, 'http://localhost')
  target.pathname = `${target.pathname.replace(/\/$/, '')}${requested.pathname}`
  target.search = requested.search
  return target
}

/**
 * 服务端首屏读取画布数据：把浏览器的 Cookie 原样转发给后端，与 /api 代理的鉴权方式一致。
 * 数据随页面一起渲染，客户端不需要在挂载后再发起请求。
 */
async function loadFromBackend<T>(pathWithQuery: string): Promise<LoadOutcome<T>> {
  let target: URL | null
  try {
    target = backendUrlFor(pathWithQuery)
  } catch {
    return { kind: 'error', message: '后端服务地址无效，请检查 OAOAO_BACKEND_URL' }
  }
  if (!target) return { kind: 'error', message: '后端服务未配置' }

  let response: Response
  try {
    response = await fetch(target, {
      headers: { accept: 'application/json', cookie: (await cookies()).toString() },
      cache: 'no-store',
    })
  } catch {
    return { kind: 'error', message: '后端连接失败，请稍后重试' }
  }
  if (response.status === 401) return { kind: 'unauthorized' }
  if (response.status === 404) return { kind: 'not-found' }

  const payload = (await response.json().catch(() => null)) as { msg?: string; data?: T } | null
  if (!response.ok || !payload?.data) {
    return { kind: 'error', message: payload?.msg || `画布服务返回 ${response.status}` }
  }
  return { kind: 'ok', data: payload.data }
}

export async function loadCanvasSummaries(): Promise<{ projects: CanvasSummary[]; error: string | null }> {
  const outcome = await loadFromBackend<{ projects: CanvasSummary[] }>('/api/canvas/projects?page=1&pageSize=100')
  if (outcome.kind === 'unauthorized') redirect('/login')
  if (outcome.kind !== 'ok') {
    return { projects: [], error: outcome.kind === 'error' ? outcome.message : '画布列表不存在' }
  }
  return { projects: outcome.data.projects ?? [], error: null }
}

export async function loadCanvasProject(projectId: string): Promise<{ project: CanvasBackendProject | null; error: string | null }> {
  const outcome = await loadFromBackend<{ project: CanvasBackendProject }>(`/api/canvas/projects/${encodeURIComponent(projectId)}`)
  if (outcome.kind === 'unauthorized') redirect('/login')
  if (outcome.kind === 'not-found') notFound()
  if (outcome.kind !== 'ok') return { project: null, error: outcome.kind === 'error' ? outcome.message : null }
  return { project: outcome.data.project, error: null }
}
