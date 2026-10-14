import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, modules = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => Object.hasOwn(modules, name) ? modules[name] : require(name), module, module.exports, ...Object.values(globals))
  return module.exports
}
const helpers = sourceModule('../lib/studio/site-popups.ts')
const now = Date.parse('2026-10-14T12:00:00Z')
const campaign = { id: 'synthetic-popup', title: 'Activity', content: 'Text', enabled: true, buttonText: 'View', pages: ['home', 'studio'], frequency: 'session', updatedAt: new Date(now).toISOString() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function harness({ visible = true, blocking = false, load, storageBlocked = false } = {}) {
  let path = '/', clock = now, stateCursor = 0, refCursor = 0, effectCursor = 0, dirty = false, tree, alive = true
  let states = [], refs = [], effects = [], pending = [], observers = [], requests = 0
  const documentEvents = new Map(), windowEvents = new Map(), timers = new Map(), intervals = new Map()
  const local = new Map(), session = new Map(), writes = []
  const storage = (map, scope) => ({ getItem: key => { if (storageBlocked) throw Error('blocked'); return map.get(key) }, setItem: (key, value) => { if (storageBlocked) throw Error('blocked'); map.set(key, value); writes.push([scope, key]) } })
  const listen = (map, event, callback) => { const listeners = map.get(event) || new Set(); listeners.add(callback); map.set(event, listeners) }
  const emit = (map, event) => { for (const callback of map.get(event) || []) callback() }
  class Clock extends Date { static now() { return clock } }
  const document = {
    get visibilityState() { return visible ? 'visible' : 'hidden' }, body: {},
    querySelector: () => blocking ? {} : null,
    addEventListener: (event, callback) => listen(documentEvents, event, callback),
    removeEventListener: (event, callback) => documentEvents.get(event)?.delete(callback),
  }
  const window = {
    setInterval: callback => { const id = Symbol(); intervals.set(id, callback); return id },
    setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, deadline: clock + delay }); return id },
    addEventListener: (event, callback) => listen(windowEvents, event, callback),
    removeEventListener: (event, callback) => windowEvents.get(event)?.delete(callback),
  }
  const react = {
    useState(initial) { const index = stateCursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { const next = typeof value === 'function' ? value(states[index]) : value; if (!Object.is(next, states[index])) { states[index] = next; dirty = true } }] },
    useRef(initial) { const index = refCursor++; return refs[index] ||= { current: initial } },
    useEffect(callback, deps) { const index = effectCursor++; if (!effects[index] || deps.some((value, i) => !Object.is(value, effects[index].deps[i]))) pending.push({ index, callback, deps }) },
  }
  const component = sourceModule('../components/site-popups.tsx', {
    react, 'next/navigation': { usePathname: () => path },
    '@/lib/studio/api': { request: () => { requests++; return load ? load(requests) : Promise.resolve({ popups: [campaign] }) } },
    '@/lib/studio/site-popups': helpers,
    '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogClose', 'DialogContent', 'DialogDescription', 'DialogTitle'].map(value => [value, value])),
    '@/components/site-popup-card': { SitePopupCard: 'SitePopupCard' },
  }, {
    window, document, Date: Clock, localStorage: storage(local, 'local'), sessionStorage: storage(session, 'session'),
    clearInterval: id => intervals.delete(id), clearTimeout: id => timers.delete(id),
    MutationObserver: class { constructor(callback) { this.callback = callback } observe() { observers.push(this.callback) } disconnect() { observers = observers.filter(callback => callback !== this.callback) } },
  })
  function render() { stateCursor = refCursor = effectCursor = 0; pending = []; tree = component.SitePopups(); return tree }
  function flush() {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!alive) return
      dirty = false; render()
      for (const { index, callback, deps } of pending) { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: callback() } }
      if (!dirty) return
    }
    throw Error('render loop')
  }
  async function settle() { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); flush() } }
  flush()
  return {
    get tree() { return tree }, get writes() { return writes }, get requests() { return requests }, settle,
    close() { tree.props.onOpenChange(false); flush() },
    visibility(value) { visible = value; emit(documentEvents, 'visibilitychange'); flush() },
    blocking(value) { blocking = value; for (const observer of observers) observer(); flush() },
    focus() { emit(windowEvents, 'focus'); flush() },
    elapse(milliseconds) { clock += milliseconds },
    tick(milliseconds) { clock += milliseconds; for (const [id, timer] of [...timers]) if (timer.deadline <= clock) { timers.delete(id); timer.callback() } flush() },
    navigate(value) { path = value; const firstRender = render(); flush(); return firstRender },
    unmount() { alive = false; for (const effect of effects) effect?.cleanup?.() },
  }
}

