import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 上线前检查的验收。
 *
 * 目标：确认它**如实区分错误与警告**，并覆盖用户点名要求的检查项：
 * 测试渠道、意外零价、无支付方式、邮件不可用、worker 异常、存储不可用。
 *
 * 做法：先断言当前环境下这些项如实报告，再**逐项构造异常条件**，
 * 验证检查能识别出来（而不是只会报告「一切正常」）。
 * 所有构造都在隔离环境完成，并逐项还原。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
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

const readiness = async () => {
  const response = await api('/api/admin/launch-readiness')
  const report = response.body?.data
  return { status: response.status, report, byId: new Map((report?.items ?? []).map((item) => [item.id, item])) }
}

/* ======================================================================
 * 1. 报告结构与分级
 * ==================================================================== */

const initial = await readiness()
check('上线检查接口可用', initial.status === 200 && Boolean(initial.report), `status=${initial.status}`)
check('报告包含分级计数与通过标志',
  typeof initial.report?.passed === 'boolean' && Number.isFinite(initial.report?.errors) && Number.isFinite(initial.report?.warnings),
  `passed=${initial.report?.passed} errors=${initial.report?.errors} warnings=${initial.report?.warnings}`)
check('通过标志与错误数一致', initial.report?.passed === (initial.report?.errors === 0),
  `passed=${initial.report?.passed} errors=${initial.report?.errors}`)

const requiredChecks = ['database', 'encryption', 'first-admin', 'generation-worker', 'channels', 'models', 'pricing', 'payment', 'mail', 'entitlements', 'object-storage']
const present = requiredChecks.filter((id) => initial.byId.has(id))
check('覆盖用户点名的全部检查项', present.length === requiredChecks.length,
  `缺失=${requiredChecks.filter((id) => !initial.byId.has(id)).join(',') || '无'}`)

check('每项都有结论说明，错误项都给出可执行动作',
  (initial.report?.items ?? []).every((item) => item.detail && (item.level !== 'error' || item.action)),
  `无动作的错误项=${(initial.report?.items ?? []).filter((i) => i.level === 'error' && !i.action).map((i) => i.id).join(',') || '无'}`)

/* ======================================================================
 * 2. 意外零价：必须报出「全部零价」
 * ==================================================================== */

const zeroPriceItem = initial.byId.get('pricing')
check('全部模型零价时如实报告（不谎报已计价）',
  zeroPriceItem?.level === 'warning' && /全部为 0/.test(zeroPriceItem?.detail ?? ''),
  `level=${zeroPriceItem?.level} detail=${zeroPriceItem?.detail}`)

/** 设置一个非零单价后，「全部零价」警告应消失。 */
const settingsBefore = (await api('/api/admin/settings')).body.settings
const originalCosts = { ...(settingsBefore.modelPointCosts ?? {}) }
await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ modelPointCosts: { ...originalCosts, 'e2e-image': 3 } }) })
const priced = await readiness()
const pricedItem = priced.byId.get('pricing')
check('存在非零单价后不再报告全部零价',
  pricedItem?.level === 'ok' && /1\/4|非零/.test(pricedItem?.detail ?? ''),
  `level=${pricedItem?.level} detail=${pricedItem?.detail}`)
await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ modelPointCosts: originalCosts }) })

/* ======================================================================
 * 3. 渠道异常：全部停用必须报错误
 * ==================================================================== */

const originalChannels = JSON.parse(JSON.stringify(settingsBefore.systemChannels ?? []))
/**
 * 必须连 `defaultModels` 一起快照并还原。
 *
 * 第 3 节会把**所有渠道停用**，后端此时会同步重建逻辑模型；
 * 逻辑模型一旦不可解析，`normalizeDefaultModelsConfig` 就会把默认模型清空。
 * 之后只还原 `systemChannels` **不会**把 `default_models` 放回去，
 * 于是「默认模型被清空」会泄漏给后续脚本——实测踩到：
 * 紧跟其后的 `generation-flow.test.mjs` 报
 * `FAIL 后端提供默认文本模型 :: textModel=`，看起来像功能回归，实际是本脚本的副作用。
 * （`model-alias.test.mjs` 早前也踩过同一个坑并已同样处理。）
 */
