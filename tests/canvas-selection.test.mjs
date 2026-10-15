import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function sourceModule(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(modules, name) ? modules[name] : require(name), module, module.exports)
  return module.exports
}
const types = sourceModule('../components/free-canvas/types.ts')
const factory = sourceModule('../components/free-canvas/node-factory.ts')
const layout = sourceModule('../components/free-canvas/canvas-layout.ts', { './node-factory': factory })
const selection = sourceModule('../components/free-canvas/canvas-selection.ts')
const storeModule = () => sourceModule('../components/free-canvas/canvas-store.ts', { './node-factory': factory, './types': types, './canvas-layout': layout, './canvas-selection': selection }).useCanvasStore
const group = (id, x = 1000, y = 1000, extra = {}) => ({ ...factory.createGroupNode({ x, y }, { width: 500, height: 400 }, id), selected: false, ...extra })
const media = (id, x = 40, y = 60, extra = {}) => ({ ...factory.createMediaNode('reference', { x, y }, { id: `asset-${id}`, title: `Media ${id}`, url: `/synthetic/${id}.png`, mediaKind: 'image', libraryAssetId: `asset-${id}` }, id), selected: false, ...extra })
const edge = (id, source, target) => ({ id, source, target, sourceHandle: 'out-right', targetHandle: 'in-left', data: { retained: true } })
const hydrate = (store, nodes, edges = []) => store.getState().hydrate({ projectId: 'selection-test', title: 'Synthetic', updatedAt: '2026-01-01T00:00:00Z', projectMeta: { preserved: true }, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } })
const ids = nodes => nodes.map(node => node.id)
const nodeShape = nodes => nodes.map(({ selected, ...node }) => node)

test('selection expands nested groups in original order, ignores unknown IDs and never includes unrelated nodes', () => {
  const nodes = [media('child', 5, 6, { parentId: 'nested' }), media('other'), group('nested', 20, 30, { parentId: 'root' }), group('root', 100, 200, { selected: true })]
  assert.deepEqual(ids(selection.selectionNodes(nodes)), ['child', 'nested', 'root'])
  assert.deepEqual(ids(selection.selectionNodes(nodes, ['nested', 'nested', 'absent'])), ['child', 'nested'])
  assert.deepEqual(ids(selection.selectionRoots(nodes)), ['root'])
  assert.deepEqual(selection.absoluteNodePosition(nodes[0], nodes), { x: 125, y: 236 })
  assert.deepEqual(ids(selection.orderNodesParentsFirst(nodes)), ['root', 'nested', 'child', 'other'])
})

test('a partial selection snapshot freezes world coordinates, internal links and complete independent data', () => {
  const nodes = [group('root'), media('a', 40, 60, { parentId: 'root' }), media('b', 100, 120, { parentId: 'root' }), media('outside')]
  nodes[1].data.extra = { complete: ['keep', 'all'] }
  const edges = [edge('inside', 'a', 'b'), edge('outside', 'a', 'outside')]
  const snapshot = selection.selectionSnapshot(nodes, edges, ['a', 'b'])
  assert.deepEqual(snapshot.nodes.map(node => node.position), [{ x: 1040, y: 1060 }, { x: 1100, y: 1120 }])
  assert.ok(snapshot.nodes.every(node => node.parentId === undefined))
  assert.deepEqual(snapshot.edges, [edges[0]])
  snapshot.nodes[0].data.extra.complete.push('draft-only')
  snapshot.edges[0].data.retained = false
  assert.deepEqual(nodes[1].data.extra.complete, ['keep', 'all'])
  assert.equal(edges[0].data.retained, true)
})