test('hidden pages do not consume a campaign; visibility resumes immediately and dismissal never opens an older queue', async () => {
  const older = { ...campaign, id: 'older', updatedAt: new Date(now - 1000).toISOString() }
  const h = harness({ visible: false, load: async () => ({ popups: [older, campaign] }) })
  await h.settle()
  assert.equal(h.tree.props.open, false)
  assert.equal(h.writes.length, 0)
  h.visibility(true); await h.settle()
  assert.equal(h.tree.props.open, true)
  assert.equal(h.writes.length, 1)
  h.close(); h.focus(); await h.settle(); h.tick(30000)
  assert.equal(h.tree.props.open, false)
  assert.equal(h.writes.length, 1)
  h.navigate('/studio'); await h.settle()
  assert.equal(h.tree.props.open, false)
  h.unmount()
})

test('expired campaigns disappear on returning from a hidden tab before the refresh response arrives', async () => {
  const request = deferred()
  const h = harness({ load: count => count === 1 ? Promise.resolve({ popups: [{ ...campaign, endsAt: new Date(now + 1000).toISOString() }] }) : request.promise })
  await h.settle(); assert.equal(h.tree.props.open, true)
  h.visibility(false); h.elapse(1001)
  h.visibility(true)
  assert.equal(h.tree.props.open, false)
  request.resolve({ popups: [] }); await h.settle(); h.unmount()
})

test('an existing dialog defers display without consuming it, and closing that dialog retries without a polling delay', async () => {
  const h = harness({ blocking: true })
  await h.settle()
  assert.equal(h.tree.props.open, false)
  assert.equal(h.writes.length, 0)
  h.blocking(false)
  assert.equal(h.tree.props.open, true)
  assert.equal(h.writes.length, 1)
  h.blocking(true)
  assert.equal(h.tree.props.open, false)
  h.blocking(false)
  assert.equal(h.tree.props.open, false)
  h.unmount()
})

test('route changes hide a home-only popup in the first render and stale request responses cannot reopen it', async () => {
  const h = harness({ load: async () => ({ popups: [{ ...campaign, pages: ['home'] }] }) })
  await h.settle()
  assert.equal(h.tree.props.open, true)
  assert.equal(h.navigate('/studio').props.open, false)
  await h.settle(); assert.equal(h.tree.props.open, false); h.unmount()
  const pending = deferred()
  const late = harness({ load: () => pending.promise })
  late.navigate('/canvas/project')
  pending.resolve({ popups: [campaign] }); await late.settle()
  assert.equal(late.tree.props.open, false)
  assert.equal(late.writes.length, 0)
  late.unmount()
})

test('blocked browser storage still deduplicates the campaign during the current mounted session', async () => {
  const h = harness({ storageBlocked: true })
  await h.settle(); assert.equal(h.tree.props.open, true)
  h.close(); h.focus(); await h.settle()
  assert.equal(h.tree.props.open, false)
  h.unmount()
})

test('withdrawn campaigns close after public refresh and a revised campaign gets a fresh display identity', async () => {
  let items = [campaign]
  const h = harness({ load: async () => ({ popups: items }) })
  await h.settle(); assert.equal(h.tree.props.open, true)
  items = []; h.focus(); await h.settle(); assert.equal(h.tree.props.open, false)
  items = [{ ...campaign, title: 'Revised', updatedAt: new Date(now + 1).toISOString() }]
  h.focus(); await h.settle()
  assert.equal(h.tree.props.open, true)
  assert.equal(h.writes.length, 2)
  h.unmount()
})