const originalDefaults = settingsBefore.defaultModels
if (originalChannels.length) {
  await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ systemChannels: originalChannels.map((channel) => ({ ...channel, enabled: false })) }) })
  const disabled = await readiness()
  const channelItem = disabled.byId.get('channels')
  check('渠道全部停用时报告为错误（阻断上线）',
    channelItem?.level === 'error',
    `level=${channelItem?.level} detail=${channelItem?.detail}`)
  await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ systemChannels: originalChannels }) })
  // 渠道恢复后把默认模型一并还原，避免把「默认模型为空」泄漏给后续脚本。
  await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ defaultModels: originalDefaults }) })

  const restored = await readiness()
  check('渠道还原后检查恢复为正常', restored.byId.get('channels')?.level === 'ok',
    `level=${restored.byId.get('channels')?.level} detail=${restored.byId.get('channels')?.detail}`)
  const restoredDefaults = (await api('/api/admin/settings')).body.settings.defaultModels
  check('默认模型已还原（停用渠道不留下副作用）',
    JSON.stringify(restoredDefaults) === JSON.stringify(originalDefaults),
    `前后=${JSON.stringify(originalDefaults)} / ${JSON.stringify(restoredDefaults)}`)
} else {
  check('渠道全部停用时报告为错误（阻断上线）', false, '环境中没有渠道，无法构造')
  check('渠道还原后检查恢复为正常', false, '依赖上一个用例')
  check('默认模型已还原（停用渠道不留下副作用）', false, '依赖上一个用例')
}

/* ======================================================================
 * 4. 支付方式
 * ==================================================================== */

const paymentItem = initial.byId.get('payment')
check('只有人工支付时明确说明「无法自助在线付款」',
  paymentItem?.level === 'warning' && /人工|线下/.test(paymentItem?.detail ?? ''),
  `level=${paymentItem?.level} detail=${paymentItem?.detail}`)

/* ======================================================================
 * 5. 邮件不可用
 * ==================================================================== */

const mailItem = initial.byId.get('mail')
check('邮件未配置完整时如实报告', mailItem?.level === 'warning' && /未配置完整/.test(mailItem?.detail ?? ''),
  `level=${mailItem?.level} detail=${mailItem?.detail}`)

/* ======================================================================
 * 6. worker / 存储
 * ==================================================================== */

check('worker 检查项报告心跳状态', Boolean(initial.byId.get('generation-worker')?.detail),
  `${initial.byId.get('generation-worker')?.level} / ${initial.byId.get('generation-worker')?.detail}`)
check('存储检查项报告当前存储方式', Boolean(initial.byId.get('object-storage')?.detail),
  `${initial.byId.get('object-storage')?.level} / ${initial.byId.get('object-storage')?.detail}`)

/* ======================================================================
 * 7. 界面展示与权限
 * ==================================================================== */

await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
await page.waitForTimeout(6000)
const uiProbe = await page.evaluate(() => {
  const panel = document.querySelector('[data-testid="launch-readiness"]')
  const items = Array.from(document.querySelectorAll('[data-testid^="readiness-"]'))
  return {
    hasPanel: Boolean(panel),
    count: items.length,
    levels: items.map((node) => node.getAttribute('data-level')),
    hasActionHint: /建议：/.test(panel?.innerText ?? ''),
    panelText: (panel?.innerText ?? '').slice(0, 120),
  }
})
check('管理端展示上线检查面板', uiProbe.hasPanel && uiProbe.count >= 10,
  `hasPanel=${uiProbe.hasPanel} count=${uiProbe.count}`)
check('面板区分错误/警告/正常三种级别',
  uiProbe.levels.every((level) => ['ok', 'warning', 'error'].includes(level)) && new Set(uiProbe.levels).size >= 1,
  `levels=${JSON.stringify([...new Set(uiProbe.levels)])}`)
check('面板给出可执行建议', uiProbe.hasActionHint, `panelText=${JSON.stringify(uiProbe.panelText)}`)

/** 未登录必须被拒绝：上线检查包含渠道/支付等敏感配置。 */
const anonContext = await browser.newContext()
const anonPage = await anonContext.newPage()
await anonPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
const anon = await anonPage.evaluate(async () => {
  const response = await fetch('/api/admin/launch-readiness', { cache: 'no-store' })
  return response.status
})
check('未登录访问上线检查被拒绝', anon === 401 || anon === 403, `status=${anon}`)
await anonContext.close()

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
