import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 桌面预览宽度回归验收（P2）。
 *
 * 缺陷背景（实测复现）：
 *   1440px 浏览器下，后台「实时预览」的桌面模式内部容器只有 426px
 *   （面板自身的宽度），于是 `.viewportScope` 的容器查询按 426px 判定，
 *   `@container (max-width: 760px)` 命中，桌面预览渲染成了**手机布局**：
 *   真实 /plans 桌面卡宽 280px，桌面预览卡宽 300px。
 *
 * 修复要点：桌面预览改为**隔离视口**——作用域固定 1440px（与真实桌面页一致），
 * 再整体缩放到面板宽度。窄面板从此不参与桌面响应式计算。
 *
 * 本文件用**真实浏览器测量具体像素**，不靠肉眼：
 *   ① 真实 /plans 桌面（1440px）与预览桌面：卡宽、列模板、间距；
 *   ② 真实 /plans 手机（390px）与预览手机：卡宽、列模板、间距（防回归）；
 *   ③ 两种预览模式（当前套餐 / 完整套餐页）都要测；
 *   ④ 预览交互零写入（切换视口/周期/展开/Enter 都不产生写请求，也不改数据）。
 *
 * 关键量测约定：
 *   预览内部被 `zoom` 缩放，因此 `getBoundingClientRect()` 给的是**视觉宽度**，
 *   而 `offsetWidth` / `getComputedStyle().gridTemplateColumns` 给的是
 *   **布局宽度**（即容器查询真正使用的值）。两者都要断言：
 *   - 布局宽度必须与真实页逐像素一致（这才是「布局是否正确」的证据）；
 *   - 视觉宽度必须等于 布局宽度 × 缩放比（证明缩放如实生效）。
 *
 * 只读共享业务库：不创建商品、不 PATCH 设置、不保存、不下单。
 */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

/** 目标地址可用 BASE_URL 覆盖：3310 是既有构建，开发服务器用 3313/3314 等。 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3310'
/** 桌面视口宽度：与真实 /plans 基线一致。 */
const DESKTOP_WINDOW = 1440
/** 手机视口宽度：与真实 /plans 手机基线一致。 */
const MOBILE_WINDOW = 390
/** 预览隔离视口宽度（与组件内常量对应，测试里独立声明以形成交叉校验）。 */
const PREVIEW_DESKTOP_SCOPE = 1440
const PREVIEW_MOBILE_SCOPE = 390
/**
 * 容差：1px。
 *
 * 容器查询算出的宽度带小数（手机 82cqw → 280.438px），不同缩放路径下
 * 末位可能差 0.01px 级；同时 Chromium 的子像素舍入会体现在四舍五入上。
 * 1px 足以区分「正确的 280px」与「错误的 300px / 226px / 82px」，
 * 又不会因浮点末位产生假失败。
 */
const TOLERANCE = 1

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
const near = (a, b, tol = TOLERANCE) => a !== null && b !== null && Math.abs(a - b) <= tol
const fmt = (n) => (n === null || n === undefined ? 'n/a' : `${Math.round(n * 100) / 100}`)

/**
 * 把 `grid-template-columns` 解析成数值数组后按容差比较。
 *
 * 不能直接字符串相等：列值本身带小数（手机 280.438px），而 `zoom` 会让
 * Chromium 在坐标系换算时产生 1/64px 级（≈0.016px）舍入——这是渲染实现的
 * 精度问题，不是布局差异。注意**手机**预览缩放比为 1，因此那条基线是
 * 逐字符一致的；桌面预览才需要容差。
 */
const parseTracks = (value) => (typeof value === 'string' ? value.split(/\s+/) : [])
  .map((part) => Number.parseFloat(part))
  .filter((n) => Number.isFinite(n))
const tracksNear = (a, b, tol = TOLERANCE) => {
  const left = parseTracks(a)
  const right = parseTracks(b)
  return left.length > 0 && left.length === right.length && left.every((v, i) => Math.abs(v - right[i]) <= tol)
}
/**
 * 离散判据：容器查询命中哪一档。
 *
 * 注意 `.viewportScope` 的 padding **不能**当判据：容器查询规则里虽然写了
 * `.viewportScope { padding: 48px 14px 72px }`，但元素**不能查询自己**，
 * 因此真实手机页与预览手机页的作用域内边距都仍是 18/24/96（实测）。
 *
 * 真正会翻转的是**后代元素**的样式，取两个跨断点的：
 *  - `gridSnapType`：`@container (max-width: 1100px)` 命中 → `x mandatory`；
 *  - `billingRowFlow`：`@container (max-width: 760px)` 命中 → `column`。
 * 旧缺陷下作用域只有 426px，这两条都会命中，因此该判据能抓住这个 bug。
 *
 * 「当前套餐」模式只渲染卡片、没有 `.billingRow`（拿不到 flow），
 * 因此比对时允许 flow 缺省，但 `gridSnapType` 必须一致。
 */
const layoutSignature = (sample) => [
  `snap=${sample.gridSnapType}`,
  `flow=${sample.billingRowFlow}`,
].join('|')

/** 预览是否与真实页命中同一布局档位。`requireRow=true` 时必须有付费周期行。 */
const layoutMatches = (sample, real, { requireRow = false } = {}) => {
  if (sample.gridSnapType === null || sample.gridSnapType !== real.gridSnapType) return false
  if (requireRow && sample.billingRowFlow === null) return false
  return sample.billingRowFlow === null || sample.billingRowFlow === real.billingRowFlow
}

const artifactDir = resolve(import.meta.dirname ?? '.', '.artifacts')
mkdirSync(artifactDir, { recursive: true })

const browser = await chromium.launch()
let page
try {
  const session = await authenticatedContext(browser, {
    base: BASE,
    username: 'fusion_admin',
    password: TEST_PASSWORD,
    /* 会话缓存按 base 区分：不同端口的会话 cookie 不同，混用会互相顶掉。 */
    name: `fusion_admin-${new URL(BASE).port}`,
    viewport: { width: DESKTOP_WINDOW, height: 950 },
  })
  page = session.page
  console.log(`[会话] ${session.reused ? '复用已登录会话' : '已登录'} · BASE=${BASE}`)
} catch (error) {
  if (error.throttled) { await browser.close(); exitThrottled(error.message) }
  throw error
}

