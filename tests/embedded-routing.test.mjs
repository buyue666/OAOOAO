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

test('内嵌后端不继承函数宿主的零端口', async () => {
  const embedded = await readFile(new URL('../lib/server/embedded-backend.ts', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('embedded-backend.ts', embedded, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getEmbeddedBackend')
  assert.ok(declaration)
  const implementation = ts.transpileModule(declaration.getText(parsed).replace(/^export /, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  let captured
  const app = { ready: async () => {} }
  const create = new Function('state', 'loadConfig', 'resolveBackendOrigin', 'resolve', 'tmpdir', 'Pool', 'buildApp', implementation + '; return getEmbeddedBackend')
  const getBackend = create({}, env => { captured = env; return { production: true, databaseUrl: 'unused' } }, () => 'https://studio.test', (...parts) => parts.join('/'), () => '/tmp', class { end() {} }, async () => app)
  const previous = process.env.PORT
  try {
    process.env.PORT = '0'
    assert.equal(await getBackend(), app)
    assert.equal(captured.PORT, '3001')
    assert.equal(captured.WORKER_ENABLED, 'false')
  } finally {
    if (previous === undefined) delete process.env.PORT; else process.env.PORT = previous
  }
})

test('初始化诊断保留原因并脱敏原始和 URL 编码凭据', async () => {
  const failing = source.replace('Response.json({ embedded: true, path: new URL(request.url).pathname })', "Promise.reject(new Error('Unit startup failure: ' + process.env.ENCRYPTION_KEY + ' ' + encodeURIComponent(process.env.DATABASE_URL)))")
  const output = ts.transpileModule(failing, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const failingRoute = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'))
  const names = ['DATABASE_URL', 'ENCRYPTION_KEY', 'OAOAO_BACKEND_URL']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const previousError = console.error
  const logs = []
  try {
    process.env.DATABASE_URL = 'postgresql://unit:unit-secret@unit.invalid/studio'
    process.env.ENCRYPTION_KEY = 'unit-private-key-do-not-log'
    delete process.env.OAOAO_BACKEND_URL
    console.error = (...parts) => logs.push(parts)
    const request = Object.assign(new Request('https://studio.test/api/health/ready'), { nextUrl: new URL('https://studio.test/api/health/ready') })
    const response = await failingRoute.GET(request)
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /Unit startup failure|unit-private-key/)
    assert.equal(logs[0][0], 'Embedded backend unavailable')
    assert.match(logs[0][1].detail, /Unit startup failure: \[redacted\] \[redacted\]/)
    const emitted = JSON.stringify(logs)
    assert.ok(!emitted.includes(process.env.ENCRYPTION_KEY))
    assert.ok(!emitted.includes(process.env.DATABASE_URL))
    assert.ok(!emitted.includes(encodeURIComponent(process.env.DATABASE_URL)))
  } finally {
    console.error = previousError
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]
  }
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
