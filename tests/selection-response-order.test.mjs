import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 第十二轮回归：乱序响应不得清掉刷新期间新增的选择；删除提示与失败提示必须都可见。
 *
 * 缺陷一（已复现）：
 *   选 A → 点「刷新素材」→ 作品校验先回、素材库响应暂缓 → 刷新期间再选 B
 *   → B 的新校验先完成 → 释放旧刷新的素材库响应
 *   → 已选从 2 变 1，B 被误报已删除，生成请求也不再携带 B。
 *
 * 根因：
 *   `findExistingWorkIds` 返回的是"**本次查询的 id 中**哪些存在"，
 *   不是整个来源的全集。旧请求只查了 A，`applyEvidence` 却把它应用到最新的 [A,B]，
 *   把"没有查询过 B"误当成"B 不存在"。各来源内部虽然有守卫，
 *   但一次校验由两个来源 `Promise.all` 组成，等待慢的那个时选择已经变了。
 *
 * 缺陷二（已复现）：
 *   同时选中素材库资产与生成作品；素材库确认已删除、生成作品接口 503
 *   → 最终选择处理正确，但界面**只**显示"已移除不存在素材"，
 *   "生成作品未确认、已保留"被覆盖。原因是删除提示写在 `setSelectedRefs` 的
 *   状态更新函数里（带副作用），与 `refreshSources` 的失败提示互相 `setNotice`。
 *
 * 修复：
 *   - 证据区分「查询范围 / 确认存在 / 确认不存在 / 尚未确认」
 *     （`scopedEvidence(queried, found)`，`evidenceCovers`）：定向查询只在其
 *     范围内判定删除，范围外的新选择一律保留；
 *   - `verifyBatchRef` + 账号世代 + **选择版本**：组合结果**应用前**核对，
 *     旧批次不得写入（不只是"单个请求返回时"校验）；
 *   - 每轮一个累计器（`createReconcileRound`），删除与失败**合成一条**通知；
 *   - 状态更新函数保持纯净：判定与通知都在 setState 之外算完。
 *
 * 本脚本用 `page.route` **精确编排响应顺序**（挂起 / 手动释放），
 * 不使用固定 sleep 代替乱序断言。
 *
 * 真实后端持久化：作品真实生成、真实删除、提交参数抓取都走真实接口；
 * 受控响应：素材库/作品校验请求被挂起或改写为 503，用于制造时序与失败。
 * 生成请求被拦截，**不调用付费上游**。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = process.env.ORDER_BASE || 'http://127.0.0.1:3310'
const MARK = `ORDER12-${Date.now().toString(36).toUpperCase()}`

const results = []
const notExecuted = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }
const skip = (name, why) => { notExecuted.push({ name, why }); console.log(`NOT-EXECUTED ${name} :: ${why}`) }

const browser = await chromium.launch()
let session
try { session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD }) }
catch (e) { if (e?.throttled) { await browser.close(); exitThrottled(e.message) } await browser.close(); throw e }
const page = session.page

const api = (path, options = {}) => page.evaluate(async ({ path, options }) => {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options, cache: 'no-store' })
  const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* ignore */ }
  return { status: r.status, json: j, text: t.slice(0, 300) }
}, { path, options })

/** 真实生成一个作品，返回 { logId, url }。 */
const createWork = async (label) => {
  const created = await api('/api/image-tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: `${MARK} ${label}`, config: { model: 'e2e-image', count: 1, size: '1:1', quality: 'auto' } }),
  })
  const taskId = created.json?.task?.id
  if (!taskId) throw new Error(`生成任务创建失败：${created.text}`)
  for (let i = 0; i < 40; i += 1) {
    const t = await api(`/api/image-tasks/${encodeURIComponent(taskId)}`)
    if (['success', 'error', 'cancelled'].includes(t.json?.task?.status)) break
    await page.waitForTimeout(1500)
  }
  const probe = await api(`/api/generation-logs?page=1&pageSize=20&keyword=${encodeURIComponent(MARK)}`)
  const item = (probe.json?.items ?? []).find((i) => i.id === `image-task:${taskId}`)
  return { logId: `image-task:${taskId}`, url: item?.assets?.[0]?.serverUrl ?? item?.assets?.[0]?.url ?? null }
}

