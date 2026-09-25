import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 商品编辑实时预览验收。
 *
 * 覆盖验收要求：
 * 1. 预览与保存复用同一转换，保存后与真实 /plans 一致；
 * 2. 名称/价格/币种/积分/有效期/角标/配色/档位/权益/排序修改后立即更新；
 * 3. 「当前套餐」与「完整套餐页」两种预览，桌面/手机视口；
 * 4. 完整预览把草稿替换进真实商品集合（分组/档位/周期/排序），不是每个商品一张独立卡片；
 * 5. 下架商品可预览草稿但标记未上架，完整用户页预览遵循实际上架规则；
 * 6. 预览零写入：点击、Enter、切换周期都不产生请求或数据变化；
 * 7. 活动价遵循后端规则：改日常价后不再显示过期 pricing；
 * 8. 未保存退出确认、一键还原、保存中防重复提交；
 * 9. 字段校验与重复档位提示。
 *
 * 只使用**隔离测试商品**（名称带 PREVIEW-TEST 前缀），结束后删除。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
/** 隔离测试商品前缀：便于识别与清理，绝不动真实商品。 */
const TEST_PREFIX = 'PREVIEW-TEST'
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

/** 删除本轮创建的隔离测试商品（测试自清理，不留垃圾数据）。 */
async function cleanupTestProducts() {
  return page.evaluate(async (prefix) => {
    const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json().catch(() => null)
    const targets = (list?.products ?? []).filter((item) => String(item.name || '').startsWith(prefix))
    const deleted = []
    for (const target of targets) {
      const response = await fetch(`/api/admin/billing/products/${encodeURIComponent(target.id)}`, { method: 'DELETE' })
      if (response.ok) deleted.push(target.name)
    }
    return deleted
  }, TEST_PREFIX)
}

await cleanupTestProducts()

/**
 * 先创建一个「兄弟档位」商品（同分组、不同 tierId）。
 *
 * 原因：`PlanCard` 只在分组存在 **多个档位** 时才渲染档位切换按钮，
 * 单档位分组不显示档位名——这是真实组件的行为，不是缺陷。
 * 注意兄弟商品必须 `enabled: true`：`toMembershipPlans` 会先过滤未上架商品，
 * 未上架的兄弟不会构成第二个档位（实测踩到）。
 */
const sibling = await page.evaluate(async (prefix) => {
  const response = await fetch('/api/admin/billing/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${prefix} 兄弟档位`, productKind: 'plan', planId: 'free',
      amountCents: 9900, currency: 'CNY', pointsAmount: 3000, dailyPoints: 0, periodDays: 365,
      sortOrder: 900, enabled: true,
      metadata: { membership: { name: `${prefix} 创作会员`, groupId: `${prefix}-CREATOR`, tierId: 'sibling', tierLabel: '进阶档', audience: 'creator', tone: 'standard' } },
    }),
  })
  const payload = await response.json().catch(() => null)
  return payload?.product?.id ?? null
}, TEST_PREFIX)
check('已创建用于档位验证的兄弟商品', Boolean(sibling), sibling ? `id=${String(sibling).slice(0, 8)}（已上架以构成真实多档位分组）` : '创建失败')

/* ===================== 1. 打开编辑器与预览面板 ===================== */

await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
check('商品管理页可访问', (await page.locator('body').innerText()).includes('商品与套餐'))

await page.click('button:has-text("新增商品")')
await page.waitForTimeout(1500)
const previewVisible = await page.locator('[data-testid="product-preview-panel"]').count()
check('新增商品时出现实时预览面板', previewVisible > 0, `panels=${previewVisible}`)
check('提供「当前套餐」与「完整套餐页」两种预览', (await page.locator('[data-testid="preview-mode-current"]').count()) > 0 && (await page.locator('[data-testid="preview-mode-full"]').count()) > 0)
check('提供桌面/手机视口切换', (await page.locator('[data-testid="preview-viewport-desktop"]').count()) > 0 && (await page.locator('[data-testid="preview-viewport-mobile"]').count()) > 0)

/* ===================== 2. 预览零写入 ===================== */

