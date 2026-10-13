import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
const checkout = (id, kind = 'manual') => ({ provider: 'manual', orderId: id, orderNo: id, kind, url: kind === 'redirect' ? 'https://payment.invalid/test' : undefined })

// Execute the production React hook and its effects with controlled scheduling and delayed HTTP responses.
function harness() {
  const slots = []; let cursor = 0; let effects = []
  const react = {
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useEffect(work, deps) { const index = cursor++; const prior = slots[index]; if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) effects.push(() => { prior?.cleanup?.(); slots[index] = { deps, cleanup: work() } }) },
  }
  const orders = [], payments = [], queries = [], ready = [], sessions = []
  const api = {
    createBillingOrder(productId, provider) { const next = deferred(); orders.push({ ...next, productId, provider }); return next.promise },
    createCheckout(id, provider) { const next = deferred(); payments.push({ ...next, id, provider }); return next.promise },
    request(path) { const next = deferred(); queries.push({ ...next, path }); return next.promise },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compile(readFileSync(new URL('../lib/studio/use-billing-checkout.ts', import.meta.url), 'utf8')))(name => name === 'react' ? react : api, module, module.exports)
  const input = { accountId: 'account-a', connected: true, onReady: value => ready.push(value), refreshSession: async () => { sessions.push(input.accountId); return { status: 'connected' } } }
  return { input, orders, payments, queries, ready, sessions, render(flush = true) { cursor = 0; effects = []; const result = module.exports.useBillingCheckout(input); if (flush) effects.forEach(work => work()); return result }, unmount() { for (const slot of slots) slot?.cleanup?.() } }
}
async function prepare(h) {
  const promise = h.render().purchase('product-one', 'manual')
  h.orders.at(-1).resolve({ order: { id: 'order-a' } }); await tick()
  h.payments.at(-1).resolve({ checkout: checkout('order-a') }); await promise
  return h.render()
}

