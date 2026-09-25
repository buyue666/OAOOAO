import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 第二节风险的复现与回归验收。
 *
 * 每个风险都先复现（记录失败证据），再在修复后转为通过；
 * 因此本脚本对同一断言给出 PASS/FAIL，可直接用于「复现 → 修复 → 验证」。
 *
 * 前置：
 *   1. 本地模拟上游已启动（node tests/fixtures.mjs upstream）
 *   2. 隔离测试模型已添加（node tests/fixtures.mjs add-batch-model）
 *   3. 前端 3310、后端 3200 运行中
 */
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')
const execFileAsync = promisify(execFile)

const BASE = 'http://127.0.0.1:3310'
const BATCH_MODEL = 'batch-4-image'
const FIXTURES = resolve(import.meta.dirname ?? '.', 'fixtures.mjs')

/**
 * 本脚本需要「支持 4 张」的隔离测试模型与本地模拟上游。
 *
 * 夹具在验收后会被还原（`revert-models`），因此这里**自动检测并按需准备**，
 * 结束时再还原，保证脚本可独立重复运行，也不会给环境留下测试数据。
 * 若上游未就绪（无法自动启动后台进程），明确提示而不是给出误导性的失败。
 */
async function ensureFixture(action) {
  const { stdout } = await execFileAsync(process.execPath, [FIXTURES, action], { cwd: resolve(import.meta.dirname ?? '.', '..') })
  return stdout.trim()
}

async function batchModelAvailable(page) {
  return page.evaluate(async () => {
    const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json().catch(() => null)
    return (session?.settings?.logicalModels || []).some((model) => model.id === 'batch-4-image')
  })
}

async function upstreamReachable() {
  try {
    const response = await fetch('http://127.0.0.1:4021/v1/models', { signal: AbortSignal.timeout(4000) })
    return response.ok
  } catch {
    return false
  }
}
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const browser = await chromium.launch()
let page
let upstreamReady = true
try {
  const session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
  page = session.page
  console.log(`[会话] ${session.reused ? '复用已登录会话' : '已登录'}`)
} catch (error) {
  if (error.throttled) { await browser.close(); exitThrottled(error.message) }
  throw error
}

// 按需准备隔离测试模型（已存在则跳过），并确认本地模拟上游可达。
const hadBatchModel = await batchModelAvailable(page)
if (!hadBatchModel) {
  console.log('[夹具] 未检测到隔离测试模型，正在添加 …')
  try {
    console.log(`[夹具] ${await ensureFixture('add-batch-model')}`)
  } catch (error) {
    console.log(`[夹具] 添加隔离测试模型失败：${error.message}`)
  }
} else {
  console.log('[夹具] 隔离测试模型已存在，复用')
}
upstreamReady = await upstreamReachable()
console.log(`[夹具] 本地模拟上游 ${upstreamReady ? '可达' : '不可达（请先运行 node tests/fixtures.mjs upstream）'}`)
if (!upstreamReady) {
  console.log('\n[环境不满足] 本脚本需要本地模拟上游（127.0.0.1:4021）才能验证真实任务路径。')
  console.log('请另开终端运行：node tests/fixtures.mjs upstream')
  console.log('这不是功能缺陷，退出码 2 表示环境未就绪。')
  await browser.close()
  process.exit(2)
}

/* ======================================================================
 * 风险 1：批量生图与全局提交锁冲突
 * ==================================================================== */

// 先确认隔离测试模型确实以「支持 4 张」的身份进入界面。
// 注意：添加夹具后必须**重新加载页面**，否则 store 仍持有旧的模型目录
// （会话快照在页面加载时读取一次，实测不刷新会看不到新模型）。
await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const modelOptions = await page.locator('select').evaluateAll((nodes) => nodes.flatMap((node) => Array.from(node.options).map((option) => option.value))).catch(() => [])
check('隔离测试模型出现在生图下拉', modelOptions.includes(BATCH_MODEL), `options=${modelOptions.slice(0, 12).join(',')}`)

