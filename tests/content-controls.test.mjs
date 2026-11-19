import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function harness(file, dependencies = {}) {
  let cursor = 0, effects = [], slots = []
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useEffect(work, deps) { const index = cursor++; if (!slots[index] || deps.some((value, n) => !Object.is(value, slots[index].deps[n]))) { effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: work() } }) } },
  }
  const jsx = (type, props, key) => ({ type, props: props || {}, key })
  const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  const mocks = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': new Proxy({}, { get: (_, name) => name }), '@/lib/studio/i18n': { useUiText: () => (text, args = []) => text.replace(/\{(\d+)\}/g, (_, n) => args[n]) }, '@/components/ui/dialog': { Dialog: 'Dialog', DialogContent: 'DialogContent', DialogTitle: 'DialogTitle', DialogDescription: 'DialogDescription' }, './admin-kit': { AdminNotice: 'AdminNotice', AdminSectionCard: 'AdminSectionCard', AdminSaveBar: 'AdminSaveBar' }, './ui': { ControlButton: 'ControlButton' }, ...dependencies }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in mocks, name); return mocks[name] }, module, module.exports)
  function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)] }
  return { render(name, props, inner = false) { cursor = 0; effects = []; let tree = module.exports[name](props); if (inner) tree = tree.type(tree.props); const result = nodes(tree); effects.forEach(work => work()); return result } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('administrator switches submit independent watermark and confirmation settings', () => {
  let submitted
  const h = harness('components/studio/admin-watermark-settings.tsx')
  const props = { policy: { enabled: true, confirmationRequired: true }, saving: false, onSave: patch => { submitted = patch } }
  let tree = h.render('AdminWatermarkSettings', props)
  tree.filter(node => node.type === 'input')[0].props.onChange({ target: { checked: false } })
  tree = h.render('AdminWatermarkSettings', props)
  tree.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(submitted, { watermarkPolicy: { enabled: false, confirmationRequired: true } })
  tree.filter(node => node.type === 'input')[1].props.onChange({ target: { checked: false } })
  tree = h.render('AdminWatermarkSettings', props)
  tree.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(submitted, { watermarkPolicy: { enabled: false, confirmationRequired: false } })
})

test('adult opt-in requires two unchecked declarations, shows model restrictions and refreshes the session only after save', async () => {
  const calls = [], policyVersion = 'fixture-v1'; let refreshes = 0
  const data = { adultContent: { enabled: false, policyVersion }, agreement: { title: '成人内容使用约定', sections: [{ title: '保护未成年人', text: '禁止未成年人性化内容。' }] }, models: { allowed: [], blocked: [{ id: 'ordinary', name: '普通模型' }] } }
  const h = harness('components/studio/account-adult-content.tsx', {
    '@/lib/studio/store': { useStudio: () => ({ state: { user: { id: 'fixture' } }, refreshSession: async () => { refreshes++ } }) },
    '@/lib/studio/api': { request: async (url, options) => { calls.push([url, options]); return options?.method === 'PATCH' ? { ...data, adultContent: { enabled: true, policyVersion } } : data } },
  })
  const props = { open: true, onOpenChange() {} }
  h.render('AccountAdultContentDialog', props, true); await tick()
  let tree = h.render('AccountAdultContentDialog', props, true)
  tree.find(node => node.props?.role === 'switch').props.onChange({ target: { checked: true } })
  tree = h.render('AccountAdultContentDialog', props, true)
  const checkboxes = tree.filter(node => node.type === 'input' && node.props.role !== 'switch')
  assert.equal(checkboxes.length, 2); assert.ok(checkboxes.every(node => node.props.checked === false))
  assert.equal(tree.find(node => node.type === 'button' && node.props.disabled !== undefined && node.props.children === '保存设置').props.disabled, true)
  checkboxes[0].props.onChange({ target: { checked: true } })
  tree = h.render('AccountAdultContentDialog', props, true)
  assert.equal(tree.find(node => node.props?.children === '保存设置').props.disabled, true)
  tree.filter(node => node.type === 'input' && node.props.role !== 'switch')[1].props.onChange({ target: { checked: true } })
  tree = h.render('AccountAdultContentDialog', props, true)
  const save = tree.find(node => node.props?.children === '保存设置'); assert.equal(save.props.disabled, false)
  assert.equal(calls.length, 1); save.props.onClick(); await tick()
  assert.equal(calls.length, 2); assert.deepEqual(JSON.parse(calls[1][1].body), { enabled: true, adultConfirmed: true, acknowledgedPolicyVersion: policyVersion }); assert.equal(refreshes, 1)
  assert.ok(JSON.stringify(tree).includes('目前没有获准用于成人内容的模型'))
})

test('session model adapter independently excludes unapproved adult models, including route aliases', () => {
  const code = ts.transpileModule(readFileSync(new URL('../lib/studio/studio-models.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }; new Function('module', 'exports', code)(module, module.exports)
  const model = (id, allowAdultContent) => ({ id, name: id, enabled: true, capability: 'image', allowAdultContent, bindings: [{ id, enabled: true, upstreamModel: id, requestAlias: id + '-alias' }] })
  const settings = { adultContent: { enabled: true }, logicalModels: [model('ordinary', false), model('approved', true)] }
  const allowed = module.exports.modelsFromSession(settings); assert.ok(allowed.length > 0); assert.ok(allowed.every(model => model.id.startsWith('approved')))
  assert.ok(module.exports.modelsFromSession({ ...settings, adultContent: { enabled: false } }).some(model => model.id.startsWith('ordinary')))
})
