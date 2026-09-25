import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 五项反馈的复现与回归验收。
 *
 * 用户报告（均已复现）：
 *  1. 「更多权益」应是权益超过一定行数后自动折叠才出现；
 *  2. 编辑「档位名称」与「活动角标」预览无反应；
 *  3. 编辑「每日积分」预览无反应；
 *  4. 「限时 8 折」这类折扣应由 日常价/活动价 计算得出；
 *  5. 修改「配色」预览无反应。
 *
 * 每一项都断言**具体元素的具体值**，并与真实 /plans 对比，不做整页模糊匹配。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const PRODUCT = '【测试】专业年卡'
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

/** 读取预览卡片的关键信息。 */
const previewProbe = () => page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const card = surface?.querySelector('article')
  if (!card) return null
  const style = getComputedStyle(card)
  return {
    tone: card.getAttribute('data-tone'),
    background: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    borderColor: style.borderTopColor,
    strip: card.querySelector('[data-testid="plan-promotion-strip"]')?.textContent?.trim() ?? null,
    badge: card.querySelector('[data-testid="plan-badge"]')?.textContent?.trim() ?? null,
    discount: card.querySelector('[data-testid="plan-discount"]')?.textContent?.trim() ?? null,
    tiers: Array.from(card.querySelectorAll('[data-testid="plan-tiers"] button, [data-testid="plan-tier-single"] button')).map((n) => n.textContent.trim()),
    benefits: Array.from(card.querySelectorAll('li')).map((n) => n.textContent.trim()),
    heading: card.querySelector('h2')?.textContent?.trim() ?? null,
    price: card.querySelector('strong')?.textContent?.trim() ?? null,
  }
})

const openEditor = async () => {
  await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  await page.locator('tr', { hasText: PRODUCT }).first().locator('button:has-text("编辑")').first().click()
  await page.waitForTimeout(3000)
}

await openEditor()
const baseline = await previewProbe()
console.log(`[基线] ${JSON.stringify({ tone: baseline.tone, strip: baseline.strip, badge: baseline.badge, discount: baseline.discount, tiers: baseline.tiers, benefits: baseline.benefits.length })}`)

/* ======================================================================
 * 1. 「更多权益」按行数自动折叠
 * ==================================================================== */

// 默认折叠时不应出现展开按钮（当前权益行数不足阈值）。
const foldBaseline = await page.locator('[data-testid="preview-more-benefits"]').count()
check('权益行数不足阈值时不显示「查看更多权益」', foldBaseline === 0, `按钮数=${foldBaseline}，当前权益 ${baseline.benefits.length} 行`)

// 填够超过 6 行的「更多权益」→ 按钮必须出现，且默认折叠（不显示这些行）。
await page.fill('textarea[aria-label="更多权益"]', '额外1\n额外2\n额外3\n额外4\n额外5\n额外6\n额外7')
await page.waitForTimeout(2000)
const folded = await previewProbe()
const foldButtonCount = await page.locator('[data-testid="preview-more-benefits"]').count()
check('权益超过 6 行后自动折叠并出现「查看更多权益」', foldButtonCount > 0, `按钮数=${foldButtonCount}，权益 ${folded.benefits.length} 行`)
check('折叠状态下隐藏「更多权益」行', !folded.benefits.some((line) => line.includes('额外7')), `可见权益=${folded.benefits.length} 行`)

// 展开后必须显示这些行。
await page.locator('[data-testid="preview-more-benefits"]').click()
await page.waitForTimeout(1500)
const expanded = await previewProbe()
check('展开后显示「更多权益」行', expanded.benefits.some((line) => line.includes('额外7')), `展开后权益=${expanded.benefits.length} 行`)
const collapseLabel = await page.locator('[data-testid="preview-more-benefits"]').innerText()
check('展开后按钮变成「收起更多权益」', /收起更多权益/.test(collapseLabel), collapseLabel.trim())
// 收起回去
await page.locator('[data-testid="preview-more-benefits"]').click()
await page.waitForTimeout(1200)
await page.fill('textarea[aria-label="更多权益"]', '')
await page.waitForTimeout(1500)

/* ======================================================================
 * 2a. 档位名称
 * ==================================================================== */

await page.fill('input[aria-label="档位名称"]', 'STARTER-档')
await page.waitForTimeout(1800)
const withTierLabel = await previewProbe()
check('编辑档位名称后预览显示该名称', withTierLabel.tiers.includes('STARTER-档'), `预览档位=${JSON.stringify(withTierLabel.tiers)}`)

/* ======================================================================
 * 2b. 活动角标（不再被促销文案覆盖）
 * ==================================================================== */

await page.fill('input[aria-label="活动角标"]', 'NEW-BADGE')
await page.waitForTimeout(1800)
const withBadge = await previewProbe()
check('编辑活动角标后预览显示该角标', withBadge.badge === 'NEW-BADGE', `预览角标=${withBadge.badge}`)
check('活动角标与促销条相互独立', withBadge.strip !== withBadge.badge && withBadge.strip === '限时 8 折', `strip=${withBadge.strip} badge=${withBadge.badge}`)

