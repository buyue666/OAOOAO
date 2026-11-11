import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as jsxRuntime from 'react/jsx-runtime'
import ts from 'typescript'

async function loadModule(file, imports = {}, globals = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
  const exports = {}
  const require = (name) => {
    if (!(name in imports)) throw new Error(`Unexpected runtime dependency: ${name}`)
    return imports[name]
  }
  new Function('require', 'exports', ...Object.keys(globals), outputText)(require, exports, ...Object.values(globals))
  return exports
}
const navigation = {
  redirect(destination) { throw Object.assign(new Error('Redirect'), { destination }) },
  notFound() { throw Object.assign(new Error('Not found'), { status: 404 }) },
}
const routes = await loadModule('../lib/studio/project-route.ts')
const PluginDramaPage = () => null
const imports = { '@/components/studio/plugins/plugin-workspaces': { PluginDramaPage }, 'next/navigation': navigation, 'react/jsx-runtime': jsxRuntime, '@/lib/studio/project-route': routes }
const RootPage = (await loadModule('../app/projects/[projectId]/page.tsx', imports)).default
const SectionPage = (await loadModule('../app/projects/[projectId]/[section]/page.tsx', imports)).default
const DramaIndex = (await loadModule('../app/drama/page.tsx', imports)).default
const InvitePage = (await loadModule('../app/invite/[code]/page.tsx', imports)).default

test('invitation route enters the registration page and retains a valid synthetic code', async () => {
  await assert.rejects(InvitePage({ params: Promise.resolve({ code: 'TEST_invite-42' }) }), (error) => error.destination === '/register?ref=TEST_invite-42')
})

test('malformed invitation codes redirect safely without a second URI decode', async () => {
  for (const code of ['%', '%ZZ', '../other', '//outside.test', '<script>', '']) {
    await assert.rejects(InvitePage({ params: Promise.resolve({ code }) }), (error) => error.destination === '/register')
  }
})

test('drama index exposes the staged production workflow with no removed analyzer endpoint', async () => {
  assert.equal((await DramaIndex()).type, PluginDramaPage)
})

test('actual project root routes a canvas ID into the real editor and preserves repeated query values', async () => {
  await assert.rejects(RootPage({ params: Promise.resolve({ projectId: 'canvas-test' }), searchParams: Promise.resolve({ tag: ['one', 'two'], returnTo: '/works?tab=recent', empty: '', absent: undefined }) }), (error) => error.destination === '/canvas/canvas-test?tag=one&tag=two&returnTo=%2Fworks%3Ftab%3Drecent&empty=')
})

test('all old canvas section URLs redirect before any legacy demo component can render', async () => {
  for (const section of ['overview', 'characters', 'cut', 'script', 'storyboard', 'canvas', 'settings', 'unknown']) {
    await assert.rejects(SectionPage({ params: Promise.resolve({ projectId: 'canvas-test', section }), searchParams: Promise.resolve({ from: 'old-link' }) }), (error) => error.destination === '/canvas/canvas-test?from=old-link')
  }
})

test('actual drama routes retain the real workspace and requested view', async () => {
  const page = await RootPage({ params: Promise.resolve({ projectId: 'drama-test' }) })
  assert.equal(page.type, PluginDramaPage)
  assert.equal(page.props.projectId, 'drama-test')
  const section = await SectionPage({ params: Promise.resolve({ projectId: 'drama-test', section: 'characters' }) })
  assert.equal(section.type, PluginDramaPage)
  assert.equal(section.props.section, 'characters')
})

test('project identifiers cannot turn a compatibility redirect into another route or origin', async () => {
  await assert.rejects(RootPage({ params: Promise.resolve({ projectId: '../outside?x=1#fragment' }) }), (error) => error.destination === '/canvas/..%2Foutside%3Fx%3D1%23fragment')
})

async function canvasLoader(response, environment = 'production') {
  const preview = await loadModule('../lib/studio/preview-mode.ts', {}, { process: { env: { NODE_ENV: environment } } })
  return loadModule('../components/free-canvas/canvas-server-data.ts', {
    'next/headers': { cookies: async () => ({ toString: () => 'synthetic-session=fixture' }) },
    'next/navigation': navigation,
    '@/lib/studio/preview-mode': preview,
    './canvas-workspace': await loadModule('../components/free-canvas/canvas-workspace.ts'),
  }, { process: { env: { OAOAO_BACKEND_URL: 'http://synthetic.invalid' } }, fetch: async (...args) => typeof response === 'function' ? response(...args) : response.clone() })
}

test('canvas plugin access accepts the account API direct response and keeps cookie forwarding', async () => {
  const loader = await canvasLoader((url, init) => {
    assert.equal(String(url), 'http://synthetic.invalid/api/account/plugins')
    assert.equal(init.headers.cookie, 'synthetic-session=fixture')
    assert.equal(init.cache, 'no-store')
    return Response.json({ installedPlugins: ['agent', 'canvas'] })
  })
  assert.deepEqual(await loader.loadCanvasPluginAccess(), { installed: true, error: null })
})

test('canvas plugin access also accepts an enveloped account response', async () => {
  const loader = await canvasLoader(Response.json({ code: 0, data: { installedPlugins: ['canvas'] } }))
  assert.deepEqual(await loader.loadCanvasPluginAccess(), { installed: true, error: null })
})

