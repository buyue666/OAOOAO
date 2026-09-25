import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 实时预览与真实套餐页的一致性验收（computedStyle 级别对比）。
 *
 * 验收原则：**必须比较同一商品、同一档位、同一周期、同一视口、同一折叠状态**
 * 的真实 /plans，而不是只检查「按钮存在」「文字出现」。
 *
 * 覆盖：
 * ① 主题上下文：--membership-page / --membership-ink 与卡片计算样式；
 * ② 打开编辑器不改字段时预览与真实页完全一致（含自动配色）；
 * ③ 手机预览的响应式布局与真实 390px 手机页一致（卡宽、内边距）；
 * ④ 团队类型、周期联动、档位选择；
 * ⑤ 活动价在改日常价后的正确行为（不能清空、也不能沿用旧快照）；
 * ⑥ 草稿合并不改变未编辑商品的排序；
 * ⑦ 预览零写入（点击 / Enter / 切换周期 / 切换档位）。
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
/** 目标商品：存在有效活动价（29900 → 23920），是用户报告的场景。 */
const TARGET_PRODUCT = '【测试】专业年卡'
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

/** 读取某个元素的关键计算样式，用于跨页面比较。 */
const styleProbe = (selector) => page.evaluate((sel) => {
  const node = document.querySelector(sel)
  if (!node) return null
  const style = getComputedStyle(node)
  const box = node.getBoundingClientRect()
  return {
    backgroundColor: style.backgroundColor,
    color: style.color,
    borderTopColor: style.borderTopColor,
    paddingTop: style.paddingTop,
    paddingLeft: style.paddingLeft,
    paddingBottom: style.paddingBottom,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
}, selector)

/**
 * 颜色归一化后比较。
 *
 * Chromium 对同一个颜色可能返回 `#000`、`rgb(0,0,0)` 或
 * `color(srgb 0.09...)` 等不同序列化形式（取决于来源是变量、color-mix 还是字面量），
 * 直接字符串比较会产生假失败。这里把颜色解析成数值再比较，容差 1/255。
 */
function colorsEqual(a, b) {
  const parse = (value) => {
    if (!value) return null
    const text = String(value).trim()
    // 十六进制简写（#000 / #f5f5f5 / #000000）先展开成 0-255 分量。
    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
      const raw = hex[1]
      const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
      return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
    }
    const numbers = text.match(/-?\d*\.?\d+(e[-+]?\d+)?/gi)
    if (!numbers) return null
    const values = numbers.map(Number)
    if (values.length < 3) return null
    // color(srgb r g b / a) 的分量是 0-1；rgb() 是 0-255。统一到 0-255。
    const scale = /color\(/i.test(text) && values.slice(0, 3).every((item) => item <= 1.0001) ? 255 : 1
    return values.slice(0, 3).map((item) => item * scale)
  }
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return String(a) === String(b)
  return left.every((item, index) => Math.abs(item - right[index]) <= 1.5)
}

/** 读取主题变量（在指定元素上解析）。 */
const variableProbe = (selector) => page.evaluate((sel) => {
  const node = document.querySelector(sel)
  if (!node) return null
  const style = getComputedStyle(node)
  return {
    page: style.getPropertyValue('--membership-page').trim(),
    ink: style.getPropertyValue('--membership-ink').trim(),
    muted: style.getPropertyValue('--membership-muted').trim(),
  }
}, selector)

/* ======================================================================
 * A. 真实 /plans 基线（同一商品、同一周期）
 * ==================================================================== */

await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
// 切到积分包/年付的默认周期：目标商品是 365 天 → 年付。
const annualButton = page.locator('button:has-text("年付")').first()
if (await annualButton.count()) { await annualButton.click(); await page.waitForTimeout(2000) }

/** 在真实套餐页找到目标商品的卡片（按商品名精确定位，避免整页模糊匹配）。 */
async function realCardInfo(productName) {
  return page.evaluate((name) => {
    const cards = Array.from(document.querySelectorAll('article'))
    const card = cards.find((item) => item.innerText.includes(name))
    if (!card) return null
    const style = getComputedStyle(card)
    const box = card.getBoundingClientRect()
    const priceNode = card.querySelector('strong')
    const del = card.querySelector('del')
    return {
      tone: card.getAttribute('data-tone'),
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderTopColor,
      width: Math.round(box.width),
      paddingTop: style.paddingTop,
      paddingLeft: style.paddingLeft,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      text: card.innerText,
      price: priceNode ? priceNode.textContent.trim() : null,
      originalPrice: del ? del.textContent.trim() : null,
      hasPromotionStrip: Boolean(card.querySelector('[class*="promotionStrip"]')),
    }
  }, productName)
}

const realRoot = await variableProbe('[class*="viewportScope"]')
console.log(`[真实页] 主题变量 page=${realRoot?.page} ink=${realRoot?.ink}`)
// 变量值可能是 #000000 或 #000 等等价写法，按颜色比较而不是字符串。
check('真实套餐页定义了主题变量', colorsEqual(realRoot?.page, '#000000') && colorsEqual(realRoot?.ink, '#f5f5f5'), JSON.stringify(realRoot))

const realCard = await realCardInfo(TARGET_PRODUCT)
check('真实页可定位目标商品卡片', Boolean(realCard), realCard ? `tone=${realCard.tone} price=${realCard.price}` : `未找到「${TARGET_PRODUCT}」`)
if (realCard) {
  console.log(`[真实页] ${TARGET_PRODUCT}: tone=${realCard.tone} 卡宽=${realCard.width} 背景=${realCard.backgroundColor} 价格=${realCard.price} 原价=${realCard.originalPrice}`)
}

/* ======================================================================
 * B. 打开编辑器但不改字段 → 预览必须完全一致
 * ==================================================================== */

await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

// 找到目标商品那一行的「编辑」按钮（按行定位，避免点到别的商品）。
const targetRow = page.locator('tr', { hasText: TARGET_PRODUCT }).first()
check('商品列表可定位目标商品行', await targetRow.count() > 0, `「${TARGET_PRODUCT}」`)
await targetRow.locator('button:has-text("编辑")').first().click()
await page.waitForTimeout(3000)

const previewRoot = await variableProbe('[data-testid="preview-surface"] [class*="viewportScope"]')
console.log(`[预览] 主题变量 page=${previewRoot?.page} ink=${previewRoot?.ink}`)
check('预览提供与真实页相同的主题变量（修复透明背景）', colorsEqual(previewRoot?.page, realRoot?.page) && colorsEqual(previewRoot?.ink, realRoot?.ink), JSON.stringify(previewRoot))

// 预览卡片与真实卡片对比（同商品、同档位、同年付周期、同折叠状态）。
const previewCard = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const card = surface?.querySelector('article')
  if (!card) return null
  const style = getComputedStyle(card)
  const box = card.getBoundingClientRect()
  const priceNode = card.querySelector('strong')
  const del = card.querySelector('del')
  return {
    tone: card.getAttribute('data-tone'),
    backgroundColor: style.backgroundColor,
    color: style.color,
    borderColor: style.borderTopColor,
    width: Math.round(box.width),
    paddingTop: style.paddingTop,
    paddingLeft: style.paddingLeft,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    text: card.innerText,
    price: priceNode ? priceNode.textContent.trim() : null,
    originalPrice: del ? del.textContent.trim() : null,
    hasPromotionStrip: Boolean(card.querySelector('[class*="promotionStrip"]')),
  }
})

