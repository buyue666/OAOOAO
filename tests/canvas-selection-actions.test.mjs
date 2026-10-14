import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function moduleOf(path, mocks = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const selection = moduleOf('../components/free-canvas/canvas-selection.ts')
const helpers = moduleOf('../components/free-canvas/canvas-selection-actions.ts', { './canvas-selection': selection })
const factory = moduleOf('../components/free-canvas/node-factory.ts')
test('real owned generation media can be saved from a selection without admitting arbitrary API paths', () => {
  const id = '12345678-1234-1234-1234-123456789abc'
  for (const route of ['media', 'reference-assets', 'generation-log-assets']) assert.equal(helpers.safeSelectionMediaUrl(`/api/${route}/${id}`), true)
  for (const route of ['/api/users/admin', '/api/media/../../settings', '//foreign.test/media/a.png']) assert.equal(helpers.safeSelectionMediaUrl(route), false)
})
const defaults = { imageSize: '1:1', imageQuality: 'auto', imageCount: 1, videoQuality: 'standard', videoSeconds: 8, audioVoice: 'alloy', audioFormat: 'mp3' }
function generation(id, overrides = {}) { const node = factory.createGenerationNode('image', { x: 20, y: 30 }, defaults, id); node.selected = true; node.data = { ...node.data, prompt: '创作提示词', ...overrides }; return node }
const deferred = () => { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve } }
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

test('group descendants yield media and text outputs once, skip already owned and unsafe URLs, never save prompts', () => {
  const group = factory.createGroupNode({ x: 100, y: 200 }, { width: 800, height: 600 }, 'g'); group.selected = true
  const image = generation('image', { results: [{ url: '/media/result.png', mediaKind: 'image' }, { url: '/media/result.png', mediaKind: 'image' }, { url: 'blob:temporary', mediaKind: 'video' }], text: '生成文本' }); image.selected = false; image.parentId = 'g'
  const asset = factory.createMediaNode('asset', { x: 0, y: 0 }, { id: 'asset', libraryAssetId: 'owned', title: '素材', url: '/media/owned.png', mediaKind: 'image' }, 'asset'); asset.parentId = 'g'
  const empty = generation('empty'); empty.parentId = 'g'
  const outside = generation('outside', { results: [{ url: '/media/outside.png', mediaKind: 'image' }] }); outside.selected = false
  const rows = helpers.selectionResults([group, image, asset, empty, outside])
  assert.equal(rows.length, 4); assert.equal(rows.filter(row => row.skipped).length, 2)
  assert(rows.some(row => row.kind === 'text' && row.text === '生成文本'))
  assert(!JSON.stringify(rows).includes('outside')); assert(!JSON.stringify(rows).includes('创作提示词'))
})

test('an already-owned duplicate is skipped regardless of node order', () => {
  const generated = generation('generated', { results: [{ url: '/media/same.png', mediaKind: 'image' }] })
  const owned = factory.createMediaNode('asset', { x: 0, y: 0 }, { id: 'reference', libraryAssetId: 'owned', title: '已收藏结果', url: '/media/same.png', mediaKind: 'image' }, 'owned')
  owned.selected = true
  for (const nodes of [[generated, owned], [owned, generated]]) {
    const rows = helpers.selectionResults(nodes)
    assert.equal(rows.length, 1)
    assert.match(rows[0].skipped, /已是资产库/)
  }
})

