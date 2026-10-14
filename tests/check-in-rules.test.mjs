import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function moduleAt(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', code)(name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name] }, exports)
  return exports
}
const { readCheckInForm, checkInRuleChanges, checkInDisplay, formatPointsExpiry } = moduleAt('../lib/studio/check-in-rules.ts')
const { pointRecordBreakdown } = moduleAt('../lib/studio/ledger.ts')
const form = values => ({ has: key => Object.hasOwn(values, key), get: key => values[key] ?? null })
const base = { checkInEnabled: 'on', checkInRewardPoints: '10', checkInValidityMode: 'permanent' }
const status = extra => ({ enabled: true, claimed: false, date: '2026-10-14', timeZone: 'Asia/Shanghai', rewardPoints: 10, validityDays: 7, ...extra })

test('legacy forms default to permanent; permanent mode ignores a stale days draft', () => {
  assert.deepEqual(readCheckInForm(form({ checkInRewardPoints: '10' }), []), { enabled: false, rewardPoints: 10, validityDays: 0, planRewards: [] })
  assert.equal(readCheckInForm(form({ ...base, checkInValidityDays: 'invalid hidden value' }), []).validityDays, 0)
})

test('a full replacement payload removes inherited and deleted plan rules while keeping custom values', () => {
  const fields = { ...base, checkInValidityMode: 'limited', checkInValidityDays: '1', 'checkInPlan:pro:Enabled': 'on', 'checkInPlan:pro:RewardPoints': '500', 'checkInPlan:pro:ValidityMode': 'limited', 'checkInPlan:pro:ValidityDays': '30', 'checkInPlan:removed:Enabled': 'on', 'checkInPlan:removed:RewardPoints': '999' }
  const saved = readCheckInForm(form(fields), [{ id: 'pro' }, { id: 'basic' }])
  assert.deepEqual(saved, { enabled: true, rewardPoints: 10, validityDays: 1, planRewards: [{ planId: 'pro', rewardPoints: 500, validityDays: 30 }] })
  delete fields['checkInPlan:pro:Enabled']
  assert.deepEqual(readCheckInForm(form(fields), [{ id: 'pro' }]).planRewards, [])
})

test('limited reward rules reject empty, fractional, negative, nonnumeric and out-of-range days or points', () => {
  for (const value of ['', '0', '-1', '1.5', '3651', 'Infinity', '1e2']) assert.throws(() => readCheckInForm(form({ ...base, checkInValidityMode: 'limited', checkInValidityDays: value }), []))
  for (const value of ['', '0', '-1', '1.5', '1000001', 'NaN']) assert.throws(() => readCheckInForm(form({ ...base, checkInRewardPoints: value }), []))
  for (const value of ['1', '3650']) assert.equal(readCheckInForm(form({ ...base, checkInValidityMode: 'limited', checkInValidityDays: value }), []).validityDays, Number(value))
  assert.throws(() => readCheckInForm(form({ ...base, 'checkInPlan:pro:Enabled': 'on', 'checkInPlan:pro:RewardPoints': '15', 'checkInPlan:pro:ValidityMode': 'limited', 'checkInPlan:pro:ValidityDays': '0' }), [{ id: 'pro' }]))
})

test('save review lists real plan amounts and expiry changes, and ignores ordering or missing zero defaults', () => {
  const old = { enabled: true, rewardPoints: 10, planRewards: [{ planId: 'pro', rewardPoints: 100, validityDays: 30 }] }
  const next = { ...old, validityDays: 0, planRewards: [{ planId: 'pro', rewardPoints: 200, validityDays: 7 }] }
  assert.deepEqual(checkInRuleChanges(old, next, [{ id: 'pro', name: '专业套餐' }]), ['专业套餐：200 积分，领取后 7 天有效'])
  assert.deepEqual(checkInRuleChanges(old, { ...old, validityDays: 0 }, []), [])
  assert.deepEqual(checkInRuleChanges(old, { ...old, planRewards: [] }, [{ id: 'pro', name: '专业套餐' }]), ['专业套餐：移除专属规则，沿用基础规则'])
})