/* ======================================================================
 * 量测工具
 * ==================================================================== */

/**
 * 读取「真实 /plans 页」的布局度量。
 *
 * 定位：`.viewportScope` 是容器查询上下文；卡宽取第一张 article 的
 * **布局宽度**（offsetWidth）与**视觉宽度**（rect）——真实页没有缩放，
 * 两者应相等，这个相等本身就是基线可信的前提。
 */
const probeReal = () => page.evaluate(() => {
  const scope = document.querySelector('[class*="viewportScope"]')
  const grid = document.querySelector('[class*="planGrid"]')
  const cards = Array.from(document.querySelectorAll('article'))
  const gridStyle = grid ? getComputedStyle(grid) : null
  const rectW = (n) => (n ? n.getBoundingClientRect().width : null)
  const billingRow = document.querySelector('[class*="billingRow"]')
  const billingSwitch = document.querySelector('[class*="billingSwitch"]')
  return {
    windowInner: window.innerWidth,
    scopeOffsetWidth: scope ? scope.offsetWidth : null,
    scopePaddingTop: scope ? getComputedStyle(scope).paddingTop : null,
    scopePaddingLeft: scope ? getComputedStyle(scope).paddingLeft : null,
    scopePaddingBottom: scope ? getComputedStyle(scope).paddingBottom : null,
    gridTemplate: gridStyle ? gridStyle.gridTemplateColumns : null,
    gridGap: gridStyle ? gridStyle.gap : null,
    /* 以下两项是跨容器断点会翻转的**离散**判据（padding 不能用作判据）。 */
    gridSnapType: gridStyle ? gridStyle.scrollSnapType : null,
    billingRowFlow: billingRow ? getComputedStyle(billingRow).flexDirection : null,
    billingSwitchWidth: billingSwitch ? getComputedStyle(billingSwitch).width : null,
    cards: cards.map((c) => ({
      name: (c.querySelector('h2')?.textContent || '').trim(),
      offsetWidth: c.offsetWidth,
      rectWidth: rectW(c),
      height: c.getBoundingClientRect().height,
      offsetHeight: c.offsetHeight,
    })),
    scrollOverflow: scope ? scope.scrollWidth - scope.clientWidth : null,
  }
})

/**
 * 读取「后台预览」的布局度量。
 *
 * 同时给出三组宽度，用于把「布局正确」与「缩放正确」分开断言：
 *  - offsetWidth 系列：布局宽度（容器查询使用的值）；
 *  - rectWidth 系列：视觉宽度（缩放后的值）；
 *  - data-preview-scale：组件自报的缩放比。
 */
const probePreview = () => page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const viewport = document.querySelector('[data-testid="preview-viewport"]')
  const scope = surface?.querySelector('[class*="viewportScope"]')
  const grid = surface?.querySelector('[class*="planGrid"]')
  const cards = Array.from(surface?.querySelectorAll('article') ?? [])
  const gridStyle = grid ? getComputedStyle(grid) : null
  const rectW = (n) => (n ? n.getBoundingClientRect().width : null)
  return {
    surfaceOffsetWidth: surface ? surface.offsetWidth : null,
    surfaceRectWidth: rectW(surface),
    surfaceHeight: surface ? surface.getBoundingClientRect().height : null,
    surfaceOverflowX: surface ? surface.scrollWidth - surface.clientWidth : null,
    surfaceOverflowY: surface ? surface.scrollHeight - surface.clientHeight : null,
    scale: surface ? Number(surface.getAttribute('data-preview-scale')) : null,
    viewport: surface ? surface.getAttribute('data-viewport') : null,
    declaredViewportWidth: viewport ? Number(viewport.getAttribute('data-viewport-width')) : null,
    viewportOffsetWidth: viewport ? viewport.offsetWidth : null,
    scopeOffsetWidth: scope ? scope.offsetWidth : null,
    scopeRectWidth: rectW(scope),
    scopePaddingTop: scope ? getComputedStyle(scope).paddingTop : null,
    scopePaddingLeft: scope ? getComputedStyle(scope).paddingLeft : null,
    scopePaddingBottom: scope ? getComputedStyle(scope).paddingBottom : null,
    gridTemplate: gridStyle ? gridStyle.gridTemplateColumns : null,
    gridGap: gridStyle ? gridStyle.gap : null,
    /* 以下两项是跨容器断点会翻转的**离散**判据（padding 不能用作判据）。 */
    gridSnapType: gridStyle ? gridStyle.scrollSnapType : null,
    billingRowFlow: surface?.querySelector('[class*="billingRow"]')
      ? getComputedStyle(surface.querySelector('[class*="billingRow"]')).flexDirection
      : null,
    cards: cards.map((c) => ({
      name: (c.querySelector('h2')?.textContent || '').trim(),
      offsetWidth: c.offsetWidth,
      rectWidth: rectW(c),
      offsetHeight: c.offsetHeight,
    })),
  }
})

/**
 * 桌面/手机两种真实基线各测一次（后台预览共用同一个浏览器上下文）。
 *
 * 关键：**同一周期**。真实 /plans 的计费周期由 URL/视图状态决定，
 * 预览的周期由预览面板的周期按钮决定。只有把两者切到同一个周期，
 * 卡片集合与卡宽才具可比性（否则会把「不同周期的不同方案」误判成不一致）。
 */
async function realBaseline(width, height, cycle = 'annual') {
  await page.setViewportSize({ width, height })
  await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(5000)
  const label = { annual: '年付', quarterly: '季付', monthly: '月付', once: '积分包' }[cycle] ?? '年付'
  const button = page.locator(`button:has-text("${label}")`).first()
  if (await button.count()) { await button.click().catch(() => null); await page.waitForTimeout(2200) }
  return probeReal()
}

