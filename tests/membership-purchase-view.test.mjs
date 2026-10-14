import assert from 'node:assert/strict'
import test from 'node:test'
import { all, card, confirmation, membership, text, viewHarness } from './helpers/membership-harness.mjs'

const product = (id, patch = {}) => ({ id, name: id, productKind: 'plan', amountCents: 1200, currency: 'CNY', pointsAmount: 100, dailyPoints: 3, periodDays: 30, enabled: true, sortOrder: 0, metadata: { membership: { groupId: 'studio', tierId: 'base', name: 'Synthetic studio', tierLabel: 'Basic', benefits: ['Monthly entitlement'], badge: 'Monthly badge', tone: 'advanced' } }, ...patch })
const policy = { status: 'published', version: 'test-1', pointsExpiryPolicy: 'Configured expiry', refundPolicy: 'Configured refunds', renewalPolicy: 'Configured renewals', invoicePolicy: 'Configured invoices', supportEmail: 'support@example.invalid', supportUrl: 'https://example.invalid/help' }
const plans = () => membership.toMembershipPlans([
  product('monthly'),
  product('annual', { amountCents: 8800, pointsAmount: 900, dailyPoints: 30, periodDays: 365, metadata: { membership: { groupId: 'studio', tierId: 'base', name: 'Synthetic studio', tierLabel: 'Basic', benefits: ['Annual entitlement'], badge: 'Annual badge', tone: 'luxury' } } }),
  product('large', { pointsAmount: 600, metadata: { membership: { groupId: 'studio', tierId: 'large', name: 'Synthetic studio', tierLabel: 'Large', benefits: ['Large entitlement'], tone: 'ultimate' } } }),
])
const findCards = tree => all(tree).filter(node => node.type === card)
const reviewNode = tree => all(tree).find(node => node.type === confirmation)
const action = tree => all(tree).find(node => node.type === 'Button')
const harness = extra => viewHarness({ products: plans(), initialBillingCycle: 'monthly', commercePolicy: { ...policy }, ...extra })
function choose(h, index = 0) {
  const offer = findCards(h.render())[index]
  action(card(offer.props)).props.onClick()
  return reviewNode(h.render())
}
function agree(h) { reviewNode(h.render()).props.onAgreementChange(true); return reviewNode(h.render()) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('period changes show the exact product price, credits, tone, daily grant, badge and benefits', () => {
  const h = harness()
  let offer = findCards(h.render())[0]
  let rendered = card(offer.props)
  assert.equal(rendered.props['data-product-id'], 'monthly')
  assert.equal(rendered.props['data-tone'], 'advanced')
  assert.match(text(rendered), /100/); assert.match(text(rendered), /每日 3 积分/)
  assert.match(text(rendered), /Monthly badge/); assert.match(text(rendered), /Monthly entitlement/)
  assert.doesNotMatch(text(rendered), /Annual entitlement|Annual badge|每日 30 积分/)
  all(h.render()).find(node => node.type === 'button' && text(node) === '年付').props.onClick()
  offer = findCards(h.render())[0]; rendered = card(offer.props)
  assert.equal(rendered.props['data-product-id'], 'annual'); assert.equal(rendered.props['data-tone'], 'luxury')
  assert.match(text(rendered), /900/); assert.match(text(rendered), /88\.00/); assert.match(text(rendered), /每日 30 积分/)
  assert.match(text(rendered), /Annual badge/); assert.match(text(rendered), /Annual entitlement/)
  assert.doesNotMatch(text(rendered), /Monthly entitlement|Monthly badge/)
})

test('selecting a tier opens review and only explicit agreement permits checkout', async () => {
  const calls = []; const h = harness({ onSelectPlan: selection => calls.push(selection) })
  const offer = findCards(h.render())[0]
  all(card(offer.props)).find(node => node.type === 'button' && text(node) === 'Large').props.onClick()
  let review = choose(h)
  assert.equal(calls.length, 0); assert.equal(review.props.selection.pricing.productId, 'large')
  assert.match(text(confirmation(review.props)), /Configured expiry|Configured refunds|Configured renewals|Configured invoices/)
  assert.equal(all(confirmation(review.props)).filter(node => node.type === 'a' && ['/terms', '/privacy'].includes(node.props.href)).length, 2)
  await review.props.onConfirm(); assert.equal(calls.length, 0)
  review = agree(h); await review.props.onConfirm()
  assert.equal(calls.length, 1); assert.equal(calls[0].pricing.productId, 'large'); assert.equal(calls[0].pricing.credits, 600)
  assert.equal(reviewNode(h.render()), undefined)
})

test('an asynchronous confirmation locks duplicate events and preserves errors for retry', async () => {
  const first = deferred(); const calls = []
  const h = harness({ onSelectPlan: selection => { calls.push(selection); return calls.length === 1 ? first.promise : Promise.resolve() } })
  choose(h); const review = agree(h)
  const pending = review.props.onConfirm()
  await review.props.onConfirm()
  assert.equal(calls.length, 1); assert.equal(reviewNode(h.render()).props.busy, true)
  reviewNode(h.render()).props.onCancel(); assert.ok(reviewNode(h.render()))
  first.reject(new Error('Synthetic checkout unavailable')); await pending
  const failed = reviewNode(h.render())
  assert.equal(failed.props.error, 'Synthetic checkout unavailable'); assert.equal(failed.props.agreed, true); assert.equal(failed.props.busy, false)
  await failed.props.onConfirm(); assert.equal(calls.length, 2); assert.equal(reviewNode(h.render()), undefined)
})

test('preview and noninteractive views allow browsing while suppressing order review', () => {
  for (const extra of [{ preview: true }, { interactive: false }]) {
    const calls = []; const changed = []; const h = harness({ ...extra, onSelectPlan: value => calls.push(value), onBillingCycleChange: value => changed.push(value) })
    const offer = findCards(h.render())[0]
    assert.equal(action(card(offer.props)).props.disabled, true)
    offer.props.onSelect({ plan: offer.props.plan, tier: offer.props.tier, billingCycle: 'monthly', pricing: offer.props.tier.pricing.monthly })
    assert.equal(reviewNode(h.render()), undefined)
    all(h.render()).find(node => node.type === 'button' && text(node) === '年付').props.onClick()
    assert.deepEqual(changed, ['annual']); assert.equal(findCards(h.render())[0].props.billingCycle, 'annual'); assert.equal(calls.length, 0)
  }
})

test('current memberships, disabled plans, invalid prices and missing periods cannot be purchased', () => {
  const current = harness({ currentMembership: { planId: 'creator:plan:studio', tierId: 'base', billingCycle: 'monthly' } })
  const currentOffer = findCards(current.render())[0]
  assert.equal(action(card(currentOffer.props)).props.disabled, true); assert.match(text(card(currentOffer.props)), /当前会员/)
  currentOffer.props.onSelect({ plan: currentOffer.props.plan, tier: currentOffer.props.tier, billingCycle: 'monthly', pricing: currentOffer.props.tier.pricing.monthly })
  assert.equal(reviewNode(current.render()), undefined)
  const disabled = plans(); disabled[0].disabled = true
  assert.equal(action(card(findCards(harness({ products: disabled }).render())[0].props)).props.disabled, true)
  const unavailable = harness({ initialBillingCycle: 'quarterly' })
  assert.equal(findCards(unavailable.render()).length, 0)
  for (const value of [undefined, -1, NaN, 3.4]) {
    const catalog = plans(); catalog[0].tiers.forEach(tier => { if (tier.pricing.monthly) tier.pricing.monthly.priceInCents = value })
    assert.equal(findCards(harness({ products: catalog }).render()).length, 0)
  }
})

test('changed catalog price or current membership blocks a previously reviewed selection', async () => {
  for (const changed of ['price', 'current', 'removed']) {
    const calls = []; const h = harness({ onSelectPlan: value => calls.push(value) })
    choose(h); agree(h)
    if (changed === 'price') h.input.products[0].tiers[0].pricing.monthly.priceInCents = 9999
    if (changed === 'current') h.input.currentMembership = { planId: h.input.products[0].id, tierId: 'base', billingCycle: 'monthly' }
    if (changed === 'removed') h.input.products = []
    await reviewNode(h.render()).props.onConfirm()
    assert.equal(calls.length, 0); assert.match(reviewNode(h.render()).props.error, /已变更/); assert.equal(reviewNode(h.render()).props.agreed, false)
  }
})

test('draft or incomplete policies block confirmation and policy changes require fresh consent', async () => {
  for (const commercePolicy of [null, { ...policy, status: 'draft' }, { ...policy, supportEmail: '', supportUrl: '' }, { ...policy, refundPolicy: '' }]) {
    const calls = []; const h = harness({ commercePolicy, onSelectPlan: value => calls.push(value) })
    choose(h); agree(h); await reviewNode(h.render()).props.onConfirm()
    assert.equal(calls.length, 0); assert.match(text(confirmation(reviewNode(h.render()).props)), /暂时无法下单/)
    assert.doesNotMatch(text(confirmation(reviewNode(h.render()).props)), /Configured refunds/)
  }
  const calls = []; const h = harness({ onSelectPlan: value => calls.push(value) })
  choose(h); agree(h); h.input.commercePolicy.refundPolicy = 'Changed refund policy'
  assert.equal(reviewNode(h.render()).props.agreed, false)
  await reviewNode(h.render()).props.onConfirm(); assert.equal(calls.length, 0)
  await agree(h).props.onConfirm(); assert.equal(calls.length, 1)
})

test('controlled audience and period emit callbacks and follow parent changes', () => {
  const teams = membership.toMembershipPlans([product('team', { metadata: { membership: { audience: 'team', name: 'Synthetic team' } } })])
  const audienceEvents = []; const cycleEvents = []; const tierEvents = []
  const h = harness({ products: [...plans(), ...teams], controlledAudience: 'creator', controlledBillingCycle: 'monthly', onAudienceChange: value => audienceEvents.push(value), onBillingCycleChange: value => cycleEvents.push(value), onTierChange: (...values) => tierEvents.push(values) })
  all(h.render()).find(node => node.type === 'button' && text(node) === '团队版').props.onClick()
  assert.deepEqual(audienceEvents, ['team']); assert.equal(findCards(h.render())[0].props.plan.audience, 'creator')
  h.input.controlledAudience = 'team'; assert.equal(findCards(h.render())[0].props.plan.name, 'Synthetic team')
  h.input.controlledAudience = 'creator'
  all(h.render()).find(node => node.type === 'button' && text(node) === '年付').props.onClick()
  assert.deepEqual(cycleEvents, ['annual']); assert.equal(findCards(h.render())[0].props.billingCycle, 'monthly')
  h.input.controlledBillingCycle = 'annual'; assert.equal(findCards(h.render())[0].props.billingCycle, 'annual')
  h.input.controlledBillingCycle = 'monthly'; const offer = findCards(h.render())[0]
  offer.props.onTierChange(offer.props.plan.tiers[1]); assert.deepEqual(tierEvents, [[offer.props.plan.id, 'large']])
  assert.equal(findCards(h.render())[0].props.tier.id, 'large')
})

test('folding also limits long base-benefit lists and preview defaults may expand them', () => {
  const catalog = membership.toMembershipPlans([product('many', { dailyPoints: 0, metadata: { membership: { benefits: Array.from({ length: 9 }, (_, index) => `Entitlement ${index + 1}`) } } })])
  const h = harness({ products: catalog })
  assert.equal(all(card(findCards(h.render())[0].props)).filter(node => node.type === 'li').length, 6)
  const toggle = all(h.render()).find(node => node.type === 'button' && text(node) === '查看更多权益')
  assert.equal(toggle.props['aria-expanded'], false); toggle.props.onClick()
  assert.equal(all(card(findCards(h.render())[0].props)).filter(node => node.type === 'li').length, 9)
  assert.equal(findCards(harness({ products: catalog, showMoreDefault: true }).render())[0].props.showMore, true)
})

test('loading, failure with retry, empty catalog and close remain explicit', () => {
  let retries = 0, closes = 0
  const h = harness({ status: 'loading', onRetry: () => retries++, onClose: () => closes++ })
  assert.equal(findCards(h.render()).length, 0); assert.match(text(h.render()), /正在读取/)
  h.input.status = 'error'; h.input.errorMessage = 'Synthetic catalog offline'
  assert.match(text(h.render()), /Synthetic catalog offline/)
  all(h.render()).find(node => node.type === 'Button').props.onClick(); assert.equal(retries, 1)
  all(h.render()).find(node => node.type === 'button' && node.props['aria-label'] === '关闭并返回').props.onClick(); assert.equal(closes, 1)
  h.input.status = 'ready'; h.input.products = []
  assert.match(text(h.render()), /暂无可购买/); assert.equal(findCards(h.render()).length, 0)
  assert.equal(all(h.render()).filter(node => node.type === 'img').length, 0)
})
