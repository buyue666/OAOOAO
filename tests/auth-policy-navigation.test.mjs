import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function compile(path, imports = {}, globals = {}) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', ...Object.keys(globals), ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(module, module.exports, name => { assert.ok(name in imports, name); return imports[name] }, ...Object.values(globals))
  return module.exports
}
const policy = compile('lib/studio/auth-policy.ts')

function browserFixture(path = '/register?ref=invitation&next=%2Fcanvas') {
  let url = new URL(path, 'https://oao.example'), index = 0
  const entries = [{ state: { __NA: true }, url: url.href }], listeners = new Set(), moves = []
  const set = value => { url = new URL(value, url); Object.assign(target.location, { origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash, href: url.href }) }
  const target = { location: {}, addEventListener(name, callback) { assert.equal(name, 'popstate'); listeners.add(callback) }, removeEventListener(_name, callback) { listeners.delete(callback) }, setTimeout() { return 1 }, clearTimeout() {}, history: { get state() { return entries[index].state }, pushState(state, _title, href) { entries.splice(index + 1); entries.push({ state, url: new URL(href, url).href }); index++; set(href) }, replaceState(state, _title, href) { entries[index] = { state, url: new URL(href, url).href }; set(href) }, back() { moves.push('back'); if (index) { index--; set(entries[index].url); for (const callback of listeners) callback() } }, forward() { if (index < entries.length - 1) { index++; set(entries[index].url); for (const callback of listeners) callback() } } } }
  set(path)
  return { target, entries, moves, listeners }
}

test('policy routes only retain auth navigation context and never accept external return destinations', () => {
  assert.equal(policy.authPolicyReturnPath('/register?ref=hello&email=private&password=secret&next=%2Fcanvas'), '/register?ref=hello&next=%2Fcanvas')
  for (const bad of ['//evil.example', '/\\evil.example', '/assets', '/terms', 'https://evil.example/register', '/register\n']) assert.equal(policy.authPolicyReturnPath(bad), null)
  assert.equal(policy.authPolicyReturnLabel('/register?ref=hello'), '返回注册')
  assert.equal(policy.authPolicyReturnLabel('/forgot-password'), '返回找回密码')
})

test('internal policy links support a form-preserving reader; external links use a new tab fallback', () => {
  const result = policy.authPolicyLink('terms', 'https://oao.example/terms', '/register?ref=hello', 'https://oao.example')
  assert.deepEqual(result, { href: '/terms?returnTo=%2Fregister%3Fref%3Dhello', inline: true })
  assert.deepEqual(policy.authPolicyLink('privacy', 'https://policy.example/privacy', '/register', 'https://oao.example'), { href: 'https://policy.example/privacy', inline: false })
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example']) assert.equal(policy.authPolicyLink('terms', bad, '/register', 'https://oao.example').inline, true)
})

test('browser Back closes reading before leaving registration; policy tabs use one history entry', () => {
  const b = browserFixture(), states = [], reader = policy.createAuthPolicyNavigation(b.target, kind => states.push(kind))
  reader.open('terms'); assert.equal(b.entries.length, 2); assert.equal(b.target.location.pathname, '/register'); assert.equal(b.target.history.state.__NA, true)
  reader.open('privacy'); assert.equal(b.entries.length, 2); assert.equal(b.target.location.hash, '#policy-privacy')
  b.target.history.back(); assert.equal(states.at(-1), null); assert.equal(b.target.location.pathname, '/register'); assert.equal(b.target.location.hash, '')
  b.target.history.forward(); assert.equal(states.at(-1), 'privacy')
  reader.close(); assert.equal(states.at(-1), null); assert.equal(b.target.location.pathname, '/register')
  reader.dispose(); assert.equal(b.listeners.size, 0)
})

const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''

function authFixture(mode = 'register', extraSettings = {}) {
  const slots = [], effects = []; let cursor = 0
  const b = browserFixture('/' + (mode === 'reset' ? 'forgot-password' : mode) + '?ref=invite-42&next=%2Fcanvas')
  const calls = { register: [], login: [], codes: [], router: [] }
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useEffect(callback, deps) { const i = cursor++; const prior = slots[i]; if (!prior || deps.some((value, j) => value !== prior.deps[j])) { slots[i] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = callback() }) } },
  }
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  const icons = new Proxy({}, { get: (_, name) => String(name) })
  const reader = compile('components/legal/auth-policy-reader.tsx', { react, 'react/jsx-runtime': jsx, 'lucide-react': icons, '@/components/ui/dialog': {}, '@/lib/studio/auth-policy': policy, './published-policy': { policyTitle: kind => kind === 'terms' ? '服务条款' : '隐私政策' } }, { window: b.target })
  class StudioApiError extends Error {}
  const api = compile('components/studio/login-page.tsx', {
    react, 'react/jsx-runtime': jsx, 'next/link': { default: 'Link' }, 'next/navigation': { useRouter: () => ({ replace: path => calls.router.push(path) }), useSearchParams: () => new URLSearchParams(b.target.location.search) },
    '@/components/site-brand': { SiteBrand: 'SiteBrand', useSiteBrand: () => ({ title: 'OAO' }) }, 'lucide-react': icons,
    '@/lib/studio/api': { StudioApiError, login: async (...args) => calls.login.push(args) }, '@/lib/studio/account-api': { registerAccount: async input => calls.register.push(input), requestEmailCode: async input => calls.codes.push(input), resetPasswordByEmail: async () => {} },
    '@/lib/studio/use-wechat-login': { useWechatLogin: () => ({ close() {}, begin() {}, retry() {} }) }, '@/lib/studio/store': { useStudio: () => ({ state: { sessionSettings: { site: {}, ...extraSettings } }, refreshSession: async () => {} }) }, '@/lib/studio/i18n': { useLocale: () => ({ t: value => value }) }, '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    './auth-brand-panel': { AuthBrandPanel: 'AuthBrandPanel' }, './auth-fields': { AuthField: 'AuthField', AuthInput: 'AuthInput', AuthPasswordInput: 'AuthPasswordInput' }, './ui': { ControlButton: 'ControlButton', Notice: 'Notice' }, '@/lib/studio/preview-mode': { isStudioPreview: () => false }, '@/components/legal/auth-policy-reader': reader, '@/lib/studio/auth-policy': policy,
  }, { window: b.target, document: { getElementById: () => ({ focus() {} }) } })
  const render = () => { cursor = 0; const tree = api.LoginPage({ mode }); effects.splice(0).forEach(callback => callback()); return tree }
  render()
  const field = id => all(render()).find(node => ['AuthInput', 'AuthPasswordInput', 'input'].includes(node.type) && node.props.id === id)
  const set = (id, value) => field(id).props.onChange({ target: { value, checked: value } })
  const open = (kind, modifiers = {}) => {
    const item = all(render()).find(node => node.type === reader.AuthPolicyLink && node.props.kind === kind)
    assert.ok(item)
    const link = reader.AuthPolicyLink(item.props), event = { button: 0, currentTarget: { id: 'policy-trigger' }, preventDefault() { this.defaultPrevented = true }, ...modifiers }
    link.props.onClick(event)
    return { link, event }
  }
  return { calls, b, render, field, set, open, reader: () => all(render()).find(node => node.type === reader.AuthPolicyReader).props.reader, async submit() { await all(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) } }
}

