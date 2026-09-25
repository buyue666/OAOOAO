import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 商品与促销治理的验收：复制 / 差异确认 / 并发冲突 / 促销边界。
 *
 * 覆盖目标第 (4) 项剩余要求：
 *  - 商品复制；
 *  - 保存前差异确认；
 *  - 多人编辑冲突保护；
 *  - 促销边界：重叠、未开始、已过期、停用、价格变更后的活动选择与最终报价
 *    必须与后端 `selectCurrentPromotion` 规则一致。
 *
 * 隔离：本脚本创建 `GOV-TEST*` 商品与其活动，结束时全部删除并还原配置。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const PRODUCT_NAME = 'GOV-TEST-治理验收'
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

const api = (path, init) => page.evaluate(async ({ path, init }) => {
  const response = await fetch(path, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}, { path, init })

const listProducts = async () => (await api('/api/admin/billing/products')).body.products ?? []
const listPromotions = async () => (await api('/api/admin/billing/promotions')).body.data?.campaigns ?? []
const productById = async (id) => (await listProducts()).find((item) => item.id === id)

/** 清理与本脚本相关的全部隔离数据。 */
async function cleanup() {
  for (const campaign of await listPromotions()) {
    if (!/^GOV-TEST/.test(campaign.name)) continue
    await api(`/api/admin/billing/promotions/${campaign.id}`, { method: 'DELETE' })
  }
  for (const product of await listProducts()) {
    if (/^GOV-TEST/.test(product.name) || product.name.includes(`${PRODUCT_NAME} 副本`)) {
      await api(`/api/admin/billing/products/${product.id}`, { method: 'DELETE' })
    }
  }
}

await cleanup()

/* ======================================================================
 * 1. 商品复制
 * ==================================================================== */

await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

const source = await api('/api/admin/billing/products', {
  method: 'POST',
  body: JSON.stringify({
    name: PRODUCT_NAME, productKind: 'plan', planId: 'pro',
    amountCents: 10000, currency: 'CNY', pointsAmount: 100, dailyPoints: 5, periodDays: 30,
    sortOrder: 970, enabled: true,
    metadata: { membership: { name: 'GOV 套餐', groupId: 'gov-test-group', tierId: 'default', tierLabel: '治理档', benefits: ['权益甲', '权益乙'], tone: 'advanced' } },
  }),
})
const sourceId = source.body?.product?.id
check('可创建隔离测试商品', Boolean(sourceId), `id=${sourceId}`)

/**
 * 必须**重新加载**商品列表：上面的商品是通过接口创建的，
 * 页面若停留在创建之前的状态就找不到这一行（实测踩到）。
 */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

const duplicateButton = page.locator(`[data-testid="product-duplicate-${sourceId}"]`)
check('商品列表提供「复制」入口', await duplicateButton.count() > 0, `按钮数=${await duplicateButton.count()}`)

await duplicateButton.first().click()
await page.waitForTimeout(1500)
const confirmText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
check('复制前有确认，并说明副本的默认状态', /复制商品/.test(confirmText) && /默认下架/.test(confirmText),
  `确认框=${JSON.stringify(confirmText.slice(0, 90))}`)
await page.locator('[role="dialog"] button:has-text("确认复制")').first().click()
await page.waitForTimeout(4000)

const products = await listProducts()
const copy = products.find((item) => item.name === `${PRODUCT_NAME} 副本`)
check('复制生成新商品', Boolean(copy), `副本=${copy?.name ?? '未找到'}`)
check('副本默认未上架（避免直接出现在用户订阅页）', copy?.enabled === false, `enabled=${copy?.enabled}`)
check('副本沿用原价与积分', copy?.amountCents === 10000 && copy?.pointsAmount === 100 && copy?.dailyPoints === 5,
  `amount=${copy?.amountCents} points=${copy?.pointsAmount} daily=${copy?.dailyPoints}`)
check('副本落在独立分组（否则会与原商品争抢同档位同周期）',
  copy?.metadata?.membership?.groupId === 'gov-test-group-copy',
  `groupId=${copy?.metadata?.membership?.groupId}`)
check('副本不带活动价（活动不随商品复制）', !copy?.pricing?.promotion,
  `pricing.promotion=${JSON.stringify(copy?.pricing?.promotion ?? null)}`)

/* ======================================================================
 * 2. 保存前差异确认
 * ==================================================================== */

await page.locator('tr', { hasText: PRODUCT_NAME }).first().locator('button:has-text("编辑")').first().click()
await page.waitForTimeout(3000)

/** 不改任何字段直接保存 → 应提示没有修改且不发请求。 */
await page.click('[data-testid="product-save"]')
await page.waitForTimeout(2000)
const noChangeDialog = await page.locator('[data-testid="product-diff"]').count()
const noChangeError = await page.evaluate(() => document.body.innerText)
check('未修改时不弹差异确认，且明确提示没有修改',
  noChangeDialog === 0 && /没有检测到任何修改/.test(noChangeError),
  `差异框=${noChangeDialog} 提示=${/没有检测到任何修改/.test(noChangeError)}`)

await page.fill('[data-testid="product-amount"]', '123.45')
await page.waitForTimeout(1000)
await page.click('[data-testid="product-save"]')
await page.waitForTimeout(2500)
const diffProbe = await page.evaluate(() => {
  const modal = document.querySelector('[data-testid="product-diff"]')
  if (!modal) return null
  return {
    rows: Array.from(document.querySelectorAll('[data-testid^="diff-"]')).map((row) => ({
      field: row.getAttribute('data-testid'),
      sensitive: row.getAttribute('data-sensitive'),
      text: row.innerText.replace(/\n+/g, ' | '),
    })),
    sensitiveWarning: /包含价格、上下架、积分或权益的变更/.test(modal.innerText),
  }
})
check('保存前弹出差异确认', diffProbe !== null, `差异框=${diffProbe === null ? '未出现' : '已出现'}`)
check('差异只列出真正变化的字段（未改的不列）',
  diffProbe?.rows.length === 1 && diffProbe.rows[0].field === 'diff-amountCents',
  `差异项=${JSON.stringify(diffProbe?.rows.map((row) => row.field))}`)
check('差异显示修改前后的具体值', /100\.00/.test(diffProbe?.rows[0]?.text ?? '') && /123\.45/.test(diffProbe?.rows[0]?.text ?? ''),
  `值=${JSON.stringify(diffProbe?.rows[0]?.text)}`)
check('价格变更被标记为敏感并给出提示',
  diffProbe?.rows[0]?.sensitive === 'true' && diffProbe?.sensitiveWarning === true,
  `sensitive=${diffProbe?.rows[0]?.sensitive} 提示=${diffProbe?.sensitiveWarning}`)

/* ======================================================================
 * 3. 保存前差异确认 + 乐观锁（并发冲突保护）
 * ==================================================================== */

/** 在差异确认框里点确认 → 正常写入。 */
await page.click('[data-testid="product-diff-confirm"]')
await page.waitForTimeout(4000)
const saved = await productById(sourceId)
check('确认差异后正常写入', saved?.amountCents === 12345, `amountCents=${saved?.amountCents}`)
check('写入后 updatedAt 前进（供下一次冲突检测使用）', saved?.updatedAt && saved.updatedAt !== source.body?.product?.updatedAt,
  `before=${source.body?.product?.updatedAt} after=${saved?.updatedAt}`)

/** 并发冲突：用一个过期的前置条件保存，必须被拒绝且不覆盖。 */
const conflict = await api(`/api/admin/billing/products/${sourceId}`, {
  method: 'PATCH',
  body: JSON.stringify({ amountCents: 1, expectedUpdatedAt: source.body?.product?.updatedAt }),
})
check('并发编辑同一商品时保存被拒绝（409）', conflict.status === 409,
  `status=${conflict.status} msg=${JSON.stringify(conflict.body?.msg ?? conflict.body?.error)}`)
const afterConflict = await productById(sourceId)
check('冲突时**不写入**，不会静默覆盖对方的修改', afterConflict?.amountCents === 12345,
  `库中=${afterConflict?.amountCents}（应仍为 12345，未被 1 覆盖）`)

/** 不带前置条件保持原覆盖语义（兼容脚本与旧客户端）。 */
const noPrecondition = await api(`/api/admin/billing/products/${sourceId}`, {
  method: 'PATCH',
  body: JSON.stringify({ amountCents: 10000 }),
})
check('未带前置条件时保持原有覆盖语义', noPrecondition.status === 200 && noPrecondition.body?.product?.amountCents === 10000,
  `status=${noPrecondition.status} amount=${noPrecondition.body?.product?.amountCents}`)

await page.locator('[role="dialog"] button[aria-label="关闭"]').first().click().catch(() => null)
await page.waitForTimeout(1200)
const discard = page.locator('button:has-text("放弃修改")')
if (await discard.count()) { await discard.first().click(); await page.waitForTimeout(1200) }

/* ======================================================================
 * 4. 促销边界：活动选择与最终报价必须与后端规则一致
 * ==================================================================== */

const now = Date.now()
const campaignBody = (name, startsAt, endsAt, enabled, cents) => ({
  name, label: name, enabled,
  startsAt: new Date(startsAt).toISOString(),
  endsAt: new Date(endsAt).toISOString(),
  products: [{ productId: sourceId, promotionalAmountCents: cents }],
})
const saleOf = async () => (await productById(sourceId))?.pricing?.saleUnitAmountCents
const promoOf = async () => (await productById(sourceId))?.pricing?.promotion?.unitAmountCents ?? null

check('无活动时按日常价售卖', await saleOf() === 10000 && await promoOf() === null,
  `sale=${await saleOf()} promo=${await promoOf()}`)

/** 4a. 生效活动 */
const live = await api('/api/admin/billing/promotions', { method: 'POST', body: JSON.stringify(campaignBody('GOV-TEST生效', now - 60_000, now + 86_400_000, true, 8000)) })
const liveId = live.body?.data?.campaign?.id
check('生效活动参与报价', await saleOf() === 8000 && await promoOf() === 8000,
  `sale=${await saleOf()} promo=${await promoOf()}`)

/** 4b. 未开始的活动不得抢走报价 */
const future = await api('/api/admin/billing/promotions', { method: 'POST', body: JSON.stringify(campaignBody('GOV-TEST未开始', now + 86_400_000 * 30, now + 86_400_000 * 60, true, 5000)) })
check('未开始的活动不参与报价（仍是生效活动的价格）', await saleOf() === 8000,
  `sale=${await saleOf()}（期望 8000）`)

/**
 * 4b-2. 时间重叠的两个启用活动必须被拒绝（后端 409）。
 *
 * 必须放在「已有一个启用活动」的状态下测——4d 之后生效活动会被停用，
 * 那时再建就不构成重叠（实测踩到过这个顺序错误）。
 */
const overlap = await api('/api/admin/billing/promotions', {
  method: 'POST',
  body: JSON.stringify(campaignBody('GOV-TEST重叠', now - 30_000, now + 86_400_000, true, 6000)),
})
check('同一商品时间重叠的启用活动被拒绝', overlap.status === 409,
  `status=${overlap.status} msg=${JSON.stringify(overlap.body?.msg ?? overlap.body?.error)}`)

/** 4c. 把生效活动移到未来 → 报价必须回到日常价 */
const moved = await api(`/api/admin/billing/promotions/${liveId}`, {
  method: 'PATCH',
  body: JSON.stringify(campaignBody('GOV-TEST生效', now + 86_400_000 * 90, now + 86_400_000 * 120, true, 8000)),
})
check('活动窗口改到未来后不再参与报价', moved.status === 200 && await saleOf() === 10000,
  `status=${moved.status} sale=${await saleOf()}（期望 10000）`)

/** 4d. 停用的活动不参与报价 */
await api(`/api/admin/billing/promotions/${liveId}`, {
  method: 'PATCH',
  body: JSON.stringify(campaignBody('GOV-TEST生效', now - 60_000, now + 86_400_000, false, 8000)),
})
check('停用的活动不参与报价', await saleOf() === 10000 && await promoOf() === null,
  `sale=${await saleOf()} promo=${await promoOf()}`)

/** 4e. 已过期的活动不参与报价 */
const expired = await api('/api/admin/billing/promotions', {
  method: 'POST',
  body: JSON.stringify(campaignBody('GOV-TEST已过期', now - 86_400_000 * 10, now - 86_400_000 * 5, true, 3000)),
})
check('已过期的活动不参与报价', await saleOf() === 10000,
  `创建=${expired.status} sale=${await saleOf()}（期望 10000）`)

/**
 * 4f. PATCH 一个不存在的活动必须 404，不能**静默新建**。
 *
 * 本轮复现：前端把 `undefined` 拼进 URL 时，服务层把这个字面量当成合法 id
 * 并**创建了一条新活动**，运营以为在改旧活动、实际多出一个活动，价格也随之变化。
 * （实测在数据库里留下了一条 `id = 'undefined'` 的记录。）
 */
const phantom = await api('/api/admin/billing/promotions/does-not-exist-000', {
  method: 'PATCH',
  body: JSON.stringify(campaignBody('GOV-TEST幽灵', now - 60_000, now + 86_400_000, true, 4000)),
})
check('PATCH 不存在的活动返回 404 而不是静默新建', phantom.status === 404,
  `status=${phantom.status} msg=${JSON.stringify(phantom.body?.msg ?? phantom.body?.error)}`)
check('不存在的活动没有被创建出来',
  !(await listPromotions()).some((item) => item.name === 'GOV-TEST幽灵'),
  `活动列表=${(await listPromotions()).map((item) => item.name).join(',')}`)

/** 4f-3. 字面量 `undefined` 作为 id 必须被拒绝（前端拼串事故的兜底）。 */
const literalUndefined = await api('/api/admin/billing/promotions/undefined', {
  method: 'PATCH',
  body: JSON.stringify(campaignBody('GOV-TEST字面量', now - 60_000, now + 86_400_000, true, 4000)),
})
check('字面量 undefined 作为活动 id 被拒绝（400/404）',
  literalUndefined.status === 400 || literalUndefined.status === 404,
  `status=${literalUndefined.status} msg=${JSON.stringify(literalUndefined.body?.msg ?? literalUndefined.body?.error)}`)

/**
 * 4g. 价格变更后活动自动失效 / 恢复（与后端规则一致）。
 *
 * 重启用 `live` 活动：上面 4d 把它停用了，这里先恢复生效窗口。
 */
await api(`/api/admin/billing/promotions/${liveId}`, {
  method: 'PATCH',
  body: JSON.stringify(campaignBody('GOV-TEST生效', now - 60_000, now + 86_400_000, true, 8000)),
})
check('恢复生效窗口后活动重新参与报价', await saleOf() === 8000, `sale=${await saleOf()}`)
await api(`/api/admin/billing/products/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ amountCents: 4000 }) })
check('日常价降到活动价以下时活动自动失效', await saleOf() === 4000 && await promoOf() === null,
  `日常价=4000 sale=${await saleOf()} promo=${await promoOf()}`)
await api(`/api/admin/billing/products/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ amountCents: 10000 }) })
check('日常价回升后活动重新生效', await saleOf() === 8000 && await promoOf() === 8000,
  `sale=${await saleOf()} promo=${await promoOf()}`)

