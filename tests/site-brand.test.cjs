const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const plain = (value) => JSON.parse(JSON.stringify(value))
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

// Run production modules, including the real request wrapper and React component.
function modules({ site, fetch = () => { throw new Error('Unexpected network request') } } = {}) {
  const cache = new Map()
  const browser = new EventTarget()
  const document = new EventTarget()
  document.visibilityState = 'visible'
  class BrandEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail } }
  function load(file) {
    const absolute = path.resolve(__dirname, '..', file)
    if (cache.has(absolute)) return cache.get(absolute).exports
    const module = { exports: {} }; cache.set(absolute, module)
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(source, {
      module, exports: module.exports, URL, URLSearchParams, Headers, Response, Error, fetch, window: browser, document, CustomEvent: BrandEvent,
      require: (name) => {
        if (name === '@/lib/studio/store') return { useStudio: () => ({ state: { sessionSettings: { site } } }) }
        if (name === 'next/navigation') return { usePathname: () => '/studio' }
        if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`)
        if (name.startsWith('./')) return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(absolute), `${name}.ts`)))
        if (['react', 'react/jsx-runtime', 'clsx', 'tailwind-merge'].includes(name)) return require(name)
        throw new Error(`Unexpected module: ${name}`)
      },
    }, { filename: absolute })
    return module.exports
  }
  return { brand: load('lib/studio/site-brand.ts'), sync: load('lib/studio/site-brand-sync.ts'), api: load('lib/studio/admin-api.ts'), sessionApi: load('lib/studio/api.ts'), component: load('components/site-brand.tsx'), browser, document }
}

test('brand image URLs reject executable, temporary, malformed and credential-bearing inputs', () => {
  const { brand } = modules()
  for (const value of [undefined, {}, '', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'blob:https://example.com/a', '//example.com/a.png', '/\\example.com/a.png', 'https://u:p@example.com/a.png', 'file:///a.png', 'https:\n//example.com/a.png', 'relative.png']) assert.equal(brand.safeBrandImageUrl(value), '', String(value))
  for (const value of ['/api/reference-assets/brand.png', '/media/logo.svg?v=2', 'https://cdn.example.com/logo.png', 'http://localhost/logo.png']) assert.equal(brand.safeBrandImageUrl(` ${value} `), value)
})

test('empty and exact legacy defaults use full brand assets without replacing custom addresses', () => {
  const { brand } = modules()
  const empty = brand.resolveSiteBrand()
  assert.equal(empty.logoUrl, brand.DEFAULT_SITE_LOGO)
  assert.equal(empty.iconUrl, brand.DEFAULT_SITE_ICON)
  assert.equal(empty.title, 'OAO')
  const old = brand.resolveSiteBrand({ title: ' OAOOAO ', logoUrl: '/logo.svg', iconUrl: '/icon.svg' })
  assert.equal(old.title, 'OAOOAO'); assert.equal(old.logoUrl, brand.DEFAULT_SITE_LOGO); assert.equal(old.iconUrl, brand.DEFAULT_SITE_ICON)
  assert.equal(old.logoFallbackReason, 'legacy'); assert.equal(old.customLogo, false)
  for (const logoUrl of ['/logo.svg?v=my-upload', 'https://cdn.example.com/logo.svg', '/my-logo.svg']) {
    const custom = brand.resolveSiteBrand({ logoUrl })
    assert.equal(custom.logoUrl, logoUrl); assert.equal(custom.customLogo, true)
  }
})

test('default imagery follows its background while custom imagery retains original colors', () => {
  const { brand } = modules()
  assert.equal(brand.defaultBrandFilter('light', false), '')
  assert.equal(brand.defaultBrandFilter('dark', false), 'invert')
  assert.equal(brand.defaultBrandFilter('theme', false), 'dark:invert')
  for (const tone of ['light', 'dark', 'theme']) assert.equal(brand.defaultBrandFilter(tone, true), '')
})

test('actual SiteBrand renders session branding, safe fallbacks and explicit preview overrides', () => {
  const { component, brand } = modules({ site: { title: '星河工作室', logoUrl: 'https://cdn.example.com/logo.png' } })
  const render = (props) => renderToStaticMarkup(React.createElement(component.SiteBrand, props))
  const custom = render({ tone: 'dark', showTitle: true })
  assert.match(custom, /星河工作室/); assert.match(custom, /src="https:\/\/cdn\.example\.com\/logo\.png"/)
  assert.doesNotMatch(custom, /invert/)
  const preview = render({ site: { title: '预览品牌', logoUrl: 'javascript:alert(1)' }, showFallbackNotice: true })
  assert.ok(preview.includes(brand.DEFAULT_SITE_LOGO)); assert.match(preview, /预览品牌/); assert.match(preview, /图片地址无效/)
  assert.doesNotMatch(preview, /javascript:/)
  const legacy = render({ site: { logoUrl: '/logo.svg' }, showFallbackNotice: true })
  assert.match(legacy, /旧默认地址已兼容/); assert.ok(legacy.includes(brand.DEFAULT_SITE_LOGO))
})

test('late session responses preserve a newly saved brand but retain fresh session settings', () => {
  const { sync } = modules()
  const controller = sync.createSiteBrandSync()
  const received = []
  const unsubscribe = controller.subscribe((value) => received.push(plain(value)))
  const beforeSave = controller.getRevision()
  const prior = { site: { title: '旧站点', logoUrl: '/old.png', termsContent: '服务器政策' }, modelPointCosts: { image: 12 }, operationMode: 'commercial' }
  controller.publish({ title: '新站点', logoUrl: '/new.png', iconUrl: '/new-icon.png', apiKey: 'must-not-broadcast' })
  const merged = controller.merge(prior, beforeSave)
  assert.equal(merged.site.title, '新站点'); assert.equal(merged.site.logoUrl, '/new.png')
  assert.equal(merged.site.termsContent, '服务器政策'); assert.equal(merged.modelPointCosts.image, 12)
  assert.equal(prior.site.title, '旧站点')
  assert.deepEqual(received, [{ title: '新站点', logoUrl: '/new.png', iconUrl: '/new-icon.png' }])
  const afterSave = controller.getRevision()
  assert.equal(controller.merge(prior, afterSave), prior, 'a later fresh GET remains authoritative')
  unsubscribe(); controller.publish({ title: '再次保存' }); assert.equal(received.length, 1)
})

test('brand sync controllers are isolated and an empty saved brand restores defaults', () => {
  const { sync, brand } = modules()
  const one = sync.createSiteBrandSync(); const two = sync.createSiteBrandSync()
  one.publish({ title: '', logoUrl: '', iconUrl: '' })
  assert.equal(two.getRevision(), 0)
  const resolved = brand.resolveSiteBrand(one.merge(undefined, 0).site)
  assert.equal(resolved.logoUrl, brand.DEFAULT_SITE_LOGO); assert.equal(resolved.iconUrl, brand.DEFAULT_SITE_ICON)
  assert.equal(two.merge(undefined, 0), undefined)
})

test('real admin save publishes only confirmed branding and no administrator secrets', async () => {
  const calls = []
  const { api, sync, browser } = modules({ fetch: async (url, options) => {
    calls.push({ url, options })
    return json({ settings: { site: { title: '已保存', logoUrl: '/saved.png', iconUrl: '/saved-icon.png', termsContent: 'do-not-publish' }, mail: { password: 'secret' } } })
  } })
  const events = []
  browser.addEventListener(sync.SITE_BRAND_SAVED_EVENT, (event) => events.push(plain(event.detail)))
  const response = await api.updateAdminSettings({ site: { title: '请求值' } })
  assert.equal(calls[0].url, '/api/admin/settings'); assert.equal(calls[0].options.method, 'PATCH')
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(response.settings.site.title, '已保存')
  assert.deepEqual(events, [{ title: '已保存', logoUrl: '/saved.png', iconUrl: '/saved-icon.png' }])
  await api.updateAdminSettings({ operationMode: 'commercial' })
  assert.equal(events.length, 1, 'an unrelated in-flight settings save must not roll branding back')
})

test('failed or invalid admin responses never publish a brand update', async () => {
  for (const response of [() => json({ error: 'forbidden' }, 403), () => json({ code: 409, msg: 'conflict', settings: { site: { title: 'wrong' } } }), () => json({}), () => json({ settings: [] })]) {
    const { api, sync, browser } = modules({ fetch: async () => response() })
    let events = 0
    browser.addEventListener(sync.SITE_BRAND_SAVED_EVENT, () => { events += 1 })
    await assert.rejects(api.updateAdminSettings({ site: { title: '待保存' } }))
    assert.equal(events, 0)
  }
})

function broadcastFixture() {
  const instances = []
  const sent = []
  class Channel {
    constructor(name) { this.name = name; this.closed = false; this.onmessage = null; instances.push(this) }
    postMessage(data) {
      sent.push(plain(data))
      for (const peer of instances) if (peer !== this && peer.name === this.name) queueMicrotask(() => {
        if (!peer.closed) peer.onmessage?.({ data: plain(data) })
      })
    }
    close() { this.closed = true }
  }
  return { Channel, instances, sent }
}

test('a confirmed brand save reaches another tab once and protects both tabs from older GETs', async () => {
  const hub = broadcastFixture()
  const serverSite = { title: '跨标签新品牌', logoUrl: '/new-logo.png', iconUrl: '/new-icon.png', secret: 'never-broadcast' }
  const first = modules({ fetch: async () => json({ settings: { site: serverSite } }) })
  const second = modules()
  first.browser.BroadcastChannel = hub.Channel; second.browser.BroadcastChannel = hub.Channel
  const controllers = [first.sync.createSiteBrandSync(), second.sync.createSiteBrandSync()]
  const received = [[], []]
  controllers.forEach((controller, index) => controller.subscribe((site) => received[index].push(plain(site))))
  const disconnectFirst = first.sync.subscribeSiteBrandUpdates((site) => controllers[0].publish(site))
  const disconnectSecond = second.sync.subscribeSiteBrandUpdates((site) => controllers[1].publish(site))
  const revisions = controllers.map((controller) => controller.getRevision())
  await first.api.updateAdminSettings({ site: { title: '提交品牌' } })
  await Promise.resolve()
  assert.equal(hub.sent.length, 1, 'receiving a broadcast must not send it again')
  const expected = { title: serverSite.title, logoUrl: serverSite.logoUrl, iconUrl: serverSite.iconUrl }
  assert.deepEqual(hub.sent[0], { version: 1, site: expected })
  assert.deepEqual(received, [[expected], [expected]])
  for (const [index, controller] of controllers.entries()) {
    const stale = { site: { title: '旧品牌', termsContent: '当前服务器政策' }, modelPointCosts: { image: 99 } }
    const merged = controller.merge(stale, revisions[index])
    assert.equal(merged.site.title, expected.title)
    assert.equal(merged.site.termsContent, '当前服务器政策')
    assert.equal(merged.modelPointCosts.image, 99)
    assert.equal(controller.merge(stale, controller.getRevision()), stale, 'later server reads remain authoritative')
  }
  disconnectFirst(); disconnectSecond()
  assert.ok(hub.instances.every((channel) => channel.closed && channel.onmessage === null))
  first.sync.publishSiteBrandSettings({ title: '卸载后通知' })
  await Promise.resolve()
  assert.equal(received[0].length, 1); assert.equal(received[1].length, 1); assert.equal(hub.sent.length, 1)
})

test('broadcast inputs validate version and public field types before changing branding', () => {
  const hub = broadcastFixture()
  const { browser, sync } = modules(); browser.BroadcastChannel = hub.Channel
  const received = []
  const disconnect = sync.subscribeSiteBrandUpdates((site) => received.push(plain(site)))
  const channel = hub.instances[0]
  for (const data of [null, [], { version: 2, site: {} }, { version: 1, site: { title: 'missing' } }, { version: 1, site: { title: {}, logoUrl: '', iconUrl: '' } }, { version: 1, site: { title: 'a'.repeat(161), logoUrl: '', iconUrl: '' } }]) channel.onmessage({ data })
  assert.equal(received.length, 0)
  channel.onmessage({ data: { version: 1, site: { title: '合法品牌', logoUrl: '/logo.png', iconUrl: '/icon.png', token: 'strip-me' } } })
  assert.deepEqual(received, [{ title: '合法品牌', logoUrl: '/logo.png', iconUrl: '/icon.png' }])
  assert.equal(hub.sent.length, 0)
  disconnect()
})

test('missing or failing BroadcastChannel retains local updates and clean unsubscription', () => {
  for (const Channel of [undefined, class { constructor() { throw new Error('disabled') } }, class { postMessage() { throw new Error('closed') } close() { throw new Error('already closed') } }]) {
    const { browser, sync } = modules(); browser.BroadcastChannel = Channel
    const received = []
    const disconnect = sync.subscribeSiteBrandUpdates((site) => received.push(plain(site)))
    assert.doesNotThrow(() => sync.publishSiteBrandSettings({ title: '本页仍更新', logoUrl: '', iconUrl: '' }))
    assert.equal(received.length, 1)
    assert.doesNotThrow(disconnect)
    sync.publishSiteBrandSettings({ title: '不再接收' })
    assert.equal(received.length, 1)
  }
})

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('returning to a visible tab refreshes real session branding without forwarding account data', async () => {
  const calls = []
  const fixture = modules({ fetch: async (url, options) => {
    calls.push({ url, options })
    return json({ user: { id: 'private-account', pointsBalance: 999 }, settings: { site: { title: '服务器新品牌', logoUrl: '/new.png', iconUrl: '/new-icon.png', termsContent: 'not-a-brand-field' }, modelPointCosts: { image: 90 } } })
  } })
  const { browser, document, sync, sessionApi } = fixture
  const controller = sync.createSiteBrandSync()
  const received = []
  controller.subscribe((site) => received.push(plain(site)))
  const disconnect = sync.subscribeSiteBrandRefresh(controller, async () => (await sessionApi.getSession()).settings?.site)
  document.visibilityState = 'hidden'
  browser.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(calls.length, 0, 'background tabs should not request data')
  document.visibilityState = 'visible'
  document.dispatchEvent(new Event('visibilitychange')); browser.dispatchEvent(new Event('focus'))
  await settle()
  assert.equal(calls.length, 1, 'visibility and focus events share one in-flight request')
  assert.equal(calls[0].url, '/api/auth/session'); assert.equal(calls[0].options.cache, 'no-store')
  assert.deepEqual(received, [{ title: '服务器新品牌', logoUrl: '/new.png', iconUrl: '/new-icon.png' }])
  disconnect(); browser.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(calls.length, 1)
})

test('a slow focus refresh cannot undo a brand saved while it was pending', async () => {
  const { browser, sync } = modules()
  const controller = sync.createSiteBrandSync()
  const received = []
  controller.subscribe((site) => received.push(plain(site)))
  let complete
  const disconnect = sync.subscribeSiteBrandRefresh(controller, () => new Promise((resolve) => { complete = resolve }))
  browser.dispatchEvent(new Event('focus'))
  controller.publish({ title: '刚保存', logoUrl: '/saved.png', iconUrl: '/saved-icon.png' })
  complete({ title: '旧响应', logoUrl: '/old.png', iconUrl: '/old-icon.png' })
  await settle()
  assert.deepEqual(received, [{ title: '刚保存', logoUrl: '/saved.png', iconUrl: '/saved-icon.png' }])
  disconnect()
})

test('failed or missing focus responses keep the brand and subsequent focus can retry', async () => {
  const { browser, sync } = modules()
  const controller = sync.createSiteBrandSync()
  controller.publish({ title: '现有品牌' })
  let attempts = 0
  const disconnect = sync.subscribeSiteBrandRefresh(controller, async () => {
    attempts += 1
    if (attempts === 1) throw new Error('offline')
    if (attempts === 2) return undefined
    return { title: '恢复后的品牌', logoUrl: '', iconUrl: '' }
  })
  browser.dispatchEvent(new Event('focus')); await settle()
  browser.dispatchEvent(new Event('focus')); await settle()
  assert.equal(controller.getRevision(), 1)
  browser.dispatchEvent(new Event('focus')); await settle()
  assert.equal(controller.getRevision(), 2)
  assert.equal(controller.merge(undefined, 0).site.title, '恢复后的品牌')
  disconnect()
})

test('unmounted providers discard a pending focus response', async () => {
  const { browser, sync } = modules()
  const controller = sync.createSiteBrandSync()
  let complete
  const disconnect = sync.subscribeSiteBrandRefresh(controller, () => new Promise((resolve) => { complete = resolve }))
  browser.dispatchEvent(new Event('focus')); disconnect()
  complete({ title: '卸载后数据', logoUrl: '', iconUrl: '' }); await settle()
  assert.equal(controller.getRevision(), 0)
})
