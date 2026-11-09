import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const module = { exports: {} }
new Function('module', 'exports', ts.transpileModule(readFileSync(new URL('../lib/studio/channel-model-catalog.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module, module.exports)
const { channelModelCatalog, configuredCatalogModels } = module.exports
const channels = ['a', 'b'].map(id => ({ id, enabled: true, models: ['writer-one', 'writer-two', 'writer-three'], advancedConfig: { modelCapabilities: { 'writer-one': 'text', 'writer-two': 'text', 'writer-three': 'text' } } }))
const configured = [{ id: 'planner', name: 'My planner', capability: 'text', enabled: true, bindings: [{ id: 'first', channelId: 'a', upstreamModel: 'writer-one', enabled: true, priority: 7 }] }]

test('all fetched models appear once and existing routing is preserved', () => {
  const before = structuredClone(configured), catalog = channelModelCatalog(channels, configured)
  assert.equal(catalog.models.length, 3)
  assert.deepEqual(catalog.models[0], before[0])
  assert.deepEqual([...catalog.pendingIds], ['writer-two', 'writer-three'])
  for (const model of catalog.models.slice(1)) { assert.equal(model.enabled, false); assert.equal(model.bindings.length, 2) }
  catalog.models[0].bindings[0].priority = 99
  assert.deepEqual(configured, before, 'opening the editor cannot mutate saved routes')
})

test('saving another route leaves discoveries as drafts; explicit configuration persists only that model', () => {
  const catalog = channelModelCatalog(channels, configured), models = structuredClone(catalog.models)
  assert.deepEqual(configuredCatalogModels(models, catalog, {}), configured)
  models[1].enabled = true
  const saved = configuredCatalogModels(models, catalog, { 'writer-two': 2 })
  assert.deepEqual(saved.map(model => model.id), ['planner', 'writer-two'])
  assert.equal(models[2].enabled, false)
})

test('request names and capability collisions never produce conflicting route identities', () => {
  const saved = [{ ...configured[0], aliases: ['writer-two'] }, { id: 'writer-three', name: 'Image', capability: 'image', enabled: false, bindings: [] }]
  const result = channelModelCatalog(channels, saved)
  assert.equal(result.pendingIds.size, 1)
  const candidate = result.models.at(-1)
  assert.equal(candidate.capability, 'text')
  assert.notEqual(candidate.id, 'writer-three')
  assert.equal(new Set(result.models.flatMap(model => [model.id, ...(model.aliases ?? [])])).size, 4)
})

test('an already routed upstream is not rediscovered under a missing or stale capability hint', () => {
  const video = { id: 'motion', name: 'Motion', capability: 'video', enabled: true, bindings: [{ id: 'motion-route', channelId: 'a', upstreamModel: 'motion-model', enabled: true, priority: 1 }] }
  for (const advancedConfig of [{}, { modelCapabilities: { 'motion-model': 'text' } }]) {
    const result = channelModelCatalog([{ id: 'a', enabled: true, models: ['motion-model', 'new-writer'], advancedConfig }], [video])
    assert.deepEqual(result.models[0], video)
    assert.deepEqual([...result.pendingIds], ['new-writer'])
    assert.equal(result.models.filter(model => model.bindings.some(binding => binding.upstreamModel === 'motion-model')).length, 1)
  }
})
