import assert from 'node:assert/strict'
import test from 'node:test'
import { all, card, compile, confirmation as dialog, drafts, membership, text, view } from './helpers/membership-harness.mjs'
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
  const props = { selection, billingOption: membership.billingOptions.find(o => o.value === 'once'), commercePolicy: { version: 'synthetic-1', status: 'published', pointsExpiryPolicy: 'Synthetic confirmed permanent credits', refundPolicy: 'Synthetic refunds', renewalPolicy: 'No automatic renewal', invoicePolicy: 'Synthetic invoices', supportEmail: 'support@example.invalid', supportUrl: '' } }
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

test('renaming the product updates inherited titles and preserves an explicit storefront title', () => {
  const original = drafts.productToDraft(product('pack', { name: '旧商品' }))
  assert.equal(drafts.renameProductDraft(original, '新商品').display.name, '新商品')
  original.display.name = '自定义标题'
  assert.equal(drafts.renameProductDraft(original, '新商品').display.name, '自定义标题')
})

test('generation notes roundtrip as plain text, stay within their own cycle and are hidden when empty', () => {
  const draft = drafts.productToDraft(product('month', { productKind: 'plan', periodDays: 30, metadata: { membership: { groupId: 'notes', tierId: 'same', generationSummary: '可生成约100张', generationSummaryNote: '  实际消耗取决于模型 <b>文本</b>  ' } } }))
  const month = { ...product('month'), ...drafts.draftToPayload(draft) }
  const year = product('year', { productKind: 'plan', periodDays: 365, metadata: { membership: { groupId: 'notes', tierId: 'same', generationSummary: '年度说明' } } })
  const plan = membership.toMembershipPlans([month, year])[0]
  const render = cycle => card({ plan, tier: plan.tiers[0], billingCycle: cycle, billingOption: membership.billingOptions.find(o => o.value === cycle), showMore: true, isCurrent: false })
  const info = all(render('monthly')).find(node => node.props?.label === '生成量说明备注')
  const nodes = all(info.type(info.props))
  assert.equal(nodes.find(node => node.props?.role === 'tooltip').props.children, '实际消耗取决于模型 <b>文本</b>')
  assert.equal(nodes.filter(node => node.props?.['aria-label'] === '生成量说明备注').length, 1)
  assert.equal(all(render('annual')).filter(node => node.props?.label === '生成量说明备注').length, 0)
})

test('subscription terms separate the check-in expiry from the order duration and generation estimate', () => {
  const [plan] = membership.toMembershipPlans([product('month', { productKind: 'plan', periodDays: 31, dailyPoints: 10, pointsAmount: 1000, metadata: { membership: { generationSummaryNote: '图片：模型 A\n视频：模型 B' } } })])
  const nodes = all(card({ plan, tier: plan.tiers[0], billingCycle: 'monthly', billingOption: membership.billingOptions.find(o => o.value === 'monthly'), showMore: true, isCurrent: false }))
  assert.match(nodes.find(node => node.props?.label === '会员签到积分说明').props.note, /当期会员有效期内可用/)
  assert.equal(nodes.find(node => node.props?.label === '生成量说明备注').props.note, '图片：模型 A\n视频：模型 B')
  assert.ok(nodes.some(node => node.props?.children === '每日 10 积分 · 全期最多 310'))
})

test('the shared billing route retains only a safe return destination across catalog views', () => {
  const returns = compile('lib/studio/return-path.ts')
  const { billingStoreHref } = compile('lib/studio/billing-store-route.ts', { './return-path': returns })
  assert.equal(billingStoreHref('credits', '/image?mode=edit#prompt'), '/plans?view=credits&returnTo=%2Fimage%3Fmode%3Dedit%23prompt')
  assert.equal(billingStoreHref('team', '//example.invalid'), '/plans?edition=team')
  assert.equal(billingStoreHref('personal', '/plans?view=credits'), '/plans')
})

test('benefit sections keep their headings and global fold limit without empty groups', () => {
  const plan = membership.toMembershipPlans([product('grouped', { metadata: { membership: { promotions: ['活动一', '活动二'], benefits: ['基础一', '基础二', '基础三'], exclusiveBenefits: ['独家一', '独家二'], extraBenefits: ['其他一'] } } })])[0]
  const props = { plan, tier: plan.tiers[0], billingCycle: 'once', billingOption: membership.billingOptions.find(o => o.value === 'once'), isCurrent: false }
  const folded = card({ ...props, showMore: false })
  assert.deepEqual(all(folded).filter(node => node.type === 'section').map(node => node.props['aria-label']), ['积分与预计生成量', '限时活动', '基础权益'])
  assert.equal(all(folded).filter(node => node.type === 'li').length, 3)
  assert.match(text(folded), /还有 5 项权益/)
  const expanded = card({ ...props, showMore: true })
  assert.deepEqual(all(expanded).filter(node => node.type === 'section').map(node => node.props['aria-label']), ['积分与预计生成量', '限时活动', '基础权益', '独家功能', '更多权益'])
  assert.equal(all(expanded).filter(node => node.type === 'li').length, 8)
})
