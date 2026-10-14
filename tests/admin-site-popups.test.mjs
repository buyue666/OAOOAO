import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
function compile(source, imports = {}) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
  const exports = {}
  new Function('require', 'exports', outputText)(name => {
    assert.ok(name in imports, `Unexpected runtime dependency: ${name}`)
    return imports[name]
  }, exports)
  return exports
}
const popupHelpers = compile(read('../lib/studio/site-popups.ts'))
const announcementHelpers = compile(read('../lib/studio/announcements.ts'))
const controls = Object.fromEntries(['ControlButton', 'StatusBadge', 'AdminCell', 'AdminDataPanel', 'AdminDrawer', 'AdminError', 'AdminField', 'AdminInput', 'AdminNotice', 'AdminPagination', 'AdminRow', 'AdminSelect', 'AdminStat', 'AdminTable', 'AdminTextarea', 'TableMessageRow', 'SitePopupCard'].map(name => [name, name]))
const icons = Object.fromEntries(['Eye', 'EyeOff', 'Pencil', 'Plus', 'RefreshCw', 'Save', 'Trash2'].map(name => [name, name]))
function all(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children, node.props?.footer].flat(Infinity).flatMap(all)] : [] }
function text(node) { return typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : '' }
const existing = { id: 'fixture-popup', title: '活动标题', content: '已有内容', imageUrl: 'https://example.test/banner.png', actionUrl: '/plans', buttonText: '查看详情', enabled: true, pages: ['home'], frequency: 'daily', startsAt: '2026-01-01T01:02:03.123Z', endsAt: '2027-01-01T01:02:03.456Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }

function fixture(item, options = {}) {
  const states = [], refs = [], writes = []
  let stateCursor = 0, refCursor = 0, saved = 0, closed = 0
  const react = {
    useState(initial) { const index = stateCursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
    useRef(initial) { return refs[refCursor++] ??= { current: initial } },
    useCallback: fn => fn, useEffect() {},
  }
  const module = compile(read('../components/studio/admin-site-popups.tsx') + '\nexport { SitePopupEditor, inputDate, localDate, popupStatus };', {
    react, 'lucide-react': icons,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/studio/api': { request: async (path, init) => { writes.push({ path, method: init.method, body: JSON.parse(init.body) }); if (options.wait) await options.wait; if (options.error) throw new Error(options.error); return { popup: { ...existing, ...JSON.parse(init.body) } } } },
    '@/lib/studio/announcements': announcementHelpers, '@/lib/studio/site-popups': popupHelpers,
    '@/components/site-popup-card': controls, './ui': controls, './admin-kit': { ...controls, useConfirm: () => ({ confirm() {} }), formatAdminDate: value => value, formatAdminNumber: String },
  })
  function render() { stateCursor = 0; refCursor = 0; return module.SitePopupEditor({ item, onClose: () => closed++, onSaved: () => saved++ }) }
  const find = name => all(render()).find(node => node.props?.name === name)
  return { module, render, writes, get saved() { return saved }, get closed() { return closed },
    set(name, value) { const node = find(name); node.props.onChange({ target: { value, checked: value } }) },
    submit: () => all(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    close: () => render().props.onClose(),
    button: label => all(render()).find(node => node.type === 'ControlButton' && text(node) === label),
    error: () => all(render()).filter(node => node.type === 'AdminNotice').map(text).join(''),
  }
}

test('new popup saves a disabled draft, with explicit empty URL/date fields', async () => {
  const f = fixture()
  f.set('title', ' 新活动 '); f.set('content', ' 活动内容 ')
  await f.submit()
  assert.equal(f.writes[0].method, 'POST')
  assert.equal(f.writes[0].body.enabled, false)
  assert.deepEqual(f.writes[0].body.pages, ['home', 'studio'])
  for (const field of ['imageUrl', 'actionUrl', 'startsAt', 'endsAt']) assert.equal(f.writes[0].body[field], null)
  assert.equal(f.saved, 1)
})

test('editing preserves untouched precise dates and clears emptied nullable fields', async () => {
  const same = fixture(existing); await same.submit()
  assert.equal(same.writes[0].body.startsAt, existing.startsAt); assert.equal(same.writes[0].body.endsAt, existing.endsAt)
  const cleared = fixture(existing)
  for (const field of ['imageUrl', 'actionUrl', 'startsAt', 'endsAt']) cleared.set(field, '')
  await cleared.submit()
  assert.equal(cleared.writes[0].method, 'PATCH')
  for (const field of ['imageUrl', 'actionUrl', 'startsAt', 'endsAt']) assert.equal(cleared.writes[0].body[field], null)
})

test('unsafe action and image addresses never send a write', async () => {
  for (const [field, value] of [['actionUrl', 'javascript:alert(1)'], ['actionUrl', '//evil.test'], ['imageUrl', 'http://example.test/a.png'], ['imageUrl', 'https://example.test/a.svg'], ['imageUrl', 'https://user:secret@example.test/a.png']]) {
    const f = fixture(existing); f.set(field, value); await f.submit()
    assert.equal(f.writes.length, 0, field + ': ' + value); assert.ok(f.error())
  }
})

test('empty content and image, invalid date order, and no page block saving', async () => {
  const empty = fixture(existing); empty.set('content', ' '); empty.set('imageUrl', ''); await empty.submit(); assert.equal(empty.writes.length, 0)
  const dates = fixture(existing); dates.set('startsAt', '2028-01-01T00:00:00'); await dates.submit(); assert.equal(dates.writes.length, 0)
  const pages = fixture(existing); pages.set('pages', false); await pages.submit(); assert.equal(pages.writes.length, 0)
})

test('a public image can be saved without text content', async () => {
  const f = fixture(existing); f.set('content', ''); await f.submit()
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].body.content, '')
})

test('cancel requires explicit discard and never performs a write', () => {
  const f = fixture(existing); f.set('title', '未保存标题'); f.close()
  assert.equal(f.closed, 0); assert.equal(f.writes.length, 0)
  f.button('继续编辑').props.onClick(); assert.equal(f.closed, 0)
  f.close(); f.button('放弃修改').props.onClick(); assert.equal(f.closed, 1)
})

test('duplicate submission is blocked while pending and failure keeps edits', async () => {
  let finish
  const f = fixture(existing, { wait: new Promise(resolve => { finish = resolve }), error: '保存失败' })
  f.set('title', '保留这条编辑')
  const first = f.submit(); await f.submit(); f.close()
  assert.equal(f.writes.length, 1); assert.equal(f.closed, 0)
  finish(); await first
  assert.equal(f.saved, 0); assert.match(f.error(), /保存失败/)
  assert.equal(all(f.render()).find(node => node.props?.name === 'title').props.value, '保留这条编辑')
})

test('preview uses unsaved input without triggering navigation or persistence', () => {
  const f = fixture(existing); f.set('title', '实时修改'); f.set('actionUrl', '/plans?source=popup')
  const preview = all(f.render()).find(node => node.type === 'SitePopupCard')
  assert.equal(preview.props.popup.title, '实时修改'); assert.equal(preview.props.preview, true)
  assert.equal(preview.props.popup.actionUrl, '/plans?source=popup'); assert.equal(f.writes.length, 0)
})
