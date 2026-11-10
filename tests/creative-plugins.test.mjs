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
const catalog = load('lib/studio/creative-plugins.ts')
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

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
    './store': { useStudio: () => ({ state, refreshSession: async () => refreshes.push('session') }) }, './creative-plugins': catalog,
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

test('uninstalled tool gate does not render its tool subtree', () => {
  const imports = { 'react/jsx-runtime': jsxRuntime, 'next/link': 'Link', 'lucide-react': {},
    '@/lib/studio/plugin-context': { usePlugins: () => ({ installed: [], isInstalled: () => false, ready: true }) },
    '@/lib/studio/creative-plugins': catalog, '@/lib/studio/i18n': { useUiText: () => text => text }, './plugin-icon': { PluginIcon: 'PluginIcon' },
  }
  const { PluginGate } = load('components/studio/plugins/plugin-gate.tsx', imports)
  const child = jsxRuntime.jsx('ExpensiveTool', {})
  const blocked = PluginGate({ id: 'canvas', children: child })
  assert.notEqual(blocked, child)
  assert.equal(blocked.props['data-plugin-gate'], 'canvas')
  imports['@/lib/studio/plugin-context'].usePlugins = () => ({ isInstalled: () => true })
  assert.equal(PluginGate({ id: 'canvas', children: child }), child)
})
