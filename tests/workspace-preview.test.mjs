import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Render the real owned components with inert leaf controls. No HTTP, accounts,
// fixture credentials, or provider calls are needed for these state regressions.
const require = createRequire(import.meta.url)
const read = (name) => readFileSync(new URL(`../components/studio/${name}.tsx`, import.meta.url), 'utf8')
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
const noop = () => {}
const ui = {
  ControlButton: ({ variant, size, ...props }) => React.createElement('button', props),
  IconAction: ({ label, ...props }) => React.createElement('button', { ...props, 'aria-label': label }),
  MediaThumb: ({ alt, className }) => React.createElement('img', { alt, className }),
  Notice: ({ children }) => React.createElement('div', null, children),
  StatusBadge: ({ children }) => React.createElement('span', null, children),
  Tooltip: ({ children }) => children,
  SegmentedControl: ({ options }) => React.createElement('div', null, options.map(({ value, label }) => React.createElement('button', { key: value, type: 'button' }, label))),
}
function load(source, mocks = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compile(source))((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name === './ui') return ui
    if (name === '@/lib/utils') return { cn: (...items) => items.filter(Boolean).join(' ') }
    return require(name)
  }, module, module.exports)
  return module.exports
}
function functions(source, names) {
  const parsed = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  return load(parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => `export ${node.getText(parsed).replace(/^export\s+/, '')}`).join('\n'))
}
const kit = load(read('workspace-kit'))
const helpers = functions(read('workspaces'), ['previewWorks', 'generationBlockReason', 'supportedChoice', 'resolveReusedParameters'])
const home = load(read('home-generation-panel'), { './model-icon': { ModelIcon: () => null } })
const html = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
const stage = (extra = {}) => html(kit.ResultStage, { view: 'single', onViewChange: noop, viewOptions: [], ratio: '9:16', status: 'idle', statusLabel: '已就绪', emptyHint: 'Synthetic empty instruction', isEmpty: true, children: React.createElement('span', { 'data-result': true }, 'Synthetic result'), ...extra })

test('history and comparison stay independent of future batch size and honor the current selection', () => {
  const works = ['first', 'second', 'third'].map((id) => ({ id, src: `${id}.png` }))
  assert.deepEqual(helpers.previewWorks(works, 'grid', 'second'), works)
  assert.deepEqual(helpers.previewWorks(works, 'compare', 'third').map((work) => work.id), ['third', 'first'])
  assert.deepEqual(helpers.previewWorks(works, 'single', 'removed').map((work) => work.id), ['first'])
  assert.deepEqual(helpers.previewWorks([], 'compare', null), [])
  assert.equal(helpers.previewWorks(works.slice(0, 1), 'compare', null).length, 1)
})

test('availability distinguishes connection, login, missing model and insufficient balance before submitting', () => {
  assert.match(helpers.generationBlockReason('checking', false, 0, 0), /正在连接/)
  assert.match(helpers.generationBlockReason('unauthenticated', false, 0, 0), /登录/)
  assert.match(helpers.generationBlockReason('unavailable', true, 0, 0), /无法连接/)
  assert.match(helpers.generationBlockReason('connected', false, 0, 50), /没有可用模型/)
  assert.match(helpers.generationBlockReason('connected', true, 11, 10), /积分不足/)
  assert.equal(helpers.generationBlockReason('connected', true, 10, 10), '')
  assert.equal(helpers.generationBlockReason('connected', true, 0, 0), '')
})

test('model changes select a supported submitted value instead of only changing the displayed label', () => {
  assert.equal(helpers.supportedChoice('高清', ['auto', 'high']), 'auto')
  assert.equal(helpers.supportedChoice('high', ['auto', 'high']), 'high')
  assert.equal(helpers.supportedChoice('16:9', ['1:1']), '1:1')
  assert.equal(helpers.supportedChoice('5 秒', []), '5 秒')
})

test('reused model selection requires an available exact identifier or one unambiguous historical name', () => {
  const models = [{ id: 'image-a', name: 'Original image', shortName: 'Image' }, { id: 'image-b', name: 'Second image', shortName: 'Image' }]
  assert.equal(helpers.resolveReusedParameters({ kind: 'image', model: 'image-b' }, models).modelId, 'image-b')
  assert.equal(helpers.resolveReusedParameters({ kind: 'image', model: 'Original image' }, models).modelId, 'image-a')
  for (const model of ['Image', 'removed-model']) {
    const result = helpers.resolveReusedParameters({ kind: 'image', prompt: 'Synthetic reused prompt', model }, models)
    assert.equal(result.modelId, undefined)
    assert.equal(result.prompt, 'Synthetic reused prompt')
    assert.equal(result.notice.tone, 'warning')
    assert.match(result.notice.text, /原模型当前不可用/)
  }
})

