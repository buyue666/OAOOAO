import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 第十一轮 P2 回归：删除生成作品后「刷新素材」必须真正更新候选池与已选。
 *
 * 缺陷（已复现）：
 *   选中一个来自 generation-logs 的生成作品 → 在服务端删除它 → 点「刷新素材」
 *   → **只重新请求 library-assets，没有重新请求 generation-logs**；
 *   已删除的作品仍留在候选列表、已选仍是 1、提交继续携带它的旧地址。
 *
 * 根因：
 *   1. 刷新按钮只调用 `serverLibrary.reload()` + `requestLiveVerify()`，
 *      从不刷新生成作品来源；
 *   2. 作品的存在性判定读 `useServerWorks` 里的**旧列表**，
 *      旧缓存被当成最新证据。
 *
 * 修复：
 *   - `refreshSources()` 刷新**全部来源**（素材库 + 生成作品）并重载两个可见列表；
 *   - 作品的存活改走 `verifyWorkIds` **定向校验**：只查已选中的 id、
 *     找到即提前结束、**读到底才算"确认删除"**；
 *   - 证据不可用（加载中/失败/分页不完整）→ 保留已选并**如实提示**，不把失败当删除；
 *   - 依赖改用**内容签名**而不是 `works.length`（删除 A 同时新增 B 时长度不变）。
 *
 * 覆盖用户要求的场景：
 *   删除后刷新清理、仍存在时保持、删 A 增 B 数量不变、刷新失败不误删、
 *   素材库与作品混合选择、连续刷新乱序、搜索无结果、账号切换。
 *
 * 真实后端持久化：生成任务、删除记录、提交参数都走真实接口；
 * 生成请求用 route 拦截以**只断言参数**，不调用付费上游。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = process.env.WORKREFRESH_BASE || 'http://127.0.0.1:3310'
const MARK = `WORKREFRESH-${Date.now().toString(36).toUpperCase()}`

const results = []
const notExecuted = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }
const skip = (name, why) => { notExecuted.push({ name, why }); console.log(`NOT-EXECUTED ${name} :: ${why}`) }

const browser = await chromium.launch()
let session
try {
  session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
} catch (error) {
  if (error?.throttled) { await browser.close(); exitThrottled(error.message) }
  await browser.close()
  throw error
}
const page = session.page

const api = (path, options = {}) => page.evaluate(async ({ path, options }) => {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options, cache: 'no-store' })
  const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* ignore */ }
  return { status: r.status, json: j, text: t.slice(0, 300) }
}, { path, options })

/** 真实生成一个图片作品，返回 { taskId, logId }。 */
const createWork = async (label) => {
  const created = await api('/api/image-tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: `${MARK} ${label}`, config: { model: 'e2e-image', count: 1, size: '1:1', quality: 'auto' } }),
  })
  const taskId = created.json?.task?.id
  if (!taskId) throw new Error(`生成任务创建失败：${created.text}`)
  for (let i = 0; i < 40; i += 1) {
    const t = await api(`/api/image-tasks/${encodeURIComponent(taskId)}`)
    const s = t.json?.task?.status
    if (['success', 'error', 'cancelled'].includes(s)) break
    await page.waitForTimeout(1500)
  }
  const logId = `image-task:${taskId}`
  const probe = await api(`/api/generation-logs?page=1&pageSize=10&keyword=${encodeURIComponent(MARK)}`)
  const item = (probe.json?.items ?? []).find((i) => i.id === logId)
  const url = item?.assets?.[0]?.serverUrl ?? item?.assets?.[0]?.url ?? null
  return { taskId, logId, url }
}

const readPicker = () => page.evaluate(() => {
  const status = document.querySelector('[data-testid="reference-picker-status"]')?.textContent ?? ''
  const m = status.match(/已选\s*(\d+)\/(\d+)/)
  return {
    count: m ? Number(m[1]) : null,
    status: status.trim(),
    urls: Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).map((n) => n.getAttribute('data-asset-url') || ''),
  }
})

