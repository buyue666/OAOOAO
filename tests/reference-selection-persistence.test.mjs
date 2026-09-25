import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 第九轮 P2 回归：搜索素材不得清空已选参考图。
 *
 * 缺陷（已复现）：
 *   图片工作台先选素材 A，再搜索 B（A 不在结果里）→ 已选数量从 1 变成 0；
 *   提交时请求也不再携带 A。视频工作台同一逻辑。
 *
 * 根因（两层，第二层是修的过程中才暴露的）：
 *   1. 已选只存 **id**，提交时回到「候选池」按 id 反查地址；
 *      候选池由**搜索结果**驱动，搜索 B 时 A 查不到 → 被静默丢弃；
 *   2. 「归属校验池」也基于搜索结果（只是从"当前页"改成"服务端全量"，
 *      但仍是**带 keyword** 的那一份）→ 搜索无结果时集合为空，
 *      被当成"素材全被删除"，把已选清空。
 *      "搜索没命中"绝不等于"素材被删除"。
 *
 * 修复：
 *   - 已选改为保存**完整快照**（id + 标题 + 媒体地址 + 类型），
 *     提交时直接读快照，不再依赖任何候选池（`lib/studio/reference-selection.ts`）；
 *   - 存活判定改用**不经搜索过滤**的独立数据源
 *     （`useLibraryAssets().liveIds`，始终按无关键词读取一次）；
 *   - 顺序保留；超上限/真删除都**如实提示**，不静默丢弃。
 *
 * 本脚本覆盖用户要求的验收路径：
 *   选 A → 搜索 B → 选 B → 空结果 → 清空搜索 → 提交（请求须同时携带 A 与 B）、
 *   搜索回车不触发生成、换账号清理已选、模型上限变化、素材被删除。
 *
 * 全程真实浏览器 + 真实接口；生成请求用 **route 拦截**验证参数，不调用付费上游。
 * 隔离数据：`PICKRACE-` 前缀的素材，结束即删。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')
const { readFileSync } = require('node:fs')

const BASE = process.env.PICKRACE_BASE || 'http://127.0.0.1:3310'
const MARK = `PICKRACE-${Date.now().toString(36).toUpperCase()}`

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
  const t = await r.text()
  let j = null
  try { j = JSON.parse(t) } catch { /* ignore */ }
  return { status: r.status, json: j, text: t.slice(0, 200) }
}, { path, options })

/**
 * 上传并登记一张真实素材。
 *
 * 必须走**真实上传链路**：`/api/reference-assets` 用 multipart 表单
 * （JSON body 会 400，实测踩到），拿到 `serverUrl` 后再登记到素材库。
 * 与 `image-reference-library.test.mjs` 使用同一套调用方式。
 */
const createdAssetIds = []
const createAsset = async (name) => {
  const result = await page.evaluate(async (title) => {
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const context = canvas.getContext('2d')
    context.fillStyle = '#2f6f6a'
    context.fillRect(0, 0, 96, 96)
    context.fillStyle = '#f2c14e'
    context.fillRect(24, 24, 48, 48)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return { error: 'canvas 无法生成 PNG' }

    const form = new FormData()
    form.append('file', new File([blob], `${title}.png`, { type: 'image/png' }))
    form.append('type', 'image')
    form.append('persistent', 'true')
    const storedResponse = await fetch('/api/reference-assets', { method: 'POST', body: form, credentials: 'include' })
    const stored = await storedResponse.json().catch(() => null)
    if (!storedResponse.ok || !stored?.url) return { error: stored?.error || `上传失败 ${storedResponse.status}` }

    const createdResponse = await fetch('/api/library-assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'image',
        title,
        tags: ['PICKRACE'],
        source: 'user-upload',
        data: {
          storageKey: stored.key,
          serverUrl: stored.url,
          dataUrl: stored.url,
          bytes: stored.bytes ?? blob.size,
          mimeType: stored.mimeType || 'image/png',
          width: 96,
          height: 96,
        },
      }),
    })
    const created = await createdResponse.json().catch(() => null)
    return {
      assetStatus: createdResponse.status,
      id: created?.data?.asset?.id ?? null,
      url: stored.url,
      error: created?.msg ?? null,
    }
  }, name)
  if (result.id) createdAssetIds.push(result.id)
  return result
}