/** 打开商品编辑抽屉并进入预览（不影响任何数据）。 */
async function openPreview() {
  await page.setViewportSize({ width: DESKTOP_WINDOW, height: 950 })
  await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4500)
  const row = page.locator('tbody tr').filter({ has: page.locator('button:has-text("编辑")') }).first()
  const count = await row.count()
  if (!count) throw new Error('商品列表里没有可编辑商品，无法打开预览')
  await row.locator('button:has-text("编辑")').first().click()
  await page.waitForTimeout(3500)
  if (!(await page.locator('[data-testid="preview-surface"]').count())) {
    throw new Error('编辑抽屉打开后没有找到 preview-surface')
  }
}

/** 切换到指定模式与视口并等待稳定。 */
async function show(mode, viewport) {
  await page.locator(`[data-testid="preview-mode-${mode}"]`).click()
  await page.waitForTimeout(1200)
  await page.locator(`[data-testid="preview-viewport-${viewport}"]`).click()
  await page.waitForTimeout(1600)
}

/* ======================================================================
 * 0. 前提核对：预览必须在外层 <form> 之内（否则回车风险不成立）
 * ==================================================================== */

await openPreview()
const ancestry = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  const form = surface?.closest('form')
  return {
    insideForm: Boolean(form),
    /* 保存表单里是否有 submit 按钮：有则「隐式提交」会真的触发保存。 */
    submitButtons: form ? form.querySelectorAll('button[type="submit"]').length : 0,
    previewInputs: surface ? surface.querySelectorAll('input').length : -1,
  }
})
console.log(`[祖先核对] preview-surface 在 <form> 内=${ancestry.insideForm}，该 form 的 submit 按钮=${ancestry.submitButtons}，预览内 input=${ancestry.previewInputs}`)
check('预览确实嵌在外层保存表单内（回车隐式提交风险成立，需有隔离）',
  ancestry.insideForm === true,
  `closest('form')=${ancestry.insideForm}, submit 按钮=${ancestry.submitButtons} 个`)

/* ======================================================================
 * A. 真实 /plans 基线
 * ==================================================================== */

const realDesktop = await realBaseline(DESKTOP_WINDOW, 950)
console.log(`[真实 /plans 桌面] window=${realDesktop.windowInner} 作用域=${realDesktop.scopeOffsetWidth} 列模板=${realDesktop.gridTemplate} 间距=${realDesktop.gridGap} 卡片=${JSON.stringify(realDesktop.cards.map((c) => `${c.name}:${c.offsetWidth}`))}`)
check('真实桌面页作用域宽度等于浏览器宽度',
  realDesktop.scopeOffsetWidth === DESKTOP_WINDOW,
  `作用域=${realDesktop.scopeOffsetWidth}px window=${realDesktop.windowInner}px`)
check('真实桌面页渲染出至少一张卡片',
  realDesktop.cards.length > 0,
  `卡片数=${realDesktop.cards.length}`)

const realDesktopCard = realDesktop.cards[0] ?? null
/** 真实桌面卡宽基线：由 CSS `max-width: calc(--plan-count * 280px)` 决定。 */
const REAL_DESKTOP_CARD = realDesktopCard ? realDesktopCard.offsetWidth : null
console.log(`[基线] 真实桌面卡宽=${fmt(REAL_DESKTOP_CARD)}px，列模板=${realDesktop.gridTemplate}`)
check('真实桌面卡宽为 280px（单一尺寸基线，不是模糊范围）',
  near(REAL_DESKTOP_CARD, 280),
  `实测 ${fmt(REAL_DESKTOP_CARD)}px（期望 280±${TOLERANCE}）`)

const realMobile = await realBaseline(MOBILE_WINDOW, 844)
console.log(`[真实 /plans 手机] window=${realMobile.windowInner} 作用域=${realMobile.scopeOffsetWidth} 列模板=${realMobile.gridTemplate} 间距=${realMobile.gridGap} 内边距=${realMobile.scopePaddingTop}/${realMobile.scopePaddingLeft}/${realMobile.scopePaddingBottom}`)
check('真实手机页作用域宽度等于 390px',
  realMobile.scopeOffsetWidth === MOBILE_WINDOW,
  `作用域=${realMobile.scopeOffsetWidth}px window=${realMobile.windowInner}px`)

const realMobileCard = realMobile.cards[0] ?? null
const REAL_MOBILE_CARD = realMobileCard ? realMobileCard.rectWidth : null
console.log(`[基线] 真实手机卡宽=${fmt(REAL_MOBILE_CARD)}px，列模板=${realMobile.gridTemplate}`)
check('真实手机卡宽为 280px 级（min(82cqw,300px) → 约 280.44px）',
  REAL_MOBILE_CARD !== null && Math.abs(REAL_MOBILE_CARD - 280.44) <= TOLERANCE,
  `实测 ${fmt(REAL_MOBILE_CARD)}px（期望 ≈280.44±${TOLERANCE}）`)

/**
 * 离散判据基线：手机容器查询把内边距改成 48/14/72、付费周期行改成纵向；
 * 桌面容器查询保持 18/24/96、横向。这正是 426px 面板当年踩错的地方。
 */
const REAL_DESKTOP_SIGNATURE = layoutSignature(realDesktop)
const REAL_MOBILE_SIGNATURE = layoutSignature(realMobile)
console.log(`[基线] 桌面布局签名=${REAL_DESKTOP_SIGNATURE}`)
console.log(`[基线] 手机布局签名=${REAL_MOBILE_SIGNATURE}`)
check('真实桌面页与手机页的布局签名确实不同（判据有效，不是恒等比较）',
  REAL_DESKTOP_SIGNATURE !== REAL_MOBILE_SIGNATURE,
  `桌面=${REAL_DESKTOP_SIGNATURE} 手机=${REAL_MOBILE_SIGNATURE}`)
check('旧缺陷的容器宽度（426px）确实会翻转该离散判据（证明判据能抓住本 bug）',
  /* 426px 同时命中 1100px 与 760px 两个断点 → snap=x mandatory、flow=column。 */
  REAL_MOBILE_SIGNATURE === 'snap=x mandatory|flow=column' && REAL_DESKTOP_SIGNATURE === 'snap=none|flow=row',
  `手机签名恰为 426px 面板会得到的样式：${REAL_MOBILE_SIGNATURE}`)

/* ======================================================================
 * B. 预览桌面：布局宽度必须与真实桌面逐像素一致
 * ==================================================================== */

