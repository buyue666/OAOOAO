import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../lib/studio/director-thread.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { parseAssistantThread } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const pending = { clientRequestId: 'same-request-123', prompt: 'Original known context', displayText: 'My draft', surface: 'drama', projectId: 'one', assetIds: ['confirmed-library-id'], refTitles: ['reference.png'] }
const serialize = (request = pending) => JSON.stringify({ version: 2, messages: [], pending: request })

test('an interrupted submission restores its original identity, prompt and actual asset ids unchanged', () => {
  assert.deepEqual(parseAssistantThread(serialize(), 'drama', 'one').pending, pending)
})
test('requests from another project or surface fail closed', () => {
  assert.throws(() => parseAssistantThread(serialize(), 'drama', 'two'))
  assert.throws(() => parseAssistantThread(serialize(), 'chat', 'one'))
})
test('corrupt recovery records cannot silently become a new request', () => {
  for (const altered of [{ ...pending, clientRequestId: '' }, { ...pending, assetIds: [null] }, { ...pending, prompt: null }, true]) assert.throws(() => parseAssistantThread(serialize(altered), 'drama', 'one'))
  assert.throws(() => parseAssistantThread('{broken', 'chat'))
})
test('fresh or completed conversations have no unresolved request', () => {
  assert.deepEqual(parseAssistantThread(null, 'chat'), { messages: [], pending: null })
  assert.equal(parseAssistantThread(serialize(null), 'drama', 'one').pending, null)
})
