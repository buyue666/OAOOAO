import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, mocks = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports, ...Object.values(globals))
  return module.exports
}
const skills = sourceModule('../lib/studio/canvas-skills.ts')
const selection = sourceModule('../components/free-canvas/canvas-selection.ts')
const { createSelectionSkillDraft } = sourceModule('../components/free-canvas/canvas-selection-skill.ts', { '@/lib/studio/canvas-skills': skills, './canvas-selection': selection })
const gen = (id, extra = {}, data = {}) => ({ id, type: 'generation', selected: true, position: { x: 0, y: 0 }, data: { kind: 'image', title: `画面 ${id}`, prompt: `创作要求 ${id}`, model: 'image-model', ratio: '16:9', quality: 'high', count: 1, seconds: 5, voice: 'voice', format: 'mp3', references: [], skills: [], task: null, results: [], text: '', ...data }, ...extra })
const edge = (source, target) => ({ id: `edge:${source}:${target}`, source, target })
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
const elements = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(elements)]
const textOf = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(textOf).join('')
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('selected prompts and reference settings become editable ordered steps without touching the board', () => {
  const nodes = freeze([gen('later', {}, { kind: 'video', prompt: '生成跟拍视频', seconds: 8 }), gen('first', {}, { prompt: '先生成产品图片' }), gen('outside', { selected: false }, { prompt: '不属于本次选择' })])
  const edges = freeze([edge('first', 'later'), edge('outside', 'first')])
  const result = createSelectionSkillDraft(nodes, edges, undefined, [{ id: 'image-model', name: '可用模型名' }])
  assert.equal(result.stepCount, 2)
  assert.equal(result.connectionCount, 1)
  assert.ok(result.draft.instructions.indexOf('先生成产品图片') < result.draft.instructions.indexOf('生成跟拍视频'))
  assert.match(result.draft.instructions, /步骤 1 → 步骤 2/)
  assert.match(result.draft.instructions, /模型：可用模型名/)
  assert.match(result.draft.instructions, /时长：8 秒/)
  assert.match(result.draft.instructions, /比例：16:9/)
  assert.doesNotMatch(result.draft.instructions, /不属于本次选择/)
  assert.match(result.warnings.join('\n'), /未选中节点/)
  assert.equal(nodes[1].data.prompt, '先生成产品图片')
  assert.equal(skills.canvasSkillAssetInput(result.draft).data.prompt, skills.canvasSkillDraftPrompt(result.draft))
})

test('explicit node IDs override live selection and selected groups include nested children once', () => {
  const nodes = [gen('outside'), { id: 'group', type: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', title: '组' } }, { id: 'nested', type: 'group', parentId: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', title: '子组' } }, gen('child', { parentId: 'nested', selected: false })]
  const result = createSelectionSkillDraft(nodes, [], ['group', 'child'])
  assert.equal(result.nodeCount, 3)
  assert.equal(result.stepCount, 1)
  assert.match(result.draft.instructions, /创作要求 child/)
  assert.doesNotMatch(result.draft.instructions, /创作要求 outside/)
  assert.throws(() => createSelectionSkillDraft(nodes, [], ['deleted']), /不存在/)
  assert.throws(() => createSelectionSkillDraft(nodes, [], []), /至少选择/)
})

test('runtime IDs, account fields, output URLs and attached skill text never enter the reusable draft', () => {
  const nodes = [gen('private-node-id', {}, { prompt: '保持构图', task: { id: 'secret-task-id', phase: 'success', startedAt: 1 }, userId: 'private-owner-id', references: [{ id: 'asset', url: 'https://private.example/reference?token=reference-secret', title: '引用', mediaKind: 'image' }], skills: [{ id: 'hidden-skill-id', title: '旧技能', prompt: '不应复制的旧技能指令' }], results: [{ url: 'https://private.example/result?token=result-secret', mediaKind: 'image' }], text: '私有生成结果', resultSource: { runId: 'private-run', assetId: 'private-asset' } }), { id: 'media-private-id', type: 'media', selected: true, position: { x: 0, y: 0 }, data: { title: '角色参考', kind: 'asset', media: { id: 'private-asset-id', libraryAssetId: 'private-library-id', title: '角色', mediaKind: 'image', url: 'https://private.example/media?token=media-secret' } } }]
  nodes[0].data.title = '产品镜头'
  const result = createSelectionSkillDraft(nodes, [edge('media-private-id', 'private-node-id')])
  const serialized = JSON.stringify(result.draft)
  for (const secret of ['secret-task-id', 'private-owner-id', 'reference-secret', 'result-secret', 'media-secret', 'hidden-skill-id', 'private-run', 'private-asset', 'private-node-id', '不应复制的旧技能指令', '私有生成结果']) assert.ok(!serialized.includes(secret), secret)
  assert.match(result.draft.instructions, /参考素材 1 → 步骤 1/)
  assert.match(result.draft.instructions, /使用时重新提供/)
  assert.match(result.warnings.join('\n'), /附加技能/)
})

