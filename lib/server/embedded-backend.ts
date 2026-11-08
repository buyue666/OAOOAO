import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { Pool } from 'pg'
import type { FastifyRequest, HTTPMethods } from 'fastify'
import { buildApp, loadConfig } from '@/backend/src/app'
import { resolveBackendOrigin } from './backend-origin'

type EmbeddedBackend = Awaited<ReturnType<typeof buildApp>>
const state = globalThis as typeof globalThis & { __oaooaoBackend?: Promise<EmbeddedBackend> }

export function getEmbeddedBackend(): Promise<EmbeddedBackend> {
  if (state.__oaooaoBackend) return state.__oaooaoBackend
  const config = loadConfig({
    ...process.env,
    PUBLIC_ORIGIN: resolveBackendOrigin(),
    MEDIA_ROOT: process.env.MEDIA_ROOT || resolve(tmpdir(), 'oaooao-media'),
    WORKER_ENABLED: 'false',
    TRUSTED_PROXY_CIDRS: '',
  })
  config.previewCookies = !config.production && Boolean(process.env.V0_RUNTIME_URL || process.env.V0_DEV_APP_URL || process.env.V0_BUILD_URL || process.env.V0_SANDBOX_URL)
  const db = new Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 20000, allowExitOnIdle: true })
  state.__oaooaoBackend = buildApp({ db, config }).then(async app => {
    await app.ready()
    return app
  }).catch(async error => {
    state.__oaooaoBackend = undefined
    await db.end()
    throw error
  })
  return state.__oaooaoBackend
}

function remoteAddress(request: Request) {
  const candidate = process.env.VERCEL === '1'
    ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    : process.env.OAOAO_TRUST_REVERSE_PROXY === 'true' ? request.headers.get('x-real-ip')?.trim() : undefined
  return candidate && isIP(candidate) ? candidate : '127.0.0.1'
}

function shouldWakeWorker(request: Request, status: number, payload: Buffer) {
  if (status < 200 || status >= 300) return false
  const path = new URL(request.url).pathname
  if (!/^\/api\/(?:agent\/runs|(?:image|video|audio|text)-tasks|video-generation-tasks|drama\/render|teams\/[^/]+\/projects\/[^/]+\/generations)\b/.test(path)) return false
  if (request.method === 'POST') return true
  if (request.method !== 'GET') return false
  try {
    const body = JSON.parse(payload.toString('utf8'))
    const task = body.task || body.data || body.run
    return !task?.needsReview && ['pending', 'planning', 'running'].includes(task?.status || task?.state)
  } catch { return false }
}

export async function handleEmbeddedRequest(request: Request): Promise<Response> {
  const app = await getEmbeddedBackend()
  const url = new URL(request.url)
  const headers = Object.fromEntries(request.headers)
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'forwarded', 'x-real-ip', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-vercel-forwarded-for', 'upgrade']) delete headers[name]
  headers.origin = app.ctx.config.origin
  headers.referer = `${app.ctx.config.origin}/`
  headers['accept-encoding'] = 'identity'
  const upstream = await app.inject({
    method: request.method as HTTPMethods,
    url: `${url.pathname}${url.search}`,
    headers,
    remoteAddress: remoteAddress(request),
    ...(request.body && !['GET', 'HEAD'].includes(request.method) ? { payload: Readable.fromWeb(request.body as never) } : {}),
  })
  if (shouldWakeWorker(request, upstream.statusCode, upstream.rawPayload)) {
    const user = await app.ctx.requireUser({ cookies: app.parseCookie(request.headers.get('cookie') || '') } as FastifyRequest)
    const { start } = await import('workflow/api')
    const { HookConflictError } = await import('workflow/errors')
    const { runGenerationQueue } = await import('@/lib/server/generation-workflow')
    try {
      await start(runGenerationQueue, [user.id], { experimental_hook: { token: `oaooao-generation:${user.id}` } })
    } catch (error) {
      if (!HookConflictError.is(error)) console.error('Generation queue dispatch unavailable', { type: error instanceof Error ? error.name : 'UnknownError' })
    }
  }
  const responseHeaders = new Headers()
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || ['connection', 'content-length', 'content-encoding', 'transfer-encoding'].includes(name)) continue
    for (const item of Array.isArray(value) ? value : [String(value)]) responseHeaders.append(name, item)
  }
  responseHeaders.set('cache-control', 'no-store')
  const body = request.method === 'HEAD' || [204, 304].includes(upstream.statusCode) ? null : new Uint8Array(upstream.rawPayload)
  return new Response(body, { status: upstream.statusCode, headers: responseHeaders })
}