await openPreview()
await show('current', 'desktop')
const previewDesktopCurrent = await probePreview()
console.log(`[预览 桌面/当前套餐] 面板=${fmt(previewDesktopCurrent.surfaceRectWidth)} 作用域布局宽=${previewDesktopCurrent.scopeOffsetWidth} 视觉宽=${fmt(previewDesktopCurrent.scopeRectWidth)} 缩放=${previewDesktopCurrent.scale} 列模板=${previewDesktopCurrent.gridTemplate}`)

check('桌面预览的隔离视口宽度为 1440px（与真实桌面页同宽）',
  previewDesktopCurrent.declaredViewportWidth === PREVIEW_DESKTOP_SCOPE && previewDesktopCurrent.viewportOffsetWidth === PREVIEW_DESKTOP_SCOPE,
  `data-viewport-width=${previewDesktopCurrent.declaredViewportWidth} offsetWidth=${previewDesktopCurrent.viewportOffsetWidth}`)

check('桌面预览的作用域**布局**宽度为 1440px（容器查询按此判定，不再受窄面板影响）',
  previewDesktopCurrent.scopeOffsetWidth === PREVIEW_DESKTOP_SCOPE,
  `作用域布局宽=${previewDesktopCurrent.scopeOffsetWidth}px（缺陷时等于面板 426px）`)

const pdCard = previewDesktopCurrent.cards[0] ?? null
/**
 * 离散判据：卡宽在「手机 280.44 / 桌面 280」之间只差 0.44px，
 * 拿它判「有没有命中手机布局」是不可靠的。真正能区分布局档位的是
 * 内边距与周期行排列方向，因此这里断言签名等于**桌面签名**。
 */
check('桌面预览（当前套餐）命中桌面容器查询，未落回手机布局（离散判据）',
  previewDesktopCurrent.gridSnapType === realDesktop.gridSnapType
  && previewDesktopCurrent.gridSnapType !== null
  /* 当前套餐模式没有付费周期行；但网格若命中 760px 断点，snap 一定是 x mandatory。 */
  && previewDesktopCurrent.gridSnapType === 'none',
  `预览签名=${layoutSignature(previewDesktopCurrent)} 期望 snap=none（桌面）而非 x mandatory（手机）`)

check(`桌面预览（当前套餐）卡宽与真实桌面页一致（±${TOLERANCE}px）`,
  pdCard !== null && near(pdCard.offsetWidth, REAL_DESKTOP_CARD),
  `预览=${fmt(pdCard?.offsetWidth)}px 真实=${fmt(REAL_DESKTOP_CARD)}px 差=${pdCard ? fmt(pdCard.offsetWidth - REAL_DESKTOP_CARD) : 'n/a'}px`)

check('桌面预览（当前套餐）列模板与真实桌面页一致',
  tracksNear(previewDesktopCurrent.gridTemplate, realDesktop.gridTemplate),
  `预览=${previewDesktopCurrent.gridTemplate} 真实=${realDesktop.gridTemplate}`)

check('桌面预览（当前套餐）间距与真实桌面页一致',
  previewDesktopCurrent.gridGap === realDesktop.gridGap,
  `预览=${previewDesktopCurrent.gridGap} 真实=${realDesktop.gridGap}`)

check('桌面预览（当前套餐）内边距与真实桌面页一致（未被打成手机内边距 48/14/72）',
  previewDesktopCurrent.scopePaddingTop === realDesktop.scopePaddingTop
  && previewDesktopCurrent.scopePaddingLeft === realDesktop.scopePaddingLeft
  && previewDesktopCurrent.scopePaddingBottom === realDesktop.scopePaddingBottom,
  `预览=${previewDesktopCurrent.scopePaddingTop}/${previewDesktopCurrent.scopePaddingLeft}/${previewDesktopCurrent.scopePaddingBottom} 真实=${realDesktop.scopePaddingTop}/${realDesktop.scopePaddingLeft}/${realDesktop.scopePaddingBottom}`)

const expectedDesktopScale = previewDesktopCurrent.surfaceOffsetWidth > 0 && previewDesktopCurrent.surfaceOffsetWidth < PREVIEW_DESKTOP_SCOPE
  ? previewDesktopCurrent.surfaceOffsetWidth / PREVIEW_DESKTOP_SCOPE
  : 1
check('桌面预览缩放比 = 面板宽度 / 1440，且视觉宽度 = 布局宽度 × 缩放比',
  previewDesktopCurrent.scale !== null
  && Math.abs(previewDesktopCurrent.scale - expectedDesktopScale) <= 0.002
  && pdCard !== null
  && near(pdCard.rectWidth, pdCard.offsetWidth * previewDesktopCurrent.scale, 0.5),
  `缩放=${previewDesktopCurrent.scale}（期望≈${Math.round(expectedDesktopScale * 10000) / 10000}）卡视觉宽=${fmt(pdCard?.rectWidth)} 期望=${fmt(pdCard ? pdCard.offsetWidth * previewDesktopCurrent.scale : null)}`)

check('桌面预览无横向溢出（缩放到面板内，不产生滚动条）',
  previewDesktopCurrent.surfaceOverflowX !== null && previewDesktopCurrent.surfaceOverflowX <= 2,
  `scrollWidth-clientWidth=${previewDesktopCurrent.surfaceOverflowX}`)

/* ======================================================================
 * C. 预览手机：必须与真实 390px 手机页一致（防回归）
 * ==================================================================== */

await show('full', 'mobile')
const previewMobileFull = await probePreview()
console.log(`[预览 手机/完整套餐页] 面板=${fmt(previewMobileFull.surfaceRectWidth)} 作用域=${previewMobileFull.scopeOffsetWidth} 缩放=${previewMobileFull.scale} 列模板=${previewMobileFull.gridTemplate}`)

check('手机预览的隔离视口为 390px（与真实手机页同宽，原始比例不缩放）',
  previewMobileFull.declaredViewportWidth === PREVIEW_MOBILE_SCOPE
  && previewMobileFull.viewportOffsetWidth === PREVIEW_MOBILE_SCOPE
  && previewMobileFull.scopeOffsetWidth === PREVIEW_MOBILE_SCOPE
  && previewMobileFull.scale === 1,
  `data-viewport-width=${previewMobileFull.declaredViewportWidth} 作用域=${previewMobileFull.scopeOffsetWidth} 缩放=${previewMobileFull.scale}`)

