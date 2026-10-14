import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function compile(path, imports = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', code)(name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name] }, exports)
  return exports
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
const styles = { default: new Proxy({}, { get: (_, key) => key }) }
const icons = new Proxy({}, { get: (_, key) => key })
const membership = compile('lib/studio/membership.ts')
const drafts = compile('lib/studio/product-draft.ts')
const benefitHelpers = compile('components/membership/benefits.ts', { '@/lib/studio/membership': membership })
const card = compile('components/membership/plan-card.tsx', { 'react/jsx-runtime': jsx, 'lucide-react': icons, '@/components/ui/badge': { Badge: 'Badge' }, '@/components/ui/button': { Button: 'Button' }, '@/lib/studio/membership': membership, './membership.module.css': styles }).PlanCard
const view = compile('components/membership/membership-purchase-view.tsx', {
  'react/jsx-runtime': jsx, 'lucide-react': icons, react: { useState: value => [value, () => {}], useMemo: fn => fn() },
  '@/components/ui/button': { Button: 'Button' }, '@/components/ui/skeleton': { Skeleton: 'Skeleton' }, './billing-selector': { BillingSelector: 'BillingSelector' },
  './benefits': benefitHelpers, './campaign-banner': { CampaignBanner: 'CampaignBanner' }, './comparison-table': { ComparisonTable: 'ComparisonTable' },
  './membership-dialogs': { MembershipDialogs: 'MembershipDialogs' }, './membership-faq': { MembershipFaq: 'MembershipFaq' }, './membership.module.css': styles, './plan-card': { PlanCard: card },
}).MembershipPurchaseView
const dialog = compile('components/membership/membership-dialogs.tsx', {
  'react/jsx-runtime': jsx, '@/components/ui/button': { Button: 'Button' }, '@/components/ui/badge': { Badge: 'Badge' }, './membership.module.css': styles,
  '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map(name => [name, name])),
}).MembershipDialogs
const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)] : []
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const product = (id, extra = {}) => ({ id, name: id, productKind: 'points', amountCents: 1980, currency: 'CNY', pointsAmount: 880, dailyPoints: 0, periodDays: 0, enabled: true, sortOrder: 0, ...extra })
const baseProps = { generationColumns: [], generationRows: [], faqItems: [], onSelectPlan() {}, onClose() {} }

 test('catalog boundaries keep real points separate from plans, unknown kinds and disabled products', () => {
  const catalog = [product('credits'), product('off', { enabled: false }), product('month', { productKind: 'plan', periodDays: 30 }), product('unknown', { productKind: 'anything' })]
  const points = membership.toMembershipPlans(membership.storefrontProducts(catalog, 'points'))
  const plans = membership.toMembershipPlans(membership.storefrontProducts(catalog, 'plan'))
  assert.equal(points.length, 1); assert.equal(points[0].tiers[0].pricing.once.productId, 'credits')
  assert.equal(plans.length, 1); assert.equal(plans[0].tiers[0].pricing.monthly.productId, 'month')
})
test('credits storefront does not require or filter by membership audience', () => {
  const products = membership.toMembershipPlans([product('normal'), product('legacy-team', { metadata: { membership: { audience: 'team' } } })])
  const tree = view({ ...baseProps, products, storefront: 'credits', billingOptions: membership.billingOptions, initialBillingCycle: 'monthly' })
  const cards = all(tree).filter(node => node.type === card)
  assert.equal(cards.length, 2); assert.ok(cards.every(node => node.props.billingCycle === 'once'))
  assert.equal(all(tree).filter(node => node.type === 'BillingSelector').length, 0)
  assert.match(text(tree), /无需开通会员/)
})
test('empty points storefront shows configuration guidance without manufacturing products', () => {
  const tree = view({ ...baseProps, products: [], storefront: 'credits', billingOptions: membership.billingOptions })
  assert.equal(all(tree).filter(node => node.type === card).length, 0)
  assert.match(text(tree), /还没有上架的积分包/)
})
test('selected cycle and tier use their own saved tone, including automatic fallback', () => {
  const meta = tone => ({ membership: { groupId: 'one', tierId: 'same', tone } })
  const products = [product('month', { productKind: 'plan', periodDays: 30, metadata: meta('advanced') }), product('year', { productKind: 'plan', periodDays: 365, metadata: meta('luxury') }), product('other', { productKind: 'plan', periodDays: 30, metadata: { membership: { groupId: 'one', tierId: 'other' } } })]
  const plan = membership.toMembershipPlans(products)[0]
  const render = (tier, cycle) => card({ plan, tier, billingCycle: cycle, billingOption: membership.billingOptions.find(o => o.value === cycle), showMore: true, isCurrent: false, onTierChange() {}, onSelect() {}, onInstallment() {} })
  assert.equal(render(plan.tiers[0], 'monthly').props['data-tone'], 'advanced')
  assert.equal(render(plan.tiers[0], 'annual').props['data-tone'], 'luxury')
  assert.equal(render(plan.tiers[1], 'monthly').props['data-tone'], 'standard')
})
test('admin color draft roundtrip preserves metadata and exact purchased product price and credits', () => {
  const original = product('pack', { metadata: { untouched: 'keep', membership: { tone: 'standard' } } })
  const draft = drafts.productToDraft(original); draft.display.tone = 'premium'
  const payload = drafts.draftToPayload(draft)
  assert.equal(payload.metadata.membership.tone, 'premium'); assert.equal(payload.metadata.untouched, 'keep')
  const plan = membership.toMembershipPlans([{ ...original, ...payload }])[0]; let selected
  const tree = card({ plan, tier: plan.tiers[0], billingCycle: 'once', billingOption: membership.billingOptions.find(o => o.value === 'once'), showMore: true, isCurrent: false, onTierChange() {}, onSelect: value => { selected = value }, onInstallment() {} })
  all(tree).find(node => node.type === 'Button').props.onClick()
  assert.equal(tree.props['data-tone'], 'premium'); assert.equal(selected.pricing.productId, 'pack')
  assert.equal(selected.pricing.credits, 880); assert.equal(selected.pricing.priceInCents, 1980)
  assert.match(text(tree), /购买积分/)
})
test('order confirmation explains one-time credits and renders published policy, not a fabricated expiry', () => {
  const plan = membership.toMembershipPlans([product('pack')])[0]
  const selection = { plan, tier: plan.tiers[0], billingCycle: 'once', pricing: plan.tiers[0].pricing.once }
  const props = { selection, billingOption: membership.billingOptions.find(o => o.value === 'once'), commercePolicy: { version: 'synthetic-1', status: 'published', pointsExpiryPolicy: 'Synthetic confirmed permanent credits', refundPolicy: 'Synthetic refunds', renewalPolicy: 'No automatic renewal', invoicePolicy: 'Synthetic invoices' } }
  const tree = dialog(props)
  assert.match(text(tree), /确认购买积分/); assert.match(text(tree), /Synthetic confirmed permanent credits/)
  assert.doesNotMatch(text(tree), /确认开通会员/)
  assert.equal(all(tree).filter(node => node.type === 'a' && ['/terms', '/privacy'].includes(node.props.href)).length, 2)
  assert.doesNotMatch(text(dialog({ ...props, commercePolicy: { ...props.commercePolicy, status: 'draft' } })), /Synthetic confirmed permanent credits/)
})
test('close target excludes either storefront and keeps safe workbench query/hash', () => {
  const { safeReturnPath } = compile('lib/studio/return-path.ts')
  for (const value of ['/credits', '/credits?returnTo=/plans', '/plans', '//evil.test', '/\\evil.test']) assert.equal(safeReturnPath(value), '/studio')
  assert.equal(safeReturnPath('/projects/one?section=shots#last'), '/projects/one?section=shots#last')
})
