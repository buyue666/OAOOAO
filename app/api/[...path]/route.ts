import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 解析后端地址。
 *
 * `new URL()` 在缺协议（如 `127.0.0.1:3200`）时会抛错。若放在请求处理流程里抛出，
 * Next.js 会把整个接口变成 500，让所有页面表现为“系统接口异常”，且错误原因不可见。
 * 这里提前解析并返回明确的状态码与提示，便于定位配置问题。
 */
function resolveBackend(configured: string | undefined) {
  const value = configured?.trim()
  if (!value) return { error: Response.json({ error: '后端服务未配置' }, { status: 503 }) } as const
  let target: URL
  try {
    target = new URL(value)
  } catch {
    return { error: Response.json({ error: '后端服务地址无效，请检查 OAOAO_BACKEND_URL 是否包含 http:// 或 https:// 前缀' }, { status: 503 }) } as const
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { error: Response.json({ error: '后端服务地址只支持 http 或 https 协议' }, { status: 503 }) } as const
  }
  return { target } as const
}

async function proxy(request: NextRequest) {
  const resolved = resolveBackend(process.env.OAOAO_BACKEND_URL)
  if ('error' in resolved) return resolved.error
  const target = resolved.target
  // Validate the browser origin here before translating it to the upstream origin.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const expected = process.env.OAOAO_PUBLIC_URL || `${request.nextUrl.protocol}//${request.headers.get('host') || request.nextUrl.host}`
    for (const name of ['origin', 'referer']) {
      const value = request.headers.get(name)
      if (!value) continue
      try {
        if (new URL(value).origin !== new URL(expected).origin) return Response.json({ error: '跨站请求已被拦截' }, { status: 403 })
      } catch { return Response.json({ error: '请求来源无效' }, { status: 403 }) }
    }
    if (request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: '跨站请求已被拦截' }, { status: 403 })
  }
  target.pathname = `${target.pathname.replace(/\/$/, '')}${request.nextUrl.pathname}`
  target.search = request.nextUrl.search
  const headers = new Headers(request.headers)
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'upgrade']) headers.delete(name)
  headers.set('origin', target.origin)
  headers.set('referer', `${target.origin}/`)
  headers.set('accept-encoding', 'identity')
  try {
    const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, redirect: 'manual', cache: 'no-store', signal: request.signal }
    if (!['GET', 'HEAD'].includes(request.method)) { init.body = request.body; init.duplex = 'half' }
    const upstream = await fetch(target, init)
    const resultHeaders = new Headers(upstream.headers)
    for (const name of ['connection', 'content-length', 'content-encoding', 'transfer-encoding', 'set-cookie']) resultHeaders.delete(name)
    for (const cookie of upstream.headers.getSetCookie()) resultHeaders.append('set-cookie', cookie)
    resultHeaders.set('cache-control', 'no-store')
    return new Response(upstream.body, { status: upstream.status, headers: resultHeaders })
  } catch {
    return Response.json({ error: '后端连接失败，请稍后重试' }, { status: 502 })
  }
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS }
