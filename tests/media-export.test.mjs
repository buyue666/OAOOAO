import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../lib/studio/result-delivery.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
new Function('module', 'exports', compiled)(module, module.exports)
const { mediaExportPath, downloadMedia } = module.exports
const id = '12345678-1234-1234-1234-123456789abc'
const origin = 'https://oao.test'

test('exports resolve only the three owned same-origin media routes, stripping bearer query tokens', () => {
  for (const route of ['media', 'reference-assets', 'generation-log-assets']) {
    assert.equal(mediaExportPath(`/api/${route}/${id}?token=private`, origin), `/api/media/${id}/export`)
    assert.equal(mediaExportPath(`${origin}/api/${route}/${id}`, origin), `/api/media/${id}/export`)
  }
  for (const url of [`https://other.test/api/media/${id}`, `//other.test/api/media/${id}`, `/api/users/${id}`, `/api/media/../../account/${id}`, '/api/media/no-uuid', 'javascript:alert(1)', `/api/media/${id}/export`, `https://user:password@oao.test/api/media/${id}`]) assert.equal(mediaExportPath(url, origin), null)
})

test('actual download posts to the export service and uses the transformed MIME; failure never falls back to original', async () => {
  const oldWindow = global.window, oldDocument = global.document, oldFetch = global.fetch
  const calls = [], anchors = []
  global.window = { location: { origin }, setTimeout: callback => callback() }
  global.document = { body: { appendChild() {} }, createElement: () => { const anchor = { click() { anchors.push(this.download) }, remove() {} }; return anchor } }
  try {
    global.fetch = async (url, options) => { if (url === '/api/auth/session') return Response.json({ user: { id: 'account-a' } }); calls.push([url, options]); return new Response(new Blob(['image'], { type: 'image/jpeg' })) }
    const result = await downloadMedia({ url: `/api/reference-assets/${id}`, kind: 'image' }, '作品')
    assert.deepEqual(result, { ok: true, filename: '作品.jpg' })
    assert.equal(calls[0][0], `/api/media/${id}/export`); assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].credentials, 'include')
    assert.deepEqual(anchors, ['作品.jpg'])
    global.fetch = async (...args) => { if (args[0] === '/api/auth/session') return Response.json({ user: { id: 'account-a' } }); calls.push(args); return Response.json({ error: '无法添加标识' }, { status: 422 }) }
    assert.deepEqual(await downloadMedia({ url: `/api/media/${id}`, kind: 'video' }, '视频'), { ok: false, message: '无法添加标识' })
    assert.equal(calls.length, 2)
    assert.equal((await downloadMedia({ url: 'https://unverified.test/video.mp4', kind: 'video' }, '旧作品')).ok, false)
    assert.equal(calls.length, 2)
    assert.deepEqual(anchors, ['作品.jpg'])
  } finally { global.window = oldWindow; global.document = oldDocument; global.fetch = oldFetch }
})

async function withDownloads(run) {
  const oldWindow = global.window, oldDocument = global.document, oldFetch = global.fetch
  const anchors = [], calls = []
  global.window = { location: { origin }, setTimeout: callback => callback() }
  global.document = { body: { appendChild() {} }, createElement: () => ({ click() { anchors.push(this.download) }, remove() {} }) }
  try { await run({ anchors, calls }) } finally { global.window = oldWindow; global.document = oldDocument; global.fetch = oldFetch }
}
const media = { url: `/api/media/${id}`, kind: 'image' }

test('an account switch before exporting does not send the export request', async () => withDownloads(async ({ anchors, calls }) => {
  global.fetch = async (url) => { calls.push(url); return Response.json({ user: { id: 'account-b' } }) }
  const result = await downloadMedia(media, 'A的作品', { accountId: 'account-a' })
  assert.equal(result.ok, false); assert.match(result.message, /账户已切换/)
  assert.deepEqual(calls, ['/api/auth/session']); assert.equal(anchors.length, 0)
}))

test('a cookie switch in another tab during export cancels the downloaded bytes', async () => withDownloads(async ({ anchors, calls }) => {
  let reads = 0
  global.fetch = async (url) => {
    calls.push(url)
    return url === '/api/auth/session'
      ? Response.json({ user: { id: ++reads === 1 ? 'account-a' : 'account-b' } })
      : new Response(new Blob(['private bytes'], { type: 'image/png' }))
  }
  const result = await downloadMedia(media, '旧账户作品', { accountId: 'account-a' })
  assert.equal(result.ok, false); assert.match(result.message, /账户已切换/)
  assert.equal(calls.filter(url => url.endsWith('/export')).length, 1)
  assert.equal(reads, 2); assert.equal(anchors.length, 0)
}))

test('exported bytes are discarded when the final session check fails or the account has logged out', async () => withDownloads(async ({ anchors }) => {
  for (const final of ['offline', 'logged-out']) {
    let reads = 0
    global.fetch = async url => {
      if (url !== '/api/auth/session') return new Response(new Blob(['private bytes'], { type: 'image/png' }))
      if (++reads === 1) return Response.json({ user: { id: 'account-a' } })
      if (final === 'offline') throw new Error('Synthetic network interruption')
      return Response.json({ user: null })
    }
    assert.equal((await downloadMedia(media, '作品', { accountId: 'account-a' })).ok, false)
  }
  assert.equal(anchors.length, 0)
}))

test('aborting while an export resolves never creates a download even if fetch ignores the signal', async () => withDownloads(async ({ anchors }) => {
  const controller = new AbortController()
  global.fetch = async (url, options) => {
    assert.equal(options.signal, controller.signal)
    if (url === '/api/auth/session') return Response.json({ user: { id: 'account-a' } })
    controller.abort()
    return new Response(new Blob(['late bytes'], { type: 'image/png' }))
  }
  const result = await downloadMedia(media, '已取消作品', { signal: controller.signal })
  assert.equal(result.ok, false); assert.match(result.message, /取消/); assert.equal(anchors.length, 0)
}))

test('session verification failures, empty files and successful HTML responses cannot become downloads', async () => withDownloads(async ({ anchors }) => {
  for (const mode of ['expired', 'unknown-session', 'empty', 'html']) {
    global.fetch = async url => {
      if (url === '/api/auth/session') return mode === 'expired' ? Response.json({ user: null }) : mode === 'unknown-session' ? new Response('Unavailable', { status: 503 }) : Response.json({ user: { id: 'account-a' } })
      return new Response(new Blob([mode === 'empty' ? '' : '<html>登录页</html>'], { type: mode === 'html' ? 'text/html' : 'image/png' }))
    }
    assert.equal((await downloadMedia(media, '作品')).ok, false, mode)
  }
  assert.equal(anchors.length, 0)
}))

const buttonCode = ts.transpileModule(readFileSync(new URL('../components/studio/media-download-button.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const tick = () => new Promise(resolve => setImmediate(resolve))
function all(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : [] }
function buttonHarness() {
  let slots = [], cursor = 0, effects = [], key, unmounted = false, lateUpdates = 0
  const account = { id: 'account-a', connected: true }
  const react = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { if (unmounted) lateUpdates++; slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useEffect(work, deps) { const i = cursor++; const prior = slots[i]; if (!prior || deps.some((v, x) => !Object.is(v, prior.deps[x]))) effects.push(() => { prior?.cleanup?.(); slots[i] = { deps, cleanup: work() } }) },
  }
  const exports = {}
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'lucide-react': { Download: 'Download', LoaderCircle: 'LoaderCircle' },
    '@/lib/studio/result-delivery': { downloadMedia },
    '@/lib/studio/store': { useStudio: () => ({ state: { user: { id: account.id }, backendStatus: account.connected ? 'connected' : 'anonymous' } }) },
  }
  new Function('require', 'exports', buttonCode)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, exports)
  function unmount() { for (const slot of slots) slot?.cleanup?.(); unmounted = true }
  return {
    account, unmount, lateUpdates: () => lateUpdates,
    render() {
      const wrapper = exports.MediaDownloadButton({ media, title: '作品' })
      if (key !== wrapper.key) { unmount(); slots = []; key = wrapper.key; unmounted = false }
      cursor = 0; effects = []
      const tree = wrapper.type(wrapper.props)
      effects.forEach(work => work())
      return all(tree)
    },
  }
}

test('the actual download button locks repeated clicks and displays export errors', async () => withDownloads(async ({ anchors }) => {
  let finish, exports = 0
  global.fetch = async url => {
    if (url === '/api/auth/session') return Response.json({ user: { id: 'account-a' } })
    exports++
    return new Promise(resolve => { finish = resolve })
  }
  const h = buttonHarness(), button = h.render().find(node => node.type === 'button')
  button.props.onClick(); button.props.onClick(); await tick()
  assert.equal(exports, 1); assert.equal(h.render().find(node => node.type === 'button').props.disabled, true)
  finish(Response.json({ error: '无法添加标识，请重试' }, { status: 422 })); await tick()
  const nodes = h.render()
  assert.equal(nodes.find(node => node.type === 'button').props.disabled, false)
  assert.equal(nodes.find(node => node.props?.role === 'alert').props.children, '无法添加标识，请重试')
  assert.equal(anchors.length, 0); h.unmount()
}))

test('the actual download button aborts on unmount and ignores a late response', async () => withDownloads(async ({ anchors }) => {
  let finish, signal
  global.fetch = async (url, options) => {
    if (url === '/api/auth/session') return Response.json({ user: { id: 'account-a' } })
    signal = options.signal
    return new Promise(resolve => { finish = resolve })
  }
  const h = buttonHarness(); h.render().find(node => node.type === 'button').props.onClick(); await tick()
  h.unmount(); assert.equal(signal.aborted, true)
  finish(new Response(new Blob(['late bytes'], { type: 'image/png' }))); await tick()
  assert.equal(anchors.length, 0); assert.equal(h.lateUpdates(), 0)
}))

test('the actual download button resets account state and cancels the previous account export', async () => withDownloads(async ({ anchors }) => {
  let finish, signal
  global.fetch = async (url, options) => {
    if (url === '/api/auth/session') return Response.json({ user: { id: 'account-a' } })
    signal = options.signal
    return new Promise(resolve => { finish = resolve })
  }
  const h = buttonHarness(); h.render().find(node => node.type === 'button').props.onClick(); await tick()
  h.account.id = 'account-b'; const next = h.render()
  assert.equal(signal.aborted, true); assert.equal(next.find(node => node.type === 'button').props.disabled, false)
  finish(new Response(new Blob(['old account bytes'], { type: 'image/png' }))); await tick()
  assert.equal(anchors.length, 0); assert.equal(h.render().some(node => node.props?.role === 'alert'), false)
  h.account.connected = false; assert.equal(h.render().find(node => node.type === 'button').props.disabled, true)
  h.unmount()
}))
