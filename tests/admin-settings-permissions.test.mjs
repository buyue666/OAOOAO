import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
function compile(source, dependencies = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  class FormDataFixture { constructor(fields = {}) { this.fields = fields } get(key) { return this.fields[key] ?? null } has(key) { return key in this.fields } }
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Error, Promise, URLSearchParams, URL, FormData: FormDataFixture, window: { location: { search: '?section=billing', href: 'https://synthetic.example/admin/settings?section=billing' }, history: { replaceState() {} } } })(name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`)
    return dependencies[name]
  }, module, module.exports)
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const settingsSource = ts.createSourceFile('settings.tsx', read('../components/studio/admin-settings.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = ['AdminSettingsPanel', 'BillingSection', 'AccountSection'].map(name => {
  const node = settingsSource.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(node)
  return `export ${node.getText(settingsSource).replace(/^export /, '')}`
}).join('\n')
const ui = Object.fromEntries(['AdminError', 'AdminLoading', 'AdminNotice', 'AdminSectionCard', 'AdminSelect', 'AdminTabs', 'StatusBadge', 'AdminField', 'AdminInput', 'AdminSaveBar', 'ControlButton', 'Save', 'PaymentProviderEditor', 'CommercePolicyEditor', 'AdminSiteSettings', 'PointsSection', 'GenerationSection', 'MailSection', 'StorageSection', 'LifecycleSection'].map(name => [name, name]))
const imports = `import { useState, useRef, useEffect, useCallback } from 'react'; import { useAdminSession, useAdminReload, useAdminNavigation, useConfirm } from './context'; import { getAdminSettings, getObjectStorage, getPaymentConfig, updateAdminSettings } from './api'; import { canConfigureManualPayment } from './helpers'; import { ${Object.keys(ui).join(',')} } from './ui';`
function all(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : [] }
const fixtureSettings = { operationMode: 'self_use', registrationEnabled: false, freeDailyPointsEnabled: false, freeDailyPoints: 0, commercePolicy: { status: 'draft' }, site: {} }
const paymentConfig = { providers: [{ id: 'manual', checkoutKind: 'manual', ready: false, enabled: false, fields: [{ key: 'instructions', kind: 'textarea', value: '', configured: false }] }] }

async function fixture(initialPermissions) {
  let permissions = initialPermissions
  const states = [], refs = [], effects = [], callbacks = []
  let stateCursor = 0, refCursor = 0, effectCursor = 0, callbackCursor = 0, pending = [], tree
  const reads = { settings: 0, storage: 0, payment: 0 }, writes = [], confirmations = []
  const react = {
    useState(value) { const i = stateCursor++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
    useRef(value) { return refs[refCursor++] ??= { current: value } },
    useCallback(fn, deps) { const i = callbackCursor++; if (!callbacks[i] || deps.some((value, j) => !Object.is(value, callbacks[i].deps[j]))) callbacks[i] = { fn, deps }; return callbacks[i].fn },
    useEffect(fn, deps) { const i = effectCursor++; if (!effects[i] || deps.some((value, j) => !Object.is(value, effects[i].deps[j]))) { const previous = effects[i]; effects[i] = { deps }; pending.push(() => { previous?.cleanup?.(); effects[i].cleanup = fn() }) } },
  }
  const confirm = { dialog: null, confirm: data => confirmations.push(data) }
  const navigation = { registerGuard() {} }
  const api = compile(imports + declarations, {
    react, './ui': ui, './helpers': compile(read('../lib/studio/manual-payment-config.ts')),
    './context': { useAdminSession: () => ({ can: permission => permissions.includes(permission) }), useAdminReload: () => ({ reloadKey: 0 }), useAdminNavigation: () => navigation, useConfirm: () => confirm },
    './api': { getAdminSettings: async () => { reads.settings++; return fixtureSettings }, getObjectStorage: async () => { reads.storage++; return {} }, getPaymentConfig: async () => { reads.payment++; return paymentConfig }, updateAdminSettings: async patch => { writes.push(plain(patch)); return { settings: { ...fixtureSettings, ...patch } } } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  })
  function render() { stateCursor = 0; refCursor = 0; effectCursor = 0; callbackCursor = 0; pending = []; tree = api.AdminSettingsPanel(); pending.forEach(effect => effect()); return tree }
  async function settle() { render(); await new Promise(resolve => setImmediate(resolve)); return render() }
  await settle()
  return { api, reads, writes, confirmations,
    nodes: () => all(tree),
    sections: () => plain(all(tree).find(node => node.type === 'AdminTabs').props.items.map(item => item[0])),
    billing: () => { const node = all(tree).find(node => node.type === api.BillingSection); return node ? all(api.BillingSection(node.props)) : [] },
    select: async value => { all(tree).find(node => node.type === 'AdminTabs').props.onChange(value); await settle() },
    permissions: async next => { permissions = next; await settle() },
  }
}

test('the actual administration navigation and access boundary grant settings access to commerce managers', () => {
  const source = ts.createSourceFile('shell.tsx', read('../components/studio/admin-shell.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'adminNavGroups'))
  assert.ok(declaration)
  const names = ['BarChart3', 'Users', 'CircleDollarSign', 'WalletCards', 'Activity', 'Layers3', 'Megaphone', 'Settings2', 'ShieldCheck']
  const result = compile(`const ${names.map(name => `${name}='${name}'`).join(',')};\n${declaration.getText(source)}`)
  const required = result.adminNavGroups.flatMap(group => group.items).find(([id]) => id === 'settings')[3]
  assert.equal(required.includes('commerce.manage'), true)
  assert.equal(required.includes('billing.read'), false)
})

test('commerce-only settings show policy and commerce controls without fetching payment or storage configuration', async () => {
  const f = await fixture(['commerce.manage'])
  assert.deepEqual(f.reads, { settings: 1, payment: 0, storage: 0 })
  assert.deepEqual(f.sections(), ['account', 'billing', 'points'])
  const nodes = f.billing()
  assert.equal(nodes.some(node => node.type === 'CommercePolicyEditor'), true)
  assert.equal(nodes.some(node => node.type === 'PaymentProviderEditor' || node.type === 'form'), false)
  nodes.find(node => node.type === 'CommercePolicyEditor').props.onSave({ commercePolicy: { status: 'draft' } }, ['政策草稿'])
  assert.equal(f.confirmations[0].title, '保存购买政策？')
  await f.confirmations[0].onConfirm()
  assert.deepEqual(f.writes, [{ commercePolicy: { status: 'draft' } }])
})

test('billing-only settings fetch payment configuration and hide policy, mode and commerce-only fields', async () => {
  const f = await fixture(['billing.manage'])
  assert.deepEqual(f.reads, { settings: 1, payment: 1, storage: 0 })
  assert.deepEqual(f.sections(), ['billing'])
  const nodes = f.billing()
  assert.equal(nodes.some(node => node.type === 'PaymentProviderEditor'), true)
  assert.equal(nodes.some(node => node.type === 'CommercePolicyEditor' || node.type === 'form'), false)
})

test('system-only settings can save operation mode and do not load payment configuration or show policy actions', async () => {
  const f = await fixture(['system.manage'])
  assert.deepEqual(f.reads, { settings: 1, payment: 0, storage: 1 })
  assert.equal(f.sections().includes('billing'), true)
  const nodes = f.billing()
  assert.equal(nodes.some(node => node.type === 'PaymentProviderEditor' || node.type === 'CommercePolicyEditor'), false)
  const mode = nodes.find(node => node.type === 'form')
  mode.props.onSubmit({ preventDefault() {}, currentTarget: { operationMode: 'commercial', commercePolicy: 'injected' } })
  assert.equal(f.confirmations[0].title, '保存运营模式设置？')
  await f.confirmations[0].onConfirm()
  assert.deepEqual(f.writes, [{ operationMode: 'commercial' }])
})

test('losing billing permission hides previously fetched payment data and does not fetch it again', async () => {
  const f = await fixture(['billing.manage'])
  await f.permissions(['commerce.manage'])
  assert.deepEqual(f.reads, { settings: 2, payment: 1, storage: 0 })
  assert.equal(f.billing().some(node => node.type === 'PaymentProviderEditor'), false)
  assert.equal(f.billing().some(node => node.type === 'CommercePolicyEditor'), true)
})

test('registration and free points submit only the fields owned by the current role', async () => {
  for (const [permissions, expected, title] of [
    [['commerce.manage'], { freeDailyPointsEnabled: true, freeDailyPoints: 7 }, '每日免费积分'],
    [['system.manage'], { registrationEnabled: true }, '注册开关'],
  ]) {
    const f = await fixture(permissions)
    await f.select('account')
    const item = f.nodes().find(node => node.type === f.api.AccountSection)
    const nodes = all(f.api.AccountSection(item.props))
    assert.deepEqual(nodes.filter(node => node.type === 'AdminSectionCard').map(node => node.props.title), [title])
    nodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: { registrationEnabled: 'on', freeDailyPointsEnabled: 'on', freeDailyPoints: '7' } })
    await f.confirmations[0].onConfirm()
    assert.deepEqual(f.writes, [expected])
  }
})

test('upstream-only settings do not reveal the operation and payment group', async () => {
  const f = await fixture(['upstream.manage'])
  assert.deepEqual(f.sections(), ['generation'])
  assert.deepEqual(f.reads, { settings: 1, payment: 0, storage: 0 })
  assert.equal(f.billing().length, 0)
})