const pmCard = previewMobileFull.cards[0] ?? null
check(`手机预览（完整套餐页）卡宽与真实 390px 手机页一致（±${TOLERANCE}px）`,
  pmCard !== null && near(pmCard.rectWidth, REAL_MOBILE_CARD),
  `预览=${fmt(pmCard?.rectWidth)}px 真实=${fmt(REAL_MOBILE_CARD)}px 差=${pmCard ? fmt(pmCard.rectWidth - REAL_MOBILE_CARD) : 'n/a'}px`)

check('手机预览（完整套餐页）列模板与真实手机页一致（逐字符相同，因为缩放比为 1）',
  previewMobileFull.gridTemplate === realMobile.gridTemplate,
  `预览=${previewMobileFull.gridTemplate} 真实=${realMobile.gridTemplate}`)

check('手机预览（完整套餐页）间距与真实手机页一致',
  previewMobileFull.gridGap === realMobile.gridGap,
  `预览=${previewMobileFull.gridGap} 真实=${realMobile.gridGap}`)

check('手机预览命中的是手机布局签名（与真实手机页一致，未被打回桌面布局）',
  layoutMatches(previewMobileFull, realMobile, { requireRow: true }),
  `预览签名=${layoutSignature(previewMobileFull)} 期望=${REAL_MOBILE_SIGNATURE}`)

check('手机预览无横向溢出',
  previewMobileFull.surfaceOverflowX !== null && previewMobileFull.surfaceOverflowX <= 2,
  `scrollWidth-clientWidth=${previewMobileFull.surfaceOverflowX}`)

/* 手机 + 当前套餐 也要测：两种模式 × 两种视口共 4 组。 */
await show('current', 'mobile')
const previewMobileCurrent = await probePreview()
const pmcCard = previewMobileCurrent.cards[0] ?? null
console.log(`[预览 手机/当前套餐] 作用域=${previewMobileCurrent.scopeOffsetWidth} 列模板=${previewMobileCurrent.gridTemplate} 卡=${fmt(pmcCard?.rectWidth)}`)
check('手机预览（当前套餐）卡宽与真实 390px 手机页一致',
  pmcCard !== null && near(pmcCard.rectWidth, REAL_MOBILE_CARD),
  `预览=${fmt(pmcCard?.rectWidth)}px 真实=${fmt(REAL_MOBILE_CARD)}px`)

/* ======================================================================
 * D. 桌面 + 完整套餐页（第二种模式）
 * ==================================================================== */

await show('full', 'desktop')
const previewDesktopFull = await probePreview()
const pdfCard = previewDesktopFull.cards[0] ?? null
console.log(`[预览 桌面/完整套餐页] 面板=${fmt(previewDesktopFull.surfaceRectWidth)} 作用域=${previewDesktopFull.scopeOffsetWidth} 列模板=${previewDesktopFull.gridTemplate} 卡片=${JSON.stringify(previewDesktopFull.cards.map((c) => `${c.name}:${c.offsetWidth}`))}`)

check('桌面预览（完整套餐页）作用域布局宽度为 1440px',
  previewDesktopFull.scopeOffsetWidth === PREVIEW_DESKTOP_SCOPE,
  `作用域布局宽=${previewDesktopFull.scopeOffsetWidth}px`)

check(`桌面预览（完整套餐页）卡宽与真实桌面页一致（±${TOLERANCE}px）`,
  pdfCard !== null && near(pdfCard.offsetWidth, REAL_DESKTOP_CARD),
  `预览=${fmt(pdfCard?.offsetWidth)}px 真实=${fmt(REAL_DESKTOP_CARD)}px`)

check('桌面预览（完整套餐页）列模板与真实桌面页一致',
  tracksNear(previewDesktopFull.gridTemplate, realDesktop.gridTemplate),
  `预览=${previewDesktopFull.gridTemplate} 真实=${realDesktop.gridTemplate}`)

check('桌面预览（完整套餐页）命中桌面布局签名（离散判据）',
  layoutMatches(previewDesktopFull, realDesktop, { requireRow: true }),
  `预览签名=${layoutSignature(previewDesktopFull)} 期望=${REAL_DESKTOP_SIGNATURE}`)

/* ======================================================================
 * E. 「完整套餐页」必须与真实集合同构：卡片集合一致
 * ==================================================================== */

/**
 * 同一周期下比对卡片集合。
 *
 * 必须固定周期：真实 /plans 的默认周期与预览的浏览周期可能不同
 * （实测真实页默认「年付」只出 1 张卡，而预览停在「积分包」出的是另一张），
 * 直接比较会把「不同周期的不同方案」误判成不一致。
 * 因此先各自切到年付，再做集合比对。
 */
await show('full', 'desktop')
for (const cycle of ['annual', 'quarterly', 'monthly', 'once']) {
  const button = page.locator(`[data-testid="preview-cycle-${cycle}"]`)
  if (await button.count()) { await button.first().click({ force: true }).catch(() => null); await page.waitForTimeout(600) }
}
/* 回到年付：与真实页基线同周期。 */
await page.locator('[data-testid="preview-cycle-annual"]').first().click({ force: true }).catch(() => null)
await page.waitForTimeout(1600)
const previewAnnual = await probePreview()
const previewAnnualNames = previewAnnual.cards.map((c) => c.name)
const realAnnual = await realBaseline(DESKTOP_WINDOW, 950, 'annual')
const realAnnualNames = realAnnual.cards.map((c) => c.name)
console.log(`[同构核对] 真实年付卡片=${JSON.stringify(realAnnualNames)}`)
console.log(`[同构核对] 预览年付卡片=${JSON.stringify(previewAnnualNames)}`)
check('桌面预览（完整套餐页）与真实桌面页在**同一周期（年付）**下卡片集合一致',
  realAnnualNames.length > 0
  && realAnnualNames.length === previewAnnualNames.length
  && realAnnualNames.every((n) => previewAnnualNames.includes(n)),
  `真实 ${realAnnualNames.length} 张=[${realAnnualNames.join(' | ')}] 预览 ${previewAnnualNames.length} 张=[${previewAnnualNames.join(' | ')}]`)