test('links written into prompts are visibly replaced while the original node remains intact', () => {
  const prompt = '观察 https://example.test/a?token=secret 和 /media/image.png?token=secret2，然后保持色彩。'
  const node = gen('one', {}, { prompt })
  const result = createSelectionSkillDraft([node], [])
  assert.doesNotMatch(result.draft.instructions, /secret|example\.test|\/media\//)
  assert.match(result.draft.instructions, /使用时重新提供链接/)
  assert.match(result.draft.instructions, /然后保持色彩/)
  assert.match(result.warnings.join('\n'), /文本中的链接已替换/)
  assert.equal(node.data.prompt, prompt)
})

test('cycles, empty prompts and Agent nodes are explained without claiming executable workflows', () => {
  const nodes = [gen('a'), gen('b', {}, { prompt: '' }), { id: 'agent', type: 'agent', selected: true, position: { x: 0, y: 0 }, data: { kind: 'agent', prompt: '私有 Agent 历史', runId: 'private-run-id' } }]
  const result = createSelectionSkillDraft(nodes, [edge('a', 'b'), edge('b', 'a')])
  assert.equal(result.stepCount, 2)
  assert.match(result.warnings.join('\n'), /循环/)
  assert.match(result.warnings.join('\n'), /提示词为空/)
  assert.match(result.warnings.join('\n'), /Agent 节点/)
  assert.match(result.draft.usage, /不会重建或自动执行/)
  assert.doesNotMatch(JSON.stringify(result.draft), /私有 Agent 历史|private-run-id/)
})

test('overlong multi-step drafts keep their complete endings and cannot save until edited', () => {
  const ending = '末尾必须保留的交付要求'
  const result = createSelectionSkillDraft([gen('a', {}, { prompt: '字'.repeat(4050) + ending })], [])
  assert.ok(result.promptLength > 4000)
  assert.ok(result.draft.instructions.includes(ending))
  assert.match(result.warnings.join('\n'), /完整保留.*超过 4000.*不会自动截断/)
  assert.throws(() => skills.canvasSkillAssetInput(result.draft), /超过 4000/)
})

function hookState({ effects = false } = {}) {
  const slots = []; let cursor = 0; let pending = []
  return {
    begin() { cursor = 0; pending = [] },
    flush() { pending.forEach(fn => fn()) },
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
      useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index] },
      useMemo: fn => fn(), useCallback: fn => fn,
      useEffect(fn, deps) { if (!effects) return; const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) { pending.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() } }) } },
    },
  }
}

test('legacy and multi-node actions both open a captured editor without creating an asset', async () => {
  const hooks = hookState()
  let legacyWrites = 0
  const store = { projectId: 'project', projectMeta: {}, hydrated: true, viewport: {}, nodes: [gen('a'), gen('b', { selected: false })], edges: [], closeOverlays() {}, setNotice() {} }
  const useCanvasStore = selector => selector(store); useCanvasStore.getState = () => store
  const Dialog = () => null, Provider = () => null
  const module = sourceModule('../components/free-canvas/canvas-editor.tsx', {
    react: hooks.react, 'next/link': () => null,
    '@xyflow/react': { ReactFlowProvider: () => null, useReactFlow: () => ({ screenToFlowPosition: point => point, fitView() {} }) },
    '@/lib/studio/store': { useStudio: () => ({ state: { user: { id: 'account' }, models: [], sessionSettings: {} } }) },
    '@/lib/studio/studio-models': { defaultGenerationDefaults: () => ({}) },
    './asset-reference': {}, './board-codec': {}, './canvas-context': { CanvasActionsProvider: Provider }, './canvas-asset-library': {}, './canvas-skill-dialog': {},
    './canvas-selection-skill-dialog': { CanvasSelectionSkillDialog: Dialog }, './canvas-selection-skill': { createSelectionSkillDraft },
    './canvas-chrome': {}, './canvas-flow': {}, './canvas-position': {}, './canvas-menu': {}, './canvas-persistence': {}, './canvas-store': { useCanvasStore }, './node-factory': {}, './use-agent-actions': { useAgentActions: () => ({}) },
    './use-generation-actions': { useGenerationActions: () => ({ saveSkillFromNode: async () => { legacyWrites++ } }) }, './use-work-handoff': { useWorkHandoff() {} },
    './use-canvas-selection-actions': { useCanvasSelectionActions: () => ({ saveSelectionResults() {}, draftAgentFromSelection() {}, exportSelection() {}, dialogs: null }) },
  })
  hooks.begin()
  const Workspace = module.CanvasEditor({ projectId: 'project', project: {}, loadError: null }).props.children.type
  const render = () => { hooks.begin(); return Workspace() }
  let tree = render()
  tree.props.value.createSkillFromSelection(['b'])
  tree = render()
  const first = elements(tree).find(node => node.type === Dialog)
  assert.match(first.props.session.selection.draft.instructions, /创作要求 b/)
  assert.doesNotMatch(first.props.session.selection.draft.instructions, /创作要求 a/)
  store.nodes[1].data.prompt = '后续修改不得覆写已打开草稿'
  assert.doesNotMatch(first.props.session.selection.draft.instructions, /后续修改/)
  await tree.props.value.saveSkillFromNode('a')
  tree = render()
  const second = elements(tree).find(node => node.type === Dialog)
  assert.match(second.props.session.selection.draft.instructions, /创作要求 a/)
  assert.notEqual(second.key, first.key, 'new capture remounts the controlled editor')
  assert.equal(legacyWrites, 0)
})