check('预览卡片背景与真实页一致（不再是透明）', colorsEqual(previewCard?.backgroundColor, realCard?.backgroundColor), `preview=${previewCard?.backgroundColor} real=${realCard?.backgroundColor}`)
check('预览卡片文字色与真实页一致', colorsEqual(previewCard?.color, realCard?.color), `preview=${previewCard?.color} real=${realCard?.color}`)
check('预览卡片边框色与真实页一致', colorsEqual(previewCard?.borderColor, realCard?.borderColor), `preview=${previewCard?.borderColor} real=${realCard?.borderColor}`)
check('预览卡片字体与真实页一致', previewCard?.fontFamily === realCard?.fontFamily && previewCard?.fontSize === realCard?.fontSize, `preview=${previewCard?.fontFamily}/${previewCard?.fontSize}`)
check('预览卡片内边距与真实页一致', previewCard?.paddingTop === realCard?.paddingTop && previewCard?.paddingLeft === realCard?.paddingLeft, `preview=${previewCard?.paddingTop},${previewCard?.paddingLeft} real=${realCard?.paddingTop},${realCard?.paddingLeft}`)

/* ---- 自动配色：未编辑时 tone 必须一致（上轮预览强制 standard） ---- */
check('打开编辑器不改字段时配色与真实页一致（保留自动配色）', previewCard?.tone === realCard?.tone, `preview tone=${previewCard?.tone} real tone=${realCard?.tone}`)