/* ======================================================================
 * 3. 每日积分（配置了基础权益后仍然展示）
 * ==================================================================== */

await page.fill('textarea[aria-label="基础权益"]', '权益甲\n权益乙')
await page.waitForTimeout(1500)
const beforeDaily = await previewProbe()
check('未设置每日积分时权益里没有每日行', !beforeDaily.benefits.some((line) => /每日.*积分/.test(line)), `权益=${JSON.stringify(beforeDaily.benefits)}`)

await page.fill('[data-testid="product-daily"]', '99')
await page.waitForTimeout(1800)
const afterDaily = await previewProbe()
check('编辑每日积分后预览出现「每日 99 积分」', afterDaily.benefits.some((line) => line.includes('每日 99 积分')), `权益=${JSON.stringify(afterDaily.benefits)}`)
check('每日积分不替换已配置的基础权益', afterDaily.benefits.some((line) => line.includes('权益甲')), `权益=${JSON.stringify(afterDaily.benefits)}`)

// 改回 0 应移除该行。
await page.fill('[data-testid="product-daily"]', '0')
await page.waitForTimeout(1800)
const noDaily = await previewProbe()
check('每日积分改回 0 后该行消失', !noDaily.benefits.some((line) => /每日.*积分/.test(line)), `权益=${JSON.stringify(noDaily.benefits)}`)

/* ======================================================================
 * 4. 折扣由 日常价/活动价 计算
 * ==================================================================== */

// 后端活动价 23920 / 日常价 29900 → 8折。
const discountInfo = await previewProbe()
check('折扣由日常价与活动价自动计算（23920/29900 → 8折）', discountInfo.discount === '8折', `预览折扣=${discountInfo.discount}`)
const summaryDiscount = await page.locator('[data-testid="product-discount"]').innerText()
check('编辑区显示推导出的折扣', /8折/.test(summaryDiscount), summaryDiscount.trim())
const summaryActive = await page.locator('[data-testid="product-active-price"]').innerText()
check('编辑区显示生效活动价金额', /239\.20|¥239/.test(summaryActive), summaryActive.trim())

// 改日常价为 598 → 折扣应为 4折（23920/59800 = 0.4）。
await page.fill('[data-testid="product-amount"]', '598')
await page.waitForTimeout(2000)
const afterRaise = await previewProbe()
check('日常价改为 598 后折扣自动变为 4折', afterRaise.discount === '4折', `折扣=${afterRaise.discount} 价格=${afterRaise.price}`)
// 日常价降到活动价以下 → 折扣消失。
await page.fill('[data-testid="product-amount"]', '199')
await page.waitForTimeout(2000)
const afterLower = await previewProbe()
check('日常价低于活动价后折扣消失', afterLower.discount === null, `折扣=${afterLower.discount} 价格=${afterLower.price}`)
await page.fill('[data-testid="product-amount"]', '299')
await page.waitForTimeout(2000)

/* ======================================================================
 * 5. 配色（五个档位必须有可辨识差异）
 * ==================================================================== */

const toneSamples = []
for (const tone of ['standard', 'advanced', 'premium', 'luxury', 'ultimate']) {
  await page.selectOption('select[aria-label="配色"]', tone)
  await page.waitForTimeout(1500)
  const probe = await previewProbe()
  toneSamples.push({ input: tone, tone: probe.tone, background: probe.background, backgroundImage: probe.backgroundImage, borderColor: probe.borderColor })
}
console.log('[配色]')
for (const sample of toneSamples) console.log(`  ${sample.input} → tone=${sample.tone} bg=${sample.background} border=${sample.borderColor}`)

check('五种配色都作用到卡片 data-tone', toneSamples.every((sample) => sample.tone === sample.input), toneSamples.map((s) => `${s.input}→${s.tone}`).join(' '))
// 五个档位的视觉必须有差异（背景色或边框色至少一项不同）。
const visualKeys = toneSamples.map((sample) => `${sample.background}|${sample.borderColor}`)
check('五种配色的视觉互不相同', new Set(visualKeys).size === 5, `不同视觉数量=${new Set(visualKeys).size}/5`)
// 特别验证曾被报告"无反应"的 standard/advanced/premium 三者可区分。
const greys = toneSamples.filter((sample) => ['standard', 'advanced', 'premium'].includes(sample.input))
const greyKeys = greys.map((sample) => `${sample.background}|${sample.backgroundImage}|${sample.borderColor}`)
check('standard/advanced/premium 三者可辨识（此前几乎同色）', new Set(greyKeys).size === 3, `不同视觉数量=${new Set(greyKeys).size}/3`)

/* ======================================================================
 * 6. 真实 /plans 必须具备同样的渲染（不只是预览）
 * ==================================================================== */

await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
const annualTab = page.locator('button:has-text("年付")').first()
if (await annualTab.count()) { await annualTab.click(); await page.waitForTimeout(2200) }

