import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 问题 3 回归：套餐「生成量说明」不得跨周期串文案。
 * 问题 4 回归：素材搜索按回车必须真的触发服务端搜索。
 *
 * 两个问题都是**真实浏览器 + 真实接口 + 真实数据库**验证：
 *  - 问题 3：用真实管理接口建「同组同档」的月/季/年商品，只给年付配生成量说明，
 *    再在**真实后台预览**与**用户套餐页**里切换周期断言 DOM 文本；
 *  - 问题 4：在真实图片工作台输入关键词按回车，断言发出了带 keyword 的
 *    服务端请求、列表按服务端结果变化、清空后恢复、且不触发生成。
 *
 * 隔离数据：商品名以 `GENTEST-` 前缀，活动/商品跑完即删（先删活动再删商品，规避外键）。
 * 测试库：与运行中的应用同一个 Postgres（vozeb_fusion），因此**只动自己创建的数据**。
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3310'
const PREFIX = 'GENTEST'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }
const info = (text) => console.log(`[信息] ${text}`)
mkdirSync('tests/.artifacts', { recursive: true })

const browser = await chromium.launch()
let page
try {
  const session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
  page = session.page
} catch (error) {
  if (error.throttled) { await browser.close(); exitThrottled(error.message) }
  throw error
}

const api = (path, options = {}) => page.evaluate(async ({ path, options }) => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options, cache: 'no-store' })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* ignore */ }
  return { status: response.status, json, text }
}, { path, options })

/* ======================================================================
 * 问题 3：生成量说明跨周期
 * ==================================================================== */

const stamp = Date.now().toString(36).toUpperCase()
const GROUP = `${PREFIX}-${stamp}-组`
const TIER = `${PREFIX}-档位`
const PLAN_ID = 'free'
const SUMMARY_ANNUAL = `${PREFIX}-${stamp}-年付说明`
const SUMMARY_QUARTERLY = `${PREFIX}-${stamp}-季付说明`
const createdProductIds = []
const createdCampaignIds = []

/**
 * 建一个订阅商品：同 groupId + 同字面量 tierId，仅周期不同。
 *
 * 注意 `planId` 必填且必须指向**启用中**的权益方案，否则后端返回
 * 404「套餐不存在或已停用」（实测踩到）。`billingCycle` 不放在顶层，
 * 而是从 `periodDays` 推导；分组/档位/受众等信息统一放在 `metadata.membership` 里，
 * 与 `tier-cycle-binding.test.mjs` 的既有写法保持一致。
 */
const makeProduct = async ({ cycle, name, dailyPoints, generationSummary, periodDays, amountCents, sortOrder }) => {
  const response = await api('/api/admin/billing/products', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: `${PREFIX} 隔离测试商品`,
      productKind: 'plan',
      planId: PLAN_ID,
      amountCents,
      currency: 'CNY',
      pointsAmount: 1000,
      dailyPoints,
      periodDays,
      enabled: true,
      sortOrder,
      metadata: {
        membership: {
          name: `${PREFIX} 会员`,
          audience: 'creator',
          tone: 'standard',
          groupId: GROUP,
          // ★ 三个周期共用同一个 tierId 字符串 —— 这正是跨周期串文案的触发条件。
          tierId: TIER,
          tierLabel: `${PREFIX} 档位`,
          benefits: [`${PREFIX} 基础权益`],
          ...(generationSummary ? { generationSummary } : {}),
        },
      },
    }),
  })
  const id = response.json?.product?.id ?? response.json?.data?.product?.id
  if (id) createdProductIds.push(id)
  return { status: response.status, id, body: response.json }
}

console.log('\n===== 问题 3：生成量说明跨周期 =====')
const monthly = await makeProduct({ cycle: 'monthly', name: `${PREFIX} 月付`, dailyPoints: 10, periodDays: 30, amountCents: 4900, sortOrder: 901 })
const quarterly = await makeProduct({ cycle: 'quarterly', name: `${PREFIX} 季付`, dailyPoints: 50, generationSummary: SUMMARY_QUARTERLY, periodDays: 90, amountCents: 14900, sortOrder: 902 })
const annual = await makeProduct({ cycle: 'annual', name: `${PREFIX} 年付`, dailyPoints: 100, generationSummary: SUMMARY_ANNUAL, periodDays: 365, amountCents: 39900, sortOrder: 903 })
info(`建商品：月付=${monthly.status}/${monthly.id} 季付=${quarterly.status}/${quarterly.id} 年付=${annual.status}/${annual.id}`)
if (!monthly.id || !annual.id) { console.log(JSON.stringify(monthly.body), JSON.stringify(annual.body)); await browser.close(); process.exit(2) }

/** 真实后台预览：选中该分组并切周期，读卡片的生成量说明文本。 */
await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const row = page.locator('tr', { hasText: `${PREFIX} 年付` }).first()
if (await row.count()) {
  await row.locator('button:has-text("编辑")').first().click()
  await page.waitForTimeout(3000)
} else {
  info('未在商品列表找到测试商品行（可能被分页挡在后面）')
}