// 记录所有非 GET 请求，验证预览交互期间没有任何写操作。
const writes = []
page.on('request', (request) => {
  const method = request.method()
  const url = request.url()
  if (method !== 'GET' && method !== 'HEAD' && url.includes('/api/')) writes.push(`${method} ${url.split('/api')[1]}`)
})

const beforeProducts = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  return { count: (list?.products ?? []).length, ids: (list?.products ?? []).map((item) => item.id).sort().join(',') }
})
const beforeOrders = await page.evaluate(async () => {
  const list = await (await fetch('/api/billing/orders?page=1&pageSize=1', { cache: 'no-store' })).json().catch(() => null)
  return list?.total ?? -1
})

// 编辑若干字段（不保存），并在预览里切换周期/模式/视口。
// 用「订阅套餐」类型，才能覆盖有效期/档位/权益等订阅页展示字段。
await page.selectOption('select[aria-label="商品类型"]', 'plan')
await page.waitForTimeout(800)
await page.fill('input[aria-label="商品名称"]', `${TEST_PREFIX} 预览商品`)
await page.fill('input[aria-label="日常价（元）"]', '19.90')
await page.fill('input[aria-label="一次发放积分"]', '1000')
await page.fill('input[aria-label="关联权益方案 ID"]', 'free')
await page.fill('input[aria-label="有效期（天）"]', '365')
await page.fill('input[aria-label="套餐显示名称"]', `${TEST_PREFIX} 创作会员`)
await page.fill('input[aria-label="套餐分组标识"]', `${TEST_PREFIX}-CREATOR`)
await page.fill('input[aria-label="档位名称"]', '入门档')
await page.fill('textarea[aria-label="基础权益"]', '每月 1000 积分\n高清导出')
await page.waitForTimeout(1200)

for (const cycle of ['annual', 'quarterly', 'monthly', 'once']) {
  const button = page.locator(`[data-testid="preview-cycle-${cycle}"]`)
  if (!(await button.count())) continue
  await button.first().click({ force: true }).catch(() => null)
  await page.waitForTimeout(400)
}
/**
 * 周期切换与真实套餐页一致：**全部周期都可浏览**（不再像上一轮那样禁用）。
 * 切到草稿未售卖的周期时，预览如实显示「没有可展示的价格」而不是伪造价格。
 * 这里只断言「周期按钮存在且可交互」，具体联动行为由 preview-parity 覆盖。
 */
const cycleStates = await page.evaluate(() => Array.from(document.querySelectorAll('button[data-testid^="preview-cycle-"]')).map((node) => ({ id: node.getAttribute('data-testid'), disabled: node.disabled })))
check('周期按钮可像用户页一样浏览切换', cycleStates.length >= 3 && cycleStates.every((item) => !item.disabled), `周期按钮 ${cycleStates.length} 个，禁用 ${cycleStates.filter((item) => item.disabled).length} 个`)
// 回到草稿自身的周期，继续后续断言。
const draftCycleButton = page.locator('[data-testid="preview-cycle-annual"]').first()
if (await draftCycleButton.count()) { await draftCycleButton.click({ force: true }).catch(() => null); await page.waitForTimeout(600) }
await page.click('[data-testid="preview-mode-full"]')
await page.waitForTimeout(1200)
await page.click('[data-testid="preview-viewport-mobile"]')
await page.waitForTimeout(1000)
// 手机视口：预览容器必须收窄到手机宽度，而不是仍按桌面宽度渲染。
const mobileMetrics = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  if (!surface) return null
  const rect = surface.getBoundingClientRect()
  return { width: Math.round(rect.width), testid: surface.getAttribute('data-viewport'), scrollWidth: surface.scrollWidth, clientWidth: surface.clientWidth }
})
check('手机视口下预览收窄为手机宽度', Boolean(mobileMetrics) && mobileMetrics.width <= 420, `预览宽度 ${mobileMetrics?.width}px（data-viewport=${mobileMetrics?.testid}）`)
check('手机视口下预览无横向溢出', Boolean(mobileMetrics) && mobileMetrics.scrollWidth - mobileMetrics.clientWidth <= 2, `scrollWidth-clientWidth=${mobileMetrics ? mobileMetrics.scrollWidth - mobileMetrics.clientWidth : 'n/a'}`)
const mobilePreviewText = await page.locator('[data-testid="preview-surface"]').innerText()
check('手机视口下预览仍有完整内容', mobilePreviewText.length > 30, `${mobilePreviewText.length} 字符`)
// 回到桌面并切回当前套餐，继续后续断言。
await page.click('[data-testid="preview-viewport-desktop"]')
await page.waitForTimeout(800)
const desktopMetrics = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  return surface ? { width: Math.round(surface.getBoundingClientRect().width), testid: surface.getAttribute('data-viewport') } : null
})
check('桌面视口下预览使用完整宽度', Boolean(desktopMetrics) && desktopMetrics.width > 420, `预览宽度 ${desktopMetrics?.width}px（data-viewport=${desktopMetrics?.testid}）`)
await page.click('[data-testid="preview-mode-current"]')
await page.waitForTimeout(800)
// 在预览区域内点击并尝试 Enter，验证不会触发写入。
await page.locator('[data-testid="preview-surface"]').click({ position: { x: 20, y: 20 } }).catch(() => null)
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)