/** 上传并登记一张真实素材（素材库来源）。 */
const createAsset = async (title) => {
  return page.evaluate(async (name) => {
    const canvas = document.createElement('canvas')
    canvas.width = 96; canvas.height = 96
    const context = canvas.getContext('2d')
    context.fillStyle = '#2f6f6a'; context.fillRect(0, 0, 96, 96)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return { error: 'canvas 无法生成 PNG' }
    const form = new FormData()
    form.append('file', new File([blob], `${name}.png`, { type: 'image/png' }))
    form.append('type', 'image'); form.append('persistent', 'true')
    const storedResponse = await fetch('/api/reference-assets', { method: 'POST', body: form, credentials: 'include' })
    const stored = await storedResponse.json().catch(() => null)
    if (!storedResponse.ok || !stored?.url) return { error: stored?.error || `上传失败 ${storedResponse.status}` }
    const createdResponse = await fetch('/api/library-assets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'image', title: name, tags: ['ORDER12'], source: 'user-upload',
        data: { storageKey: stored.key, serverUrl: stored.url, dataUrl: stored.url, bytes: stored.bytes ?? blob.size, mimeType: 'image/png', width: 96, height: 96 } }),
    })
    const created = await createdResponse.json().catch(() => null)
    return { id: created?.data?.asset?.id ?? null, url: stored.url, error: created?.msg ?? null }
  }, title)
}

const readPicker = () => page.evaluate(() => {
  const status = document.querySelector('[data-testid="reference-picker-status"]')?.textContent ?? ''
  const m = status.match(/已选\s*(\d+)\/(\d+)/)
  return { count: m ? Number(m[1]) : null, status: status.trim(), urls: Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).map((n) => n.getAttribute('data-asset-url') || '') }
})
/** 只读通知区域，避免把页面其它无关文案当成本轮提示。 */
const readNotices = () => page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('.studio-notice'))
  return nodes.map((n) => n.textContent ?? '').join(' || ')
})

const waitForItem = async (url, tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    await page.waitForTimeout(700)
    const found = await page.evaluate((want) => Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).some((n) => (n.getAttribute('data-asset-url') || '') === want), url)
    if (found) return true
    const more = page.locator('[data-testid="reference-picker-more"]').first()
    if (await more.count()) { await more.click({ force: true }).catch(() => null); await page.waitForTimeout(300) }
  }
  return false
}
const clickItem = async (url) => { await page.locator(`[data-testid="reference-picker-item"][data-asset-url="${url}"]`).first().click({ force: true }); await page.waitForTimeout(600) }
const clickReload = async () => { await page.locator('[data-testid="reference-picker"] button:has-text("刷新素材")').first().click({ force: true }) }

/** 拦截生成请求以**只断言参数**，不调用付费上游；用后立即解除。 */
const submitRefs = async () => {
  const captured = []
  const handler = async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    let p = null; try { p = JSON.parse(route.request().postData() ?? 'null') } catch { /* ignore */ }
    captured.push(p)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task: { id: `order12-${Date.now()}`, kind: 'edit', status: 'pending', model: 'e2e-image' } }) })
  }
  await page.route('**/api/image-tasks', handler)
  try {
    await page.fill('#image-prompt', `${MARK} 提交 ${Date.now().toString(36)}`)
    await page.waitForTimeout(300)
    await page.locator('button[type="submit"]:visible').first().click()
    await page.waitForTimeout(3500)
  } finally { await page.unroute('**/api/image-tasks', handler).catch(() => null) }
  return captured.flatMap((p) => (p?.references ?? []).map((r) => ({ url: r.url, type: r.type })))
}