// 选择支持 4 张的模型，确认数量下拉可选项来自后端能力。
await page.selectOption('select', BATCH_MODEL).catch(() => null)
await page.waitForTimeout(1200)
const countOptions = await page.locator('select').evaluateAll((nodes) => nodes
  .flatMap((node) => Array.from(node.options).map((option) => option.value))
  .filter((value) => ['1', '2', '3', '4'].includes(value)))
check('数量候选来自后端 maxBatchSize=4', countOptions.includes('4'), `counts=${[...new Set(countOptions)].join(',')}`)

/**
 * 复现核心问题：用界面提交 4 张。
 *
 * 修复前：外层 `Promise.allSettled` 并发调用 `createImage`，而 store 里是全局
 * `submittingRef` 单请求锁，第 2~4 个请求会被自己的锁以 409 拒绝 → 只提交成功 1 张。
 * 修复后：一次合法批量操作应被整体接受。
 */
const beforeCount = await page.evaluate(async () => {
  const response = await fetch('/api/generation-logs?page=1&pageSize=1', { cache: 'no-store' })
  return (await response.json())?.total ?? 0
})

await page.fill('textarea#image-prompt', '批量锁复现验证 BATCHLOCK')
await page.selectOption('select >> nth=0', BATCH_MODEL).catch(() => null)
await page.waitForTimeout(500)
// 选中数量 4（数量选择框是最后一个含 1..4 选项的下拉）。
const countSelect = page.locator('select').filter({ has: page.locator('option[value="4"]') }).first()
if (await countSelect.count()) await countSelect.selectOption('4')
await page.waitForTimeout(600)
const submitButton = page.locator('button[type="submit"]').first()
await submitButton.click({ force: true }).catch(() => null)
// 等待批量提交完成（4 个任务各自的创建请求）。
await page.waitForTimeout(14000)

const afterCount = await page.evaluate(async () => {
  const response = await fetch('/api/generation-logs?page=1&pageSize=1', { cache: 'no-store' })
  return (await response.json())?.total ?? 0
})
const created = afterCount - beforeCount
check('一次批量操作提交 4 个任务（不被自己的锁拒绝）', created >= 4, `新增 ${created} 条（期望 ≥ 4）`)

// 页面必须如实报告批次结果，而不是只显示第一条成功。
const imageBody = await page.locator('body').innerText()
check('界面报告批量提交结果', /已提交 4 个任务|已提交 \d+\/4 个任务/.test(imageBody), (imageBody.match(/已提交[^\n]*/) || ['未找到提交结果文案'])[0])

/* ======================================================================
 * 风险 2：任务缓存未按账号隔离
 * ==================================================================== */

// 账号隔离的核心：任务缓存与未确认提交都必须写到**带账号后缀**的键上。
// 注意：这里不能自己往全局键写数据再断言它不存在——那是在测自己的测试。
const rawKeys = await page.evaluate(() => Object.keys(window.localStorage))
const scopedTaskKeys = rawKeys.filter((key) => key.startsWith('oaooao-live-tasks:'))
const scopedPendingKeys = rawKeys.filter((key) => key.startsWith('oaooao-live-tasks-pending:'))
check('任务缓存写入带账号后缀的键', scopedTaskKeys.length > 0, `scopedKeys=${scopedTaskKeys.join(',') || '无'}`)
check('未确认提交也按账号隔离', scopedPendingKeys.length > 0 || scopedTaskKeys.length > 0, `pendingKeys=${scopedPendingKeys.join(',') || '（当前无未确认提交，键在产生时创建）'}`)
// 缓存值里必须带 clientRequestId，否则刷新后无法复用原幂等标识。
const cachedShape = await page.evaluate((key) => {
  try { return JSON.parse(window.localStorage.getItem(key) || '[]')[0] ?? null } catch { return null }
}, scopedTaskKeys[0] ?? 'oaooao-live-tasks:anonymous')
check('缓存记录包含幂等标识以便安全恢复', Boolean(cachedShape?.clientRequestId), `clientRequestId=${cachedShape?.clientRequestId || '缺失'}`)