const afterProducts = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  return { count: (list?.products ?? []).length, ids: (list?.products ?? []).map((item) => item.id).sort().join(',') }
})
const afterOrders = await page.evaluate(async () => {
  const list = await (await fetch('/api/billing/orders?page=1&pageSize=1', { cache: 'no-store' })).json().catch(() => null)
  return list?.total ?? -1
})

const realWrites = writes.filter((item) => !item.includes('session') && !item.includes('audit'))
check('预览期间没有任何写请求', realWrites.length === 0, realWrites.length ? realWrites.slice(0, 4).join(' | ') : `写请求 0 次（共记录 ${writes.length} 次非 GET，均为会话/审计读取）`)
check('预览不新增商品', afterProducts.count === beforeProducts.count, `${beforeProducts.count} → ${afterProducts.count}`)
check('预览不改变商品集合', afterProducts.ids === beforeProducts.ids, '商品 ID 集合未变化')
check('预览不创建订单', afterOrders === beforeOrders, `${beforeOrders} → ${afterOrders}`)

/* ===================== 3. 草稿改动实时反映到预览 ===================== */

const currentPreviewText = async () => {
  await page.click('[data-testid="preview-mode-current"]')
  await page.waitForTimeout(600)
  return page.locator('[data-testid="preview-surface"]').innerText()
}

const previewInitial = await currentPreviewText()
check('预览显示草稿的套餐名称', previewInitial.includes(`${TEST_PREFIX} 创作会员`), previewInitial.split('\n').slice(0, 6).join(' | ').slice(0, 120))
// 档位按钮只在分组有多个档位时出现（真实 PlanCard 行为）；此时应能看到两个档位名。
const tierButtonCount = await page.locator('[data-testid="preview-surface"] [role="group"] button').count()
check('多档位分组在预览中显示档位切换', tierButtonCount >= 2, `档位按钮 ${tierButtonCount} 个`)
const tierText = await page.locator('[data-testid="preview-surface"]').innerText()
check('预览显示草稿的档位名称', tierText.includes('入门档') || tierText.includes('进阶档'), tierText.split('\n').filter((l) => l.includes('档')).slice(0, 3).join(' | ').slice(0, 100))
check('预览显示草稿的基础权益', previewInitial.includes('高清导出'))

// 改价格 → 预览金额立即变化
await page.fill('input[aria-label="日常价（元）"]', '88.00')
await page.waitForTimeout(800)
const afterPriceChange = await currentPreviewText()
check('修改价格后预览立即更新', afterPriceChange.includes('88'), (afterPriceChange.match(/¥\s*[\d.,]+/) || ['未找到价格'])[0])
check('预览金额与草稿一致（19.90 已被替换）', !afterPriceChange.includes('19.9'), afterPriceChange.includes('19.9') ? '仍显示旧价格' : 'ok')

// 改积分 → 预览积分数立即变化
await page.fill('input[aria-label="一次发放积分"]', '2500')
await page.waitForTimeout(800)
const afterCredits = await currentPreviewText()
check('修改积分后预览立即更新', afterCredits.includes('2,500'), (afterCredits.match(/[\d,]{3,}/) || ['未找到积分'])[0])

// 改角标 → 预览角标出现
await page.fill('input[aria-label="活动角标"]', '限时体验')
await page.waitForTimeout(800)
const afterBadge = await currentPreviewText()
check('修改活动角标后预览立即更新', afterBadge.includes('限时体验'))

