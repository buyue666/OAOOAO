import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const types = sourceModule('../components/free-canvas/types.ts')
const factory = sourceModule('../components/free-canvas/node-factory.ts')
const codec = sourceModule('../components/free-canvas/board-codec.ts', { './types': types, './node-factory': factory })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const settle = () => new Promise(resolve => setImmediate(resolve))
const plain = value => JSON.parse(JSON.stringify(value))
const defaults = { imageSize: '1:1', imageQuality: 'auto', imageCount: 4, videoQuality: '720', videoSeconds: 8, audioVoice: 'alloy', audioFormat: 'mp3' }

function harness({ submit, loadSkills, save, restored, query, cancel, knownTasks = [], cancelInStore } = {}) {
  const actual = sourceModule('../components/free-canvas/canvas-store.ts', { './node-factory': factory, './types': types }).useCanvasStore
  const useCanvasStore = selector => selector(actual.getState()); useCanvasStore.getState = actual.getState
  const node = restored || factory.createGenerationNode('image', { x: 0, y: 0 }, defaults, 'shared-node')
  if (!restored) node.data = { ...node.data, model: 'image-model', prompt: 'Original synthetic prompt' }
  const hydrate = (id, value = node) => actual.getState().hydrate({ projectId: id, title: id, updatedAt: '2026-01-01T00:00:00.000Z', projectMeta: {}, nodes: [value], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
  hydrate('canvas-a')
  const submissions = [], snapshots = [], estimates = [], cleanups = []
  let identities = 0
  const create = async input => { submissions.push(plain(input)); return submit ? submit(input, submissions.length) : { id: 'real-task', status: 'pending' } }
  const hook = sourceModule('../components/free-canvas/use-generation-actions.ts', {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useRef: value => ({ current: value }), useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) } },
    '@/lib/studio/account-api': { listLibraryAssets: loadSkills },
    '@/lib/studio/canvas-skills': sourceModule('../lib/studio/canvas-skills.ts'),
    '@/lib/studio/generation-api': { newClientRequestId: () => `request-${++identities}`, getGenerationTask: query, cancelGenerationTask: cancel, normalizeTaskResult: value => value },
    '@/lib/studio/generation-store': { useGeneration: () => ({ tasks: knownTasks, cancelTask: cancelInStore, createImage: create, createVideo: create, createAudio: create, createText: create }) },
    '@/lib/studio/reference-assets': { isSubmittableReferenceUrl: () => true }, '@/lib/studio/studio-models': {},
    '@/lib/studio/store': { useStudio: () => ({ state: { models: [], user: { id: 'synthetic-owner' } }, estimateCredits: (_, input) => { estimates.push(input); return input.count } }) },
    './canvas-persistence': { flushCanvasSave: async () => {
      const state = actual.getState(); snapshots.push(plain(codec.writeBoard(state.nodes, state.edges)))
      if (save) return save(actual)
      state.markSaved('2026-01-01T00:00:01.000Z', state.revision)
    } }, './canvas-store': { useCanvasStore },
  })
  return { actual, hydrate, actions: hook.useGenerationActions(), collectTaskPatches: hook.collectTaskPatches, submissions, snapshots, estimates, unmount: () => cleanups.forEach(fn => fn()), get node() { return actual.getState().nodes[0] } }
}

test('unknown submissions retry one charged identity with immutable original parameters', async () => {
  const charged = new Set()
  const h = harness({ submit: async input => { charged.add(input.clientRequestId); throw { message: 'Synthetic response lost', indeterminate: true, outcome: 'unavailable' } } })
  await h.actions.submitNode('shared-node')
  assert.equal(h.node.data.task.unconfirmed, true)
  assert.match(h.node.data.task.error, /原参数/)
  h.actual.getState().updateNodeData('shared-node', { prompt: 'Changed draft', quality: 'high', skills: [{ id: 'missing', title: 'Missing', prompt: 'Never fetched on recovery' }] })
  await h.actions.submitNode('shared-node')
  assert.deepEqual(h.submissions[1], h.submissions[0])
  assert.equal(charged.size, 1)
  assert.equal(h.snapshots[0].nodes[0].data.task.submission.input.clientRequestId, h.submissions[0].clientRequestId)
})

