import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
function compile(source, dependencies = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Error })(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  }, module, module.exports)
  return module.exports
}

const helpers = compile(read('../lib/studio/manual-payment-config.ts'))
function manual({ enabled = false, instructions = '已有收款说明\n请备注订单号' } = {}) {
  const ready = enabled && Boolean(instructions.trim())
  return { id: 'manual', name: 'Manual settlement', description: 'Synthetic fixture', checkoutKind: 'manual', enabled, ready, checkoutReady: ready, webhookReady: false, webhookOptional: true,
    fields: [{ key: 'instructions', label: 'Settlement instructions', kind: 'textarea', required: true, secret: false, configured: Boolean(instructions), value: instructions }] }
}
const unavailable = ['alipay', 'wechat', 'stripe'].map(id => ({ id, name: id, checkoutKind: 'unavailable', enabled: true, ready: false, checkoutReady: false, webhookReady: false, fields: [] }))
const summary = provider => ({ origin: 'https://synthetic.example', readyProviders: provider?.ready ? 1 : 0, providers: [...unavailable, ...(provider ? [provider] : [])], generatedAt: '2026-10-14T00:00:00Z' })
const full = ts.createSourceFile('settings.tsx', read('../components/studio/admin-settings.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = ['BillingSection', 'PaymentProviderEditor'].map(name => {
  const declaration = full.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration, `Missing actual component ${name}`)
  return `export ${declaration.getText(full)}`
}).join('\n')
const controls = Object.fromEntries(['AdminSectionCard', 'AdminNotice', 'AdminField', 'AdminSelect', 'AdminSaveBar', 'ControlButton', 'StatusBadge', 'AdminTextarea', 'Wallet', 'Save', 'CommercePolicyEditor'].map(name => [name, name]))
const imports = `import { useState, useEffect, useRef } from 'react'; import { assertManualPaymentSaved, canConfigureManualPayment, MANUAL_INSTRUCTIONS_LIMIT, manualPaymentInput, manualPaymentInstructions } from './helpers'; import { updatePaymentProviderConfig } from './api'; import { ${Object.keys(controls).join(',')} } from './ui';`
function all(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : [] }

function fixture(initial = manual(), options = {}) {
  let provider = initial
  const states = [], refs = [], effects = []
  let stateCursor = 0, refCursor = 0, effectCursor = 0, pending = []
  const writes = [], messages = [], errors = [], saved = []
  const react = {
    useState: initialValue => { const index = stateCursor++; if (!(index in states)) states[index] = typeof initialValue === 'function' ? initialValue() : initialValue; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }] },
    useRef: initialValue => refs[refCursor++] ??= { current: initialValue },
    useEffect: (effect, deps) => { const index = effectCursor++; if (!effects[index] || deps.some((dep, i) => !Object.is(dep, effects[index][i]))) { effects[index] = deps; pending.push(effect) } },
  }
  const api = compile(imports + declarations, {
    react, './helpers': helpers, './ui': controls,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    './api': { updatePaymentProviderConfig: async (id, enabled, values) => {
      writes.push(plain({ id, enabled, values }))
      if (options.wait) await options.wait
      if (options.error) throw new Error(options.error)
      return options.ack ? options.ack({ id, enabled, values }) : summary(manual({ enabled, instructions: values.instructions }))
    } },
  })
  const props = () => ({ provider, onSaved: value => { saved.push(value); provider = value.providers.find(item => item.id === 'manual') }, onMessage: value => messages.push(value), onError: value => errors.push(value) })
  function render() {
    stateCursor = 0; refCursor = 0; effectCursor = 0; pending = []
    const result = api.PaymentProviderEditor(props())
    if (pending.length) { pending.forEach(effect => effect()); return render() }
    return result
  }
  const find = type => all(render()).find(node => node.type === type)
  const submit = () => find('form').props.onSubmit({ preventDefault() {} })
  return { api, render, find, submit, writes, messages, errors, saved, setProvider: value => { provider = value },
    instructions: value => find('AdminTextarea').props.onChange({ target: { value } }),
    enabled: checked => find('input').props.onChange({ target: { checked } }),
  }
}

test('billing binds the existing manual provider and leaves customer policy and unavailable channels intact', () => {
  const f = fixture()
  const paymentConfig = summary(manual())
  const settings = { operationMode: 'commercial', site: { commercePolicy: { status: 'published', version: 'existing' } } }
  const policySave = () => {}
  const nodes = all(f.api.BillingSection({ settings, paymentConfig, canSystem: true, canCommerce: true, canBilling: true, saving: false, onModeSave: policySave, onPaymentConfigChange() {}, onMessage() {}, onError() {} }))
  const editor = nodes.find(node => node.type === f.api.PaymentProviderEditor)
  assert.equal(editor.props.provider.id, 'manual')
  const policy = nodes.find(node => node.type === 'CommercePolicyEditor')
  assert.equal(policy.props.settings, settings); assert.equal(policy.props.onSave, policySave)
  assert.equal(nodes.filter(node => node.type === 'StatusBadge' && node.props.children === '未接入').length, 3)
  assert.equal(f.writes.length, 0)
  assert.equal(paymentConfig.providers.slice(0, 3).every(item => item.enabled === true), true)
})

