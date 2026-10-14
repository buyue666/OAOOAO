import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const compile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
function sourceModule(path, mocks = {}, globals = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), compile(source(path)))(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports, ...Object.values(globals))
  return module.exports
}
const types = sourceModule('../components/free-canvas/types.ts')
const factory = sourceModule('../components/free-canvas/node-factory.ts')
const layout = sourceModule('../components/free-canvas/canvas-layout.ts', { './node-factory': factory })
const selection = sourceModule('../components/free-canvas/canvas-selection.ts')
const references = sourceModule('../lib/studio/reference-assets.ts')
const reference = sourceModule('../components/free-canvas/asset-reference.ts', { '@/lib/studio/reference-assets': references })
const delivery = sourceModule('../components/free-canvas/agent-delivery.ts', { './asset-reference': reference, './node-factory': factory })
const codec = sourceModule('../components/free-canvas/board-codec.ts', { './types': types, './node-factory': factory })
const asset = (id, kind = 'image') => ({ id, kind, title: `Synthetic ${id}`, tags: [], data: kind === 'text' ? { content: 'Full synthetic text\nSecond paragraph' } : { serverUrl: `/api/reference-assets/${id}` }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)) }

function harness({ getAgent, library, save, initialStatus = 'running', runId = 'synthetic-run' } = {}) {
  const actual = sourceModule('../components/free-canvas/canvas-store.ts', { './node-factory': factory, './types': types, './canvas-layout': layout, './canvas-selection': selection }).useCanvasStore
  const useCanvasStore = selector => selector(actual.getState()); useCanvasStore.getState = actual.getState
  const agent = factory.createAgentNode({ x: 0, y: 0 }, 'synthetic-agent')
  agent.data = { ...agent.data, prompt: 'Synthetic plan', runId, runStatus: initialStatus }
  const draft = factory.createGenerationNode('text', { x: 20, y: 300 }, { imageSize: '1:1', imageQuality: 'auto', imageCount: 1, videoQuality: '720', videoSeconds: 5, audioVoice: 'alloy', audioFormat: 'mp3' }, 'user-draft')
  draft.data.text = 'Previously saved paragraph'
  actual.getState().hydrate({ projectId: 'synthetic-board', title: 'Synthetic board', updatedAt: '2026-01-01T00:00:00.000Z', projectMeta: { opaque: 'preserved' }, nodes: [agent, draft], edges: [{ id: 'existing-link', source: agent.id, target: draft.id }], viewport: { x: 0, y: 0, zoom: 1 } })
  actual.getState().updateNodeData(draft.id, { text: 'Unsaved private draft' })
  const saves = [], queries = [], pollCalls = [], timers = []
  class ApiError extends Error {}
  const persistence = sourceModule('../components/free-canvas/canvas-persistence.ts', {
    '@/lib/studio/api': { StudioApiError: ApiError, request: async (url, options) => {
      const body = JSON.parse(options.body); saves.push(body)
      if (save) return save(body, saves.length, ApiError)
      return { data: { project: { updatedAt: `2026-01-01T00:00:${String(saves.length).padStart(2, '0')}.000Z` } } }
    } }, './board-codec': codec, './canvas-store': { useCanvasStore },
  })
  const completed = { id: 'synthetic-run', status: 'completed', tasks: [], pointsCost: 10, assetIds: ['image-result', 'text-result', 'audio-result'] }
  const generation = { getAgent: async id => { pollCalls.push(id); return getAgent ? getAgent(id, pollCalls.length) : completed }, runAgent: async () => ({ ...completed, status: 'planning', assetIds: [] }) }
  let effects = [], effectSlots = [], pendingEffects = []
  const hook = sourceModule('../components/free-canvas/use-agent-actions.ts', {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useEffect: (fn, deps) => effects.push({ fn, deps }) },
    '@/lib/studio/generation-api': { newClientRequestId: () => 'synthetic-request' },
    '@/lib/studio/account-api': { listLibraryAssets: async params => { queries.push(params); return library ? library(params) : { assets: [asset('image-result'), asset('text-result', 'text'), asset('audio-result', 'audio')], total: 3 } } },
    '@/lib/studio/generation-store': { useGeneration: () => generation },
    './canvas-persistence': persistence, './agent-delivery': delivery, './canvas-store': { useCanvasStore }, './use-generation-actions': { errorMessageOf: error => error.message },
  }, { window: { setTimeout: fn => { timers.push(fn); return timers.length } } })
  function render() {
    effects = []; const actions = hook.useAgentActions(); pendingEffects = []
    effects.forEach((effect, index) => { if (!effectSlots[index] || effect.deps.some((item, i) => item !== effectSlots[index].deps[i])) { effectSlots[index]?.cleanup?.(); pendingEffects.push(() => { effectSlots[index] = { deps: effect.deps, cleanup: effect.fn() } }) } })
    pendingEffects.forEach(fn => fn()); return actions
  }
  function unmount() { effectSlots.forEach(effect => effect.cleanup?.()); effectSlots = [] }
  return { actual, saves, queries, pollCalls, timers, render, unmount, completed, get node() { return actual.getState().nodes.find(item => item.id === agent.id) } }
}

