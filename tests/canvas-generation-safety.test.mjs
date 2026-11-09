import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { canvasPolicyModules, canvasTestModel } from './canvas-test-modules.mjs'

const require = createRequire(import.meta.url)
function sourceModule(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const types = sourceModule('../components/free-canvas/types.ts')
const factory = sourceModule('../components/free-canvas/node-factory.ts')
const layout = sourceModule('../components/free-canvas/canvas-layout.ts', { './node-factory': factory })
const selection = sourceModule('../components/free-canvas/canvas-selection.ts')
const codec = sourceModule('../components/free-canvas/board-codec.ts', { './director/catalog': sourceModule('../components/free-canvas/director/catalog.ts'), './types': types, './node-factory': factory })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const settle = () => new Promise(resolve => setImmediate(resolve))
const plain = value => JSON.parse(JSON.stringify(value))
const defaults = { imageSize: '1:1', imageQuality: 'auto', imageCount: 4, videoQuality: '720', videoSeconds: 8, audioVoice: 'alloy', audioFormat: 'mp3' }

function harness({ submit, loadSkills, save, restored, query, cancel, knownTasks = [], cancelInStore, workspace, teamRequest, models = [canvasTestModel()], videoQuote } = {}) {
  const actual = sourceModule('../components/free-canvas/canvas-store.ts', { './node-factory': factory, './types': types, './canvas-layout': layout, './canvas-selection': selection }).useCanvasStore
  const useCanvasStore = selector => selector(actual.getState()); useCanvasStore.getState = actual.getState
  const node = restored || factory.createGenerationNode('image', { x: 0, y: 0 }, defaults, 'shared-node')
  if (!restored) node.data = { ...node.data, model: 'image-model', prompt: 'Original synthetic prompt' }
  const hydrate = (id, value = node) => actual.getState().hydrate({ projectId: id, title: id, workspace, updatedAt: '2026-01-01T00:00:00.000Z', projectMeta: {}, nodes: [value], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
  hydrate('canvas-a')
  const submissions = [], snapshots = [], estimates = [], cleanups = []
  let identities = 0
  const create = async input => { submissions.push(plain(input)); return submit ? submit(input, submissions.length) : { id: 'real-task', status: 'pending' } }
  const hook = sourceModule('../components/free-canvas/use-generation-actions.ts', {
    ...canvasPolicyModules(sourceModule),
    react: { useCallback: fn => fn, useMemo: fn => fn(), useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) } },
    '@/lib/studio/api': { request: teamRequest },
    '@/lib/studio/account-api': { listLibraryAssets: loadSkills },
    '@/lib/studio/canvas-skills': sourceModule('../lib/studio/canvas-skills.ts'),
    '@/lib/studio/generation-api': { newClientRequestId: () => `request-${++identities}`, getGenerationTask: query, cancelGenerationTask: cancel, quoteVideoGeneration: videoQuote, normalizeTaskResult: (_kind, value) => value ?? { media: [] } },
    '@/lib/studio/generation-store': { useGeneration: () => ({ tasks: knownTasks, cancelTask: cancelInStore, createImage: create, createVideo: create, createAudio: create, createText: create }) },
    '@/lib/studio/studio-models': { filterModelsByCapability: (models, kind) => models.filter(model => model.capability === kind), defaultModelFor: (_kind, _settings, models) => models[0]?.id },
    '@/lib/studio/store': { useStudio: () => ({ state: { models, user: { id: 'synthetic-owner' } }, estimateCredits: (_, input) => { estimates.push(input); return input.count } }) },
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

test('canvas references keep explicit mention order, retain frame roles, and include upstream audio', () => {
  const policy = canvasPolicyModules(sourceModule)['./canvas-generation-policy']
  const explicit = { id: 'first', title: '主体', url: '/api/reference-assets/first', mediaKind: 'image', role: 'first_frame' }
  const audio = { id: 'audio', type: 'generation', data: { title: '音乐', results: [{ url: '/api/reference-assets/audio', mediaKind: 'audio' }] } }
  const node = { id: 'video', data: { references: [explicit] } }
  const refs = policy.canvasReferences('video', node.data, [audio], [{ source: 'audio', target: 'video' }])
  assert.deepEqual(refs.map(ref => ref.id), ['first', 'audio'])
  assert.equal(policy.submissionReferences(refs)[0].role, 'first_frame')
  assert.equal(policy.canvasPrompt('以@图1 为主体，使用@音频1', refs), '以@1 为主体，使用@2')
  assert.equal(policy.remapCanvasMentions('@图1 加上@音频1', refs, [refs[1]]), '（已移除：主体） 加上@音频1')
})

test('an already completed create/recovery response writes its media immediately without waiting for a poll', async () => {
  const h = harness({ submit: async () => ({ id: 'completed', status: 'success', media: [{ kind: 'image', url: '/api/reference-assets/result' }] }) })
  await h.actions.submitNode('shared-node'); assert.equal(h.node.data.task.phase, 'success'); assert.equal(h.node.data.results[0].url, '/api/reference-assets/result')
})

test('reference limits and invalid URLs fail visibly before any request instead of silently slicing', async () => {
  for (const limit of [0, 1]) {
    const model = canvasTestModel(); model.capabilities.maxReferences = limit
    const h = harness({ models: [model] })
    h.actual.getState().updateNodeData('shared-node', { references: [1, 2].map(id => ({ id: String(id), title: `图${id}`, url: `/api/reference-assets/${id}`, mediaKind: 'image' })) })
    await h.actions.submitNode('shared-node')
    assert.equal(h.submissions.length, 0); assert.match(h.node.data.task.error, /最多支持/)
  }
  const h = harness(); h.actual.getState().updateNodeData('shared-node', { references: [{ id: 'local', title: '未上传', url: 'blob:local', mediaKind: 'image' }] })
  await h.actions.submitNode('shared-node'); assert.match(h.node.data.task.error, /尚未上传/); assert.equal(h.submissions.length, 0)
})

test('video capability validation allows frame plus image/audio but rejects videos and unsupported durations', () => {
  const policy = canvasPolicyModules(sourceModule)['./canvas-generation-policy'], model = canvasTestModel('video-model', 'video')
  model.capabilities.videoPolicy.durationRules = { '720': { mode: 'list', values: [4, 6] } }
  const data = { kind: 'video', ratio: '16:9', quality: '720', seconds: 6 }
  const frame = { id: 'first', title: '首帧', url: '/api/reference-assets/first', mediaKind: 'image', role: 'first_frame' }
  const extra = { id: 'audio', title: '配音', url: '/api/reference-assets/audio', mediaKind: 'audio' }
  assert.doesNotThrow(() => policy.validateCanvasGeneration(data, model, [frame, extra]))
  assert.throws(() => policy.validateCanvasGeneration(data, model, [frame, { ...extra, mediaKind: 'video' }]), /不能同时使用参考视频/)
  assert.throws(() => policy.validateCanvasGeneration({ ...data, seconds: 8 }, model, [frame]), /不支持这个时长/)
  assert.throws(() => policy.validateCanvasGeneration(data, model, [frame, { ...frame, id: 'duplicate', url: '/different' }]), /各只能/)
})

test('the real image editor callback keeps model choices and team uploads in a persisted canvas node before submission', async () => {
  const source = readFileSync(new URL('../components/free-canvas/canvas-editor.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('canvas-editor.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const workspaceFunction = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CanvasWorkspace')
  const callback = workspaceFunction.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === 'handleImageEditSubmit'))
  const code = ts.transpileModule(callback.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const policy = canvasPolicyModules(sourceModule)['./canvas-generation-policy']
  for (const operation of ['inpaint', 'to-video']) {
    const workspace = { teamId: 'team', projectId: 'canvas-a', modelIds: [], readOnly: false }, h = harness({ workspace })
    h.actual.getState().openImageEditor({ nodeId: 'shared-node', source: 'generation', url: '/api/teams/team/assets/source/content', title: 'Source' })
    const uploads = [], submissions = [], models = [canvasTestModel('chosen-image'), canvasTestModel('chosen-video', 'video')]
    const deps = { useCallback: fn => fn, useCanvasStore: h.actual, workspace, models, defaults, state: { sessionSettings: undefined },
      imageEditor: h.actual.getState().imageEditor, viewportCenter: () => ({ x: 400, y: 0 }), fitView() {},
      createGenerationNode: factory.createGenerationNode, canvasModelDefaults: policy.canvasModelDefaults,
      filterModelsByCapability: (models, kind) => models.filter(model => model.capability === kind), defaultModelFor: (_kind, _settings, models) => models[0]?.id,
      saveTeamCanvasImage: async (scope, url, title) => { uploads.push({ scope, url, title }); return url.startsWith('data:') ? `/api/teams/team/assets/upload-${uploads.length}/content` : url },
      generation: { submitNode: async id => { const node = h.actual.getState().nodes.find(node => node.id === id); submissions.push(plain(node)) } },
    }
    const submit = new Function(...Object.keys(deps), `${code}\nreturn handleImageEditSubmit;`)(...Object.values(deps))
    await submit({ operation, imageUrl: '/api/teams/team/assets/source/content', prompt: 'Synthetic edit', brushSize: 10, model: operation === 'to-video' ? 'chosen-video' : 'chosen-image', resolution: '2K', quality: operation === 'to-video' ? '720' : 'high', ...(operation === 'inpaint' ? { maskDataUrl: 'data:image/png;base64,synthetic', regions: [{ id: 1, referenceImageDataUrl: 'data:image/png;base64,region' }] } : {}) })
    assert.equal(submissions.length, 1); assert.equal(submissions[0].data.model, operation === 'to-video' ? 'chosen-video' : 'chosen-image')
    assert.equal(submissions[0].data.quality, operation === 'to-video' ? '720' : 'high'); assert.equal(h.actual.getState().imageEditor, null)
    if (operation === 'inpaint') { assert.equal(submissions[0].data.resolution, '2K'); assert.equal(submissions[0].data.references.length, 2); assert.match(submissions[0].data.edit.mask.url, /^\/api\/teams\/team\/assets\//); assert.equal(uploads.length, 3) }
    else { assert.equal(submissions[0].data.references[0].role, 'first_frame'); assert.equal(submissions[0].data.seconds, 8) }
    assert(uploads.every(upload => upload.scope === workspace)); h.unmount()
  }
})

test('team quote requires confirmation, persists the exact approval before charging, and never uses personal create', async () => {
  const calls = [], workspace = { teamId: 'team', projectId: 'canvas-a', modelIds: [], readOnly: false }
  const h = harness({ workspace, teamRequest: async (path, input) => {
    const body = input?.body ? JSON.parse(input.body) : undefined; calls.push({ path, body })
    if (path.endsWith('/quote')) return { points: 2.125 }
    return { task: { id: 'team-task', kind: 'image', status: 'pending' } }
  } })
  await h.actions.submitNode('shared-node')
  assert.equal(calls.length, 1); assert.match(calls[0].path, /teams\/team\/projects\/canvas-a\/generations\/quote$/)
  assert.equal(h.submissions.length, 0); assert.equal(h.node.data.task, null)
  h.actions.confirmGeneration(); await settle()
  assert.equal(calls.length, 2); assert.equal(calls[1].body.approvedCost, 2.125)
  assert.equal(calls[1].body.config.n, 1); assert.equal(calls[1].body.config.resolution, '1K')
  assert.equal(h.snapshots[0].nodes[0].data.task.approvedCost, 2.125)
  assert.equal(h.node.data.task.id, 'team-task'); assert.equal(h.submissions.length, 0); h.unmount()
})

test('changing a quoted draft or reviewing a team canvas cannot create or charge a task', async () => {
  let calls = 0
  const workspace = { teamId: 'team', projectId: 'canvas-a', modelIds: [], readOnly: false }
  const h = harness({ workspace, teamRequest: async () => { calls++; return { points: 1 } } })
  await h.actions.submitNode('shared-node'); h.actual.getState().updateNodeData('shared-node', { prompt: 'changed' })
  h.actions.confirmGeneration(); await settle(); assert.equal(calls, 1); h.unmount()
  const readonly = harness({ workspace: { ...workspace, readOnly: true }, teamRequest: async () => { throw new Error('Must not call') } })
  const before = readonly.node.data.prompt
  readonly.actual.getState().updateNodeData('shared-node', { prompt: 'forbidden' })
  readonly.actual.getState().deleteSelection(); readonly.actual.getState().commitViewport({ x: 2, y: 3, zoom: 2 })
  await readonly.actions.submitNode('shared-node'); assert.equal(readonly.node.data.prompt, before); assert.equal(readonly.actual.getState().revision, 0); readonly.unmount()
})

test('a lost team create response recovers the saved approval and original payload without another quote or personal call', async t => {
  const workspace = { teamId: 'team', projectId: 'canvas-a', modelIds: [], readOnly: false }, firstCalls = []
  const first = harness({ workspace, teamRequest: async (path, input) => {
    firstCalls.push({ path, headers: input.headers, body: JSON.parse(input.body) })
    if (path.endsWith('/quote')) return { points: 3.125 }
    throw { status: 503, message: 'Synthetic response lost' }
  } }); t.after(first.unmount)
  await first.actions.submitNode('shared-node'); first.actions.confirmGeneration(); await settle()
  assert.equal(first.node.data.task.unconfirmed, true)
  const restored = codec.readBoard(first.snapshots[0]).nodes[0], recovered = []
  const retry = harness({ workspace, restored, teamRequest: async (path, input) => {
    recovered.push({ path, headers: input.headers, body: JSON.parse(input.body) })
    return { task: { id: 'already-complete', kind: 'image', status: 'success', result: { media: [{ kind: 'image', url: '/api/teams/team/assets/result/content' }] } } }
  } }); t.after(retry.unmount)
  await retry.actions.submitNode('shared-node')
  assert.equal(recovered.length, 1); assert.deepEqual(recovered[0], firstCalls[1]); assert.equal(retry.submissions.length, 0)
  assert.equal(retry.node.data.results[0].url, '/api/teams/team/assets/result/content')
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

test('polling and manual checks clear library provenance only after successful replacement, making new output saveable', async () => {
  const selectionActions = sourceModule('../components/free-canvas/canvas-selection-actions.ts', { './canvas-selection': selection })
  for (const path of ['poll', 'manual']) {
    const oldText = '资产库中的原文本', source = { runId: 'original-agent-run', assetId: 'original-library-asset' }
    let status = 'running', text = '未完成或失败的临时内容'
    const h = harness({ query: async () => ({ data: { task: { id: 'server-task', status, result: { media: [], text } } } }) })
    h.actual.getState().patchNodes([{ id: 'shared-node', data: { kind: 'text', text: oldText, resultSource: source, task: { id: 'server-task', phase: 'running', startedAt: 1 } } }])
    const check = async () => {
      if (path === 'manual') await h.actions.checkNode('shared-node')
      else h.actual.getState().patchNodes(h.collectTaskPatches([h.node], [{ id: 'server-task', status, media: [], text }]))
    }
    for (const waiting of ['pending', 'running', 'error', 'cancelled']) {
      status = waiting; await check()
      assert.equal(h.node.data.text, oldText, `${path}/${waiting}`)
      assert.deepEqual(h.node.data.resultSource, source)
      assert.match(selectionActions.selectionResults([h.node], [h.node.id])[0].skipped, /已来自资产库/)
    }
    status = 'success'; text = oldText; await check()
    assert.deepEqual(h.node.data.resultSource, source, 'reading the original result again must not duplicate the library asset')
    text = '重新生成的新文本'; await check()
    assert.equal(h.node.data.text, text); assert.equal(h.node.data.resultSource, undefined)
    assert.equal(selectionActions.selectionResults([h.node], [h.node.id])[0].skipped, undefined)
    const restored = codec.readBoard(codec.writeBoard([h.node], [])).nodes[0]
    assert.equal(restored.data.resultSource, undefined)
    assert.equal(restored.data.text, text)
  }
})

test('successful media replacement clears source while unsuccessful media responses preserve prior results', async () => {
  const oldResults = [{ url: '/media/owned.png', mediaKind: 'image' }], source = { runId: 'original-run', assetId: 'owned-image' }
  for (const path of ['poll', 'manual']) {
    let status = 'error'
    const media = [{ url: '/media/new.png', kind: 'image' }]
    const h = harness({ query: async () => ({ data: { task: { id: 'server-task', status, result: { media } } } }) })
    h.actual.getState().patchNodes([{ id: 'shared-node', data: { results: oldResults, resultSource: source, task: { id: 'server-task', phase: 'running', startedAt: 1 } } }])
    const check = async () => {
      if (path === 'manual') await h.actions.checkNode('shared-node')
      else h.actual.getState().patchNodes(h.collectTaskPatches([h.node], [{ id: 'server-task', status, media }]))
    }
    await check(); assert.deepEqual(h.node.data.results, oldResults); assert.deepEqual(h.node.data.resultSource, source)
    status = 'success'; await check()
    assert.equal(h.node.data.results[0].url, '/media/new.png'); assert.equal(h.node.data.resultSource, undefined)
  }
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
