import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = (await readFile(new URL('../app/api/[...path]/route.ts', import.meta.url), 'utf8')).replace(
  "import('@/lib/server/embedded-backend')",
  "Promise.resolve({ handleEmbeddedRequest: async request => Response.json({ embedded: true, path: new URL(request.url).pathname }) })",
)
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const route = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const originSource = await readFile(new URL('../lib/server/backend-origin.ts', import.meta.url), 'utf8')
const originCompiled = ts.transpileModule(originSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { resolveBackendOrigin } = await import('data:text/javascript;base64,' + Buffer.from(originCompiled).toString('base64'))

test('后端域名兼容 Vercel 与 v0 裸域名，并保留显式配置优先级', () => {
  assert.equal(resolveBackendOrigin({}), 'http://localhost:3000')
  assert.equal(resolveBackendOrigin({ V0_RUNTIME_URL: 'preview.v0.build' }), 'https://preview.v0.build')
  assert.equal(resolveBackendOrigin({ V0_RUNTIME_URL: 'https://preview.v0.build/path' }), 'https://preview.v0.build')
  assert.equal(resolveBackendOrigin({ V0_DEV_APP_URL: 'https://preview.v0.dev' }), 'https://preview.v0.dev')
  assert.equal(resolveBackendOrigin({ VERCEL_URL: 'branch.vercel.app' }), 'https://branch.vercel.app')
  assert.equal(resolveBackendOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'studio.vercel.app', VERCEL_URL: 'branch.vercel.app' }), 'https://studio.vercel.app')
  assert.equal(resolveBackendOrigin({ PUBLIC_ORIGIN: 'https://studio.test', OAOAO_PUBLIC_URL: 'https://other.test', VERCEL_URL: 'branch.vercel.app' }), 'https://studio.test')
  assert.equal(resolveBackendOrigin({ OAOAO_PUBLIC_URL: 'https://studio.test', V0_RUNTIME_URL: 'preview.v0.build' }), 'https://studio.test')
  assert.throws(() => resolveBackendOrigin({ PUBLIC_ORIGIN: 'not a URL', V0_RUNTIME_URL: 'preview.v0.build' }))
  assert.equal(resolveBackendOrigin({ V0_RUNTIME_URL: 'invalid host' }), 'http://localhost:3000')
  assert.equal(resolveBackendOrigin({ V0_RUNTIME_URL: 'unix:///tmp/runtime.sock' }), 'http://localhost:3000')
  assert.equal(resolveBackendOrigin({ V0_RUNTIME_URL: 'invalid host', V0_DEV_APP_URL: 'https://preview.v0.dev' }), 'https://preview.v0.dev')
})

test('同项目后端仍要求数据库并保留同源与外部代理配置校验', async () => {
  const names = ['DATABASE_URL', 'OAOAO_BACKEND_URL', 'OAOAO_PUBLIC_URL']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const request = (method = 'GET', headers = {}) => Object.assign(new Request('https://studio.test/api/auth/session', { method, headers }), { nextUrl: new URL('https://studio.test/api/auth/session') })
  try {
    delete process.env.DATABASE_URL
    delete process.env.OAOAO_BACKEND_URL
    process.env.OAOAO_PUBLIC_URL = 'https://studio.test'
    assert.equal((await route.GET(request())).status, 503)
    process.env.DATABASE_URL = 'postgresql://unit-test.invalid/studio'
    let response = await route.GET(request())
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { embedded: true, path: '/api/auth/session' })
    assert.equal((await route.POST(request('POST', { origin: 'https://evil.test' }))).status, 403)
    assert.equal((await route.POST(request('POST', { 'sec-fetch-site': 'cross-site' }))).status, 403)
    assert.equal((await route.POST(request('POST', { origin: 'https://studio.test' }))).status, 200)
    process.env.OAOAO_BACKEND_URL = '127.0.0.1:3001'
    response = await route.GET(request())
    assert.equal(response.status, 503)
    assert.match((await response.json()).error, /OAOAO_BACKEND_URL/)
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]
  }
})
