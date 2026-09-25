const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../lib/studio/membership.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const context = { exports: {} }
vm.runInNewContext(compiled, context)
const { toMembershipPlans, productCycle } = context.exports
const product = (id, patch = {}) => ({ id, name: id, productKind: 'plan', planId: 'creator', amountCents: 1234, currency: 'CNY', pointsAmount: 1000, dailyPoints: 0, periodDays: 30, enabled: true, sortOrder: 0, ...patch })

test('retains cents and real promotion price without dividing yearly total', () => {
  const p = product('annual', { periodDays: 365, amountCents: 29900, pricing: { saleUnitAmountCents: 23920, promotion: { label: 'sale' } } })
  const price = toMembershipPlans([p])[0].tiers[0].pricing.annual
  assert.equal(price.priceInCents, 23920)
  assert.equal(price.originalPriceInCents, 29900)
  assert.equal(price.productId, 'annual')
  assert.equal(price.currency, 'CNY')
})
test('does not merge independent products sharing the same entitlement', () => {
  const plans = toMembershipPlans([product('A'), product('B')])
  assert.equal(plans.length, 2)
})
test('groups explicit tiers and cycles while preserving the purchasable product ID', () => {
  const metadata = { membership: { groupId: 'pro', tierId: 'base', name: 'Pro' } }
  const plans = toMembershipPlans([product('month', { metadata }), product('year', { metadata, periodDays: 365 })])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].tiers[0].pricing.monthly.productId, 'month')
  assert.equal(plans[0].tiers[0].pricing.annual.productId, 'year')
})
test('disabled products are absent, one-time products do not become subscriptions', () => {
  const plans = toMembershipPlans([product('off', { enabled: false }), product('credits', { productKind: 'points' })])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].tiers[0].pricing.once.productId, 'credits')
  assert.equal(plans[0].tiers[0].pricing.monthly, undefined)
  assert.equal(productCycle(product('quarter', { periodDays: 90 })), 'quarterly')
})
test('duplicate cycle products remain selectable and do not overwrite each other', () => {
  const metadata = { membership: { groupId: 'pro', tierId: 'base' } }
  const tiers = toMembershipPlans([product('A', { metadata }), product('B', { metadata })])[0].tiers
  assert.equal(tiers.length, 2)
  assert.equal(tiers[0].pricing.monthly.productId, 'A')
  assert.equal(tiers[1].pricing.monthly.productId, 'B')
})