test('Agent summary and JSON allowlist preserve internal edges and creative details, omit secrets and runtime identities', () => {
  const a = generation('source', { results: [{ url: '/private-render?signature=secret', mediaKind: 'image' }], prompt: '使用 /private-render?signature=secret 和 https://example.test/a?token=private 任务 job-private', text: '完成文案', task: { id: 'job-private', phase: 'running', startedAt: 1 }, model: 'model', ratio: '16:9' })
  a.parentId = 'external-group'
  const group = factory.createGroupNode({ x: 100, y: 200 }, { width: 800, height: 600 }, 'external-group')
  const b = factory.createAgentNode({ x: 500, y: 30 }, 'agent'); b.selected = true; b.data.runId = 'run-private'; b.data.prompt = '继续 run-private'; b.data.steps = [{ id: 'step-private', title: 'step', type: 'text', status: 'running' }]
  const edges = [{ id: 'private-edge', source: 'source', target: 'agent', data: { secret: 'hidden' } }, { id: 'out', source: 'source', target: 'outside' }]
  const document = helpers.selectionDocument([group, a, b], edges)
  const output = JSON.stringify(document)
  for (const secret of ['signature=secret', 'token=private', 'job-private', 'run-private', 'step-private', 'private-edge', 'hidden']) assert(!output.includes(secret), secret)
  assert.equal(document.nodes.length, 2); assert.deepEqual(document.nodes[0].position, { x: 120, y: 230 }); assert.equal(document.nodes[0].parentId, undefined)
  assert.equal(document.nodes[0].data.ratio, '16:9'); assert.equal(document.nodes[0].data.text, '完成文案'); assert.equal(document.connections.length, 1)
  const prompt = helpers.selectionAgentPrompt([group, a, b], edges)
  assert.match(prompt, /仍会结合整个画布/)
  for (const secret of ['signature=secret', 'token=private', 'job-private', 'run-private', 'step-private', 'private-edge', 'hidden']) assert(!prompt.includes(secret), secret)
})

test('Agent draft explains nodes, content, relevant parameters and internal relationships in readable Chinese', () => {
  const image = generation('image', { title: '城市海报', model: 'image-model', prompt: '清晨的城市\n保持柔和光线', text: '已有创意文案', ratio: '16:9', quality: 'high', count: 2 })
  const video = factory.createGenerationNode('video', { x: 0, y: 0 }, defaults, 'video')
  video.selected = true; video.data = { ...video.data, title: '海报动起来', prompt: '镜头缓缓推进', model: 'video-model', seconds: 8 }
  const audio = factory.createGenerationNode('audio', { x: 0, y: 0 }, defaults, 'audio')
  audio.selected = true; audio.data = { ...audio.data, title: '旁白', prompt: '欢迎来到这座城市', model: 'audio-model', voice: 'voice-a', format: 'wav' }
  const group = factory.createGroupNode({ x: 0, y: 0 }, { width: 700, height: 500 }, 'group'); group.selected = true; group.data.title = '城市短片'
  image.parentId = 'group'
  const prompt = helpers.selectionAgentPrompt([group, image, video, audio], [
    { id: 'edge', source: 'image', target: 'video' }, { id: 'outside-edge', source: 'video', target: 'outside' },
  ])
  assert.match(prompt, /选区摘要（4 个节点）/)
  assert.match(prompt, /节点 2（城市海报）｜图片生成/)
  assert.match(prompt, /所属分组：节点 1（城市短片）/)
  assert.match(prompt, /创作要求：\n清晨的城市\n保持柔和光线/)
  assert.match(prompt, /已有生成文本：\n已有创意文案/)
  assert.match(prompt, /模型：image-model；画面比例：16:9；质量：high；数量：2 张/)
  assert.match(prompt, /模型：video-model；画面比例：16:9；质量：standard；时长：8 秒/)
  assert.match(prompt, /模型：audio-model；音色：voice-a；格式：wav/)
  assert.match(prompt, /选区内部关联：\n节点 2（城市海报） → 节点 3（海报动起来）/)
  assert(!prompt.includes('alloy')); assert(!prompt.includes('outside')); assert(!prompt.includes('"connections"')); assert(!prompt.includes('"id"'))
})

function batchFixture({ create, current = () => true, owner = true, storageError = false } = {}) {
  const saved = new Map(), calls = [], patches = []
  const rows = [1, 2, 3].map(id => ({ id: String(id), key: `key-${id}`, kind: 'text', title: `结果${id}`, text: `文本${id}`, status: 'pending' }))
  const options = { current, verifyOwner: async () => owner, lock: (_key, fn) => fn(),
    receipt(key, value) { if (storageError) throw new Error('storage unavailable'); if (value === null) saved.delete(key); else if (value) saved.set(key, value); return saved.get(key) ?? null },
    create: async input => { calls.push(input); return create ? create(input, calls.length) : { id: `asset-${calls.length}` } },
    update: (id, patch) => { patches.push({ id, ...patch }); Object.assign(rows.find(row => row.id === id), patch) },
  }
  return { saved, calls, patches, rows, options }
}