test('disconnected users and simultaneous duplicate clicks cannot create extra orders', async () => {
  const h = harness(); h.input.connected = false
  await assert.rejects(h.render().purchase('p', 'manual'), /登录/); assert.equal(h.orders.length, 0)
  h.input.connected = true; const ui = h.render(); const first = ui.purchase('p', 'manual')
  await assert.rejects(ui.purchase('p', 'manual'), /正在处理/); assert.equal(h.orders.length, 1)
  h.orders[0].resolve({ order: { id: 'one' } }); await tick(); h.payments[0].resolve({ checkout: checkout('one') }); await first
  assert.equal(h.ready.length, 1)
})
test('late order creation cannot start checkout for another account', async () => {
  const h = harness(); const first = h.render().purchase('p', 'manual')
  h.input.accountId = 'account-b'; h.render()
  h.orders[0].resolve({ order: { id: 'private-order-a' } }); await first
  assert.equal(h.payments.length, 0); assert.equal(h.ready.length, 0)
  const second = h.render().purchase('p', 'manual'); assert.equal(h.orders.length, 2)
  h.orders[1].resolve({ order: { id: 'order-b' } }); await tick(); h.payments[0].resolve({ checkout: checkout('order-b') }); await second
  assert.equal(h.render().checkout.orderId, 'order-b')
})
test('late checkout cannot reveal old payment data or redirect after account changes', async () => {
  const h = harness(); const first = h.render().purchase('p', 'manual')
  h.orders[0].resolve({ order: { id: 'order-a' } }); await tick()
  h.input.accountId = 'account-b'; assert.equal(h.render(false).checkout, null); h.render()
  h.payments[0].resolve({ checkout: checkout('order-a', 'redirect') }); await first
  assert.equal(h.ready.length, 0); assert.equal(h.render().checkout, null)
})
test('same-account checkout retry, including reconnect, reuses a confirmed order id', async () => {
  const h = harness(); const first = h.render().purchase('p', 'manual')
  h.orders[0].resolve({ order: { id: 'known-order' } }); await tick(); h.payments[0].reject(new Error('network')); await assert.rejects(first)
  h.input.connected = false; h.render(); h.input.connected = true; const again = h.render().purchase('p', 'manual')
  assert.equal(h.orders.length, 1); assert.equal(h.payments[1].id, 'known-order')
  h.payments[1].resolve({ checkout: checkout('known-order') }); await again
  assert.equal(h.render().checkout.orderId, 'known-order')
})
test('uncertain order creation is not silently repeated without an idempotency API', async () => {
  const h = harness(); const first = h.render().purchase('p', 'manual'); h.orders[0].reject(new Error('response lost'))
  await assert.rejects(first, /创建结果暂未确认/)
  await assert.rejects(h.render().purchase('p', 'manual'), /订单记录核对/)
  assert.equal(h.orders.length, 1)
})
test('old payment queries cannot update another account or refresh its session', async () => {
  const h = harness(); const ui = await prepare(h); const query = ui.refreshOrder()
  h.input.accountId = 'account-b'; assert.equal(h.render(false).checkout, null); h.render()
  h.queries[0].resolve({ order: { status: 'paid' } }); await query
  assert.equal(h.sessions.length, 0); assert.equal(h.render().orderStatus, '')
})
test('closing checkout or unmounting invalidates outstanding updates', async () => {
  const h = harness(); const ui = await prepare(h); const query = ui.refreshOrder(); ui.close()
  h.queries[0].resolve({ order: { status: 'paid' } }); await query
  assert.equal(h.render().checkout, null); assert.equal(h.sessions.length, 0)
  const h2 = harness(); const work = h2.render().purchase('p', 'manual'); h2.unmount(); h2.orders[0].resolve({ order: { id: 'late' } }); await work
  assert.equal(h2.payments.length, 0)
})
test('confirmed payment with a failed account refresh is not presented as synchronized', async () => {
  const h = harness(); h.input.refreshSession = async () => ({ status: 'offline', error: 'network' }); const ui = await prepare(h)
  const query = ui.refreshOrder(); h.queries[0].resolve({ order: { status: 'paid' } }); await query
  assert.match(h.render().orderStatus, /支付成功；账户数据暂未同步/)
})

test('the actual topbar activation handler captures current query and hash, including modified clicks', () => {
  const source = readFileSync(new URL('../components/studio/topbar.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('topbar.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const topbar = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Topbar')
  const handler = topbar.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'capturePlansDestination')
  const helpers = { exports: {} }; new Function('module', 'exports', compile(readFileSync(new URL('../lib/studio/return-path.ts', import.meta.url), 'utf8')))(helpers, helpers.exports)
  const location = { pathname: '/projects/real', search: '?section=shots', hash: '#selected-shot' }; const pushes = [], storage = []
  const module = { exports: {} }
  new Function('module', 'exports', 'window', 'router', 'sessionStorage', 'safeReturnPath', 'RETURN_PATH_KEY', compile(`export ${handler.getText(ast)}`))(module, module.exports, { location }, { push: value => pushes.push(value) }, { setItem: (...args) => storage.push(args) }, helpers.exports.safeReturnPath, helpers.exports.RETURN_PATH_KEY)
  const event = { currentTarget: { href: '/plans' }, button: 0, preventDefault() { this.prevented = true } }
  module.exports.capturePlansDestination(event)
  assert.equal(new URL(pushes[0], 'https://local.invalid').searchParams.get('returnTo'), '/projects/real?section=shots#selected-shot')
  location.search = '?section=assets'; const modified = { ...event, currentTarget: { href: '/plans' }, ctrlKey: true, prevented: false }
  module.exports.capturePlansDestination(modified)
  assert.equal(pushes.length, 1); assert.equal(modified.prevented, false)
  assert.equal(new URL(modified.currentTarget.href, 'https://local.invalid').searchParams.get('returnTo'), '/projects/real?section=assets#selected-shot')
})