test('Agent delivery resolves later asset pages and builds real media/text nodes with stable IDs', async () => {
  const pages = []
  const found = await delivery.loadAgentResultAssets(['text', 'image', 'text'], async page => { pages.push(page); return { assets: page === 1 ? [asset('image')] : [asset('text', 'text')], total: 2 } }, () => true)
  assert.deepEqual(pages, [1, 2])
  const nodes = delivery.buildAgentResultNodes('run', found, [])
  assert.equal(nodes[0].data.text, 'Full synthetic text\nSecond paragraph')
  assert.equal(nodes[0].data.task.phase, 'success')
  assert.equal(nodes[0].data.task.id, '')
  assert.deepEqual(nodes[0].data.resultSource, { runId: 'run', assetId: 'text' })
  const restoredText = codec.readBoard(codec.writeBoard(nodes, [])).nodes[0]
  assert.equal(restoredText.data.task.phase, 'success')
  assert.deepEqual(restoredText.data.resultSource, nodes[0].data.resultSource)
  const withMetadata = delivery.buildAgentResultNodes('run', [{ ...asset('text-2', 'text'), metadata: { taskId: 'actual-server-job' } }], [])[0]
  assert.equal(withMetadata.data.task.id, 'actual-server-job')
  assert.equal(nodes[1].data.media.libraryAssetId, 'image')
  assert.deepEqual(delivery.buildAgentResultNodes('run', found, codec.readBoard(codec.writeBoard(nodes, [])).nodes), [])
  await assert.rejects(delivery.loadAgentResultAssets(['missing'], async () => ({ assets: [], total: 0 }), () => true), /不可读取/)
})

