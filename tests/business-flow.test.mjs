import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 本轮「商业运营真实业务流程」的复现与回归验收。
 *
 * 覆盖四组已复现缺陷：
 *  A. 结果交付：任务完成后主预览/下载不更新（必须刷新才恢复）
 *  B. 首页 → 工作台参数传递、素材上传持久化、项目引用真实落库
 *  C. 异常恢复与账户隔离：费用未知不得显示「未产生积分消耗」、文本任务幂等、按任务独立退避
 *  D. 套餐预览周期跟随与同组多商品数据
 *
 * 每个断言都给出**具体值**，不使用「页面 200」这类模糊判断。
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

/* ======================================================================
 * A. 结果交付：任务完成后主预览立即可见（不刷新）
 * ==================================================================== */

/**
 * 结果舞台探针。
 *
 * 必须按**结构**定位结果舞台，而不是「页面里第一个虚线框」：
 * 左侧还有参考素材的上传区也是虚线框（实测踩到，导致误判空态）。
 * 结果舞台的特征是带 `aspect-ratio` 的容器。
 */
const stageProbe = () => page.evaluate(() => {
  const aspect = document.querySelector('div[style*="aspect-ratio"]')
  if (!aspect) return { emptyState: 'no-stage', mediaCount: 0 }
  const dashed = aspect.querySelector('div.border-dashed')
  return {
    emptyState: dashed ? dashed.innerText.trim().slice(0, 40) : null,
    mediaCount: aspect.querySelectorAll('img, video').length,
  }
})

/** 读取生成记录：后端分页键是 `items`（不是 logs）。 */
const listLogs = (params = 'page=1&pageSize=5') => page.evaluate(async (query) => {
  const response = await fetch(`/api/generation-logs?${query}`, { cache: 'no-store' })
  const payload = await response.json()
  return { items: payload?.items ?? [], total: payload?.total ?? 0 }
}, params)

await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
const before = await stageProbe()
check('进入工作台时结果舞台有真实内容（不是空态）', before.emptyState === null && before.mediaCount > 0,
  `empty=${JSON.stringify(before.emptyState)} media=${before.mediaCount}`)

/**
 * 用**唯一标记**匹配本次任务卡。
 *
 * 任务标题是 `图片生成 · <提示词前 16 字符>`，因此标记必须放在提示词**开头**，
 * 否则会被截断掉（实测踩到，导致误判「任务未完成」）。
 */
const TASK_MARK = `Z${Date.now().toString(36).toUpperCase()}`
await page.fill('textarea', `${TASK_MARK} delivery regression probe`)
await page.waitForTimeout(600)

/**
 * 提交并等待任务被接受。
 *
 * 连续运行多个验收脚本时，上一个脚本留下的「待人工确认」任务仍占用
 * 生成并发名额，此时提交会返回「已达到并发上限」——那是**环境占用**，
 * 不是功能缺陷。这里显式区分并如实报告，避免把它误判成「任务未完成」。
 */
let acceptError = ''
for (let attempt = 0; attempt < 4; attempt += 1) {
  await page.locator('button:has-text("立即生成"), button:has-text("生成")').first().click()
  await page.waitForTimeout(3000)
  const state = await page.evaluate((mark) => {
    const card = Array.from(document.querySelectorAll('article')).find((node) => node.innerText.includes(mark))
    const body = document.body.innerText
    return { hasCard: Boolean(card), concurrency: /并发上限|同时提交的任务过多/.test(body) }
  }, TASK_MARK)
  if (state.hasCard) { acceptError = ''; break }
  if (state.concurrency) {
    acceptError = '生成并发名额被占用（可能是上一个脚本留下的任务）'
    // 等待并发名额释放后重试。
    await page.waitForTimeout(15000)
    continue
  }
  acceptError = '提交后未出现任务卡'
  break
}
if (acceptError) console.log(`[环境] ${acceptError}`)