function dialogHarness(create) {
  const hooks = hookState({ effects: true })
  let account = 'account'; let closed = 0
  const notices = [], calls = []
  const meta = {}
  const store = { projectId: 'project', projectMeta: meta, hydrated: true, setNotice: notice => notices.push(notice) }
  const useCanvasStore = selector => selector(store); useCanvasStore.getState = () => store
  const Editor = () => null
  const session = { projectId: 'project', projectMeta: meta, accountId: 'account', selection: createSelectionSkillDraft([gen('a')], []) }
  const { CanvasSelectionSkillDialog } = sourceModule('../components/free-canvas/canvas-selection-skill-dialog.tsx', {
    react: hooks.react, '@/lib/studio/account-api': { createLibraryAsset: async input => { calls.push(input); return create ? create(input) : { id: 'saved' } } }, '@/lib/studio/canvas-skills': skills,
    '@/lib/studio/store': { useStudio: () => ({ state: { user: { id: account } } }) }, './canvas-skill-editor': { CanvasSkillEditor: Editor }, './canvas-store': { useCanvasStore },
  }, { document: { activeElement: null }, HTMLElement: class {} })
  const close = () => { closed++ }
  function render() { hooks.begin(); const tree = CanvasSelectionSkillDialog({ session, onClose: close }); hooks.flush(); return tree }
  const save = draft => elements(render()).find(node => node.type === Editor).props.onSave(draft ?? session.selection.draft)
  return { render, save, calls, notices, store, session, setAccount(value) { account = value }, get closed() { return closed } }
}

test('saving requires explicit edited draft, blocks rapid repeats and retains errors for retry', async () => {
  const pending = deferred()
  const harness = dialogHarness(() => pending.promise)
  harness.render()
  assert.equal(harness.calls.length, 0)
  const edited = { ...harness.session.selection.draft, instructions: '用户确认后的简洁指令' }
  harness.save(edited); harness.save(edited)
  assert.equal(harness.calls.length, 1)
  assert.match(harness.calls[0].data.prompt, /用户确认后的简洁指令/)
  pending.reject(new Error('Synthetic save failed'))
  await settle()
  assert.equal(harness.closed, 0)
  assert.match(textOf(harness.render()), /Synthetic save failed/)
})

test('changed board or account blocks saving and late responses cannot announce success in another scope', async () => {
  const before = dialogHarness()
  before.render(); before.setAccount('other'); before.save()
  assert.equal(before.calls.length, 0)
  const pending = deferred()
  const late = dialogHarness(() => pending.promise)
  late.render(); late.save()
  late.store.projectMeta = {}
  pending.resolve({ id: 'saved' })
  await settle()
  assert.deepEqual(late.notices, [])
  assert.equal(late.closed, 0)
})

test('a confirmed successful save creates a normal v2 skill and closes once', async () => {
  const harness = dialogHarness()
  harness.render(); harness.save()
  await settle()
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls[0].source, 'canvas-skill')
  assert.equal(harness.calls[0].data.skillVersion, 2)
  assert.equal(harness.closed, 1)
  assert.equal(harness.notices.length, 1)
})