test('duplicating a selected group includes descendants and links, offsets only roots and uses one undo entry', () => {
  const store = storeModule()
  const nodes = [group('g', 1000, 1000, { selected: true }), media('a', 40, 60, { parentId: 'g' }), media('b', 140, 60, { parentId: 'g' }), media('outside')]
  const edges = [edge('internal', 'a', 'b'), edge('external', 'b', 'outside')]
  hydrate(store, nodes, edges)
  store.getState().duplicateSelection()
  const created = store.getState().nodes.filter(node => !ids(nodes).includes(node.id))
  const copiedGroup = created.find(node => node.type === 'group')
  assert.equal(created.length, 3)
  assert.deepEqual(copiedGroup.position, { x: 1048, y: 1048 })
  assert.deepEqual(created.filter(node => node.type === 'media').map(node => node.position), [{ x: 40, y: 60 }, { x: 140, y: 60 }])
  assert.ok(created.filter(node => node.type === 'media').every(node => node.parentId === copiedGroup.id && !node.selected))
  assert.equal(store.getState().edges.length, 3)
  assert.equal(store.getState().past.length, 1)
  assert.equal(store.getState().revision, 1)
  store.getState().undo()
  assert.deepEqual(nodeShape(store.getState().nodes), nodeShape(nodes))
  assert.deepEqual(store.getState().edges, edges)
  store.getState().redo()
  assert.equal(store.getState().nodes.length, 7)
})

test('explicitly selecting both ancestor and descendant never duplicates or double-offsets the child', () => {
  const store = storeModule()
  hydrate(store, [group('g', 1000, 1000, { selected: true }), group('nested', 30, 40, { parentId: 'g', selected: true }), media('a', 5, 6, { parentId: 'nested', selected: true })])
  store.getState().duplicateSelection()
  const copy = store.getState().nodes.filter(node => !['g', 'nested', 'a'].includes(node.id))
  assert.equal(copy.length, 3)
  const leaf = copy.find(node => node.type === 'media')
  assert.deepEqual(leaf.position, { x: 5, y: 6 })
  assert.deepEqual(selection.absoluteNodePosition(leaf, copy), { x: 1083, y: 1094 })
  assert.equal(copy.filter(node => node.selected).length, 1)
})

test('copying a child snapshots its old world position; deleting or moving its parent cannot move the paste target', () => {
  const store = storeModule()
  hydrate(store, [group('g'), media('a', 40, 60, { parentId: 'g', selected: true })])
  store.getState().copySelection()
  assert.deepEqual(store.getState().clipboard.nodes[0].position, { x: 1040, y: 1060 })
  store.getState().removeNodes(['g'])
  store.getState().pasteClipboard({ x: 500, y: 500 })
  const pasted = store.getState().nodes.find(node => node.selected)
  assert.deepEqual(pasted.position, { x: 500, y: 500 })
  assert.equal(pasted.parentId, undefined)
  assert.equal(store.getState().past.length, 2)
  store.getState().undo()
  assert.equal(store.getState().nodes.length, 0)
})

test('pasting an entire nested group anchors its root at the requested position and preserves every relative coordinate', () => {
  const store = storeModule()
  hydrate(store, [group('g', 1000, 1000, { selected: true }), group('nested', 30, 40, { parentId: 'g' }), media('a', 5, 6, { parentId: 'nested' })])
  store.getState().copySelection(); store.getState().pasteClipboard({ x: -500, y: 250 })
  const created = store.getState().nodes.filter(node => !['g', 'nested', 'a'].includes(node.id))
  const root = created.find(node => !node.parentId)
  assert.deepEqual(root.position, { x: -500, y: 250 })
  assert.deepEqual(selection.absoluteNodePosition(created.find(node => node.type === 'media'), created), { x: -465, y: 296 })
})

test('deleting a group removes the complete tree and incident edges; undo and trash restore preserve hierarchy and contents', () => {
  const store = storeModule()
  const nodes = [group('g', 1000, 1000, { selected: true }), group('nested', 30, 40, { parentId: 'g' }), media('a', 5, 6, { parentId: 'nested' }), media('outside')]
  const edges = [edge('inside', 'nested', 'a'), edge('crossing', 'a', 'outside')]
  hydrate(store, nodes, edges); store.getState().deleteSelection()
  assert.deepEqual(ids(store.getState().nodes), ['outside'])
  assert.equal(store.getState().edges.length, 0)
  assert.equal(store.getState().past.length, 1)
  assert.match(store.getState().notice, /分组.*内容.*可撤销/)
  const trashId = store.getState().trash[0].id
  store.getState().undo(); assert.deepEqual(nodeShape(store.getState().nodes), nodeShape(nodes))
  store.getState().redo(); assert.deepEqual(ids(store.getState().nodes), ['outside'])
  store.getState().restoreTrash(trashId)
  assert.deepEqual(new Map(store.getState().nodes.map(node => [node.id, { parentId: node.parentId, position: node.position, data: node.data }])), new Map(nodes.map(node => [node.id, { parentId: node.parentId, position: node.position, data: node.data }])))
  assert.deepEqual(store.getState().edges, edges)
  store.getState().undo(); assert.deepEqual(ids(store.getState().nodes), ['outside'])
})