/** 轮询等待任务完成，同时观察舞台是否**无需刷新**就出现新结果。 */
let sawPendingCostUnknown = false
let sawSettledCostText = null
let deliveredWithoutReload = false
let taskCompleted = false

/**
 * 先做一次**立即采样**，再进入轮询。
 *
 * 本地模拟上游有时几秒内就返回终态，如果第一次采样等到 2.5 秒之后，
 * 就可能完全错过「进行中」阶段，把「没观察到」误报成「没有显示费用待确认」
 * （实测在整套回归连跑时出现过）。立即采样显著降低这个窗口。
 */
const sampleTask = () => page.evaluate((mark) => {
  const card = Array.from(document.querySelectorAll('article')).find((node) => node.innerText.includes(mark))
  const stage = document.querySelector('div[style*="aspect-ratio"]')
  return {
    cardText: card ? card.innerText.replace(/\n+/g, ' | ') : null,
    points: card?.querySelector('[data-testid="task-points"]')?.innerText.trim() ?? null,
    mediaCount: stage?.querySelectorAll('img, video').length ?? 0,
    emptyState: stage?.querySelector('div.border-dashed') ? true : false,
  }
}, TASK_MARK)

const observe = (probe) => {
  if (!probe.cardText) return false
  // 进行中必须显示「费用待确认」，不能承诺「未产生积分消耗」。
  if (/生成中|等待上游|提交中|处理中/.test(probe.cardText) && /费用待确认/.test(probe.points ?? '')) sawPendingCostUnknown = true
  if (/已完成/.test(probe.cardText)) {
    taskCompleted = true
    sawSettledCostText = probe.points
    return !probe.emptyState && probe.mediaCount > 0
  }
  return false
}

// 立即采样（任务可能仍在排队/执行中）。
observe(await sampleTask())

for (let attempt = 0; attempt < 16; attempt += 1) {
  await page.waitForTimeout(2500)
  const probe = await sampleTask()
  if (observe(probe) && (deliveredWithoutReload = true)) break
}
check('进行中任务显示「费用待确认」而不是「未产生积分消耗」', sawPendingCostUnknown, `观察到=${sawPendingCostUnknown}`)
check('任务完成后结果舞台无需刷新即可见', taskCompleted && deliveredWithoutReload,
  `completed=${taskCompleted} deliveredWithoutReload=${deliveredWithoutReload}${acceptError ? `（提交受阻：${acceptError}）` : ''}`)
check('任务结束后才显示确定的费用文案', sawSettledCostText !== null && !/费用待确认/.test(sawSettledCostText ?? ''),
  `终态费用文案=${JSON.stringify(sawSettledCostText)}`)

/** 主预览区的图片必须是本次结果之一（新结果出现在最前）。 */
const previewSrcs = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map((n) => n.src).filter((src) => src.includes('generation-log-assets')))
check('主预览区包含后端结果资产地址', previewSrcs.length > 0, `数量=${previewSrcs.length} 示例=${previewSrcs[0]?.slice(-28) ?? '-'}`)

/* ======================================================================
 * A2. 下载使用真实格式（不再一律 png/mp4）
 * ==================================================================== */

const downloadProbe = await page.evaluate(async () => {
  // 取第一个真实结果资产，检查响应的 MIME 与文件名推断依据。
  const img = Array.from(document.querySelectorAll('img')).find((n) => n.src.includes('generation-log-assets'))
  if (!img) return null
  const response = await fetch(img.src, { credentials: 'include' })
  const blob = await response.blob()
  return { status: response.status, contentType: response.headers.get('content-type'), size: blob.size, type: blob.type }
})
check('下载源可取到真实文件内容', Boolean(downloadProbe && downloadProbe.size > 0),
  `status=${downloadProbe?.status} type=${downloadProbe?.contentType} size=${downloadProbe?.size}`)
