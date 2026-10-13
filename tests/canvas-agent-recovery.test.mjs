import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, mocks = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const types = sourceModule('../components/free-canvas/types.ts')
const codec = sourceModule('../components/free-canvas/board-codec.ts', { './types': types, './node-factory': { GENERATION_TITLES: {} } })
const snapshot = () => ({ id: 'synthetic-agent', type: 'agent', position: { x: 20, y: 40 }, data: { kind: 'agent', title: 'Synthetic agent', prompt: 'Original prompt', skills: [], runStatus: 'planning', runId: null, clientRequestId: 'synthetic-request', submission: { prompt: 'Original prompt', skillIds: ['synthetic-skill'], assetIds: ['synthetic-asset'] }, steps: [], context: [], pointsCost: null } })
const reload = node => codec.readBoard(JSON.parse(JSON.stringify(codec.writeBoard([node], [])))).nodes[0]

test('reload of a pre-submit Agent snapshot opens recovery without inventing a run or changing its identity', () => {
  const node = snapshot()
  const restored = reload(node)
  assert.equal(restored.data.runStatus, 'unconfirmed')
  assert.equal(restored.data.runId, null)
  assert.equal(restored.data.clientRequestId, node.data.clientRequestId)
  assert.deepEqual(restored.data.submission, node.data.submission)
  assert.match(restored.data.failure, /确认上次提交/)
  assert.equal(reload(restored).data.runStatus, 'unconfirmed')
})

test('known server runs keep their status and incomplete old records do not acquire invented recovery input', () => {
  for (const status of ['planning', 'running', 'awaiting_approval', 'paused', 'completed', 'failed', 'cancelled']) {
    const node = snapshot(); node.data.runId = 'synthetic-server-run'; node.data.runStatus = status
    const restored = reload(node)
    assert.equal(restored.data.runStatus, status)
    assert.equal(restored.data.runId, 'synthetic-server-run')
  }
  const legacy = snapshot(); delete legacy.data.submission
  assert.equal(reload(legacy).data.submission, undefined)
})

test('the real Agent action recovers the reloaded snapshot using the original immutable request', async () => {
  const original = snapshot(), node = reload(original), calls = []
  // Even if the displayed prompt/selection differs, recovery uses the saved input.
  node.data.prompt = 'A subsequently displayed draft'; node.data.skills = [{ id: 'different-skill', title: 'Different', prompt: 'Different' }]
  const state = { projectId: 'synthetic-canvas', hydrated: true, revision: 1, savedRevision: 1, nodes: [node], patchNodes(patches) { for (const patch of patches) Object.assign(node.data, patch.data) }, setNotice() {} }
  const useCanvasStore = selector => selector(state); useCanvasStore.getState = () => state
  const run = { id: 'synthetic-server-run', status: 'awaiting_approval', tasks: [], pointsCost: 1 }
  const module = sourceModule('../components/free-canvas/use-agent-actions.ts', {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {} },
    '@/lib/studio/generation-api': { newClientRequestId: () => { throw new Error('Recovery must never allocate a new identity') } },
    '@/lib/studio/account-api': {},
    '@/lib/studio/generation-store': { useGeneration: () => ({ runAgent: async input => { calls.push(input); return run }, getAgent: async () => run }) },
    './canvas-persistence': { flushCanvasSave: async () => {}, syncRemoteBoard: async () => {} },
    './agent-delivery': {},
    './canvas-store': { useCanvasStore },
    './use-generation-actions': { errorMessageOf: error => error.message },
  })
  await module.useAgentActions().startAgent(node.id)
  assert.deepEqual(calls, [{ ...original.data.submission, clientRequestId: original.data.clientRequestId, projectId: state.projectId, surface: 'canvas' }])
  assert.equal(node.data.runId, run.id)
  assert.equal(node.data.runStatus, 'awaiting_approval')
  assert.equal(node.data.clientRequestId, null)
})