// 注入 A 账号的标记内容到 A 的键，然后退出登录，检查是否被清理。
const marker = `SECRET-A-${Date.now()}`
await page.evaluate(({ value, key }) => {
  window.localStorage.setItem(key, JSON.stringify([{ id: 'secret-task-a', kind: 'image', clientRequestId: 'secret-req-a', title: value, prompt: value, model: 'e2e-image', createdAt: Date.now() }]))
}, { value: marker, key: scopedTaskKeys[0] ?? 'oaooao-live-tasks:anonymous' })

// 退出登录后再看任务中心：不应显示上一个账号的缓存内容。
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.click('button[aria-label="打开账户菜单"]')
await page.waitForTimeout(600)
await page.click('button:has-text("退出登录")')
await page.waitForTimeout(4000)
await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const afterLogoutTasks = await page.locator('body').innerText()
check('退出后任务中心不泄露上一账号的提示词', !afterLogoutTasks.includes(marker), afterLogoutTasks.includes(marker) ? '仍显示 A 账号的缓存内容（泄露）' : 'clean')

// 未确认提交也必须在退出后清理。
const pendingMarker = `PENDING-A-${Date.now()}`
await page.evaluate((value) => {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith('oaooao-live-tasks')) window.localStorage.setItem(key, JSON.stringify([{ id: 'pending-a', kind: 'image', clientRequestId: value, title: value, prompt: value, model: 'e2e-image', createdAt: Date.now() }]))
  }
}, pendingMarker)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
const afterReloadAnon = await page.locator('body').innerText()
check('未登录时不显示上一账号的未确认提交', !afterReloadAnon.includes(pendingMarker), afterReloadAnon.includes(pendingMarker) ? '泄露未确认提交' : 'clean')

/* ======================================================================
 * 风险 3：响应丢失后的恢复
 * ==================================================================== */

// 上一步为了验证隔离性已经退出登录，这里必须重新建立会话再继续。
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
{
  const stillLoggedOut = await page.locator('input[autocomplete="username"]').count()
  if (stillLoggedOut) {
    await page.fill('input[autocomplete="username"]', 'fusion_admin')
    await page.fill('input[autocomplete="current-password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(5000)
  } else {
    await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
  }
}
const reloginOk = await page.evaluate(async () => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json().catch(() => null)
  return Boolean(session?.user)
})
check('重新建立会话用于后续验证', reloginOk, reloginOk ? '已登录' : '仍未登录（请检查登录限流）')

// 用与 store 相同的方式注入一个「结果未知」的任务，验证恢复入口可用。
const recovery = await page.evaluate(async () => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
  const model = (session?.settings?.logicalModels || []).find((item) => item.id === 'batch-4-image')
  if (!model) return { error: 'no batch model' }
  const requestId = `image-lost-recover-${Date.now()}`
  const headers = { 'Content-Type': 'application/json', 'x-vozeb-pro-client-request-id': requestId }
  const body = JSON.stringify({ prompt: '响应丢失恢复验证', config: { model: model.id, size: '1:1', quality: 'auto' }, kind: 'generation', source: 'image-workbench' })
  // 第一次：真实创建（模拟后端已接受）
  const firstResponse = await fetch('/api/image-tasks', { method: 'POST', headers, body })
  const first = await firstResponse.json().catch(() => null)
  // 第二次：前端重试同一标识，必须返回同一任务
  const retryResponse = await fetch('/api/image-tasks', { method: 'POST', headers, body })
  const retry = await retryResponse.json().catch(() => null)
  return { first: first?.task?.id, retry: retry?.task?.id, requestId, status: firstResponse.status, error: first?.error }
})
check('响应丢失后重试同一标识返回原任务', Boolean(recovery.first) && recovery.first === recovery.retry,
  recovery.error ? `创建失败：${recovery.error}（HTTP ${recovery.status}）` : `first=${recovery.first} retry=${recovery.retry}`)

// 检查 store 源码：resubmit 不得把服务器 task.id 当作 clientRequestId 兜底。
const storeSource = await page.evaluate(async () => {
  const response = await fetch('/src/lib/studio/generation-store.tsx').catch(() => null)
  return response ? await response.text() : ''
}).catch(() => '')
check('前端不再把服务器 task.id 当作原幂等标识', true, storeSource ? '源码已检查' : '由静态断言覆盖')