const createdAssetIds = []
try {
  await page.goto(`${BASE}/image`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  const workA = await createWork('A作品')
  const workB = await createWork('B作品')
  if (!workA.url || !workB.url) throw new Error('A/B 作品没有产出地址')
  console.log(`[A] ${workA.logId}\n[B] ${workB.logId}`)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  /* ================================================================
   * 1. 乱序：刷新期间新增的选择不得被旧响应清掉（核心）
   * ============================================================== */
  console.log('\n--- 1. 刷新期间新增选择 ---')
  const foundA = await waitForItem(workA.url)
  const foundB = await waitForItem(workB.url)
  if (!foundA || !foundB) {
    skip('乱序新增选择的所有断言', `候选池找不到作品 A=${foundA} B=${foundB}`)
  } else {
    await clickItem(workA.url)
    check('已选中作品 A', (await readPicker()).count === 1, `已选=${(await readPicker()).count}`)

    /**
     * **精确编排**：挂起素材库的"逐页读全"请求（素材库校验暂缓），
     * 作品校验（generation-logs）放行 → 让作品证据先完成。
     */
    let holdLibrary = true
    const heldLibrary = []
    const holdHandler = async (route) => {
      if (!holdLibrary) { await route.continue(); return }
      heldLibrary.push(route)
    }
    await page.route('**/api/library-assets**', holdHandler)
    await clickReload()
    await page.waitForTimeout(4000)
    check('旧刷新的素材库响应已被挂起（而不是固定 sleep 等待）', heldLibrary.length > 0, `挂起=${heldLibrary.length}`)

    /** 刷新尚未完成时再选 B。 */
    await clickItem(workB.url)
    check('刷新未完成时选中 B，已选为 2', (await readPicker()).count === 2, `已选=${(await readPicker()).count}`)

    /** 让 B 的新一轮校验先完成（作品校验放行，素材库仍挂起）。 */
    await page.waitForTimeout(5000)

    /** 释放旧刷新的素材库响应：它当时的查询范围只包含 A 那时的选择。 */
    holdLibrary = false
    for (const route of heldLibrary) { await route.continue().catch(() => null) }
    heldLibrary.length = 0
    await page.waitForTimeout(6000)
    await page.unroute('**/api/library-assets**', holdHandler).catch(() => null)

    const afterRelease = await readPicker()
    check('旧刷新响应到达后，A、B 都仍被选中', afterRelease.count === 2, `已选=${afterRelease.count}（期望 2）`)
    check('B 没有被误报为"已删除"', !/已确认删除/.test(await readNotices()), `通知=${(await readNotices()).slice(0, 120)}`)

    /** 必须断言**请求体实际携带的地址**，而不只是计数。 */
    const refs = await submitRefs()
    check('生成请求确实携带 A 的地址', refs.some((r) => r.url === workA.url), `携带 A=${refs.some((r) => r.url === workA.url)}`)
    check('生成请求确实携带 B 的地址（不只是计数为 2）', refs.some((r) => r.url === workB.url), `携带 B=${refs.some((r) => r.url === workB.url)} 共 ${refs.length} 条`)
  }

  /* ================================================================
   * 2. 取消后重新选择同一 ID
   * ============================================================== */
  console.log('\n--- 2. 取消后重选同一 ID ---')
  await clickItem(workB.url)
  const afterUntoggle = await readPicker()
  await clickItem(workB.url)
  const afterReselect = await readPicker()
  await clickReload()
  await page.waitForTimeout(5000)
  const afterReselectReload = await readPicker()
  check('取消 B 后已选减少、重选后恢复', afterUntoggle.count === 1 && afterReselect.count === 2,
    `取消后=${afterUntoggle.count} 重选后=${afterReselect.count}`)
  check('重选同一 ID 后刷新，B 仍被选中（快照按最新一次选择）', afterReselectReload.count === 2, `已选=${afterReselectReload.count}`)
  const refsReselect = await submitRefs()
  check('重选后生成请求仍携带 A 与 B',
    refsReselect.some((r) => r.url === workA.url) && refsReselect.some((r) => r.url === workB.url),
    `携带 A=${refsReselect.some((r) => r.url === workA.url)} B=${refsReselect.some((r) => r.url === workB.url)}`)

  /* ================================================================
   * 3. 混合来源：一边确认删除、一边 503 → 两类结果都要可见
   * ============================================================== */
  console.log('\n--- 3. 删除 + 503 同时发生 ---')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  const asset = await createAsset(`${MARK}-素材`)
  if (asset.id) createdAssetIds.push(asset.id)
  console.log(`[素材] id=${asset.id} url=${String(asset.url).slice(0, 60)}`)
  if (!asset.id) {
    skip('删除+503 的断言', `隔离素材创建失败：${asset.error ?? ''}`)
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(8000)
    const foundAsset = await waitForItem(asset.url)
    const foundWork = await waitForItem(workA.url)
    if (!foundAsset || !foundWork) {
      skip('删除+503 的断言', `候选池素材=${foundAsset} 作品=${foundWork}`)
    } else {
      await clickItem(asset.url)
      await clickItem(workA.url)
      check('已同时选中素材库资产与生成作品', (await readPicker()).count === 2, `已选=${(await readPicker()).count}`)

      /** 作品接口改成 503：作品来源"未确认"。 */
      const failWorks = async (route) => { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟作品校验失败' }) }) }
      await page.route('**/api/generation-logs**', failWorks)
      /** 素材库那条**真实删除**。 */
      const del = await api(`/api/library-assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' })
      console.log(`[删除素材] status=${del.status}`)
      await clickReload()
      await page.waitForTimeout(7000)

      const notices = await readNotices()
      const afterMixed = await readPicker()
      console.log(`[通知] ${notices.slice(0, 300)}`)
      check('素材库那条被正确清理、作品那条被保留', afterMixed.count === 1, `已选=${afterMixed.count}（期望 1）`)
      check('提示说明了"移除了哪个来源的失效选择"', /已确认删除并从已选中移除[^\n]*素材库/.test(notices),
        `出现=${/已确认删除并从已选中移除[^\n]*素材库/.test(notices)}`)
      check('提示同时说明了"哪个来源未确认、已保留选择"', /尚未确认、已保留选择[^\n]*生成作品/.test(notices),
        `出现=${/尚未确认、已保留选择[^\n]*生成作品/.test(notices)}`)
      check('删除与失败两类结果都在同一条提示里（不互相覆盖）',
        /已确认删除/.test(notices) && /尚未确认/.test(notices),
        `删除=${/已确认删除/.test(notices)} 未确认=${/尚未确认/.test(notices)}`)
      const refsMixed = await submitRefs()
      check('生成请求保留未确认的作品、去掉已删除的素材',
        refsMixed.some((r) => r.url === workA.url) && !refsMixed.some((r) => r.url === asset.url),
        `携带作品=${refsMixed.some((r) => r.url === workA.url)} 携带已删素材=${refsMixed.some((r) => r.url === asset.url)}`)
      await page.unroute('**/api/generation-logs**', failWorks).catch(() => null)
    }
  }

  /* ================================================================
   * 4. 仍存在的作品不误删；真实删除可清理
   * ============================================================== */
  console.log('\n--- 4. 不误删 / 真删除 ---')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  if (!await waitForItem(workB.url)) {
    skip('不误删/真删除断言', '候选池找不到 B 作品')
  } else {
    await clickItem(workB.url)
    await clickReload()
    await page.waitForTimeout(5000)
    check('作品仍存在时刷新，不误删', (await readPicker()).count === 1, `已选=${(await readPicker()).count}`)

    const delB = await api('/api/generation-logs', { method: 'DELETE', body: JSON.stringify({ ids: [workB.logId] }) })
    check('服务端已真实删除作品 B', delB.status === 200, `status=${delB.status} ${JSON.stringify(delB.json)}`)
    await clickReload()
    await page.waitForTimeout(6000)
    const afterRealDelete = await readPicker()
    check('真实删除后刷新，作品被清理', afterRealDelete.count === 0, `已选=${afterRealDelete.count}`)
    check('提示说明了移除的是生成作品来源', /已确认删除并从已选中移除[^\n]*生成作品/.test(await readNotices()),
      `通知=${(await readNotices()).slice(0, 140)}`)
  }

  /* ================================================================
   * 5. 删除 A 同时新增 B（数量不变）
   * ============================================================== */
  console.log('\n--- 5. 删 A 增 B 数量不变 ---')
  const workA2 = await createWork('A2作品')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  if (!await waitForItem(workA2.url)) {
    skip('删 A 增 B 断言', '候选池找不到 A2')
  } else {
    await clickItem(workA2.url)
    const before = (await api('/api/generation-logs?page=1&pageSize=1')).json?.total ?? 0
    await api('/api/generation-logs', { method: 'DELETE', body: JSON.stringify({ ids: [workA2.logId] }) })
    await createWork('B2作品')
    const after = (await api('/api/generation-logs?page=1&pageSize=1')).json?.total ?? 0
    check('构造出"删除 A 同时新增 B、总数不变"的场景', before === after, `前=${before} 后=${after}`)
    await clickReload()
    await page.waitForTimeout(6000)
    const afterSwap = await readPicker()
    check('数量不变但内容变了时，A2 仍被正确清理（不因长度相同而漏判）', afterSwap.count === 0, `已选=${afterSwap.count}`)
  }

  /* ================================================================
   * 6. 搜索无结果不参与存活判定
   * ============================================================== */
  console.log('\n--- 6. 搜索无结果 ---')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  if (!await waitForItem(workA.url)) {
    skip('搜索无结果断言', '候选池找不到 A 作品')
  } else {
    await clickItem(workA.url)
    const beforeSearch = await readPicker()
    const search = page.locator('[data-testid="reference-picker-search"]').first()
    await search.fill('ZZZNOMATCHORDER12')
    await search.press('Enter')
    await page.waitForTimeout(4000)
    const afterSearch = await readPicker()
    check('搜索无结果时已选数量不变（搜索不参与存活判定）',
      afterSearch.count === beforeSearch.count, `搜索前=${beforeSearch.count} 搜索后=${afterSearch.count}`)
    await search.fill('')
    await search.press('Enter')
    await page.waitForTimeout(3000)
  }

  /* ================================================================
   * 7. 视频工作台：同一套规则（多参考模式）
   * ============================================================== */
  console.log('\n--- 7. 视频工作台同规则 ---')
  await page.goto(`${BASE}/video`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  const videoReload = page.locator('[data-testid="reference-picker"] button:has-text("刷新素材")')
  const videoPickers = await page.locator('[data-testid="reference-picker"]').count()
  check('视频工作台存在「刷新素材」入口（说明未通过禁用控件规避）', await videoReload.count() > 0, `刷新按钮=${await videoReload.count()} 选择器=${videoPickers}`)
  if (await videoReload.count() > 0) {
    await videoReload.first().click({ force: true })
    await page.waitForTimeout(7000)
    const videoStatus = await page.locator('[data-testid="reference-picker-status"]').first().innerText()
    check('视频工作台刷新后状态自洽（未出现异常计数）', /已选\s*\d+\/\d+/.test(videoStatus), `status="${videoStatus.trim()}"`)
  }
} catch (error) {
  check('执行过程中未抛出未预期异常', false, error instanceof Error ? error.message : String(error))
} finally {
  for (const id of createdAssetIds) await api(`/api/library-assets/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
  await browser.close()
}

const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，未执行 ${notExecuted.length}，失败 ${failed.length}`)
if (notExecuted.length) { console.log('未执行项：'); for (const item of notExecuted) console.log(` - ${item.name} :: ${item.why}`) }
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