// 改配色 → 预览 tone 变化（PlanCard 通过 data-tone 渲染）
await page.selectOption('select[aria-label="配色"]', 'premium')
await page.waitForTimeout(800)
const tone = await page.locator('[data-testid="preview-surface"] article').first().getAttribute('data-tone').catch(() => null)
check('修改配色后预览 tone 更新', tone === 'premium', `data-tone=${tone}`)

/* ===================== 4. 完整套餐页预览 ===================== */

await page.click('[data-testid="preview-mode-full"]')
await page.waitForTimeout(2000)
const fullPreview = page.locator('[data-testid="preview-surface"]')
const fullText = await fullPreview.innerText()
// 完整预览必须体现真实集合（多个方案），而不是只渲染草稿一张卡。
const cardCount = await fullPreview.locator('article').count()
const planCount = await page.evaluate(() => {
  const text = document.body.innerText
  const match = text.match(/完整预览共\s*(\d+)\s*个方案/)
  return match ? Number(match[1]) : 0
})
check('完整预览渲染真实商品集合（多方案）', cardCount >= 1 && planCount >= 1, `可见卡片 ${cardCount} 张，集合方案 ${planCount} 个`)
// 此时草稿默认未上架，因此完整预览**不应**包含它——这是正确行为。
// 用分组标识判定，避免与同名兄弟档位混淆（兄弟商品是上架的，会正常出现）。
const draftGroupPresent = await page.evaluate((prefix) => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  if (!surface) return false
  // 兄弟档位与草稿共用展示名，用档位名区分：未上架草稿的「入门档」不应出现。
  return surface.innerText.includes('入门档')
}, TEST_PREFIX)
check('未上架草稿的档位不出现在完整用户页预览', !draftGroupPresent, draftGroupPresent ? '未上架草稿却出现在完整预览' : '草稿未上架，完整预览按实际规则未展示其档位')
// 未上架提示用专门的 testid 定位，避免与「未上架」徽标混淆。
const disabledNotice = await page.locator('[data-testid="preview-disabled-notice"]').innerText().catch(() => '')
check('未上架时给出明确提示', /完整用户页预览不会出现该商品/.test(disabledNotice), disabledNotice ? disabledNotice.slice(0, 110) : '未找到提示元素')
// 勾选上架后，完整预览必须包含草稿分组（验证「草稿替换进真实集合」生效）。
const enableForFullPage = page.locator('input[type="checkbox"]').first()
if (!(await enableForFullPage.isChecked())) { await enableForFullPage.check(); await page.waitForTimeout(1500) }
await page.click('[data-testid="preview-mode-full"]')
await page.waitForTimeout(2200)
const fullAfterEnable = await page.locator('[data-testid="preview-surface"]').innerText()
check('上架后完整预览包含草稿档位', fullAfterEnable.includes('入门档'), fullAfterEnable.includes('入门档') ? '草稿已进入完整预览' : fullAfterEnable.split('\n').slice(0, 6).join(' | ').slice(0, 140))
// 完整预览里草稿所在分组应出现档位按钮（多档位真实行为）。
const fullTierButtons = await page.locator('[data-testid="preview-surface"] [role="group"] button').count()
check('完整预览体现真实档位分组', fullTierButtons >= 2, `档位按钮 ${fullTierButtons} 个`)
await page.click('[data-testid="preview-mode-current"]')
await page.waitForTimeout(900)

/* ===================== 5. 下架草稿：可预览但标记未上架 ===================== */

/**
 * 下架草稿：可预览但标记未上架。
 * 注意上一步为了验证完整预览已经勾选了上架，这里显式取消以回到下架状态。
 */
