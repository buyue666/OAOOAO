import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 问题 1 回归：跨账号迟到响应污染（真实浏览器 + 受控响应延迟）。
 *
 * 复现步骤（全部在**同一个 document** 内完成，不整页刷新——
 * `page.goto()` 会重建 document、丢弃在途 fetch，那样测不出迟到响应）：
 *   1. A 登录，在图片工作台提交一次生成，但拦截该 POST 的**响应**并挂起；
 *   2. A 通过**界面右上角账户菜单 →「退出登录」**退出（客户端路由到 /login）；
 *   3. B 通过**登录表单**登录（同一个 document，StudioProvider 保持存活）；
 *   4. 客户端导航到 /image，此时释放 A 的响应（503 / 401 / abort / 成功 四种）；
 *   5. 检查 B 的界面、缓存、余额与「重新提交」实际发出的参数。
 *
 * 判定标准（B 不得看到 / 继承 A 的任何东西）：
 *   - 界面：不出现 A 的提示词、不出现「提交结果未确认」、不出现「重新提交」入口；
 *   - 缓存：`oaooao-live-tasks-pending:<B>` 为空，且任何缓存都不含 A 的提示词、
 *     也不属于 A 的账号键；
 *   - 余额：B 的 `/api/points` 与界面积分不被 A 的响应改写；
 *   - 参数：不存在「重新提交」按钮（也就不会发出 A 的原提示词）。
 *
 * 本脚本同时是**带牙齿的负向对照**：把 `generation-store.tsx` 中 `submit`
 * 的 `catch` 守卫改成 `if (false && !stillCurrent())` 后重跑，必须看到
 * 「未确认文案 / 重新提交入口 / 缓存含 A 提示词」这些断言变成 FAIL
 * （实测已确认，见 COMMERCIAL_READINESS.md）。没有这一步，
 * 全 PASS 只能说明「没测到」，不能说明「守卫生效」。
 *
 * 说明：本脚本是**真实本地接口 + 真实浏览器**测试。
 * 上游模型的返回由本地 mock 上游（127.0.0.1:4021）提供，但提交、会话、
 * 积分、缓存、路由全部是真实实现；被挂起的响应是测试用 `route.fulfill`
 * 构造的受控延迟，用于复现「响应迟到」，不代表真实上游行为。
 */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const USER_A = 'fusion_admin'
const PASS_A = TEST_PASSWORD
const ARTIFACTS = new URL('./.artifacts/', import.meta.url)
const ACCOUNT_FILE = new URL('./.sessions/leak-b-account.json', import.meta.url)
const MODE = process.argv[2] || '503'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const browser = await chromium.launch()
let page
try {
  const session = await authenticatedContext(browser, { base: BASE, username: USER_A, password: PASS_A })
  page = session.page
  console.log(`[会话] ${session.reused ? '复用已登录会话' : '已登录'}`)
} catch (error) {
  if (error.throttled) { await browser.close(); exitThrottled(error.message) }
  throw error
}

/** A 的专属标记：出现在提示词里，便于判断它是否泄漏到 B。 */
const MARK_A = `LEAKA${Date.now().toString(36).toUpperCase()}`

const cacheProbe = () => page.evaluate(() => {
  const out = { keys: [], pendingCount: 0, taskCount: 0, raw: {} }
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith('oaooao-live-tasks')) continue
    out.keys.push(key)
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '[]')
      const size = Array.isArray(parsed) ? parsed.length : 0
      if (key.includes('-pending')) out.pendingCount += size
      else out.taskCount += size
      out.raw[key] = JSON.stringify(parsed).slice(0, 400)
    } catch { /* ignore */ }
  }
  return out
})

const uiProbe = (mark) => page.evaluate((needle) => {
  const text = document.body.innerText
  return {
    seesMark: text.includes(needle),
    hasUnconfirmed: /提交未确认|提交结果未确认/.test(text),
    hasResubmit: /重新提交/.test(text),
    pointsText: (text.match(/[\d,]+\s*积分/) || [''])[0],
    excerpt: (text.match(/[^\n]*未确认[^\n]*/) || [''])[0].slice(0, 140),
  }
}, mark)

/**
 * 余额探针：走真实 `/api/auth/session`（其中 `user.pointsBalance` 就是
 * 界面积分的来源，见 `lib/studio/session.ts`）。
 */
const balanceProbe = async () => {
  const response = await page.request.get(`${BASE}/api/auth/session`)
  const payload = await response.json().catch(() => null)
  return { status: response.status(), userId: payload?.user?.id ?? null, balance: payload?.user?.pointsBalance ?? null }
}

/* ======================================================================
 * 准备：A 登录后进入图片工作台，挂起创建请求的响应
 * ==================================================================== */

await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