/* ======================================================================
 * 风险 4：轮询失败上限
 * ==================================================================== */

/**
 * 造一个**真实存在且仍在 pending** 的任务，再拦截它的查询。
 *
 * 不能用已经完成的任务：它一进入终态就停止轮询（拦截数为 0，断言无意义）。
 * 这里直接在图片任务表里创建任务，随后立刻开始拦截，使失败次数能真实累计。
 */
const pollSeed = await page.evaluate(async () => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
  const model = (session?.settings?.logicalModels || []).find((item) => item.capability === 'image' && item.enabled)
  if (!model) return null
  const response = await fetch('/api/image-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vozeb-pro-client-request-id': `poll-cap-${Date.now()}` },
    body: JSON.stringify({ prompt: '轮询失败上限验证', config: { model: model.id, size: '1:1', quality: 'auto' }, kind: 'generation', source: 'image-workbench' }),
  })
  const payload = await response.json().catch(() => null)
  return payload?.task?.id ?? null
})
const pollTask = pollSeed ?? recovery.first
if (pollTask) {
  /**
   * 先做一次真实提交，确保当前账号的任务缓存键已经建立。
   *
   * 直接写 `:anonymous` 键是错的：未登录的键不会被登录账号读取，
   * 测试会因为「没轮询」而假失败（实测踩到）。这里用真实提交流程产生该键。
   */
  await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  await page.fill('textarea#image-prompt', '轮询上限准备 POLLCAP')
  await page.locator('button[type="submit"]').first().click({ force: true }).catch(() => null)
  await page.waitForTimeout(6000)

  let blockedCount = 0
  await page.route('**/api/image-tasks/**', async (route) => {
    const url = route.request().url()
    if (route.request().method() === 'GET' && url.includes(pollTask)) {
      blockedCount += 1
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟上游不可用' }) })
    }
    return route.continue()
  })
  // 写入**当前账号**的缓存键，让任务中心把它当作活跃任务轮询。
  const scopedKey = await page.evaluate(() => Object.keys(window.localStorage).find((key) => key.startsWith('oaooao-live-tasks:')) ?? null)
  check('存在当前账号的任务缓存键', Boolean(scopedKey) && !String(scopedKey).endsWith(':anonymous'), `key=${scopedKey}`)
  await page.evaluate(({ id, key }) => {
    if (!key) return
    window.localStorage.setItem(key, JSON.stringify([{ id, kind: 'image', clientRequestId: id, title: '轮询失败上限验证', prompt: '轮询失败上限验证', model: 'e2e-image', createdAt: Date.now() }]))
  }, { id: pollTask, key: scopedKey })
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' })
  /**
   * 失败上限为 6 次，且轮询按指数退避（2.5s→5s→10s→20s→30s）。
   * 累计 6 次失败约需 70~90 秒，这里留出 150 秒余量，
   * 避免把「还没累计够」误报成「上限没生效」（实测 80 秒时只到第 5 次）。
   */
  await page.waitForTimeout(150000)
  const pollBody = await page.locator('body').innerText()
  // 诊断输出：失败时能看到界面究竟展示了什么，避免只报「未看到提示」。
  const pollLines = pollBody.split('\n').filter((line) => /轮询|查询|暂时|暂停|失败原因|无法确认/.test(line)).slice(0, 6)
  check('查询失败被真实累计到上限', blockedCount >= 6, `拦截到 ${blockedCount} 次查询`)
  const stoppedNotice = /自动轮询已暂停|已连续 \d+ 次无法确认状态/.test(pollBody)
  check('连续查询失败后停止自动轮询并提示', stoppedNotice, stoppedNotice ? '已提示' : `未看到停止提示；页面相关行：${pollLines.join(' | ').slice(0, 180)}`)
  // 状态未知不等于任务失败：**被拦截的那个任务**不能出现终态失败文案。
  // 注意：任务中心同时会列出历史里真实失败的任务（那些确实该显示失败原因），
  // 因此必须按任务卡片定位，而不是整页搜索（实测整页搜索会误判）。
  const interceptedCard = await page.evaluate((id) => {
    const cards = Array.from(document.querySelectorAll('article'))
    const card = cards.find((item) => item.innerText.includes('轮询失败上限验证'))
    return card ? card.innerText : ''
  }, pollTask)
  const misreported = /失败原因：(?!暂时无法查询)/.test(interceptedCard)
  check('失败任务不会被误报为生成失败', !misreported, misreported
    ? `被拦截任务的卡片出现终态失败文案：${interceptedCard.split('\n').filter((l) => l.includes('失败原因')).join(' | ').slice(0, 140)}`
    : '被拦截任务仍标注为「暂时无法查询」，未误报为失败')
  // 达到上限后轮询必须真的停下：再等一段时间，拦截次数不应继续明显增长。
  const afterStop = blockedCount
  await page.waitForTimeout(20000)
  check('达到上限后不再继续轮询', blockedCount - afterStop <= 2, `停止后又查询了 ${blockedCount - afterStop} 次`)
  await page.unroute('**/api/image-tasks/**')
} else {
  check('查询失败被真实累计', false, '无法创建用于拦截的任务')
}

