import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { chineseLocale, englishText } from './helpers/locale.mjs'

const source = readFileSync(new URL('../components/studio/image-comparison-reference.tsx', import.meta.url), 'utf8')
const nodes = value => value && typeof value === 'object' ? [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = value => typeof value === 'string' ? value : value && typeof value === 'object' ? [value.props?.children].flat(Infinity).map(text).join('') : ''
function harness() {
  let cursor = 0
  const slots = [], pending = []
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial } },
    useCallback(fn) { return fn },
    useEffect(fn, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps.some((v, j) => v !== previous.deps[j])) pending.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
  }
  const imports = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_, name) => name }), '@/lib/studio/i18n': chineseLocale,
    './ui': new Proxy({}, { get: (_, name) => name }), './workspace-kit': { ReferencePicker: 'ReferencePicker' },
  }
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in imports, name); return imports[name] }, module, module.exports)
  const render = fn => { cursor = 0; pending.length = 0; const result = fn(); pending.splice(0).forEach(effect => effect()); return result }
  return { exports: module.exports, render, unmount() { slots.forEach(value => value?.cleanup?.()) } }
}

test('comparison opens a single-image picker, snapshots selection and never treats a video as an image', () => {
  const h = harness(), chosen = []
  const props = { image: null, onChange(image) { chosen.push(image); props.image = image }, library: { assets: [], libraryState: 'ready' } }
  const render = () => nodes(h.render(() => h.exports.ImageComparisonReference(props)))
  assert.ok(render().some(node => node.type === 'ControlButton' && text(node) === '从素材库选择'))
  assert.ok(render().some(node => node.type === 'ControlButton' && text(node) === '上传参考图'))
  render().find(node => node.type === 'ControlButton' && text(node) === '从素材库选择').props.onClick()
  assert.equal(render().find(node => node.type === 'Modal').props.open, true)
  const picker = render().find(node => node.type === 'ReferencePicker').props
  assert.equal(picker.maxReferences, 1); assert.equal(picker.replaceSelection, true)
  picker.onToggle('video', { id: 'video', kind: 'video', src: '/video.mp4', title: 'Video' })
  assert.equal(chosen.length, 0)
  picker.onToggle('asset', { id: 'asset', kind: 'image', src: '/owned-image.png', title: 'Original image' })
  assert.deepEqual(chosen[0], { id: 'asset', title: 'Original image', src: '/owned-image.png', source: 'library' })
  props.library.assets = []
  assert.ok(render().some(node => node.type === 'MediaThumb' && node.props.src === '/owned-image.png'))
  assert.equal(render().find(node => node.type === 'Modal').props.open, false)
  render().find(node => node.type === 'IconAction' && node.props.label === '移除对比参考图').props.onClick()
  assert.equal(props.image, null)
})

test('local references do not upload, reject unsupported or oversized files, and keep the previous image on cancellation', t => {
  const h = harness(), created = [], chosen = []
  t.mock.method(URL, 'createObjectURL', file => { created.push(file); return 'blob:comparison-fixture' })
  const props = { image: null, onChange(image) { chosen.push(image); props.image = image }, library: { assets: [] } }
  const render = () => nodes(h.render(() => h.exports.ImageComparisonReference(props)))
  const select = file => { const target = { files: file ? [file] : [], value: 'selected' }; render().find(node => node.type === 'input').props.onChange({ target }); assert.equal(target.value, '') }
  select({ name: 'reference.png', type: 'image/png', size: 1024 })
  assert.equal(created.length, 1); assert.equal(props.image.source, 'upload')
  select(); assert.equal(chosen.length, 1)
  select({ name: 'script.svg', type: 'image/svg+xml', size: 1024 })
  assert.equal(chosen.length, 1); assert.ok(render().some(node => node.props.role === 'alert'))
  select({ name: 'oversized.png', type: 'image/png', size: 13 * 1024 * 1024 })
  assert.equal(created.length, 1); assert.equal(props.image.src, 'blob:comparison-fixture')
  render().find(node => node.type === 'button' && node.props['aria-label'] === '放大对比参考图').props.onClick()
  assert.equal(render().find(node => node.type === 'Modal' && node.props.title === '预览对比参考图').props.open, true)
})

test('reference ownership survives workspace rerenders and releases local URLs on replacement, account changes and unmount', t => {
  const h = harness(), revoked = []
  t.mock.method(URL, 'revokeObjectURL', src => revoked.push(src))
  let owner = 'account-a'
  const render = () => h.render(() => h.exports.useImageComparisonReference(owner))
  const image = { id: 'local', title: 'Local', src: 'blob:first', source: 'upload' }
  render()[1](image); assert.deepEqual(render()[0], image); assert.deepEqual(render()[0], image)
  assert.deepEqual(revoked, [])
  render()[1]({ ...image, src: 'blob:second' }); render()
  assert.deepEqual(revoked, ['blob:first'])
  owner = 'account-b'; assert.equal(render()[0], null); render()
  assert.deepEqual(revoked, ['blob:first', 'blob:second'])
  render()[1]({ ...image, src: 'blob:third' }); render(); h.unmount()
  assert.deepEqual(revoked, ['blob:first', 'blob:second', 'blob:third'])
})

test('comparison actions are translated for the English interface', () => {
  assert.equal(englishText('上传参考图'), 'Upload reference')
  assert.equal(englishText('选择对比参考图'), 'Choose comparison reference')
})