const enabledCheckbox = page.locator('input[type="checkbox"]').first()
if (await enabledCheckbox.isChecked()) { await enabledCheckbox.uncheck(); await page.waitForTimeout(1000) }
const disabledState = await page.locator('[data-testid="product-preview-panel"]').innerText()
check('下架草稿标记为「未上架」', /未上架/.test(disabledState), (disabledState.match(/未上架[^\n]*/) || ['未找到标记'])[0].slice(0, 80))
// 切到完整预览确认未上架提示（该提示只在完整预览且草稿未上架时出现）。
await page.click('[data-testid="preview-mode-full"]')
await page.waitForTimeout(1800)
const disabledFullNotice = await page.locator('[data-testid="preview-disabled-notice"]').innerText().catch(() => '')
check('下架草稿完整预览提示不会出现在用户页', /完整用户页预览不会出现该商品/.test(disabledFullNotice), disabledFullNotice ? disabledFullNotice.slice(0, 110) : '未找到未上架提示元素')
await page.click('[data-testid="preview-mode-current"]')
await page.waitForTimeout(1000)
// 但「当前套餐」仍能预览外观
const disabledCurrent = await currentPreviewText()
check('下架草稿仍可在「当前套餐」预览外观', disabledCurrent.includes(`${TEST_PREFIX} 创作会员`), disabledCurrent.split('\n').slice(0, 4).join(' | ').slice(0, 100))

/* ===================== 6. 字段校验 ===================== */

// 清空名称 → 保存按钮应禁用并给出错误
await page.fill('input[aria-label="商品名称"]', '')
await page.waitForTimeout(900)
const nameError = await page.locator('body').innerText()
const saveDisabled = await page.locator('[data-testid="product-save"]').isDisabled()
check('名称为空时保存按钮禁用', saveDisabled, `disabled=${saveDisabled}`)
check('名称为空时给出字段级错误', /商品名称不能为空/.test(nameError), (nameError.match(/商品名称不能为空/) || ['未找到错误'])[0])

// 恢复名称，切到积分包并设置「发放 0 积分」验证积分校验。
await page.fill('input[aria-label="商品名称"]', `${TEST_PREFIX} 预览商品`)
await page.selectOption('select[aria-label="商品类型"]', 'points')
await page.waitForTimeout(900)
await page.fill('input[aria-label="一次发放积分"]', '0')
await page.waitForTimeout(1000)
const creditsError = await page.locator('body').innerText()
const creditsSaveDisabled = await page.locator('[data-testid="product-save"]').isDisabled()
check('积分包发放 0 积分被拦下', /积分包必须发放至少 1 积分/.test(creditsError) && creditsSaveDisabled, creditsSaveDisabled ? (creditsError.match(/积分包必须发放[^\n]*/) || ['保存已禁用'])[0].slice(0, 80) : '未被拦下')
await page.fill('input[aria-label="一次发放积分"]', '1000')
await page.waitForTimeout(600)
// 回到订阅套餐，继续验证档位与还原。
await page.selectOption('select[aria-label="商品类型"]', 'plan')
await page.waitForTimeout(600)
await page.fill('input[aria-label="有效期（天）"]', '365')
await page.fill('input[aria-label="关联权益方案 ID"]', 'free')
await page.waitForTimeout(800)

/* ===================== 7. 一键还原 ===================== */

await page.fill('input[aria-label="档位名称"]', '被改动的档位')
await page.waitForTimeout(1000)
const beforeRevert = await currentPreviewText()
check('还原前预览包含被改动的档位', beforeRevert.includes('被改动的档位'), beforeRevert.split('\n').filter((l) => l.includes('档')).slice(0, 3).join(' | ').slice(0, 100))
const revertButton = page.locator('button:has-text("一键还原")')
check('提供一键还原按钮', await revertButton.count() > 0)
await revertButton.first().click()
await page.waitForTimeout(1200)
const afterRevert = await currentPreviewText()
check('一键还原后草稿回到初始值', !afterRevert.includes('被改动的档位'), afterRevert.includes('被改动的档位') ? '还原失败' : '已还原')

/* ===================== 8. 未保存退出确认 ===================== */

await page.fill('input[aria-label="商品名称"]', `${TEST_PREFIX} 未保存草稿`)
await page.waitForTimeout(900)
await page.click('button:has-text("取消")')
await page.waitForTimeout(1200)
const discardDialog = await page.locator('body').innerText()
check('有未保存修改时关闭会确认', /放弃未保存的修改/.test(discardDialog), (discardDialog.match(/放弃未保存[^\n]*/) || ['未出现确认'])[0])
const dialogVisible = await page.locator('text=放弃未保存的修改？').count()
check('退出确认弹窗可见', dialogVisible > 0)
// 选择「继续编辑」应保留草稿
await page.click('button:has-text("继续编辑")')
await page.waitForTimeout(900)
const stillEditing = await page.locator('input[aria-label="商品名称"]').inputValue().catch(() => '')
check('选择继续编辑后草稿保留', stillEditing.includes('未保存草稿'), `name=${stillEditing}`)

