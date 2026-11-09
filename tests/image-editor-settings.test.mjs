import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(path, imports = {}) { const module = { exports: {} }; const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; new Function('require', 'module', 'exports', code)(name => imports[name], module, module.exports); return module.exports }
const videoPolicy = load('../lib/studio/video-policy.ts')
const { imageEditorModelSettings, imageEditorVideoInput } = load('../lib/studio/image-editor-settings.ts', { './video-policy': videoPolicy })
const model = { id: 'video-fixture', shortName: 'Video', capability: 'video', creditCost: 0, capabilities: { qualities: ['720p'], ratios: ['16:9', '9:16'], resolutions: ['1K'], durations: ['4 秒', '6 秒', '8 秒'], firstFrame: true, videoPolicy: { durationRules: { '720p': { mode: 'list', values: [4, 6] } } } } }
test('dynamic video prices are not labelled as zero per call and frame durations honor the policy', () => {
  const options = imageEditorModelSettings(model)
  assert.equal(options.label, 'Video')
  assert.deepEqual(options.videoDurations['720p'], [4,6])
  assert.equal(imageEditorModelSettings({ ...model, capability: 'image', creditCost: 3 }).label, 'Video · 3 积分/张')
})
test('quote and submit share compatible aspect ratio, quality, seconds and the actual source role', () => {
  const input = imageEditorVideoInput(model, '/api/reference-assets/synthetic', '1:1', '720p', 6)
  assert.deepEqual(input, { model: 'video-fixture', ratio: '16:9', quality: '720p', seconds: 6, references: [{ type: 'image', url: '/api/reference-assets/synthetic', role: 'first_frame' }] })
  const reference = imageEditorVideoInput({ ...model, capabilities: { ...model.capabilities, firstFrame: false } }, 'data:image/png;base64,c3ludGhldGlj', '9:16', '720p', 4)
  assert.equal(reference.ratio, '9:16'); assert.equal(reference.references[0].role, undefined); assert.ok(reference.references[0].dataUrl); assert.equal(reference.references[0].url, undefined)
})
