import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 活动价编辑入口的复现与回归验收。
 *
 * 用户报告：「没有活动价的编辑入口」。
 * 复现结论（本轮已核实）：商品编辑器里只有只读的「价格与折扣（自动计算）」面板，
 * 字段列表里没有任何活动价输入；要改某个商品的活动价，必须切到「促销活动」区块
 * → 找到包含该商品的活动 → 再在活动里找到该商品那一行。单个商品没有自己的入口。
 * 同时促销活动表格也**没有删除入口**（后端 DELETE 早已存在）。
 *
 * 本脚本覆盖：
 *   A. 商品编辑器有可编辑的活动价字段（设置 / 更新 / 清除）；
 *   B. 写入结果与后端一致（后端返回的 pricing 作为权威值）；
 *   C. 校验与后端同规则（必须 > 0 且 < 日常价）；
 *   D. 用户套餐页 /plans 反映活动价与折扣；
 *   E. 促销活动表格有删除入口，删除后商品恢复日常价；
 *   F. 活动价写入不会被误判为「商品有未保存修改」。
 *
 * 隔离：本脚本创建 `PROMO-TEST-*` 商品并在结束时删除；
 * 若环境里已存在同名残留，先清理再创建。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const PRODUCT_NAME = 'PROMO-TEST-活动价入口'
/** 订阅套餐必须关联一个已启用的权益方案；本环境的启用户权益方案。 */
const PLAN_ID = 'pro'
const LIST_YUAN = 200
const PROMO_YUAN = 150
const PROMO_YUAN_UPDATED = 120
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const browser = await chromium.launch()
let page
try {
  const session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
  page = session.page
  console.log(`[会话] ${session.reused ? '复用已登录会话' : '已登录'}`)
} catch (error) {
  if (error.throttled) { await browser.close(); exitThrottled(error.message) }
  throw error
}

/** 通过页面内 fetch 调管理端接口，浏览器自带 Cookie。 */
const api = (path, init) => page.evaluate(async ({ path, init }) => {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}, { path, init })

const listProducts = async () => (await api('/api/admin/billing/products')).body?.products ?? []
const listPromotions = async () => (await api('/api/admin/billing/promotions')).body?.data?.campaigns ?? []

/** 清理：删除测试商品与它参与的活动（活动清空后单独删除）。 */
async function cleanup() {
  const promotions = await listPromotions()
  for (const campaign of promotions) {
    const products = await listProducts()
    const ids = new Set(products.filter((product) => product.name.startsWith('PROMO-TEST')).map((product) => product.id))
    if (!campaign.products.some((entry) => ids.has(entry.productId))) continue
    const remaining = campaign.products.filter((entry) => !ids.has(entry.productId))
    if (!remaining.length) await api(`/api/admin/billing/promotions/${campaign.id}`, { method: 'DELETE' })
    else await api(`/api/admin/billing/promotions/${campaign.id}`, { method: 'PATCH', body: JSON.stringify({ ...campaign, products: remaining }) })
  }
  for (const product of await listProducts()) {
    if (product.name.startsWith('PROMO-TEST')) await api(`/api/admin/billing/products/${product.id}`, { method: 'DELETE' })
  }
}

await cleanup()
const created = await api('/api/admin/billing/products', {
  method: 'POST',
  body: JSON.stringify({
    name: PRODUCT_NAME,
    productKind: 'plan',
    // 订阅套餐必须关联一个**已启用**的权益方案，否则后端返回
    // 「套餐不存在或已停用」（404）。本环境的已启用方案为 free/creator/pro。
    planId: PLAN_ID,
    amountCents: LIST_YUAN * 100,
    currency: 'CNY',
    pointsAmount: 1000,
    dailyPoints: 10,
    periodDays: 365,
    sortOrder: 900,
    enabled: true,
    metadata: { membership: { name: 'PROMO-TEST 套餐', groupId: 'promo-test-group', tierId: 'default', tierLabel: '活动价验证', tone: 'advanced', benefits: ['测试权益一', '测试权益二'] } },
  }),
})
const productId = created.body?.product?.id
if (!productId) {
  console.log(`无法创建隔离测试商品：${JSON.stringify(created).slice(0, 400)}`)
  await browser.close()
  process.exit(1)
}
console.log(`[隔离商品] ${productId} 日常价 ${LIST_YUAN} 元`)