test('uninstalled canvas stays uninstalled and its page never fetches project data', async () => {
  const requested = []
  const loader = await canvasLoader(url => {
    requested.push(new URL(url).pathname)
    return Response.json({ installedPlugins: ['agent'] })
  })
  const PluginCanvasIndex = () => null
  const page = (await loadModule('../app/canvas/page.tsx', {
    '@/components/free-canvas/plugin-canvas': { PluginCanvasIndex },
    '@/components/free-canvas/canvas-server-data': loader,
    'react/jsx-runtime': jsxRuntime,
  })).default
  const result = await page()
  assert.deepEqual(requested, ['/api/account/plugins'])
  assert.deepEqual(result.props, { loaded: false, projects: [], loadError: null })
})

test('installed canvas page loads the real project envelope after the direct plugin response', async () => {
  const projects = [{ id: 'canvas-fixture', title: 'Synthetic saved canvas', nodeCount: 2, connectionCount: 1 }]
  const requested = []
  const loader = await canvasLoader(url => {
    const parsed = new URL(url)
    requested.push(parsed.pathname)
    if (parsed.pathname === '/api/account/plugins') return Response.json({ installedPlugins: ['canvas'] })
    assert.equal(parsed.pathname, '/api/canvas/projects')
    assert.equal(parsed.searchParams.get('pageSize'), '100')
    return Response.json({ code: 0, data: { projects } })
  })
  const PluginCanvasIndex = () => null
  const page = (await loadModule('../app/canvas/page.tsx', {
    '@/components/free-canvas/plugin-canvas': { PluginCanvasIndex },
    '@/components/free-canvas/canvas-server-data': loader,
    'react/jsx-runtime': jsxRuntime,
  })).default
  assert.deepEqual((await page()).props, { loaded: true, projects, loadError: null })
  assert.deepEqual(requested, ['/api/account/plugins', '/api/canvas/projects'])
})

test('a valid empty canvas list is not a service failure', async () => {
  const loader = await canvasLoader(Response.json({ code: 0, data: { projects: [] } }))
  assert.deepEqual(await loader.loadCanvasSummaries(), { projects: [], error: null })
})

test('plugin access rejects malformed successful payloads instead of hiding a service error', async () => {
  for (const payload of [{}, { installedPlugins: 'canvas' }, { installedPlugins: [null] }, { data: null }, null, []]) {
    const loader = await canvasLoader(Response.json(payload))
    const result = await loader.loadCanvasPluginAccess()
    assert.equal(result.installed, false)
    assert.match(result.error, /数据格式/)
    assert.doesNotMatch(result.error, /返回 200/)
  }
})

test('successful non-JSON responses are shown as invalid data', async () => {
  const loader = await canvasLoader(new Response('<html>Gateway response</html>', { status: 200 }))
  const result = await loader.loadCanvasPluginAccess()
  assert.equal(result.installed, false)
  assert.match(result.error, /数据格式/)
})

test('plugin access preserves service failures and redirects expired production sessions', async () => {
  const offline = await canvasLoader(Response.json({ error: '测试服务暂不可用' }, { status: 503 }))
  assert.deepEqual(await offline.loadCanvasPluginAccess(), { installed: false, error: '测试服务暂不可用' })
  const unsigned = await canvasLoader(Response.json({}, { status: 401 }))
  await assert.rejects(unsigned.loadCanvasPluginAccess(), error => error.destination === '/login')
  const preview = await canvasLoader(Response.json({}, { status: 401 }), 'development')
  assert.deepEqual(await preview.loadCanvasPluginAccess(), { installed: false, error: null })
})

test('business error payloads cannot grant plugin access even with HTTP 200', async () => {
  for (const payload of [{ code: 1, msg: '插件状态查询失败', data: { installedPlugins: ['canvas'] } }, { error: '插件状态查询失败', installedPlugins: ['canvas'] }]) {
    const loader = await canvasLoader(Response.json(payload))
    assert.deepEqual(await loader.loadCanvasPluginAccess(), { installed: false, error: '插件状态查询失败' })
  }
})

test('redirect destination checks the owner-backed project and rejects unknown IDs with 404', async () => {
  const loader = await canvasLoader(new Response('{}', { status: 404 }))
  await assert.rejects(loader.loadCanvasProject('unknown-test'), (error) => error.status === 404)
})

test('redirect destination respects authentication and does not substitute demo data on failure', async () => {
  const unsigned = await canvasLoader(new Response('{}', { status: 401 }))
  await assert.rejects(unsigned.loadCanvasProject('canvas-test'), (error) => error.destination === '/login')
  const offline = await canvasLoader(new Response('{}', { status: 503 }))
  assert.deepEqual(await offline.loadCanvasProject('canvas-test'), { project: null, error: '画布服务返回 503' })
})

test('production canvas lists still require a real session', async () => {
  const loader = await canvasLoader(new Response('{}', { status: 401 }))
  await assert.rejects(loader.loadCanvasSummaries(), (error) => error.destination === '/login')
})

test('development preview can show the canvas list without exposing private projects', async () => {
  const loader = await canvasLoader(new Response('{}', { status: 401 }), 'development')
  assert.deepEqual(await loader.loadCanvasSummaries(), { projects: [], error: null })
  const detail = await loader.loadCanvasProject('private-canvas')
  assert.equal(detail.project, null)
  assert.match(detail.error, /免登录预览.*登录/)
})

test('development preview preserves real backend errors and missing-project responses', async () => {
  const offline = await canvasLoader(new Response('{}', { status: 503 }), 'development')
  assert.deepEqual(await offline.loadCanvasSummaries(), { projects: [], error: '画布服务返回 503' })
  const missing = await canvasLoader(new Response('{}', { status: 404 }), 'development')
  await assert.rejects(missing.loadCanvasProject('unknown-canvas'), (error) => error.status === 404)
})