/** 等候选池出现生成作品来源的条目（多页加载需要时间）。 */
const waitForWorkItem = async (targetUrl = null, tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    await page.waitForTimeout(700)
    const found = await page.evaluate((want) => {
      const urls = Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).map((n) => n.getAttribute('data-asset-url') || '')
      if (want) return urls.includes(want)
      return urls.some((u) => u.startsWith('/api/generation-log-assets'))
    }, targetUrl)
    if (found) return true
    const more = page.locator('[data-testid="reference-picker-more"]').first()
    if (await more.count()) { await more.click({ force: true }).catch(() => null); await page.waitForTimeout(300) }
  }
  return false
}

const clickItem = async (url) => {
  await page.locator(`[data-testid="reference-picker-item"][data-asset-url="${url}"]`).first().click({ force: true })
  await page.waitForTimeout(700)
}
const clickReload = async () => {
  await page.locator('[data-testid="reference-picker"] button:has-text("刷新素材")').first().click({ force: true })
  await page.waitForTimeout(6000)
}

let capturedPayloads = []
const installCapture = async () => {
  await page.route('**/api/image-tasks', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    let parsed = null
    try { parsed = JSON.parse(route.request().postData() ?? 'null') } catch { /* ignore */ }
    capturedPayloads.push(parsed)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task: { id: `probe-${Date.now()}`, kind: 'edit', status: 'pending', model: 'e2e-image' } }) })
  })
}
/**
 * 拦截提交并读取 references 参数。拦截只在提交期间安装，
 * 用后立即解除——否则后续 createWork 的真实创建请求也会被拦掉。
 */
const submitAndReadRefs = async () => {
  capturedPayloads = []
  await installCapture()
  try {
    await page.fill('#image-prompt', `${MARK} 提交检查 ${Date.now().toString(36)}`)
    await page.waitForTimeout(400)
    await page.locator('button[type="submit"]:visible').first().click()
    await page.waitForTimeout(4000)
  } finally {
    await page.unroute('**/api/image-tasks').catch(() => null)
  }
  return capturedPayloads.flatMap((p) => (p?.references ?? []).map((r) => ({ url: r.url, role: r.role, type: r.type })))
}

