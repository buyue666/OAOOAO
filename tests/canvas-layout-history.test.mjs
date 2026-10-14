import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(modules, name) ? modules[name] : require(name), module, module.exports)
  return module.exports
}
const types = sourceModule('../components/free-canvas/types.ts')
const factory = sourceModule('../components/free-canvas/node-factory.ts')
const layout = sourceModule('../components/free-canvas/canvas-layout.ts', { './node-factory': factory })
const selection = sourceModule('../components/free-canvas/canvas-selection.ts')
const storeModule = () => sourceModule('../components/free-canvas/canvas-store.ts', { './node-factory': factory, './types': types, './canvas-layout': layout, './canvas-selection': selection }).useCanvasStore

function fixture(store, projectId = 'synthetic-canvas') {
  const nodes = [
    { id: 'group', type: 'group', position: { x: 600, y: 200 }, width: 430, height: 450, data: { title: 'Group' }, selected: false },
    { id: 'inside', type: 'generation', parentId: 'group', position: { x: 40, y: 56 }, data: { prompt: 'Preserve this draft', title: 'Inside' }, selected: true },
    { id: 'result', type: 'media', position: { x: -100, y: 150 }, data: { title: 'Result', media: { url: '/api/private/asset' } }, selected: false },
  ]
  const edges = [{ id: 'link', source: 'inside', target: 'result', sourceHandle: 'output', targetHandle: 'input' }]
  store.getState().hydrate({ projectId, title: 'Synthetic canvas', updatedAt: '2026-01-01T00:00:00Z', projectMeta: { untouched: 'metadata' }, nodes, edges, viewport: { x: 10, y: 20, zoom: .8 } })
  return { nodes, edges }
}

test('arrangement is one undoable persisted edit, preserving groups, content, selection and links', () => {
  const store = storeModule()
  const { nodes, edges } = fixture(store)
  const before = store.getState().nodes
  assert.equal(store.getState().arrangeLayout(), true)
  const arranged = store.getState().nodes
  assert.notDeepEqual(arranged.map(node => node.position), before.map(node => node.position))
  assert.equal(store.getState().past.length, 1)
  assert.equal(store.getState().revision, 1)
  assert.equal(store.getState().saveStatus, 'dirty')
  assert.equal(arranged.find(node => node.id === 'inside'), nodes[1])
  assert.equal(store.getState().edges, edges)
  assert.deepEqual(store.getState().projectMeta, { untouched: 'metadata' })
  store.getState().undo()
  assert.deepEqual(store.getState().nodes, before)
  assert.equal(store.getState().revision, 2)
  store.getState().redo()
  assert.deepEqual(store.getState().nodes, arranged)
  assert.equal(store.getState().revision, 3)
  store.getState().markSaved('2026-01-01T00:01:00Z', 3)
  assert.equal(store.getState().saveStatus, 'saved')
  assert.equal(store.getState().arrangeLayout(), false)
  assert.equal(store.getState().revision, 3)
  assert.equal(store.getState().past.length, 1)
})

test('view preferences never change saved content or history and reset between projects', () => {
  const store = storeModule()
  const { edges } = fixture(store)
  const nodes = store.getState().nodes
  store.getState().setMiniMapOpen(true)
  store.getState().setSnapToGrid(true)
  store.getState().setShowEdges(false)
  assert.equal(store.getState().revision, 0)
  assert.equal(store.getState().past.length, 0)
  assert.equal(store.getState().edges, edges)
  assert.equal(store.getState().nodes, nodes)
  fixture(store, 'another-project')
  assert.equal(store.getState().miniMapOpen, false)
  assert.equal(store.getState().snapToGrid, false)
  assert.equal(store.getState().showEdges, true)
  assert.equal(store.getState().projectId, 'another-project')
})

test('conflicting remote updates block arrangement without mutating local drafts', () => {
  const store = storeModule()
  fixture(store)
  const nodes = store.getState().nodes
  store.getState().setSaveStatus('conflict', 'newer remote board')
  assert.equal(store.getState().arrangeLayout(), false)
  assert.equal(store.getState().nodes, nodes)
  assert.equal(store.getState().past.length, 0)
  assert.equal(store.getState().revision, 0)
  assert.equal(store.getState().saveStatus, 'conflict')
})

test('committed names are trimmed and empty or unchanged drafts do not create save revisions', () => {
  const store = storeModule()
  fixture(store)
  store.getState().setTitle('  Synthetic canvas  ')
  store.getState().setTitle('   ')
  assert.equal(store.getState().revision, 0)
  store.getState().setTitle('  Named canvas  ')
  assert.equal(store.getState().title, 'Named canvas')
  assert.equal(store.getState().revision, 1)
  store.getState().setTitle('Named canvas')
  assert.equal(store.getState().revision, 1)
})