const productRow = () => page.locator('tr', { hasText: PRODUCT_NAME }).first()
const openProductEditor = async () => {
  await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  await productRow().locator('button:has-text("编辑")').first().click()
  await page.waitForTimeout(2500)
}
const closeDrawer = async () => {
  await page.locator('[role="dialog"] button[aria-label="关闭"]').first().click().catch(() => null)
  await page.waitForTimeout(1000)
  const discard = page.locator('button:has-text("放弃修改")')
  if (await discard.count()) { await discard.first().click(); await page.waitForTimeout(1000) }
}
const summaryText = () => page.evaluate(() => {
  const panel = document.querySelector('[data-testid="product-price-summary"]')
  return {
    panel: panel?.innerText ?? null,
    activePrice: panel?.querySelector('[data-testid="product-active-price"]')?.textContent?.trim() ?? null,
    discount: panel?.querySelector('[data-testid="product-discount"]')?.textContent?.trim() ?? null,
    hasPromoEditor: Boolean(panel?.querySelector('[data-testid="product-promotion-editor"]')),
    promoLabel: panel?.querySelector('[data-testid="product-promo-amount"]')?.getAttribute('aria-label') ?? null,
    promoValue: panel?.querySelector('[data-testid="product-promo-amount"]')?.value ?? null,
    promoError: panel?.querySelector('[data-testid="product-promo-error"]')?.textContent?.trim() ?? null,
    promoNotice: panel?.querySelector('[data-testid="product-promo-notice"]')?.textContent?.trim() ?? null,
    saveDisabled: panel?.querySelector('[data-testid="product-promo-save"]')?.disabled ?? null,
    clearVisible: Boolean(panel?.querySelector('[data-testid="product-promo-clear"]')),
    drawerDesc: document.querySelector('[role="dialog"] header p')?.textContent?.trim() ?? null,
  }
})

/* ======================================================================
 * A. 商品编辑器有可编辑的活动价字段
 * ==================================================================== */

await openProductEditor()
const baseline = await summaryText()
check('商品编辑器出现活动价编辑入口', baseline.hasPromoEditor, `面板文本=${JSON.stringify(baseline.panel?.slice(0, 120))}`)
check('活动价输入框可被定位且初始为空', baseline.promoLabel === '活动价（元）' && baseline.promoValue === '', `aria-label=${baseline.promoLabel} value=${JSON.stringify(baseline.promoValue)}`)
check('未设置活动价时不显示「清除活动价」', baseline.clearVisible === false, `clearVisible=${baseline.clearVisible}`)
check('未设置活动价时后端 pricing 无折扣', (await listProducts()).find((p) => p.id === productId)?.pricing?.discountCents === 0, `discountCents=${(await listProducts()).find((p) => p.id === productId)?.pricing?.discountCents}`)

/* ======================================================================
 * C. 校验与后端同规则（必须在提交前就拦住）
 * ==================================================================== */

await page.fill('[data-testid="product-promo-amount"]', String(LIST_YUAN))
await page.waitForTimeout(1500)
const tooHigh = await summaryText()
check('活动价等于日常价时提示错误并禁用保存', Boolean(tooHigh.promoError) && tooHigh.saveDisabled === true, `error=${JSON.stringify(tooHigh.promoError)} saveDisabled=${tooHigh.saveDisabled}`)

await page.fill('[data-testid="product-promo-amount"]', '0')
await page.waitForTimeout(1200)
const zero = await summaryText()
check('活动价为 0 时提示「必须大于 0」', /必须大于 0/.test(zero.promoError ?? ''), `error=${JSON.stringify(zero.promoError)}`)

await page.fill('[data-testid="product-promo-amount"]', '149.999')
await page.waitForTimeout(1200)
const decimals = await summaryText()
check('活动价超过两位小数时提示且不改写输入', /两位小数/.test(decimals.promoError ?? '') && decimals.promoValue === '149.999', `error=${JSON.stringify(decimals.promoError)} value=${JSON.stringify(decimals.promoValue)}`)

/* ======================================================================
 * B/D. 设置活动价 → 后端权威结果 + 预览 + 用户页
 * ==================================================================== */

await page.fill('[data-testid="product-promo-amount"]', String(PROMO_YUAN))
await page.waitForTimeout(1200)
const valid = await summaryText()
check('合法活动价可提交（无错误、保存可用）', !valid.promoError && valid.saveDisabled === false, `error=${JSON.stringify(valid.promoError)} saveDisabled=${valid.saveDisabled}`)
await page.click('[data-testid="product-promo-save"]')
await page.waitForTimeout(3500)
const afterSet = await summaryText()
check('保存后显示活动价成功提示', /已创建活动并设置活动价|活动价已更新/.test(afterSet.promoNotice ?? ''), `notice=${JSON.stringify(afterSet.promoNotice)}`)