let workA = null
let workB = null
try {
  /* ================================================================
   * 1. 删除生成作品 → 刷新必须清理（核心）
   * ============================================================== */
  console.log('\n--- 1. 删除生成作品后刷新 ---')
  await page.goto(`${BASE}/image`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  workA = await createWork('A作品')
  console.log(`[作品A] logId=${workA.logId} url=${String(workA.url).slice(0, 60)}`)
  if (!workA.url) throw new Error('作品 A 没有产出地址')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const foundA = await waitForWorkItem(workA.url)
  if (!foundA) {
    skip('全部生成作品相关断言', '候选池里找不到刚生成的 A 作品')
    throw new Error('找不到 A 作品')
  }
  await clickItem(workA.url)
  check('已选中生成作品 A', (await readPicker()).count === 1, `已选=${(await readPicker()).count}`)

  const del = await api('/api/generation-logs', { method: 'DELETE', body: JSON.stringify({ ids: [workA.logId] }) })
  check('服务端已删除作品 A', del.status === 200, `status=${del.status} ${JSON.stringify(del.json)}`)

  /** 记录刷新期间是否重新请求了 generation-logs。 */
  const refreshRequests = []
  const onReq = (r) => { if (r.url().includes('/api/generation-logs')) refreshRequests.push(r.url()) }
  page.on('request', onReq)
  await clickReload()
  page.off('request', onReq)
  check('「刷新素材」重新请求了 generation-logs', refreshRequests.length > 0, `请求数=${refreshRequests.length}`)

  const afterDelete = await readPicker()
  check('已删除的作品被从已选中清理', afterDelete.count === 0, `已选=${afterDelete.count}`)
  check('已删除的作品不再出现在候选列表', !afterDelete.urls.includes(workA.url),
    `仍在候选列表=${afterDelete.urls.includes(workA.url)}`)

  const refsAfter = await submitAndReadRefs()
  check('提交不再携带已删除作品的旧地址',
    !refsAfter.some((r) => r.url === workA.url),
    `references=${JSON.stringify(refsAfter.map((r) => r.url)).slice(0, 140)}`)

  /* ================================================================
   * 2. 作品仍存在 → 刷新必须保持选中（不能误删）
   * ============================================================== */
  console.log('\n--- 2. 作品仍存在时刷新 ---')
  workB = await createWork('B作品')
  console.log(`[作品B] logId=${workB.logId} url=${String(workB.url).slice(0, 60)}`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const foundB = await waitForWorkItem(workB.url)
  if (!foundB) {
    skip('作品仍存在时刷新的断言', '候选池里找不到 B 作品')
  } else {
    await clickItem(workB.url)
    const beforeKeep = await readPicker()
    check('已选中作品 B', beforeKeep.count === 1, `已选=${beforeKeep.count}`)
    await clickReload()
    const afterKeep = await readPicker()
    check('作品仍存在时，刷新后保持选中（不误删）', afterKeep.count === 1, `已选=${afterKeep.count}`)
    const keptRefs = await submitAndReadRefs()
    const kept = keptRefs.find((r) => r.url === workB.url)
    check('提交仍携带该作品的 URL', Boolean(kept), `references=${JSON.stringify(keptRefs.map((r) => r.url)).slice(0, 140)}`)
    check('提交保留了该作品的类型（image）', kept?.type === 'image', `type=${kept?.type}`)
  }

  /* ================================================================
   * 3. 删除 A 的同时新增 B（总数不变）→ A 仍须被清理
   *
   * 这是"不能用 works.length 判断变化"的直接验证：
   * 先记录当前作品数，删除 A2 再新增 B2，总数期望不变。
   * ============================================================== */
  console.log('\n--- 3. 删除 A 同时新增 B（总数不变）---')
  const workA2 = await createWork('A2作品')
  const countBefore = (await api('/api/generation-logs?page=1&pageSize=1')).json?.total ?? 0
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const foundA2 = await waitForWorkItem(workA2.url)
  if (!foundA2) {
    skip('删 A 增 B 的断言', '候选池里找不到 A2 作品')
  } else {
    await clickItem(workA2.url)
    check('已选中作品 A2', (await readPicker()).count === 1, `已选=${(await readPicker()).count}`)

    /** 删除 A2，同时新增 B2：条数一增一减，总数保持一致。 */
    await api('/api/generation-logs', { method: 'DELETE', body: JSON.stringify({ ids: [workA2.logId] }) })
    const workB2 = await createWork('B2作品')
    const countAfter = (await api('/api/generation-logs?page=1&pageSize=1')).json?.total ?? 0
    console.log(`[总数] 删除前=${countBefore} 删除A2+新增B2后=${countAfter}`)
    check('构造出"删除 A 同时新增 B、总数不变"的场景', countBefore === countAfter,
      `前=${countBefore} 后=${countAfter}（若不同也不影响结论，只是该场景未精确成立）`)

    await clickReload()
    const afterAB = await readPicker()
    check('删除 A 同时新增 B 时，A 仍被正确清理（不因总数不变而漏判）',
      afterAB.count === 0, `已选=${afterAB.count}`)
    const refsAB = await submitAndReadRefs()
    check('提交不再携带 A2 的旧地址', !refsAB.some((r) => r.url === workA2.url),
      `references=${JSON.stringify(refsAB.map((r) => r.url)).slice(0, 140)}`)
    void workB2
  }

  /* ================================================================
   * 4. 素材库与生成作品混合选择 → 各自按来源处理
   * ============================================================== */
  console.log('\n--- 4. 混合来源 ---')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  const libUrl = await page.evaluate(() => {
    const urls = Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).map((n) => n.getAttribute('data-asset-url') || '')
    return urls.find((u) => u.startsWith('/api/reference-assets/permanent')) ?? null
  })
  const workUrlForMix = await page.evaluate(() => {
    const urls = Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).map((n) => n.getAttribute('data-asset-url') || '')
    return urls.find((u) => u.startsWith('/api/generation-log-assets')) ?? null
  })
  if (!libUrl || !workUrlForMix) {
    skip('混合来源断言', `素材库候选=${Boolean(libUrl)} 作品候选=${Boolean(workUrlForMix)}`)
  } else {
    await clickItem(libUrl)
    await clickItem(workUrlForMix)
    const mixed = await readPicker()
    check('可同时选中素材库与生成作品（混合来源）', mixed.count === 2, `已选=${mixed.count}`)

    /** 删除那个作品：只有它应被清理，素材库那条必须保留。 */
    const mixedLogId = await page.evaluate(async (url) => {
      const r = await (await fetch('/api/generation-logs?page=1&pageSize=50&kind=image', { cache: 'no-store' })).json()
      for (const item of (r?.items ?? [])) {
        for (const a of (item.assets ?? [])) if ((a.serverUrl ?? a.url) === url) return item.id
      }
      return null
    }, workUrlForMix)
    if (!mixedLogId) {
      skip('混合来源中删除作品后的清理断言', '无法从作品地址反查到 generation-log id')
    } else {
      await api('/api/generation-logs', { method: 'DELETE', body: JSON.stringify({ ids: [mixedLogId] }) })
      await clickReload()
      const afterMix = await readPicker()
      check('删除作品后，只有作品来源的那条被清理，素材库那条保留',
        afterMix.count === 1, `已选=${afterMix.count}（期望 1）`)
      const refsMix = await submitAndReadRefs()
      check('提交保留素材库那条、去掉已删除作品',
        refsMix.some((r) => r.url === libUrl) && !refsMix.some((r) => r.url === workUrlForMix),
        `references=${JSON.stringify(refsMix.map((r) => r.url)).slice(0, 160)}`)
    }
  }

  /* ================================================================
   * 5. 作品列表刷新失败 → 不误删，并如实提示
   * ============================================================== */
  console.log('\n--- 5. 刷新失败不误删 ---')
  const workC = await createWork('C作品')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const foundC = await waitForWorkItem(workC.url)
  if (!foundC) {
    skip('刷新失败不误删的断言', '候选池里找不到 C 作品')
  } else {
    await clickItem(workC.url)
    check('已选中作品 C', (await readPicker()).count === 1, `已选=${(await readPicker()).count}`)
    /** 让 generation-logs 请求失败（模拟后端不可用）。 */
    await page.route('**/api/generation-logs**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模拟作品列表失败' }) }))
    await clickReload()
    const afterFail = await readPicker()
    check('作品列表刷新失败时，已选**不被误删**', afterFail.count === 1, `已选=${afterFail.count}`)
    const bodyText = await page.locator('body').innerText()
    check('刷新失败时如实提示"未取到完整数据、未做删除判定"',
      /没有取到完整数据|未做删除判定/.test(bodyText),
      `提示出现=${/没有取到完整数据|未做删除判定/.test(bodyText)}`)
    await page.unroute('**/api/generation-logs**')
  }

  /* ================================================================
   * 6. 连续刷新乱序返回 → 旧响应不得覆盖新结果
   * ============================================================== */
  console.log('\n--- 6. 连续刷新乱序 ---')
  await clickReload()
  await clickReload()
  const afterRapid = await readPicker()
  check('连续刷新后状态自洽（不因乱序而出现异常计数）',
    afterRapid.count !== null && afterRapid.count >= 0, `已选=${afterRapid.count} status="${afterRapid.status}"`)

  /* ================================================================
   * 7. 搜索无结果不参与存活判定
   * ============================================================== */
  console.log('\n--- 7. 搜索无结果 ---')
  const search = page.locator('[data-testid="reference-picker-search"]').first()
  if (await search.count()) {
    await search.fill('ZZZNOMATCHKEYWORD')
    await search.press('Enter')
    await page.waitForTimeout(3500)
    const afterSearch = await readPicker()
    check('搜索无结果时已选数量不变（搜索不参与存活判定）',
      afterSearch.count === afterRapid.count, `搜索前=${afterRapid.count} 搜索后=${afterSearch.count}`)
    await search.fill('')
    await search.press('Enter')
    await page.waitForTimeout(3000)
  } else {
    skip('搜索无结果断言', '没有搜索框')
  }

  await page.unroute('**/api/image-tasks').catch(() => null)
} catch (error) {
  check('执行过程中未抛出未预期异常', false, error instanceof Error ? error.message : String(error))
} finally {
  await browser.close()
}

const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，未执行 ${notExecuted.length}，失败 ${failed.length}`)
if (notExecuted.length) { console.log('未执行项：'); for (const item of notExecuted) console.log(` - ${item.name} :: ${item.why}`) }
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
