import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, mocks = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { console, setTimeout, clearTimeout, URL })(name => name in mocks ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const helper = sourceModule('../lib/studio/canvas-skills.ts')
const plain = value => JSON.parse(JSON.stringify(value))
const asset = (id, prompt = '保持连续镜头') => ({ id, title: `技能 ${id}`, kind: 'text', source: 'canvas-skill', tags: ['技能'], data: { skillVersion: 1, prompt } })
const structuredDraft = () => ({ title: '连续镜头检查', summary: '保持产品一致', scenarios: '产品跨多个镜头时', usage: '先核对参考图，再逐镜检查', output: '输出问题与修改建议', instructions: '保留已确认的产品颜色，不虚构缺失信息。' })

test('structured descriptions are persisted in the one executable prompt and recover without duplication', () => {
  const draft = structuredDraft()
  const input = helper.canvasSkillAssetInput(draft)
  assert.equal(input.kind, 'text')
  assert.equal(input.source, 'canvas-skill')
  assert.equal(input.data.skillVersion, 2)
  for (const key of ['summary', 'scenarios', 'usage', 'output', 'instructions']) assert.ok(input.data.prompt.includes(draft[key]))
  const saved = { id: 'structured', ...input }
  assert.deepEqual(plain(helper.canvasSkillDraftOf(saved)), draft)
  assert.equal(helper.canvasSkillOf(saved).prompt, input.data.prompt)
  assert.equal(helper.canvasSkillAssetInput(helper.canvasSkillDraftOf(saved)).data.prompt, input.data.prompt)
})

test('legacy and stale editor metadata never alter the saved executable prompt', () => {
  const legacy = asset('legacy', '旧指令\n## 保持原样\n不能重复加栏目')
  const recovered = helper.canvasSkillDraftOf(legacy)
  assert.equal(helper.canvasSkillDraftPrompt(recovered), legacy.data.prompt)
  const saved = { id: 'stale', ...helper.canvasSkillAssetInput(structuredDraft()) }
  saved.data.skillDraft.instructions = '这段过期元数据不能取代实际指令'
  assert.equal(helper.canvasSkillDraftPrompt(helper.canvasSkillDraftOf(saved)), saved.data.prompt)
  const malformed = { ...saved, data: { ...saved.data, skillDraft: { instructions: 42 } } }
  assert.equal(helper.canvasSkillDraftPrompt(helper.canvasSkillDraftOf(malformed)), saved.data.prompt)
})

test('all descriptions and section headings count toward the 4000-character execution limit', () => {
  const exact = { ...helper.emptyCanvasSkillDraft(), title: '边界', instructions: '字'.repeat(4000) }
  assert.equal(helper.canvasSkillAssetInput(exact).data.prompt.length, 4000)
  const over = { ...exact, summary: '说明' }
  assert.ok(helper.canvasSkillDraftPrompt(over).length > 4000)
  assert.throws(() => helper.canvasSkillAssetInput(over), /超过 4000/)
  assert.throws(() => helper.canvasSkillAssetInput({ ...exact, instructions: ' ' }), /技能指令/)
  assert.throws(() => helper.canvasSkillAssetInput({ ...exact, title: '多行\n名称' }), /单行/)
  assert.throws(() => helper.canvasSkillAssetInput({ ...exact, summary: 'x'.repeat(241) }), /240/)
})

test('SKILL.md roundtrip preserves multiline requirements, quotes and inert Markdown or code', () => {
  const draft = { ...structuredDraft(), summary: '检查“产品”与 "镜头"', usage: '逐镜检查\n保留参考', instructions: '# 指令里的标题\n\n## 简介\n不要把此处误作元数据。\n```js\nalert("示例代码，不执行")\n```\n<script>alert(1)</script>' }
  const markdown = helper.exportCanvasSkillMarkdown(draft)
  assert.deepEqual(plain(helper.importCanvasSkillMarkdown(markdown)), draft)
  assert.equal(helper.canvasSkillAssetInput(helper.importCanvasSkillMarkdown(markdown)).data.prompt, helper.canvasSkillDraftPrompt(draft))
  assert.deepEqual(plain(helper.importCanvasSkillMarkdown('\uFEFF' + markdown.replaceAll('\n', '\r\n'), 'skill.MD')), draft)
})

test('plain Markdown and common scalar frontmatter import as text without package execution', () => {
  assert.equal(helper.importCanvasSkillMarkdown('# 画面检查\n\n检查颜色。').title, '画面检查')
  assert.equal(helper.importCanvasSkillMarkdown('检查颜色。').title, '导入的技能')
  const imported = helper.importCanvasSkillMarkdown('---\nname: "场景校验"\ndescription: >\n  检查场景\n  与镜头\ntools: [shell]\nscripts:\n  - run.sh\n---\n请核对场景光线。')
  assert.equal(imported.summary, '检查场景 与镜头')
  assert.equal(imported.instructions, '请核对场景光线。')
  assert.doesNotMatch(helper.canvasSkillDraftPrompt(imported), /run\.sh|shell/)
})

test('bad or oversized imports fail explicitly instead of silently truncating instructions', () => {
  assert.throws(() => helper.importCanvasSkillMarkdown('x', 'skills.zip'), /SKILL.md/)
  assert.throws(() => helper.importCanvasSkillMarkdown('x'.repeat(65537)), /64 KB/)
  assert.throws(() => helper.importCanvasSkillMarkdown('x\u0000'), /非文本/)
  assert.throws(() => helper.importCanvasSkillMarkdown('---\nname: x'), /分隔线/)
  assert.throws(() => helper.importCanvasSkillMarkdown('---\nname: a\nname: b\n---\nx'), /重复/)
  assert.throws(() => helper.importCanvasSkillMarkdown('---\nname: {object: true}\n---\nx'), /对象或列表/)
  assert.throws(() => helper.importCanvasSkillMarkdown('---\nname: "bad\\u0000"\n---\nx'), /非文本/)
  assert.throws(() => helper.importCanvasSkillMarkdown('# 空技能\n\n'), /技能指令/)
  assert.throws(() => helper.importCanvasSkillMarkdown('# 超长\n\n' + 'x'.repeat(4001)), /超过 4000/)
})

test('skill editor server rendering keeps imported HTML inert and labels the full execution limit', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { CanvasSkillEditor } = sourceModule('../components/free-canvas/canvas-skill-editor.tsx', { '@/lib/studio/canvas-skills': helper })
  const html = renderToStaticMarkup(React.createElement(CanvasSkillEditor, { initialDraft: { ...structuredDraft(), instructions: '<script>alert(1)</script>' }, saving: false, onCancel() {}, onSave() {} }))
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /完整执行指令/)
  assert.match(html, /4000 字符/)
  assert.match(html, /SKILL.md 预览/)
})