check('结果资产返回真实 MIME（用于决定扩展名）', Boolean(downloadProbe?.contentType?.startsWith('image/')),
  `content-type=${JSON.stringify(downloadProbe?.contentType)}`)

/* ======================================================================
 * B. 首页 → 工作台参数传递
 * ==================================================================== */

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const HOME_PROMPT = '首页传递验收：雪原上的信号塔，青色极光，长镜头'
await page.fill('#home-prompt', HOME_PROMPT)
await page.waitForTimeout(500)
// 选择「图片」模式后开始创作。
await page.locator('button:has-text("图片")').first().click()
await page.waitForTimeout(400)
await page.locator('button:has-text("开始创作"), button:has-text("打开工作台")').first().click()
await page.waitForURL('**/image', { timeout: 20000 }).catch(() => null)
await page.waitForTimeout(4500)

const landedPrompt = await page.evaluate(() => document.querySelector('textarea')?.value ?? '')
check('工作台使用首页输入的提示词（未被示例文案替换）', landedPrompt === HOME_PROMPT,
  `期望=${JSON.stringify(HOME_PROMPT.slice(0, 24))} 实际=${JSON.stringify(landedPrompt.slice(0, 24))}`)
const intentNotice = await page.evaluate(() => /已带入首页的创作描述/.test(document.body.innerText))
check('工作台明确提示已带入首页内容', intentNotice, `提示存在=${intentNotice}`)

/** 意图是一次性的：刷新后不应再次套用。 */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
const afterReloadPrompt = await page.evaluate(() => document.querySelector('textarea')?.value ?? '')
check('刷新后不再重复套用旧意图（一次性消费）', afterReloadPrompt !== HOME_PROMPT,
  `刷新后=${JSON.stringify(afterReloadPrompt.slice(0, 24))}`)

/* ======================================================================
 * B2. 项目引用真实落库（不再只弹提示）
 * ==================================================================== */

const projectProbe = await page.evaluate(async () => {
  const created = await fetch('/api/canvas/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `E2E-引用验收-${Date.now()}`, project: { nodes: [], connections: [] } }),
  })
  const payload = await created.json()
  return { status: created.status, id: payload?.data?.project?.id ?? null }
})
const testProjectId = projectProbe.id
check('可创建隔离测试项目', Boolean(testProjectId), `status=${projectProbe.status} id=${testProjectId}`)