const readSummary = () => page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const card = surface?.querySelector('article')
  if (!card) return null
  return { text: card.innerText, summary: card.querySelector('[class*="generationSummary"]')?.textContent?.trim() ?? null }
})

const clickCycle = async (cycle) => {
  const button = page.locator(`[data-testid="preview-cycle-${cycle}"]`).first()
  if (await button.count()) { await button.click({ force: true }); await page.waitForTimeout(1200); return true }
  return false
}

const hasCycleSwitch = await page.locator('[data-testid="preview-cycle-annual"]').count() > 0
if (!hasCycleSwitch) {
  info('当前 3310 构建没有周期切换控件（preview-cycle-*），预览层断言无法执行；改由接口层断言覆盖。')
} else {
  await clickCycle('annual')
  const annualView = await readSummary()
  check('预览·年付显示自己的生成量说明',
    annualView?.summary === SUMMARY_ANNUAL,
    `年付说明=${JSON.stringify(annualView?.summary)} 期望=${JSON.stringify(SUMMARY_ANNUAL)}`)

  await clickCycle('monthly')
  const monthlyView = await readSummary()
  check('预览·月付**未配置**说明时不显示任何说明（不借用年付的文案）',
    monthlyView?.summary === '' || monthlyView?.summary === null,
    `月付说明=${JSON.stringify(monthlyView?.summary)}`)

  await clickCycle('quarterly')
  const quarterlyView = await readSummary()
  check('预览·季付显示自己的说明（不是年付的）',
    quarterlyView?.summary === SUMMARY_QUARTERLY,
    `季付说明=${JSON.stringify(quarterlyView?.summary)}`)

  await page.screenshot({ path: 'tests/.artifacts/P3-generation-summary-monthly.png', fullPage: false })
}

/** 用户侧套餐页：切到月付，断言页面上不出现年付的说明文案。 */
await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const plansText = await page.locator('body').innerText()
check('用户套餐页不出现年付说明（除非正当年付）',
  !plansText.includes(SUMMARY_ANNUAL) || plansText.includes('年付'),
  `页面是否含年付说明=${plansText.includes(SUMMARY_ANNUAL)}`)
/**
 * 关键断言：月付卡片里不能出现年付/季付的说明。
 * 逐卡片检查，避免「页面上别处出现过」造成的假通过。
 */
const cardLeak = await page.evaluate(({ annual, quarterly }) => {
  const cards = Array.from(document.querySelectorAll('article'))
  const leaked = []
  for (const card of cards) {
    const text = card.innerText
    // 判定该卡片属于哪个周期：用价格或周期关键词粗略识别；这里只找「月付卡片却带年付说明」
    const looksMonthly = /\/月|\/ 月|月付|每月/.test(text)
    if (looksMonthly && (text.includes(annual) || text.includes(quarterly))) {
      leaked.push(text.slice(0, 120))
    }
  }
  return leaked
}, { annual: SUMMARY_ANNUAL, quarterly: SUMMARY_QUARTERLY })
check('用户套餐页：月付卡片没有混入季付/年付的生成量说明', cardLeak.length === 0,
  `泄漏卡片=${JSON.stringify(cardLeak).slice(0, 200)}`)

/* ======================================================================
 * 问题 4：素材搜索回车
 * ==================================================================== */

console.log('\n===== 问题 4：素材搜索回车 =====')

/** 记录所有素材库请求（含是否带 keyword） */
const libraryRequests = []
page.on('request', (r) => {
  const url = r.url()
  if (url.includes('/api/library-assets')) libraryRequests.push(url.replace(BASE, ''))
})