const savedProduct = (await listProducts()).find((product) => product.id === productId)
check('后端记录活动价 = 15000 分', savedProduct?.pricing?.promotion?.unitAmountCents === PROMO_YUAN * 100, `pricing.promotion=${JSON.stringify(savedProduct?.pricing?.promotion)}`)
check('后端返回 saleUnitAmountCents = 15000', savedProduct?.pricing?.saleUnitAmountCents === PROMO_YUAN * 100, `sale=${savedProduct?.pricing?.saleUnitAmountCents}`)
const promotionsAfterSet = await listPromotions()
const ownerCampaign = promotionsAfterSet.find((campaign) => campaign.products.some((entry) => entry.productId === productId))
check('活动由商品侧自动创建并包含该商品', Boolean(ownerCampaign) && ownerCampaign.products.length === 1, `campaign=${ownerCampaign?.name} products=${ownerCampaign?.products.length}`)
check('自动创建的活动默认启用且时间窗为 30 天', ownerCampaign?.enabled === true
  && Math.round((Date.parse(ownerCampaign.endsAt) - Date.parse(ownerCampaign.startsAt)) / 86400000) === 30,
  `enabled=${ownerCampaign?.enabled} days=${Math.round((Date.parse(ownerCampaign?.endsAt ?? '') - Date.parse(ownerCampaign?.startsAt ?? '')) / 86400000)}`)

check('面板显示活动价（元）', /150\.00/.test(afterSet.activePrice ?? ''), `activePrice=${JSON.stringify(afterSet.activePrice)}`)
check('面板显示由价格推导的折扣 7.5 折', /7\.5\s*折/.test(afterSet.discount ?? ''), `discount=${JSON.stringify(afterSet.discount)}`)

await page.waitForTimeout(1500)
const previewAfterSet = await page.evaluate(() => {
  const card = document.querySelector('[data-testid="preview-surface"] article')
  return {
    price: card?.querySelector('strong')?.textContent?.trim() ?? null,
    discount: card?.querySelector('[data-testid="plan-discount"]')?.textContent?.trim() ?? null,
    list: card?.querySelector('s, del, [data-testid="plan-list-price"]')?.textContent?.trim() ?? null,
  }
})
check('预览卡片价格 = ¥150', /150/.test(previewAfterSet.price ?? ''), `preview=${JSON.stringify(previewAfterSet)}`)

/* ======================================================================
 * F. 活动价写入后不应被误判为「商品有未保存修改」
 * ==================================================================== */

const drawerDescription = (await summaryText()).drawerDesc
check('保存活动价后不误报「有未保存的修改」', drawerDescription !== '有未保存的修改', `drawerDesc=${JSON.stringify(drawerDescription)}`)
await closeDrawer()
const discardPrompt = await page.locator('button:has-text("放弃修改")').count()
check('保存活动价后关闭编辑不再要求放弃修改', discardPrompt === 0, `放弃修改按钮=${discardPrompt}`)

/* ======================================================================
 * C. 用户套餐页反映活动价
 * ==================================================================== */

await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
const plansProbe = await page.evaluate((name) => {
  const cards = Array.from(document.querySelectorAll('article')).filter((card) => card.innerText.includes(name) || card.innerText.includes('PROMO-TEST'))
  const card = cards[0]
  if (!card) return null
  return {
    text: card.innerText.slice(0, 300),
    discount: card.querySelector('[data-testid="plan-discount"]')?.textContent?.trim() ?? null,
    promotionStrip: card.querySelector('[data-testid="plan-promotion-strip"]')?.textContent?.trim() ?? null,
  }
}, PRODUCT_NAME)
check('用户套餐页出现该商品卡片', plansProbe !== null, `probe=${JSON.stringify(plansProbe)?.slice(0, 200)}`)
check('用户套餐页显示活动价 ¥150', /150/.test(plansProbe?.text ?? ''), `text=${JSON.stringify(plansProbe?.text?.slice(0, 160))}`)
check('用户套餐页折扣由价格推导（7.5 折）', /7\.5\s*折/.test(plansProbe?.text ?? ''), `discount=${JSON.stringify(plansProbe?.discount)} strip=${JSON.stringify(plansProbe?.promotionStrip)}`)

/* ======================================================================
 * B. 更新活动价（走已有活动，不新建）
 * ==================================================================== */

await openProductEditor()
const reopened = await summaryText()
check('重新打开编辑器时活动价输入回填为 150', reopened.promoValue === String(PROMO_YUAN), `value=${JSON.stringify(reopened.promoValue)}`)
await page.fill('[data-testid="product-promo-amount"]', String(PROMO_YUAN_UPDATED))
await page.waitForTimeout(1000)
await page.click('[data-testid="product-promo-save"]')
await page.waitForTimeout(3500)
const afterUpdate = await summaryText()
check('更新后提示「活动价已更新」', /已更新/.test(afterUpdate.promoNotice ?? ''), `notice=${JSON.stringify(afterUpdate.promoNotice)}`)
const updatedProduct = (await listProducts()).find((product) => product.id === productId)
check('后端活动价更新为 12000 分', updatedProduct?.pricing?.promotion?.unitAmountCents === PROMO_YUAN_UPDATED * 100, `promotion=${JSON.stringify(updatedProduct?.pricing?.promotion)}`)
const promotionsAfterUpdate = await listPromotions()
const sameCampaign = promotionsAfterUpdate.find((campaign) => campaign.id === ownerCampaign?.id)
check('更新走同一活动（没有新建第二个活动）', Boolean(sameCampaign)
  && promotionsAfterUpdate.filter((campaign) => campaign.products.some((entry) => entry.productId === productId)).length === 1,
  `活动数=${promotionsAfterUpdate.filter((c) => c.products.some((e) => e.productId === productId)).length} 活动价=${JSON.stringify(sameCampaign?.products)}`)