/* 回到预览面板继续窄面板用例（上一步已导航离开后台）。 */
await openPreview()
await show('full', 'desktop')

/* ======================================================================
 * F. 窄面板：桌面布局不因面板变窄而塌回手机布局
 * ==================================================================== */

/**
 * 把浏览器窗口收窄，让预览面板更窄；桌面预览的**布局**宽度必须仍是 1440px，
 * 卡宽仍是 280px——只有缩放比变小。这正是「窄面板不得决定桌面布局」的判据。
 */
const narrowSamples = []
for (const width of [1280, 1024]) {
  await page.setViewportSize({ width, height: 950 })
  await page.waitForTimeout(1600)
  const sample = await probePreview()
  const card = sample.cards[0] ?? null
  narrowSamples.push({ width, scope: sample.scopeOffsetWidth, scale: sample.scale, card: card ? card.offsetWidth : null, cardRect: card ? card.rectWidth : null, surface: sample.surfaceOffsetWidth })
  console.log(`[窄面板 window=${width}] 面板=${fmt(sample.surfaceOffsetWidth)} 作用域=${sample.scopeOffsetWidth} 缩放=${sample.scale} 卡布局宽=${fmt(card?.offsetWidth)} 卡视觉宽=${fmt(card?.rectWidth)}`)
}
check('面板收窄后桌面预览布局宽度仍为 1440px（窄面板不参与桌面响应式计算）',
  narrowSamples.every((s) => s.scope === PREVIEW_DESKTOP_SCOPE),
  narrowSamples.map((s) => `window=${s.width}:作用域=${s.scope}`).join(', '))
check('面板收窄后桌面卡布局宽仍为 280px（只缩小、不换布局）',
  narrowSamples.every((s) => near(s.card, REAL_DESKTOP_CARD)),
  narrowSamples.map((s) => `window=${s.width}:卡=${fmt(s.card)}`).join(', '))
check('面板收窄后缩放比随之变小（视觉宽度仍贴合面板）',
  narrowSamples.every((s) => s.scale !== null && s.scale < 1 && near(s.surface, s.scope * s.scale, 2)),
  narrowSamples.map((s) => `window=${s.width}:面板=${fmt(s.surface)}≈${fmt((s.scope ?? 0) * (s.scale ?? 0))}`).join(', '))

await page.setViewportSize({ width: DESKTOP_WINDOW, height: 950 })
await page.waitForTimeout(1500)

/* ======================================================================
 * G. 零写入：切换视口/模式/周期/档位/展开 + Enter 都不产生业务写入
 * ==================================================================== */

const writes = []
page.on('request', (request) => {
  const method = request.method()
  const url = request.url()
  if (method !== 'GET' && method !== 'HEAD' && url.includes('/api/')) writes.push({ method, url: url.split('/api')[1] })
})

/** 业务写入关心的端点：订单、支付、商品、促销、设置。 */
const isBusinessWrite = (entry) => /^\/(billing|admin\/billing|admin\/settings|payment|checkout|orders|promotions)/.test(entry.url)

/**
 * 数据库快照。
 *
 * 这是**共享业务库**，其它 agent 可能同时写入。因此不能假设
 * 「快照之间集合完全不变」——那只在独占数据库时成立。
 * 抽成两个断言层次：
 *  ① 强断言：本页面自身发出的非 GET 请求必须为 0（写入只可能来自本页面）；
 *  ② 弱断言：商品集合里**原有 ID** 的字段未被改动（并发新增不算本次写入）。
 */
const snapshot = () => page.evaluate(async () => {
  const products = await (await fetch('/api/admin/billing/products', { cache: 'no-store' })).json().catch(() => null)
  const orders = await (await fetch('/api/billing/orders?page=1&pageSize=1', { cache: 'no-store' })).json().catch(() => null)
  const rows = products?.products ?? []
  return {
    /* 只看「已有商品」的字段指纹；并发新增不会污染它。 */
    productFingerprint: rows.map((p) => `${p.id}:${p.amountCents}:${p.enabled}:${p.sortOrder}`).sort().join(','),
    productIds: rows.map((p) => p.id).sort(),
    productCount: rows.length,
    orderTotal: orders?.total ?? -1,
  }
})

const before = await snapshot()

/* 交互：两种模式 × 两种视口 + 周期切换 + 权益展开 + 预览内点击与 Enter。 */
for (const mode of ['current', 'full']) {
  for (const viewport of ['desktop', 'mobile']) {
    await show(mode, viewport)
    /* 周期浏览（真实用户页行为，纯只读）。 */
    for (const cycle of ['monthly', 'quarterly', 'annual']) {
      const button = page.locator(`[data-testid="preview-cycle-${cycle}"]`)
      if (await button.count()) { await button.first().click({ force: true }).catch(() => null); await page.waitForTimeout(500) }
    }
    /* 档位切换。 */
    const tiers = page.locator('[data-testid="preview-surface"] [role="group"] button')
    const tierCount = await tiers.count()
    if (tierCount > 1) { await tiers.nth(Math.min(1, tierCount - 1)).click({ force: true }).catch(() => null); await page.waitForTimeout(500) }
    /* 权益展开/收起。 */
    const more = page.locator('[data-testid="preview-more-benefits"]')
    if (await more.count()) { await more.first().click({ force: true }).catch(() => null); await page.waitForTimeout(600) }
    /* 预览内聚焦 + Enter：验证不会触发外层表单提交。 */
    await page.locator('[data-testid="preview-surface"]').click({ position: { x: 12, y: 12 } }).catch(() => null)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
  }
}

/* 直接对预览内可聚焦元素按 Enter（含 tabIndex 容器）。 */
const focusables = await page.locator('[data-testid="preview-surface"] button, [data-testid="preview-surface"] [tabindex]').all()
let pressedEnterOn = 0
for (const node of focusables.slice(0, 12)) {
  const ok = await node.focus().then(() => true).catch(() => false)
  if (!ok) continue
  await page.keyboard.press('Enter')
  pressedEnterOn += 1
  await page.waitForTimeout(250)
}

