import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 同分组「同 tierId 跨周期」展示绑定的回归验收（P2）。
 *
 * 用户报告：月付/季付/年付共用一个 `tierId` 时，选中**年付**能看到正确的年付价格，
 * 但「每日积分」等权益仍是**月付**商品的（10 而不是 100）。
 *
 * 根因：`lib/studio/membership.ts` 的 `toMembershipPlans` 只在档位**首次创建**时
 * （`if (!tier) { ... }`）写入档位的每日积分/角标/促销/权益；
 * 之后同 `tierId` 的其它周期只合并 `pricing`，于是展示数据永远是第一件商品的。
 *
 * 本脚本的验收分层（报告里会明确区分）：
 *   A. **纯函数层**（真实数据）：用真实 HTTP 取回的商品 JSON 跑真实转换
 *      `toMembershipPlans` / `resolveTierDisplay` / `benefitGroupsOf`，
 *      逐个周期断言每日积分、权益、角标、促销、折扣。
 *   B. **真实 HTTP 层**：通过本地管理端接口创建同分组、同 tierId、
 *      月/季/年三个不同每日积分的真实商品，且**只给其中一个周期**配活动；
 *      断言后端返回的 `pricing.promotion` 只挂在该周期上。
 *   C. **管理端预览层**：用真实 HTTP 商品 JSON 走预览的真实数据链
 *      （`productToDraft` → `draftToProduct` → `mergeDraftIntoProducts` → `toMembershipPlans`），
 *      复刻 `components/studio/product-preview.tsx` 的档位/周期选择逻辑后断言展示值。
 *   D. **真实预览 DOM（可选）**：若 3310 上**正在运行**的构建包含本次修复，
 *      再用 Playwright 在 /admin/products 的真实预览面板里核对 DOM 文本；
 *      构建早于修复时明确标记 SKIP（绝不假装通过）。
 *
 * 隔离：商品名统一 `TIERCYCLE-TEST` 前缀，结束时先删活动、再删商品。
 * 不修改任何既有商品/活动/定价配置。
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const REPO = resolve(import.meta.dirname ?? '.', '..')
const PREFIX = 'TIERCYCLE-TEST'
const GROUP_ID = `${PREFIX}-GROUP`
const TIER_ID = 'tiertest'
/** 订阅套餐必须关联一个已启用的权益方案；本环境的已启用方案为 free/creator/pro。 */
const PLAN_ID = 'free'

/** 期望值：三个周期**故意用不同的每日积分**，这正是缺陷的可观测点。 */
const EXPECT = {
  monthly: { dailyPoints: 10, badge: `${PREFIX}-月付角标`, benefit: `${PREFIX}-月付权益`, exclusive: [], extras: [] },
  quarterly: { dailyPoints: 50, badge: '', benefit: `${PREFIX}-季付权益`, exclusive: [], extras: [] },
  annual: {
    dailyPoints: 100, badge: '', benefit: `${PREFIX}-年付权益`,
    exclusive: [`${PREFIX}-年付独家`],
    extras: [1, 2, 3, 4, 5, 6].map((n) => `${PREFIX}-年付更多权益${n}`),
  },
}
const MONTHLY_PROMO_LABEL = `${PREFIX}-月付活动标签`
const MONTHLY_PROMO_CENTS = 990
const MONTHLY_LIST_CENTS = 1990
const MONTHLY_ACTIVITY_TITLE = `${PREFIX}-月付限时活动`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
const skip = (name, detail) => console.log(`SKIP ${name}${detail ? ` :: ${detail}` : ''}`)

/* ==========================================================================
 * 0. 纯函数装载：把仓库里的真实 TS 转译后用 ESM 导入（不复制逻辑）
 * ======================================================================== */

/** 用仓库本地 typescript 转译一个真实源文件到临时目录并导入。 */
async function loadModule(relativePath) {
  const source = readFileSync(resolve(REPO, relativePath), 'utf8')
  const compiled = require('typescript').transpileModule(source, {
    compilerOptions: { module: require('typescript').ModuleKind.ESNext, target: require('typescript').ScriptTarget.ES2022 },
  }).outputText
  const dir = mkdtempSync(join(tmpdir(), 'tiercycle-'))
  const file = join(dir, 'module.mjs')
  writeFileSync(file, compiled, 'utf8')
  return import(pathToFileURL(file).href)
}

const membership = await loadModule('lib/studio/membership.ts')
const benefits = await loadModule('components/membership/benefits.ts')
const productDraft = await loadModule('lib/studio/product-draft.ts')
const { toMembershipPlans, resolveTierDisplay } = membership
const { benefitGroupsOf, planNeedsFold } = benefits
const { productToDraft, draftToProduct, mergeDraftIntoProducts } = productDraft