test('claimed display uses the actual reward, plan and expiry snapshot even after rules or plan change', () => {
  const result = checkInDisplay(status({ rewardPoints: 999, validityDays: 0, rulePlanName: '新套餐', claimed: true, claimedRewardPoints: 25, claimedValidityDays: 1, claimedPlanName: '领取时套餐', expiresAt: '2026-10-15T16:00:05.000Z' }))
  assert.equal(result.title, '今日已领取 25 积分')
  assert.equal(result.rule, '领取时套餐 · 领取时规则')
  assert.match(result.validity, /2026\/10\/16 00:00:05 到期（北京时间）/)
  assert.doesNotMatch(JSON.stringify(result), /999|新套餐|永久/)
})

test('permanent claims stay permanent after new rule becomes limited; missing old snapshots do not invent expiry', () => {
  assert.equal(checkInDisplay(status({ claimed: true, claimedValidityDays: 0, expiresAt: null })).validity, '本次奖励永久有效')
  const legacy = checkInDisplay(status({ claimed: true }))
  assert.equal(legacy.title, '今日已领取')
  assert.equal(legacy.validity, '本次奖励有效期以账户记录为准')
  assert.equal(formatPointsExpiry('not a date'), null)
  assert.equal(checkInDisplay(status({ claimed: true, claimedValidityDays: 7, expiresAt: null })).validity, '本次奖励有效期以账户记录为准')
  assert.match(checkInDisplay(status({ rulePlanName: '专业套餐' })).rule, /专业套餐/)
  assert.equal(checkInDisplay(status({ validityDays: 0 })).validity, '奖励永久有效')
  assert.match(checkInDisplay(status({ validityDays: 30 })).validity, /30 天/)
})

function editor() {
  const values = []; let cursor = 0
  const react = { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = value }] } }
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  const api = moduleAt('../components/studio/admin-check-in-settings.tsx', { react, 'react/jsx-runtime': jsx, './admin-kit': { AdminField: 'label', AdminInput: 'input', AdminSelect: 'select' } })
  const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
  return { api, all, render(props) { cursor = 0; return all(api.CheckInRewardFields(props)) } }
}

test('admin controls restore a saved limited rule, switch modes and retain custom/preset days', () => {
  const e = editor(), props = { prefix: 'checkIn', initial: { rewardPoints: 25, validityDays: 30 } }
  let nodes = e.render(props)
  assert.equal(nodes.find(n => n.props?.name === 'checkInValidityMode').props.value, 'limited')
  assert.equal(nodes.find(n => n.props?.name === 'checkInValidityDays').props.value, '30')
  assert.equal(nodes.find(n => n.props?.name === 'checkInRewardPoints').props.defaultValue, 25)
  nodes.find(n => n.type === 'button' && n.props.children[0] === 7).props.onClick()
  nodes = e.render(props)
  assert.equal(nodes.find(n => n.props?.name === 'checkInValidityDays').props.value, '7')
  nodes.find(n => n.props?.name === 'checkInValidityMode').props.onChange({ target: { value: 'permanent' } })
  nodes = e.render(props)
  assert.equal(nodes.some(n => n.props?.name === 'checkInValidityDays'), false)
  nodes.find(n => n.props?.name === 'checkInValidityMode').props.onChange({ target: { value: 'limited' } })
  nodes = e.render(props)
  assert.equal(nodes.find(n => n.props?.name === 'checkInValidityDays').props.value, '7')
  assert.equal(nodes.find(n => n.props?.name === 'checkInValidityDays').props.required, true)
})

test('admin saving disables the entire rule editor and missing validity starts permanent', () => {
  const e = editor()
  const root = e.api.AdminCheckInSettings({ settings: { enabled: false, rewardPoints: 10 }, plans: [], saving: true })
  assert.equal(root.type, 'fieldset'); assert.equal(root.props.disabled, true)
  const nodes = e.render({ prefix: 'checkIn', initial: { rewardPoints: 10 } })
  assert.equal(nodes.find(n => n.props?.name === 'checkInValidityMode').props.value, 'permanent')
  assert.equal(nodes.some(n => n.props?.name === 'checkInValidityDays'), false)
})

test('ledger breakdown preserves three independent bucket changes without double-counting the total', () => {
  assert.equal(pointRecordBreakdown({ permanentAmount: -3, dailyAmount: -2, timedAmount: -5, amount: -10 }), '永久 -3 · 每日 -2 · 限时 -5')
  assert.equal(pointRecordBreakdown({ permanentAmount: 0, dailyAmount: 0, timedAmount: 25 }), '限时 +25')
  assert.equal(pointRecordBreakdown({ permanentAmount: 10, dailyAmount: 0 }), '永久 +10')
})
