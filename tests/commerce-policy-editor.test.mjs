import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
function compile(source, imports = {}) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
  const exports = {}
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in imports, `Unexpected runtime dependency: ${name}`)
    return imports[name]
  }, exports)
  return exports
}
const policyHelpers = compile(read('../lib/studio/commerce-policy.ts'))
const completePolicy = { version: 'synthetic-v1', status: 'draft', refundPolicy: 'Synthetic refunds', pointsExpiryPolicy: 'Synthetic expiry', renewalPolicy: 'No automatic renewal', invoicePolicy: 'Synthetic invoice', supportEmail: 'fixture@example.test', supportUrl: '' }
const legalSite = { termsUrl: '/terms', termsVersion: 'synthetic-1', termsContent: 'Synthetic terms', privacyUrl: '/privacy', privacyVersion: 'synthetic-1', privacyContent: 'Synthetic privacy' }
const controls = Object.fromEntries(['AdminField', 'AdminInput', 'AdminNotice', 'AdminSaveBar', 'AdminSectionCard', 'AdminTextarea', 'ControlButton', 'StatusBadge'].map((name) => [name, name]))
function all(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : [] }
function text(node) { return typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : '' }

function fixture({ policy = completePolicy, site = legalSite, allowed = true, saving = false } = {}) {
  const states = [], effects = []
  let stateCursor = 0, effectCursor = 0, pending = []
  const writes = []
  const react = {
    useState(initial) { const index = stateCursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
    useMemo(fn) { return fn() },
    useEffect(fn, deps) { const index = effectCursor++; if (!effects[index] || deps.some((value, i) => !Object.is(value, effects[index][i]))) { effects[index] = deps; pending.push(fn) } },
  }
  const { CommercePolicyEditor } = compile(read('../components/studio/commerce-policy-editor.tsx'), {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/studio/commerce-policy': policyHelpers,
    './ui': controls,
    './admin-kit': controls,
    './admin-shell': { useAdminSession: () => ({ can: (permission) => allowed && permission === 'commerce.manage' }) },
  })
  function render() {
    stateCursor = 0; effectCursor = 0; pending = []
    const output = CommercePolicyEditor({ settings: { site, commercePolicy: policy }, saving, onSave: (patch, summary) => writes.push({ patch, summary }) })
    if (pending.length) { pending.forEach((fn) => fn()); return render() }
    return output
  }
  return { render, writes, button: (label) => all(render()).find((node) => node.type === 'ControlButton' && text(node) === label), nodes: (type) => all(render()).filter((node) => node.type === type) }
}

test('a complete saved draft can publish without already being published', () => {
  const f = fixture()
  assert.ok(f.nodes('StatusBadge').some((badge) => text(badge) === '草稿 synthetic-v1'))
  const publish = f.button('发布已保存版本')
  assert.equal(publish.props.disabled, false)
  publish.props.onClick()
  assert.deepEqual(f.writes, [{ patch: { commercePolicy: { ...completePolicy, status: 'published' } }, summary: ['发布购买政策'] }])
})

test('incomplete saved policy or missing legal text cannot publish', () => {
  for (const options of [{ policy: { ...completePolicy, version: '' } }, { policy: { ...completePolicy, supportEmail: '' } }, { site: { ...legalSite, privacyContent: '' } }]) {
    const f = fixture(options)
    const publish = f.button('发布已保存版本')
    assert.equal(publish.props.disabled, true)
    publish.props.onClick()
    assert.equal(f.writes.length, 0)
  }
})

test('unsaved edits must be saved as a draft before publication', () => {
  const f = fixture()
  f.nodes('AdminInput')[0].props.onChange({ target: { value: 'synthetic-v2' } })
  const publish = f.button('发布已保存版本')
  assert.equal(publish.props.disabled, true)
  publish.props.onClick()
  assert.equal(f.writes.length, 0)
  f.button('保存草稿').props.onClick()
  assert.equal(f.writes[0].patch.commercePolicy.version, 'synthetic-v2')
  assert.equal(f.writes[0].patch.commercePolicy.status, 'draft')
})

test('published status stays accurate and withdrawal remains possible if legal configuration later becomes incomplete', () => {
  const complete = fixture({ policy: { ...completePolicy, status: 'published' } })
  assert.ok(complete.nodes('StatusBadge').some((badge) => text(badge) === '已发布 synthetic-v1'))
  const incomplete = fixture({ policy: { ...completePolicy, status: 'published' }, site: { ...legalSite, termsContent: '' } })
  assert.ok(!incomplete.nodes('StatusBadge').some((badge) => text(badge).startsWith('已发布')))
  const withdraw = incomplete.button('撤回发布')
  assert.equal(withdraw.props.disabled, false)
  withdraw.props.onClick()
  assert.equal(incomplete.writes[0].patch.commercePolicy.status, 'draft')
})

test('administrators without commerce permission retain read-only content and cannot invoke write callbacks', () => {
  for (const status of ['draft', 'published']) {
    const f = fixture({ policy: { ...completePolicy, status }, allowed: false })
    assert.equal(f.nodes('AdminInput')[0].props.value, 'synthetic-v1')
    assert.equal(f.nodes('fieldset')[0].props.disabled, true)
    assert.ok(f.nodes('AdminNotice').some((notice) => text(notice).includes('没有购买政策管理权限')))
    for (const button of f.nodes('ControlButton')) { assert.equal(button.props.disabled, true); button.props.onClick() }
    assert.equal(f.writes.length, 0)
  }
})

test('saving blocks duplicate publication and withdrawal callbacks', () => {
  for (const status of ['draft', 'published']) {
    const f = fixture({ policy: { ...completePolicy, status }, saving: true })
    for (const button of f.nodes('ControlButton')) { assert.equal(button.props.disabled, true); button.props.onClick() }
    assert.equal(f.writes.length, 0)
  }
})