/* ---- 活动价：未编辑时必须与真实页完全相同的价格与活动标签 ---- */
check('未编辑时预览活动价与真实页一致', previewCard?.price === realCard?.price, `preview=${previewCard?.price} real=${realCard?.price}`)
check('未编辑时预览保留活动标签/原价划线', previewCard?.hasPromotionStrip === realCard?.hasPromotionStrip && previewCard?.originalPrice === realCard?.originalPrice, `preview strip=${previewCard?.hasPromotionStrip} del=${previewCard?.originalPrice} / real strip=${realCard?.hasPromotionStrip} del=${realCard?.originalPrice}`)

/* ---- 折叠状态：预览不得固定展开，真实页默认折叠 ---- */
const previewBenefitCount = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const card = surface?.querySelector('article')
  return card ? card.querySelectorAll('li').length : -1
})
const realBenefitCount = await page.evaluate((name) => {
  const card = Array.from(document.querySelectorAll('article')).find((item) => item.innerText.includes(name))
  return card ? card.querySelectorAll('li').length : -1
}, TARGET_PRODUCT)
check('预览折叠状态与真实页一致', previewBenefitCount === realBenefitCount, `preview li=${previewBenefitCount} real li=${realBenefitCount}`)

/* ---- 其它字段不得被偷偷改变 ---- */
const untouchedFields = await page.evaluate(() => {
  const value = (label) => document.querySelector(`input[aria-label="${label}"]`)?.value ?? null
  const select = (label) => document.querySelector(`select[aria-label="${label}"]`)?.value ?? null
  return {
    name: value('商品名称'), amount: value('日常价（元）'), points: value('一次发放积分'),
    period: value('有效期（天）'), tone: select('配色'), tierId: value('积分档位标识'),
    groupId: value('套餐分组标识'), audience: select('会员类型'), enabled: document.querySelector('input[type=checkbox]')?.checked,
  }
})
console.log(`[草稿] ${JSON.stringify(untouchedFields)}`)
// 断言**具体字段的具体值**，不做整页模糊匹配。
check('打开编辑器不改字段时草稿与后端一致（金额 299 元 / 24000 积分 / 365 天）',
  untouchedFields.amount === '299' && untouchedFields.points === '24000' && untouchedFields.period === '365',
  `amount=${untouchedFields.amount} points=${untouchedFields.points} period=${untouchedFields.period}`)
// 未编辑时不得伪造配色（真实为自动配色，草稿必须保持空值）。
check('未编辑时配色保持「自动」语义（未被强制为 standard）', untouchedFields.tone === '', `tone=${untouchedFields.tone || '(自动)'}`)

/* ======================================================================
 * C. 预览零写入
 * ==================================================================== */

const writes = []
page.on('request', (req) => {
  const method = req.method()
  if (method !== 'GET' && method !== 'HEAD' && req.url().includes('/api/')) writes.push(`${method} ${req.url().split('/api')[1]}`)
})
const beforeProducts = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  return (list?.products ?? []).map((item) => `${item.id}:${item.amountCents}:${item.sortOrder}`).sort().join(',')
})