let holdCreate = true
let heldCount = 0
await page.route('**/api/image-tasks', async (route) => {
  if (route.request().method() !== 'POST' || !holdCreate) { await route.continue(); return }
  heldCount += 1
  // 真实发出请求（后端会真的收到），只把响应挂起。
  let realBody = null
  try { realBody = await (await route.fetch()).text() } catch { /* 忽略：仍按受控模式返回 */ }
  await page.waitForFunction(() => Boolean(window.__lateMode), null, { timeout: 90000 }).catch(() => null)
  const mode = await page.evaluate(() => window.__lateMode)
  try {
    if (mode === 'abort') { await route.abort('failed'); return }
    if (mode === 'real') { await route.fulfill({ status: 200, contentType: 'application/json', body: realBody ?? '{}' }); return }
    await route.fulfill({
      status: mode === '503' ? 503 : mode === '401' ? 401 : 200,
      contentType: 'application/json',
      body: JSON.stringify(mode === '200'
        ? { task: { id: `leak-task-${Date.now()}`, kind: 'generation', status: 'pending', model: 'e2e-image' } }
        : { error: mode === '401' ? '请先登录' : '服务暂时不可用' }),
    })
  } catch (error) {
    console.log(`[受控延迟] 释放 ${mode} 时路由已被页面处理：${error.message.split('\n')[0]}`)
  }
})

/* ---- 步骤 1：A 提交（响应被挂起） ---- */
await page.fill('textarea', `${MARK_A} 跨账号迟到响应复现`)
await page.waitForTimeout(700)
await page.locator('button:has-text("立即生成"), button:has-text("生成")').first().click()
await page.waitForTimeout(2500)
console.log(`[A 提交后] 挂起请求数=${heldCount} 缓存键=${JSON.stringify((await cacheProbe()).keys)}`)

/* ---- 步骤 2：A 通过**界面**退出（客户端路由，不整页刷新） ---- */
const accountButton = page.locator('button[aria-label*="账户"], button:has-text("fusion_admin")').first()
if (await accountButton.count()) { await accountButton.click(); await page.waitForTimeout(1200) }
const signOut = page.locator('button:has-text("退出登录")').first()
if (!(await signOut.count())) throw new Error('界面未找到「退出登录」入口，无法走真实退出路径')
await signOut.click()
await page.waitForTimeout(4500)
const afterLogoutUser = await page.evaluate(async () => (await (await fetch('/api/auth/session', { cache: 'no-store' })).json())?.user?.id ?? null)
console.log(`[A 已通过界面退出] url=${page.url()} 会话=${afterLogoutUser}`)

/* ---- 步骤 3：B 通过**登录表单**登录（同一个 document） ---- */
let account = existsSync(ACCOUNT_FILE) ? JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8')) : null
let bRegisteredStatus = null
if (!account) {
  const username = `leak_${Date.now().toString(36)}`
  const registered = await page.evaluate(async ({ username }) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'LeakTest!2026', policyAccepted: true }),
    })
    return { status: response.status, body: (await response.text()).slice(0, 160) }
  }, { username })
  bRegisteredStatus = registered.status
  console.log(`[B 注册] status=${registered.status} ${registered.body}`)
  if (registered.status !== 200) {
    await browser.close()
    console.log('\n[环境] 无法建立第二个账号，本轮无法验证跨账号隔离。')
    process.exit(2)
  }
  account = { username, password: 'LeakTest!2026' }
  mkdirSync(new URL('./.sessions/', import.meta.url), { recursive: true })
  writeFileSync(ACCOUNT_FILE, JSON.stringify(account), 'utf8')
} else {
  console.log(`[B 复用已注册账号] ${account.username}`)
}

await page.waitForSelector('input[autocomplete="username"]', { timeout: 20000 })
await page.fill('input[autocomplete="username"]', account.username)
await page.fill('input[autocomplete="current-password"]', account.password)
await page.click('button[type="submit"]')
await page.waitForTimeout(6000)
const bUser = await page.evaluate(async () => (await (await fetch('/api/auth/session', { cache: 'no-store' })).json())?.user?.id ?? null)
console.log(`[B 界面登录] url=${page.url()} 会话=${bUser}`)
if (!bUser) {
  const formError = await page.evaluate(() => (document.body.innerText.match(/[^\n]*(失败|频繁|错误|不正确)[^\n]*/) || [''])[0])
  console.log(`[B 登录失败原因] ${formError.slice(0, 160)}`)
}
/** B 登录后的余额基线：释放 A 的迟到响应之后必须完全一致。 */
const pointsBefore = await balanceProbe()

/* ---- 步骤 4：客户端导航到工作台，然后释放 A 的迟到响应 ---- */
const nav = page.locator('a[href="/image"]').first()
if (await nav.count()) { await nav.click(); await page.waitForTimeout(4000) }
console.log(`[准备释放] url=${page.url()} 挂起请求数=${heldCount} 当前账号=${bUser}`)
await page.evaluate((mode) => { window.__lateMode = mode }, MODE)
await page.waitForTimeout(8000)