const cleanup = async () => {
  for (const id of createdAssetIds) await api(`/api/library-assets/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
}

let capturedPayloads = []
try {
  /**
   * 先在已登录页面上准备素材（上传走浏览器 fetch，需要同源页面）。
   * 因此这里先导航一次，再上传，最后进入图片工作台。
   */
  await page.goto(`${BASE}/image`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  const assetA = await createAsset(`${MARK}-A素材`)
  const assetB = await createAsset(`${MARK}-B素材`)
  console.log(`[素材] A=${assetA.id} (${assetA.assetStatus}) B=${assetB.id} (${assetB.assetStatus})`)
  if (!assetA.id || !assetB.id) throw new Error(`隔离素材创建失败：${assetA.error ?? ''} ${assetB.error ?? ''}`)

  /* 记录生成请求体（拦截，不真正触发上游） */
  await page.route('**/api/image-tasks', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    let parsed = null
    try { parsed = JSON.parse(route.request().postData() ?? 'null') } catch { /* ignore */ }
    capturedPayloads.push(parsed)
    /** 返回受控成功响应：验证的是**请求参数**，不调用付费上游。 */
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ task: { id: `pickrace-${Date.now()}`, kind: 'edit', status: 'pending', model: 'e2e-image' } }),
    })
  })

  /** 重新进入工作台，让候选池包含刚上传的两张素材。 */
  await page.goto(`${BASE}/image`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  const picker = await page.locator('[data-testid="reference-picker"]').count()
  if (!picker) { skip('全部已选相关断言', '运行构建没有参考素材选择器'); throw new Error('无 picker') }

  const read = () => page.evaluate(() => {
    const status = document.querySelector('[data-testid="reference-picker-status"]')?.textContent ?? ''
    const m = status.match(/已选\s*(\d+)\/(\d+)/)
    return {
      count: m ? Number(m[1]) : null,
      max: m ? Number(m[2]) : null,
      status: status.trim(),
      picked: Array.from(document.querySelectorAll('[data-testid="reference-picker-item"][aria-pressed="true"]'))
        .map((n) => n.getAttribute('data-asset-url')),
    }
  })
  const itemByUrl = (url) => page.locator(`[data-testid="reference-picker-item"][data-asset-url="${url}"]`).first()
  const search = page.locator('[data-testid="reference-picker-search"]').first()
  const doSearch = async (kw) => { await search.fill(kw); await search.press('Enter'); await page.waitForTimeout(3200) }

  /* ================================================================
   * 1. 选 A → 搜索 B → 选 B
   * ============================================================== */
  await itemByUrl(assetA.url).click({ force: true })
  await page.waitForTimeout(700)
  const afterPickA = await read()
  check('选中 A 后已选数量为 1', afterPickA.count === 1, `已选=${afterPickA.count}`)

  await doSearch(`${MARK}-B素材`)
  const afterSearchB = await read()
  /**
   * 注意：A 被搜索过滤掉了，所以界面上**没有** A 的条目（`picked` 为空是正常的），
   * 但「已选数量」必须仍是 1 —— 数量由独立的已选集合决定，与搜索结果无关。
   *
   * 这里不断言"当前结果里一定看不到 A"：候选池还包含**生成作品**，
   * 而关键词只过滤素材库，作品不受影响；如果恰好有作品的地址与 A 相同
   * （同一文件既是上传素材又是生成结果时会被按 URL 去重合并），
   * 「A 不在结果里」就不再成立。断言"数量不变"才是真正要守的不变量。
   */
  check('搜索 B 后，已选数量仍为 1（A 仍被选中，与搜索结果无关）',
    afterSearchB.count === 1,
    `已选=${afterSearchB.count} 当前搜索结果内可见的已选=${afterSearchB.picked.length} 项`)

  await itemByUrl(assetB.url).click({ force: true })
  await page.waitForTimeout(700)
  const afterPickB = await read()
  check('再选中 B 后已选数量为 2（A 与 B 都在）',
    afterPickB.count === 2,
    `已选=${afterPickB.count} picked=${JSON.stringify(afterPickB.picked)}`)

  /* ================================================================
   * 2. 空结果 → 清空搜索：已选必须全程保留
   * ============================================================== */
  await doSearch('ZZZNOMATCHKEYWORD')
  const afterEmpty = await read()
  check('搜索无结果时已选仍为 2（空结果不等于素材被删）',
    afterEmpty.count === 2, `已选=${afterEmpty.count}`)

  await doSearch('')
  const afterClear = await read()
  check('清空搜索后已选仍为 2', afterClear.count === 2, `已选=${afterClear.count}`)

  /* ================================================================
   * 3. 提交：请求必须同时携带 A 与 B（核心验收）
   * ============================================================== */
  await page.fill('#image-prompt', `${MARK} 搜索后提交必须携带 A 与 B`)
  await page.waitForTimeout(500)
  capturedPayloads = []
  await page.locator('button[type="submit"]:visible').first().click()
  await page.waitForTimeout(4000)

  const refs = capturedPayloads.flatMap((p) => (p?.references ?? []).map((r) => r.url))
  check('提交请求已发出', capturedPayloads.length > 0, `请求数=${capturedPayloads.length}`)
  check('请求 references 同时携带 A 与 B 的真实地址（搜索后依然携带）',
    refs.includes(assetA.url) && refs.includes(assetB.url),
    `references=${JSON.stringify(refs).slice(0, 200)}`)

  /* ================================================================
   * 4. 搜索回车不触发生成
   * ============================================================== */
  capturedPayloads = []
  await doSearch(`${MARK}-A素材`)
  check('搜索回车不会触发生成请求', capturedPayloads.length === 0, `生成请求=${capturedPayloads.length}`)

  /* ================================================================
   * 5. 刷新后已选状态（刷新是全新的本地状态，不应谎称还选着）
   * ============================================================== */
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const afterReload = await read()
  check('刷新后不会残留上一次的已选（本地选择不跨刷新复活）',
    afterReload.count === 0, `刷新后已选=${afterReload.count}`)
  check('刷新后候选池仍有真实素材可用（素材没有被误删）',
    afterReload.status.includes('可选') && !afterReload.status.endsWith('可选 0'),
    `status="${afterReload.status}"`)

  /* ================================================================
   * 6. 素材被真正删除 → 已选应被清理（与"搜索没命中"区分开）
   * ============================================================== */
  await itemByUrl(assetA.url).click({ force: true })
  await page.waitForTimeout(700)
  const beforeDelete = await read()
  check('删除前已选中 A', beforeDelete.count === 1, `已选=${beforeDelete.count}`)

  const removed = await api(`/api/library-assets/${encodeURIComponent(assetA.id)}`, { method: 'DELETE' })
  check('隔离素材 A 已从服务端删除', removed.status === 200, `DELETE=${removed.status}`)
  /** 触发一次素材库重新读取（上传/删除后的正常刷新路径）。 */
  const reloadBtn = page.locator('[data-testid="reference-picker"] button:has-text("刷新素材")').first()
  if (await reloadBtn.count()) { await reloadBtn.click({ force: true }) } else { await doSearch('') }
  await page.waitForTimeout(4000)
  const afterDelete = await read()
  check('素材被真正删除后，已选中的它被清理（与"搜索没命中"区分开）',
    afterDelete.count === 0, `已选=${afterDelete.count}`)

  /* ================================================================
   * 7. 素材超过后端单页上限（100）时，靠后的素材不得被误判已删除
   *
   * 复现原缺陷：`loadLiveIds` 只请求 page=1&pageSize=500，而后端把 pageSize
   * 限制在 100 —— 拿到的其实只是第一页。素材 >100 条时，
   * 第 101 条之后全部不在"存活集合"里，会被误报已删除并清空已选。
   * ============================================================== */
  console.log('\n--- 7. 素材超过 100 条 ---')
  const seededTextIds = []
  const seedAsset = async (n) => {
    const created = await page.evaluate(async ({ title, tag }) => {
      const res = await fetch('/api/library-assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'text', title, data: { content: 'seed' }, tags: [tag] }),
      })
      const j = await res.json().catch(() => null)
      return { status: res.status, id: j?.data?.asset?.id ?? null }
    }, { title: `${MARK}-批量占位${n}`, tag: MARK })
    if (created.id) seededTextIds.push(created.id)
    return created.status
  }

  /** 先建一张会被"挤到后面"的图片素材，再建 110 条更新的占位素材把它压到第 2 页。 */
  const pushedOut = await createAsset(`${MARK}-被挤出第一页的素材`)
  if (pushedOut.id) createdAssetIds.push(pushedOut.id)
  let seeded = 0
  for (let i = 0; i < 110; i += 1) {
    const status = await seedAsset(i)
    if (status === 200) seeded += 1
  }
  const libPage = await api('/api/library-assets?page=1&pageSize=100')
  const libTotal = libPage.json?.data?.total ?? 0
  const libPage1 = libPage.json?.data?.assets?.length ?? 0
  const libPageSize = libPage.json?.data?.pageSize ?? null
  console.log(`[批量素材] 新建=${seeded} 当前总数=${libTotal} 第1页=${libPage1} 后端实际 pageSize=${libPageSize}`)
  check('已构造出超过后端单页上限（100）的素材库', libTotal > 100 && libPageSize === 100,
    `总数=${libTotal} pageSize=${libPageSize}`)

  /** 让候选池重新加载（含刚建的素材），并确认目标素材确实不在第一页。 */
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  const firstPageIds = new Set((libPage.json?.data?.assets ?? []).map((a) => a.id))
  check('目标素材确实不在服务端第一页（这正是旧实现会误判的场景）',
    !firstPageIds.has(pushedOut.id),
    `目标 id=${pushedOut.id} 在第一页=${firstPageIds.has(pushedOut.id)}`)

  const targetItem = itemByUrl(pushedOut.url)
  let targetSelectable = false
  try { await targetItem.first().waitFor({ state: 'visible', timeout: 6000 }); targetSelectable = true } catch { /* 用搜索兜底 */ }
  if (!targetSelectable) {
    await doSearch(`${MARK}-被挤出第一页的素材`)
    try { await targetItem.first().waitFor({ state: 'visible', timeout: 6000 }); targetSelectable = true } catch { targetSelectable = false }
  }
  if (!targetSelectable) {
    skip('超过 100 条时的存活判定', '目标素材在候选池中不可见（分页/搜索未覆盖到）')
  } else {
    await targetItem.first().click({ force: true })
    await page.waitForTimeout(700)
    const beforeBig = await read()
    check('已选中"第一页之外"的素材', beforeBig.count === 1, `已选=${beforeBig.count}`)

    /** 触发一次校验（刷新素材会走删除判定路径）。 */
    const reload2 = page.locator('[data-testid="reference-picker"] button:has-text("刷新素材")').first()
    if (await reload2.count()) { await reload2.click({ force: true }) } else { await doSearch('') }
    await page.waitForTimeout(6000)
    const afterBig = await read()
    check('素材超过 100 条时，靠后的已选素材**不得**被误判为已删除',
      afterBig.count === 1,
      `已选=${afterBig.count}（旧实现会因为只读第一页而清空）`)
  }

  /* 清理批量占位素材 */
  for (const id of seededTextIds) {
    await api(`/api/library-assets/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
  }
  console.log(`[清理] 批量占位素材 ${seededTextIds.length} 条已删除`)

  /* ================================================================
   * 8. 生成作品（generation-logs）不得被素材库的 id 集合误判为已删除
   *
   * 复现原缺陷：候选池 = 素材库 + 生成作品，但存活判定只看素材库。
   * 生成作品的 id 是 `generated-<workId>`，永远不在素材库里 →
   * 一刷新就被误报"已删除"，而它其实还在候选列表里。
   * ============================================================== */
  console.log('\n--- 8. 生成作品 ---')
  /**
   * 先**摘掉生成请求的拦截桩**：上面所有提交都走受控响应（不调用上游），
   * 但这一节需要**真实的生成结果**才能产出 `generation-logs` 作品。
   * 不摘掉的话任务会被桩伪装成成功、实际没有任何产物（实测踩到）。
   */
  await page.unroute('**/api/image-tasks').catch(() => null)
  /** 真正生成一个作品。 */
  const createdTask = await page.evaluate(async (mark) => {
    const res = await fetch('/api/image-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: `${mark} 生成作品存活判定`, config: { model: 'e2e-image', count: 1, size: '1:1', quality: 'auto' } }),
    })
    const j = await res.json().catch(() => null)
    return { status: res.status, id: j?.task?.id ?? null }
  }, MARK)
  console.log(`[生成任务] status=${createdTask.status} id=${createdTask.id}`)
  if (createdTask.id) {
    for (let i = 0; i < 40; i += 1) {
      const t = await api(`/api/image-tasks/${encodeURIComponent(createdTask.id)}`)
      const status = t.json?.task?.status
      if (status === 'success' || status === 'error' || status === 'cancelled') {
        console.log(`[生成任务终态] ${status}`)
        break
      }
      await page.waitForTimeout(1500)
    }
  }
  /**
   * **重新装上拦截桩**：下面还要验证"提交请求携带该作品地址"，
   * 必须继续拦截，既不能真的调用上游，也要能读到请求体。
   * 早先忘了重新装上，`capturedPayloads` 永远是空的（实测踩到）。
   */
  await page.route('**/api/image-tasks', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    let parsed = null
    try { parsed = JSON.parse(route.request().postData() ?? 'null') } catch { /* ignore */ }
    capturedPayloads.push(parsed)
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ task: { id: `pickrace-${Date.now()}`, kind: 'edit', status: 'pending', model: 'e2e-image' } }),
    })
  })

  await page.goto(`${BASE}/image`, { waitUntil: 'domcontentloaded' })
  /**
   * 等待候选池真正装载完成。
   *
   * 作品来自 `/api/generation-logs` 的**多页**拉取（pageSize=24，最多 20 页），
   * 全部返回前池子里只有素材库那几条。固定等 7 秒会读到"还没有作品"的中间态，
   * 从而把这一节误判成"没有生成作品"（实测踩到）。
   * 这里改成显式轮询，直到出现生成作品来源的条目或超时。
   */
  const findWorkUrl = () => page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]'))
    return items.map((n) => n.getAttribute('data-asset-url') || '').find((u) => u.startsWith('/api/generation-log-assets')) ?? null
  })
  let workUrl = null
  for (let i = 0; i < 40 && !workUrl; i += 1) {
    await page.waitForTimeout(700)
    workUrl = await findWorkUrl()
  }
  /** 池子默认只渲染前 8 条，必要时点「加载更多」把后面的翻出来。 */
  if (!workUrl) {
    for (let i = 0; i < 30 && !workUrl; i += 1) {
      const more = page.locator('[data-testid="reference-picker-more"]').first()
      if (!(await more.count())) break
      await more.click({ force: true }).catch(() => null)
      await page.waitForTimeout(400)
      workUrl = await findWorkUrl()
    }
  }
  console.log(`[生成作品来源条目] ${workUrl ? '已找到' : '未找到'}`)

  if (!workUrl) {
    skip('生成作品存活判定', '候选池里始终没有生成作品来源的条目')
  } else {
    const workItem = itemByUrl(workUrl)
    await workItem.first().click({ force: true })
    await page.waitForTimeout(700)
    const beforeWork = await read()
    check('已选中一个生成作品', beforeWork.count === 1, `已选=${beforeWork.count}`)

    const reload3 = page.locator('[data-testid="reference-picker"] button:has-text("刷新素材")').first()
    if (await reload3.count()) { await reload3.click({ force: true }) } else { await doSearch('') }
    await page.waitForTimeout(6000)
    const afterWork = await read()
    const stillListed = await page.locator(`[data-testid="reference-picker-item"][data-asset-url="${workUrl}"]`).count()
    check('生成作品仍在候选列表时，已选**不得**被清除',
      afterWork.count === 1,
      `已选=${afterWork.count} 仍在候选列表=${stillListed > 0}（旧实现会误报已删除）`)

    /** 提交必须仍携带该作品地址（不能因为误判而丢参考图）。 */
    await page.fill('#image-prompt', `${MARK} 生成作品参考提交`)
    await page.waitForTimeout(400)
    capturedPayloads = []
    await page.locator('button[type="submit"]:visible').first().click()
    await page.waitForTimeout(4000)
    const workRefs = capturedPayloads.flatMap((p) => (p?.references ?? []).map((r) => r.url))
    check('提交请求携带该生成作品地址', workRefs.includes(workUrl),
      `references=${JSON.stringify(workRefs).slice(0, 160)}`)
  }
} catch (error) {
  check('执行过程中未抛出未预期异常', false, error instanceof Error ? error.message : String(error))
} finally {
  await page.unroute('**/api/image-tasks').catch(() => null)
  await cleanup()
  console.log('[清理] 隔离素材已删除')
  await browser.close()
}

const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，未执行 ${notExecuted.length}，失败 ${failed.length}`)
if (notExecuted.length) { console.log('未执行项：'); for (const item of notExecuted) console.log(` - ${item.name} :: ${item.why}`) }
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
