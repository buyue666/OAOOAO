import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, mocks = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {})(name => name in mocks ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const factory = sourceModule('../components/free-canvas/node-factory.ts')
const { arrangeCanvasNodes } = sourceModule('../components/free-canvas/canvas-layout.ts', { './node-factory': factory })
const node = (id, extra = {}) => ({ id, type: 'generation', position: { x: 0, y: 0 }, data: { kind: 'image', title: id, prompt: 'keep this prompt' }, ...extra })
const edge = (source, target) => ({ id: `${source}-${target}`, source, target, data: { untouched: true } })
const plain = value => JSON.parse(JSON.stringify(value))
const byId = nodes => new Map(nodes.map(item => [item.id, item]))

function assertDisjoint(nodes) {
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const first = nodes[a], second = nodes[b]
      const firstSize = factory.sizeOf(first), secondSize = factory.sizeOf(second)
      assert.ok(
        first.position.x + firstSize.width <= second.position.x || second.position.x + secondSize.width <= first.position.x ||
        first.position.y + firstSize.height <= second.position.y || second.position.y + secondSize.height <= first.position.y,
        `${first.id} overlaps ${second.id}`,
      )
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

test('empty and single-unit boards keep their exact array and node references', () => {
  const empty = []
  assert.equal(arrangeCanvasNodes(empty, []), empty)
  const single = [node('only', { position: { x: -7, y: 13 } })]
  assert.equal(arrangeCanvasNodes(single, [edge('only', 'only')]), single)
  const family = [node('child', { parentId: 'group' }), node('group', { type: 'group', width: 600, height: 500 })]
  assert.equal(arrangeCanvasNodes(family, []), family)
})

test('branching dependencies run left to right regardless of input order and edge order', () => {
  const nodes = [node('end'), node('branch-b', { width: 570 }), node('start'), node('branch-a', { measured: { width: 450, height: 450 } })]
  const edges = [edge('start', 'branch-a'), edge('start', 'branch-b'), edge('branch-a', 'end'), edge('branch-b', 'end')]
  const arranged = arrangeCanvasNodes(nodes, edges)
  const indexed = byId(arranged)
  for (const { source, target } of edges) {
    assert.ok(indexed.get(source).position.x + factory.sizeOf(indexed.get(source)).width + 100 <= indexed.get(target).position.x)
  }
  assertDisjoint(arranged)
  assert.deepEqual(plain(arrangeCanvasNodes(nodes, [...edges].reverse())), plain(arranged))
})

test('explicit, measured and fallback dimensions all contribute to safe spacing', () => {
  const nodes = [
    node('wide', { width: 850, height: 95, measured: { width: 10, height: 10 } }),
    node('measured', { type: 'agent', measured: { width: 610, height: 620 } }),
    node('default', { type: 'media' }),
    node('tall', { width: 180, height: 750 }),
  ]
  const edges = [edge('wide', 'measured'), edge('wide', 'default'), edge('measured', 'tall'), edge('default', 'tall')]
  const arranged = arrangeCanvasNodes(nodes, edges), indexed = byId(arranged)
  assertDisjoint(arranged)
  assert.equal(indexed.get('measured').position.x, indexed.get('wide').position.x + 950)
  assert.equal(indexed.get('default').position.y, indexed.get('measured').position.y + 684)
  assert.equal(indexed.get('tall').position.x, indexed.get('measured').position.x + 710)
})

test('nested groups move as whole families, including children beyond their container bounds', () => {
  const nodes = [
    node('source', { position: { x: -50, y: 20 } }),
    node('group', { type: 'group', position: { x: 50, y: -80 }, width: 400, height: 300 }),
    node('nested', { type: 'group', parentId: 'group', position: { x: -80, y: 100 }, width: 300, height: 200 }),
    node('child', { parentId: 'nested', position: { x: 500, y: 300 }, width: 500, height: 600 }),
    node('end'),
    node('parallel', { width: 360, height: 900 }),
  ]
  const edges = [edge('source', 'child'), edge('child', 'end'), edge('nested', 'child'), edge('source', 'parallel'), edge('parallel', 'end')]
  const arranged = arrangeCanvasNodes(nodes, edges), indexed = byId(arranged)
  assert.equal(indexed.get('nested'), nodes[2])
  assert.equal(indexed.get('child'), nodes[3])
  assert.equal(indexed.get('group').data, nodes[1].data)
  assert.ok(indexed.get('source').position.x + 320 + 100 <= indexed.get('group').position.x - 80)
  assert.ok(indexed.get('group').position.x + 920 + 100 <= indexed.get('end').position.x)
  assert.ok(indexed.get('group').position.y + 1000 + 64 <= indexed.get('parallel').position.y)
  assert.deepEqual(arranged.map(item => item.id), nodes.map(item => item.id))
  assert.equal(arrangeCanvasNodes(arranged, edges), arranged)
})

test('connection cycles terminate, stay disjoint and retain external dependency direction', () => {
  const nodes = ['in', 'a', 'b', 'c', 'out'].map(id => node(id))
  const edges = [edge('in', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('b', 'out'), edge('a', 'a')]
  const arranged = arrangeCanvasNodes(nodes, edges), indexed = byId(arranged)
  assertDisjoint(arranged)
  assert.equal(indexed.get('a').position.x, indexed.get('b').position.x)
  assert.equal(indexed.get('b').position.x, indexed.get('c').position.x)
  assert.ok(indexed.get('in').position.x < indexed.get('a').position.x)
  assert.ok(indexed.get('c').position.x < indexed.get('out').position.x)
  assert.equal(arrangeCanvasNodes(arranged, edges), arranged)
  assert.deepEqual(plain(arrangeCanvasNodes(nodes, edges)), plain(arranged))
})

test('disconnected nodes form a compact grid of no more than four columns', () => {
  const nodes = Array.from({ length: 25 }, (_, index) => node(String(index), { width: 100 + index * 11, height: 80 + index * 7 }))
  const arranged = arrangeCanvasNodes(nodes, [])
  assertDisjoint(arranged)
  assert.equal(new Set(arranged.map(item => item.position.x)).size, 4)
  assert.ok(new Set(arranged.map(item => item.position.y)).size > 1)
  assert.equal(arrangeCanvasNodes(arranged, []), arranged)
})

test('disconnected connected-components do not overlap, including their widest branches', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'isolated'].map((id, index) => node(id, { width: index % 2 ? 900 : 100, height: index % 2 ? 100 : 400 }))
  const edges = [edge('a', 'b'), edge('a', 'c'), edge('d', 'e'), edge('e', 'f')]
  assertDisjoint(arrangeCanvasNodes(nodes, edges))
})

test('the top-level minimum x/y anchor survives negative and fractional positions', () => {
  const nodes = [node('a', { position: { x: -333.25, y: 123.5 } }), node('b', { position: { x: 200.7, y: -104.125 } }), node('c')]
  const arranged = arrangeCanvasNodes(nodes, [edge('a', 'b'), edge('b', 'c')])
  assert.equal(Math.min(...arranged.map(item => item.position.x)), -333.25)
  assert.equal(Math.min(...arranged.map(item => item.position.y)), -104.125)
  assert.equal(arrangeCanvasNodes(arranged, [edge('a', 'b'), edge('b', 'c')]), arranged)
})

test('arrangement does not mutate nodes, positions, data or edges, and keeps untouched references', () => {
  const nodes = deepFreeze([node('a'), node('b'), node('child', { parentId: 'b', position: { x: 20, y: 40 } })])
  const edges = deepFreeze([edge('a', 'child')])
  const before = JSON.stringify({ nodes, edges })
  const arranged = arrangeCanvasNodes(nodes, edges)
  assert.notEqual(arranged, nodes)
  assert.equal(JSON.stringify({ nodes, edges }), before)
  assert.equal(arranged[0], nodes[0])
  assert.equal(arranged[1].data, nodes[1].data)
  assert.equal(arranged[2], nodes[2])
  assert.equal(arrangeCanvasNodes(arranged, edges), arranged)
})

test('unknown endpoints and repeated connections do not create phantom columns', () => {
  const nodes = [node('a'), node('b')]
  const baseline = arrangeCanvasNodes(nodes, [edge('a', 'b')])
  const arranged = arrangeCanvasNodes(nodes, [edge('a', 'b'), edge('a', 'b'), edge('missing', 'a'), edge('b', 'missing')])
  assert.deepEqual(plain(arranged), plain(baseline))
})

test('a missing parent is treated as a root without rewriting the stored parentId', () => {
  const nodes = [node('orphan', { parentId: 'deleted' }), node('other'), node('child', { parentId: 'orphan', position: { x: 30, y: 40 } })]
  const arranged = arrangeCanvasNodes(nodes, [edge('other', 'child')]), indexed = byId(arranged)
  assert.equal(indexed.get('orphan').parentId, 'deleted')
  assert.equal(indexed.get('child'), nodes[2])
  assert.ok(indexed.get('other').position.x < indexed.get('orphan').position.x)
  assert.equal(arrangeCanvasNodes(arranged, [edge('other', 'child')]), arranged)
})

test('malformed parent cycles or duplicate IDs leave the board intact instead of detaching children', () => {
  for (const nodes of [
    [node('a', { parentId: 'b' }), node('b', { parentId: 'a' }), node('outside')],
    [node('a', { parentId: 'a' }), node('outside')],
    [node('duplicate'), node('duplicate')],
  ]) assert.equal(arrangeCanvasNodes(nodes, []), nodes)
})

test('invalid saved sizes fall back to measured or default dimensions', () => {
  const nodes = [node('a', { width: -1, height: NaN, measured: { width: 650, height: 300 } }), node('b', { width: Infinity, height: 0 })]
  const arranged = arrangeCanvasNodes(nodes, [edge('a', 'b')])
  assert.equal(arranged[1].position.x - arranged[0].position.x, 750)
  for (const item of arranged) assert.ok(Number.isFinite(item.position.x) && Number.isFinite(item.position.y))
})

test('long dependency chains use iterative traversal and retain every node', () => {
  const nodes = Array.from({ length: 3000 }, (_, index) => node(String(index)))
  const edges = nodes.slice(1).map((item, index) => edge(String(index), item.id))
  const arranged = arrangeCanvasNodes(nodes, edges)
  assert.equal(arranged.length, nodes.length)
  assert.equal(arranged.at(-1).position.x, 2999 * 420)
  assert.equal(arrangeCanvasNodes(arranged, edges), arranged)
})
