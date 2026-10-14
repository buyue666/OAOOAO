import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(modules, name) ? modules[name] : require(name), module, module.exports)
  return module.exports
}
const announcements = sourceModule('../lib/studio/announcements.ts')
const footer = sourceModule('../lib/studio/site-footer.ts', { './announcements': announcements })
const brand = sourceModule('../lib/studio/site-brand.ts')
const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []

test('footer defaults use the known contact and real routes, hide studio, and invent no registration or social account', () => {
  const value = footer.normalizeSiteFooter(undefined)
  assert.equal(value.showOnStudio, false)
  assert.equal(value.contactEmail, 'siyuesy@gmail.com')
  assert.equal(value.registrationLabel, '')
  assert.equal(value.registrationUrl, '')
  assert.deepEqual(value.socialLinks, [])
  assert.deepEqual(value.productLinks.map(item => item.url), ['/image', '/video', '/canvas', '/agent', '/credits'])
  assert.equal(footer.validateSiteFooter(value), null)
  assert.deepEqual(footer.normalizeSiteFooter({ productLinks: [], description: '', contactEmail: '' }).productLinks, [])
  assert.equal(footer.normalizeSiteFooter({ description: '', contactEmail: '' }).contactEmail, '')
})

test('unsafe and incomplete footer edits are rejected before normalization; old malformed public settings remain inert', () => {
  const base = footer.normalizeSiteFooter({})
  for (const url of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'https://user:pw@example.com', 'data:text/html,abc', 'https://example.com/\nsecret', 'x'.repeat(2049)]) {
    assert.ok(footer.validateSiteFooter({ ...base, socialLinks: [{ label: 'Social', url }] }))
    assert.deepEqual(footer.normalizeSiteFooter({ socialLinks: [{ label: 'Social', url }] }).socialLinks, [])
  }
  assert.ok(footer.validateSiteFooter({ ...base, productLinks: [{ label: '', url: '/image' }] }))
  assert.ok(footer.validateSiteFooter({ ...base, registrationUrl: 'https://example.com' }))
  assert.ok(footer.validateSiteFooter({ ...base, contactEmail: 'bad\r\nBcc@example.com' }))
  assert.ok(footer.validateSiteFooter({ ...base, socialLinks: Array.from({ length: 9 }, () => ({ label: 'x', url: '/image' })) }))
  const malformed = footer.normalizeSiteFooter({ socialLinks: [null, 'text', { label: 'x', url: 'javascript:x' }], contactEmail: {}, copyrightHolder: '<script>inert</script>' })
  assert.deepEqual(malformed.socialLinks, [])
  assert.equal(malformed.contactEmail, '')
})

function footerRender(site, props = {}) {
  const { SiteFooter } = sourceModule('../components/site-footer.tsx', {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/studio/store': { useStudio: () => ({ state: { sessionSettings: { site } } }) },
    '@/lib/studio/i18n': { useLocale: () => ({ locale: 'zh-CN', t: () => footer.DEFAULT_FOOTER_DESCRIPTION }) },
    '@/lib/studio/site-brand': brand, '@/lib/studio/site-footer': footer,
    './site-brand': { SiteBrand: ({ site }) => React.createElement('img', { alt: brand.resolveSiteBrand(site).title, src: brand.resolveSiteBrand(site).logoUrl }) },
    './site-footer.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
  })
  return renderToStaticMarkup(React.createElement(SiteFooter, props))
}

test('actual footer uses current brand and year, independent legal pages, safe links and optional studio placement', () => {
  const site = { title: '星河', logoUrl: '/custom.png', termsUrl: 'javascript:bad', privacyUrl: 'https://policy.example/privacy', footer: { registrationLabel: '示例备案号', registrationUrl: 'https://records.example/check', socialLinks: [{ label: '<script>bad</script>', url: 'https://social.example/name' }] } }
  const html = footerRender(site)
  assert.match(html, /alt="星河"/)
  assert.ok(html.includes(`© ${new Date().getFullYear()} 星河`))
  assert.match(html, /href="\/terms"/)
  assert.match(html, /href="https:\/\/policy.example\/privacy" target="_blank" rel="noopener noreferrer"/)
  assert.match(html, /mailto:siyuesy%40gmail.com/)
  assert.match(html, /示例备案号/)
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  assert.equal(footerRender(site, { placement: 'studio' }), '')
  assert.match(footerRender({ ...site, footer: { ...site.footer, showOnStudio: true } }, { placement: 'studio' }), /data-site-footer="studio"/)
})

test('footer preview displays unsaved values without any live links, while empty fields stay hidden', () => {
  const html = footerRender({}, { preview: true, site: { title: '未保存品牌', footer: { description: '未保存介绍', contactEmail: '', productLinks: [], socialLinks: [] } } })
  assert.match(html, /未保存品牌/)
  assert.match(html, /未保存介绍/)
  assert.doesNotMatch(html, /<a\b|联系我们|产品与创作|siyuesy|备案号/)
})