test('restoring an individual child retains a surviving parent or detaches at its captured world position if the parent is gone', () => {
  for (const parentSurvives of [true, false]) {
    const store = storeModule()
    hydrate(store, [group('g'), media('a', 40, 60, { parentId: 'g' })])
    store.getState().removeNodes(['a'])
    const entryId = store.getState().trash[0].id
    if (!parentSurvives) store.getState().removeNodes(['g'])
    store.getState().restoreTrash(entryId)
    const restored = store.getState().nodes.find(node => node.id === 'a')
    assert.equal(restored.parentId, parentSurvives ? 'g' : undefined)
    assert.deepEqual(restored.position, parentSurvives ? { x: 40, y: 60 } : { x: 1040, y: 1060 })
  }
})

test('ungrouping a nested frame retains its outer parent, world positions and ordinary links', () => {
  const store = storeModule()
  const nodes = [group('outer'), group('inner', 30, 40, { parentId: 'outer', selected: true }), media('a', 5, 6, { parentId: 'inner' }), media('b')]
  hydrate(store, nodes, [edge('valid', 'a', 'b'), edge('frame', 'inner', 'b')])
  store.getState().ungroupSelection()
  const child = store.getState().nodes.find(node => node.id === 'a')
  assert.equal(child.parentId, 'outer')
  assert.deepEqual(child.position, { x: 35, y: 46 })
  assert.equal(child.selected, true)
  assert.deepEqual(store.getState().edges.map(edge => edge.id), ['valid'])
  assert.equal(store.getState().past.length, 1)
  store.getState().undo(); assert.deepEqual(nodeShape(store.getState().nodes), nodeShape(nodes))
})

test('grouping complete groups and sibling nodes preserves positions and orders parents before children', () => {
  const store = storeModule()
  const nodes = [group('g', 1000, 1000, { selected: true }), media('inside', 40, 60, { parentId: 'g' }), media('outside', 1600, 1000, { selected: true })]
  hydrate(store, nodes)
  const before = selection.absoluteNodePositions(nodes)
  store.getState().groupSelection()
  assert.equal(store.getState().nodes.length, 4)
  const after = selection.absoluteNodePositions(store.getState().nodes)
  for (const node of nodes) assert.deepEqual(after.get(node.id), before.get(node.id))
  for (const node of store.getState().nodes) if (node.parentId) assert.ok(ids(store.getState().nodes).indexOf(node.parentId) < ids(store.getState().nodes).indexOf(node.id))
  assert.equal(store.getState().past.length, 1)
})

test('grouping sibling children creates a subgroup without removing them from the existing outer group', () => {
  const store = storeModule()
  const nodes = [group('outer'), media('a', 40, 60, { parentId: 'outer', selected: true }), media('b', 140, 60, { parentId: 'outer', selected: true })]
  hydrate(store, nodes); store.getState().groupSelection()
  const subgroup = store.getState().nodes.find(node => node.selected)
  assert.equal(subgroup.parentId, 'outer')
  for (const node of nodes) assert.deepEqual(selection.absoluteNodePosition(store.getState().nodes.find(item => item.id === node.id), store.getState().nodes), selection.absoluteNodePosition(node, nodes))
})

