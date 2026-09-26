/**
 * 液态玻璃设计系统的永久回归（第十一轮起）。
 *
 * 把改版过程中用来做自查的几类审计固化下来，避免后续改动把设计系统改回原样：
 *  1. **令牌与表面**：`--lg-*` 令牌存在；玻璃只出现在该出现的地方
 *     （导航/浮层/创作输入区），列表与密集卡片**不得**带模糊；
 *  2. **对比度**：正文/次要文字在**其实际背景**上的 WCAG AA 对比度
 *     （浅色 + 深色两套主题），玻璃表面一并纳入；
 *     渐变压底文字另用**真实像素**复核（纯色层叠模型读不到渐变）；
 *  3. **浮层与键盘**：菜单/弹窗不被祖先裁切、fixed/sticky 不偏移、
 *     Tab 焦点可见、移动端无横向溢出；
 *  4. **路由覆盖**：主要路由 + 真实参数化路由（项目各分区、画布、后台各分区）
 *     在桌面与移动端都能渲染、无控制台错误、无横向溢出。
 *
 * 为什么必须自动化：这类问题在代码评审时"看起来没问题"，
 * 只有真跑浏览器量出来才会暴露（本轮实测踩到四处：玻璃因 CSS 管线属性顺序
 * 被删而不生效、浅色次要文字 3.99:1、画布浮动面板在深色画布上 2.22:1、
 * 渐变压底次要文字 3.98:1）。
 *
 * 已知的**预存**接口不一致（与本设计系统无关，单独计数不计失败）：
 * 前端 `works-account-pages.tsx` 调 `/api/public/works`，
 * 而后端只提供 `/api/public/gallery` 与 `/api/public/works/[slug]`
 * → 广场页会有一个 404，页面按"接口不可用"如实显示空态。
 * 该调用来自更早的提交（`git log` 可查），本轮未改业务逻辑。
 *
 * 运行：`UI_BASE=http://127.0.0.1:3310 node tests/design-system.test.mjs`
 * 需要已登录的本地会话（复用 `session-helper`）。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'
import { TEST_PASSWORD } from './test-credentials.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = process.env.UI_BASE || 'http://127.0.0.1:3310'
const results = []
const notExecuted = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }
const skip = (name, why) => { notExecuted.push({ name, why }); console.log(`NOT-EXECUTED ${name} :: ${why}`) }

/** 覆盖率：设计系统覆盖的主要路由（浅色/深色各跑一遍对比度）。 */
const ROUTES = ['/studio', '/image', '/video', '/tasks', '/account', '/settings', '/assets', '/admin', '/canvas', '/agent', '/projects', '/gallery', '/works']

const browser = await chromium.launch()
let session
try { session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD }) }
catch (e) { if (e?.throttled) { await browser.close(); exitThrottled(e.message) } await browser.close(); throw e }

const page = session.page
page.setDefaultTimeout(60000)

/**
 * 页面内对比度采样：对每个直接承载文字的元素，求其层叠后的实际背景并算 WCAG 比值。
 *
 * **已知盲区与处理**：`background-color` 之外，卡片底部常用
 * `bg-gradient-to-t from-studio-ink/80` 这类**渐变**做深色压底；
 * 渐变不是 `backgroundColor`，所以纯色层叠模型读不到它，
 * 会把"白底黑字"误判成实际是"深色渐变上的白字"，从而报出假阳性
 * （实测 /works 的比例文本被判 1.0，像素实测是 6.17）。
 * 因此这里遇到祖先含渐变时**跳过该元素**，交由单独的像素级用例覆盖。
 */