/**
 * 回车隔离的直接证据。
 *
 * 预览当前没有 input（真实视图组件只渲染按钮），所以「在预览里回车」
 * 天然不会隐式提交。为了证明隔离**真的生效**（而不是碰巧没有输入框），
 * 这里临时往预览里注入一个 input 并聚焦回车：
 *  - 若预览未隔离，回车会冒泡到外层 `<form>` 触发提交（等价于点保存）；
 *  - 若隔离生效，回车被 `preventDefault`，不产生提交。
 *
 * 注入的节点随后立即移除，不留痕迹。
 *
 * 诚实说明（实测确认）：合成 `KeyboardEvent` **不会**触发浏览器内建的
 * 隐式表单提交，因此 `submitted` 在任何实现下都是 false —— 它是兜底断言，
 * 不是有效判别信号。真正有效的判别信号是 `defaultPrevented`：
 * 已用「临时去掉 preventDefault」的对照实验验证它会翻转为 false（测试变红），
 * 说明这条断言确实在测隔离本身，而不是恒真。
 */
const injectedEnter = await page.evaluate(async () => {
  const surface = document.querySelector('[data-testid="preview-surface"]')
  if (!surface) return { ran: false }
  /* 监听外层表单的 submit：这是「隐式提交」唯一可观测的信号。 */
  const form = surface.closest('form')
  let submitted = false
  const onSubmit = () => { submitted = true }
  form?.addEventListener('submit', onSubmit, true)

  const input = document.createElement('input')
  input.type = 'text'
  input.setAttribute('data-injected-probe', 'true')
  surface.appendChild(input)
  input.focus()
  const focused = document.activeElement === input

  /* 派发真实按键序列（keydown 会走 React 的合成事件）。 */
  const press = (type) => input.dispatchEvent(new KeyboardEvent(type, {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
  }))
  const keydown = press('keydown')
  press('keypress')
  press('keyup')

  input.remove()
  form?.removeEventListener('submit', onSubmit, true)
  return {
    ran: true,
    focused,
    /* dispatchEvent 返回 false 表示 preventDefault 被调用 —— 隔离生效。 */
    defaultPrevented: keydown === false,
    submitted,
  }
})
console.log(`[回车隔离] ${JSON.stringify(injectedEnter)}`)
check('预览内 input 按 Enter 被阻止默认行为（preventDefault 生效，对照实验可翻转）',
  injectedEnter.ran === true && injectedEnter.focused === true && injectedEnter.defaultPrevented === true,
  JSON.stringify(injectedEnter))
check('预览内 input 按 Enter 不会向外层保存表单提交（兜底断言；合成事件本就不触发隐式提交）',
  injectedEnter.ran === true && injectedEnter.submitted === false,
  `submit 触发=${injectedEnter.submitted}`)

await page.waitForTimeout(1500)

const after = await snapshot()
const businessWrites = writes.filter(isBusinessWrite)
const allNonGet = writes.filter((entry) => !entry.url.includes('/api/auth/session') && !entry.url.includes('/api/admin/audit'))

console.log(`[零写入] 非 GET 请求共 ${writes.length} 次；其中业务写入 ${businessWrites.length} 次；Enter 聚焦元素 ${pressedEnterOn} 个`)
if (writes.length) console.log(`[零写入] 明细：${JSON.stringify(writes.slice(0, 8))}`)

check('预览交互期间没有任何业务写入请求（订单/支付/商品/促销/设置）',
  businessWrites.length === 0,
  businessWrites.length ? businessWrites.slice(0, 5).map((w) => `${w.method} ${w.url}`).join(' | ') : '业务写入 0 次')

check('预览交互期间除会话/审计读取外没有任何非 GET 请求',
  allNonGet.length === 0,
  allNonGet.length ? allNonGet.slice(0, 5).map((w) => `${w.method} ${w.url}`).join(' | ') : '非 GET 0 次')

/* 原有商品（按 ID）的字段必须逐一未变；并发新增的 ID 单独报告。 */
const beforeById = new Map(before.productFingerprint.split(',').filter(Boolean).map((row) => [row.split(':')[0], row]))
const afterById = new Map(after.productFingerprint.split(',').filter(Boolean).map((row) => [row.split(':')[0], row]))
const changedRows = [...beforeById.entries()].filter(([id, row]) => afterById.get(id) !== row).map(([id]) => id)
const removedRows = [...beforeById.keys()].filter((id) => !afterById.has(id))
const addedRows = [...afterById.keys()].filter((id) => !beforeById.has(id))

console.log(`[零写入] 商品数 ${before.productCount} → ${after.productCount}；新增 ${addedRows.length} 个（并发写入），被改动 ${changedRows.length} 个，被删除 ${removedRows.length} 个`)

check('预览交互未改动任何**原有商品**（金额/上架/排序逐一未变；并发新增不计）',
  changedRows.length === 0 && removedRows.length === 0,
  `被改动=${changedRows.length} 被删除=${removedRows.length}；并发新增 ${addedRows.length} 个（已排除，非本次行为）`)

check('预览交互不创建订单',
  after.orderTotal === before.orderTotal,
  `订单总数 ${before.orderTotal} → ${after.orderTotal}`)

/* 预览内 Enter 不触发外层表单保存（保存成功会有提示或关闭抽屉）。 */
const afterEnterState = await page.evaluate(() => ({
  drawerOpen: Boolean(document.querySelector('[data-testid="product-preview-panel"]')),
  bodyMentionsSaved: /商品已保存|商品已创建/.test(document.body.innerText),
  diffDialogOpen: Boolean(document.querySelector('[data-testid="product-diff"]')),
}))
check('预览内按 Enter 没有触发保存（抽屉仍在、无保存成功提示、无差异确认框）',
  afterEnterState.drawerOpen && !afterEnterState.bodyMentionsSaved && !afterEnterState.diffDialogOpen,
  JSON.stringify(afterEnterState))

/* ======================================================================
 * H. 截图留证：图内烧录实测数字（自描述、互不相同）
 * ==================================================================== */