function reuseHarness() {
  const handoff = load(readFileSync(new URL('../lib/studio/reuse-params.ts', import.meta.url), 'utf8'))
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  const slots = []; let cursor = 0; let effects = []
  const parsed = ts.createSourceFile('workspaces.tsx', read('workspaces'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useWorkReuseParams')
  const module = { exports: {} }
  const bindings = {
    useRef: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = value }] },
    useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
    window: { sessionStorage: storage }, consumeReuseParams: handoff.consumeReuseParams,
    resolveReusedParameters: helpers.resolveReusedParameters,
  }
  new Function('module', 'exports', ...Object.keys(bindings), compile(`export ${declaration.getText(parsed)}`))(module, module.exports, ...Object.values(bindings))
  const applied = { prompt: '', model: '', notices: [] }
  const input = { kind: 'image', accountId: 'synthetic-a', connected: false, models: [{ id: 'real-image', name: 'Real image', shortName: 'Real' }], prompt: '', protectDraft: { current: false }, setPrompt: (value) => { applied.prompt = value }, setModelId: (value) => { applied.model = value }, setNotice: (value) => applied.notices.push(value) }
  return { input, applied, write: (id, params) => handoff.writeReuseParams(storage, id, params), render() { cursor = 0; effects = []; const result = module.exports.useWorkReuseParams(input); effects.forEach((effect) => effect()); return result } }
}

test('the real workspace handoff effect waits for authentication, applies once and never submits', () => {
  const harness = reuseHarness()
  harness.write('synthetic-a', { kind: 'image', prompt: 'Synthetic restored description', model: 'real-image' })
  harness.render()
  assert.equal(harness.applied.prompt, '')
  harness.input.connected = true
  harness.render()
  assert.equal(harness.applied.prompt, 'Synthetic restored description')
  assert.equal(harness.applied.model, 'real-image')
  harness.render()
  assert.equal(harness.applied.notices.length, 1)
})

test('reusing parameters preserves typed and home drafts until chosen and cannot cross accounts', () => {
  for (const homeDraft of [false, true]) {
    const harness = reuseHarness()
    harness.input.connected = true
    harness.input.prompt = homeDraft ? '' : 'Unsaved typed draft'
    harness.input.protectDraft.current = homeDraft
    harness.write('synthetic-a', { kind: 'image', prompt: 'Prior result prompt', model: 'real-image' })
    harness.render()
    const choice = harness.render()
    assert.equal(choice.pending, true)
    assert.equal(harness.applied.prompt, '')
    choice.applyPending()
    assert.equal(harness.applied.prompt, 'Prior result prompt')
    assert.equal(harness.render().pending, false)
  }
  const harness = reuseHarness()
  harness.input.connected = true; harness.input.prompt = 'Private A draft'
  harness.write('synthetic-a', { kind: 'image', prompt: 'Private A reuse' })
  harness.render()
  harness.input.accountId = 'synthetic-b'
  const other = harness.render()
  assert.equal(other.pending, false)
  other.applyPending()
  assert.equal(harness.applied.prompt, '')
})

test('ratio conversion accepts pixel dimensions and rejects nonfinite or negative media dimensions', () => {
  for (const value of ['16:9', '16 / 9', '16x9', '16×9']) assert.equal(kit.ratioToCss(value), '16 / 9')
  assert.equal(kit.ratioToCss('1024x1024'), '1024 / 1024')
  for (const value of ['-1:9', '0:0', 'Infinity:2', 'NaN:1', 'oops']) assert.equal(kit.ratioToCss(value), '16 / 9')
})

test('portrait empty preview uses viewport-bounded height and a centered, theme-aware state', () => {
  const output = stage()
  assert.match(output, /data-testid="result-stage-viewport"/)
  assert.match(output, /h-\[clamp\(240px,48dvh,560px\)\]/)
  assert.doesNotMatch(output, /aspect-ratio:9/)
  assert.match(output, /items-center justify-center/)
  assert.match(output, /Synthetic empty instruction/)
  assert.doesNotMatch(output, /data-result="true"/)
})

test('loading and failure have distinct states and do not hide existing successful results', () => {
  const pending = stage({ status: 'processing', statusLabel: '处理中' })
  assert.match(pending, /aria-busy="true"/)
  assert.match(pending, /任务正在处理中/)
  assert.doesNotMatch(pending, /Synthetic empty instruction/)
  const failed = stage({ status: 'failed', statusLabel: '生成失败', onRetry: noop })
  assert.match(failed, /role="alert"/)
  assert.match(failed, /重试/)
  assert.doesNotMatch(failed, /Synthetic empty instruction/)
  for (const status of ['processing', 'failed']) {
    const previous = stage({ status, isEmpty: false })
    assert.match(previous, /data-result="true"/)
    assert.doesNotMatch(previous, /absolute inset-0/)
  }
})