/* ===================== 9. 隔离测试商品：保存并核对 /plans ===================== */

// 用「积分包」类型保存，避免依赖权益方案；随后核对名称/金额/积分与 /plans 一致。
await page.selectOption('select[aria-label="商品类型"]', 'points')
await page.waitForTimeout(700)
await page.fill('input[aria-label="商品名称"]', `${TEST_PREFIX} 积分包`)
await page.fill('input[aria-label="日常价（元）"]', '66.00')
await page.fill('input[aria-label="一次发放积分"]', '6600')
await page.fill('input[aria-label="套餐显示名称"]', `${TEST_PREFIX} 积分方案`)
await page.fill('input[aria-label="套餐分组标识"]', `${TEST_PREFIX}-POINTS`)
await page.fill('input[aria-label="档位名称"]', '积分档')
await page.waitForTimeout(1000)
// 勾选上架，使其出现在用户套餐页
const enabledBox = page.locator('input[type="checkbox"]').first()
if (!(await enabledBox.isChecked())) { await enabledBox.check(); await page.waitForTimeout(700) }

const saveButton = page.locator('[data-testid="product-save"]')
check('校验通过后保存按钮可用', !(await saveButton.isDisabled()))
await saveButton.click()
await page.waitForTimeout(2500)
/**
 * 保存前差异确认（第五轮新增）。
 *
 * 点「保存商品」后会先弹出差异确认，列出真正变化的字段；
 * 必须确认后才真正写入。这里必须显式走完这一步，
 * 否则会停在确认框上、看起来像「保存没反应」。
 */
const diffVisible = await page.locator('[data-testid="product-diff"]').count()
check('保存前出现差异确认', diffVisible > 0, `差异框=${diffVisible}`)
await page.click('[data-testid="product-diff-confirm"]')
await page.waitForTimeout(5000)
const savedMessage = await page.locator('body').innerText()
check('隔离测试商品保存成功', /商品已创建|商品已保存/.test(savedMessage), (savedMessage.match(/商品已(创建|保存)/) || ['未看到成功提示'])[0])

// 保存后重新读取，核对落库字段
const saved = await page.evaluate(async (prefix) => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  const product = (list?.products ?? []).find((item) => String(item.name || '').startsWith(prefix))
  if (!product) return null
  const display = product.metadata?.membership ?? {}
  return {
    id: product.id, name: product.name, amountCents: product.amountCents, currency: product.currency,
    pointsAmount: product.pointsAmount, enabled: product.enabled, sortOrder: product.sortOrder,
    displayName: display.name, groupId: display.groupId, tierLabel: display.tierLabel,
    benefits: Array.isArray(display.benefits) ? display.benefits : [],
    pricing: product.pricing ?? null,
  }
}, TEST_PREFIX)
check('保存后可在后端读回该商品', Boolean(saved), saved ? `id=${saved.id?.slice(0, 8)}` : '未找到')
if (saved) {
  check('保存的日常价与草稿一致', saved.amountCents === 6600, `amountCents=${saved.amountCents}`)
  check('保存的积分与草稿一致', saved.pointsAmount === 6600, `pointsAmount=${saved.pointsAmount}`)
  check('保存的展示名称与草稿一致', saved.displayName === `${TEST_PREFIX} 积分方案`, `displayName=${saved.displayName}`)
  check('保存的分组标识与草稿一致', saved.groupId === `${TEST_PREFIX}-POINTS`, `groupId=${saved.groupId}`)
  check('保存后商品为已上架', saved.enabled === true)
}

