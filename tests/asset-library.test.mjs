import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/studio/asset-library.ts', import.meta.url), 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports })
const { filterAssetLibrary, assetLibraryCounts, selectVisibleAssets } = module.exports
const asset = (id, kind, category, createdAt, extra = {}) => ({ id, kind, category, createdAt, title: id, tags: [], referencedBy: [], ...extra })
const assets = [
  asset('山间清晨', 'image', 'scene', '2026-11-06'),
  asset('山间镜头', 'video', 'scene', '2026-11-05'),
  asset('人物 2', 'image', 'character', '2026-11-04', { tags: ['夏日'] }),
  asset('人物 10', 'character', undefined, '2026-11-03', { referencedBy: ['电影计划'] }),
  asset('环境音', 'audio', 'general', '2026-11-02'),
]
const ids = values => [...values].map(item => item.id)

test('asset media and usage filters combine without dropping search or changing source order', () => {
  const before = ids(assets)
  assert.deepEqual(ids(filterAssetLibrary(assets, { media: 'video', category: 'scene', search: ' 山间 ' })), ['山间镜头'])
  assert.deepEqual(ids(filterAssetLibrary(assets, { media: 'audio', category: 'scene' })), [])
  assert.deepEqual(ids(filterAssetLibrary(assets, { search: '夏日' })), ['人物 2'])
  assert.deepEqual(ids(filterAssetLibrary(assets, { search: '电影计划' })), ['人物 10'])
  assert.deepEqual(ids(filterAssetLibrary(assets, { sort: 'oldest' })), [...before].reverse())
  assert.deepEqual(ids(filterAssetLibrary(assets, { category: 'character', sort: 'name' })), ['人物 2', '人物 10'])
  assert.deepEqual(ids(assets), before)
})

test('counts treat legacy character assets as images while keeping their usage category', () => {
  const counts = JSON.parse(JSON.stringify(assetLibraryCounts(assets)))
  assert.deepEqual(counts.media, { all: 5, image: 3, video: 1, audio: 1 })
  assert.equal(counts.categories.character, 2)
  assert.equal(counts.categories.scene, 2)
  assert.equal(counts.categories.general, 1)
})

test('selecting filtered results retains other selections and respects the 100-item cap', () => {
  assert.deepEqual([...selectVisibleAssets(['other', 'a'], ['a', 'b'], true)], ['other', 'a', 'b'])
  assert.deepEqual([...selectVisibleAssets(['other', 'a', 'b'], ['a', 'b'], false)], ['other'])
  const current = Array.from({ length: 99 }, (_, index) => `old-${index}`)
  const selected = [...selectVisibleAssets(current, ['new-1', 'new-2'], true)]
  assert.equal(selected.length, 100)
  assert.deepEqual(selected.slice(0, 99), current)
  assert.equal(selected.at(-1), 'new-1')
})

function modalHarness(reduced = false) {
  const slots = [], effects = [], timers = new Map()
  let cursor = 0, timerId = 0, paused = 0, restored = 0
  const trigger = { focus() { restored++ } }
  const container = { focus() {}, querySelector: () => null, querySelectorAll: () => [{ pause() { paused++ } }] }
  const effect = (fn, deps) => {
    const index = cursor++, previous = slots[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() } })
  }
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useEffect: effect, useLayoutEffect: effect,
  }
  const jsx = (type, props) => ({ type, props })
  const document = { activeElement: trigger, querySelector: () => ({}), addEventListener() {}, removeEventListener() {} }
  const window = { matchMedia: () => ({ matches: reduced }), setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) } }
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': { createPortal: element => element },
    'lucide-react': {}, 'radix-ui': { Tooltip: {} }, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') }, '@/lib/studio/i18n': { useUiText: () => value => value },
  }
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../components/studio/ui.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', 'window', 'document', code)(name => { assert.ok(name in imports, name); return imports[name] }, module, module.exports, window, document)
  const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
  const onClose = () => {}
  return {
    render(open, title = 'preview', animated = true) {
      cursor = 0
      const tree = module.exports.Modal({ open, title, children: title + '-contents', onClose, motion: animated ? { backdropClassName: 'backdrop', surfaceClassName: 'surface', exitMs: 280, titleId: 'preview-title' } : undefined })
      const section = all(tree).find(node => node.type === 'section')
      if (section) section.props.ref.current = container
      effects.splice(0).forEach(fn => fn())
      return tree
    },
    finish() { for (const [id, fn] of timers) { timers.delete(id); fn() } },
    timers, all, get paused() { return paused }, get restored() { return restored },
  }
}

