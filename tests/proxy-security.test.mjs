import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Exercise the actual route handler against a disposable upstream, with no DB.
const source = await readFile(new URL('../app/api/[...path]/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const route = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
test('proxy validates configuration and origins, and only trusts one explicitly enabled ingress IP', async () => {
  const names = ['OAOAO_BACKEND_URL', 'OAOAO_PUBLIC_URL', 'OAOAO_TRUST_REVERSE_PROXY']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  let calls = 0
  const server = createServer((req, res) => { calls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ headers: req.headers, url: req.url })) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const upstream = `http://127.0.0.1:${server.address().port}`
  const request = (headers = {}, method = 'GET') => Object.assign(new Request('http://frontend.test/api/probe?a=1', { headers, method }), { nextUrl: new URL('http://frontend.test/api/probe?a=1') })
  try {
    process.env.OAOAO_PUBLIC_URL = 'https://oao.test'
    process.env.OAOAO_BACKEND_URL = '127.0.0.1:3200'
    assert.equal((await route.GET(request())).status, 503)
    process.env.OAOAO_BACKEND_URL = upstream
    delete process.env.OAOAO_TRUST_REVERSE_PROXY
    const forged = { 'x-real-ip': '198.51.100.12', 'x-forwarded-for': '203.0.113.1', forwarded: 'for=203.0.113.2', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' }
    let response = await route.GET(request(forged))
    assert.equal(response.status, 200)
    let payload = await response.json()
    for (const key of Object.keys(forged)) assert.equal(payload.headers[key], undefined, key)
    assert.equal(payload.url, '/api/probe?a=1')
    process.env.OAOAO_TRUST_REVERSE_PROXY = 'true'
    payload = await (await route.GET(request(forged))).json()
    assert.equal(payload.headers['x-forwarded-for'], '198.51.100.12')
    assert.equal(payload.headers['x-real-ip'], undefined)
    for (const ip of ['203.0.113.3, 198.51.100.4', 'spoofed', '']) {
      payload = await (await route.GET(request({ ...forged, 'x-real-ip': ip }))).json()
      assert.equal(payload.headers['x-forwarded-for'], undefined)
    }
    payload = await (await route.GET(request({ ...forged, 'x-real-ip': '2001:db8::1' }))).json()
    assert.equal(payload.headers['x-forwarded-for'], '2001:db8::1')
    const before = calls
    assert.equal((await route.POST(request({ origin: 'https://evil.test' }, 'POST'))).status, 403)
    assert.equal((await route.POST(request({ 'sec-fetch-site': 'cross-site' }, 'POST'))).status, 403)
    assert.equal(calls, before)
    response = await route.POST(request({ origin: 'https://oao.test', referer: 'https://oao.test/login' }, 'POST'))
    payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.headers.origin, upstream)
    assert.equal(payload.headers.referer, upstream + '/')
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]
    await new Promise(resolve => server.close(resolve))
  }
})
