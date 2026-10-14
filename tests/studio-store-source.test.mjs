import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/studio/store.tsx', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('store.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const compile = (text) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function evaluate(text, bindings = {}) {
  const module = { exports: {} }
  new Function('module', 'exports', ...Object.keys(bindings), compile(text))(module, module.exports, ...Object.values(bindings))
  return module.exports
}
const names = ['signedOutUser', 'emptyAccountState', 'readStudioPreferences', 'getInitialState', 'projectFromCanvasSummary', 'reducer']
const definitions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => `export ${node.getText(parsed).replace(/^export\s+/, '')}`).join('\n')
const helpers = evaluate(definitions, { fallbackAvatar: '/icon.svg' })
const provider = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'StudioProvider')
function callback(name, bindings) {
  const statement = provider.body.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(parsed) === name))
  assert.ok(statement, `Production callback ${name} must exist`)
  return evaluate(`export ${statement.getText(parsed)}`, { useCallback: (fn) => fn, ...helpers, ...bindings })[name]
}
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function snapshot(id, models = [{ id: 'synthetic-model' }]) { return { user: { id, username: id, pointsBalance: 17 }, models, settings: { site: { title: 'Synthetic' } } } }
const apiSource = readFileSync(new URL('../lib/studio/api.ts', import.meta.url), 'utf8')
const apiAst = ts.createSourceFile('api.ts', apiSource, ts.ScriptTarget.ES2022, true)
const mapper = apiAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'backendUserToStudioUser')
const { backendUserToStudioUser } = evaluate(mapper.getText(apiAst))

test('session maps all real wallet buckets but never adds timed points on top of the server total', () => {
  const user = backendUserToStudioUser({ id: 'account-a', pointsBalance: 33, permanentPointsBalance: 20, dailyPointsBalance: 3, timedPointsBalance: 10, timedPointsExpiresAt: '2026-10-15T16:00:00Z' }, '/icon.svg')
  assert.equal(user.credits, 33)
  assert.equal(user.timedPointsBalance, 10)
  assert.equal(user.timedPointsExpiresAt, '2026-10-15T16:00:00Z')
  const legacy = backendUserToStudioUser({ id: 'account-b', pointsBalance: 7 }, '/icon.svg')
  assert.equal(legacy.timedPointsBalance, undefined)
  assert.equal(legacy.timedPointsExpiresAt, undefined)
})

function sessionHarness() {
  let state = helpers.getInitialState()
  const sessions = [], projects = [], cleared = []
  const sessionTicket = { current: 0 }, sessionIdentityRef = { current: '' }
  const refreshSession = callback('refreshSession', {
    sessionTicket, sessionIdentityRef, fallbackAvatar: '/icon.svg', backendUserToStudioUser,
    brandSync: { getRevision: () => 1, merge: (settings) => settings },
    sessionIdentity: (user) => user?.id || '', clearScopedTaskCache: (id) => cleared.push(id),
    isUnauthorized: (error) => error?.status === 401,
    loadSessionSnapshot: () => { const next = deferred(); sessions.push(next); return next.promise },
    listCanvasProjects: () => { const next = deferred(); projects.push(next); return next.promise },
    dispatch: (action) => { state = helpers.reducer(state, action) },
  })
  return { refreshSession, sessions, projects, cleared, get state() { return state }, sessionTicket, sessionIdentityRef }
}