test('the actual editor reads existing instructions and saves only manual fields', async () => {
  const f = fixture()
  assert.equal(f.find('AdminTextarea').props.value, '已有收款说明\n请备注订单号')
  assert.equal(f.find('input').props.checked, false)
  await f.submit()
  assert.deepEqual(f.writes, [{ id: 'manual', enabled: false, values: { instructions: '已有收款说明\n请备注订单号' } }])
  assert.equal(f.saved.length, 1)
  assert.match(f.messages.at(-1), /已关闭/)
})

test('editing and enabling manual settlement confirms matching persistence without claiming receipt or callback verification', async () => {
  const f = fixture()
  f.instructions('  新收款说明\n请核对订单  '); f.enabled(true)
  assert.equal(f.find('AdminTextarea').props.required, true)
  await f.submit()
  assert.deepEqual(f.writes, [{ id: 'manual', enabled: true, values: { instructions: '新收款说明\n请核对订单' } }])
  assert.equal(f.find('AdminTextarea').props.value, '新收款说明\n请核对订单')
  assert.equal(f.find('input').props.checked, true)
  assert.match(f.messages.at(-1), /仍需管理员核实并确认/)
  const badges = all(f.render()).filter(node => node.type === 'StatusBadge').map(node => node.props.children)
  assert.deepEqual(badges, ['已保存配置就绪', '无需自动回调'])
})

test('explicit disable preserves instructions and clears persisted readiness', async () => {
  const f = fixture(manual({ enabled: true }))
  f.enabled(false)
  await f.submit()
  assert.equal(f.writes[0].enabled, false)
  assert.equal(f.writes[0].values.instructions, '已有收款说明\n请备注订单号')
  assert.equal(f.saved[0].providers.find(item => item.id === 'manual').ready, false)
})

test('missing or unsupported provider definitions cannot produce a writable form', () => {
  for (const provider of [null, ...unavailable, { ...manual(), checkoutKind: 'unavailable' }, { ...manual(), fields: [] }]) {
    const f = fixture(provider)
    assert.equal(f.find('form'), undefined)
    assert.equal(f.writes.length, 0)
    assert.match(JSON.stringify(f.render()), /系统未返回可用的人工收款配置/)
  }
})

test('empty enabled instructions and oversized instructions fail before any request; disabled empty instructions are valid', async () => {
  const f = fixture()
  f.enabled(true); f.instructions(' \n ')
  await f.submit()
  assert.equal(f.writes.length, 0); assert.match(f.errors.at(-1), /请填写/)
  f.instructions('x'.repeat(16001))
  await f.submit()
  assert.equal(f.writes.length, 0); assert.match(f.errors.at(-1), /16000/)
  f.enabled(false); f.instructions('')
  await f.submit()
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].values.instructions, '')
})

test('missing or mismatched server acknowledgements never display successful save', async () => {
  const acks = [null, {}, summary(), summary(manual({ enabled: true })), summary(manual({ instructions: 'other' })), summary({ ...manual(), ready: true }), { providers: [manual(), manual()] }]
  for (const ack of acks) {
    const f = fixture(manual(), { ack: () => ack })
    await f.submit()
    assert.equal(f.saved.length, 0)
    assert.equal(f.messages.some(message => message.includes('已保存')), false)
    assert.match(f.errors.at(-1), /未确认人工收款配置保存/)
  }
})

test('rapid duplicate submission sends one request and disables fields until acknowledgement', async () => {
  let finish
  const wait = new Promise(resolve => { finish = resolve })
  const f = fixture(manual(), { wait })
  const first = f.submit()
  await f.submit()
  assert.equal(f.writes.length, 1)
  assert.equal(f.find('fieldset').props.disabled, true)
  assert.equal(f.find('input').props.disabled, true)
  finish(); await first
  assert.equal(f.find('fieldset').props.disabled, false)
  assert.equal(f.saved.length, 1)
})

test('failed persistence retains the administrator draft and permits a genuine retry', async () => {
  const options = { error: 'Synthetic service unavailable' }
  const f = fixture(manual(), options)
  f.instructions('新的草稿'); f.enabled(true)
  await f.submit()
  assert.equal(f.saved.length, 0); assert.equal(f.find('AdminTextarea').props.value, '新的草稿')
  assert.match(f.errors.at(-1), /Synthetic service unavailable/)
  options.error = ''
  await f.submit()
  assert.equal(f.writes.length, 2); assert.equal(f.saved.length, 1)
})