test('copy snapshots retain task data for readable exports but duplicated generation and Agent nodes cannot resume source jobs', () => {
  const store = storeModule()
  const generation = { id: 'generation', type: 'generation', position: { x: 0, y: 0 }, selected: true, data: { title: 'Draft', prompt: 'Keep input', skills: [{ id: 'skill', prompt: 'Rules' }], task: { id: 'task', phase: 'running', unconfirmed: true, clientRequestId: 'charge-id', submission: { kind: 'image', input: { clientRequestId: 'charge-id' } } }, results: [{ url: '/result.png', mediaKind: 'image' }] } }
  const agent = { ...factory.createAgentNode({ x: 500, y: 0 }, 'agent'), selected: true }
  agent.data = { ...agent.data, prompt: 'Keep plan', collapsed: true, runId: 'run', runStatus: 'running', clientRequestId: 'agent-charge', submission: { prompt: 'Old', assetIds: [] }, deliveredRunId: 'previous', deliveryError: 'old', planApproval: { totalPoints: 50 } }
  hydrate(store, [generation, agent]); store.getState().copySelection()
  assert.equal(store.getState().clipboard.nodes[0].data.task.id, 'task')
  store.getState().duplicateSelection()
  const copies = store.getState().nodes.filter(node => !['generation', 'agent'].includes(node.id))
  assert.equal(copies.find(node => node.type === 'generation').data.task, null)
  const copiedAgent = copies.find(node => node.type === 'agent').data
  for (const key of ['runId', 'runStatus', 'clientRequestId', 'deliveredRunId', 'deliveryError']) assert.equal(copiedAgent[key], null)
  assert.equal(copiedAgent.submission, undefined)
  assert.equal(copiedAgent.planApproval, undefined)
  assert.equal(copiedAgent.prompt, 'Keep plan')
  assert.equal(copiedAgent.collapsed, true)
  assert.equal(store.getState().nodes.find(node => node.id === 'generation').data.task.id, 'task')
})

test('media nodes display the saved node title while retaining the original asset title', () => {
  const store = storeModule(); hydrate(store, [media('a')])
  store.getState().updateNodeData('a', { title: 'Renamed' }, { history: true })
  const { MediaNode } = sourceModule('../components/free-canvas/nodes/media-node.tsx', {
    react: { memo: value => value }, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../canvas-store': { useCanvasStore: selector => selector(store.getState()) }, '../node-factory': factory,
    './node-kit': { NodeAnchors: 'NodeAnchors', NodeHandles: 'NodeHandles', TitleEditor: 'TitleEditor' },
  })
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)]
  const tree = MediaNode({ id: 'a', data: store.getState().nodes[0].data, selected: false })
  assert.equal(walk(tree).find(node => node.type === 'TitleEditor').props.title, 'Renamed')
  assert.equal(store.getState().nodes[0].data.media.title, 'Media a')
})

test('malformed parent cycles terminate without duplicating a broken tree, and long ancestor chains do not recurse', () => {
  const store = storeModule()
  const broken = [group('a', 0, 0, { parentId: 'b', selected: true }), group('b', 0, 0, { parentId: 'a' })]
  hydrate(store, broken)
  assert.equal(selection.selectionNodes(broken).length, 2)
  assert.equal(selection.absoluteNodePositions(broken).size, 2)
  store.getState().duplicateSelection()
  assert.equal(store.getState().nodes.length, 2)
  assert.equal(store.getState().revision, 0)
  const chain = Array.from({ length: 3000 }, (_, index) => group(String(index), 1, 1, index ? { parentId: String(index - 1) } : {})).reverse()
  assert.deepEqual(selection.absoluteNodePosition(chain[0], chain), { x: 3000, y: 3000 })
  const repeated = [media('duplicate'), media('duplicate', 500, 600)]
  assert.deepEqual(selection.orderNodesParentsFirst(repeated), repeated)
})

test('aligning selected roots uses world coordinates across groups and never moves their selected descendants twice', () => {
  const store = storeModule()
  const nodes = [group('outer', 1000, 1000), group('nested', 100, 100, { parentId: 'outer', selected: true }), media('inside', 40, 60, { parentId: 'nested', selected: true }), media('sibling', 600, 60, { parentId: 'outer', selected: true }), media('loose', 2000, 2000, { selected: true })]
  hydrate(store, nodes)
  store.getState().alignSelection('x')
  const after = store.getState().nodes
  assert.equal(selection.absoluteNodePosition(after.find(node => node.id === 'nested'), after).x, 1100)
  assert.equal(selection.absoluteNodePosition(after.find(node => node.id === 'sibling'), after).x, 1100)
  assert.equal(selection.absoluteNodePosition(after.find(node => node.id === 'loose'), after).x, 1100)
  assert.deepEqual(after.find(node => node.id === 'inside').position, { x: 40, y: 60 })
  assert.equal(store.getState().past.length, 1)
  store.getState().alignSelection('x')
  assert.equal(store.getState().past.length, 1, 'already aligned nodes do not create an empty undo step')
  store.getState().undo(); assert.deepEqual(nodeShape(store.getState().nodes), nodeShape(nodes))
})