test('production starts with no synthetic account, models, business records, balances or notifications', () => {
  const state = helpers.getInitialState()
  assert.equal(state.user.id, '')
  assert.equal(state.user.credits, 0)
  assert.equal(state.credits, 0)
  assert.equal(state.notifications, 0)
  for (const key of ['projects', 'assets', 'models', 'liveModels', 'tasks', 'works', 'shots', 'agentPlans', 'orders', 'adminUsers', 'adminChannels', 'adminModels']) assert.deepEqual(state[key], [], key)
  assert.deepEqual(state.canvasBoards, {})
  assert.doesNotMatch(source, /from ['"]\.\/mock-(?:data|service)['"]|setInterval\(/)
})

test('legacy browser storage can only restore theme and sidebar preferences', () => {
  const poisoned = { theme: 'dark', sidebarCollapsed: true, skin: 'gradient', backendStatus: 'connected', user: { id: 'other-account', role: 'admin' }, credits: 999999, projects: [{ id: 'private' }], models: [{ id: 'invented' }], tasks: [{ status: 'completed' }], canvasBoards: { private: {} } }
  assert.deepEqual(helpers.readStudioPreferences(JSON.stringify(poisoned)), { theme: 'dark', sidebarCollapsed: true, skin: 'minimal' })
  for (const raw of [null, '{broken', 'null', '[]', '"string"']) assert.deepEqual(helpers.readStudioPreferences(raw), { theme: 'light', sidebarCollapsed: false, skin: 'minimal' })
})

test('account changes purge every old account collection, including admin rows and canvas drafts', () => {
  const state = helpers.getInitialState()
  state.user = { ...state.user, id: 'account-a' }
  state.theme = 'dark'
  state.credits = 500
  for (const key of ['projects', 'assets', 'models', 'liveModels', 'tasks', 'works', 'shots', 'agentPlans', 'orders', 'adminUsers', 'adminChannels', 'adminModels']) state[key] = [{ id: 'account-a-private' }]
  state.canvasBoards = { 'account-a-private': {} }
  const changed = helpers.reducer(state, { type: 'HYDRATE', payload: { user: { ...state.user, id: 'account-b', credits: 3 }, credits: 3, models: [], liveModels: [] } })
  assert.equal(changed.theme, 'dark')
  assert.equal(changed.credits, 3)
  for (const key of ['projects', 'assets', 'models', 'liveModels', 'tasks', 'works', 'shots', 'agentPlans', 'orders', 'adminUsers', 'adminChannels', 'adminModels']) assert.deepEqual(changed[key], [], key)
  assert.deepEqual(changed.canvasBoards, {})
})

test('legacy task and credit actions cannot invent work, completion, retries or deductions', () => {
  const state = helpers.getInitialState()
  state.tasks = [{ id: 'synthetic-api-task', status: 'processing', createdAt: 0 }]
  state.credits = 30
  for (const action of [{ type: 'TICK_TASKS' }, { type: 'RETRY_TASK', taskId: 'synthetic-api-task' }, { type: 'ADD_TASK', task: { id: 'fake' } }, { type: 'SPEND_CREDITS', amount: 20 }]) assert.equal(helpers.reducer(state, action), state)
  assert.equal(callback('addDemoTask', {})({ expectedCredits: 1 }), null)
})

test('a late old session cannot replace a newer account or trigger its project request', async () => {
  const harness = sessionHarness()
  const old = harness.refreshSession(), newer = harness.refreshSession()
  harness.sessions[1].resolve(snapshot('account-b'))
  assert.deepEqual(await newer, { status: 'connected' })
  harness.sessions[0].resolve(snapshot('account-a'))
  assert.deepEqual(await old, { status: 'superseded' })
  assert.equal(harness.state.user.id, 'account-b')
  assert.equal(harness.projects.length, 1)
  assert.equal(harness.state.credits, 17)
})

test('a late project response from the previous account cannot populate the new account', async () => {
  const harness = sessionHarness()
  const first = harness.refreshSession(); harness.sessions[0].resolve(snapshot('account-a')); await first
  const second = harness.refreshSession(); harness.sessions[1].resolve(snapshot('account-b')); await second
  harness.projects[0].resolve({ projects: [{ id: 'private-a', title: 'A', nodeCount: 1, updatedAt: '2026-01-01T00:00:00Z' }] })
  await Promise.resolve()
  assert.deepEqual(harness.state.projects, [])
  harness.projects[1].resolve({ projects: [{ id: 'project-b', title: 'B', nodeCount: 0, updatedAt: '2026-01-01T00:00:00Z' }] })
  await Promise.resolve()
  assert.deepEqual(harness.state.projects.map((project) => project.id), ['project-b'])
  assert.deepEqual(harness.cleared, ['account-a'])
})

test('an empty API model catalog replaces previous models and logout clears account state', async () => {
  const harness = sessionHarness()
  const first = harness.refreshSession(); harness.sessions[0].resolve(snapshot('account-a')); await first
  assert.equal(harness.state.models.length, 1)
  const second = harness.refreshSession(); harness.sessions[1].resolve(snapshot('account-a', [])); await second
  assert.deepEqual(harness.state.models, [])
  assert.deepEqual(harness.state.liveModels, [])
  const logout = harness.refreshSession(); harness.sessions[2].resolve({ user: null, models: [], settings: {} }); assert.deepEqual(await logout, { status: 'unauthenticated' })
  assert.equal(harness.state.backendStatus, 'unauthenticated')
  assert.equal(harness.state.user.id, '')
  assert.equal(harness.state.credits, 0)
  assert.deepEqual(harness.cleared, ['account-a'])
})

test('expired sessions clear identity while network failure preserves only previously received API data', async () => {
  const harness = sessionHarness()
  const first = harness.refreshSession(); harness.sessions[0].resolve(snapshot('account-a')); await first
  const offline = harness.refreshSession(); harness.sessions[1].reject(new Error('Synthetic network failure')); assert.deepEqual(await offline, { status: 'offline', error: 'Synthetic network failure' })
  assert.equal(harness.state.backendStatus, 'offline')
  assert.equal(harness.state.user.id, 'account-a')
  const expired = harness.refreshSession(); harness.sessions[2].reject(Object.assign(new Error('Synthetic expiry'), { status: 401 })); assert.deepEqual(await expired, { status: 'unauthenticated', error: 'Synthetic expiry' })
  assert.equal(harness.state.backendStatus, 'unauthenticated')
  assert.equal(harness.state.user.id, '')
  assert.equal(harness.state.models.length, 0)
})

test('offline project mutations reject instead of pretending to persist', async () => {
  const actions = []
  const bindings = { state: { backendStatus: 'offline' }, dispatch: (action) => actions.push(action) }
  await assert.rejects(callback('createProject', bindings)('Synthetic project'), /连接服务/)
  await assert.rejects(callback('deleteProject', bindings)('synthetic-project'), /连接服务/)
  assert.deepEqual(actions, [])
})