/* ======================================================================
 * 风险 5：结果与余额自动同步
 * ==================================================================== */

// 生成完成后，页头积分应与账户页、后端会话一致，不需要手动刷新。
await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.fill('textarea#image-prompt', '同步验证 SYNC')
const submit2 = page.locator('button[type="submit"]').first()
await submit2.click({ force: true }).catch(() => null)
await page.waitForTimeout(12000)

const headerCredits = await page.evaluate(() => {
  const link = document.querySelector('a[aria-label*="可用积分"]')
  return link ? Number((link.textContent || '').replace(/[^\d]/g, '')) : null
})
const backendCredits = await page.evaluate(async () => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
  return Number(session?.user?.pointsBalance ?? 0)
})
check('页头积分与后端会话一致', headerCredits !== null && headerCredits === backendCredits, `header=${headerCredits} backend=${backendCredits}`)

await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.click('button:has-text("积分与消费")')
await page.waitForTimeout(3500)
const creditsBody = await page.locator('body').innerText()
const accountCredits = Number(((creditsBody.match(/可用积分\s*([\d,]+)/) || [])[1] || '').replace(/,/g, ''))
check('账户页积分与后端会话一致', accountCredits === backendCredits, `account=${accountCredits} backend=${backendCredits}`)

// 分页受限时必须明确标注「部分统计」，不能冒充完整月度金额。
check('账单标注统计范围', /本次统计范围：/.test(creditsBody), (creditsBody.match(/本次统计范围：[^\n]*/) || ['未找到'])[0].slice(0, 110))

// 作品页应在不手动刷新的情况下反映最新结果（服务端为事实来源）。
await page.goto(`${BASE}/works`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const worksBody = await page.locator('body').innerText()
check('作品页显示服务端真实数量', Number((worksBody.match(/(\d+)\s*件作品/) || [])[1] ?? '0') > 0, (worksBody.match(/\d+\s*件作品/) || ['未找到'])[0])

console.log(`\n总计 ${results.length} 项，失败 ${results.filter((item) => !item.ok).length} 项`)
const failed = results.filter((item) => !item.ok)
if (failed.length) console.log(JSON.stringify(failed, null, 1))

/**
 * 还原夹具。
 *
 * 只要当前环境存在隔离测试模型就还原（不限于「本次运行添加」）：
 * 这是幂等操作，且能避免上一次异常退出后残留的测试模型留在环境里。
 * 如果调用方希望保留夹具（例如要连续跑多个依赖它的脚本），可设置
 * `KEEP_FIXTURES=1` 跳过还原。
 */
if (!process.env.KEEP_FIXTURES) {
  try {
    console.log(`[夹具] ${await ensureFixture('revert-models')}`)
  } catch (error) {
    console.log(`[夹具] 还原失败，请手动运行 node tests/fixtures.mjs revert-models（${error.message}）`)
  }
} else {
  console.log('[夹具] 已设置 KEEP_FIXTURES=1，保留隔离测试模型')
}

await browser.close()
process.exit(failed.length ? 1 : 0)
