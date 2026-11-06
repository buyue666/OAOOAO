import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/studio/asset-library.ts', import.meta.url), 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports })
const { filterAssetLibrary, assetLibraryCounts, selectVisibleAssets } = module.exports
const asset = (id, kind, category, createdAt, extra = {}) => ({ id, kind, category, createdAt, title: id, tags: [], referencedBy: [], ...extra })
const assets = [
  asset('山间清晨', 'image', 'scene', '2026-11-06'),
  asset('山间镜头', 'video', 'scene', '2026-11-05'),
  asset('人物 2', 'image', 'character', '2026-11-04', { tags: ['夏日'] }),
  asset('人物 10', 'character', undefined, '2026-11-03', { referencedBy: ['电影计划'] }),
  asset('环境音', 'audio', 'general', '2026-11-02'),
]
const ids = values => [...values].map(item => item.id)

test('asset media and usage filters combine without dropping search or changing source order', () => {
  const before = ids(assets)
  assert.deepEqual(ids(filterAssetLibrary(assets, { media: 'video', category: 'scene', search: ' 山间 ' })), ['山间镜头'])
  assert.deepEqual(ids(filterAssetLibrary(assets, { media: 'audio', category: 'scene' })), [])
  assert.deepEqual(ids(filterAssetLibrary(assets, { search: '夏日' })), ['人物 2'])
  assert.deepEqual(ids(filterAssetLibrary(assets, { search: '电影计划' })), ['人物 10'])
  assert.deepEqual(ids(filterAssetLibrary(assets, { sort: 'oldest' })), [...before].reverse())
  assert.deepEqual(ids(filterAssetLibrary(assets, { category: 'character', sort: 'name' })), ['人物 2', '人物 10'])
  assert.deepEqual(ids(assets), before)
})

test('counts treat legacy character assets as images while keeping their usage category', () => {
  const counts = JSON.parse(JSON.stringify(assetLibraryCounts(assets)))
  assert.deepEqual(counts.media, { all: 5, image: 3, video: 1, audio: 1 })
  assert.equal(counts.categories.character, 2)
  assert.equal(counts.categories.scene, 2)
  assert.equal(counts.categories.general, 1)
})

test('selecting filtered results retains other selections and respects the 100-item cap', () => {
  assert.deepEqual([...selectVisibleAssets(['other', 'a'], ['a', 'b'], true)], ['other', 'a', 'b'])
  assert.deepEqual([...selectVisibleAssets(['other', 'a', 'b'], ['a', 'b'], false)], ['other'])
  const current = Array.from({ length: 99 }, (_, index) => `old-${index}`)
  const selected = [...selectVisibleAssets(current, ['new-1', 'new-2'], true)]
  assert.equal(selected.length, 100)
  assert.deepEqual(selected.slice(0, 99), current)
  assert.equal(selected.at(-1), 'new-1')
})