/* ==========================================================================
 * A0. 结构自检（在真实数据之前，先证明取值规则本身不接受跨周期兜底）
 * ======================================================================== */

{
  /**
   * 用最小合成输入验证「同 tierId 三周期」的取值规则。
   * 这些商品**不落库**，只用来确认解析函数本身没有跨周期兜底。
   */
  const synthetic = [
    { id: 's-month', name: 's-month', productKind: 'plan', amountCents: 1000, currency: 'CNY', pointsAmount: 1, dailyPoints: 10, periodDays: 30, enabled: true, sortOrder: 1, metadata: { membership: { groupId: 's-g', tierId: 's-t' } } },
    { id: 's-quarter', name: 's-quarter', productKind: 'plan', amountCents: 1000, currency: 'CNY', pointsAmount: 1, dailyPoints: 50, periodDays: 90, enabled: true, sortOrder: 2, metadata: { membership: { groupId: 's-g', tierId: 's-t' } } },
    { id: 's-year', name: 's-year', productKind: 'plan', amountCents: 1000, currency: 'CNY', pointsAmount: 1, dailyPoints: 100, periodDays: 365, enabled: true, sortOrder: 3, metadata: { membership: { groupId: 's-g', tierId: 's-t' } } },
  ]
  const tier = toMembershipPlans(synthetic)[0]?.tiers[0]
  check('同 tierId 的三个周期合并为一个档位', Boolean(tier) && tier.pricing.monthly && tier.pricing.quarterly && tier.pricing.annual,
    `cycles=${JSON.stringify(Object.keys(tier?.pricing ?? {}))}`)
  check('结构自检：月付每日积分 = 10', resolveTierDisplay(tier, 'monthly').dailyPoints === 10, `实际=${resolveTierDisplay(tier, 'monthly').dailyPoints}`)
  check('结构自检：季付每日积分 = 50', resolveTierDisplay(tier, 'quarterly').dailyPoints === 50, `实际=${resolveTierDisplay(tier, 'quarterly').dailyPoints}`)
  check('结构自检：年付每日积分 = 100', resolveTierDisplay(tier, 'annual').dailyPoints === 100, `实际=${resolveTierDisplay(tier, 'annual').dailyPoints}`)
  /**
   * 回归护栏：档位上的兼容快照保留「最后写入的周期」的值（此处为年付 100）。
   * 若解析函数读的是这个快照而不是按周期的负载，月付就会得到 100 —— 断言它不等于。
   */
  check('回归护栏：月付解析值不等于档位兼容快照（证明未读快照）',
    tier.dailyPoints === 100 && resolveTierDisplay(tier, 'monthly').dailyPoints !== tier.dailyPoints,
    `tier.dailyPoints=${tier.dailyPoints} 月付解析=${resolveTierDisplay(tier, 'monthly').dailyPoints}`)
  check('结构自检：没有商品的周期返回空负载（不借用兄弟周期）',
    resolveTierDisplay(tier, 'once').dailyPoints === undefined
    && resolveTierDisplay(tier, 'once').promotionLabel === undefined
    && (resolveTierDisplay(tier, 'once').baseBenefits ?? []).length === 0,
    JSON.stringify(resolveTierDisplay(tier, 'once')))
}

/* ==========================================================================
 * B. 真实 HTTP：创建同分组、同 tierId 的月/季/年三件商品 + 只给月付配活动
 * ======================================================================== */

const browser = await chromium.launch()
let page
try {
  const session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
  page = session.page
  console.log(`[会话] ${session.reused ? '复用已登录会话' : '已登录'}`)
} catch (error) {
  await browser.close()
  if (error.throttled) exitThrottled(error.message)
  console.log(`\n[环境不可用] 无法访问 ${BASE}：${error.message}`)
  console.log('这不是功能缺陷：请确认 3310 上的 next start 正在运行后再执行本脚本。')
  process.exit(2)
}

/** 通过页面内 fetch 调接口（浏览器自带 Cookie，与既有验收脚本一致）。 */
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
const listCampaigns = async () => (await api('/api/admin/billing/promotions')).body?.data?.campaigns ?? []
/** 用户套餐页真正读取的接口（走前端代理）。 */
const publicProducts = async () => (await api('/api/billing/products')).body?.products ?? []

/**
 * 清理：**必须先删活动、再删商品**（`vozeb_pro_promotion_products` 外键）。
 * 活动若还引用了别的商品，只摘掉测试条目；只剩测试条目时整条删除。
 */
