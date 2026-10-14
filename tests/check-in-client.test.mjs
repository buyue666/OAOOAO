import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
const code = ts.transpileModule(readFileSync(new URL('../lib/studio/use-check-in.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const tick = () => new Promise(resolve => setImmediate(resolve))
const status = (extra = {}) => ({ enabled: true, claimed: false, rewardPoints: 7, date: '2026-10-14', timeZone: 'Asia/Shanghai', ...extra })
function harness() {
  const slots = []; let cursor = 0, effects = []
  const requests = [], refreshed = [], timers = new Set()
  const react = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useCallback(work, deps) { const i = cursor++; const prior = slots[i]; if (!prior || deps.some((v, x) => !Object.is(v, prior.deps[x]))) slots[i] = { deps, work }; return slots[i].work },
    useEffect(work, deps) { const i = cursor++; const prior = slots[i]; if (!prior || deps.some((v, x) => !Object.is(v, prior.deps[x]))) effects.push(() => { prior?.cleanup?.(); slots[i] = { deps, cleanup: work() } }) },
  }
  const api = { request(path, options = {}) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); requests.push({ path, method: options.method || 'GET', resolve, reject }); return promise } }
  const exports = {}
  new Function('require', 'exports', 'setInterval', 'clearInterval', code)(name => name === 'react' ? react : api, exports, work => { timers.add(work); return work }, work => timers.delete(work))
  const input = { accountId: 'synthetic-a', connected: true, active: true, refreshSession: async () => { refreshed.push(input.accountId); return { status: 'connected' } } }
  return { input, requests, refreshed, timers, render() { cursor = 0; effects = []; const ui = exports.useCheckIn(input); effects.forEach(work => work()); return ui }, unmount() { for (const slot of slots) slot?.cleanup?.() } }
}
async function ready(h, state = status()) { h.render(); assert.equal(h.requests[0].method, 'GET'); h.requests[0].resolve(state); await tick(); return h.render() }

test('check-in reads only when account menu is active and authenticated; no automatic claim', () => {
  const h = harness(); h.input.active = false; h.render(); assert.equal(h.requests.length, 0)
  h.input.active = true; h.input.connected = false; h.render(); assert.equal(h.requests.length, 0)
  h.input.connected = true; h.render(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'GET')
})
test('server disabled and already claimed states cannot submit rewards', async () => {
  for (const state of [status({ enabled: false }), status({ claimed: true })]) {
    const h = harness(); const ui = await ready(h, state); await ui.claim(); assert.equal(h.requests.length, 1)
  }
})
test('simultaneous clicks submit one real claim and refresh session only after confirmed receipt', async () => {
  const h = harness(); const ui = await ready(h); const work = ui.claim(); await ui.claim()
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].method, 'POST'); assert.equal(h.requests[1].path, '/api/account/check-in')
  h.requests[1].resolve(status({ claimed: true, balance: 123 })); await work
  assert.equal(h.render().status.claimed, true); assert.deepEqual(h.refreshed, ['synthetic-a'])
  await ui.claim(); assert.equal(h.requests.filter(row => row.method === 'POST').length, 1)
})
test('late GET and POST replies are ignored after account switches, including balances', async () => {
  const h = harness(); h.render(); h.input.accountId = 'synthetic-b'; assert.equal(h.render().status, undefined)
  h.requests[0].resolve(status({ claimed: true })); await tick(); assert.equal(h.render().status, undefined)
  h.requests[1].resolve(status()); await tick(); const work = h.render().claim()
  h.input.accountId = 'synthetic-c'; h.render(); h.requests[2].resolve(status({ claimed: true })); await work
  assert.equal(h.render().status, undefined); assert.deepEqual(h.refreshed, [])
})
test('lost POST response is reconciled with GET without an automatic second POST', async () => {
  const h = harness(); const ui = await ready(h); const work = ui.claim(); h.requests[1].reject(new Error('response lost')); await tick()
  assert.equal(h.requests[2].method, 'GET'); h.requests[2].resolve(status({ claimed: true })); await work
  assert.equal(h.render().status.claimed, true); assert.equal(h.render().error, '')
  assert.equal(h.requests.filter(row => row.method === 'POST').length, 1)
})
test('unknown failed response never invents success; refresh is available and server day is authoritative', async () => {
  const h = harness(); const ui = await ready(h); const work = ui.claim(); h.requests[1].reject(new Error('response lost')); await tick(); h.requests[2].reject(new Error('offline')); await work
  assert.equal(h.render().status, undefined); assert.match(h.render().error, /response lost/); assert.equal(h.refreshed.length, 0)
  const read = h.render().refresh(); h.requests[3].resolve(status({ date: '2026-10-15', rewardPoints: 12 })); await read
  assert.equal(h.render().status.date, '2026-10-15'); assert.equal(h.render().status.rewardPoints, 12)
})
test('confirmed claim with unsynchronized wallet says so instead of adding guessed points', async () => {
  const h = harness(); h.input.refreshSession = async () => ({ status: 'offline' }); const ui = await ready(h)
  const work = ui.claim(); h.requests[1].resolve(status({ claimed: true })); await work
  assert.equal(h.render().status.claimed, true); assert.match(h.render().error, /余额暂未同步/)
})
test('unmount prevents outstanding claim from refreshing the account and releases the polling timer', async () => {
  const h = harness(); const ui = await ready(h); const work = ui.claim(); h.unmount(); h.requests[1].resolve(status({ claimed: true })); await work
  assert.equal(h.refreshed.length, 0); assert.equal(h.timers.size, 0)
})
