import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 未确认提交（响应丢失）的可见恢复验收。
 *
 * 复现用户报告的现象：
 *   ① 创建接口返回 503 后，页面显示「提交结果未确认」，但找不到「重新提交」按钮；
 *   ② 刷新后缓存仍有记录，但连未确认提示都消失。
 *
 * 验收目标（必须端到端通过）：
 *   「服务器接受请求但响应丢失 → 刷新 → 点击恢复」
 *   且**只产生一个任务、只扣一次费**。
 *
 * 做法：先让真实请求抵达后端，再把响应替换为 503（模拟响应丢失），
 * 因此后端确实创建了任务；随后按原 clientRequestId 恢复，应返回同一任务。
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

/* ============ 准备：让图片工作台可用于真实提交 ============ */

await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

// 记录基线：任务总数与积分流水条数，用于最后断言「只有一个任务、一次扣费」。
const baseline = await page.evaluate(async () => {
  const logs = await (await fetch('/api/generation-logs?page=1&pageSize=1', { cache: 'no-store' })).json()
  const points = await (await fetch('/api/points?page=1&pageSize=1', { cache: 'no-store' })).json()
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
  return { logs: logs?.total ?? 0, points: points?.total ?? 0, balance: Number(session?.user?.pointsBalance ?? 0) }
})
console.log(`[基线] 生成记录 ${baseline.logs} 条，积分流水 ${baseline.points} 条，余额 ${baseline.balance}`)

/* ============ ① 响应丢失：请求到达后端，响应被替换为 503 ============ */

const marker = `LOST-${Date.now()}`
let capturedRequestId = ''
/** 只对本次提交的目标 prompt 生效，避免影响其他请求。 */
await page.route('**/api/image-tasks', async (route) => {
  if (route.request().method() !== 'POST') return route.continue()
  const body = route.request().postData() || ''
  if (!body.includes(marker)) return route.continue()
  capturedRequestId = route.request().headers()['x-vozeb-pro-client-request-id'] || ''
  // 让请求真实抵达后端（服务端会创建任务），然后把响应替换为 503。
  const response = await route.fetch()
  const created = await response.json().catch(() => null)
  if (created?.task?.id) console.log(`[复现] 服务端已创建任务 ${String(created.task.id).slice(0, 8)}，但响应将丢失`)
  await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟网关故障，响应丢失' }) })
})

await page.fill('textarea#image-prompt', marker)
await page.locator('button[type="submit"]').first().click({ force: true }).catch(() => null)
await page.waitForTimeout(9000)
await page.unroute('**/api/image-tasks')

check('提交携带幂等标识', Boolean(capturedRequestId), `header=${capturedRequestId || '未捕获'}`)

/* ============ ② 未确认提示可见，且提供可点击的恢复入口 ============ */

await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const tasksText = await page.locator('body').innerText()
check('页面显示「提交结果未确认」', /提交结果未确认/.test(tasksText), (tasksText.match(/[^\n]*提交结果未确认[^\n]*/) || ['未找到'])[0].slice(0, 80))
check('未确认任务出现在可见任务列表', tasksText.includes(marker), tasksText.includes(marker) ? '占位任务已展示' : '未确认任务未进入可见列表')

const resubmitButton = page.getByRole('button', { name: '重新提交' })
const resubmitCount = await resubmitButton.count()
check('提供「重新提交」按钮（上一轮缺失）', resubmitCount > 0, `找到 ${resubmitCount} 个`)
check('未确认任务不提供「重新检查」（无服务器 ID）', !/重新检查/.test(tasksText) || !/\u672a\u786e\u8ba4[\s\S]{0,200}重新检查/.test(tasksText), '未确认占位未暴露无效的重新检查')

// 确认未确认记录已写入缓存（用于刷新恢复）。
const cacheBefore = await page.evaluate(() => {
  const key = Object.keys(window.localStorage).find((item) => item.startsWith('oaooao-live-tasks-pending:'))
  if (!key) return null
  const raw = JSON.parse(window.localStorage.getItem(key) || '[]')
  return { key, count: raw.length, first: raw[0]?.clientRequestId ?? null }
})
check('未确认提交已持久化到缓存', Boolean(cacheBefore) && cacheBefore.count > 0, JSON.stringify(cacheBefore))
check('缓存的标识与提交时一致', cacheBefore?.first === capturedRequestId, `cache=${cacheBefore?.first} header=${capturedRequestId}`)

/* ============ ③ 刷新后仍然可见、可操作 ============ */

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const afterReloadText = await page.locator('body').innerText()
check('刷新后仍显示提交未确认', /提交结果未确认/.test(afterReloadText), afterReloadText.includes('提交结果未确认') ? '恢复入口保留' : '刷新后未确认提示消失（上一轮缺陷）')
const afterReloadCount = await page.getByRole('button', { name: '重新提交' }).count()
check('刷新后仍有「重新提交」按钮', afterReloadCount > 0, `找到 ${afterReloadCount} 个`)