function editorHarness(site) {
  const values = [], effects = [], pending = [], writes = []
  let stateIndex = 0, effectIndex = 0, tree, saving = false
  const react = {
    useState(initial) { const index = stateIndex++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }] },
    useEffect(callback, deps) { const index = effectIndex++; if (!effects[index] || deps.some((value, at) => !Object.is(value, effects[index].deps[at]))) { effects[index] = { deps }; pending.push(callback) } },
  }
  const ui = Object.fromEntries(['AdminField', 'AdminInput', 'AdminNotice', 'AdminSaveBar', 'AdminSectionCard', 'AdminTabs', 'AdminTextarea'].map(name => [name, name]))
  const { AdminSiteSettings } = sourceModule('../components/studio/admin-site-settings.tsx', {
    react, 'next/link': 'Link', '@/components/site-brand': { SiteBrand: 'SiteBrand' }, '@/lib/studio/site-brand': brand,
    '@/lib/studio/site-footer': footer, './ui': { ControlButton: 'ControlButton', StatusBadge: 'StatusBadge' }, './admin-kit': ui, './admin-site-footer': { AdminSiteFooter: 'AdminSiteFooter' },
  })
  const render = () => { stateIndex = 0; effectIndex = 0; tree = AdminSiteSettings({ site, saving, onSave: (patch, summary) => writes.push({ patch, summary }), onDirtyChange() {} }); return tree }
  const previousWindow = globalThis.window
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  render(); while (pending.length) pending.shift()(); render()
  return {
    writes, nodes: () => all(tree), render,
    changeFooter(value) { all(tree).find(node => node.type === 'AdminSiteFooter').props.onChange(value); render() },
    submit() { tree.props.onSubmit({ preventDefault() {} }); render() },
    saving() { saving = true; render() },
    cleanup() { globalThis.window = previousWindow },
  }
}

test('actual settings save only the edited normalized footer; cancel and pending save cannot write', () => {
  const f = editorHarness({ title: 'Brand', announcementBar: { enabled: true, text: 'obsolete' }, footer: { showOnStudio: false } })
  try {
    const tabs = f.nodes().find(node => node.type === 'AdminTabs').props.items
    assert.ok(tabs.some(([id]) => id === 'footer'))
    assert.equal(tabs.some(([id]) => id === 'announcement'), false)
    const original = f.nodes().find(node => node.type === 'AdminSiteFooter').props.value
    f.changeFooter({ ...original, description: '  新介绍  ', showOnStudio: true })
    f.submit()
    assert.equal(f.writes.length, 1)
    assert.deepEqual(Object.keys(f.writes[0].patch.site), ['footer'])
    assert.equal(f.writes[0].patch.site.footer.description, '新介绍')
    assert.equal(f.writes[0].patch.site.footer.showOnStudio, true)
    f.nodes().find(node => node.type === 'ControlButton' && node.props.children === '撤销更改').props.onClick(); f.render()
    assert.equal(f.nodes().find(node => node.type === 'AdminSiteFooter').props.value.description, original.description)
    f.changeFooter({ ...original, description: 'pending' }); f.saving(); f.submit()
    assert.equal(f.writes.length, 1)
  } finally { f.cleanup() }
})

test('invalid footer draft selects its tab and stays editable without sending a save', () => {
  const f = editorHarness({})
  try {
    const original = f.nodes().find(node => node.type === 'AdminSiteFooter').props.value
    f.changeFooter({ ...original, socialLinks: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] })
    f.submit()
    assert.equal(f.writes.length, 0)
    assert.equal(f.nodes().find(node => node.type === 'AdminTabs').props.value, 'footer')
    assert.equal(f.nodes().find(node => node.type === 'AdminSiteFooter').props.value.socialLinks[0].url, 'javascript:alert(1)')
    assert.ok(f.nodes().find(node => node.type === 'AdminNotice'))
  } finally { f.cleanup() }
})

test('confirmed footer updates survive older session responses and never broadcast private settings or the old fallback banner', () => {
  const sync = sourceModule('../lib/studio/site-brand-sync.ts', { './site-brand': brand, './site-footer': footer }).createSiteBrandSync()
  let received
  sync.subscribe(value => { received = value })
  const before = sync.getRevision()
  sync.publish({ title: 'Brand', logoUrl: '', iconUrl: '', footer: { description: 'New', showOnStudio: true, secret: 'hidden' }, termsUrl: '/terms', apiKey: 'hidden', announcementBar: { enabled: true } })
  assert.equal(received.footer.description, 'New')
  assert.equal(received.footer.showOnStudio, true)
  assert.equal(received.footer.secret, undefined)
  assert.equal(received.apiKey, undefined)
  assert.equal(received.announcementBar, undefined)
  const merged = sync.merge({ site: { footer: { description: 'Old' } }, operationMode: 'self_use' }, before)
  assert.equal(merged.site.footer.description, 'New')
  assert.equal(merged.operationMode, 'self_use')
})

test('homepage banner never renders the stored legacy fallback and still renders a published managed announcement', () => {
  let items = []
  const { HomepageAnnouncement } = sourceModule('../components/homepage-announcement.tsx', {
    '@/components/site-announcements': { useAnnouncements: () => ({ items, loading: false, error: null, open() {} }) },
    '@/components/site-announcement-bar': { SiteAnnouncementBar: 'SiteAnnouncementBar' }, '@/lib/studio/announcements': announcements,
  })
  assert.equal(HomepageAnnouncement({ placement: 'landing' }), null)
  items = [{ id: 'published', title: 'Official', content: 'Body', enabled: true, popupHome: true, createdAt: '2026-01-01' }]
  assert.equal(HomepageAnnouncement({ placement: 'landing' }).props.announcement.text, 'Official')
})
