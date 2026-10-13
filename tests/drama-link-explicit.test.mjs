import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Execute the actual client helper; no duplicate implementation or server code.
const source = await readFile(new URL('../lib/studio/drama-link.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { canvasHandoffFromProjectId, resolveLinkedDramaProjectId, dramaCanvasHandoffId } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

test('opaque project IDs link through the saved handoff and explicit matches win', () => {
  const projects = [
    { id: 'drama-shared-handoff' },
    { id: 'drama-unrelated-uuid', sourceHandoffId: 'shared-handoff' },
  ]
  assert.equal(resolveLinkedDramaProjectId('canvas-unrelated-uuid', projects, 'shared-handoff'), 'drama-unrelated-uuid')
  assert.equal(canvasHandoffFromProjectId('canvas-unrelated-uuid', ' shared-handoff '), 'shared-handoff')
})

test('an account change resolves only the currently listed project despite a shared handoff', () => {
  const accountA = [{ id: 'drama-account-a', sourceHandoffId: 'same-handoff' }]
  const accountB = [{ id: 'drama-account-b', sourceHandoffId: 'same-handoff' }]
  assert.equal(resolveLinkedDramaProjectId('opaque-a', accountA, 'same-handoff'), 'drama-account-a')
  assert.equal(resolveLinkedDramaProjectId('opaque-b', accountB, 'same-handoff'), 'drama-account-b')
  assert.equal(resolveLinkedDramaProjectId('opaque-b', [], 'same-handoff'), null)
})

test('ambiguous explicit links cannot silently select the first candidate', () => {
  const projects = [
    { id: 'drama-first', sourceHandoffId: 'shared' },
    { id: 'drama-second', sourceHandoffId: 'shared' },
    { id: 'drama-shared' },
  ]
  assert.equal(resolveLinkedDramaProjectId('opaque', projects, 'shared'), null)
  assert.equal(resolveLinkedDramaProjectId('opaque', [projects[0], projects[0]], 'shared'), 'drama-first')
})

test('all legacy shapes and longest complete ID matching remain supported', () => {
  for (const handoff of ['drama-alpha-episode-one', 'drama-drama-alpha-episode-one', 'drama-alpha', 'alpha']) {
    assert.equal(resolveLinkedDramaProjectId(`canvas-${handoff}`, ['drama-alpha']), 'drama-alpha', handoff)
  }
  assert.equal(resolveLinkedDramaProjectId('canvas-drama-drama-alpha-beta-episode-one', ['drama-alpha', 'drama-alpha-beta']), 'drama-alpha-beta')
  assert.equal(resolveLinkedDramaProjectId('canvas-standalone', ['drama-alpha']), null)
  assert.equal(resolveLinkedDramaProjectId('', ['drama-alpha']), null)
})

test('saved conflicting origins defeat suffix guesses while episode handoffs still link', () => {
  const projects = [{ id: 'drama-alpha', sourceHandoffId: 'other-origin' }]
  assert.equal(resolveLinkedDramaProjectId('canvas-alpha', projects), null)
  const episodeHandoff = dramaCanvasHandoffId('drama-alpha', 'episode-one')
  assert.equal(resolveLinkedDramaProjectId('opaque-canvas', projects, episodeHandoff), 'drama-alpha')
})

test('the actual project list groups opaque IDs using both saved source fields', async () => {
  const pageSource = await readFile(new URL('../components/studio/creative-projects-page.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('creative-projects-page.tsx', pageSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const grouping = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'projectRows')
  assert.ok(grouping, 'The production project list grouping function must exist')
  // Extract the real pure grouping function, avoiding unrelated Next/React UI imports.
  const groupingModule = ts.transpileModule('export ' + grouping.getText(parsed), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const helperUrl = 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  const { projectRows } = await import('data:text/javascript;base64,' + Buffer.from(`import { resolveLinkedDramaProjectId } from '${helperUrl}';\n${groupingModule}`).toString('base64'))
  const updatedAt = '2026-01-02T00:00:00.000Z'
  const drama = { id: 'drama-random-id', title: 'Linked drama', sourceHandoffId: 'shared-origin', updatedAt }
  const canvas = { id: 'random-canvas-id', title: 'Linked canvas', sourceHandoffId: 'shared-origin', updatedAt }
  const independent = { id: 'independent-canvas', title: 'Separate canvas', updatedAt }
  const rows = projectRows([drama], [canvas, independent], 'all')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.find(row => row.id === drama.id).canvases.map(item => item.id), [canvas.id])
  assert.equal(rows.find(row => row.id === drama.id).href, '/projects/drama-random-id')
  assert.equal(rows.find(row => row.id === independent.id).href, '/canvas/independent-canvas')
  assert.deepEqual(projectRows([drama], [canvas, independent], 'canvas').map(row => row.id), [canvas.id, independent.id])
  const otherDrama = { ...drama, id: 'drama-other-account' }
  const otherRows = projectRows([otherDrama], [canvas], 'all')
  assert.equal(otherRows[0].id, otherDrama.id)
  assert.deepEqual(otherRows[0].canvases.map(item => item.id), [canvas.id])
})
