import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function load(path, imports = {}) {
  const module = {exports: {}}
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  new Function('require', 'module', 'exports', code)(name => {assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]}, module, module.exports)
  return module.exports
}
const mentions = load('../lib/studio/prompt-references.ts')
const build = load('../lib/studio/video-references.ts').buildVideoReferences

test('mention lookup and insertion preserve Chinese text on both sides of the caret', () => {
  assert.deepEqual(mentions.referenceMentionQuery('让 @人物 保持微笑', 5), {start: 2, query: '人物'})
  const result = mentions.insertReferenceMention('让 @人物 保持微笑', 2, 5, 1)
  assert.equal(result.value, '让 @2  保持微笑')
  assert.equal(result.caret, 5)
  assert.equal(mentions.referenceMentionQuery('让 @1 保持微笑', 9), undefined)
  assert.deepEqual(mentions.referenceMentionQuery('@1 与 @', 6), {start: 5, query: ''})
})

test('picker numbering follows submitted files for every input mode', () => {
  const ref = (id, type = 'image') => ({id, name: id, type, url: `https://example.invalid/${id}`})
  const groups = {first: [ref('first')], last: [ref('last')], source: [ref('source', 'video')], references: [ref('library'), ref('upload'), ref('video', 'video'), ref('audio', 'audio')]}
  for (const mode of ['text', 'first', 'ends', 'mixed', 'references', 'edit']) {
    const expected = build({...groups, mode, maxReferences: 8}).map(item => item.id)
    assert.deepEqual(mentions.orderedPromptReferences(mode, groups).map(item => item.id), expected, mode)
  }
  assert.deepEqual(mentions.orderedPromptReferences('text', groups, false), [])
  assert.deepEqual(mentions.orderedPromptReferences('extend', groups), [])
})

test('duration slider submits only supported slots and cannot manufacture an in-between duration', () => {
  const jsx = (type, props) => ({type, props})
  const slider = load('../components/studio/video-duration-slider.tsx', {react: {useId: () => 'duration'}, 'react/jsx-runtime': {jsx, jsxs: jsx}}).VideoDurationSlider
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
  const changes = []
  const input = nodes(slider({value: '6 秒', options: ['4 秒', '6 秒', '8 秒'], onChange: value => changes.push(value)})).find(node => node.type === 'input')
  assert.equal(input.props.value, 1)
  assert.equal(input.props.max, 2)
  input.props.onChange({target: {value: '2'}})
  input.props.onChange({target: {value: '99'}})
  assert.deepEqual(changes, ['8 秒'])
  for (const options of [[], ['8 秒']]) assert.equal(nodes(slider({value: '8 秒', options, onChange() {}})).find(node => node.type === 'input').props.disabled, true)
})

test('mention keyboard completion consumes Enter and Escape while leaving IME input alone', () => {
  const slots = []; let cursor = 0; let value = ''
  const react = {useEffect() {}, useLayoutEffect() {}, useId: () => 'references', useRef: initial => {const i = cursor++; return slots[i] ||= {current: initial}}, useState: initial => {const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => slots[i] = typeof next === 'function' ? next(slots[i]) : next]}}
  const jsx = (type, props) => ({type, props})
  const component = load('../components/studio/prompt-reference-input.tsx', {react, 'react/jsx-runtime': {jsx, jsxs: jsx}, 'react-dom': {createPortal: node => node}, 'lucide-react': {}, '@/lib/studio/prompt-references': mentions}).PromptReferenceInput
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
  const original = globalThis.document; globalThis.document = {body: {}}
  try {
    const render = () => {cursor = 0; return nodes(component({id: 'prompt', value, onChange: next => value = next, references: [{id: 'first', name: '首帧', type: 'image'}, {id: 'second', name: '人物', type: 'image'}]}))}
    const textarea = () => render().find(node => node.type === 'textarea')
    textarea().props.onChange({target: {value: '@', selectionStart: 1}})
    const event = key => ({key, nativeEvent: {isComposing: false}, prevented: false, stopped: false, preventDefault() {this.prevented = true}, stopPropagation() {this.stopped = true}})
    textarea().props.onKeyDown(event('ArrowDown'))
    const enter = event('Enter'); textarea().props.onKeyDown(enter)
    assert.equal(value, '@2 '); assert.equal(enter.prevented, true)
    textarea().props.onChange({target: {value: '@', selectionStart: 1}})
    const ime = event('Enter'); ime.nativeEvent.isComposing = true; textarea().props.onKeyDown(ime)
    assert.equal(value, '@'); assert.equal(ime.prevented, false)
    const escape = event('Escape'); textarea().props.onKeyDown(escape)
    assert.equal(escape.prevented, true); assert.equal(escape.stopped, true)
    assert.equal(render().some(node => node.props?.role === 'listbox'), false)
  } finally {globalThis.document = original}
})
