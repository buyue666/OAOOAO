import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../components/free-canvas/canvas-persistence.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const tick = () => new Promise(resolve => setImmediate(resolve))
const initialVersion = '2026-10-14T00:00:00.000Z'
const nextVersion = '2026-10-14T00:00:01.000Z'
const finalVersion = '2026-10-14T00:00:02.000Z'
const ack = updatedAt => ({ data: { ack: { updatedAt } } })

function fixture() {
  const listeners = new Set(), timers = new Map(), calls = []
  let timerId = 0
  let state
  const update = patch => { const previous = state; state = { ...state, ...patch }; for (const callback of listeners) callback(state, previous) }
  const fresh = (id, version = initialVersion) => ({ projectId: id, projectMeta: {}, title: id, updatedAt: version, hydrated: true, revision: 1, savedRevision: 0, saveStatus: 'dirty', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    setSaveStatus: (saveStatus, saveError = null) => update({ saveStatus, saveError }),
    markSaved: (updatedAt, savedRevision) => update({ updatedAt, savedRevision, saveStatus: state.revision === savedRevision ? 'saved' : 'dirty' }),
  })
  state = fresh('a')
  class ApiError extends Error {}
  const module = { exports: {} }
  const mocks = {
    '@/lib/studio/api': { StudioApiError: ApiError, request: (url, input) => new Promise((resolve, reject) => { calls.push({ url, ...input, body: JSON.parse(input.body), resolve, reject }) }) },
    './board-codec': { writeBoard: (nodes, connections) => ({ nodes, connections }), writeViewport: value => value },
    './canvas-store': { useCanvasStore: { getState: () => state, subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback) } } },
  }
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Error, setTimeout: callback => { timers.set(++timerId, callback); return timerId }, clearTimeout: id => timers.delete(id) })(name => mocks[name], module, module.exports)
  return { api: module.exports, calls, timers, state: () => state, edit: () => update({ revision: state.revision + 1, saveStatus: 'dirty' }), hydrate: (id, version) => { state = fresh(id, version) }, conflict: () => Object.assign(new ApiError('Synthetic conflict'), { status: 409 }) }
}

test('hidden save clears debounce and normal flush waits for its CAS acknowledgement', async () => {
  const f = fixture(); f.api.startCanvasAutosave(); f.edit()
  assert.equal(f.timers.size, 1)
  f.api.flushCanvasSaveOnHide()
  assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].keepalive, true)
  f.edit()
  const normal = f.api.flushCanvasSave()
  assert.equal(f.calls.length, 1)
  f.calls[0].resolve(ack(nextVersion)); await tick()
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.expectedUpdatedAt, nextVersion)
  f.calls[1].resolve(ack(finalVersion)); await normal; await tick()
  assert.equal(f.state().updatedAt, finalVersion); assert.equal(f.state().savedRevision, f.state().revision); assert.equal(f.state().saveStatus, 'saved')
})

test('multiple hide events share one request and acknowledge the captured revision', async () => {
  const f = fixture(); f.api.flushCanvasSaveOnHide(); f.api.flushCanvasSaveOnHide(); f.api.flushCanvasSaveOnHide()
  assert.equal(f.calls.length, 1)
  f.calls[0].resolve(ack(nextVersion)); await tick()
  assert.equal(f.calls.length, 1); assert.equal(f.state().saveStatus, 'saved')
  const normal = f.api.flushCanvasSave(); await normal
  assert.equal(f.calls.length, 1)
})

test('hiding during a regular save serializes later revisions with keepalive and the new version', async () => {
  const f = fixture(); const normal = f.api.flushCanvasSave()
  assert.equal(f.calls[0].keepalive, undefined)
  f.edit(); f.api.flushCanvasSaveOnHide()
  f.calls[0].resolve(ack(nextVersion)); await tick()
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].keepalive, true); assert.equal(f.calls[1].body.expectedUpdatedAt, nextVersion)
  f.calls[1].resolve(ack(finalVersion)); await normal; await tick()
  f.edit(); const later = f.api.flushCanvasSave()
  assert.equal(f.calls[2].keepalive, undefined, 'normal retries must not permanently inherit unload limits')
  f.calls[2].resolve(ack('2026-10-14T00:00:03.000Z')); await later
})

test('hidden conflict stays unsaved without retrying or pretending success', async () => {
  const f = fixture(); f.api.flushCanvasSaveOnHide(); f.calls[0].reject(f.conflict()); await tick()
  assert.equal(f.state().saveStatus, 'conflict'); assert.equal(f.state().savedRevision, 0)
  await f.api.flushCanvasSave(); assert.equal(f.calls.length, 1)
})

test('missing hidden acknowledgement and transport failure remain explicit and can retry normally', async () => {
  for (const failure of ['missing', 'offline']) {
    const f = fixture(); f.api.flushCanvasSaveOnHide()
    if (failure === 'missing') f.calls[0].resolve({ data: {} }); else f.calls[0].reject(new Error('Synthetic offline'))
    await tick(); assert.equal(f.state().saveStatus, 'error'); assert.equal(f.state().savedRevision, 0)
    const retry = f.api.flushCanvasSave(); assert.equal(f.calls[1].keepalive, undefined)
    assert.equal(f.calls[1].body.expectedUpdatedAt, initialVersion)
    f.calls[1].resolve(ack(nextVersion)); await retry; assert.equal(f.state().saveStatus, 'saved')
  }
})

test('old-project acknowledgements and conflicts never mutate the current editor', async () => {
  for (const conflict of [false, true]) {
    const f = fixture(); f.api.flushCanvasSaveOnHide(); f.hydrate('b', finalVersion)
    const current = f.api.flushCanvasSave()
    if (conflict) f.calls[0].reject(f.conflict()); else f.calls[0].resolve(ack(nextVersion))
    await tick()
    assert.equal(f.state().projectId, 'b'); assert.equal(f.state().updatedAt, finalVersion); assert.equal(f.state().savedRevision, 0)
    assert.equal(f.calls.length, 2); assert.match(f.calls[1].url, /\/b$/); assert.equal(f.calls[1].body.expectedUpdatedAt, finalVersion)
    f.calls[1].resolve(ack('2026-10-14T00:00:03.000Z')); await current; await tick()
    assert.equal(f.state().saveStatus, 'saved')
  }
})

test('returning to the same project does not accept a response from its previous editor session', async () => {
  const f = fixture(); f.api.flushCanvasSaveOnHide(); f.hydrate('b'); f.hydrate('a', finalVersion)
  f.calls[0].resolve(ack(nextVersion)); await tick()
  assert.equal(f.state().updatedAt, finalVersion); assert.equal(f.state().savedRevision, 0)
  // The pending flush may drain the new session, but must use its fresh version.
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.expectedUpdatedAt, finalVersion)
  f.calls[1].resolve(ack('2026-10-14T00:00:03.000Z')); await tick()
  assert.equal(f.state().saveStatus, 'saved')
})