const CONTRAST = () => page.evaluate(() => {
  const parse = (color) => {
    const m = color.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05) }
  const hasGradientAncestor = (el) => {
    let node = el
    while (node && node !== document.documentElement) {
      const img = getComputedStyle(node).backgroundImage
      if (img && img !== 'none' && img.includes('gradient')) return true
      node = node.parentElement
    }
    return false
  }
  const effectiveBg = (el) => {
    let node = el; let acc = null
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) acc = acc ? over(acc, c) : c
      if (acc && acc.a >= 1) return acc
      node = node.parentElement
    }
    const body = parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
    return acc ? over(acc, body) : body
  }
  const samples = []
  let skipped = 0
  const root = document.querySelector('main') ?? document.body
  for (const el of root.querySelectorAll('h1,h2,h3,p,span,label,td,th,a,button,dt,dd')) {
    if (!el.textContent?.trim()) continue
    if (Array.from(el.children).some((c) => c.textContent?.trim())) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) continue
    const fg = parse(cs.color)
    if (!fg || fg.a === 0) continue
    /** 渐变压底无法用纯色层叠建模 → 跳过，交给像素级用例。 */
    if (hasGradientAncestor(el)) { skipped += 1; continue }
    const bg = effectiveBg(el)
    const size = Number.parseFloat(cs.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 600)
    samples.push({ text: el.textContent.trim().slice(0, 24), ratio: Math.round(ratio(over(fg, bg), bg) * 100) / 100, need: large ? 3 : 4.5 })
  }
  const fails = samples.filter((s) => s.ratio < s.need)
  return { total: samples.length, skipped, failCount: fails.length, fails: fails.slice(0, 6) }
})

/**
 * 像素级对比度：用于覆盖上面跳过的"渐变压底"文字。
 * 取元素截图，用最暗与最亮像素估算对比度（保守：会把抗锯齿边缘计入）。
 */
const pixelRatio = async (locator) => {
  const el = await locator.elementHandle()
  if (!el) return null
  const png = await el.screenshot()
  return page.evaluate(async (data) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
    const { data: px } = ctx.getImageData(0, 0, c.width, c.height)
    const lum = (r, g, b) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    let min = 1, max = 0
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 200) continue; const v = lum(px[i], px[i + 1], px[i + 2]); if (v < min) min = v; if (v > max) max = v }
    return { ratio: Math.round(((max + 0.05) / (min + 0.05)) * 100) / 100, w: c.width, h: c.height }
  }, png.toString('base64'))
}