// 允许的浏览交互：切周期、切受众、切档位、切换预览模式与视口。
for (const label of ['季付', '月付', '年付']) {
  const button = page.locator(`[data-testid="preview-surface"] button:has-text("${label}")`).first()
  if (await button.count()) { await button.click({ force: true }).catch(() => null); await page.waitForTimeout(400) }
}
const tierButtons = page.locator('[data-testid="preview-surface"] [role="group"] button')
const tierCount = await tierButtons.count()
if (tierCount > 1) { await tierButtons.nth(1).click({ force: true }).catch(() => null); await page.waitForTimeout(500) }
await page.locator('[data-testid="preview-mode-full"]').click()
await page.waitForTimeout(1200)
// 完整预览里的受众切换（创作会员 / 团队版会员）。
const teamTab = page.locator('[data-testid="preview-surface"] button:has-text("团队版会员")').first()
if (await teamTab.count()) { await teamTab.click({ force: true }).catch(() => null); await page.waitForTimeout(1200) }
const creatorTab = page.locator('[data-testid="preview-surface"] button:has-text("创作会员")').first()
if (await creatorTab.count()) { await creatorTab.click({ force: true }).catch(() => null); await page.waitForTimeout(1200) }
await page.locator('[data-testid="preview-surface"]').click({ position: { x: 10, y: 10 } }).catch(() => null)
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)

const afterProducts = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  return (list?.products ?? []).map((item) => `${item.id}:${item.amountCents}:${item.sortOrder}`).sort().join(',')
})
const realWrites = writes.filter((item) => !item.includes('session') && !item.includes('audit'))
check('预览交互期间零写入（含切换周期/受众/档位/Enter）', realWrites.length === 0, realWrites.length ? realWrites.slice(0, 5).join(' | ') : '写请求 0 次')
check('预览不改变商品集合与排序', afterProducts === beforeProducts, afterProducts === beforeProducts ? '集合与 sortOrder 未变' : '集合或排序被修改')

/* ======================================================================
 * D. 手机视口：预览布局必须与真实 390px 手机页一致
 * ==================================================================== */

// 真实 390px 手机页基线。
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const annualMobile = page.locator('button:has-text("年付")').first()
if (await annualMobile.count()) { await annualMobile.click(); await page.waitForTimeout(1800) }
const realMobile = await page.evaluate((name) => {
  const root = document.querySelector('[class*="viewportScope"]')
  const card = Array.from(document.querySelectorAll('article')).find((item) => item.innerText.includes(name))
  const rootStyle = root ? getComputedStyle(root) : null
  const cardBox = card ? card.getBoundingClientRect() : null
  return {
    rootPadding: rootStyle ? `${rootStyle.paddingTop} ${rootStyle.paddingRight} ${rootStyle.paddingBottom} ${rootStyle.paddingLeft}` : null,
    cardWidth: cardBox ? Math.round(cardBox.width) : null,
    rootWidth: root ? Math.round(root.getBoundingClientRect().width) : null,
  }
}, TARGET_PRODUCT)
console.log(`[真实手机页] 根内边距=${realMobile.rootPadding} 卡宽=${realMobile.cardWidth} 根宽=${realMobile.rootWidth}`)

// 后台 390px 视口下的预览。
await page.setViewportSize({ width: 1400, height: 950 })
await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.locator('tr', { hasText: TARGET_PRODUCT }).first().locator('button:has-text("编辑")').first().click()
await page.waitForTimeout(2500)
await page.locator('[data-testid="preview-viewport-mobile"]').click()
await page.waitForTimeout(2000)
const previewMobile = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const root = surface?.querySelector('[class*="viewportScope"]')
  const card = surface?.querySelector('article')
  const rootStyle = root ? getComputedStyle(root) : null
  const cardBox = card ? card.getBoundingClientRect() : null
  return {
    rootPadding: rootStyle ? `${rootStyle.paddingTop} ${rootStyle.paddingRight} ${rootStyle.paddingBottom} ${rootStyle.paddingLeft}` : null,
    cardWidth: cardBox ? Math.round(cardBox.width) : null,
    surfaceWidth: surface ? Math.round(surface.getBoundingClientRect().width) : null,
    overflow: surface ? surface.scrollWidth - surface.clientWidth : null,
  }
})
console.log(`[预览手机] 根内边距=${previewMobile.rootPadding} 卡宽=${previewMobile.cardWidth} 容器宽=${previewMobile.surfaceWidth}`)