test('actual registration form renders one consent, keeps every field and cooldown through policy reading', async () => {
  const h = authFixture()
  for (const [id, value] of Object.entries({ 'auth-username': 'SyntheticUser', 'auth-email': 'test@example.invalid', 'auth-email-code': 'synthetic-code', 'auth-password': 'SyntheticOnly!123', 'auth-referral': 'invite-kept' })) h.set(id, value)
  assert.equal(all(h.render()).filter(node => node.type === 'footer').length, 0)
  assert.equal(text(h.render()).split('我已阅读并同意').length - 1, 1)
  await all(h.render()).find(node => node.type === 'ControlButton' && text(node).includes('获取验证码')).props.onClick()
  assert.equal(h.calls.codes.length, 1); assert.match(text(h.render()), /60 秒后重发/)
  const opened = h.open('terms'); assert.equal(opened.event.defaultPrevented, true); assert.equal(h.reader().kind, 'terms')
  h.reader().open('privacy'); assert.equal(h.reader().kind, 'privacy'); h.b.target.history.back()
  assert.equal(h.reader().kind, null); assert.equal(h.b.target.location.pathname, '/register')
  for (const [id, expected] of Object.entries({ 'auth-username': 'SyntheticUser', 'auth-email': 'test@example.invalid', 'auth-email-code': 'synthetic-code', 'auth-password': 'SyntheticOnly!123', 'auth-referral': 'invite-kept' })) assert.equal(h.field(id).props.value, expected)
  assert.match(text(h.render()), /60 秒后重发/); assert.equal(h.field('auth-policy').props.checked, false)
  await h.submit(); assert.equal(h.calls.register.length, 0, 'reading must never count as consent')
  h.set('auth-policy', true); h.open('terms'); h.reader().close(); assert.equal(h.field('auth-policy').props.checked, true)
  assert.equal(h.calls.register.length, 0); assert.equal(h.calls.router.length, 0)
})

test('modified clicks and external policies retain the original form in its tab', () => {
  const h = authFixture('register', { site: { privacyUrl: 'https://policy.example/privacy' } })
  const ctrl = h.open('terms', { ctrlKey: true }); assert.equal(ctrl.event.defaultPrevented, undefined); assert.equal(ctrl.link.props.target, '_blank'); assert.equal(h.reader().kind, null)
  const external = h.open('privacy'); assert.equal(external.event.defaultPrevented, undefined); assert.equal(external.link.props.target, '_blank'); assert.match(external.link.props.rel, /noopener/); assert.equal(h.reader().kind, null)
})

test('login, password recovery and WeChat consent also preserve their form while reading', () => {
  for (const mode of ['login', 'reset']) {
    const h = authFixture(mode); const id = mode === 'login' ? 'auth-password' : 'auth-new-password'; h.set(id, 'SyntheticOnly!123'); h.open('privacy'); h.reader().close(); assert.equal(h.field(id).props.value, 'SyntheticOnly!123'); assert.equal(h.calls.router.length, 0)
  }
  const h = authFixture('login', { wechatLoginEnabled: true, wechatRegistrationEnabled: true })
  assert.equal(all(h.render()).filter(node => node.type === 'footer').length, 0)
})

test('standalone policy pages preserve validated return context across terms and privacy', () => {
  const published = { policyTitle: kind => kind === 'terms' ? '服务条款' : '隐私政策', usePublishedPolicy: () => ({ version: 'test-1' }), PublishedPolicyBody: 'PublishedPolicyBody' }
  const page = compile('components/legal/public-policy-page.tsx', { 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, 'next/link': { default: 'Link' }, 'next/navigation': { useSearchParams: () => new URLSearchParams('returnTo=' + encodeURIComponent('/register?ref=invite-42')) }, '@/components/site-brand': { SiteBrand: 'SiteBrand' }, 'lucide-react': new Proxy({}, { get: (_, key) => key }), '@/lib/studio/store': { useStudio: () => ({ state: { backendStatus: 'unauthenticated' } }) }, '@/lib/studio/auth-policy': policy, './published-policy': published }).PublicPolicyPage({ kind: 'terms' })
  const links = all(page).filter(node => node.type === 'Link')
  assert.equal(links.find(node => text(node) === '返回注册').props.href, '/register?ref=invite-42')
  const next = new URL(links.find(node => text(node) === '隐私政策').props.href, 'https://oao.example'); assert.equal(next.searchParams.get('returnTo'), '/register?ref=invite-42')
})
