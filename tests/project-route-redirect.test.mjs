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
const CreativeWorkspace = () => null
const imports = { 'next/navigation': navigation, 'react/jsx-runtime': jsxRuntime, '@/components/studio/creative-workspace': { CreativeWorkspace }, '@/lib/studio/project-route': routes }
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

test('drama index enters the current project creation flow rather than the removed analyze endpoint', async () => {
  await assert.rejects(Promise.resolve().then(() => DramaIndex()), (error) => error.destination === '/projects')
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
  assert.equal(page.type, CreativeWorkspace)
  assert.equal(page.props.projectId, 'drama-test')
  const section = await SectionPage({ params: Promise.resolve({ projectId: 'drama-test', section: 'characters' }) })
  assert.equal(section.type, CreativeWorkspace)
  assert.equal(section.props.initialView, 'characters')
})

test('project identifiers cannot turn a compatibility redirect into another route or origin', async () => {
  await assert.rejects(RootPage({ params: Promise.resolve({ projectId: '../outside?x=1#fragment' }) }), (error) => error.destination === '/canvas/..%2Foutside%3Fx%3D1%23fragment')
})

async function canvasLoader(response) {
  return loadModule('../components/free-canvas/canvas-server-data.ts', {
    'next/headers': { cookies: async () => ({ toString: () => 'synthetic-session=fixture' }) },
    'next/navigation': navigation,
  }, { process: { env: { OAOAO_BACKEND_URL: 'http://synthetic.invalid' } }, fetch: async () => response })
}

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