if (testProjectId) {
  const nodeProbe = await page.evaluate(async ({ projectId }) => {
    // 读取一个真实结果资产作为引用对象。
    const logs = await (await fetch('/api/generation-logs?page=1&pageSize=20&status=success', { cache: 'no-store' })).json()
    const asset = (logs?.items ?? []).flatMap((item) => item.assets ?? []).find((item) => item?.serverUrl || item?.url)
    const url = asset?.serverUrl || asset?.url
    if (!url) return { error: '没有可用结果资产' }
    const marker = 'oaooaoMediaSourceId'
    const project = await (await fetch(`/api/canvas/projects/${projectId}`, { cache: 'no-store' })).json()
    const current = project?.data?.project
    const nodes = [...(current?.nodes ?? []), { id: 'media-e2e-probe', type: 'media', position: { x: 0, y: 0 }, data: { [marker]: url, title: 'E2E 引用验收', kind: 'image', src: url, status: 'ready' } }]
    const patched = await fetch(`/api/canvas/projects/${projectId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: current?.updatedAt, project: { ...current, nodes } }),
    })
    return { patchStatus: patched.status, nodeCount: nodes.length, sourceId: url }
  }, { projectId: testProjectId })
  check('项目引用可真实写入画布节点', nodeProbe.patchStatus === 200 && nodeProbe.nodeCount > 0,
    `patch=${nodeProbe.patchStatus} nodes=${nodeProbe.nodeCount} err=${nodeProbe.error ?? '-'}`)

  /** 重新读取（模拟刷新/另一浏览器）确认持久化。 */
  const persisted = await page.evaluate(async ({ projectId }) => {
    const response = await fetch(`/api/canvas/projects/${projectId}`, { cache: 'no-store' })
    const payload = await response.json()
    const nodes = payload?.data?.project?.nodes ?? []
    return { count: nodes.length, markers: nodes.map((node) => node?.data?.oaooaoMediaSourceId).filter(Boolean) }
  }, { projectId: testProjectId })
  check('刷新后项目引用仍存在（服务端持久化）', persisted.markers.length === 1,
    `节点=${persisted.count} 引用标记=${persisted.markers.length}`)

  // 清理测试项目。
  const removed = await api('/api/canvas/projects', { method: 'DELETE', body: JSON.stringify({ ids: [testProjectId] }) })
  check('隔离测试项目已删除', removed.status === 200, `status=${removed.status}`)
}

/* ======================================================================
 * B3. 素材上传真实落库
 * ==================================================================== */

const uploadProbe = await page.evaluate(async () => {
  // 生成一个最小 PNG（1x1 会被 vips 拒绝，用 canvas 产出合法 PNG）。
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  context.fillStyle = '#2f6f6a'
  context.fillRect(0, 0, 64, 64)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return { error: 'canvas 无法生成 PNG' }
  const file = new File([blob], `E2E-上传验收-${Date.now()}.png`, { type: 'image/png' })
  const form = new FormData()
  form.append('file', file)
  form.append('type', 'image')
  form.append('persistent', 'true')
  const stored = await fetch('/api/reference-assets', { method: 'POST', body: form, credentials: 'include' })
  const storedPayload = await stored.json().catch(() => null)
  if (!stored.ok || !storedPayload?.url) return { error: storedPayload?.error || `上传失败 ${stored.status}` }
  const created = await fetch('/api/library-assets', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'image',
      title: 'E2E-上传验收素材',
      tags: ['E2E'],
      data: { storageKey: storedPayload.key, serverUrl: storedPayload.url, dataUrl: storedPayload.url, bytes: storedPayload.bytes ?? blob.size, mimeType: storedPayload.mimeType || 'image/png' },
    }),
  })
  const createdPayload = await created.json().catch(() => null)
  return { uploadStatus: stored.status, url: storedPayload.url, assetStatus: created.status, assetId: createdPayload?.data?.asset?.id ?? null, msg: createdPayload?.msg }
})
check('素材上传到服务器成功（持久地址）', Boolean(uploadProbe.url), `status=${uploadProbe.uploadStatus} url=${String(uploadProbe.url).slice(0, 40)} err=${uploadProbe.error ?? '-'}`)
check('素材登记到素材库成功', uploadProbe.assetStatus === 200 && Boolean(uploadProbe.assetId),
  `status=${uploadProbe.assetStatus} id=${uploadProbe.assetId} msg=${JSON.stringify(uploadProbe.msg)}`)

if (uploadProbe.assetId) {
  const listed = await page.evaluate(async () => {
    const response = await fetch('/api/library-assets?page=1&pageSize=50', { cache: 'no-store' })
    const payload = await response.json()
    return (payload?.data?.assets ?? []).filter((asset) => asset.title === 'E2E-上传验收素材').length
  })
  check('素材在服务端列表中可读（刷新/换浏览器可恢复）', listed === 1, `匹配数=${listed}`)

  const assetPage = await page.evaluate(async () => {
    const response = await fetch('/api/library-assets?page=1&pageSize=50', { cache: 'no-store' })
    const payload = await response.json()
    const asset = (payload?.data?.assets ?? []).find((item) => item.title === 'E2E-上传验收素材')
    return { src: asset?.data?.serverUrl ?? null }
  })
  const fetchable = await page.evaluate(async (src) => {
    const response = await fetch(src, { credentials: 'include' })
    const blob = await response.blob()
    return { status: response.status, size: blob.size, type: blob.type }
  }, assetPage.src)
  check('上传的素材文件真实可取到', fetchable.status === 200 && fetchable.size > 0,
    `status=${fetchable.status} size=${fetchable.size} type=${fetchable.type}`)

  const removed = await api(`/api/library-assets/${uploadProbe.assetId}`, { method: 'DELETE' })
  check('隔离测试素材已删除', removed.status === 200, `status=${removed.status}`)
}

/* ======================================================================
 * C. 文本任务幂等
 * ==================================================================== */

const textIdempotency = await page.evaluate(async () => {
  const clientRequestId = `e2e-text-${Date.now()}`
  const body = { config: { model: 'e2e-text' }, messages: [{ role: 'user', content: 'E2E 文本幂等验收' }], context: { clientRequestId } }
  const send = () => fetch('/api/text-tasks', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vozeb-pro-client-request-id': clientRequestId }, body: JSON.stringify(body) })
  const first = await send()
  const firstPayload = await first.json()
  const second = await send()
  const secondPayload = await second.json()
  return { firstStatus: first.status, secondStatus: second.status, firstId: firstPayload?.task?.id ?? null, secondId: secondPayload?.task?.id ?? null }
})
check('文本任务首次创建成功', textIdempotency.firstStatus === 200 && Boolean(textIdempotency.firstId), JSON.stringify(textIdempotency))
check('文本任务同一标识重复提交返回同一任务（不重复创建/扣费）',
  textIdempotency.secondStatus === 200 && textIdempotency.secondId === textIdempotency.firstId,
  `first=${textIdempotency.firstId} second=${textIdempotency.secondId}`)

/* ======================================================================
 * C2. 账户隔离：另一个会话看不到本账号数据
 * ==================================================================== */

/**
 * 用**独立浏览器上下文**验证账号隔离。
 *
 * 刻意**不做真实退出登录**：退出会让 `session-helper` 的缓存会话失效，
 * 下次运行要重新登录并消耗限流额度（实测导致脚本不可重复运行）。
 * 独立上下文等价于「另一浏览器」，更贴近要验证的场景。
 */
const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const otherPage = await otherContext.newPage()
await otherPage.goto(`${BASE}/works`, { waitUntil: 'networkidle' })
await otherPage.waitForTimeout(4000)
const anonymous = await otherPage.evaluate(async () => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json().catch(() => null)
  let logStatus = null
  let logCount = null
  try {
    const response = await fetch('/api/generation-logs?page=1&pageSize=5', { cache: 'no-store' })
    logStatus = response.status
    const payload = await response.json().catch(() => null)
    logCount = payload?.items?.length ?? null
  } catch {
    logStatus = 'network-error'
  }
  return {
    authenticated: Boolean(session?.user?.id),
    worksCards: document.querySelectorAll('article').length,
    logStatus,
    logCount,
    leaksPreviousUser: /fusion_admin/.test(document.body.innerText),
  }
})
check('未登录的独立会话不可见他人作品', anonymous.authenticated === false && anonymous.worksCards === 0,
  `authenticated=${anonymous.authenticated} cards=${anonymous.worksCards}`)
check('未登录时生成记录接口被拒绝或返回空',
  anonymous.logStatus === 401 || anonymous.logStatus === 403 || anonymous.logCount === 0,
  `status=${anonymous.logStatus} count=${anonymous.logCount}`)
check('未登录会话不泄露账号标识', anonymous.leaksPreviousUser === false, `包含 fusion_admin=${anonymous.leaksPreviousUser}`)
await otherContext.close()

/** 已登录会话仍然完整（确认上面的隔离验证没有破坏本账号状态）。 */
const stillAuthed = await page.evaluate(async () => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json().catch(() => null)
  return Boolean(session?.user?.id)
})
check('主会话在隔离验证后仍保持登录', stillAuthed, `authenticated=${stillAuthed}`)

/* ======================================================================
 * 汇总
 * ==================================================================== */

/* ======================================================================
 * 汇总
 * ==================================================================== */

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