/* ======================================================================
 * 5. 生效边界：活动价与商品编辑互不干扰
 * ==================================================================== */

await api(`/api/admin/billing/products/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ name: `${PRODUCT_NAME}-改名` }) })
check('仅改商品名不影响活动价', await saleOf() === 8000, `sale=${await saleOf()}`)

await api(`/api/admin/billing/products/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })
const userVisible = (await api('/api/billing/products')).body.products ?? []
check('下架商品不出现在用户可见列表', !userVisible.some((item) => item.id === sourceId),
  `用户可见含该商品=${userVisible.some((item) => item.id === sourceId)}`)

/* ======================================================================
 * 清理与还原
 * ==================================================================== */

for (const id of [liveId, future.body?.data?.campaign?.id, expired.body?.data?.campaign?.id]) {
  if (id) await api(`/api/admin/billing/promotions/${id}`, { method: 'DELETE' })
}
await cleanup()
const leftoverProducts = (await listProducts()).filter((item) => /^GOV-TEST/.test(item.name) || item.name.includes(`${PRODUCT_NAME} 副本`))
const leftoverCampaigns = (await listPromotions()).filter((item) => /^GOV-TEST/.test(item.name))
check('隔离测试数据已清理', leftoverProducts.length === 0 && leftoverCampaigns.length === 0,
  `残留商品=${leftoverProducts.map((item) => item.name).join(',') || '无'} 残留活动=${leftoverCampaigns.map((item) => item.name).join(',') || '无'}`)

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
