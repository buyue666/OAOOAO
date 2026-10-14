import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function compile(source, modules = {}, globals = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }; new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => { assert.ok(name in modules, name); return modules[name] }, module, module.exports, ...Object.values(globals)); return module.exports
}
const online = compile(read('../lib/studio/payment-provider-config.ts'))
const wechat = compile(read('../lib/studio/wechat-settings.ts'))
const features = compile(read('../lib/studio/entitlement-features.ts'))
const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
const field = (key, kind, value = '', options) => ({ key, kind, label: key, value, configured: Boolean(value), required: true, options })
function epay() { return { id: 'epay', name: 'Epay', enabled: false, ready: false, checkoutKind: 'form', fields: [
  field('gatewayUrl', 'url', 'https://pay.example/'), field('pid', 'text', '123456'), field('protocol', 'select', 'v2_rsa', [{ value: 'v2_rsa', label: 'RSA' }, { value: 'v1_md5', label: 'MD5' }]), field('paymentType', 'select', 'cashier', [{ value: 'cashier', label: 'Cashier' }, { value: 'wxpay', label: 'Wechat' }]),
  { ...field('key', 'secret'), secret: true, configured: true }, { ...field('merchantPrivateKey', 'textarea'), secret: true, configured: true }, { ...field('platformPublicKey', 'textarea'), secret: true, configured: true },
] } }
test('protocol-specific payments keep blank secrets and submit only the active protocol fields', () => {
  const provider = epay(), draft = online.paymentValues(provider)
  assert.equal(draft.merchantPrivateKey, '')
  assert.deepEqual(online.paymentProviderInput(provider, true, { ...draft, key: 'unused-md5' }), { providerId: 'epay', enabled: true, values: { gatewayUrl: 'https://pay.example/', pid: '123456', protocol: 'v2_rsa', paymentType: 'cashier' } })
  const v1 = online.paymentProviderInput(provider, true, { ...draft, protocol: 'v1_md5', key: 'new-test-key', merchantPrivateKey: 'unused-rsa' })
  assert.equal(v1.values.key, 'new-test-key'); assert.equal(v1.values.merchantPrivateKey, undefined)
})
test('incomplete active credentials, unsupported channels and unsafe gateway URLs cannot save', () => {
  const provider = epay(), draft = online.paymentValues(provider)
  provider.fields.find(item => item.key === 'merchantPrivateKey').configured = false
  assert.throws(() => online.paymentProviderInput(provider, true, draft), /商户私钥/)
  assert.doesNotThrow(() => online.paymentProviderInput(provider, false, draft))
  for (const gatewayUrl of ['javascript:alert(1)', 'http://pay.example', 'https://user:pass@pay.example', 'https://pay.example/#x', '//pay.example']) assert.throws(() => online.paymentProviderInput(provider, false, { ...draft, gatewayUrl }))
  assert.throws(() => online.paymentProviderInput(provider, false, { ...draft, protocol: 'imaginary' }))
  assert.equal(online.canConfigureOnlinePayment({ ...provider, checkoutKind: 'unavailable' }), false)
})
test('payment acknowledgement must match the saved provider and non-secret values', () => {
  const provider = epay(), input = online.paymentProviderInput(provider, false, online.paymentValues(provider))
  online.assertPaymentProviderSaved({ providers: [provider] }, input)
  for (const providers of [[], [provider, provider], [{ ...provider, enabled: true }], [{ ...provider, fields: provider.fields.map(item => item.key === 'pid' ? { ...item, value: 'different' } : item) }]]) assert.throws(() => online.assertPaymentProviderSaved({ providers }, input))
})
test('gateway root is canonicalized before comparing the saved acknowledgement', () => {
  const provider = epay(), draft = { ...online.paymentValues(provider), gatewayUrl: 'https://pay.example/subdirectory' }
  const input = online.paymentProviderInput(provider, false, draft)
  assert.equal(input.values.gatewayUrl, 'https://pay.example/subdirectory/')
  provider.fields.find(item => item.key === 'gatewayUrl').value = input.values.gatewayUrl
  online.assertPaymentProviderSaved({ providers: [provider] }, input)
})
test('WeChat drafts preserve masked secrets, explicit clears and reject destructive AppID replacement', () => {
  const saved = { appId: 'wx1234567890abcdef', enabled: false, autoRegister: false, hasAppSecret: true, hasToken: true, hasEncodingAESKey: true }
  const data = input => { const form = new FormData(); Object.entries(input).forEach(([key, value]) => form.set(key, value)); return form }
  assert.deepEqual(wechat.wechatSettingsInput(saved, data({ wechatAppId: saved.appId, wechatEnabled: 'on' })), { appId: saved.appId, enabled: true, autoRegister: false })
  assert.equal(wechat.wechatSettingsInput(saved, data({ wechatAppId: saved.appId, clearToken: 'on' })).clearToken, true)
  assert.throws(() => wechat.wechatSettingsInput(saved, data({ wechatAppId: saved.appId, clearToken: 'on', token: 'replacement' })), /同时/)
  assert.throws(() => wechat.wechatSettingsInput(saved, data({ wechatAppId: saved.appId, clearToken: 'on', wechatEnabled: 'on' })), /验证令牌/)
  assert.throws(() => wechat.wechatSettingsInput(saved, data({ wechatAppId: 'wxabcdef1234567890' })), /重新填写/)
  assert.throws(() => wechat.wechatSettingsInput(saved, data({ wechatAppId: saved.appId, encodingAESKey: 'short' })), /43/)
})
function hooks() {
  const slots = []; let cursor = 0, pending = []
  return {
    react: {
      useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value }] },
      useRef(initial) { const at = cursor++; return slots[at] ??= { current: initial } },
      useCallback(work, deps) { const at = cursor++; if (!slots[at] || deps.some((value, i) => !Object.is(value, slots[at].deps[i]))) slots[at] = { deps, work }; return slots[at].work },
      useEffect(work, deps) { const at = cursor++; if (!slots[at] || deps.some((value, i) => !Object.is(value, slots[at].deps[i]))) pending.push(() => { slots[at]?.cleanup?.(); slots[at] = { deps, cleanup: work() } }) },
    }, render(work) { cursor = 0; pending = []; const output = work(); pending.forEach(fn => fn()); return output }, unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
