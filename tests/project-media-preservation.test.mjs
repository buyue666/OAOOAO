import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/studio/project-media.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const clone = value => JSON.parse(JSON.stringify(value))
function fixture({ badAck = false } = {}) {
  const initial = { id: 'opaque-canvas', title: 'Synthetic protected board', updatedAt: '2026-01-01T00:00:00.000Z', sourceHandoffId: 'handoff', viewport: { x: 44, y: 22, k: 0.75 }, unknownProjectField: { keep: ['a'] },
    nodes: [
      { id: 'group', type: 'group', width: 720, height: 480, position: { x: 1, y: 2 }, data: { kind: 'group', title: 'Group', unknown: { keep: true } } },
      { id: 'agent', type: 'agent', parentId: 'group', position: { x: 20, y: 30 }, data: { kind: 'agent', title: 'Agent', skills: [{ id: 'skill', title: 'Skill', prompt: 'Keep these instructions' }], runId: 'run', steps: [{ id: 'step' }], unknown: [1, 2] }, metadata: { custom: 'preserve' } },
      { id: 'audio', type: 'audio', position: { x: 50, y: 60 }, data: { kind: 'audio', results: [{ url: '/audio.wav' }], voice: 'voice', format: 'wav' } },
    ], connections: [{ id: 'edge', source: 'agent', target: 'audio', sourceHandle: 'out-bottom', targetHandle: 'in-top', custom: { label: 'keep' } }],
  }
  let server = clone(initial)
  const requests = []
  const api = { getCanvasProject: async () => clone(server), request: async (url, input) => {
    const body = JSON.parse(input.body);requests.push({ url, ...body })
    if (body.expectedUpdatedAt !== server.updatedAt) throw Object.assign(new Error('Project was updated elsewhere'), { status: 409 })
    if (badAck) return { data: {} }
    server = { ...body.project, updatedAt: new Date(Date.parse(server.updatedAt) + 1).toISOString() }
    return { data: { project: clone(server) } }
  } }
  const module = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { crypto: { randomUUID } })(name => { assert.equal(name, './api'); return api }, module, module.exports)
  return { initial, api: module.exports, requests, server: () => server, setServer: value => { server = clone(value) } }
}
const media = { sourceId: '/api/reference-assets/fixture', url: '/api/reference-assets/fixture', kind: 'audio', title: 'Synthetic voiceover' }

test('append preserves complete Agent/group/audio fields, edge handles and raw project metadata', async () => {
  const f = fixture();const added = await f.api.addMediaToProject('opaque-canvas', media)
  assert.equal(added.alreadyPresent, false)
  assert.deepEqual(clone(f.server().nodes.slice(0, 3)), f.initial.nodes)
  assert.deepEqual(clone(f.server().connections), f.initial.connections)
  assert.deepEqual(f.server().viewport, f.initial.viewport)
  assert.deepEqual(f.server().unknownProjectField, f.initial.unknownProjectField)
  assert.equal(f.server().sourceHandoffId, f.initial.sourceHandoffId)
  assert.equal(f.requests[0].expectedUpdatedAt, f.initial.updatedAt)
  assert.equal(f.server().nodes[3].data.media.mediaKind, 'audio')
  assert.equal(f.server().nodes[3].type, 'reference')
  const again = await f.api.addMediaToProject('opaque-canvas', media)
  assert.equal(again.alreadyPresent, true);assert.equal(again.nodeId, added.nodeId);assert.equal(f.requests.length, 1)
})

test('remove prunes only target references and incident edges, preserving all other content', async () => {
  const f = fixture();const added = await f.api.addMediaToProject('opaque-canvas', media)
  f.server().connections.push({ id: 'attached', source: added.nodeId, target: 'agent', sourceHandle: 'out-right', targetHandle: 'in-left' })
  const removed = await f.api.removeMediaFromProject('opaque-canvas', media.sourceId)
  assert.equal(removed.removed, true)
  assert.deepEqual(f.server().nodes, f.initial.nodes)
  assert.deepEqual(f.server().connections, f.initial.connections)
  assert.deepEqual(f.server().unknownProjectField, f.initial.unknownProjectField)
  assert.equal((await f.api.removeMediaFromProject('opaque-canvas', media.sourceId)).removed, false)
  assert.equal(f.requests.length, 2)
})

test('simultaneous stale snapshots cannot overwrite each other', async () => {
  const f = fixture()
  const settled = await Promise.allSettled([f.api.addMediaToProject('opaque-canvas', media), f.api.addMediaToProject('opaque-canvas', { ...media, sourceId: '/other', url: '/other' })])
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(settled.filter(item => item.status === 'rejected').length, 1)
  assert.equal(f.server().nodes.length, f.initial.nodes.length + 1)
  assert.deepEqual(f.server().nodes.slice(0, 3), f.initial.nodes)
})

test('missing server confirmation cannot report saved', async () => {
  const f = fixture({ badAck: true })
  await assert.rejects(f.api.addMediaToProject('opaque-canvas', media), /未确认项目保存/)
})

test('reference survives free-canvas normalization and legacy hash collision never aliases another source', async () => {
  const f = fixture();await f.api.addMediaToProject('opaque-canvas', media)
  delete f.server().nodes[3].data.oaooaoMediaSourceId
  assert.equal((await f.api.addMediaToProject('opaque-canvas', media)).alreadyPresent, true)
  assert.deepEqual(clone(await f.api.listProjectReferencedSourceIds('opaque-canvas')), [media.sourceId])
  f.server().nodes.push({ id: 'media-1mo', type: 'reference', position: { x: 0, y: 0 }, data: { oaooaoMediaSourceId: 'Aa', src: 'Aa' } })
  assert.equal(f.api.hasMediaNode({ nodes: f.server().nodes }, 'BB'), false)
})
