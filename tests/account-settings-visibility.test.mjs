import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const tick = () => new Promise(resolve => setImmediate(resolve))
function compile(file, dependencies = {}, globals = {}, source) {
  const code = ts.transpileModule(source ?? readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name] }, module, module.exports, ...Object.values(globals))
  return module.exports
}
function hooks() {
  let cursor = 0, pending = [], slots = []
  return {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
      useRef(initial) { return slots[cursor++] ??= { current: initial } },
      useEffect(work, deps) { const index = cursor++; if (!slots[index] || deps.some((value, n) => !Object.is(value, slots[index].deps[n]))) { pending.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: work() } }) } },
    },
    render(fn, props) { cursor = 0; pending = []; const value = fn(props); pending.forEach(work => work()); return value },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}
function fixture() {
  const h = hooks(), window = new EventTarget(), document = new EventTarget(), calls = []
  document.visibilityState = 'visible'
  let savedListener
  const api = compile('lib/studio/use-account-settings-visibility.ts', {
    react: h.react,
    './api': { request: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })) },
    './account-settings-visibility': { ...compile('lib/studio/account-settings-visibility.ts'), subscribeAccountSettingsVisibility: listener => { savedListener = listener; return () => { savedListener = undefined } } },
  }, { window, document })
  let props = { accountId: 'a', connected: true, active: false }
  return { h, calls, window, document,
    render(patch = {}) { props = { ...props, ...patch }; return h.render(api.useAccountSettingsVisibility, props) },
    publish(value) { savedListener(value) },
  }
}

test('unknown entries stay hidden; menu reopen and focus read the latest saved flags', async () => {
  const f = fixture()
  assert.equal(f.render(), null); assert.equal(f.calls.length, 1)
  f.calls[0].resolve({ visibility: { watermark: false, adultContent: true } }); await tick()
  assert.deepEqual(f.render(), { watermark: false, adultContent: true })
  f.render({ active: true }); assert.equal(f.calls.length, 2)
  f.calls[1].resolve({ visibility: { watermark: true, adultContent: false } }); await tick()
  assert.deepEqual(f.render(), { watermark: true, adultContent: false })
  f.document.visibilityState = 'hidden'; f.window.dispatchEvent(new Event('focus')); assert.equal(f.calls.length, 2)
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange')); assert.equal(f.calls.length, 3)
  f.calls[2].resolve({ visibility: { watermark: false, adultContent: false } }); await tick()
  assert.deepEqual(f.render(), { watermark: false, adultContent: false })
  f.h.unmount(); f.window.dispatchEvent(new Event('focus')); assert.equal(f.calls.length, 3)
})

test('an old visibility request cannot overwrite a confirmed administrator save', async () => {
  const f = fixture(); f.render()
  f.publish({ watermark: false, adultContent: false })
  assert.equal(f.calls[0].options.signal.aborted, true)
  f.calls[0].resolve({ visibility: { watermark: true, adultContent: true } }); await tick()
  assert.deepEqual(f.render(), { watermark: false, adultContent: false })
  f.h.unmount()
})

test('account switches abort and ignore late responses; network failures do not reenable hidden entries', async () => {
  const f = fixture(); f.render(); f.render({ accountId: 'b' })
  assert.equal(f.calls[0].options.signal.aborted, true)
  f.calls[0].resolve({ visibility: { watermark: true, adultContent: true } }); await tick()
  assert.equal(f.render(), null)
  f.calls[1].resolve({ visibility: { watermark: false, adultContent: false } }); await tick()
  f.render({ active: true }); f.calls[2].reject(new Error('synthetic network failure')); await tick()
  assert.deepEqual(f.render(), { watermark: false, adultContent: false })
  assert.equal(f.render({ connected: false }), null); f.h.unmount()
})

test('broadcasts work without a local account menu and include only two boolean display flags', () => {
  const instances = [], messages = [], window = new EventTarget()
  window.BroadcastChannel = class { constructor() { instances.push(this) } postMessage(value) { messages.push(value) } close() { this.closed = true } }
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail } }
  const api = compile('lib/studio/account-settings-visibility.ts', {}, { window, CustomEvent })
  api.publishAccountSettingsVisibility({ watermarkPolicy: { enabled: false }, accountMenu: { adultContentSettingsVisible: false }, mail: { password: 'must-not-broadcast' } })
  assert.deepEqual(messages, [{ watermark: false, adultContent: false }]); assert.equal(instances[0].closed, true)
  const received = [], unsubscribe = api.subscribeAccountSettingsVisibility(value => received.push(value))
  instances[1].onmessage({ data: { watermark: false, adultContent: true, secret: 'must-not-forward' } })
  instances[1].onmessage({ data: { watermark: 'true', adultContent: false } })
  assert.deepEqual(received, [{ watermark: false, adultContent: true }]); assert.equal(messages.length, 1)
  unsubscribe(); assert.equal(instances[1].onmessage, null); assert.equal(instances[1].closed, true)
})