/* ============ ④ 点击恢复：复用原标识，只产生一个任务 ============ */

if (afterReloadCount > 0) {
  await page.getByRole('button', { name: '重新提交' }).first().click()
  await page.waitForTimeout(9000)
  const afterResubmit = await page.locator('body').innerText()
  // 恢复成功后未确认占位必须消失。
  check('恢复后未确认提示消失', !/提交结果未确认/.test(afterResubmit), afterResubmit.includes('提交结果未确认') ? '仍然显示未确认' : '已确认为真实任务')
} else {
  check('恢复后未确认提示消失', false, '缺少恢复按钮，无法执行恢复')
}

/* ============ ⑤ 服务端只产生一个任务、一次扣费 ============ */

const after = await page.evaluate(async () => {
  const logs = await (await fetch('/api/generation-logs?page=1&pageSize=20', { cache: 'no-store' })).json()
  const points = await (await fetch('/api/points?page=1&pageSize=1', { cache: 'no-store' })).json()
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
  return { logs: logs?.total ?? 0, points: points?.total ?? 0, balance: Number(session?.user?.pointsBalance ?? 0) }
})

// 用原标识再提交一次，必须返回同一任务（证明服务端幂等生效且我们复用了原标识）。
const idempotency = await page.evaluate(async ({ requestId }) => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
  const model = (session?.settings?.logicalModels || []).find((item) => item.capability === 'image' && item.enabled)
  const headers = { 'Content-Type': 'application/json', 'x-vozeb-pro-client-request-id': requestId }
  const body = JSON.stringify({ prompt: requestId, config: { model: model.id, size: '1:1', quality: 'auto' }, kind: 'generation', source: 'image-workbench' })
  const first = await (await fetch('/api/image-tasks', { method: 'POST', headers, body })).json().catch(() => null)
  const second = await (await fetch('/api/image-tasks', { method: 'POST', headers, body })).json().catch(() => null)
  return { first: first?.task?.id ?? null, second: second?.task?.id ?? null }
}, { requestId: capturedRequestId })
check('原标识重复提交返回同一任务（服务端幂等生效）', Boolean(idempotency.first) && idempotency.first === idempotency.second, `first=${idempotency.first} second=${idempotency.second}`)

// 整个流程（一次丢失 + 一次恢复）只应新增 1 条生成记录。
const logDelta = after.logs - baseline.logs
check('整个流程只产生 1 条生成记录', logDelta === 1, `基线 ${baseline.logs} → ${after.logs}（新增 ${logDelta}）`)
// 费用：本地单价为 0，因此断言「扣费不重复」应为流水条数增量与任务数一致（每个任务 1 条 consume）。
const pointDelta = after.points - baseline.points
check('扣费只发生一次（流水增量不超过 1 个任务的量）', pointDelta <= 2, `流水 ${baseline.points} → ${after.points}（新增 ${pointDelta}，1 个任务最多 consume+refund 2 条）`)

/* ============ ⑥ 清理：不残留未确认占位 ============ */

const leftover = await page.evaluate(() => {
  const key = Object.keys(window.localStorage).find((item) => item.startsWith('oaooao-live-tasks-pending:'))
  if (!key) return 0
  return JSON.parse(window.localStorage.getItem(key) || '[]').length
})
check('恢复后不再残留未确认缓存', leftover === 0, `剩余 ${leftover} 条`)

/**
 * ⑦ 服务端清理：关闭本脚本产生的任务。
 *
 * 本脚本会制造「结果未知」的任务，它们会停在 `running / needs_review`，
 * 并**占用生成并发名额**。不清理会让**后续脚本**提交时收到并发上限
 * （实测：紧跟其后的 `business-flow` 因此整段失败，看起来像功能回归）。
 * 这里用管理端的人工接管接口把它们确认为失败。
 */
const closed = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/generation-operations?page=1&pageSize=100', { cache: 'no-store' })).json()
  const active = (list?.data?.items ?? []).filter((item) => item.executionPhase === 'needs_review' && ['pending', 'running'].includes(item.status))
  let done = 0
  for (const task of active) {
    const response = await fetch(`/api/admin/generation-operations/${task.type}/${task.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm_failed', reason: '验收脚本产生的模拟失败任务，人工确认关闭' }),
    })
    if (response.ok) done += 1
  }
  return { active: active.length, done }
})
const remainingActive = await page.evaluate(async () => {
  const list = await (await fetch('/api/admin/generation-operations?page=1&pageSize=100', { cache: 'no-store' })).json()
  return (list?.data?.items ?? []).filter((item) => ['pending', 'running'].includes(item.status)).length
})
check('清理本脚本产生的待人工确认任务（不占用后续脚本的并发名额）', remainingActive === 0,
  `关闭 ${closed.done}/${closed.active}，剩余活动任务 ${remainingActive}`)

console.log(`\n总计 ${results.length} 项，失败 ${results.filter((item) => !item.ok).length} 项`)
const failed = results.filter((item) => !item.ok)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
await browser.close()
process.exit(failed.length ? 1 : 0)