test('library creation uses the existing text asset API, blocks duplicate saves and retains a failed draft', async () => {
  const hooks = []; let cursor = 0; let fail = true; let reloads = 0
  const calls = []
  const Editor = () => null
  const module = sourceModule('../components/free-canvas/canvas-skill-library.tsx', {
    react: {
      useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }] },
      useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index] },
    },
    '@/lib/studio/canvas-skills': helper,
    '@/lib/studio/account-api': { createLibraryAsset: async input => { calls.push(plain(input)); if (fail) throw new Error('Synthetic save failure') }, deleteLibraryAsset() {} },
    '@/lib/studio/use-account-data': { useLibraryAssets: () => ({ assets: [], state: 'ready', reload: async () => { reloads++ } }) },
    './canvas-skill-editor': { CanvasSkillEditor: Editor, downloadCanvasSkill() {} },
  })
  const render = () => { cursor = 0; return module.CanvasSkillLibrary({}) }
  const elements = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(elements)]
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(text).join('')
  elements(render()).find(node => node.type === 'button' && text(node).includes('新建技能')).props.onClick()
  const editor = elements(render()).find(node => node.type === Editor)
  const draft = structuredDraft()
  editor.props.onSave(draft); editor.props.onSave(draft)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].source, 'canvas-skill')
  assert.equal(calls[0].data.prompt, helper.canvasSkillDraftPrompt(draft))
  assert.ok(elements(render()).some(node => node.type === Editor), 'editor survives a failed save')
  assert.match(text(render()), /技能保存失败/)
  assert.equal(reloads, 0)
  fail = false
  elements(render()).find(node => node.type === Editor).props.onSave(draft)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.length, 2)
  assert.equal(reloads, 1)
  assert.equal(elements(render()).some(node => node.type === Editor), false)
})

test('only explicit instruction assets are selectable; invalid content is rejected', () => {
  assert.equal(helper.canvasSkillOf({ ...asset('a'), kind: 'image' }), null)
  assert.equal(helper.canvasSkillOf({ ...asset('a'), source: 'generation', tags: [], data: { prompt: '普通文本生成结果' } }), null)
  assert.equal(helper.canvasSkillOf(asset('a', '  ')), null)
  assert.equal(helper.canvasSkillOf(asset('a', 'x'.repeat(4001))), null)
  assert.deepEqual(plain(helper.canvasSkillOf(asset('a', '  构图  '))), { id: 'a', title: '技能 a', prompt: '构图' })
})