/**
 * 在页面内构造一个「证据横幅」，把实测数字直接画进截图。
 *
 * 上一轮出过两张 SHA256 完全相同的截图，等于没有证据。这里保证：
 *  ① 每张图都带自己的实测数字（卡宽、作用域、缩放比、时间戳）；
 *  ② 截图对象不同（真实页 / 预览面板）；
 *  ③ 事后校验 SHA256 两两不同。
 */
async function withEvidenceBanner(text, target, path) {
  const handle = await page.evaluateHandle((content) => {
    const node = document.createElement('div')
    node.setAttribute('data-evidence-banner', 'true')
    node.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483647',
      'background:#0b0b0b', 'color:#5ef1a8', 'font:600 13px/1.5 monospace',
      'padding:8px 12px', 'white-space:pre-wrap', 'border-bottom:3px solid #5ef1a8',
    ].join(';')
    node.textContent = content
    document.body.appendChild(node)
    return node
  }, text)
  try {
    if (target) await target.screenshot({ path })
    else await page.screenshot({ path })
  } finally {
    await handle.evaluate((node) => node.remove()).catch(() => null)
    await handle.dispose().catch(() => null)
  }
}

/** 采集一份带实测数字的横幅文本。 */
const bannerFor = (label, sample, scope, scale, card) => [
  `桌面预览宽度回归证据 · ${label}`,
  `BASE=${BASE}  时间=${new Date().toISOString()}`,
  `窗口=${sample.windowInner ?? DESKTOP_WINDOW}px  面板=${fmt(sample.surfaceOffsetWidth ?? sample.scopeOffsetWidth)}px`,
  `隔离视口作用域=${scope}px  缩放比=${scale}  卡布局宽=${fmt(card)}px`,
  `真实桌面卡=${fmt(REAL_DESKTOP_CARD)}px  真实手机卡=${fmt(REAL_MOBILE_CARD)}px`,
].join('\n')

const shots = []

/* 真实桌面页 */
await page.setViewportSize({ width: DESKTOP_WINDOW, height: 950 })
await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
const realDeskShot = await probeReal()
{
  const file = resolve(artifactDir, 'desktop-preview-real-plans-1440.png')
  await withEvidenceBanner(
    bannerFor('真实 /plans 桌面', { windowInner: realDeskShot.windowInner }, realDeskShot.scopeOffsetWidth, 1, realDeskShot.cards[0]?.offsetWidth ?? null),
    null,
    file,
  )
  shots.push(file)
}

/* 真实手机页 */
await page.setViewportSize({ width: MOBILE_WINDOW, height: 844 })
await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const realMobShot = await probeReal()
{
  const file = resolve(artifactDir, 'desktop-preview-real-plans-390.png')
  await withEvidenceBanner(
    bannerFor('真实 /plans 手机 390px', { windowInner: realMobShot.windowInner }, realMobShot.scopeOffsetWidth, 1, realMobShot.cards[0]?.offsetWidth ?? null),
    null,
    file,
  )
  shots.push(file)
}

/* 预览：桌面/当前套餐、桌面/完整套餐页、手机/完整套餐页、手机/当前套餐 */
await openPreview()
const previewShotSpecs = [
  { mode: 'current', viewport: 'desktop', file: 'desktop-preview-preview-desktop-current.png', label: '后台预览 桌面/当前套餐' },
  { mode: 'full', viewport: 'desktop', file: 'desktop-preview-preview-desktop-full.png', label: '后台预览 桌面/完整套餐页' },
  { mode: 'full', viewport: 'mobile', file: 'desktop-preview-preview-mobile-full.png', label: '后台预览 手机/完整套餐页' },
  { mode: 'current', viewport: 'mobile', file: 'desktop-preview-preview-mobile-current.png', label: '后台预览 手机/当前套餐' },
]
for (const spec of previewShotSpecs) {
  await show(spec.mode, spec.viewport)
  const sample = await probePreview()
  const card = sample.cards[0]?.offsetWidth ?? null
  const file = resolve(artifactDir, spec.file)
  const text = [
    bannerFor(spec.label, sample, sample.scopeOffsetWidth, sample.scale, card),
    `列模板=${sample.gridTemplate}  间距=${sample.gridGap}`,
    `真实桌面列模板=${realDesktop.gridTemplate}  真实手机列模板=${realMobile.gridTemplate}`,
  ].join('\n')
  await withEvidenceBanner(text, page.locator('[data-testid="product-preview-panel"]'), file)
  shots.push(file)
  console.log(`[截图] ${spec.file}`)
}

/* 校验：4+2 张截图都存在，且 SHA256 两两不同（防止「两张一模一样的图」假证据）。 */
const hashOf = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const existing = shots.filter((file) => existsSync(file))
const hashes = existing.map((file) => ({ file: file.split(/[\\/]/).pop(), hash: hashOf(file) }))
const uniqueHashes = new Set(hashes.map((h) => h.hash))
console.log('[截图哈希]')
for (const item of hashes) console.log(`  ${item.hash.slice(0, 16)}…  ${item.file}`)

check('已生成 6 张对比截图（真实桌面/手机 + 预览 4 组）',
  existing.length === 6,
  `生成 ${existing.length}/6 张`)
check('6 张截图 SHA256 两两不同（自描述、互不重复）',
  uniqueHashes.size === hashes.length && hashes.length === 6,
  `唯一哈希 ${uniqueHashes.size}/${hashes.length}`)

/* ======================================================================
 * 汇总
 * ==================================================================== */

const failed = results.filter((item) => !item.ok)
console.log(`\n[结果] BASE=${BASE} 总计 ${results.length} 项，失败 ${failed.length} 项`)
console.log(`[结果] 关键数字：真实桌面卡=${fmt(REAL_DESKTOP_CARD)}px 预览桌面卡=${fmt(pdCard?.offsetWidth)}px 真实手机卡=${fmt(REAL_MOBILE_CARD)}px 预览手机卡=${fmt(pmCard?.offsetWidth)}px`)
console.log(`[产物] 截图目录：${artifactDir}`)
if (failed.length) console.log(JSON.stringify(failed, null, 1))

await browser.close()
process.exit(failed.length ? 1 : 0)
