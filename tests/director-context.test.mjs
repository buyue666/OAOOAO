import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../lib/studio/director-context.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { assistantSuggestions, assistantThreadKey, assistantContextLabel, buildAssistantPrompt, dramaAssistantContext } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('unknown context makes no claims about a selected project or test storyline', () => {
  const context = { surface: 'chat' }
  assert.match(assistantContextLabel(context), /尚未关联项目/)
  assert.doesNotMatch(assistantSuggestions(context).join(''), /雪地|极光|当前镜头|已提供的项目/)
  assert.doesNotMatch(buildAssistantPrompt('想做一个产品短片', context), /projectTitle|shot/)
})
test('suggestions prefer the user draft and retain it when a suggestion is chosen', () => {
  const suggestions = assistantSuggestions({ surface: 'drama', projectTitle: '真实项目', shot: { description: '纸张展开' } }, '城市里的陶艺师')
  assert.ok(suggestions.every((s) => s.includes('城市里的陶艺师')))
  assert.ok(suggestions.every((s) => !s.includes('纸张展开')))
})
test('project context binds only the selected project, episode and shot and preserves draft state', () => {
  const project = { id: 'p1', title: '陶艺', summary: '从泥土到器物', characters: [{ name: '陶艺师' }], scenes: [], props: [] }
  const shot = { id: 's1', title: '拉坯', description: '双手托住泥坯', dialogue: '', narration: '', cameraMotion: '', imagePrompt: '', videoPrompt: '' }
  const context = dramaAssistantContext(project, { title: '第一集', script: '工作室的清晨' }, shot, true)
  const wire = buildAssistantPrompt('建议运镜', context)
  assert.equal(context.surface, 'drama'); assert.equal(context.projectId, 'p1')
  assert.match(wire, /双手托住泥坯/); assert.match(wire, /工作室的清晨/)
  assert.match(assistantContextLabel(context), /包含未保存草稿/)
  assert.ok(wire.length < 14000)
})
test('thread storage separates accounts, projects and surfaces including encoded separators', () => {
  const keys = [assistantThreadKey('alice', 'drama', 'one'), assistantThreadKey('bob', 'drama', 'one'), assistantThreadKey('alice', 'drama', 'two'), assistantThreadKey('alice', 'canvas', 'one'), assistantThreadKey('alice:drama', 'chat', 'one')]
  assert.equal(new Set(keys).size, keys.length)
})
test('large context is bounded instead of silently claiming all content was read', () => {
  const prompt = buildAssistantPrompt('a'.repeat(5000), { surface: 'drama', script: 'b'.repeat(50000), summary: 'c'.repeat(50000) })
  assert.ok(prompt.length < 8500); assert.match(prompt, /截断/)
})
test('choosing a direction preserves the full user-written brief, including its ending', () => {
  const brief = `${'用户的详细创作内容'.repeat(350)}最后必须保留陶碗裂纹`
  for (const suggestion of assistantSuggestions({ surface: 'chat' }, brief)) {
    assert.ok(suggestion.includes(brief))
    assert.ok(buildAssistantPrompt(suggestion, { surface: 'chat' }).includes('最后必须保留陶碗裂纹'))
  }
})
