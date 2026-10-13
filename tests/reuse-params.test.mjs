import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../lib/studio/reuse-params.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { writeReuseParams, consumeReuseParams } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const memory = () => { const entries = new Map(); return { entries, getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) } }
const params = { kind: 'video', prompt: '陶碗边缘的裂纹逐渐清晰', model: 'user-selected-model', taskId: 'original-task' }

test('a valid handoff preserves parameters and is consumed exactly once', () => {
  const storage = memory(); writeReuseParams(storage, 'alice', params, 1000)
  assert.deepEqual(consumeReuseParams(storage, 'alice', 'video', 1001), { status: 'ready', params })
  assert.equal(consumeReuseParams(storage, 'alice', 'video', 1002).status, 'empty')
})
test('another account or the wrong workspace cannot consume the handoff', () => {
  const storage = memory(); writeReuseParams(storage, 'alice', params, 1000)
  assert.equal(consumeReuseParams(storage, 'bob', 'video', 1001).status, 'empty')
  assert.equal(consumeReuseParams(storage, 'alice', 'image', 1001).status, 'empty')
  assert.equal(consumeReuseParams(storage, 'alice', 'video', 1002).status, 'ready')
})
test('stale or corrupt handoffs fail closed and are discarded', () => {
  const storage = memory(); writeReuseParams(storage, 'alice', params, 1000)
  assert.equal(consumeReuseParams(storage, 'alice', 'video', 1801001).status, 'invalid')
  writeReuseParams(storage, 'alice', params, 1000)
  storage.setItem([...storage.entries.keys()][0], '{broken')
  assert.equal(consumeReuseParams(storage, 'alice', 'video', 1001).status, 'invalid')
  assert.equal(storage.entries.size, 0)
})
test('unsupported media and empty content do not pretend to prefill an image workspace', () => {
  const storage = memory()
  assert.throws(() => writeReuseParams(storage, 'alice', { kind: 'audio', prompt: 'spoken words' }))
  assert.throws(() => writeReuseParams(storage, 'alice', { kind: 'image', prompt: '' }))
  assert.throws(() => writeReuseParams(storage, '', params))
})
test('storage failures remain explicit and never return an applied result', () => {
  const storage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.throws(() => writeReuseParams(storage, 'alice', params))
  assert.equal(consumeReuseParams(storage, 'alice', 'video').status, 'invalid')
})