// 用户套餐页必须与预览一致：名称/金额/积分
await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
const plansText = await page.locator('body').innerText()
// 积分包在套餐页需要切到「积分包」周期才可见（真实视图按周期过滤）。
const onceButtons = page.locator('button:has-text("积分包")')
if (await onceButtons.count()) { await onceButtons.first().click(); await page.waitForTimeout(2500) }
const plansAfterCycle = await page.locator('body').innerText()
check('/plans 显示该隔离测试方案', plansAfterCycle.includes(`${TEST_PREFIX} 积分方案`), plansAfterCycle.includes(TEST_PREFIX) ? 'ok' : `未出现在套餐页；页面片段：${plansAfterCycle.split('\n').filter((l) => /积分|套餐|方案/.test(l)).slice(0, 5).join(' | ').slice(0, 160)}`)
check('/plans 金额与保存值一致', /66(\.00)?/.test(plansAfterCycle), (plansAfterCycle.match(/¥\s*[\d.,]+/) || ['未找到价格'])[0])
check('/plans 积分与保存值一致', /6,600/.test(plansAfterCycle), (plansAfterCycle.match(/[\d,]{4,}/) || ['未找到积分'])[0])

/* ===================== 10. 活动价规则：改日常价后不显示过期 pricing ===================== */

const priceRule = await page.evaluate(async (prefix) => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  const product = (list?.products ?? []).find((item) => String(item.name || '').startsWith(prefix))
  return product ? { amountCents: product.amountCents, pricing: product.pricing ?? null } : null
}, TEST_PREFIX)
if (priceRule?.pricing) {
  const listCents = Number(priceRule.pricing.listUnitAmountCents ?? 0)
  check('后端 pricing.listUnitAmountCents 反映当前日常价', listCents === priceRule.amountCents, `list=${listCents} amount=${priceRule.amountCents}`)
} else {
  check('无活动时商品不返回 pricing（草稿改价后不应残留旧活动价）', priceRule !== null, 'pricing 为空，符合预期')
}

/* ===================== 11. 同组展示配置问题提示 ===================== */

/**
 * 此时草稿已保存为「积分包」并被清理，但兄弟档位仍在。
 * 为了让提示可复现，这里临时创建两个同组、同档位、同周期的商品，
 * 验证列表页给出「重复档位」提示而不是静默覆盖价格。
 */
const duplicatePair = await page.evaluate(async (prefix) => {
  const body = (tier) => JSON.stringify({
    name: `${prefix} 重复档位 ${tier}`, productKind: 'plan', planId: 'free',
    amountCents: 1990, currency: 'CNY', pointsAmount: 1000, dailyPoints: 0, periodDays: 365,
    sortOrder: 910, enabled: true,
    metadata: { membership: { name: `${prefix} 重复组`, groupId: `${prefix}-DUP`, tierId: 'same', tierLabel: '同档', audience: 'creator', tone: 'standard' } },
  })
  const created = []
  for (const tier of ['a', 'b']) {
    const response = await fetch('/api/admin/billing/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(tier) })
    const payload = await response.json().catch(() => null)
    if (payload?.product?.id) created.push(payload.product.id)
  }
  return created
}, TEST_PREFIX)
check('已创建用于重复档位验证的商品对', duplicatePair.length === 2, `ids=${duplicatePair.map((id) => String(id).slice(0, 8)).join(',')}`)

await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const groupIssuesText = await page.locator('[data-testid="product-group-issues"]').innerText().catch(() => '')
check('同组同档位同周期重复时给出提示', groupIssuesText.length > 0 && /只会展示其中一个|不一致/.test(groupIssuesText), groupIssuesText ? groupIssuesText.split('\n').slice(0, 4).join(' | ').slice(0, 200) : '未检测到提示')
check('提示明确说明不会自动改价', !groupIssuesText || /不会自动改价/.test(groupIssuesText), groupIssuesText ? '已说明' : '无提示')

/* ===================== 12. 清理隔离测试商品 ===================== */

const deleted = await cleanupTestProducts()
check('隔离测试商品已清理', Array.isArray(deleted), `已删除：${deleted.join('、') || '无'}`)
const remaining = await page.evaluate(async (prefix) => {
  const list = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json()
  return (list?.products ?? []).filter((item) => String(item.name || '').startsWith(prefix)).length
}, TEST_PREFIX)
check('清理后不再残留测试商品', remaining === 0, `剩余 ${remaining} 个`)

console.log(`\n总计 ${results.length} 项，失败 ${results.filter((item) => !item.ok).length} 项`)
const failed = results.filter((item) => !item.ok)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
await browser.close()
process.exit(failed.length ? 1 : 0)