test('only a successful and valid administrator response updates menu visibility', async () => {
  const published = [], settings = { watermarkPolicy: { enabled: false }, accountMenu: { adultContentSettingsVisible: true } }
  let failure = true
  const source = readFileSync(new URL('../lib/studio/admin-api.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateAdminSettings').getText(ast)
  const api = compile('', {}, { request: async () => { if (failure) throw new Error('synthetic save failure'); return { settings } }, assertOk() {}, StudioApiError: Error, publishSiteBrandSettings() {}, publishAccountSettingsVisibility: value => published.push(value) }, fn)
  await assert.rejects(api.updateAdminSettings({ watermarkPolicy: { enabled: false } })); assert.equal(published.length, 0)
  failure = false; await api.updateAdminSettings({ accountMenu: { adultContentSettingsVisible: true } }); assert.deepEqual(published, [settings])
  await api.updateAdminSettings({ registrationEnabled: true }); assert.equal(published.length, 1)
})

test('adult entry form submits visibility only and preserves administrator draft until save', () => {
  const h = hooks(), jsx = (type, props) => ({ type, props }), saved = []
  const api = compile('components/studio/admin-adult-content-settings.tsx', { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Save: 'Save' }, './admin-kit': { AdminNotice: 'AdminNotice', AdminSaveBar: 'AdminSaveBar', AdminSectionCard: 'AdminSectionCard' }, './ui': { ControlButton: 'ControlButton' } })
  const all = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(all) : [value, ...all(value.props?.children)]
  const props = { visible: true, saving: false, onSave: patch => saved.push(patch) }
  let tree = all(h.render(api.AdminAdultContentSettings, props)); tree.find(node => node.type === 'input').props.onChange({ target: { checked: false } })
  assert.equal(saved.length, 0)
  tree = all(h.render(api.AdminAdultContentSettings, props)); tree.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(saved, [{ accountMenu: { adultContentSettingsVisible: false } }])
})

test('the account menu hides disabled entries and closes an already-open dialog', () => {
  const h = hooks(), jsx = (type, props) => ({ type, props })
  let visibility = { watermark: true, adultContent: true }
  const tx = text => text
  const api = compile('components/studio/topbar.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    'next/link': { default: 'Link' }, 'next/navigation': { usePathname: () => '/studio', useRouter: () => ({}) },
    '@/lib/studio/i18n': { useUiText: () => tx, useLocale: () => ({ locale: 'zh-CN', t: tx }) },
    '@/lib/studio/store': { useStudio: () => ({ state: { user: { id: 'a', name: 'Fixture', plan: 'fixture' }, projects: [], backendStatus: 'connected', credits: 50, sessionSettings: {}, theme: 'dark' } }) },
    '@/lib/studio/billing-store-route': {billingStoreHref:()=>'/plans'}, '@/lib/studio/studio-tour': {STUDIO_TOUR_EVENT:'fixture-tour'},
    '@/lib/studio/account-api': {}, './ui': { Tooltip: 'Tooltip', StatusBadge: 'StatusBadge' },
    '@/lib/studio/preview-mode': { isStudioPreview: () => false }, './studio-nav': { localizedStudioPageTitle: () => '开始创作' },
    '@/lib/utils': { cn: (...classes) => classes.join(' ') }, '@/components/site-announcements': { useAnnouncements: () => ({ unread: 0 }), AnnouncementList: 'AnnouncementList' },
    '@/lib/studio/return-path': {}, '@/lib/studio/use-check-in': { useCheckIn: () => ({}) }, '@/lib/studio/check-in-rules': {},
    '@/lib/studio/use-account-settings-visibility': { useAccountSettingsVisibility: () => visibility },
    './account-watermark': { AccountWatermarkDialog: 'WatermarkDialog' }, './account-adult-content': { AccountAdultContentDialog: 'AdultDialog' },
    './workspace-switcher': { WorkspaceSwitcher: 'WorkspaceSwitcher' }, '@/lib/studio/workspace-context': { useWorkspace: () => ({ identity: null }) },
    '@/lib/studio/workspace-navigation': { workspaceSection: path => path },
  })
  function nodes(value) { return !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)] }
  const render = () => nodes(h.render(api.Topbar, { onMenuClick() {} }))
  let tree = render()
  tree.find(node => node.props?.role === 'menuitem' && node.props.children?.includes?.('成人内容设置')).props.onClick()
  tree = render(); assert.equal(tree.find(node => node.type === 'AdultDialog').props.open, true)
  visibility = { watermark: false, adultContent: false }; tree = render()
  assert.equal(tree.find(node => node.type === 'AdultDialog').props.open, false)
  for (const label of ['成人内容设置', 'AI 水印设置']) assert.ok(!tree.some(node => node.props?.role === 'menuitem' && JSON.stringify(node.props.children).includes(label)))
  visibility = { watermark: true, adultContent: true }; tree = render()
  assert.equal(tree.find(node => node.type === 'AdultDialog').props.open, false)
  assert.equal(tree.find(node => node.type === 'WatermarkDialog').props.open, false)
  h.unmount()
})