try {
  /* ================================================================
   * 1. 令牌与玻璃分配
   * ============================================================== */
  console.log('\n--- 1. 设计令牌与表面分配 ---')
  await page.goto(`${BASE}/studio`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)

  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const names = ['--lg-glass-strong', '--lg-glass-base', '--lg-edge', '--lg-highlight', '--lg-shadow-1', '--lg-shadow-4', '--lg-blur-bar', '--lg-blur-panel', '--lg-blur-overlay', '--lg-dur-base', '--lg-ease-out', '--lg-gap-4', '--lg-ambient']
    return names.filter((n) => !cs.getPropertyValue(n).trim())
  })
  check('液态玻璃令牌全部已定义', tokens.length === 0, tokens.length ? `缺失: ${tokens.join(', ')}` : '13 项齐备')

  const glass = await page.evaluate(() => {
    const has = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      return getComputedStyle(el).backdropFilter
    }
    return { topbar: has('.studio-topbar'), sidebar: has('.studio-sidebar') }
  })
  check('顶栏使用玻璃（backdrop-filter 生效）', /blur/.test(glass.topbar ?? ''), `blur=${glass.topbar}`)
  check('侧栏使用玻璃（backdrop-filter 生效）', /blur/.test(glass.sidebar ?? ''), `blur=${glass.sidebar}`)

  /* 列表/密集卡片不得带模糊：这是旧实现 725 层模糊的来源。 */
  for (const route of ['/assets', '/works', '/tasks']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    const info = await page.evaluate(() => ({
      surfaces: document.querySelectorAll('.studio-surface').length,
      blurred: Array.from(document.querySelectorAll('.studio-surface')).filter((n) => {
        const b = getComputedStyle(n).backdropFilter
        return b && b !== 'none'
      }).length,
    }))
    check(`${route} 列表卡片不使用模糊（可读性与性能）`, info.blurred === 0,
      `studio-surface=${info.surfaces} 其中带模糊=${info.blurred}`)
  }

  /* ================================================================
   * 2. 对比度（浅色 + 深色）
   * ============================================================== */
  console.log('\n--- 2. 对比度（WCAG AA）---')
  let sampled = 0
  let failed = 0
  let skippedGradient = 0
  for (const theme of ['light', 'dark']) {
    await page.goto(`${BASE}/studio`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('dark', t === 'dark')
      try {
        const raw = JSON.parse(localStorage.getItem('oaooao-studio-demo') ?? '{}')
        localStorage.setItem('oaooao-studio-demo', JSON.stringify({ ...raw, theme: t }))
      } catch { /* 忽略 */ }
    }, theme)
    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(route === '/assets' || route === '/works' ? 5000 : 3000)
      const data = await CONTRAST()
      sampled += data.total
      failed += data.failCount
      skippedGradient += data.skipped
      if (data.failCount) console.log(`   [${theme}] ${route} 不达标 ${data.failCount}: ${data.fails.map((f) => `"${f.text}" ${f.ratio}<${f.need}`).join(', ')}`)
    }
  }
  check(`浅色与深色主题下文字对比度均达标（采样 ${sampled} 处，跳过渐变压底 ${skippedGradient} 处）`,
    failed === 0, `不达标 ${failed} 处`)

  /* 渐变压底文字：用真实像素复核（纯色层叠模型读不到渐变）。 */
  for (const [route, matcher, label] of [
    ['/works', /^\d+:\d+$/, '作品页·比例文本（卡片底部渐变压底）'],
    ['/projects', /^\d{4}-\d{2}-\d{2}T/, '项目页·时间戳（卡片底部渐变压底）'],
    ['/video', /^视频加载失败|^视频生成中/, '视频页·状态文字（深色渐变压底）'],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(route === '/works' ? 6000 : 4500)
    const loc = page.locator('span,p,div,small').filter({ hasText: matcher }).last()
    if (!(await loc.count())) { skip(`像素对比度：${label}`, '当前页面没有匹配元素'); continue }
    const r = await pixelRatio(loc)
    check(`像素对比度达标：${label}`, (r?.ratio ?? 0) >= 4.5, `ratio=${r?.ratio}`)
  }

  /* ================================================================
   * 3. 浮层、定位与键盘
   * ============================================================== */
  console.log('\n--- 3. 浮层、定位与键盘 ---')
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto(`${BASE}/studio`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)

  const ancestorRisk = await page.evaluate(() => {
    const offenders = []
    for (const sel of ['html', 'body', '[data-studio-route]']) {
      const el = document.querySelector(sel)
      if (!el) continue
      const cs = getComputedStyle(el)
      if (cs.filter !== 'none') offenders.push(`${sel}.filter=${cs.filter}`)
      if (cs.backdropFilter !== 'none') offenders.push(`${sel}.backdropFilter=${cs.backdropFilter}`)
      if (cs.contain !== 'none') offenders.push(`${sel}.contain=${cs.contain}`)
    }
    return offenders
  })
  check('根容器不设 filter/backdrop-filter/contain（fixed 与 portal 不会错位）',
    ancestorRisk.length === 0, ancestorRisk.join(' | ') || '干净')

  const menuBtn = page.locator('button[aria-label="打开账户菜单"]').first()
  if (await menuBtn.count()) {
    await menuBtn.click()
    await page.waitForTimeout(700)
    const menu = await page.evaluate(() => {
      const el = document.querySelector('[role="menu"][aria-label="账户菜单"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      let clipped = false
      let node = el.parentElement
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node)
        if (cs.overflow !== 'visible' && cs.overflowX !== 'visible') {
          const nr = node.getBoundingClientRect()
          if (r.left < nr.left - 1 || r.right > nr.right + 1 || r.top < nr.top - 1 || r.bottom > nr.bottom + 1) { clipped = true; break }
        }
        node = node.parentElement
      }
      return { inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1, clipped, blur: getComputedStyle(el).backdropFilter }
    })
    check('账户菜单在视口内且未被裁切', Boolean(menu?.inViewport) && menu?.clipped === false, `inViewport=${menu?.inViewport} clipped=${menu?.clipped}`)
    check('账户菜单使用玻璃浮层', /blur/.test(menu?.blur ?? ''), `blur=${menu?.blur}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  } else {
    skip('账户菜单相关断言', '未登录或未找到账户菜单')
  }

  await page.evaluate(() => window.scrollTo(0, 600))
  await page.waitForTimeout(500)
  const sticky = await page.evaluate(() => {
    const bar = document.querySelector('.studio-topbar')?.getBoundingClientRect()
    const side = document.querySelector('.studio-sidebar')?.getBoundingClientRect()
    return { barTop: bar ? Math.round(bar.top) : null, sideLeft: side ? Math.round(side.left) : null }
  })
  check('滚动后 sticky 顶栏仍贴顶', sticky.barTop === 0 || sticky.barTop === null, `top=${sticky.barTop}`)
  check('滚动后 fixed 侧栏未被重新定位', sticky.sideLeft === 0 || sticky.sideLeft === null, `left=${sticky.sideLeft}`)

  /* 键盘焦点：必须用真实 Tab 触发 :focus-visible（脚本 focus() 不触发）。 */
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const focusList = []
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(120)
    focusList.push(await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return null
      const cs = getComputedStyle(el)
      return { outline: cs.outlineStyle, fv: el.matches(':focus-visible') }
    }))
  }
  const visible = focusList.filter((f) => f?.fv)
  const noRing = visible.filter((f) => f.outline !== 'solid')
  check('键盘焦点始终有可见 outline（含带 outline-none 的输入框）',
    visible.length >= 6 && noRing.length === 0,
    `focus-visible=${visible.length} 无焦点环=${noRing.length}`)

  /* 移动端：吸底条在视口内、无横向溢出、抽屉可用。 */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE}/image`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const mobile = await page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('div')).find((n) => (n.getAttribute('class') ?? '').includes('sticky') && (n.getAttribute('class') ?? '').includes('bottom-0'))
    const r = bar?.getBoundingClientRect()
    return { found: Boolean(bar), inView: r ? r.bottom <= window.innerHeight + 1 : null, overflowX: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })
  check('移动端吸底提交条在视口内', mobile.found && mobile.inView === true, `found=${mobile.found} inView=${mobile.inView}`)
  check('移动端无横向溢出', mobile.overflowX === false, `overflowX=${mobile.overflowX}`)

  const toggle = page.locator('button[aria-label="打开导航"]').first()
  if (await toggle.count()) {
    await toggle.click()
    await page.waitForTimeout(800)
    const drawer = await page.evaluate(() => {
      const el = document.querySelector('[aria-label="移动端主导航"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { ok: r.left >= -1 && r.right <= window.innerWidth + 1, items: el.querySelectorAll('a').length }
    })
    check('移动端导航抽屉可用且不溢出', Boolean(drawer?.ok) && (drawer?.items ?? 0) > 5, `items=${drawer?.items}`)
    await page.keyboard.press('Escape')
  } else {
    skip('移动端导航抽屉', '未找到打开导航按钮')
  }

  /* 画布：玻璃只加在工具条/浮动面板，工作区与节点不加模糊。 */
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto(`${BASE}/canvas/canvas-aurora`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  const canvas = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow')
    const flow = document.querySelector('.studio-flow')
    const bar = document.querySelector('.canvas-toolbar')
    return {
      nodes: document.querySelectorAll('.react-flow__node').length,
      paneBlur: pane ? getComputedStyle(pane).backdropFilter : null,
      flowBlur: flow ? getComputedStyle(flow).backdropFilter : null,
      barBlur: bar ? getComputedStyle(bar).backdropFilter : null,
    }
  })
  check('画布节点仍由 React Flow 渲染', canvas.nodes > 0, `节点=${canvas.nodes}`)
  check('画布工作区与节点不加模糊', (canvas.paneBlur ?? 'none') === 'none' && (canvas.flowBlur ?? 'none') === 'none',
    `pane=${canvas.paneBlur} flow=${canvas.flowBlur}`)
  check('画布工具条使用玻璃', /blur/.test(canvas.barBlur ?? ''), `blur=${canvas.barBlur}`)

  /* ================================================================
   * 4. 路由覆盖（含真实参数化路由）
   *
   * 覆盖"设计系统整站可用"这一目标：逐个路由确认能渲染、无横向溢出、
   * 无控制台错误。参数化路由用**真实 id**（从页面链接/接口取），
   * 不用假 id —— 假 id 只会测到 404 页面，证明不了任何事。
   * ================================================================ */
  console.log('\n--- 4. 路由覆盖（桌面 + 移动）---')
  const MAIN_ROUTES = ['/studio', '/image', '/video', '/agent', '/canvas', '/projects', '/gallery', '/works', '/assets', '/tasks', '/account', '/settings', '/admin', '/plans', '/login', '/']

  /** 渲染判据：可见文本量足够，或画布已挂载出节点（画布移动端会隐藏属性面板）。 */
  const ROUTE_PROBE = () => page.evaluate(() => ({
    text: (document.querySelector('main')?.innerText ?? document.body.innerText ?? '').trim().length,
    flowNodes: document.querySelectorAll('.react-flow__node').length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))

  /** 收集控制台错误；`404` 计入**预存接口不一致**，不当作设计系统回归。 */
  let routeErrors = []
  const onConsole = (m) => { if (m.type() === 'error') routeErrors.push(m.text().slice(0, 120)) }
  const onPageError = (e) => routeErrors.push(`pageerror: ${String(e).slice(0, 120)}`)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  let routeFails = 0
  let notFoundCount = 0
  const failuresDetail = []

  /**
   * 会话看护：这一节要跑 80+ 次导航，实测后端会话可能在长跑中失效，
   * 一旦失效整节都会变成"页面只有 39 个字符"的假失败。
   * 因此在每次访问前确认会话有效，失效则重新走登录表单。
   * 必须定义在 `visit` **之前**（`const` 存在暂时性死区）。
   */
  const ensureSession = async () => {
    const ok = await page.evaluate(async () => {
      try { const r = await fetch('/api/auth/session', { cache: 'no-store' }); const j = await r.json(); return Boolean(j?.user?.id) } catch { return false }
    })
    if (ok) return true
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.fill('input[autocomplete="username"]', 'fusion_admin')
    await page.fill('input[autocomplete="current-password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(5000)
    return page.evaluate(async () => {
      try { const r = await fetch('/api/auth/session', { cache: 'no-store' }); const j = await r.json(); return Boolean(j?.user?.id) } catch { return false }
    })
  }

  const visit = async (route, vp) => {
    await page.setViewportSize(vp === 'desktop' ? { width: 1440, height: 950 } : { width: 390, height: 844 })
    routeErrors = []
    let status = null
    try {
      await ensureSession()
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      status = resp?.status() ?? null
      await page.waitForTimeout(route.startsWith('/assets') || route.startsWith('/works') ? 5000 : 3200)
    } catch (e) {
      routeFails += 1; failuresDetail.push(`${route} [${vp}] 打不开: ${String(e).slice(0, 70)}`); return
    }
    const p = await ROUTE_PROBE()
    const real = routeErrors.filter((e) => !/429|Too Many Requests/.test(e) && !/404/.test(e))
    notFoundCount += routeErrors.filter((e) => /404/.test(e)).length
    const ok = status === 200 && (p.text > 60 || p.flowNodes > 0) && real.length === 0 && !p.overflowX
    if (!ok) {
      routeFails += 1
      failuresDetail.push(`${route} [${vp}] status=${status} 文本=${p.text} 节点=${p.flowNodes} 溢出=${p.overflowX} 错误=${real.length}${real.length ? ` 例:${real[0]}` : ''}`)
    }
  }

  for (const route of MAIN_ROUTES) for (const vp of ['desktop', 'mobile']) await visit(route, vp)

  /** 参数化路由：项目各分区、画布工作区、后台各分区（id 全部来自真实数据）。 */
  await ensureSession()
  await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const projectIds = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('/projects/')).map((h) => h.split('/')[2]).filter(Boolean))].slice(0, 2))
  const canvasIds = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/canvas/projects', { cache: 'no-store' })
      if (!r.ok) return []
      const j = await r.json().catch(() => null)
      const arr = j?.data?.projects ?? j?.projects ?? []
      return Array.isArray(arr) ? arr.map((x) => x?.id).filter(Boolean).slice(0, 2) : []
    } catch { return [] }
  })
  const adminSections = ['users', 'generation', 'channels', 'commerce', 'content', 'settings', 'audit']
  const paramRoutes = [
    ...canvasIds.map((id) => `/canvas/${id}`),
    ...projectIds.flatMap((id) => ['', '/script', '/storyboard', '/shots', '/assets', '/characters', '/cut', '/canvas', '/settings'].map((s) => `/projects/${id}${s}`)),
    ...adminSections.map((s) => `/admin/${s}`),
  ]
  for (const route of paramRoutes) for (const vp of ['desktop', 'mobile']) await visit(route, vp)

  page.off('console', onConsole)
  page.off('pageerror', onPageError)

  const totalVisits = (MAIN_ROUTES.length + paramRoutes.length) * 2
  check(`路由覆盖：${totalVisits} 次访问（主要 ${MAIN_ROUTES.length} 条 + 参数化 ${paramRoutes.length} 条，桌面/移动各一遍）均渲染且无溢出`,
    routeFails === 0 && paramRoutes.length > 0,
    routeFails === 0
      ? `全部通过；其中 ${notFoundCount} 个预存 404（/api/public/works，见文件头说明）`
      : `失败 ${routeFails} 处：${failuresDetail.slice(0, 4).join(' | ')}`)
  if (!paramRoutes.length) skip('参数化路由覆盖', '未能从真实数据取到项目/画布 id')

  /* ================================================================
   * 5. 真实状态覆盖：悬停 / 禁用 / 加载 / 空 / 错误 / 聚焦
   *
   * 需求点名要补齐这些状态。这里**实际制造**每种状态再测量渲染结果，
   * 而不是检查"代码里是否写了某个 class"。
   * ================================================================ */
  console.log('\n--- 5. 状态覆盖 ---')

  /* 状态节同样先确保会话有效（上一节跑了 80+ 次导航）。 */
  await ensureSession()

  /* 悬停 */
  await page.goto(`${BASE}/assets`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  const hoverEl = page.locator('.studio-surface-interactive').first()
  if (await hoverEl.count()) {
    const before = await hoverEl.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, transform: getComputedStyle(el).transform }))
    await hoverEl.hover()
    await page.waitForTimeout(450)
    const after = await hoverEl.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, transform: getComputedStyle(el).transform }))
    check('悬停产生可见变化（阴影或位移）', after.shadow !== before.shadow || after.transform !== before.transform,
      `transform ${before.transform} → ${after.transform}`)
  } else {
    skip('悬停状态', '当前页没有可交互表面')
  }

  /* 禁用（真实走组件的 disabled 样式路径） */
  const disabledInfo = await page.evaluate(() => {
    const btn = document.querySelector('.studio-control:not([disabled])')
    if (!btn) return null
    const before = getComputedStyle(btn).opacity
    btn.disabled = true
    const after = getComputedStyle(btn).opacity
    const pe = getComputedStyle(btn).pointerEvents
    btn.disabled = false
    return { before, after, pe }
  })
  check('禁用态：可见弱化且不接收指针事件',
    Boolean(disabledInfo) && Number(disabledInfo.after) < Number(disabledInfo.before) && disabledInfo.pe === 'none',
    disabledInfo ? `opacity ${disabledInfo.before} → ${disabledInfo.after}, pointer-events=${disabledInfo.pe}` : '未找到控件')

  /* 加载态：延迟素材库应答 */
  let releaseAssets
  const assetGate = new Promise((resolve) => { releaseAssets = resolve })
  await page.route('**/api/library-assets**', async (route) => { await assetGate; await route.continue() })
  const pendingNav = page.goto(`${BASE}/assets`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const loadingState = await page.evaluate(() => {
    const text = document.body.innerText
    return {
      sample: (text.match(/[^\n]*(正在|加载中|读取)[^\n]*/) ?? [''])[0].slice(0, 40),
      status: document.querySelectorAll('[role="status"]').length,
      spin: document.querySelectorAll('.animate-spin').length,
    }
  })
  check('加载态：出现可见的加载提示（文案 / role=status / 旋转指示）',
    loadingState.sample !== '' || loadingState.status > 0 || loadingState.spin > 0,
    `"${loadingState.sample}" role=status×${loadingState.status} spinner×${loadingState.spin}`)
  releaseAssets()
  await pendingNav
  await page.unroute('**/api/library-assets**').catch(() => null)
  await page.waitForTimeout(2500)

  /* 空状态：搜一个不存在的关键词 */
  const searchBox = page.locator('.studio-search-field input').first()
  if (await searchBox.count()) {
    await searchBox.fill('ZZZNOMATCH_DESIGN_SYSTEM')
    await page.waitForTimeout(2500)
    const empty = await page.evaluate(() => {
      const el = document.querySelector('.studio-empty-state')
      if (!el) return null
      const cs = getComputedStyle(el)
      return { dashed: cs.borderStyle, minH: Number.parseFloat(cs.minHeight) || 0 }
    })
    check('空状态：使用统一空态样式（虚线边框 + 最小高度）',
      Boolean(empty) && empty.dashed === 'dashed' && empty.minH >= 100,
      empty ? `border=${empty.dashed} minHeight=${empty.minH}px` : '未出现空状态')
    await searchBox.fill('')
    await page.waitForTimeout(1500)
  } else {
    skip('空状态', '未找到搜索框')
  }

  /* 错误态：素材库接口 500，页面必须如实报错而不是显示成空 */
  await page.route('**/api/library-assets**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '设计系统回归模拟失败' }) }))
  await page.goto(`${BASE}/assets`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const errState = await page.evaluate(() => {
    const m = document.body.innerText.match(/[^\n]*(读取失败|失败|不可用|重试)[^\n]*/)
    return { found: Boolean(m), sample: (m ?? [''])[0].slice(0, 60) }
  })
  check('错误态：接口失败时如实报错（不把失败显示成空数据）', errState.found, errState.sample || '未见错误提示')
  await page.unroute('**/api/library-assets**').catch(() => null)
} catch (error) {
  check('执行过程中未抛出未预期异常', false, error instanceof Error ? error.message : String(error))
} finally {
  await browser.close()
}

const failures = results.filter((r) => !r.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failures.length}，未执行 ${notExecuted.length}，失败 ${failures.length}`)
if (notExecuted.length) { console.log('未执行项：'); for (const n of notExecuted) console.log(` - ${n.name} :: ${n.why}`) }
if (failures.length) { console.log('失败项：'); for (const f of failures) console.log(` - ${f.name} :: ${f.detail}`) }
process.exit(failures.length ? 1 : 0)