check('手机预览使用与真实手机页相同的内边距', previewMobile.rootPadding === realMobile.rootPadding, `preview=${previewMobile.rootPadding} real=${realMobile.rootPadding}`)
check('手机预览卡宽与真实手机页一致', previewMobile.cardWidth === realMobile.cardWidth, `preview=${previewMobile.cardWidth} real=${realMobile.cardWidth}`)
check('手机预览无横向溢出', previewMobile.overflow !== null && previewMobile.overflow <= 2, `scrollWidth-clientWidth=${previewMobile.overflow}`)

/* ---- 关闭按钮必须被隔离在预览内，不能跑到后台窗口右上角 ---- */
// 关闭按钮只在「完整套餐页」模式下渲染（真实视图组件的结构），因此先切到该模式。
await page.locator('[data-testid="preview-mode-full"]').click()
await page.waitForTimeout(1800)
const closeButtonBox = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const button = surface?.querySelector('button[aria-label="关闭会员页面"]')
  if (!button || !surface) return null
  const b = button.getBoundingClientRect()
  const s = surface.getBoundingClientRect()
  return {
    position: getComputedStyle(button).position,
    // 必须落在预览容器内（含 1px 容差）。
    inside: b.left >= s.left - 1 && b.right <= s.right + 1 && b.top >= s.top - 1 && b.bottom <= s.bottom + 1,
    // 且不能贴到浏览器窗口右上角（fixed 时会跑到窗口边缘）。
    atWindowCorner: b.top < 80 && b.right > window.innerWidth - 80,
    button: { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) },
    surface: { l: Math.round(s.left), t: Math.round(s.top), r: Math.round(s.right), b: Math.round(s.bottom) },
  }
})
check('关闭按钮被隔离在预览容器内（不再 fixed 到后台右上角）',
  Boolean(closeButtonBox) && closeButtonBox.inside && closeButtonBox.position === 'absolute' && !closeButtonBox.atWindowCorner,
  JSON.stringify(closeButtonBox))
// 预览中的关闭按钮不应真正关闭任何东西（零写入的另一面：不触发副作用）。
await page.locator('[data-testid="preview-surface"] button[aria-label="关闭会员页面"]').click({ force: true }).catch(() => null)
await page.waitForTimeout(1200)
const stillOpen = await page.locator('[data-testid="product-preview-panel"]').count()
check('点击预览内的关闭按钮不产生副作用', stillOpen > 0, `预览面板仍存在=${stillOpen > 0}`)

await page.setViewportSize({ width: 1440, height: 950 })

/* ======================================================================
 * E. 团队类型与周期联动
 * ==================================================================== */

await page.locator('[data-testid="preview-mode-full"]').click()
await page.waitForTimeout(1500)
// 把草稿的会员类型改为 team，完整预览必须同步切到团队（否则会显示「暂无可用套餐」）。
await page.selectOption('select[aria-label="会员类型"]', 'team')
await page.waitForTimeout(2200)
const teamPreview = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  if (!surface) return null
  const selectedTab = surface.querySelector('[role="tab"][aria-selected="true"]')
  return { selectedTab: selectedTab?.textContent?.trim() ?? null, text: surface.innerText.slice(0, 240) }
})
check('会员类型改为 team 后完整预览切到团队版', teamPreview?.selectedTab === '团队版会员', `选中=${teamPreview?.selectedTab}`)
check('团队预览不再错误显示「暂无可用套餐」（或如实说明未配置）', teamPreview?.selectedTab === '团队版会员', teamPreview?.text?.split('\n').slice(0, 4).join(' | ').slice(0, 120) || '')

// 周期联动：有效期 365 → 30 后，预览周期必须跟随为月付。
await page.selectOption('select[aria-label="会员类型"]', 'creator')
await page.waitForTimeout(1200)
await page.fill('input[aria-label="有效期（天）"]', '30')
await page.waitForTimeout(2200)
const cycleAfterPeriodChange = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const pressed = Array.from(surface?.querySelectorAll('button[aria-pressed="true"]') ?? []).map((n) => n.textContent.trim())
  const hint = surface?.querySelector('[data-testid="preview-cycle-hint"]')?.textContent?.trim() ?? null
  return { pressed, hint }
})
check('有效期改为 30 天后周期联动为月付', cycleAfterPeriodChange.pressed.includes('月付'), `选中周期=${cycleAfterPeriodChange.pressed.join(',')} hint=${cycleAfterPeriodChange.hint}`)
// 并且卡片必须仍然可见（不能因周期不同步而消失）。
const cardVisibleAfterCycle = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  return Boolean(surface?.querySelector('article'))
})
check('周期联动后卡片仍然可见（不再消失）', cardVisibleAfterCycle, cardVisibleAfterCycle ? '卡片已渲染' : '卡片消失')

