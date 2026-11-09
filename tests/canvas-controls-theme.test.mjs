import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, imports = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(name => imports[name] ?? require(name), module, module.exports)
  return module.exports
}
const { modelIconTone } = load('../lib/studio/model-icon-style.ts')
const { directorObjectIdentity, isDirectorPick } = load('../components/free-canvas/director-selection.ts')
const context = load('../components/free-canvas/canvas-agent-context.ts', { '@/lib/studio/prompt-references': load('../lib/studio/prompt-references.ts') })

test('monochrome library artwork adapts to the theme while colored and custom artwork retain their colors', () => {
  for (const base of ['https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/', 'https://unpkg.com/@lobehub/icons-static-svg@1.0.0/icons/', 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg/icons/']) {
    assert.equal(modelIconTone(base + 'openai.svg?version=1'), 'monochrome')
    assert.equal(modelIconTone(base + 'openai-text.svg'), 'monochrome')
    assert.equal(modelIconTone(base + 'gemini-color.svg'), 'original')
  }
  for (const src of ['/media/models/custom.png', 'https://example.test/icons/custom.svg', 'data:image/svg+xml,custom', '%invalid']) assert.equal(modelIconTone(src), 'original')
})

test('3D mesh picking resolves actor and camera identity through their model hierarchy', () => {
  const actor = { userData: { directorActorId: 'actor-a' }, parent: null }
  assert.deepEqual(directorObjectIdentity({ userData: {}, parent: { userData: {}, parent: actor } }), { kind: 'actor', id: 'actor-a' })
  assert.deepEqual(directorObjectIdentity({ userData: { directorCameraId: 'camera-b' }, parent: null }), { kind: 'camera', id: 'camera-b' })
  assert.equal(directorObjectIdentity(null), null)
  assert.equal(directorObjectIdentity({ userData: {}, parent: null }), null)
})

test('orbit drags, transform drags and another pointer cannot trigger a 3D object click', () => {
  const start = { x: 100, y: 200, pointerId: 1 }
  assert.equal(isDirectorPick(start, { clientX: 102, clientY: 201, pointerId: 1 }, false), true)
  assert.equal(isDirectorPick(start, { clientX: 130, clientY: 201, pointerId: 1 }, false), false)
  assert.equal(isDirectorPick(start, { clientX: 100, clientY: 200, pointerId: 1 }, true), false)
  assert.equal(isDirectorPick(start, { clientX: 100, clientY: 200, pointerId: 2 }, false), false)
  assert.equal(isDirectorPick(null, { clientX: 100, clientY: 200, pointerId: 1 }, false), false)
})

test('Agent mentions retain distinct node identities and reject removed or renamed references before submission', () => {
  const a = { id: 'asset-a', type: 'media', data: { title: '同名素材', media: { mediaKind: 'image' } } }
  const b = { ...a, id: 'asset-b' }
  const refs = context.canvasAgentReferences([a, b])
  assert.notEqual(refs[0].mention, refs[1].mention)
  const prompt = `使用 ${refs[1].mention} 设计分镜`
  assert.match(context.canvasAgentPrompt(prompt, [a, b]), /\["asset-b"\]/)
  assert.throws(() => context.canvasAgentPrompt(prompt, [a]), /移除或改名/)
  assert.throws(() => context.canvasAgentPrompt(prompt, [a, { ...b, data: { ...b.data, title: '新名称' } }]), /移除或改名/)
  assert.equal(context.canvasAgentPrompt('普通指令', [a, b]), '普通指令')
})