test('the actual right-click menu preserves a selected group scope when opened on one of its children', () => {
  const store = storeModule()
  const nodes = [group('g', 1000, 1000, { selected: true }), media('inside', 40, 60, { parentId: 'g' }), media('also-selected', 2000, 2000, { selected: true }), media('outside')]
  hydrate(store, nodes)
  store.getState().openContextMenu({ x: 100, y: 100, target: { type: 'node', nodeId: 'inside' } })
  const actionCalls = []
  const { CanvasContextMenu } = sourceModule('../components/free-canvas/canvas-menu.tsx', {
    react: { useEffect: () => {}, useRef: () => ({ current: null }) },
    '@xyflow/react': { useReactFlow: () => ({ fitView() {} }) },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    './canvas-context': { useCanvasActions: () => ({ saveSelectionResults: selected => actionCalls.push(selected) }) },
    './canvas-store': { useCanvasStore: Object.assign(selector => selector(store.getState()), { getState: store.getState }) },
    './node-factory': factory, './canvas-selection': selection, './nodes/node-kit': { settingsPlacementFor: () => ({}) },
  })
  const previousWindow = globalThis.window
  globalThis.window = { innerWidth: 1024, innerHeight: 768 }
  try {
    const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)]
    let tree = CanvasContextMenu()
    const buttons = walk(tree).filter(node => node.type === 'button')
    assert.equal(buttons.some(node => node.props.children === '替换素材'), false)
    buttons.find(node => node.props.children === '保存结果到资产…').props.onClick()
    assert.deepEqual(actionCalls, [['g', 'also-selected']])
    store.getState().openContextMenu({ x: 100, y: 100, target: { type: 'node', nodeId: 'inside' } })
    tree = CanvasContextMenu()
    let stopped = false
    tree.props.onKeyDown({ key: 'Delete', stopPropagation() { stopped = true } })
    assert.equal(stopped, true, 'menu focus protects the canvas from destructive keyboard shortcuts')
    assert.equal(store.getState().nodes.length, nodes.length)
    walk(tree).find(node => node.type === 'button' && node.props.children === '创建副本').props.onClick()
    assert.equal(store.getState().nodes.length, nodes.length + 3)
    assert.equal(store.getState().nodes.filter(node => node.type === 'group').length, 2)
    assert.equal(store.getState().past.length, 1)
  } finally { globalThis.window = previousWindow }
})

test('the permanent add menu centers new nodes in flow coordinates after viewport pan and zoom', () => {
  const position = sourceModule('../components/free-canvas/canvas-position.ts', { './node-factory': factory })
  const calls = []
  const { CanvasCreateMenu } = sourceModule('../components/free-canvas/canvas-create-menu.tsx', {
    react: { useEffect: () => {}, useRef: () => ({ current: null }), useState: () => [true, () => {}] },
    '@xyflow/react': { useReactFlow: () => ({ screenToFlowPosition: point => ({ x: (point.x - 100) / .5, y: (point.y - 50) / .5 }) }) },
    './canvas-context': { useCanvasActions: () => ({ createNodeAt: (kind, origin) => calls.push({ kind, origin }) }) },
    './node-factory': factory, './canvas-position': position,
  })
  const previousWindow = globalThis.window
  globalThis.window = { innerWidth: 1280, innerHeight: 720 }
  try {
    const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)]
    const tree = CanvasCreateMenu()
    for (const item of walk(tree).filter(node => node.props?.role === 'menuitem')) item.props.onClick()
    assert.equal(calls.length, factory.CREATABLE_KINDS.length)
    for (const { kind, origin } of calls) {
      const size = kind === 'agent' ? factory.NODE_SIZE.agent : kind === 'director' ? factory.NODE_SIZE.director : ['reference', 'asset'].includes(kind) ? factory.NODE_SIZE.media : factory.NODE_SIZE.generation
      assert.deepEqual({ x: origin.x + size.width / 2, y: origin.y + size.height / 2 }, { x: 1080, y: 620 })
    }
  } finally { globalThis.window = previousWindow }
})
