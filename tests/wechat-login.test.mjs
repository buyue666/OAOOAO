import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/studio/wechat-login-flow.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture() {
  const timers = new Map(), calls = { create: [], read: [], consume: [], refresh: [], navigate: [], changes: [] }
  let timerId = 0, now = 10_000, active = true
  const module = { exports: {} }
  new Function('module', 'exports', 'setTimeout', 'clearTimeout', 'Date', code)(module, module.exports, fn => { timers.set(++timerId, fn); return timerId }, id => timers.delete(id), { parse: Date.parse, now: () => now })
  const flow = module.exports.createWechatLoginFlow({ active: () => active,
    create(path, policyAccepted) { const request = deferred(); calls.create.push({ ...request, path, policyAccepted }); return request.promise },
    read(id) { const request = deferred(); calls.read.push({ ...request, id }); return request.promise },
    consume(id) { const request = deferred(); calls.consume.push({ ...request, id }); return request.promise },
    refresh() { const request = deferred(); calls.refresh.push(request); return request.promise },
    navigate(path) { calls.navigate.push(path) }, changed(view) { calls.changes.push(view) },
  })
  const qr = (id = 'qr-a', expiresAt = new Date(30_000).toISOString()) => ({ sessionId: id, qrCodeUrl: 'https://qr.example/image', expiresAt })
  async function started() { const request = flow.begin('/studio', true); calls.create.at(-1).resolve(qr()); await request; return flow }
  return { flow, calls, timers, qr, started, setActive: value => { active = value }, setNow: value => { now = value }, runTimer() { const [id, fn] = timers.entries().next().value; timers.delete(id); fn() }, safePath: module.exports.safeLoginReturnPath }
}
test('authorized QR consumes once, remains live during loading, refreshes and navigates after success', async () => {
  const f = fixture(); await f.started(); f.calls.read[0].resolve({ status: 'authorized' }); await tick()
  assert.equal(f.calls.consume.length, 1); assert.equal(f.flow.snapshot().loading, true)
  await f.flow.retry(); assert.equal(f.calls.consume.length, 1)
  f.calls.consume[0].resolve({ user: { id: 'user-a' }, returnTo: '/studio' }); await tick()
  assert.equal(f.calls.refresh.length, 1); f.calls.refresh[0].resolve({ status: 'connected' }); await tick()
  assert.deepEqual(f.calls.navigate, ['/studio']); assert.equal(f.flow.snapshot().loading, false)
})
test('duplicate create clicks share a lock and consent is captured with the QR request', async () => {
  const f = fixture(); const first = f.flow.begin('/studio', true); await f.flow.begin('/other', false)
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.create[0].policyAccepted, true)
  f.calls.create[0].resolve(f.qr()); await first
})
test('polling waits for each response, respects server expiry and does not create a new QR automatically', async () => {
  const f = fixture(); await f.started(); await f.flow.retry(); assert.equal(f.calls.read.length, 1)
  f.calls.read[0].resolve({ status: 'pending' }); await tick(); assert.equal(f.timers.size, 1)
  f.setNow(30_000); f.runTimer(); await tick()
  assert.equal(f.flow.snapshot().status, 'expired'); assert.equal(f.calls.read.length, 1); assert.equal(f.calls.create.length, 1)
})
test('closing QR or leaving login invalidates late creation, status and consumption results', async () => {
  for (const stage of ['create', 'read', 'consume']) {
    const f = fixture(); const begin = f.flow.begin('/studio')
    if (stage === 'create') { f.flow.close(); f.calls.create[0].resolve(f.qr()); await begin }
    else { f.calls.create[0].resolve(f.qr()); await begin
      if (stage === 'read') { f.flow.close(); f.calls.read[0].resolve({ status: 'authorized' }) }
      else { f.calls.read[0].resolve({ status: 'authorized' }); await tick(); f.setActive(false); f.flow.cancel(); f.calls.consume[0].resolve({ user: { id: 'a' }, returnTo: '/studio' }) }
    }
    await tick(); assert.equal(f.calls.refresh.length, 0); assert.equal(f.calls.navigate.length, 0); assert.equal(f.timers.size, 0)
  }
})
test('confirmed consume followed by refresh failure retries refresh without consuming twice', async () => {
  const f = fixture(); await f.started(); f.calls.read[0].resolve({ status: 'authorized' }); await tick()
  f.calls.consume[0].resolve({ user: { id: 'a' }, returnTo: '/settings' }); await tick(); f.calls.refresh[0].resolve({ status: 'offline' }); await tick()
  assert.equal(f.flow.snapshot().retryable, true); assert.equal(f.calls.navigate.length, 0)
  const retry = f.flow.retry(); assert.equal(f.calls.consume.length, 1); f.calls.refresh[1].resolve({ status: 'connected' }); await retry
  assert.deepEqual(f.calls.navigate, ['/settings'])
})
test('lost consume response requires an explicit retry, without a background retry loop', async () => {
  const f = fixture(); await f.started(); f.calls.read[0].resolve({ status: 'authorized' }); await tick()
  f.calls.consume[0].reject(new Error('Network unavailable')); await tick(); assert.equal(f.flow.snapshot().retryable, true); assert.equal(f.timers.size, 0)
  const retry = f.flow.retry(); assert.equal(f.calls.consume.length, 2)
  f.calls.consume[1].resolve({ user: { id: 'a' }, returnTo: '/studio' }); await tick(); f.calls.refresh[0].resolve({ status: 'connected' }); await retry
  assert.deepEqual(f.calls.navigate, ['/studio'])
})
test('status failure can be retried and unlinked users never create or consume an account implicitly', async () => {
  const f = fixture(); await f.started(); f.calls.read[0].reject(new Error('offline')); await tick()
  assert.equal(f.flow.snapshot().retryable, true); const retry = f.flow.retry(); f.calls.read[1].resolve({ status: 'unlinked' }); await retry
  assert.equal(f.flow.snapshot().status, 'unlinked'); assert.equal(f.calls.consume.length, 0); assert.equal(f.timers.size, 0)
})
test('unsafe redirect and malformed QR response do not navigate or begin polling', async () => {
  const f = fixture()
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/x\n']) assert.equal(f.safePath(value), '/studio')
  const begin = f.flow.begin('//evil.example'); assert.equal(f.calls.create[0].path, '/studio'); f.calls.create[0].resolve({ ...f.qr(), expiresAt: 'invalid' }); await begin
  assert.equal(f.calls.read.length, 0); assert.equal(f.flow.snapshot().session, null); assert.ok(f.flow.snapshot().error)
})