test('mobile and desktop share one parameter subtree and reserve room for the bottom action bar', () => {
  const output = html(kit.WorkspaceShell, { params: React.createElement('input', { id: 'synthetic-prompt' }), stage: 'Preview', onSubmit: noop, submitLabel: '生成', credits: 12, submitDisabled: true, submitHint: '合成原因' })
  assert.equal((output.match(/id="synthetic-prompt"/g) || []).length, 1)
  assert.match(output, /aria-controls=/)
  assert.match(output, /safe-area-inset-bottom/)
  assert.match(output, /合成原因/)
})

test('reference search is a named search control with a single managed focus surface, never a nested form', () => {
  const output = html(kit.ReferencePicker, { assets: [], selectedIds: [], onToggle: noop, maxReferences: 4, libraryState: 'ready', serverSearch: true })
  assert.match(output, /role="search"/)
  assert.match(output, /type="search"/)
  assert.match(output, /aria-label="搜索素材"/)
  assert.match(output, /data-focus-managed="true"/)
  assert.match(output, /border:0;background:transparent;box-shadow:none;outline:none/)
  assert.doesNotMatch(output, /<form/)
})

test('a failed refresh retains existing references while reporting the failure', () => {
  const output = html(kit.ReferencePicker, { assets: [{ id: 'synthetic-image', title: 'Synthetic', src: '/synthetic.png', kind: 'image', fallback: '' }], selectedIds: [], onToggle: noop, maxReferences: 4, libraryState: 'error', libraryMessage: 'Synthetic unavailable' })
  assert.match(output, /素材更新失败/)
  assert.match(output, /data-asset-id="synthetic-image"/)
  assert.doesNotMatch(output, /素材库里还没有/)
})

test('home panel cannot submit a media request without a model and names empty options', () => {
  const output = html(home.GenerationPanel, { mode: 'image', modelOptions: [], groupedModels: {}, dropdownOpen: false, pickerRef: { current: null }, onToggleDropdown: noop, onSelectModel: noop, ratioOptions: [], ratio: '', qualityOptions: [], quality: '', onRatioChange: noop, onQualityChange: noop, estimatedCredits: 0, canStart: true, starting: false, startError: '' })
  assert.match(output, /当前暂无可用模型/)
  assert.match(output, /<button type="submit" disabled=""/)
  assert.match(output, /暂无可用选项/)
  assert.match(output, /模型配置完成后可估算/)
})

test('task query errors do not claim an empty history and active counts belong to the selected kind', () => {
  const generation = { tasks: [], loading: false, refresh: noop, queryUnavailable: true, activeCount: 99 }
  const live = load(read('live-generation'), { '@/lib/studio/generation-store': { useGeneration: () => generation }, '@/lib/studio/generation-api': { isActiveStatus: (status) => ['pending', 'running'].includes(status) } })
  const failed = html(live.LiveTaskList, { kinds: ['image'] })
  assert.match(failed, /暂时无法查询任务状态/)
  assert.doesNotMatch(failed, /还没有生成任务/)
  generation.queryUnavailable = false
  generation.tasks = [{ kind: 'image', status: 'pending' }, { kind: 'video', status: 'pending' }]
  const filtered = html(live.LiveTaskList, { kinds: ['image'], limit: 0 })
  assert.match(filtered, /1 条进行中/)
  assert.doesNotMatch(filtered, /99 条进行中/)
})

test('file reading reports real progress and settles success, error and cancellation', async () => {
  const { readFileAsDataUrl } = functions(read('workspace-kit'), ['readFileAsDataUrl'])
  const original = globalThis.FileReader
  let reader
  globalThis.FileReader = class { constructor() { reader = this } readAsDataURL(file) { this.file = file } }
  try {
    const progress = []
    const success = readFileAsDataUrl({ name: 'synthetic.png' }, (value) => progress.push(value))
    reader.onprogress({ lengthComputable: true, loaded: 3, total: 4 })
    reader.result = 'data:image/png;base64,c3ludGhldGlj'
    reader.onload()
    assert.equal(await success, reader.result)
    assert.deepEqual(progress, [75])
    const error = readFileAsDataUrl({})
    reader.onerror()
    await assert.rejects(error, /文件读取失败/)
    const cancelled = readFileAsDataUrl({})
    reader.onabort()
    await assert.rejects(cancelled, /已取消/)
  } finally { globalThis.FileReader = original }
})