test('selection toggles without duplication and enforces eight skills', () => {
  const skill = helper.canvasSkillOf(asset('a'))
  assert.equal(helper.toggleCanvasSkill([skill], skill).length, 0)
  const selected = Array.from({ length: 8 }, (_, index) => helper.canvasSkillOf(asset(String(index))))
  assert.throws(() => helper.toggleCanvasSkill(selected, skill), /最多选择 8/)
  assert.equal(helper.toggleCanvasSkill(selected, selected[0]).length, 7)
})

test('resolution reads later pages and uses current content in selection order', async () => {
  const pages = []
  const resolved = await helper.resolveCanvasSkills(['b', 'a', 'b'], async page => { pages.push(page); return { assets: page === 1 ? [asset('a', '更新的指令')] : [asset('b')], total: 2 } })
  assert.deepEqual(pages, [1, 2])
  assert.deepEqual(plain(resolved.map(item => item.id)), ['b', 'a'])
  assert.match(helper.composeSkillPrompt('  拍摄海岸  ', resolved), /^拍摄海岸\n\n【技能：技能 b】/)
  assert.match(helper.composeSkillPrompt('任务', resolved), /更新的指令/)
})

test('deleted or unauthorized skills fail before a task can be submitted', async () => {
  await assert.rejects(helper.resolveCanvasSkills(['gone'], async () => ({ assets: [], total: 0 })), /已删除/)
  await assert.rejects(helper.resolveCanvasSkills(['a'], async () => { throw new Error('403') }), /403/)
  assert.deepEqual(plain(await helper.resolveCanvasSkills([], () => { throw new Error('unnecessary request') })), [])
})

function generationHarness(library) {
  const calls = []
  const node = { id: 'node', type: 'generation', data: { kind: 'text', title: '文案', prompt: '写片头', model: 'text', skills: [helper.canvasSkillOf(asset('skill', '旧指令'))], references: [], task: null } }
  const state = { projectId: 'canvas', projectMeta: {}, hydrated: true, revision: 1, savedRevision: 1, nodes: [node], edges: [], patchNodes(patches) { for (const patch of patches) Object.assign(node.data, patch.data) } }
  const useCanvasStore = selector => selector(state); useCanvasStore.getState = () => state
  const generation = { tasks: [], createText: async input => { calls.push(input); return { id: 'task' } } }
  const hook = sourceModule('../components/free-canvas/use-generation-actions.ts', {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useRef: value => ({ current: value }), useEffect: () => {} },
    '@/lib/studio/account-api': { listLibraryAssets: library },
    '@/lib/studio/canvas-skills': helper,
    '@/lib/studio/generation-api': { newClientRequestId: () => 'synthetic-request' },
    '@/lib/studio/generation-store': { useGeneration: () => generation },
    '@/lib/studio/reference-assets': { isSubmittableReferenceUrl: () => true },
    '@/lib/studio/studio-models': { filterModelsByCapability: models => models },
    '@/lib/studio/store': { useStudio: () => ({ state: { models: [], user: { id: 'synthetic-account' } }, estimateCredits: () => 0 }) },
    './canvas-persistence': { flushCanvasSave: async () => {} },
    './canvas-store': { useCanvasStore },
  })
  return { actions: hook.useGenerationActions(), calls, node }
}

test('real generation hook passes resolved skill instructions to task API', async () => {
  const harness = generationHarness(async () => ({ assets: [asset('skill', '新的指令：限制100字')], total: 1 }))
  await harness.actions.submitNode('node')
  assert.equal(harness.calls.length, 1)
  assert.match(harness.calls[0].prompt, /新的指令：限制100字/)
  assert.doesNotMatch(harness.calls[0].prompt, /旧指令/)
})

test('real generation hook receives every structured requirement from the saved skill', async () => {
  const draft = structuredDraft()
  const harness = generationHarness(async () => ({ assets: [{ id: 'skill', ...helper.canvasSkillAssetInput(draft) }], total: 1 }))
  await harness.actions.submitNode('node')
  assert.equal(harness.calls.length, 1)
  for (const key of ['summary', 'scenarios', 'usage', 'output', 'instructions']) assert.ok(harness.calls[0].prompt.includes(draft[key]))
  assert.doesNotMatch(harness.calls[0].prompt, /旧指令/)
})

