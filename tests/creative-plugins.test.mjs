import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
function load(file, imports = {}) {
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('exports', 'require', code)(exports, name => {
    if (!(name in imports)) throw new Error(`Unmocked dependency: ${name}`)
    return imports[name]
  })
  return exports
}
const releases = JSON.parse(read('lib/studio/creative-plugin-releases.json'))
const versionApi = load('lib/studio/creative-plugin-versions.ts', { './creative-plugin-releases.json': { default: releases } })
const catalog = load('lib/studio/creative-plugins.ts', { './creative-plugin-releases.json': { default: releases } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
test('catalog uses independent release metadata for upgraded plugins', () => {
  for (const id of ['canvas','drama']) {
    const plugin=catalog.creativePlugin(id)
    assert.equal(plugin.version,releases[id].version)
    assert.notEqual(plugin.version,'0.1.0')
    assert.deepEqual(plugin.notes,releases[id].notes)
    assert.equal(plugin.releasedAt,releases[id].releasedAt)
  }
  assert.equal(catalog.creativePlugin('director').version,'0.1.0')
  assert.equal(catalog.creativePlugin('tryon').version,'0.1.0')
})

test('catalog filters tools by category, installation and user search', () => {
  const { creativePlugins, matchesPlugin, normalizeInstalledPlugins } = catalog
  assert.deepEqual(normalizeInstalledPlugins(['unknown', 'director', 'tryon', 'tryon']), ['tryon'])
  assert.deepEqual(normalizeInstalledPlugins(['director', 'canvas']), ['director', 'canvas'])
  assert.deepEqual(creativePlugins.filter(plugin => matchesPlugin(plugin, '', '图像工具', false, [])).map(plugin => plugin.id), ['remix', 'tryon'])
  assert.deepEqual(creativePlugins.filter(plugin => matchesPlugin(plugin, '  TRYON  ', '全部', true, ['tryon'])).map(plugin => plugin.id), ['tryon'])
  assert.equal(creativePlugins.filter(plugin => matchesPlugin(plugin, '', '全部', true, [])).length, 0)
})

function providerHarness() {
  let state = { user: { id: 'account-a' }, hydrated: true, backendStatus: 'connected', sessionSettings: { installedPlugins: [] } }
  const slots = [], requests = [], refreshes = []
  let cursor = 0
  const next = initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return index }
  const react = {
    createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
    useState: initial => { const index = next(initial); return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef: initial => slots[next(() => ({ current: initial }))], useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
  }
  const { PluginProvider } = load('lib/studio/plugin-context.tsx', {
    react, 'react/jsx-runtime': jsxRuntime, 'next/navigation': { useRouter: () => ({ refresh: () => refreshes.push('route') }) },
    './store': { useStudio: () => ({ state, refreshSession: async () => refreshes.push('session') }) }, './creative-plugins': catalog, './creative-plugin-versions': versionApi,
    './api': { request: (url, options) => { const pending = deferred(); requests.push({ url, options, ...pending }); return pending.promise } },
  })
  const render = () => { cursor = 0; return PluginProvider({ children: null }).props.value }
  return { render, requests, refreshes, account(id, installedPlugins = []) { state = { ...state, user: { id }, sessionSettings: { installedPlugins } } }, offline() { state = { ...state, backendStatus: 'offline' } } }
}

test('installation becomes usable only after confirmation and failures keep the previous state', async () => {
  const h = providerHarness()
  assert.deepEqual(h.render().installed, [])
  const install = h.render().setInstalled('tryon', true)
  assert.deepEqual(h.render().installed, [])
  assert.equal(h.render().pending, 'tryon')
  assert.equal(await h.render().setInstalled('remix', true), false, 'Repeated click cannot submit another toggle')
  h.requests[0].resolve({ installedPlugins: ['tryon'] })
  assert.equal(await install, true)
  assert.equal(h.render().isInstalled('tryon'), true)
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { pluginId: 'tryon', installed: true })
  const remove = h.render().setInstalled('tryon', false)
  h.requests[1].reject(new Error('Synthetic unavailable service'))
  assert.equal(await remove, false)
  assert.equal(h.render().isInstalled('tryon'), true)
  assert.match(h.render().error, /unavailable/)
})

test('switching accounts never exposes old installations or accepts delayed writes', async () => {
  const h = providerHarness()
  const old = h.render().setInstalled('director', true)
  h.account('account-b', ['remix'])
  assert.deepEqual(h.render().installed, ['remix'])
  h.requests[0].resolve({ installedPlugins: ['canvas', 'director'] })
  assert.equal(await old, false)
  assert.deepEqual(h.render().installed, ['remix'])
  assert.deepEqual(h.refreshes, [])
  h.offline()
  assert.deepEqual(h.render().installed, [])
})

test('public director only accepts the bundled 0.1 version and confirms saves on the server', async () => {
  const h=providerHarness()
  assert.equal(h.render().directorVersion,'0.1.0')
  assert.equal(versionApi.directorVersions.length,1)
  const changed=h.render().setDirectorVersion('0.1.0',true)
  assert.equal(h.render().directorVersion,'0.1.0')
  h.requests[0].resolve({installedPlugins:['canvas','director'],pluginPreferences:{director:{version:'0.1.0',autoUpdate:true}}})
  assert.equal(await changed,true)
  assert.equal(h.render().preferences.director.autoUpdate,true)
})

test('delayed rollback from another account cannot replace the active account version', async () => {
  const h=providerHarness(),change=h.render().setDirectorVersion('0.1.0')
  h.account('account-b',['canvas','director'])
  assert.equal(h.render().directorVersion,'0.1.0')
  h.requests[0].resolve({installedPlugins:['canvas','director'],pluginPreferences:{director:{version:'0.1.0',autoUpdate:false}}})
  assert.equal(await change,false)
  assert.equal(h.render().directorVersion,'0.1.0')
  assert.deepEqual(h.refreshes,[])
})

test('tools open without legacy installation, while authentication and workspace boundaries still gate heavy children', () => {
  let identity = null
  let ready = true
  let state = { hydrated: true, backendStatus: 'connected' }
  const imports = { 'react/jsx-runtime': jsxRuntime, 'next/link': 'Link', 'lucide-react': {},
    '@/lib/studio/plugin-context': { usePlugins: () => ({ installed: [], isInstalled: () => false, ready }) },
    '@/lib/studio/store': { useStudio: () => ({ state }) },
    '@/lib/studio/creative-plugins': catalog, '@/lib/studio/i18n': { useUiText: () => text => text }, './plugin-icon': { PluginIcon: 'PluginIcon' },
    '@/lib/studio/workspace-context': { useWorkspace: () => ({ identity, href: target => target }) },
    '@/lib/studio/workspace-features': load('lib/studio/workspace-features.ts', { './creative-plugins': catalog, './workspace-navigation': load('lib/studio/workspace-navigation.ts') }),
  }
  const { PluginGate } = load('components/studio/plugins/plugin-gate.tsx', imports)
  const child = jsxRuntime.jsx('ExpensiveTool', {})
  assert.equal(PluginGate({ id: 'canvas', children: child }), child)
  assert.equal(PluginGate({ id: 'tryon', children: child }), child)
  ready = false
  state = { hydrated: true, backendStatus: 'unauthenticated' }
  assert.notEqual(PluginGate({ id: 'tryon', children: child }), child)
  state = { hydrated: false, backendStatus: 'checking' }
  assert.notEqual(PluginGate({ id: 'canvas', children: child }), child)
  ready = true
  state = { hydrated: true, backendStatus: 'connected' }
  identity = { teamId:'11111111-1111-4111-8111-111111111111' }
  assert.notEqual(PluginGate({ id: 'agent', children: child }), child)
  assert.equal(PluginGate({ id: 'canvas', children: child }), child)
})

test('the tool directory links directly to tools, groups by purpose and never requires an enable action', () => {
  let identity = null
  let chosenCategory = '全部', query = ''
  const features = load('lib/studio/workspace-features.ts', { './creative-plugins': catalog, './workspace-navigation': load('lib/studio/workspace-navigation.ts') })
  const { PluginCenter } = load('components/studio/plugins/plugin-center.tsx', {
    react: { useState: initial => initial === '' ? [query, value => { query = value }] : [chosenCategory, value => { chosenCategory = value }] },
    'react/jsx-runtime': jsxRuntime, 'next/image': { default: 'Image' }, 'next/link': { default: 'Link' }, 'lucide-react': {},
    '@/lib/studio/creative-plugins': catalog, '@/lib/studio/plugin-context': { usePlugins: () => ({ ready: true, preferences: {}, installed: [], directorVersion: '0.1.0' }) },
    '@/lib/studio/workspace-context': { useWorkspace: () => ({ identity }) }, '@/lib/studio/workspace-features': features,
    '@/lib/studio/i18n': { useUiText: () => (text, values = []) => text.replace(/\{(\d+)\}/g, (_, index) => String(values[index])) },
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './director-version-control': { DirectorVersionControl: 'VersionControl' },
  })
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
  let tree = nodes(PluginCenter())
  const links = tree.filter(node => node.props?.['aria-label']?.startsWith('使用 '))
  assert.equal(links.length, 6)
  assert.ok(links.every(link => link.props.prefetch === false))
  assert.equal(links.find(link => link.props['aria-label'] === '使用 AI 换装').props.href, '/tools/tryon')
  assert.ok(!tree.some(node => /启用|关闭/.test(String(node.props?.['aria-label'] || ''))))
  assert.ok(tree.some(node => node.type === 'VersionControl'))
  assert.ok(tree.filter(node => node.type === 'details').every(node => !node.props.open))
  chosenCategory = '图像工具'
  tree = nodes(PluginCenter())
  assert.equal(tree.filter(node => node.props?.['data-plugin']).length, 2)
  query = '不存在的工具'
  assert.equal(nodes(PluginCenter()).filter(node => node.props?.['data-plugin']).length, 0)
  query = ''; chosenCategory = '全部'
  identity = { teamId: '11111111-1111-4111-8111-111111111111' }
  tree = nodes(PluginCenter())
  assert.equal(tree.filter(node => node.props?.['aria-label']?.startsWith('使用 ')).length, 2)
  assert.ok(!tree.some(node => node.props?.href === '/tools/tryon'))
})