test('mixed batch keeps confirmed successes, quarantines unknown response and permits only rejected item retry', async () => {
  const fixture = batchFixture({ create: async (_input, count) => { if (count === 2) throw new TypeError('lost response'); if (count === 3) throw { status: 400 }; return { id: `saved-${count}` } } })
  await helpers.saveSelectionBatch(fixture.rows, fixture.options)
  assert.deepEqual(fixture.rows.map(row => row.status), ['saved', 'unknown', 'failed'])
  assert.equal(fixture.saved.get('key-2').status, 'unknown')
  await helpers.saveSelectionBatch(fixture.rows, fixture.options)
  assert.equal(fixture.calls.length, 4); assert.equal(fixture.calls[3].title, '结果3')
  assert.equal(fixture.calls[0].metadata.selectionSaveKey, 'key-1'); assert.deepEqual(fixture.calls[0].data, { text: '文本1', assetRole: 'general' })
})

test('reopened pending row honors durable unknown receipt without issuing another POST', async () => {
  const fixture = batchFixture(); fixture.saved.set('key-1', { status: 'unknown' })
  await helpers.saveSelectionBatch([fixture.rows[0]], fixture.options)
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.rows[0].status, 'unknown')
})

test('switching canvas while a POST is pending prevents late UI writes and subsequent POSTs', async () => {
  const wait = deferred(); let active = true
  const fixture = batchFixture({ current: () => active, create: () => wait.promise })
  const running = helpers.saveSelectionBatch(fixture.rows, fixture.options); await settle()
  assert.equal(fixture.saved.get('key-1').status, 'unknown'); active = false; wait.resolve({ id: 'confirmed-old-owner-asset' }); await running
  assert.equal(fixture.calls.length, 1); assert.deepEqual(fixture.patches.map(row => row.status), ['saving']); assert.equal(fixture.saved.get('key-1').status, 'saved')
})

test('owner mismatch and unavailable receipt storage both block writes before POST', async () => {
  for (const args of [{ owner: false }, { storageError: true }]) {
    const fixture = batchFixture(args)
    await assert.rejects(helpers.saveSelectionBatch(fixture.rows, fixture.options))
    assert.equal(fixture.calls.length, 0)
  }
})

function hookFixture(nodes) {
  const values = [], refs = [], cleanup = [], calls = [], inserted = [], notices = []
  const stored = new Map()
  let vi = 0, ri = 0, account = 'owner', store = { projectId: 'board', projectMeta: {}, hydrated: true, nodes, edges: [], setNotice: value => notices.push(value), insertNodes: value => inserted.push(...value) }
  const useCanvasStore = selector => selector(store); useCanvasStore.getState = () => store
  const react = { useState(initial) { const i = vi++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }] }, useRef(initial) { return refs[ri++] ??= { current: initial } }, useCallback: fn => fn, useEffect() {} }
  globalThis.window = { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  const mod = moduleOf('../components/free-canvas/use-canvas-selection-actions.tsx', { react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/studio/account-api': { createLibraryAsset: async input => { calls.push(input); return { id: `asset-${calls.length}` } } },
    '@/lib/studio/api': { getSession: async () => ({ user: { id: account } }) },
    '@/lib/studio/store': { useStudio: () => ({ state: { user: { id: account } } }) }, './canvas-store': { useCanvasStore },
    './canvas-selection': selection, './node-factory': factory, './canvas-selection-actions': helpers,
  })
  const render = () => { vi = 0; ri = 0; return mod.useCanvasSelectionActions() }
  const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
  const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
  const tree = () => all(render().dialogs)
  return { render, calls, inserted, notices, tree, stored,
    account: value => { account = value }, switchBoard: () => { store = { ...store, projectId: 'another', projectMeta: {} } },
    button: label => tree().find(node => node.type === 'button' && text(node).includes(label)),
  }
}