test('a reload before the create response safely recovers the exact persisted submission', async () => {
  const pending = deferred(), h = harness({ submit: () => pending.promise })
  const request = h.actions.submitNode('shared-node'); await settle()
  const restored = codec.readBoard(h.snapshots[0]).nodes[0]
  assert.equal(restored.data.task.unconfirmed, true)
  assert.equal(restored.data.task.phase, 'error')
  const retry = harness({ restored }); await retry.actions.submitNode('shared-node')
  assert.deepEqual(retry.submissions[0], h.submissions[0])
  pending.resolve({ id: 'real-task', status: 'pending' }); await request
})

test('save conflict prevents any charge and confirmed rejection permits a genuinely new request', async () => {
  const blocked = harness({ save: async actual => actual.getState().setSaveStatus('conflict', 'Synthetic conflict') })
  await blocked.actions.submitNode('shared-node')
  assert.equal(blocked.submissions.length, 0); assert.match(blocked.node.data.task.error, /尚未保存/)
  const rejected = harness({ submit: async () => { throw { message: 'Not charged', indeterminate: false, outcome: 'rejected' } } })
  await rejected.actions.submitNode('shared-node'); await rejected.actions.submitNode('shared-node')
  assert.notEqual(rejected.submissions[0].clientRequestId, rejected.submissions[1].clientRequestId)
  assert.equal(rejected.node.data.task.unconfirmed, false)
})

test('late create responses cannot overwrite a different or reopened canvas or an unmounted editor', async () => {
  for (const target of ['canvas-b', 'canvas-a', 'unmount']) {
    const pending = deferred(), h = harness({ submit: () => pending.promise })
    const request = h.actions.submitNode('shared-node'); await settle()
    if (target === 'unmount') h.unmount()
    else h.hydrate(target, factory.createGenerationNode('image', { x: 0, y: 0 }, defaults, 'shared-node'))
    pending.resolve({ id: 'task-from-previous-editor', status: 'pending' }); await request
    assert.notEqual(h.node.data.task?.id, 'task-from-previous-editor')
  }
})

test('late check and cancellation responses cannot overwrite another canvas with the same node ID', async () => {
  for (const operation of ['checkNode', 'cancelNode']) {
    const pending = deferred(), h = harness({ query: () => pending.promise, cancel: () => pending.promise })
    h.actual.getState().patchNodes([{ id: 'shared-node', data: { task: { id: 'old-task', phase: 'running', startedAt: 1 } } }])
    const request = h.actions[operation]('shared-node')
    h.hydrate('canvas-b', factory.createGenerationNode('image', { x: 0, y: 0 }, defaults, 'shared-node'))
    pending.resolve({ data: { task: { status: 'success', result: { media: [{ url: 'synthetic-result', kind: 'image' }] } } } }); await request
    assert.equal(h.node.data.task, null); assert.deepEqual(h.node.data.results, [])
  }
})

test('single-image backend contract constrains real submissions, estimates and saved node recovery', async () => {
  const h = harness(); assert.equal(h.node.data.count, 4)
  assert.equal(h.actions.estimateNode(h.node.data), 1)
  await h.actions.submitNode('shared-node')
  assert.equal(h.submissions[0].count, 1)
  assert.equal(h.estimates[0].count, 1)
  assert.equal(codec.readBoard(h.snapshots[0]).nodes[0].data.count, 1)
})

test('reload during skill preparation unlocks recovery instead of stranding a queued task without an ID', () => {
  const node = factory.createGenerationNode('image', { x: 0, y: 0 }, defaults)
  node.data.task = { id: '', phase: 'queued', startedAt: 1, clientRequestId: 'preparation-only' }
  const restored = codec.readBoard(codec.writeBoard([node], [])).nodes[0]
  assert.equal(restored.data.task.phase, 'error')
  assert.equal(restored.data.task.unconfirmed, false)
})