const ui = Object.fromEntries(['AdminField', 'AdminInput', 'AdminNotice', 'AdminSaveBar', 'AdminSectionCard', 'AdminSelect', 'AdminTextarea', 'ControlButton', 'StatusBadge', 'AdminEmpty', 'AdminDefinition', 'Wallet', 'Save', 'formatAdminNumber'].map(name => [name, name]))
test('actual online editor shows Chinese protocol controls, locks duplicate saves, clears entered secrets after success', async () => {
  const h = hooks(), writes = [], saved = [], errors = []; let provider = epay(), finish
  const waiting = new Promise(resolve => { finish = resolve })
  const { OnlinePaymentProviderEditor: Editor } = compile(read('../components/studio/admin-payment-provider.tsx'), { react: h.react, 'lucide-react': ui, '@/lib/studio/admin-api': { async updatePaymentProviderConfig(id, enabled, values) { writes.push({ id, enabled, values }); await waiting; return { providers: [{ ...provider, enabled, fields: provider.fields.map(item => item.secret ? { ...item, configured: true } : { ...item, value: values[item.key] ?? item.value }) }] } } }, '@/lib/studio/payment-provider-config': online, './admin-kit': ui, './ui': ui, 'react/jsx-runtime': jsx })
  const props = { get provider() { return provider }, onSaved(value) { saved.push(value); provider = value.providers[0] }, onMessage() {}, onError(value) { errors.push(value) } }
  const render = () => h.render(() => Editor(props)), nodes = () => all(render())
  render(); const privateKey = nodes().find(node => node.props?.name === 'payment.epay.merchantPrivateKey'); privateKey.props.onChange({ target: { value: 'synthetic-private-key' } })
  provider = structuredClone(provider); render()
  assert.equal(nodes().find(node => node.props?.name === 'payment.epay.merchantPrivateKey').props.value, 'synthetic-private-key')
  assert.ok(nodes().some(node => node.type === 'AdminField' && node.props.label === '签名协议'))
  const submit = () => render().props.onSubmit({ preventDefault() {} }); const first = submit(); await submit()
  assert.equal(writes.length, 1); assert.equal(nodes().find(node => node.type === 'fieldset').props.disabled, true)
  finish(); await first; render(); assert.equal(saved.length, 1); assert.equal(nodes().find(node => node.props?.name === 'payment.epay.merchantPrivateKey').props.value, '')
  assert.equal(errors.filter(Boolean).length, 0)
})
test('actual WeChat settings form sends only the requested secret changes and keeps secrets out of confirmation text', () => {
  const h = hooks(), writes = []
  const saved = { appId: 'wx1234567890abcdef', enabled: false, autoRegister: false, hasAppSecret: true, hasToken: true, hasEncodingAESKey: true, configured: true, callbackUrl: 'https://example.com/api/integrations/wechat-official/callback' }
  class FormFields { constructor(values) { this.values = values } get(key) { return this.values[key] ?? null } has(key) { return key in this.values } }
  const { AdminWechatSettings: Editor } = compile(read('../components/studio/admin-wechat-settings.tsx'), { react: h.react, 'lucide-react': ui, '@/lib/studio/wechat-settings': wechat, './admin-kit': ui, './ui': ui, 'react/jsx-runtime': jsx }, { FormData: FormFields })
  const props = { settings: saved, registrationEnabled: false, saving: false, onSave(patch, summary) { writes.push({ patch, summary }) } }
  const render = () => h.render(() => Editor(props))
  const tree = render(), fields = all(tree).filter(node => node.type === 'AdminInput' && node.props.type === 'password')
  assert.equal(fields.length, 3); assert.ok(fields.every(node => node.props.value === undefined && node.props.defaultValue === undefined))
  tree.props.onSubmit({ preventDefault() {}, currentTarget: { wechatAppId: saved.appId, token: 'NewSyntheticToken123' } })
  assert.deepEqual(writes[0].patch, { wechatOfficial: { appId: saved.appId, enabled: false, autoRegister: false, token: 'NewSyntheticToken123' } })
  assert.equal(JSON.stringify(writes[0].summary).includes('NewSyntheticToken123'), false)
  props.saving = true; render().props.onSubmit({ preventDefault() {}, currentTarget: {} }); assert.equal(writes.length, 1)
  props.settings = undefined; props.saving = false; assert.equal(render().type, 'AdminNotice')
})
test('actual entitlement checkboxes default legacy plans to all kinds and preserve legacy features when deselecting all', () => {
  const h = hooks(), writes = []
  const source = ts.createSourceFile('settings.tsx', read('../components/studio/admin-settings.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PointsSection').getText(source)
  const imports = `import {useState} from 'react'; import {allowedGenerationKinds,ENTITLEMENT_GENERATION_KINDS} from './features'; import {${Object.keys(ui).join(',')}} from './ui';`
  const { PointsSection } = compile(`${imports} export ${declaration}`, { react: h.react, './features': features, './ui': ui, 'react/jsx-runtime': jsx })
  const settings = { entitlements: { enabled: true, defaultPlanId: 'legacy', plans: [{ id: 'legacy', name: '旧方案', enabled: true, dailyPoints: 0, limits: {}, features: ['keep-legacy-feature'] }] }, generationCostControl: {}, generationPointMultipliers: {}, modelPointCosts: {} }
  const render = () => h.render(() => PointsSection({ settings, canUpstream: false, saving: false, onSave: patch => writes.push(patch) }))
  const boxes = () => all(render()).filter(node => node.type === 'label' && all(node).some(child => child.type === 'input') && features.ENTITLEMENT_GENERATION_KINDS.some(kind => node.props.children.includes(kind.label)))
  assert.equal(boxes().length, 5)
  for (const node of all(render()).filter(node => node.type === 'AdminInput' && node.props.type === 'number')) assert.equal(node.props.value, 0)
  for (const box of boxes()) { const input = all(box).find(node => node.type === 'input'); assert.equal(input.props.checked, true); input.props.onChange({ target: { checked: false } }) }
  render().props.onSubmit({ preventDefault() {} })
  assert.deepEqual(writes[0].entitlements.plans[0].allowedGenerationKinds, [])
  assert.deepEqual(writes[0].entitlements.plans[0].features, ['keep-legacy-feature'])
  assert.deepEqual(features.allowedGenerationKinds({ allowedGenerationKinds: [] }), [])
})

test('actual SMTP form displays masked credential status and excludes read-only state from save and test requests', async () => {
  const h = hooks(), saves = [], tests = []
  const source = ts.createSourceFile('settings.tsx', read('../components/studio/admin-settings.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MailSection').getText(source)
  const imports = `import {useState} from 'react'; import {sendTestMail} from './api'; import {${Object.keys(ui).join(',')},Mail} from './ui';`
  const { MailSection } = compile(`${imports} export ${declaration}`, { react: h.react, './api': { async sendTestMail(to, mail) { tests.push({ to, mail }) } }, './ui': { ...ui, Mail: 'Mail' }, 'react/jsx-runtime': jsx })
  const settings = { mail: { provider: 'smtp', host: 'smtp.example.test', username: 'fixture', password: '', hasPassword: true, port: 587, secure: false } }
  const props = { settings, saving: false, onSave: patch => saves.push(patch) }
  const render = () => h.render(() => MailSection(props)), nodes = () => all(render())
  const input = label => all(nodes().find(node => node.type === 'AdminField' && node.props.label === label)).find(node => node.type === 'AdminInput')
  assert.ok(nodes().some(node => node.type === 'StatusBadge' && node.props.children === 'SMTP 密码已保存'))
  assert.equal(input('SMTP 密码').props.value, '')
  assert.equal(input('SMTP 密码').props.placeholder, '留空表示不修改')
  assert.equal(input('邮件协议').props.readOnly, true)
  assert.equal(input('邮件协议').props.value, 'SMTP')
  nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(saves[0].mail.provider, 'smtp'); assert.equal(Object.hasOwn(saves[0].mail, 'hasPassword'), false); assert.equal(Object.hasOwn(saves[0].mail, 'password'), false)
  input('收件地址').props.onChange({ target: { value: 'recipient@example.test' } })
  nodes().find(node => node.type === 'ControlButton' && node.props.onClick).props.onClick()
  await Promise.resolve()
  assert.equal(tests.length, 1); assert.equal(tests[0].to, 'recipient@example.test'); assert.equal(Object.hasOwn(tests[0].mail, 'hasPassword'), false); assert.equal(Object.hasOwn(tests[0].mail, 'password'), false)
  input('SMTP 密码').props.onChange({ target: { value: 'synthetic-new-smtp-password' } })
  nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(saves[1].mail.password, 'synthetic-new-smtp-password'); assert.equal(Object.hasOwn(saves[1].mail, 'hasPassword'), false)
  props.saving = true; nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); assert.equal(saves.length, 2)
})

function bindingFixture() {
  const h = hooks(), calls = [], navigations = [], timers = new Map(); let timerId = 0
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const request = (path, options = {}) => { const pending = deferred(); calls.push({ path, options, ...pending }); return pending.promise }
  const api = { request, getWechatLoginStatus: id => request(`/status/${id}`), consumeWechatLoginSession: id => request(`/consume/${id}`, { method: 'POST' }), createWechatLoginSession() { throw new Error('Binding must not use login creation') } }
  const flow = compile(read('../lib/studio/wechat-login-flow.ts'), {}, { setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id) })
  const hook = compile(read('../lib/studio/use-wechat-login.ts'), { react: h.react, './api': api, './wechat-login-flow': flow })
  const state = { user: { id: 'user-a' }, backendStatus: 'connected', sessionSettings: { wechatLoginEnabled: true } }
  const store = { useStudio: () => ({ state, refreshSession: async () => { navigations.push('refresh'); return { status: 'connected' } } }) }
  const { AccountWechat } = compile(read('../components/studio/account-wechat.tsx'), { react: h.react, 'lucide-react': ui, '@/lib/studio/api': api, '@/lib/studio/store': store, '@/lib/studio/use-wechat-login': hook, './ui': { ...ui, SectionHeading: 'SectionHeading' }, 'react/jsx-runtime': jsx })
  const render = () => h.render(() => AccountWechat())
  const nodes = () => all(render())
  const tick = () => new Promise(resolve => setImmediate(resolve))
  const status = { bound: false, available: true, appId: 'wx1234567890abcdef', canBind: true }
  const qr = { sessionId: 'binding-a', qrCodeUrl: 'https://qr.example/synthetic', expiresAt: new Date(Date.now() + 60_000).toISOString() }
  return { state, calls, timers, render, nodes, tick, qr, status, unmount: h.unmount,
    async ready() { render(); calls[0].resolve(status); await tick(); render(); render() },
    async start() { nodes().find(node => node.type === 'input' && node.props.type === 'password').props.onChange({ target: { value: 'synthetic-password' } }); render(); return nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) },
  }
}
test('account binding verifies a password once, clears the password and never uses an unauthenticated login QR', async () => {
  const f = bindingFixture(); await f.ready()
  const work = f.start(); await f.tick()
  assert.equal(f.calls[1].path, '/api/account/wechat-official/bind-sessions')
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { password: 'synthetic-password' })
  assert.equal(f.nodes().find(node => node.type === 'input' && node.props.type === 'password').props.value, '')
  f.calls[1].resolve(f.qr); await work; assert.equal(f.calls[2].path, '/status/binding-a')
  f.calls[2].resolve({ status: 'authorized' }); await f.tick(); assert.equal(f.calls[3].path, '/consume/binding-a')
  f.calls[3].resolve({ user: { id: 'user-a' }, returnTo: '/settings', bound: true }); await f.tick()
  assert.equal(f.calls[4].path, '/api/account/wechat-official'); f.calls[4].resolve({ ...f.status, bound: true, canBind: false }); await f.tick()
  assert.ok(f.nodes().some(node => node.type === 'StatusBadge' && node.props.children === '已绑定微信')); assert.equal(f.nodes().some(node => node.type === 'form'), false)
  f.unmount(); assert.equal(f.timers.size, 0)
})
test('account change invalidates a pending binding QR and disabled WeChat exposes no unusable button', async () => {
  const f = bindingFixture(); await f.ready(); const work = f.start(); await f.tick()
  f.state.user.id = 'user-b'; f.render(); f.calls[1].resolve(f.qr); await work; await f.tick()
  assert.equal(f.calls.some(call => call.path === '/status/binding-a'), false)
  assert.equal(f.nodes().some(node => node.type === 'img'), false)
  f.state.sessionSettings.wechatLoginEnabled = false; assert.equal(f.render(), null); f.unmount()
})