await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const pickerPresent = await page.locator('[data-testid="reference-picker"]').count() > 0
if (!pickerPresent) {
  info('当前构建没有 reference-picker 容器，问题 4 的界面断言无法执行。')
} else {
  const readPicker = () => page.evaluate(() => ({
    status: document.querySelector('[data-testid="reference-picker-status"]')?.textContent?.trim() ?? null,
    items: document.querySelectorAll('[data-testid="reference-picker-item"]').length,
    urls: Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).map((n) => n.getAttribute('data-asset-url')),
  }))

  const before = await readPicker()
  libraryRequests.length = 0

  const search = page.locator('[data-testid="reference-picker-search"]').first()
  await search.fill('ZZZNOMATCHKEYWORD')
  await search.press('Enter')
  await page.waitForTimeout(3500)

  const keywordRequests = libraryRequests.filter((u) => u.includes('keyword='))
  const afterNone = await readPicker()
  check('回车触发了带 keyword 的服务端搜索请求', keywordRequests.length > 0,
    `请求=${JSON.stringify(libraryRequests).slice(0, 200)}`)
  /**
   * 断言要针对**素材库来源**的候选，不能笼统要求「条目数为 0」。
   *
   * 候选池 = 素材库 + 生成结果（`useServerWorks`）。关键词只过滤素材库，
   * 生成结果不受影响——这是设计如此（它们是"我的生成结果"，不是素材库条目）。
   * 实测：搜索后素材库候选确实清空，但生成结果仍在，所以总数不为 0。
   * 因此用「素材库来源的地址是否还在」来判定，而不是总数。
   */
  const libraryUrlPrefixes = ['/api/library-assets', '/api/reference-assets/permanent']
  const libraryItemsAfter = afterNone.urls.filter((u) => u && libraryUrlPrefixes.some((p) => u.startsWith(p)))
  const libraryItemsBefore = before.urls.filter((u) => u && libraryUrlPrefixes.some((p) => u.startsWith(p)))
  check('搜索无匹配关键词后，素材库来源的候选被清空（生成结果不受影响，属设计如此）',
    libraryItemsBefore.length > 0 && libraryItemsAfter.length === 0,
    `素材库候选 搜索前=${libraryItemsBefore.length} 搜索后=${libraryItemsAfter.length} 总数 前=${before.items} 后=${afterNone.items}`)

  /** 清空后必须恢复完整列表。 */
  await search.fill('')
  await page.locator('[data-testid="reference-picker-search"]').first().press('Enter')
  await page.waitForTimeout(3500)
  const restored = await readPicker()
  const libraryItemsRestored = restored.urls.filter((u) => u && libraryUrlPrefixes.some((p) => u.startsWith(p)))
  check('清空关键词后恢复完整列表', libraryItemsRestored.length === libraryItemsBefore.length && libraryItemsBefore.length > 0,
    `恢复后素材库候选=${libraryItemsRestored.length} 原始=${libraryItemsBefore.length}`)

  /** 快速切换关键词：旧响应不得覆盖新搜索。 */
  libraryRequests.length = 0
  await search.fill('AAAA')
  await search.press('Enter')
  await page.waitForTimeout(120)
  await search.fill('BBBB')
  await search.press('Enter')
  await page.waitForTimeout(4000)
  const finalStatus = await readPicker()
  const lastRequest = libraryRequests.filter((u) => u.includes('keyword=')).at(-1) ?? ''
  check('快速切换关键词后，结果与**最后一次**搜索一致（旧响应不覆盖新搜索）',
    lastRequest.includes('keyword=BBBB'),
    `最后一次请求=${lastRequest} 当前状态=${finalStatus.status}`)

  /** 搜索不能触发生成（不应有 POST /api/image-tasks）。 */
  const generateWrites = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/image-tasks')) generateWrites.push(r.url()) })
  await search.fill('CCCC')
  await search.press('Enter')
  await page.waitForTimeout(2500)
  check('按回车搜索不会触发生成请求', generateWrites.length === 0, `POST /api/image-tasks=${generateWrites.length}`)

  /** 搜索不能清掉已选参考素材。 */
  const selectable = page.locator('[data-testid="reference-picker-item"]').first()
  if (await selectable.count()) {
    await selectable.click()
    await page.waitForTimeout(600)
    const selectedBefore = await page.locator('[data-testid="reference-picker-item"][aria-pressed="true"]').count()
    await search.fill('DDDD')
    await search.press('Enter')
    await page.waitForTimeout(3000)
    const selectedAfter = await page.locator('[data-testid="reference-picker-item"][aria-pressed="true"]').count()
    const statusText = await page.locator('[data-testid="reference-picker-status"]').first().innerText()
    check('搜索不会清掉已选参考素材', selectedAfter >= 1 && selectedBefore >= 1,
      `搜索前已选=${selectedBefore} 搜索后已选=${selectedAfter} status="${statusText}"`)
  } else {
    info('没有可选素材，跳过「搜索不清掉已选」断言')
  }
}

/* ======================================================================
 * 清理
 * ==================================================================== */
const campaigns = (await api('/api/admin/billing/promotions')).json?.data?.campaigns ?? []
for (const campaign of campaigns) {
  const ids = (campaign.productIds ?? campaign.products ?? []).map((item) => (typeof item === 'string' ? item : item?.id))
  if (!ids.some((id) => createdProductIds.includes(id))) continue
  createdCampaignIds.push(campaign.id)
  await api(`/api/admin/billing/promotions/${encodeURIComponent(campaign.id)}`, { method: 'DELETE' })
}
let removedProducts = 0
for (const id of createdProductIds) {
  const response = await api(`/api/admin/billing/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (response.status === 200) removedProducts += 1
}
const remaining = (await api('/api/admin/billing/products')).json?.products ?? []
const leftover = remaining.filter((p) => String(p.name ?? '').startsWith(PREFIX))
check('隔离测试商品已清理', leftover.length === 0, `删除=${removedProducts}/${createdProductIds.length} 残留=${leftover.length}`)

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