test('animated preview retains its contents on close, pauses media, and cancels stale removal when reopened', () => {
  const h = modalHarness()
  assert.equal(h.render(false), null)
  h.render(true, 'first'); h.render(true, 'first')
  const closing = h.render(false, 'cleared')
  assert.equal(closing.props.inert, true)
  assert.equal(closing.props['aria-hidden'], true)
  assert.ok(h.all(closing).some(node => node.props?.children === 'first-contents'))
  assert.equal(h.paused, 1); assert.equal(h.restored, 1); assert.equal(h.timers.size, 1)
  const reopened = h.render(true, 'second')
  assert.equal(h.timers.size, 0)
  assert.equal(reopened.props.inert, undefined)
  h.finish(); assert.ok(h.render(true, 'second'))
  h.render(false); h.finish()
  assert.equal(h.render(false), null)
})

test('reduced-motion dialogs close without a motion delay and existing non-animated dialogs remain immediate', () => {
  const reduced = modalHarness(true)
  reduced.render(true); reduced.render(true); reduced.render(false)
  assert.equal(reduced.timers.size, 0); assert.equal(reduced.render(false), null)
  const plain = modalHarness()
  plain.render(true, 'plain', false); plain.render(true, 'plain', false)
  assert.equal(plain.render(false, 'plain', false), null)
  assert.equal(plain.timers.size, 0)
})

test('asset menus finish their exit before opening a dialog and preserve default focus restoration on dismiss', () => {
  const module = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  const dropdown = Object.fromEntries(['Root', 'Trigger', 'Portal', 'Content', 'Item', 'Separator'].map(name => [name, 'Menu' + name]))
  const imports = {
    react: { useRef: value => ({ current: value }) }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': () => null, 'radix-ui': { DropdownMenu: dropdown }, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '@/lib/studio/i18n': { useUiText: () => value => value }, '@/lib/studio/reference-assets': { assetCategoryLabels: {} },
    '@/lib/studio/asset-library': {}, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    './ui': {}, './media-download-button': {}, './asset-library-motion.module.css': { default: {} },
    './asset-library-icons': { AssetIcons: new Proxy({}, { get: () => () => null }) },
  }
  const code = ts.transpileModule(readFileSync(new URL('../components/studio/asset-library-ui.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in imports, name); return imports[name] }, module, module.exports)
  let preview = 0, prevented = 0, focused = 0
  const tree = module.exports.AssetLibraryMenu({ asset: { title: 'fixture' }, onPreview: () => preview++, onRename() {}, onDelete() {} })
  const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
  const content = all(tree).find(node => node.type === 'MenuContent')
  const item = all(tree).find(node => node.type === 'MenuItem')
  all(tree).find(node => node.type === 'button').props.ref.current = { focus() { focused++ } }
  assert.equal(tree.props.modal, false)
  item.props.onSelect(); assert.equal(preview, 0)
  content.props.onCloseAutoFocus({ preventDefault() { prevented++ } })
  assert.equal(preview, 1); assert.equal(prevented, 1); assert.equal(focused, 1)
  content.props.onCloseAutoFocus({ preventDefault() { prevented++ } })
  assert.equal(preview, 1); assert.equal(prevented, 1)
  item.props.onSelect(); tree.props.onOpenChange(true)
  content.props.onCloseAutoFocus({ preventDefault() { prevented++ } })
  assert.equal(preview, 1); assert.equal(prevented, 1)
})