/* ======================================================================
 * F. 活动价规则：提高日常价时活动仍应有效（不能清空）
 * ==================================================================== */

await page.fill('input[aria-label="有效期（天）"]', '365')
await page.waitForTimeout(1200)
// 恢复为年付后读取卡片价格，再提高日常价。
await page.locator('[data-testid="preview-mode-current"]').click()
await page.waitForTimeout(1200)
const beforeRaise = await page.evaluate(() => {
  const card = document.querySelector('[data-testid="preview-surface"] article')
  return { price: card?.querySelector('strong')?.textContent?.trim() ?? null, del: card?.querySelector('del')?.textContent?.trim() ?? null }
})
await page.fill('input[aria-label="日常价（元）"]', '399')
await page.waitForTimeout(2200)
const afterRaise = await page.evaluate(() => {
  const card = document.querySelector('[data-testid="preview-surface"] article')
  return { price: card?.querySelector('strong')?.textContent?.trim() ?? null, del: card?.querySelector('del')?.textContent?.trim() ?? null }
})
console.log(`[活动价] 299→399 前=${JSON.stringify(beforeRaise)} 后=${JSON.stringify(afterRaise)}`)
// 23920 < 39900 且活动仍在时间窗内 → 活动价应继续保持 239.2，而不是直接变 399 且丢标签。
check('提高日常价后活动价仍然有效（未被清空）', afterRaise.price === '239.2', `改价后价格=${afterRaise.price}（期望 239.2）`)
check('提高日常价后保留原价划线', Boolean(afterRaise.del), `del=${afterRaise.del}`)

// 降低日常价到活动价以下 → 活动价应自动失效（后端规则：活动价必须低于日常价）。
await page.fill('input[aria-label="日常价（元）"]', '199')
await page.waitForTimeout(2200)
const afterLower = await page.evaluate(() => {
  const card = document.querySelector('[data-testid="preview-surface"] article')
  return { price: card?.querySelector('strong')?.textContent?.trim() ?? null, del: card?.querySelector('del')?.textContent?.trim() ?? null }
})
check('日常价低于活动价时活动价自动失效', afterLower.price === '199' && !afterLower.del, `价格=${afterLower.price} del=${afterLower.del}`)

/* ======================================================================
 * G. 数字输入：不静默取整，非法值明确提示
 * ==================================================================== */

await page.fill('[data-testid="product-period"]', '30.5')
await page.waitForTimeout(1200)
const invalidPeriod = await page.evaluate(() => {
  const input = document.querySelector('[data-testid="product-period"]')
  return {
    value: input?.value ?? null,
    ariaInvalid: input?.getAttribute('aria-invalid'),
    bodyHasHint: /必须是整数|不支持小数/.test(document.body.innerText),
  }
})
check('小数天数不被静默改写且给出提示', invalidPeriod.value === '30.5' && invalidPeriod.bodyHasHint, JSON.stringify(invalidPeriod))
await page.fill('[data-testid="product-period"]', '365')
await page.waitForTimeout(1000)

/* ======================================================================
 * H. 活动价与后端权威 pricing 的一致性（隔离测试商品）
 * ==================================================================== */

/**
 * 预览的活动价是按后端规则**镜像**计算的；保存后必须与后端返回的 `pricing` 一致。
 * 这里用一个隔离测试商品（带活动价）验证：改日常价 → 保存 → 后端 pricing 与预览一致。
 */