async function cleanup() {
  const ids = new Set((await listProducts()).filter((p) => String(p.name || '').startsWith(PREFIX)).map((p) => p.id))
  for (const campaign of await listCampaigns()) {
    const mine = campaign.products.filter((entry) => ids.has(entry.productId))
    if (!mine.length) continue
    const remaining = campaign.products.filter((entry) => !ids.has(entry.productId))
    if (!remaining.length) await api(`/api/admin/billing/promotions/${campaign.id}`, { method: 'DELETE' })
    else await api(`/api/admin/billing/promotions/${campaign.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        id: campaign.id, name: campaign.name, label: campaign.label, enabled: campaign.enabled,
        startsAt: campaign.startsAt, endsAt: campaign.endsAt, products: remaining,
      }),
    })
  }
  const deleted = []
  for (const product of await listProducts()) {
    if (!String(product.name || '').startsWith(PREFIX)) continue
    const response = await api(`/api/admin/billing/products/${product.id}`, { method: 'DELETE' })
    if (response.status >= 200 && response.status < 300) deleted.push(product.name)
  }
  return deleted
}

/** 记录本轮创建的资源，便于脚本意外中断后人工清理。 */
const ledgerPath = resolve(REPO, 'tests/.fixtures/tiercycle-test-products.json')
const writeLedger = (entry) => {
  try {
    mkdirSync(resolve(REPO, 'tests/.fixtures'), { recursive: true })
    writeFileSync(ledgerPath, JSON.stringify(entry, null, 2), 'utf8')
  } catch { /* 记录失败不影响验收 */ }
}

const created = { products: [], campaigns: [] }
let failed = []
try {
  // 先清理历史残留，保证「不存在 → 创建 → 断言」的干净链路。
  const leftovers = await cleanup()
  if (leftovers.length) console.log(`[清理] 删除历史残留：${leftovers.join('、')}`)

  const spec = [
    { cycle: 'monthly', name: `${PREFIX} 月付`, periodDays: 30, amountCents: MONTHLY_LIST_CENTS, sortOrder: 901 },
    { cycle: 'quarterly', name: `${PREFIX} 季付`, periodDays: 90, amountCents: 4990, sortOrder: 902 },
    { cycle: 'annual', name: `${PREFIX} 年付`, periodDays: 365, amountCents: 39900, sortOrder: 903 },
  ]
  for (const item of spec) {
    const expected = EXPECT[item.cycle]
    const response = await api('/api/admin/billing/products', {
      method: 'POST',
      body: JSON.stringify({
        name: item.name,
        productKind: 'plan',
        planId: PLAN_ID,
        amountCents: item.amountCents,
        currency: 'CNY',
        pointsAmount: 1000,
        dailyPoints: expected.dailyPoints,
        periodDays: item.periodDays,
        sortOrder: item.sortOrder,
        enabled: true,
        metadata: {
          membership: {
            name: `${PREFIX} 会员`,
            audience: 'creator',
            tone: 'standard',
            groupId: GROUP_ID,
            // ★ 三个周期使用**同一个 tierId 字符串**：这正是缺陷的触发条件。
            tierId: TIER_ID,
            tierLabel: `${PREFIX} 档位`,
            badge: expected.badge,
            benefits: [expected.benefit],
            ...(item.cycle === 'monthly' ? { promotions: [MONTHLY_ACTIVITY_TITLE] } : {}),
            exclusiveBenefits: expected.exclusive,
            extraBenefits: expected.extras,
          },
        },
      }),
    })
    const id = response.body?.product?.id
    if (!id) {
      console.log(`无法创建隔离商品「${item.name}」：${JSON.stringify(response).slice(0, 400)}`)
      break
    }
    created.products.push({ cycle: item.cycle, id, name: item.name })
    writeLedger(created)
  }
  check('已创建同分组同 tierId 的月/季/年三件真实商品', created.products.length === 3,
    created.products.map((p) => `${p.cycle}=${p.id.slice(0, 8)}`).join(' '))

  const monthlyId = created.products.find((p) => p.cycle === 'monthly')?.id
  if (monthlyId) {
    const now = new Date()
    const campaign = await api('/api/admin/billing/promotions', {
      method: 'POST',
      body: JSON.stringify({
        name: `${PREFIX} 仅月付活动`,
        label: MONTHLY_PROMO_LABEL,
        enabled: true,
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
        // ★ 只有月付参与活动：季付/年付必须**没有**任何促销文案可继承。
        products: [{ productId: monthlyId, promotionalAmountCents: MONTHLY_PROMO_CENTS }],
      }),
    })
    const campaignId = campaign.body?.data?.campaign?.id ?? campaign.body?.campaign?.id
    created.campaigns.push({ id: campaignId, label: MONTHLY_PROMO_LABEL })
    writeLedger(created)
    check('已创建只包含月付商品的活动', Boolean(campaignId), `campaign=${String(campaignId).slice(0, 8)} status=${campaign.status} ${campaignId ? '' : JSON.stringify(campaign.body).slice(0, 200)}`)
  }

  /* ---- B. 真实 HTTP：后端把活动价只挂在月付商品上 ---- */
  const httpProducts = await publicProducts()
  const byCycle = Object.fromEntries(created.products.map((p) => [p.cycle, httpProducts.find((item) => item.id === p.id)]))
  check('真实 /api/billing/products 返回三件测试商品', Object.values(byCycle).every(Boolean),
    created.products.map((p) => `${p.cycle}:${byCycle[p.cycle] ? 'ok' : 'missing'}`).join(' '))
  check('HTTP：月付商品带活动价与活动标签',
    Number(byCycle.monthly?.pricing?.saleUnitAmountCents) === MONTHLY_PROMO_CENTS
    && byCycle.monthly?.pricing?.promotion?.label === MONTHLY_PROMO_LABEL,
    `pricing=${JSON.stringify(byCycle.monthly?.pricing)}`)
  check('HTTP：季付商品没有任何活动价/活动标签',
    Number(byCycle.quarterly?.pricing?.saleUnitAmountCents) === 4990 && !byCycle.quarterly?.pricing?.promotion,
    `pricing=${JSON.stringify(byCycle.quarterly?.pricing)}`)
  check('HTTP：年付商品没有任何活动价/活动标签',
    Number(byCycle.annual?.pricing?.saleUnitAmountCents) === 39900 && !byCycle.annual?.pricing?.promotion,
    `pricing=${JSON.stringify(byCycle.annual?.pricing)}`)
  check('HTTP：三件商品的每日积分互不相同（10 / 50 / 100）',
    byCycle.monthly?.dailyPoints === 10 && byCycle.quarterly?.dailyPoints === 50 && byCycle.annual?.dailyPoints === 100,
    `monthly=${byCycle.monthly?.dailyPoints} quarterly=${byCycle.quarterly?.dailyPoints} annual=${byCycle.annual?.dailyPoints}`)

  /* ======================================================================
   * A. 纯函数层：真实 HTTP 数据 → 真实 /plans 转换 → 逐周期断言
   * ==================================================================== */

  const plans = toMembershipPlans(httpProducts)
  const planId = `creator:plan:${GROUP_ID}`
  const plan = plans.find((item) => item.id === planId)
  check('真实商品经 toMembershipPlans 合并为同一张套餐卡', Boolean(plan), `planId=${planId} 实际分组=${plans.map((p) => p.id).join(',')}`)
  if (plan) {
    check('分组内只有一个档位（三个周期共用同 tierId）', plan.tiers.length === 1, `档位数=${plan.tiers.length}`)
    const tier = plan.tiers[0]
    const idOf = (cycle) => created.products.find((p) => p.cycle === cycle)?.id
    check('每个周期都指向它自己那件真实商品',
      tier.pricing.monthly?.productId === idOf('monthly')
      && tier.pricing.quarterly?.productId === idOf('quarterly')
      && tier.pricing.annual?.productId === idOf('annual'),
      `monthly=${tier.pricing.monthly?.productId?.slice(0, 8)} quarterly=${tier.pricing.quarterly?.productId?.slice(0, 8)} annual=${tier.pricing.annual?.productId?.slice(0, 8)}`)

    const monthly = resolveTierDisplay(tier, 'monthly')
    const quarterly = resolveTierDisplay(tier, 'quarterly')
    const annual = resolveTierDisplay(tier, 'annual')

    /* ---- 每日积分：用户报告的核心症状 ---- */
    check('年付 dailyPoints === 100（修复前为月付的 10）', annual.dailyPoints === 100, `实际=${annual.dailyPoints}`)
    check('月付 dailyPoints === 10', monthly.dailyPoints === 10, `实际=${monthly.dailyPoints}`)
    check('季付 dailyPoints === 50', quarterly.dailyPoints === 50, `实际=${quarterly.dailyPoints}`)
    check('年付基础权益含「每日 100 积分」且不含「每日 10 积分」',
      (annual.baseBenefits ?? []).includes('每日 100 积分') && !(annual.baseBenefits ?? []).includes('每日 10 积分'),
      `年付权益=${JSON.stringify(annual.baseBenefits)}`)
    check('月付基础权益含「每日 10 积分」且不含「每日 100 积分」',
      (monthly.baseBenefits ?? []).includes('每日 10 积分') && !(monthly.baseBenefits ?? []).includes('每日 100 积分'),
      `月付权益=${JSON.stringify(monthly.baseBenefits)}`)

    /* ---- 基础权益：运营配置的文案也必须按周期隔离 ---- */
    check('三个周期的运营配置权益各自独立',
      (monthly.baseBenefits ?? []).includes(EXPECT.monthly.benefit)
      && (quarterly.baseBenefits ?? []).includes(EXPECT.quarterly.benefit)
      && (annual.baseBenefits ?? []).includes(EXPECT.annual.benefit)
      && !(annual.baseBenefits ?? []).some((row) => row.includes('月付权益')),
      `monthly=${JSON.stringify(monthly.baseBenefits)} annual=${JSON.stringify(annual.baseBenefits)}`)

    /* ---- 角标 ---- */
    check('只有月付周期有活动角标', monthly.badge === EXPECT.monthly.badge, `月付=${JSON.stringify(monthly.badge)}`)
    check('年付周期**不继承**月付角标（严格 undefined）', annual.badge === undefined, `年付=${JSON.stringify(annual.badge)}`)
    check('季付周期**不继承**月付角标（严格 undefined）', quarterly.badge === undefined, `季付=${JSON.stringify(quarterly.badge)}`)

    /* ---- 促销条：没有活动的周期绝不能继承别人的促销文案 ---- */
    check('月付促销条 === 后端活动标签', monthly.promotionLabel === MONTHLY_PROMO_LABEL, `月付=${JSON.stringify(monthly.promotionLabel)}`)
    check('年付**没有**任何促销文案（严格 undefined）', annual.promotionLabel === undefined, `年付=${JSON.stringify(annual.promotionLabel)}`)
    check('季付**没有**任何促销文案（严格 undefined）', quarterly.promotionLabel === undefined, `季付=${JSON.stringify(quarterly.promotionLabel)}`)

    /* ---- 折扣标签 ---- */
    check('月付折扣标签 = 5折（990/1990 推导）', monthly.discountLabel === '5折', `月付=${JSON.stringify(monthly.discountLabel)}`)
    check('年付**没有**折扣标签（严格 undefined）', annual.discountLabel === undefined, `年付=${JSON.stringify(annual.discountLabel)}`)
    check('季付**没有**折扣标签（严格 undefined）', quarterly.discountLabel === undefined, `季付=${JSON.stringify(quarterly.discountLabel)}`)

    /* ---- 独家功能 / 更多权益 / 限时活动 ---- */
    check('只有年付周期配置了独家功能',
      JSON.stringify(annual.exclusiveBenefits) === JSON.stringify(EXPECT.annual.exclusive)
      && (monthly.exclusiveBenefits ?? []).length === 0,
      `annual=${JSON.stringify(annual.exclusiveBenefits)} monthly=${JSON.stringify(monthly.exclusiveBenefits)}`)
    check('只有年付周期配置了更多权益（6 条）',
      (annual.extraBenefits ?? []).length === 6 && (monthly.extraBenefits ?? []).length === 0,
      `annual=${(annual.extraBenefits ?? []).length} monthly=${(monthly.extraBenefits ?? []).length}`)
    check('只有月付周期有「限时活动」条目',
      JSON.stringify(monthly.promotionBenefits) === JSON.stringify([{ title: MONTHLY_ACTIVITY_TITLE }])
      && (annual.promotionBenefits ?? []).length === 0,
      `monthly=${JSON.stringify(monthly.promotionBenefits)} annual=${JSON.stringify(annual.promotionBenefits)}`)

    /* ---- 折叠判定按周期算 ---- */
    const rowCount = (groups) => groups.promotionBenefits.length + groups.baseBenefits.length + groups.exclusiveBenefits.length + groups.extraBenefits.length
    const annualRows = rowCount(benefitGroupsOf(plan, tier, 'annual'))
    const monthlyRows = rowCount(benefitGroupsOf(plan, tier, 'monthly'))
    const quarterlyRows = rowCount(benefitGroupsOf(plan, tier, 'quarterly'))
    check('折叠判定按周期：年付 9 行 → 需折叠', planNeedsFold(benefitGroupsOf(plan, tier, 'annual')) === true, `年付行数=${annualRows}（期望 9）`)
    check('折叠判定按周期：月付 3 行 → 不折叠', planNeedsFold(benefitGroupsOf(plan, tier, 'monthly')) === false, `月付行数=${monthlyRows}（期望 3）`)
    check('折叠判定按周期：季付 2 行 → 不折叠', planNeedsFold(benefitGroupsOf(plan, tier, 'quarterly')) === false, `季付行数=${quarterlyRows}（期望 2）`)

    /* ---- 结构性护栏：任何一个周期都不得出现别的周期的标记 ---- */
    const payloads = { monthly, quarterly, annual }
    const markers = {
      monthly: [EXPECT.monthly.benefit, EXPECT.monthly.badge, '每日 10 积分', MONTHLY_PROMO_LABEL],
      quarterly: [EXPECT.quarterly.benefit, '每日 50 积分'],
      annual: [EXPECT.annual.benefit, '每日 100 积分', EXPECT.annual.exclusive[0], EXPECT.annual.extras[5]],
    }
    const leaks = []
    for (const [cycle, payload] of Object.entries(payloads)) {
      if (!payload) { leaks.push(`${cycle}:空负载`); continue }
      const text = JSON.stringify(payload)
      for (const [owner, own] of Object.entries(markers)) {
        if (owner === cycle) continue
        for (const marker of own) if (text.includes(marker)) leaks.push(`${cycle} 出现 ${owner} 的「${marker}」`)
      }
    }
    check('结构性护栏：没有任何周期出现兄弟周期的标记', leaks.length === 0, leaks.join('；') || '无跨周期泄漏')

    /* ---- 没有商品的周期必须为空，而不是借用兄弟周期 ---- */
    check('没有商品的周期返回空负载（不借用兄弟周期）',
      resolveTierDisplay(tier, 'once').dailyPoints === undefined
      && resolveTierDisplay(tier, 'once').promotionLabel === undefined
      && (resolveTierDisplay(tier, 'once').baseBenefits ?? []).length === 0,
      JSON.stringify(resolveTierDisplay(tier, 'once')))
  }

  /* ======================================================================
   * C. 管理端预览层：真实预览数据链（product-preview.tsx 的纯函数部分）
   * ==================================================================== */

  /**
   * 复刻 `components/studio/product-preview.tsx` 的选择逻辑（逐行对应）：
   *   currentPlan → draftTier（按 productId 定位）→ currentPlanTiers →
   *   activeTier = browseTier ?? (draftTier 有该周期价格 ? draftTier : tiers[0])
   * 这里只搬运选择逻辑，展示值仍由真实 `toMembershipPlans` / `resolveTierDisplay` 计算。
   */
  function previewActiveTier(products, draftProduct, cycle) {
    const withDraft = mergeDraftIntoProducts(products, draftProduct, { previewDisabled: 'force-visible' })
    const plans = toMembershipPlans(withDraft)
    const groupId = String(products.find((p) => p.id === draftProduct.id)?.metadata?.membership?.groupId ?? '')
    const targetId = `creator:plan:${groupId || draftProduct.id}`
    const currentPlan = plans.find((item) => item.id === targetId)
      ?? plans.find((item) => item.tiers.some((tier) => Object.values(tier.pricing).some((p) => p?.productId === draftProduct.id)))
      ?? null
    if (!currentPlan) return { currentPlan: null, activeTier: null }
    const draftTier = currentPlan.tiers.find((tier) =>
      Object.values(tier.pricing).some((p) => p?.productId === draftProduct.id)) ?? null
    const available = currentPlan.tiers.filter((tier) => tier.pricing[cycle])
    const activeTier = available.find((tier) => tier.id === draftProduct.id)
      ?? (draftTier && draftTier.pricing[cycle] ? draftTier : undefined)
      ?? available[0]
      ?? null
    return { currentPlan, activeTier }
  }

  for (const edited of ['monthly', 'quarterly', 'annual']) {
    const record = created.products.find((p) => p.cycle === edited)
    const source = httpProducts.find((item) => item.id === record?.id)
    if (!source) { check(`预览链路：${edited} 草稿可构造`, false, '商品不存在'); continue }
    const draft = productToDraft(source)
    const draftProduct = draftToProduct(draft, { original: { amountCents: source.amountCents, currency: source.currency } })
    for (const cycle of ['monthly', 'quarterly', 'annual']) {
      const { activeTier } = previewActiveTier(httpProducts, draftProduct, cycle)
      const view = activeTier ? resolveTierDisplay(activeTier, cycle) : null
      check(`预览链路：编辑「${edited}」草稿并选中${cycle} → 每日积分 ${EXPECT[cycle].dailyPoints}`,
        view?.dailyPoints === EXPECT[cycle].dailyPoints,
        `实际=${view?.dailyPoints} tier=${activeTier?.id ?? 'null'} 价格商品=${activeTier?.pricing[cycle]?.productId === record?.id ? '草稿' : '其它'}`)
    }
  }
  {
    // 预览侧同一组断言：选中年付时必须显示年付的促销与权益，而不是月付的。
    const annualRecord = created.products.find((p) => p.cycle === 'annual')
    const annualSource = httpProducts.find((item) => item.id === annualRecord?.id)
    const draft = draftToProduct(productToDraft(annualSource), { original: { amountCents: annualSource.amountCents, currency: annualSource.currency } })
    const planForAnnual = previewActiveTier(httpProducts, draft, 'annual').currentPlan
    const tierForAnnual = planForAnnual?.tiers[0]
    check('预览链路：年付档位不携带月付促销条',
      tierForAnnual ? resolveTierDisplay(tierForAnnual, 'annual').promotionLabel === undefined : false,
      `年付促销=${JSON.stringify(tierForAnnual ? resolveTierDisplay(tierForAnnual, 'annual').promotionLabel : null)}`)
    check('预览链路：月付档位仍保留月付促销条',
      tierForAnnual ? resolveTierDisplay(tierForAnnual, 'monthly').promotionLabel === MONTHLY_PROMO_LABEL : false,
      `月付促销=${JSON.stringify(tierForAnnual ? resolveTierDisplay(tierForAnnual, 'monthly').promotionLabel : null)}`)
  }

  /* ======================================================================
   * D. 真实预览 DOM（仅当 3310 上运行的构建包含本次修复时才执行）
   * ==================================================================== */

  /**
   * 3310 可能是**修复之前**产出的 `next start` 构建。这种情况下 DOM 必然还是旧行为，
   * 把它当成缺陷或假装通过都是错的：这里先检查构建产物是否包含按周期绑定的标记，
   * 不含则明确 SKIP（并给出重建指令），含则做真实 DOM 断言。
   */
  const chunkHit = await (async () => {
    try {
      const dir = resolve(REPO, '.next/static/chunks')
      if (!existsSync(dir)) return { found: false, reason: '未找到 .next/static/chunks' }
      const files = (await import('node:fs')).readdirSync(dir).filter((name) => name.endsWith('.js'))
      let hasNew = false
      let hasOld = false
      for (const name of files) {
        const text = readFileSync(join(dir, name), 'utf8')
        if (text.includes('displayByCycle')) hasNew = true
        /**
         * 旧实现的展示兜底：`tier.promotionLabel ?? plan.promotionLabel`（压缩后无空格）。
         * 只看 `tier.promotionLabel` 会误伤修复后的代码（档位兼容快照仍在），
         * 因此这里匹配**带 plan 兜底**的完整表达式。
         */
        if (text.includes('tier.promotionLabel??plan.promotionLabel')) hasOld = true
      }
      return { found: hasNew && !hasOld, reason: `displayByCycle=${hasNew} 旧兜底代码=${hasOld}` }
    } catch (error) {
      return { found: false, reason: `读取构建产物失败：${error.message}` }
    }
  })()

  if (!chunkHit.found) {
    skip('真实预览 DOM 断言（3310 运行的是修复前的构建）',
      `${chunkHit.reason}；重建并重启 3310 后重跑本脚本即可覆盖这一层（本次未重建，以免影响其它正在使用该端口的验收）`)
  } else {
    await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(4000)
    const row = page.locator('tr', { hasText: `${PREFIX} 年付` }).first()
    await row.locator('button:has-text("编辑")').first().click()
    await page.waitForTimeout(2500)
    const readPreview = () => page.evaluate(() => {
      const card = document.querySelector('[data-testid="preview-surface"] article')
      if (!card) return null
      return {
        text: card.innerText,
        promo: card.querySelector('[data-testid="plan-promotion-strip"]')?.textContent?.trim() ?? null,
        badge: card.querySelector('[data-testid="plan-badge"]')?.textContent?.trim() ?? null,
        discount: card.querySelector('[data-testid="plan-discount"]')?.textContent?.trim() ?? null,
      }
    })
    const clickCycle = async (cycle) => {
      const button = page.locator(`[data-testid="preview-cycle-${cycle}"]`).first()
      if (await button.count()) { await button.click({ force: true }); await page.waitForTimeout(1200) }
    }
    await clickCycle('annual')
    const annualView = await readPreview()
    check('真实预览 DOM：选中年付显示「每日 100 积分」且不含「每日 10 积分」',
      Boolean(annualView) && annualView.text.includes('每日 100 积分') && !annualView.text.includes('每日 10 积分'),
      `促销条=${JSON.stringify(annualView?.promo)} 文本片段=${JSON.stringify(annualView?.text?.slice(0, 120))}`)
    check('真实预览 DOM：年付没有促销条与角标（不继承月付营销文案）',
      annualView?.promo === null && annualView?.badge === null,
      `promo=${JSON.stringify(annualView?.promo)} badge=${JSON.stringify(annualView?.badge)}`)
    /**
     * 截图留证：每个周期各一张，文件名即结论。
     * 截的是**真实预览面板的卡片元素**（不是整页），这样图上就是被断言的同一块 DOM。
     * 同时在卡片顶部叠加一行自描述横幅，避免「图与断言对不上」——
     * 本轮的教训是模糊截图会变成无效证据。
     */
    const shotCycle = async (cycle, view, expectedPoints) => {
      const banner = await page.evaluate(({ cycle, points, ok }) => {
        const card = document.querySelector('[data-testid="preview-surface"] article')
        if (!card) return null
        const label = `${ok ? 'PASS' : 'FAIL'}｜周期=${cycle}｜期望每日 ${points} 积分｜促销=${document.querySelector('[data-testid="plan-promotion-strip"]')?.textContent?.trim() ?? '无'}｜角标=${document.querySelector('[data-testid="plan-badge"]')?.textContent?.trim() ?? '无'}`
        const node = document.createElement('div')
        node.id = 'tiercycle-evidence'
        node.style.cssText = `background:${ok ? '#52c41a' : '#ff4d4f'};color:#000;font:600 13px/1.4 system-ui;padding:6px 10px`
        node.textContent = label
        card.parentElement?.insertBefore(node, card)
        return label
      }, { cycle, points: expectedPoints, ok: Boolean(view) && view.text.includes(`每日 ${expectedPoints} 积分`) })
      const card = page.locator('[data-testid="preview-surface"] article').first()
      await card.screenshot({ path: `tests/.artifacts/P4-tiercycle-${cycle}-preview.png` })
      await page.evaluate(() => document.getElementById('tiercycle-evidence')?.remove())
      console.log(`[截图] tests/.artifacts/P4-tiercycle-${cycle}-preview.png :: ${banner}`)
    }
    await shotCycle('annual', annualView, 100)
    await clickCycle('monthly')
    const monthlyView = await readPreview()
    check('真实预览 DOM：切回月付显示「每日 10 积分」与月付促销条',
      Boolean(monthlyView) && monthlyView.text.includes('每日 10 积分') && monthlyView.promo === MONTHLY_PROMO_LABEL,
      `promo=${JSON.stringify(monthlyView?.promo)} 折扣=${JSON.stringify(monthlyView?.discount)}`)
    await shotCycle('monthly', monthlyView, 10)
    await clickCycle('quarterly')
    const quarterlyView = await readPreview()
    check('真实预览 DOM：季付显示「每日 50 积分」且无促销条',
      Boolean(quarterlyView) && quarterlyView.text.includes('每日 50 积分') && quarterlyView.promo === null,
      `promo=${JSON.stringify(quarterlyView?.promo)} 文本片段=${JSON.stringify(quarterlyView?.text?.slice(0, 100))}`)
    await shotCycle('quarterly', quarterlyView, 50)
  }
} catch (error) {
  check('验收执行过程中未抛出异常', false, error instanceof Error ? `${error.message}` : String(error))
} finally {
  /* ======================================================================
   * 清理：先活动、后商品（外键顺序），并验证无残留
   * ==================================================================== */
  try {
    const deleted = await cleanup()
    const remaining = (await listProducts()).filter((p) => String(p.name || '').startsWith(PREFIX))
    const orphanCampaigns = (await listCampaigns()).filter((campaign) =>
      campaign.products.some((entry) => created.products.some((p) => p.id === entry.productId)))
    check('隔离测试数据已清理（商品 0 残留）', remaining.length === 0,
      `已删除=${deleted.length} 商品 残留=${remaining.map((p) => p.name).join('、') || '无'}`)
    check('隔离测试数据已清理（活动 0 残留）', orphanCampaigns.length === 0,
      `残留活动=${orphanCampaigns.map((c) => c.name).join('、') || '无'}`)
    if (!remaining.length && !orphanCampaigns.length && existsSync(ledgerPath)) {
      try { (await import('node:fs')).rmSync(ledgerPath) } catch { /* 忽略 */ }
    }
    await browser.close()
  } catch (error) {
    console.log(`[清理] 失败，请手动清理 ${PREFIX}* 商品与活动：${error.message}`)
  }
}

failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`)
}
process.exit(failed.length ? 1 : 0)