test('real generation hook blocks missing skills and rapid double-submit', async () => {
  const missing = generationHarness(async () => ({ assets: [], total: 0 }))
  await missing.actions.submitNode('node')
  assert.equal(missing.calls.length, 0)
  assert.equal(missing.node.data.task.phase, 'error')
  let finish
  const harness = generationHarness(() => new Promise(resolve => { finish = resolve }))
  const first = harness.actions.submitNode('node')
  await harness.actions.submitNode('node')
  finish({ assets: [asset('skill')], total: 1 }); await first
  assert.equal(harness.calls.length, 1)
})

function agentHarness({ saved = true, submit } = {}) {
  const calls = []
  const run = { id: 'run', status: 'awaiting_approval', tasks: [], pointsCost: 10 }
  const node = { id: 'agent', type: 'agent', data: { prompt: '制作海岸分镜', skills: [helper.canvasSkillOf(asset('skill'))], runStatus: null, runId: null, steps: [] } }
  const state = { projectId: 'canvas', hydrated: true, revision: 1, savedRevision: saved ? 1 : 0, nodes: [node], edges: [], patchNodes(patches) { for (const patch of patches) Object.assign(node.data, patch.data) }, setNotice() {} }
  const useCanvasStore = selector => selector(state); useCanvasStore.getState = () => state
  const hook = sourceModule('../components/free-canvas/use-agent-actions.ts', {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {} },
    '@/lib/studio/generation-api': { newClientRequestId: () => 'same-request' },
    '@/lib/studio/account-api': {},
    '@/lib/studio/generation-store': { useGeneration: () => ({ runAgent: async input => { calls.push(plain(input)); if (submit) return submit(input); return run }, getAgent: async () => run }) },
    './canvas-persistence': { flushCanvasSave: async () => {}, syncRemoteBoard: async () => {} },
    './agent-delivery': {},
    './canvas-store': { useCanvasStore },
    './use-generation-actions': { errorMessageOf: error => error.message },
  })
  return { actions: hook.useAgentActions(), calls, node, state }
}

test('real Agent hook carries skill IDs and blocks execution if board save was not acknowledged', async () => {
  const valid = agentHarness()
  await valid.actions.startAgent('agent')
  assert.deepEqual(valid.calls[0].skillIds, ['skill'])
  assert.equal(valid.calls[0].prompt, '制作海岸分镜')
  const invalid = agentHarness({ saved: false })
  await invalid.actions.startAgent('agent')
  assert.equal(invalid.calls.length, 0)
  assert.equal(invalid.node.data.runStatus, 'failed')
  assert.match(invalid.node.data.failure, /画布尚未保存/)
})

test('unconfirmed Agent retry keeps the original selected skills, assets and request identity', async () => {
  const harness = agentHarness({ submit: async () => { throw Object.assign(new Error('network outcome unknown'), { isIndeterminate: true }) } })
  await harness.actions.startAgent('agent')
  assert.equal(harness.node.data.runStatus, 'unconfirmed')
  harness.node.data.skills = [helper.canvasSkillOf(asset('new-skill'))]
  harness.state.nodes.push({ id: 'new-media', type: 'media', data: { title: 'new', media: { id: 'another-asset' } } })
  await harness.actions.startAgent('agent')
  assert.deepEqual(harness.calls[1], harness.calls[0])
})

test('normalized generation-store Agent errors retain the same charge identity for recovery', async () => {
  const harness = agentHarness({ submit: async () => { throw { message: 'Synthetic lost response', indeterminate: true, outcome: 'unavailable' } } })
  await harness.actions.startAgent('agent')
  assert.equal(harness.node.data.runStatus, 'unconfirmed')
  assert.equal(harness.node.data.clientRequestId, 'same-request')
  await harness.actions.startAgent('agent')
  assert.deepEqual(harness.calls[1], harness.calls[0])
})

test('board roundtrip preserves Agent skill selection, collapse and uncertain submission', () => {
  const types = sourceModule('../components/free-canvas/types.ts')
  const codec = sourceModule('../components/free-canvas/board-codec.ts', { './types': types, './node-factory': { GENERATION_TITLES: {} } })
  const node = { id: 'agent', type: 'agent', position: { x: 20, y: 40 }, data: { kind: 'agent', title: '助手', prompt: '任务', skills: [helper.canvasSkillOf(asset('skill'))], collapsed: true, runStatus: 'unconfirmed', runId: null, clientRequestId: 'stable', submission: { prompt: '原始任务', skillIds: ['skill'], assetIds: [] }, steps: [], context: [], pointsCost: null } }
  const written = codec.writeBoard([node], [])
  const restored = codec.readBoard(written).nodes[0]
  assert.deepEqual(plain(restored.data.skills), plain(node.data.skills))
  assert.deepEqual(plain(restored.data.submission), node.data.submission)
  assert.equal(restored.data.collapsed, true)
})