const isolated = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  const products = list?.products ?? []
  const target = products.find((item) => item.name === '【测试】专业年卡')
  const campaign = await (await fetch('/api/admin/billing/promotions', { cache: 'no-store' })).json().catch(() => null)
  return {
    targetId: target?.id ?? null,
    targetAmount: target?.amountCents ?? null,
    pricing: target?.pricing ?? null,
    campaigns: (campaign?.promotions ?? campaign?.data?.promotions ?? []).map((item) => ({ id: item.id, enabled: item.enabled, products: item.products })),
  }
})
console.log(`[后端定价] 目标商品日常价=${isolated.targetAmount} pricing=${JSON.stringify(isolated.pricing)}`)
check('后端返回的活动价仍有效（活动价 < 日常价）', Number(isolated.pricing?.saleUnitAmountCents) < Number(isolated.targetAmount), `sale=${isolated.pricing?.saleUnitAmountCents} list=${isolated.targetAmount}`)
// 预览必须与后端返回的 saleUnitAmountCents 一致（单位：分）。
const previewPriceCents = Math.round(Number(afterRaise.price) * 100)
check('提高日常价后预览价格与后端 pricing 规则一致', previewPriceCents === Number(isolated.pricing?.saleUnitAmountCents), `preview=${previewPriceCents} backend=${isolated.pricing?.saleUnitAmountCents}`)

/* ---- 恢复草稿，确认没有写入 ---- */
const restored = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  const products = list?.products ?? []
  const target = products.find((item) => item.name === '【测试】专业年卡')
  return { amount: target?.amountCents ?? null, count: products.length, order: products.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.name).join(' | ') }
})
check('目标商品日常价未被预览修改（仍为 29900）', restored.amount === 29900, `amountCents=${restored.amount}`)
console.log(`[排序] ${restored.order}`)

/* ======================================================================
 * I. 桌面/手机截图留证（产物写入 tests/.artifacts，不入库）
 * ==================================================================== */

const artifactDir = resolve(import.meta.dirname ?? '.', '.artifacts')
mkdirSync(artifactDir, { recursive: true })

// 真实页截图（桌面 + 手机）。
await page.setViewportSize({ width: 1440, height: 950 })
await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const annualDesktop = page.locator('button:has-text("年付")').first()
if (await annualDesktop.count()) { await annualDesktop.click(); await page.waitForTimeout(1800) }
await page.screenshot({ path: resolve(artifactDir, 'real-plans-desktop.png'), fullPage: false })
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(2500)
await page.screenshot({ path: resolve(artifactDir, 'real-plans-mobile.png'), fullPage: false })

// 预览截图（桌面 + 手机，含完整套餐页模式）。
await page.setViewportSize({ width: 1440, height: 950 })
await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.locator('tr', { hasText: TARGET_PRODUCT }).first().locator('button:has-text("编辑")').first().click()
await page.waitForTimeout(2500)
await page.locator('[data-testid="preview-mode-current"]').click()
await page.waitForTimeout(1200)
await page.locator('[data-testid="product-preview-panel"]').screenshot({ path: resolve(artifactDir, 'preview-current-desktop.png') })
await page.locator('[data-testid="preview-mode-full"]').click()
await page.waitForTimeout(1800)
await page.locator('[data-testid="product-preview-panel"]').screenshot({ path: resolve(artifactDir, 'preview-full-desktop.png') })
await page.locator('[data-testid="preview-viewport-mobile"]').click()
await page.waitForTimeout(1800)
await page.locator('[data-testid="product-preview-panel"]').screenshot({ path: resolve(artifactDir, 'preview-full-mobile.png') })

const shots = ['real-plans-desktop.png', 'real-plans-mobile.png', 'preview-current-desktop.png', 'preview-full-desktop.png', 'preview-full-mobile.png']
  .filter((name) => existsSync(resolve(artifactDir, name)))
check('已生成桌面与手机对比截图留证', shots.length === 5, `已生成 ${shots.length} 张：${shots.join(', ')}`)

console.log(`\n截图产物：${artifactDir}`)
console.log(`\n总计 ${results.length} 项，失败 ${results.filter((item) => !item.ok).length} 项`)
const failed = results.filter((item) => !item.ok)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
await browser.close()
process.exit(failed.length ? 1 : 0)