/* ======================================================================
 * E. 促销活动表格：自动计算折扣 + 删除入口
 * ==================================================================== */

await closeDrawer()
await page.waitForTimeout(1500)
const tableProbe = await page.evaluate((id) => {
  const row = document.querySelector(`[data-testid="promotion-row-${id}"]`)
  if (!row) return null
  return {
    text: row.innerText,
    edit: Boolean(row.querySelector(`[data-testid="promotion-edit-${id}"]`)),
    remove: Boolean(row.querySelector(`[data-testid="promotion-delete-${id}"]`)),
  }
}, ownerCampaign?.id)
check('活动表格行有「编辑」与「删除」两个入口', tableProbe?.edit === true && tableProbe?.remove === true, `probe=${JSON.stringify(tableProbe)}`)
check('活动表格显示由价格推导的折扣（6 折）', /6\s*折/.test(tableProbe?.text ?? ''), `rowText=${JSON.stringify(tableProbe?.text)}`)

await page.click(`[data-testid="promotion-delete-${ownerCampaign?.id}"]`)
await page.waitForTimeout(1500)
const confirmDialog = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  return { title: dialog?.querySelector('h2')?.textContent?.trim() ?? null, text: dialog?.innerText?.slice(0, 200) ?? null }
})
check('删除前弹出确认框', /删除活动/.test(confirmDialog.title ?? ''), `title=${JSON.stringify(confirmDialog.title)}`)
await page.locator('[role="dialog"] button:has-text("确认删除")').first().click()
await page.waitForTimeout(3500)
const promotionsAfterDelete = await listPromotions()
check('活动已从后端删除', !promotionsAfterDelete.some((campaign) => campaign.id === ownerCampaign?.id), `剩余活动=${promotionsAfterDelete.length}`)
const productAfterDelete = (await listProducts()).find((product) => product.id === productId)
check('删除活动后商品恢复日常价', productAfterDelete?.pricing?.saleUnitAmountCents === LIST_YUAN * 100
  && productAfterDelete?.pricing?.discountCents === 0
  && !productAfterDelete?.pricing?.promotion,
  `pricing=${JSON.stringify(productAfterDelete?.pricing)}`)

/* ======================================================================
 * E. 清除活动价：商品编辑器入口
 * ==================================================================== */

await openProductEditor()
await page.fill('[data-testid="product-promo-amount"]', '100')
await page.waitForTimeout(1000)
await page.click('[data-testid="product-promo-save"]')
await page.waitForTimeout(3500)
const beforeClear = await summaryText()
check('清除前「清除活动价」按钮可见', beforeClear.clearVisible === true, `value=${JSON.stringify(beforeClear.promoValue)}`)
await page.click('[data-testid="product-promo-clear"]')
await page.waitForTimeout(3500)
const afterClear = await summaryText()
check('清除后输入框为空且按钮消失', afterClear.promoValue === '' && afterClear.clearVisible === false, `value=${JSON.stringify(afterClear.promoValue)} clearVisible=${afterClear.clearVisible}`)
check('清除后如实告知活动已被一并删除', /已清除/.test(afterClear.promoNotice ?? ''), `notice=${JSON.stringify(afterClear.promoNotice)}`)
const clearedProduct = (await listProducts()).find((product) => product.id === productId)
check('清除后后端无活动价', !clearedProduct?.pricing?.promotion && clearedProduct?.pricing?.discountCents === 0, `pricing=${JSON.stringify(clearedProduct?.pricing)}`)
check('清除后活动列表不再包含该商品', !(await listPromotions()).some((campaign) => campaign.products.some((entry) => entry.productId === productId)), '活动仍包含该商品')
check('清除后面板回到「无生效活动」', /无生效活动/.test(afterClear.activePrice ?? ''), `activePrice=${JSON.stringify(afterClear.activePrice)}`)

await closeDrawer()
await cleanup()
const leftover = (await listProducts()).filter((product) => product.name.startsWith('PROMO-TEST'))
check('隔离测试数据已清理', leftover.length === 0, `残留=${leftover.map((p) => p.name).join(',')}`)

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