test('pending cancellations remain locked across reload and checks until the server confirms termination', async () => {
  for (const known of [false, true]) {
    let status = 'running', cancelCalls = 0
    const remote = () => ({ id: 'server-task', status, cancelRequested: true, result: { media: [] } })
    const h = harness({ knownTasks: known ? [{ ...remote(), media: [] }] : [],
      cancel: async () => { cancelCalls++; return { data: { task: remote() } } },
      cancelInStore: async () => { cancelCalls++; return remote() },
      query: async () => ({ data: { task: remote() } }),
    })
    h.actual.getState().patchNodes([{ id: 'shared-node', data: { task: { id: 'server-task', phase: 'running', startedAt: 1 } } }])
    await h.actions.cancelNode('shared-node')
    assert.equal(h.node.data.task.phase, 'running'); assert.equal(h.node.data.task.cancelRequested, true)
    assert.match(h.actual.getState().notice, /尚未确认停止/)
    await h.actions.submitNode('shared-node'); await h.actions.cancelNode('shared-node')
    assert.equal(h.submissions.length, 0); assert.equal(cancelCalls, 1)
    const reloaded = codec.readBoard(codec.writeBoard([h.node], [])).nodes[0]
    assert.equal(reloaded.data.task.phase, 'running'); assert.equal(reloaded.data.task.cancelRequested, true)
    await h.actions.checkNode('shared-node'); assert.equal(h.node.data.task.phase, 'running')
    status = 'cancelled'; await h.actions.checkNode('shared-node')
    assert.equal(h.node.data.task.phase, 'cancelled'); assert.equal(h.node.data.task.cancelRequested, false)
    await h.actions.submitNode('shared-node'); assert.equal(h.submissions.length, 1)
  }
})

test('a lost cancellation response never claims cancellation or permits another generation', async () => {
  const h = harness({ cancel: async () => { throw new Error('Synthetic cancellation result unknown') } })
  h.actual.getState().patchNodes([{ id: 'shared-node', data: { task: { id: 'server-task', phase: 'running', startedAt: 1 } } }])
  await h.actions.cancelNode('shared-node'); await h.actions.submitNode('shared-node')
  assert.equal(h.node.data.task.phase, 'running'); assert.equal(h.submissions.length, 0)
  assert.match(h.actual.getState().notice, /unknown/)
})

test('normal task polling carries cancellation-request state and clears it only on a terminal response', () => {
  const h = harness()
  h.actual.getState().patchNodes([{ id: 'shared-node', data: { task: { id: 'server-task', phase: 'running', startedAt: 1 } } }])
  h.actual.getState().patchNodes(h.collectTaskPatches([h.node], [{ id: 'server-task', status: 'running', cancelRequested: true, media: [] }]))
  assert.equal(h.node.data.task.phase, 'running'); assert.equal(h.node.data.task.cancelRequested, true)
  h.actual.getState().patchNodes(h.collectTaskPatches([h.node], [{ id: 'server-task', status: 'cancelled', cancelRequested: true, media: [] }]))
  assert.equal(h.node.data.task.phase, 'cancelled'); assert.equal(h.node.data.task.cancelRequested, false)
})

test('actual generation-store cancellation returns the authoritative status and gives an honest notice', async () => {
  const source = readFileSync(new URL('../lib/studio/generation-store.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('generation-store.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const provider = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GenerationProvider')
  const callback = provider.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === 'cancelTask'))
  const code = ts.transpileModule(callback.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  let status = 'running', notice = '', tasks = [{ id: 'server-task', kind: 'image', status: 'running' }]
  const dependencies = { useCallback: fn => fn, isUnconfirmedId: () => false, sessionEpochRef: { current: 1 }, userIdRef: { current: 'owner' },
    setLastError() {}, cancelTaskRequest: async () => ({ data: { task: { id: 'server-task', status, cancelRequested: true } }, points: {} }),
    applyPoints() {}, queryFailuresRef: { current: new Map() }, nextPollAtRef: { current: new Map() }, indeterminateRef: { current: new Set() },
    toView: (kind, task, local) => ({ ...local, ...task, kind }), setTasks: update => { tasks = update(tasks) }, setLastNotice: value => { notice = value }, toError: value => value,
  }
  const cancelTask = new Function(...Object.keys(dependencies), `${code}\nreturn cancelTask;`)(...Object.values(dependencies))
  const pending = await cancelTask(tasks[0]); assert.equal(pending.status, 'running'); assert.equal(tasks[0].status, 'running')
  assert.match(notice, /等待服务端确认/); assert.doesNotMatch(notice, /已确认取消/)
  status = 'cancelled'; const confirmed = await cancelTask(tasks[0])
  assert.equal(confirmed.status, 'cancelled'); assert.equal(tasks[0].status, 'cancelled'); assert.match(notice, /已确认取消/)
})