/* ---- 步骤 5：断言 B 不受污染 ---- */
const bUi = await uiProbe(MARK_A)
const bCache = await cacheProbe()
const pointsAfter = await balanceProbe()
console.log(`[释放 ${MODE} 后] seesMark=${bUi.seesMark} hasUnconfirmed=${bUi.hasUnconfirmed} hasResubmit=${bUi.hasResubmit}`)
console.log(`[释放 ${MODE} 后] 缓存键=${JSON.stringify(bCache.keys)} 未确认=${bCache.pendingCount} 任务=${bCache.taskCount}`)
console.log(`[释放 ${MODE} 后] 余额 ${JSON.stringify(pointsBefore)} → ${JSON.stringify(pointsAfter)}`)
if (bUi.excerpt) console.log(`[释放 ${MODE} 后] 未确认文案：${bUi.excerpt}`)

/**
 * 截图证据。
 *
 * 注意：纯 `fullPage` 截图**不足以**作为本项的判别证据——守卫关闭与开启两次
 * 运行曾产出**哈希完全相同**的 PNG。原因是污染提示渲染在页面下方，
 * 固定视口的截图未必包含它，于是「有污染」和「无污染」看起来一模一样。
 *
 * 因此这里把待证事实直接渲染成一行**视口内**的高对比度横幅再截图：
 * 若 B 被污染，横幅文字会变成污染文案并配上 FAIL 配色；否则是 CLEAN。
 * 同时输出该横幅在 DOM 中的实际文本，截图与断言指向同一事实。
 */
const evidence = await page.evaluate((needle) => {
  const text = document.body.innerText
  const contaminated = /提交未确认|提交结果未确认/.test(text) || /重新提交/.test(text) || text.includes(needle)
  const banner = document.createElement('div')
  banner.id = 'late-evidence-banner'
  banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:18px 22px;font:600 20px/1.4 system-ui;white-space:pre-wrap;color:#000;background:${contaminated ? '#ff4d4f' : '#52c41a'}`
  banner.textContent = `${contaminated ? 'FAIL 污染' : 'CLEAN 未污染'}｜账号B≠账号A｜未确认入口=${/重新提交/.test(text) ? '有' : '无'}｜A标记泄漏=${text.includes(needle) ? '是' : '否'}`
  document.body.appendChild(banner)
  return { contaminated, bannerText: banner.textContent }
}, MARK_A)
await page.waitForTimeout(600)

mkdirSync(ARTIFACTS, { recursive: true })
const shotPath = fileURLToPath(new URL(`P1-late-${MODE}-evidence.png`, ARTIFACTS))
await page.screenshot({ path: shotPath, fullPage: false })
const shotHash = createHash('sha256').update(readFileSync(shotPath)).digest('hex').slice(0, 16)
console.log(`[截图] ${shotPath} sha256=${shotHash}`)
console.log(`[截图横幅] ${evidence.bannerText}`)

check('B 已登录（前置条件）', Boolean(bUser) && bUser !== afterLogoutUser, `bUser=${bUser} aUser=${afterLogoutUser}`)
check('A 的请求确实被挂起过（前置条件）', heldCount === 1, `heldCount=${heldCount}`)
check('截图横幅与断言一致（证据自洽）', evidence.contaminated === (bUi.hasUnconfirmed || bUi.hasResubmit || bUi.seesMark), `banner=${evidence.contaminated} ui=${bUi.hasUnconfirmed || bUi.hasResubmit || bUi.seesMark} text=${evidence.bannerText}`)
check('B 界面看不到 A 的提示词', !bUi.seesMark, `seesMark=${bUi.seesMark}`)
check(`B 界面不出现 A 的未确认任务（${MODE}）`, !bUi.hasUnconfirmed, `hasUnconfirmed=${bUi.hasUnconfirmed} excerpt=${bUi.excerpt}`)
check(`B 不出现 A 的「重新提交」入口（${MODE}）`, !bUi.hasResubmit, `hasResubmit=${bUi.hasResubmit}`)
check('B 的未确认缓存为空', bCache.pendingCount === 0, `pendingCount=${bCache.pendingCount} raw=${JSON.stringify(bCache.raw).slice(0, 200)}`)
check('B 的任务缓存不含 A 的提示词', !JSON.stringify(bCache.raw).includes(MARK_A), `raw=${JSON.stringify(bCache.raw).slice(0, 200)}`)
check('缓存中不存在 A 的账号键', !bCache.keys.some((key) => key.includes('a3929e69-41bc-4950-9aed-6bcceb009737')), `keys=${JSON.stringify(bCache.keys)}`)
check('B 的余额未被 A 的迟到响应改写', pointsBefore.balance === pointsAfter.balance && pointsAfter.userId === bUser, `before=${pointsBefore.balance} after=${pointsAfter.balance} afterUser=${pointsAfter.userId}`)

await page.unroute('**/api/image-tasks')
await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
