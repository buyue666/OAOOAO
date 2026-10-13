import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the actual provider callbacks with deterministic account/API dependencies.
const source = readFileSync(new URL('../lib/studio/generation-store.tsx', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('generation-store.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const provider = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GenerationProvider')
const names = ['syncAgentAccount', 'runAgent', 'getAgent', 'cancelAgent']
const callbacks = provider.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.includes(item.name.getText(parsed)))).map(node => node.getText(parsed)).join('\n')
const code = ts.transpileModule(callbacks, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

function harness({ get, control, refresh } = {}) {
  const calls = [], bumps = []
  const sessionEpochRef = { current: 1 }, userIdRef = { current: 'account-a' }, agentAccountVersions = { current: new Map() }
  let run = { id: 'run', status: 'planning', pointsCost: 1, tasks: [] }
  const noop = () => {}
  class StudioApiError extends Error {}
  const dependencies = { useCallback: fn => fn, sessionEpochRef, userIdRef, agentAccountVersions,
    refreshSession: async () => { calls.push(userIdRef.current); return refresh ? refresh() : { status: 'connected' } },
    bumpAccountData: () => bumps.push(userIdRef.current), StudioApiError,
    createAgentRun: async () => ({ data: { run }, points: {} }), getAgentRun: async () => get ? get() : { data: { run } },
    require: () => ({ controlAgentRun: async () => control ? control() : { data: { run } } }),
    applyPoints: noop, setRunning: noop, setLastError: noop, setLastNotice: noop, setLocalOnly: noop, toError: value => value,
  }
  const actions = new Function(...Object.keys(dependencies), `${code}\nreturn { ${names.join(',')} };`)(...Object.values(dependencies))
  return { actions, calls, bumps, sessionEpochRef, userIdRef, setRun: value => { run = { ...run, ...value } } }
}

test('planning, new charges, completion and cancellation refresh account data without polling churn', async () => {
  const h = harness()
  await h.actions.runAgent({ prompt: 'Synthetic', surface: 'canvas' })
  await h.actions.getAgent('run'); await h.actions.getAgent('run')
  assert.equal(h.calls.length, 1)
  h.setRun({ status: 'running', pointsCost: 2 }); await h.actions.getAgent('run')
  h.setRun({ status: 'completed' }); await h.actions.getAgent('run'); await h.actions.getAgent('run')
  assert.equal(h.calls.length, 3)
  h.setRun({ status: 'cancelled', pointsCost: 1 }); await h.actions.cancelAgent({ id: 'run' }, 'cancel')
  assert.equal(h.calls.length, 4); assert.equal(h.bumps.length, 4)
})

test('late Agent reads and controls cannot refresh or return another account’s run', async () => {
  for (const action of ['getAgent', 'cancelAgent']) {
    const pending = deferred(), h = harness({ get: () => pending.promise, control: () => pending.promise })
    const request = action === 'getAgent' ? h.actions.getAgent('run') : h.actions.cancelAgent({ id: 'run' }, 'cancel')
    h.userIdRef.current = 'account-b'; h.sessionEpochRef.current++
    pending.resolve({ data: { run: { id: 'account-a-run', status: 'completed', pointsCost: 10 } } })
    await assert.rejects(request, /账号已切换/)
    assert.deepEqual(h.calls, []); assert.deepEqual(h.bumps, [])
  }
})

test('a failed account refresh can retry the same run version on its next successful read', async () => {
  let online = false
  const h = harness({ refresh: () => ({ status: online ? 'connected' : 'offline' }) })
  await h.actions.getAgent('run'); await Promise.resolve()
  online = true; await h.actions.getAgent('run'); await h.actions.getAgent('run')
  assert.equal(h.calls.length, 2)
})