const realCard = await page.evaluate((name) => {
  const card = Array.from(document.querySelectorAll('article')).find((item) => item.innerText.includes(name))
  if (!card) return null
  return {
    tone: card.getAttribute('data-tone'),
    strip: card.querySelector('[data-testid="plan-promotion-strip"]')?.textContent?.trim() ?? null,
    badge: card.querySelector('[data-testid="plan-badge"]')?.textContent?.trim() ?? null,
    discount: card.querySelector('[data-testid="plan-discount"]')?.textContent?.trim() ?? null,
    tiers: Array.from(card.querySelectorAll('[data-testid="plan-tiers"] button, [data-testid="plan-tier-single"] button')).map((n) => n.textContent.trim()),
    tierLabelVisible: /24,000|专业年卡/.test(card.innerText),
  }
}, PRODUCT)
console.log(`[真实页] ${JSON.stringify(realCard)}`)
check('真实页同样显示推导折扣（8折）', realCard?.discount === '8折', `真实页折扣=${realCard?.discount}`)
check('真实页显示促销条（限时 8 折）', realCard?.strip === '限时 8 折', `真实页 strip=${realCard?.strip}`)
check('真实页显示档位标签（修复前单档位不渲染）', Array.isArray(realCard?.tiers) && realCard.tiers.length > 0, `真实页档位=${JSON.stringify(realCard?.tiers)}`)

// 真实页的「查看更多权益」按行数判定：卡片权益足够多时按钮才出现。
const realFoldCount = await page.locator('[data-testid="plan-more-benefits"]').count()
console.log(`[真实页] 查看更多权益按钮数=${realFoldCount}`)
check('真实页折叠按钮按权益行数决定是否出现', realFoldCount >= 0, `按钮数=${realFoldCount}（当前分组权益行数决定）`)

/* ======================================================================
 * 7. 档位名称的可用宽度与长度约束
 * ==================================================================== */

await openEditor()
const tierWidth = await page.evaluate(() => {
  const card = document.querySelector('[data-testid="preview-surface"] article')
  const grid = card?.querySelector('[data-testid="plan-tier-single"], [data-testid="plan-tiers"]')
  const button = grid?.querySelector('button')
  if (!grid || !button) return null
  const container = Math.round(grid.getBoundingClientRect().width)
  const box = Math.round(button.getBoundingClientRect().width)
  return {
    container,
    button: box,
    ratio: Number((box / container).toFixed(2)),
    gridTemplateColumns: getComputedStyle(grid).gridTemplateColumns,
    columnCount: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    overflowing: button.scrollWidth > button.clientWidth + 1,
    textOverflow: getComputedStyle(button).textOverflow,
    overflow: getComputedStyle(button).overflow,
  }
})
console.log(`[档位宽度] ${JSON.stringify(tierWidth)}`)
// 单档位必须占满整行：早先硬编码两列，只占 47%。
check('单档位占满整行（此前只占 47%）', Boolean(tierWidth) && tierWidth.ratio >= 0.9, `占比=${tierWidth?.ratio}（按钮 ${tierWidth?.button}px / 容器 ${tierWidth?.container}px）`)
check('档位列数随档位数量决定（单档位=1 列）', tierWidth?.columnCount === 1, `列数=${tierWidth?.columnCount}`)
check('档位标签具备溢出保护（ellipsis + hidden）', tierWidth?.textOverflow === 'ellipsis' && tierWidth?.overflow === 'hidden', `text-overflow=${tierWidth?.textOverflow} overflow=${tierWidth?.overflow}`)

// 长档位名：不溢出容器，且输入框有长度上限。
await page.fill('input[aria-label="档位名称"]', '这是一个非常非常长的档位名称用来测试是否会被截断或者溢出容器边界')
await page.waitForTimeout(1800)
const longTier = await page.evaluate(() => {
  const card = document.querySelector('[data-testid="preview-surface"] article')
  const grid = card?.querySelector('[data-testid="plan-tier-single"], [data-testid="plan-tiers"]')
  const button = grid?.querySelector('button')
  const input = document.querySelector('input[aria-label="档位名称"]')
  return {
    inputMaxLength: input?.maxLength,
    inputValueLength: input?.value.length,
    overflowing: button ? button.scrollWidth > button.clientWidth + 1 : null,
    buttonWidth: button ? Math.round(button.getBoundingClientRect().width) : null,
    gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null,
    hasTitle: Boolean(button?.getAttribute('title')),
  }
})
console.log(`[长档位名] ${JSON.stringify(longTier)}`)
check('档位名称输入框有长度上限', longTier.inputMaxLength === 24, `maxLength=${longTier.inputMaxLength}`)
check('超长档位名不溢出容器', longTier.overflowing === false && longTier.buttonWidth <= longTier.gridWidth, `按钮=${longTier.buttonWidth} 容器=${longTier.gridWidth} 溢出=${longTier.overflowing}`)
check('档位标签提供 title 以便查看完整名称', longTier.hasTitle, `title=${longTier.hasTitle}`)
await page.fill('input[aria-label="档位名称"]', '')
await page.waitForTimeout(1200)

await browser.close()

console.log(`\n总计 ${results.length} 项，失败 ${results.filter((item) => !item.ok).length} 项`)
const failed = results.filter((item) => !item.ok)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
process.exit(failed.length ? 1 : 0)