test('opening save confirmation sends no POST; confirm saves once and double clicks cannot duplicate', async () => {
  const f = hookFixture([generation('text', { text: '真实结果' })])
  f.render().saveSelectionResults(); await settle()
  assert.equal(f.calls.length, 0)
  const button = f.button('确认保存'); assert.equal(button.props.disabled, false)
  button.props.onClick(); button.props.onClick(); await settle()
  assert.equal(f.calls.length, 1); assert.equal(f.button('确认保存').props.disabled, true)
  f.render().saveSelectionResults(); await settle(); assert.equal(f.button('确认保存').props.disabled, true)
})

test('Agent opens editable draft, cancel has no effects, confirmation inserts one fresh Agent without changing a running Agent', () => {
  const running = factory.createAgentNode({ x: 0, y: 0 }, 'running'); running.selected = true; running.data.runId = 'live-run'; running.data.runStatus = 'running'; running.data.prompt = '原任务'
  const f = hookFixture([running]); f.render().draftAgentFromSelection(); assert.equal(f.inserted.length, 0)
  f.button('取消').props.onClick(); assert.equal(f.inserted.length, 0)
  f.render().draftAgentFromSelection()
  const textarea = f.tree().find(node => node.type === 'textarea'); textarea.props.onChange({ target: { value: '用户编辑后的任务草稿' } })
  const form = f.tree().find(node => node.type === 'form'); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} })
  assert.equal(f.inserted.length, 1); assert.equal(f.inserted[0].data.prompt, '用户编辑后的任务草稿'); assert.equal(f.inserted[0].data.runId, null)
  assert.equal(running.data.runId, 'live-run'); assert.equal(running.data.prompt, '原任务'); assert.equal(f.calls.length, 0)
})

test('stale confirmation cannot insert into a changed account or canvas', () => {
  for (const kind of ['account', 'board']) {
    const f = hookFixture([generation('selected')]); f.render().draftAgentFromSelection()
    const form = f.tree().find(node => node.type === 'form')
    if (kind === 'account') { f.account('other'); f.render() } else f.switchBoard()
    form.props.onSubmit({ preventDefault() {} }); assert.equal(f.inserted.length, 0); assert.equal(f.render().dialogs, null)
  }
})

test('overlong Agent drafts preserve the full text and cannot create a node until edited within the limit', () => {
  const fullText = `${'创作内容'.repeat(4100)}保留末尾`
  const f = hookFixture([generation('long', { prompt: fullText })])
  f.render().draftAgentFromSelection()
  const textarea = f.tree().find(node => node.type === 'textarea')
  assert(textarea.props.value.includes(fullText)); assert(textarea.props.value.length > 16000)
  assert.equal(f.button('创建任务草稿').props.disabled, true)
  f.tree().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(f.inserted.length, 0)
  textarea.props.onChange({ target: { value: '整理后的创作要求' } })
  f.tree().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(f.inserted.length, 1); assert.equal(f.inserted[0].data.prompt, '整理后的创作要求')
})

test('normal save acknowledgments and remote board updates preserve dialog session identity; hydration changes it', () => {
  const types = moduleOf('../components/free-canvas/types.ts')
  const layout = moduleOf('../components/free-canvas/canvas-layout.ts', { './node-factory': factory })
  const store = moduleOf('../components/free-canvas/canvas-store.ts', { './node-factory': factory, './types': types, './canvas-layout': layout, './canvas-selection': selection }).useCanvasStore
  const meta = { description: '测试画布' }, nodes = [generation('node')]
  const payload = { projectId: 'same-board', title: '测试画布', projectMeta: meta, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: '2026-01-01T00:00:00Z' }
  store.getState().hydrate(payload)
  store.getState().setTitle('保存后的名称')
  store.getState().markSaved('2026-01-01T00:01:00Z', store.getState().revision)
  assert.equal(store.getState().projectMeta, meta)
  store.getState().adoptRemoteBoard(nodes, [], '2026-01-01T00:02:00Z')
  assert.equal(store.getState().projectMeta, meta)
  store.getState().setTitle('尚未保存的名称')
  store.getState().adoptRemoteBoard(nodes, [], '2026-01-01T00:03:00Z')
  assert.equal(store.getState().projectMeta, meta)
  store.getState().hydrate({ ...payload, projectMeta: { ...meta } })
  assert.notEqual(store.getState().projectMeta, meta)
})