test('completion appends and CAS-saves real results without replacing unsaved user edits or links', async () => {
  const h = harness(); const actions = h.render(); await settle()
  const state = h.actual.getState()
  assert.equal(state.nodes.length, 5)
  assert.equal(state.nodes.find(node => node.id === 'user-draft').data.text, 'Unsaved private draft')
  assert.equal(state.edges[0].id, 'existing-link')
  assert.equal(h.saves[0].expectedUpdatedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(h.saves[0].project.opaque, 'preserved')
  assert.equal(state.revision, state.savedRevision)
  assert.equal(h.node.data.deliveredRunId, 'synthetic-run')
  const reloaded = codec.readBoard(JSON.parse(JSON.stringify(h.saves[0].project))).nodes
  assert.equal(reloaded.find(node => node.type === 'agent').data.deliveredRunId, 'synthetic-run')
  actions.refreshAgent('synthetic-agent'); await settle()
  assert.equal(h.actual.getState().nodes.length, 5)
  assert.equal(h.queries.length, 1)
  h.unmount()
})

test('failed CAS keeps every local result and draft; retry does not bypass or overwrite a conflicting version', async () => {
  const h = harness({ save: async (_, __, ApiError) => { throw Object.assign(new ApiError('Synthetic CAS conflict'), { status: 409 }) } })
  const actions = h.render(); await settle()
  assert.equal(h.actual.getState().saveStatus, 'conflict')
  assert.equal(h.actual.getState().nodes.length, 5)
  assert.match(h.node.data.deliveryError, /本地修改已保留/)
  const exported = codec.writeBoard(h.actual.getState().nodes, h.actual.getState().edges)
  assert.equal(exported.nodes.find(node => node.id === 'user-draft').data.text, 'Unsaved private draft')
  actions.refreshAgent('synthetic-agent'); await settle()
  assert.equal(h.saves.length, 1)
  assert.equal(h.actual.getState().nodes.length, 5)
  assert.notEqual(h.actual.getState().revision, h.actual.getState().savedRevision)
  h.unmount()
})

test('network save failure retains delivery and a later retry confirms it without duplicate nodes', async () => {
  const h = harness({ save: async (_, count) => { if (count === 1) throw new Error('Synthetic offline'); return { data: { project: { updatedAt: '2026-01-01T00:00:02.000Z' } } } } })
  const actions = h.render(); await settle()
  assert.equal(h.actual.getState().nodes.length, 5)
  assert.match(h.node.data.deliveryError, /Synthetic offline/)
  await actions.startAgent('synthetic-agent')
  assert.equal(h.node.data.runId, 'synthetic-run')
  actions.refreshAgent('synthetic-agent'); await settle()
  assert.equal(h.actual.getState().nodes.length, 5)
  assert.equal(h.node.data.deliveryError, null)
  assert.equal(h.actual.getState().revision, h.actual.getState().savedRevision)
  h.unmount()
})

test('asset read failures expose a retry and a switched canvas never receives a late delivery', async () => {
  let available = false
  const failed = harness({ library: async () => { if (!available) throw new Error('Synthetic asset outage'); return { assets: [asset('image-result'), asset('text-result', 'text'), asset('audio-result', 'audio')], total: 3 } } })
  const actions = failed.render(); await settle()
  assert.equal(failed.actual.getState().nodes.length, 2)
  assert.match(failed.node.data.deliveryError, /Synthetic asset outage/)
  available = true; actions.refreshAgent('synthetic-agent'); await settle()
  assert.equal(failed.actual.getState().nodes.length, 5); failed.unmount()
  const pending = deferred(), changed = harness({ library: () => pending.promise })
  changed.render(); await settle()
  changed.actual.getState().hydrate({ projectId: 'other-board', title: 'Other', updatedAt: '2026-01-01T00:00:00.000Z', projectMeta: {}, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
  changed.render(); pending.resolve({ assets: [asset('image-result'), asset('text-result', 'text'), asset('audio-result', 'audio')], total: 3 }); await settle()
  assert.equal(changed.actual.getState().nodes.length, 0)
  assert.equal(changed.saves.length, 0); changed.unmount()
})

test('starting a run survives the active-run effect update and continues polling', async () => {
  const first = deferred()
  const h = harness({ initialStatus: null, runId: null, getAgent: (_, count) => count === 1 ? first.promise : { id: 'synthetic-run', status: 'awaiting_approval', tasks: [], pointsCost: 1, assetIds: [] } })
  const actions = h.render(); await actions.startAgent('synthetic-agent'); h.render()
  first.resolve({ id: 'synthetic-run', status: 'planning', tasks: [], pointsCost: 1, assetIds: [] }); await settle()
  assert.equal(h.timers.length, 1)
  h.timers.shift()(); await settle()
  assert.equal(h.pollCalls.length, 2)
  assert.equal(h.node.data.runStatus, 'awaiting_approval'); h.unmount()
})

test('Strict Mode cleanup immediately relinquishes the observer key and old completion cannot remove its successor', async () => {
  const first = deferred(), second = deferred()
  const h = harness({ getAgent: (_, count) => count === 1 ? first.promise : second.promise })
  h.render(); h.unmount(); h.render()
  assert.equal(h.pollCalls.length, 2)
  first.resolve({ id: 'synthetic-run', status: 'failed', tasks: [], assetIds: [] }); await settle()
  h.render().refreshAgent('synthetic-agent')
  assert.equal(h.pollCalls.length, 2)
  second.resolve({ id: 'synthetic-run', status: 'awaiting_approval', tasks: [], assetIds: [] }); await settle()
  assert.equal(h.node.data.runStatus, 'awaiting_approval'); h.unmount()
})

test('previously completed runs without a delivery marker resume result delivery on reload', async () => {
  const h = harness({ initialStatus: 'completed' }); h.render(); await settle()
  assert.equal(h.actual.getState().nodes.length, 5)
  assert.equal(h.node.data.deliveredRunId, 'synthetic-run'); h.unmount()
})

test('real video settings turn suffixed capability labels into numeric seconds submitted to the API', () => {
  const patches = [], node = { id: 'video', type: 'generation', data: { kind: 'video', model: 'video-model', seconds: 5, references: [], skills: [], prompt: 'Synthetic' } }
  const store = { nodes: [node], edges: [], updateNodeData: (_, patch) => { patches.push(patch); Object.assign(node.data, patch) }, openSettings() {}, setAssetPanel() {} }
  const settings = sourceModule('../components/free-canvas/nodes/generation-settings.tsx', {
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') }, '@/lib/studio/studio-models': { filterModelsByCapability: value => value },
    '@/lib/studio/store': { useStudio: () => ({ state: { models: [{ id: 'video-model', capabilities: { durations: ['5 秒', '8 秒'], ratios: [], qualities: [], maxReferences: 0 } }] } }) },
    '../canvas-context': { useCanvasActions: () => ({ estimateNode: () => 1 }) }, '../canvas-store': { useCanvasStore: selector => selector(store) }, './node-kit': { COUNTER_SCALE: '', SETTINGS_POPOVER_WIDTH: 300 },
  })
  function find(element) { if (!element || typeof element !== 'object') return; if (element.props?.label === '时长') return element; for (const child of [element.props?.children].flat(Infinity)) { const found = find(child); if (found) return found } }
  const control = find(settings.GenerationSettings({ nodeId: node.id, placement: { side: 'right', offset: { x: 0, y: 0 } } }))
  assert.deepEqual(control.props.options, [{ value: '5', label: '5 秒' }, { value: '8', label: '8 秒' }])
  control.props.onChange('8'); assert.deepEqual(patches, [{ seconds: 8 }])
  const parsed = ts.createSourceFile('generation-api.ts', source('../lib/studio/generation-api.ts'), ts.ScriptTarget.ES2022, true)
  const definitions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ['createVideoTask', 'projectTaskContext'].includes(node.name?.text)).map(node => `export ${node.getText(parsed).replace(/^export\s+/, '')}`).join('\n')
  let body; const module = { exports: {} }
  new Function('module', 'exports', 'generate', 'requestIdHeaders', compile(definitions))(module, module.exports, (_, options) => { body = JSON.parse(options.body) }, () => ({}))
  module.exports.createVideoTask({ prompt: 'Synthetic', seconds: node.data.seconds })
  assert.equal(body.config.videoSeconds, '8')
})