function saveHarness(request) {
  const state = { projectId: 'canvas', hydrated: true, revision: 2, savedRevision: 1, saveStatus: 'dirty', updatedAt: '2026-01-01T00:00:00.000Z', projectMeta: {}, title: 'Board', nodes: [], edges: [], viewport: {}, setSaveStatus(status, error) { state.saveStatus = status; state.saveError = error }, markSaved(updatedAt, revision) { state.updatedAt = updatedAt; state.savedRevision = revision; state.saveStatus = state.revision === revision ? 'saved' : 'dirty' } }
  class ApiError extends Error {}
  const persistence = sourceModule('../components/free-canvas/canvas-persistence.ts', {
    '@/lib/studio/api': { request, StudioApiError: ApiError },
    './board-codec': { writeBoard: () => ({ nodes: [], connections: [] }), writeViewport: value => value },
    './canvas-store': { useCanvasStore: { getState: () => state } },
  })
  return { state, persistence, ApiError }
}

test('actual canvas persistence never marks a missing server version as saved', async () => {
  const harness = saveHarness(async () => ({ data: {} }))
  await assert.rejects(harness.persistence.flushCanvasSave(), /未确认画布版本/)
  assert.equal(harness.state.saveStatus, 'error')
  assert.notEqual(harness.state.revision, harness.state.savedRevision)
})

test('actual canvas persistence keeps unsaved conflict and failure state', async () => {
  const conflict = saveHarness(async () => { throw Object.assign(new conflict.ApiError('conflict'), { status: 409 }) })
  await conflict.persistence.flushCanvasSave()
  assert.equal(conflict.state.saveStatus, 'conflict')
  assert.notEqual(conflict.state.revision, conflict.state.savedRevision)
  const failure = saveHarness(async () => { throw new Error('offline') })
  await assert.rejects(failure.persistence.flushCanvasSave(), /offline/)
  assert.equal(failure.state.saveStatus, 'error')
  assert.notEqual(failure.state.revision, failure.state.savedRevision)
})

test('actual canvas persistence waits for edits made during save before confirming return', async () => {
  let finish, calls = 0
  const harness = saveHarness(async () => { calls++; if (calls === 1) return new Promise(resolve => { finish = resolve }); return { data: { ack: { updatedAt: '2026-01-01T00:00:02.000Z' } } } })
  const saving = harness.persistence.flushCanvasSave()
  harness.state.revision = 3
  finish({ data: { ack: { updatedAt: '2026-01-01T00:00:01.000Z' } } })
  await saving
  assert.equal(calls, 2)
  assert.equal(harness.state.savedRevision, 3)
  assert.equal(harness.state.saveStatus, 'saved')
})

const handoff = sourceModule('../lib/studio/work-handoff.ts')
function memoryStorage() { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } }
test('work handoff is account scoped, expires, and preserves audio kind', () => {
  const storage = memoryStorage(), entry = { id: 'work', title: 'Synthetic audio', kind: 'audio', src: '/api/reference-assets/audio' }
  handoff.writeWorkHandoff(storage, 'account-a', entry, 1000)
  assert.deepEqual(plain(handoff.takeWorkHandoff(storage, 'account-b', 1100)), [])
  assert.deepEqual(plain(handoff.takeWorkHandoff(storage, 'account-a', 1100)), [entry])
  assert.deepEqual(plain(handoff.takeWorkHandoff(storage, 'account-a', 1100)), [])
  handoff.writeWorkHandoff(storage, 'account-a', entry, 1000)
  assert.deepEqual(plain(handoff.takeWorkHandoff(storage, 'account-a', 1000 + 16 * 60 * 1000)), [])
  assert.throws(() => handoff.writeWorkHandoff(storage, 'account-a', { ...entry, src: 'javascript:alert(1)' }), /不可用/)
})

test('Agent sends only explicitly labelled library IDs, never generation log IDs or URLs', async () => {
  const harness = agentHarness()
  harness.state.nodes.push({ id: 'history', type: 'media', data: { title: 'History result', media: { id: 'generation-log-id' } } }, { id: 'library', type: 'media', data: { title: 'Owned library asset', media: { id: 'library-id', libraryAssetId: 'library-id' } } }, { id: 'project-media', type: 'media', data: { title: 'Project result', media: { id: '/api/reference-assets/result' } } })
  await harness.actions.startAgent('agent')
  assert.deepEqual(harness.calls[0].assetIds, ['library-id'])
})
