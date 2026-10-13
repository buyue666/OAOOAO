import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const plain = value => JSON.parse(JSON.stringify(value))
function sourceModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Error })(name => { assert.ok(name in dependencies, name); return dependencies[name] }, module, module.exports)
  return module.exports
}
const selection = sourceModule('../lib/studio/reference-selection.ts', { './reference-assets': { isSubmittableReferenceUrl: () => true } })
const reference = (id, kind, title = id) => ({ id, kind, title, src: `/api/reference-assets/${id}`, createdAt: '2026-10-14T00:00:00.000Z' })

function fixture(initial) {
  let records = initial
  const pages = new Map(), queries = [], verified = [], more = []
  const unavailableKinds = new Set()
  const useLibraryAssets = ({ kind, pageSize, keyword }) => {
    queries.push({ kind, pageSize, keyword })
    const key = `${kind}:${keyword}`
    if (!pages.has(key)) {
      const matches = records.filter(item => item.kind === kind && item.title.includes(keyword || ''))
      const page = { assets: matches.slice(0, pageSize), total: matches.length, state: 'ready', message: '', loadingMore: false, liveVerifyTick: 0, hasMore: matches.length > pageSize,
        reload: async () => {},
        loadMore: async () => { more.push(kind); page.assets = matches.slice(0, page.assets.length + pageSize); page.hasMore = page.assets.length < page.total },
        verifyLibraryIds: async ids => { verified.push({ kind, ids: [...ids] }); return unavailableKinds.has(kind) ? selection.unavailableEvidence() : selection.completeEvidence(records.filter(item => item.kind === kind).map(item => item.id)) },
      }
      pages.set(key, page)
    }
    return pages.get(key)
  }
  const dependencies = { react: { useRef: value => ({ current: value }) }, './use-account-data': { useLibraryAssets } }
  const media = sourceModule('../lib/studio/use-media-library.ts', dependencies)
  const api = sourceModule('../lib/studio/use-video-reference-library.ts', { ...dependencies, './use-media-library': media, './reference-selection': selection })
  return { read: (mode, keyword = '') => api.useVideoReferenceLibrary(mode, keyword), api, queries, verified, more, unavailableKinds, remove: id => { records = records.filter(item => item.id !== id) } }
}

test('video modes use real media-only counts; two text skills never create phantom pages', () => {
  const f = fixture([reference('image', 'image'), reference('skill1', 'text'), reference('skill2', 'text')])
  for (const mode of ['text', 'first', 'ends', 'references']) {
    const result = f.read(mode)
    assert.equal(result.total, 1); assert.equal(result.assets.length, 1); assert.equal(result.remaining, 0); assert.equal(result.hasMore, false)
  }
  const edit = f.read('edit'); assert.equal(edit.total, 0); assert.equal(edit.assets.length, 0); assert.equal(edit.hasMore, false)
  assert.ok(f.queries.every(query => query.kind === 'image' || query.kind === 'video'))
})

test('mixed references paginate both media sources without losing kind-specific totals', async () => {
  const f = fixture([...Array.from({ length: 62 }, (_, n) => reference(`image-${n}`, 'image')), ...Array.from({ length: 61 }, (_, n) => reference(`video-${n}`, 'video')), reference('skill', 'text'), reference('audio', 'audio')])
  let result = f.read('references')
  assert.equal(result.total, 123); assert.equal(result.assets.length, 120); assert.equal(result.remaining, 3)
  await result.loadMore()
  result = f.read('references')
  assert.equal(result.assets.length, 123); assert.equal(result.remaining, 0); assert.equal(result.hasMore, false)
  assert.deepEqual(f.more.sort(), ['image', 'video'])
  assert.equal(f.read('edit').total, 61); assert.equal(f.read('first').total, 62)
})

test('mode and search changes do not classify other selected media as deleted', async () => {
  const image = reference('image', 'image', 'portrait'), video = reference('video', 'video', 'shot')
  const f = fixture([image, video, reference('skill', 'text')])
  for (const mode of ['references', 'edit', 'first', 'ends', 'text']) {
    const result = f.read(mode, 'no matching title')
    assert.equal(result.total, 0); assert.equal(result.assets.length, 0); assert.equal(result.hasMore, false)
    const evidence = await result.verifyLibraryIds(['image', 'video'])
    const report = selection.reconcileWithSources([image, video], { library: evidence })
    assert.deepEqual(plain(report.next.map(item => item.id)), ['image', 'video']); assert.equal(report.removed.length, 0)
    const refresh = await result.reloadForLiveness(['image', 'video'])
    assert.equal(refresh.ids.has('image'), true); assert.equal(refresh.ids.has('video'), true)
  }
  assert.equal(f.verified.length, 20)
})

test('partial evidence retains every selected kind; confirmed absence removes only the queried item', async () => {
  const image = reference('image', 'image'), video = reference('video', 'video'), newlySelected = reference('later', 'image')
  const f = fixture([image, video]); f.remove('image'); f.unavailableKinds.add('video')
  let evidence = await f.read('first').verifyLibraryIds(['image', 'video'])
  assert.equal(evidence.status, 'unavailable')
  assert.equal(selection.reconcileWithSources([image, video], { library: evidence }).removed.length, 0)
  f.unavailableKinds.clear()
  evidence = await f.read('edit').reloadForLiveness(['image', 'video'])
  const report = selection.reconcileWithSources([image, video, newlySelected], { library: evidence })
  assert.deepEqual(plain(report.removed.map(item => item.id)), ['image'])
  assert.deepEqual(plain(report.next.map(item => item.id)), ['video', 'later'])
  const before = f.verified.length; await f.read('references').verifyLibraryIds([])
  assert.equal(f.verified.length, before, 'empty selection requires no full-library verification')
})

test('an active mode loads only its unfinished pages and ignores rapid duplicate clicks', async () => {
  const f = fixture([...Array.from({ length: 70 }, (_, n) => reference(`image-${n}`, 'image')), ...Array.from({ length: 70 }, (_, n) => reference(`video-${n}`, 'video'))])
  const result = f.read('edit')
  await Promise.all([result.loadMore(), result.loadMore()])
  assert.deepEqual(f.more, ['video'])
  assert.equal(f.read('first').remaining, 10); assert.equal(f.read('edit').remaining, 0)
})
