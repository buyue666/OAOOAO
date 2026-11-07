import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function previewMode(environment) {
  const exports = {}
  new Function('exports', 'process', compile(read('../lib/studio/preview-mode.ts')))(exports, { env: { NODE_ENV: environment } })
  return exports.isStudioPreview
}

const appSource = read('../components/studio/studio-app.tsx')
const parsed = ts.createSourceFile('studio-app.tsx', appSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const routes = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'isProtectedStudioRoute')
const app = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'StudioApp')
const gateNames = ['isProtectedRoute', 'authRequired', 'authChecking', 'authRedirecting']
const gateStatements = app.body.statements.filter((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => gateNames.includes(declaration.name.getText(parsed))))
assert.equal(gateStatements.length, gateNames.length)
const accessSource = `${routes.getText(parsed)}
export function access(pathname, state) {
  ${gateStatements.map((node) => node.getText(parsed)).join('\n')}
  return { authChecking, authRedirecting }
}`

function accessIn(environment) {
  const exports = {}
  new Function('exports', 'isStudioPreview', compile(accessSource))(exports, previewMode(environment))
  return exports.access
}

const protectedPaths = ['/studio', '/image', '/video', '/agent', '/canvas', '/canvas/private', '/projects', '/projects/private', '/assets', '/tasks', '/works', '/skills', '/tools', '/account', '/settings']

test('preview startup explicitly selects the bundler used by the project configuration', () => {
  const manifest = JSON.parse(read('../package.json'))
  assert.equal(manifest.scripts.dev, 'next dev --webpack')
  assert.equal(manifest.scripts.build, 'next build --webpack')
})

test('guest preview is enabled only for development, never production or an unknown environment', () => {
  assert.equal(previewMode('development')(), true)
  for (const environment of ['production', 'test', 'preview', '', undefined]) {
    assert.equal(previewMode(environment)(), false)
  }
})

test('development workspaces remain visible while a guest session is loading, absent or offline', () => {
  const access = accessIn('development')
  for (const pathname of protectedPaths) {
    for (const backendStatus of ['checking', 'unauthenticated', 'offline']) {
      for (const hydrated of [false, true]) {
        assert.deepEqual(access(pathname, { hydrated, backendStatus }), { authChecking: false, authRedirecting: false }, `${pathname}: ${backendStatus}`)
      }
    }
  }
})

test('production still waits for the real session before showing protected workspaces', () => {
  const access = accessIn('production')
  for (const pathname of protectedPaths) {
    assert.deepEqual(access(pathname, { hydrated: false, backendStatus: 'checking' }), { authChecking: true, authRedirecting: false })
    assert.deepEqual(access(pathname, { hydrated: true, backendStatus: 'checking' }), { authChecking: true, authRedirecting: false })
  }
})

test('production redirects unsigned or offline sessions and accepts authenticated sessions', () => {
  const access = accessIn('production')
  for (const pathname of protectedPaths) {
    for (const backendStatus of ['unauthenticated', 'offline']) {
      assert.deepEqual(access(pathname, { hydrated: true, backendStatus }), { authChecking: false, authRedirecting: true })
    }
    assert.deepEqual(access(pathname, { hydrated: true, backendStatus: 'connected' }), { authChecking: false, authRedirecting: false })
  }
})

test('public pages are not accidentally placed behind the session gate', () => {
  for (const environment of ['development', 'production']) {
    for (const pathname of ['/', '/login', '/register', '/forgot-password', '/plans', '/credits', '/privacy', '/terms']) {
      assert.deepEqual(accessIn(environment)(pathname, { hydrated: false, backendStatus: 'checking' }), { authChecking: false, authRedirecting: false })
    }
  }
})

test('preview never fabricates an account or relaxes API, generation or administrator authorization', () => {
  for (const file of ['../lib/studio/store.tsx', '../lib/studio/generation-store.tsx', '../app/api/[...path]/route.ts', '../components/studio/admin-shell.tsx']) {
    assert.doesNotMatch(read(file), /isStudioPreview|preview-mode/)
  }
  assert.match(read('../components/studio/login-page.tsx'), /isStudioPreview\(\) &&/)
  assert.match(read('../components/studio/login-page.tsx'), /safeNextPath\(searchParams\.get\('next'\) \?\? '\/studio'\)/)
})
