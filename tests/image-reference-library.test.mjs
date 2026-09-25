import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 图片工作台「从素材库选择」参考图回归验收。
 *
 * 复现并锁定一个真实缺陷（P2）：
 *   `/assets` 能上传素材，但图片工作台 `/image` 的「从素材库选择」
 *   **从不调用素材库接口**，候选池只来自生成结果 → 用户上传的图永远选不到。
 *
 * 本脚本覆盖完整链路：
 *   1. 通过真实 HTTP 上传并登记一个图片素材（`/api/reference-assets` + `/api/library-assets`）；
 *   2. 确认它在素材库接口里可见；
 *   3. 在真实浏览器中确认它出现在图片工作台「从素材库选择」里且**可选中**；
 *   4. 选中后提交生成，**拦截 `POST /api/image-tasks`** 并断言请求体里
 *      真的带上了该素材的 URL（不是只渲染了缩略图）；
 *   5. 刷新页面 / 新建上下文（等价重新登录）后素材仍然可选。
 *
 * 关于运行环境（重要，不做静默跳过）：
 *   3310 上跑的是**修复前构建**时，第 3~5 步会真实失败并打印 FAIL——
 *   这是缺陷证据，不是脚本错误。脚本会同时打印「构建版本探针」，
 *   明确区分「构建里还没有这次修复」与「修复没生效」。
 *
 * 用法：node tests/image-reference-library.test.mjs
 *   退出码 0 = 全部通过；1 = 有断言失败；2 = 环境限流（非功能缺陷）。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3310'
const MARK = `ZLIB${Date.now().toString(36).toUpperCase()}`
const ASSET_TITLE = `E2E-素材库参考图-${MARK}`

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }
const info = (text) => console.log(`[信息] ${text}`)

/* ======================================================================
 * 0. 登录（复用缓存会话，避免消耗 15 分钟 8 次的登录限流）
 * ==================================================================== */

const browser = await chromium.launch()
let page
try {
  const session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
  page = session.page
  console.log(`[会话] ${session.reused ? '复用已登录会话' : '已重新登录'}`)
} catch (error) {
  if (error.throttled) { await browser.close(); exitThrottled(error.message) }
  throw error
}

/** 在页面上下文里调用站内接口，自动带登录 Cookie。 */
const api = (path, init) => page.evaluate(async ({ path, init }) => {
  const response = await fetch(path, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
  return { status: response.status, body }
}, { path, init })

/* ======================================================================
 * 1. 真实 HTTP 上传图片素材（两步：持久化上传 + 登记素材库）
 * ==================================================================== */

const uploaded = await page.evaluate(async ({ title }) => {
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
  if (!storedResponse.ok || !stored?.url) return { error: stored?.error || `上传失败 ${storedResponse.status}`, uploadStatus: storedResponse.status }

  const createdResponse = await fetch('/api/library-assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'image',
      title,
      tags: ['E2E', '参考图回归'],
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
    uploadStatus: storedResponse.status,
    assetStatus: createdResponse.status,
    assetId: created?.data?.asset?.id ?? null,
    referenceUrl: stored.url,
    storageKey: stored.key,
    error: created?.msg ?? null,
  }
}, { title: ASSET_TITLE })

check('上传图片素材到服务器（持久地址）', uploaded.uploadStatus === 200 && Boolean(uploaded.referenceUrl),
  `status=${uploaded.uploadStatus} url=${String(uploaded.referenceUrl).slice(0, 48)} err=${uploaded.error ?? '-'}`)
check('素材登记到素材库', uploaded.assetStatus === 200 && Boolean(uploaded.assetId),
  `status=${uploaded.assetStatus} id=${uploaded.assetId ?? '-'} msg=${JSON.stringify(uploaded.error)}`)

if (!uploaded.assetId || !uploaded.referenceUrl) {
  console.log('\n上传前置步骤失败，后续浏览器断言无法进行。')
  await browser.close()
  process.exit(1)
}

/* ======================================================================
 * 2. 素材库接口可见（服务端持久化，刷新/换浏览器可恢复）
 * ==================================================================== */

const listed = await api(`/api/library-assets?page=1&pageSize=50&kind=image&keyword=${encodeURIComponent(MARK)}`)
const listedAsset = (listed.body?.data?.assets ?? []).find((asset) => asset.id === uploaded.assetId) ?? null
check('素材在素材库接口中可见（服务端分页可查）', Boolean(listedAsset),
  `status=${listed.status} total=${listed.body?.data?.total} 命中=${listedAsset ? 1 : 0}`)
check('素材库返回的地址与上传地址一致', listedAsset ? (listedAsset.data?.serverUrl === uploaded.referenceUrl) : false,
  `listed=${String(listedAsset?.data?.serverUrl).slice(0, 48)}`)

const fetchable = await page.evaluate(async (url) => {
  const response = await fetch(url, { credentials: 'include' })
  const blob = await response.blob()
  return { status: response.status, size: blob.size, type: blob.type }
}, uploaded.referenceUrl)
check('素材文件真实可取到（不是坏链）', fetchable.status === 200 && fetchable.size > 0,
  `status=${fetchable.status} size=${fetchable.size} type=${fetchable.type}`)

/* ======================================================================
 * 3. 图片工作台「从素材库选择」可选中该素材
 * ==================================================================== */

/**
 * 构建版本探针：区分「3310 上还是修复前的构建」与「修复没生效」。
 * 修复后的选择器带 `data-testid="reference-picker"`，修复前没有。
 *
 * 注意：这里刻意**不把「构建是否含修复」当成断言**——测试必须如实报告
 * 在**当前运行的构建**上真实观察到的结果，而不是把自己的期望编码成前提。
 * 构建版本只作为诊断信息打印，用于解释后面的失败属于哪一类。
 */
const openImageWorkspace = async () => {
  await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(6000)
}

await openImageWorkspace()

const buildProbe = await page.evaluate(() => ({
  hasPicker: Boolean(document.querySelector('[data-testid="reference-picker"]')),
  pickerItems: document.querySelectorAll('[data-testid="reference-picker-item"]').length,
  pickerText: (document.body.innerText.match(/从素材库选择[^\n]*/) || [''])[0],
  libraryRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/library-assets')).length,
}))
info(`构建版本探针：picker 容器=${buildProbe.hasPicker} 缩略图=${buildProbe.pickerItems} 文案="${buildProbe.pickerText}" 页面素材库请求=${buildProbe.libraryRequests}`)
if (!buildProbe.hasPicker) {
  info('3310 上运行的构建**不含本次修复**（缺少 reference-picker 容器），步骤 3~5 的浏览器断言会如实失败。')
}

/** 找到目标素材的缩略图按钮：按素材 URL 精确匹配，不用标题猜测。 */
const assetItem = page.locator(`[data-testid="reference-picker-item"][data-asset-url="${uploaded.referenceUrl}"]`)
let selectable = false
try {
  await assetItem.first().waitFor({ state: 'visible', timeout: 8000 })
  selectable = true
} catch {
  // 素材可能被分页挡在后面：按标题搜索一次再判定。
  const search = page.locator('[data-testid="reference-picker-search"]')
  if (await search.count()) {
    await search.first().fill(MARK)
    await search.first().press('Enter')
    await page.waitForTimeout(3000)
    try {
      await assetItem.first().waitFor({ state: 'visible', timeout: 8000 })
      selectable = true
    } catch { selectable = false }
  }
}

const pickerProbe = await page.evaluate(() => {
  const picker = document.querySelector('[data-testid="reference-picker"]')
  return {
    status: document.querySelector('[data-testid="reference-picker-status"]')?.textContent?.trim() ?? null,
    items: Array.from(document.querySelectorAll('[data-testid="reference-picker-item"]')).map((node) => ({ id: node.getAttribute('data-asset-id'), url: node.getAttribute('data-asset-url'), label: node.getAttribute('aria-label') })),
    // 兜底：修复后的选择器会带 data-testid；修复前的构建里这些属性不存在，
    // 因此这里同时记录「页面上出现了多少个素材缩略图按钮」，便于人工判断。
    thumbButtons: document.querySelectorAll('button[aria-label^="选择 "], button[aria-label^="取消选择 "]').length,
    libraryRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/library-assets')).length,
    pickerFound: Boolean(picker),
    statusText: (document.body.innerText.match(/从素材库选择[^\n]*/) || [''])[0],
  }
})
/**
 * 「真实调用素材库接口」这一条**不能只数全局资源请求**：
 * 侧边栏/其它组件也可能请求 `/api/library-assets`（实测旧构建下就有 2 条），
 * 数全局请求会把缺陷误判成通过。这里改为要求选择器本身存在 —— 那才是
 * 「图片工作台的候选池真的接了素材库」的证据。
 */
check('图片工作台的选择器真的接上了素材库（candidates 来自素材库）', pickerProbe.pickerFound,
  `picker=${pickerProbe.pickerFound} 页面素材库请求=${pickerProbe.libraryRequests} 文案="${pickerProbe.statusText}"`)
check('上传素材出现在「从素材库选择」中且可选', selectable,
  `选择器=${pickerProbe.pickerFound ? '存在' : '缺失'} 候选=${pickerProbe.items.length} 素材缩略图按钮=${pickerProbe.thumbButtons} 目标URL=${uploaded.referenceUrl}`)
if (pickerProbe.items.length) {
  check('候选池没有重复地址（上传素材与生成结果不重复展示）',
    pickerProbe.items.length === new Set(pickerProbe.items.map((item) => item.url)).size,
    `候选=${pickerProbe.items.length} 去重后=${new Set(pickerProbe.items.map((item) => item.url)).size}`)
} else {
  // 不把「候选为 0」当成去重通过：那只是空集合上的恒真命题。
  info('界面上没有观察到候选缩略图（修复前的构建），去重规则改由第 7 节的纯函数断言覆盖。')
}

if (selectable) {
  await assetItem.first().click()
  await page.waitForTimeout(800)
  const selected = await assetItem.first().getAttribute('aria-pressed')
  check('点击后素材进入已选状态', selected === 'true', `aria-pressed=${selected}`)
  /**
   * 截图留证：截「参考素材」参数区（选择器本体），并在上方叠加自描述横幅。
   * 图上的文字与本节断言指向同一事实（候选数、目标 URL、已选状态），
   * 避免出现「图与断言对不上」的无效证据。
   */
  const banner = await page.evaluate(({ ok, count, url }) => {
    const picker = document.querySelector('[data-testid="reference-picker"]')
    if (!picker) return null
    const label = `${ok ? 'PASS' : 'FAIL'}｜候选=${count}｜已选素材 URL=${url}`
    const node = document.createElement('div')
    node.id = 'reflib-evidence'
    node.style.cssText = `background:${ok ? '#52c41a' : '#ff4d4f'};color:#000;font:600 12px/1.4 system-ui;padding:6px 10px;word-break:break-all`
    node.textContent = label
    picker.parentElement?.insertBefore(node, picker)
    return label
  }, { ok: selected === 'true', count: pickerProbe.items.length, url: uploaded.referenceUrl })
  const section = page.locator('[data-testid="reference-picker"]').first()
  await section.screenshot({ path: 'tests/.artifacts/P5-image-reference-picker.png' }).catch(async () => {
    // 元素截图失败（例如被滚动容器裁剪）时退回整页，仍保留横幅。
    await page.screenshot({ path: 'tests/.artifacts/P5-image-reference-picker.png', fullPage: false })
  })
  await page.evaluate(() => document.getElementById('reflib-evidence')?.remove())
  console.log(`[截图] tests/.artifacts/P5-image-reference-picker.png :: ${banner}`)
}

/* ======================================================================
 * 4. 提交生成：拦截 POST /api/image-tasks，断言请求体带着素材 URL
 * ==================================================================== */

/** 收集所有发往 image-tasks 的请求体（修复前这里会是空数组或 references 为空）。 */
const captured = []
page.on('request', (request) => {
  if (request.method() !== 'POST' || !request.url().includes('/api/image-tasks')) return
  let body = null
  try { body = JSON.parse(request.postData() ?? 'null') } catch { body = null }
  captured.push({ url: request.url(), body })
})

if (selectable) {
  await page.fill('#image-prompt', `${MARK} 参考图链路回归`)
  await page.waitForTimeout(500)
  /**
   * 提交按钮在页面上有**两个**：桌面表单里的那个，和移动端底部吸附栏里的那个。
   * 桌面视口下后者被父容器 `hidden` 隐藏（宽高为 0），而 `.last()` 恰好命中隐藏的那个，
   * 于是点击会 30 秒超时（实测踩到，是**测试选择器**问题，不是功能缺陷）。
   * 这里显式取**可见**的那个。
   */
  const submitButton = page.locator('button[type="submit"]:visible').first()
  let accepted = false
  let acceptanceNote = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await submitButton.click()
    await page.waitForTimeout(4000)
    const state = await page.evaluate((mark) => {
      const card = Array.from(document.querySelectorAll('article')).find((node) => node.innerText.includes(mark))
      return { hasCard: Boolean(card), concurrency: /并发上限|同时提交的任务过多/.test(document.body.innerText) }
    }, MARK)
    if (state.hasCard || captured.length) { accepted = true; break }
    if (state.concurrency) { acceptanceNote = '生成并发名额被占用（环境占用）'; await page.waitForTimeout(12000); continue }
    acceptanceNote = '提交后未观察到任务卡，也未捕获到 image-tasks 请求'
    break
  }
  if (!accepted) info(acceptanceNote)

  const referenceUrls = captured.flatMap((entry) => (entry.body?.references ?? []).map((reference) => reference.url ?? reference.dataUrl ?? reference.serverUrl ?? ''))
  check('提交生成时真实发出 POST /api/image-tasks', captured.length > 0, `捕获请求=${captured.length}`)
  check('请求体 references 携带所选素材的**具体 URL**', referenceUrls.includes(uploaded.referenceUrl),
    `references=${JSON.stringify(referenceUrls).slice(0, 200)} 期望包含=${uploaded.referenceUrl}`)
  check('带参考图时 kind 为 edit（走编辑链路）', captured.some((entry) => entry.body?.kind === 'edit'),
    `kind=${JSON.stringify(captured.map((entry) => entry.body?.kind))}`)
} else {
  check('提交生成时真实发出 POST /api/image-tasks', false, '素材在界面中不可选，未执行提交（修复前构建的预期结果）')
  check('请求体 references 携带所选素材的**具体 URL**', false, '素材在界面中不可选，未执行提交（修复前构建的预期结果）')
  check('带参考图时 kind 为 edit（走编辑链路）', false, '素材在界面中不可选，未执行提交（修复前构建的预期结果）')
}

/* ======================================================================
 * 5. 刷新页面 / 重新登录后素材仍然可选（服务端持久化，不依赖内存）
 * ==================================================================== */

/**
 * 本次运行实际读到的素材库响应，供第 7 节的纯函数断言直接使用
 * （同一份真实数据，不另造 fixture）。
 */
const librarySnapshot = listed.body?.data?.assets ?? []

await openImageWorkspace()
const afterReload = await page.evaluate((url) => ({
  selectable: Boolean(document.querySelector(`[data-testid="reference-picker-item"][data-asset-url="${url}"]`)),
  items: document.querySelectorAll('[data-testid="reference-picker-item"]').length,
  libraryRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/library-assets')).length,
}), uploaded.referenceUrl)
check('刷新页面后素材仍在「从素材库选择」中', afterReload.selectable,
  `候选=${afterReload.items} 素材库请求=${afterReload.libraryRequests}`)

/** 新上下文（等价「换浏览器/重新登录」）验证持久化，不影响主会话。 */
const freshContext = await browser.newContext({ viewport: { width: 1440, height: 950 }, storageState: await page.context().storageState() })
try {
  const freshPage = await freshContext.newPage()
  await freshPage.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
  await freshPage.waitForTimeout(6000)
  const freshProbe = await freshPage.evaluate((url) => ({
    selectable: Boolean(document.querySelector(`[data-testid="reference-picker-item"][data-asset-url="${url}"]`)),
    items: document.querySelectorAll('[data-testid="reference-picker-item"]').length,
    libraryRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/library-assets')).length,
  }), uploaded.referenceUrl)
  check('新浏览器上下文（重新登录）后素材仍可选', freshProbe.selectable,
    `候选=${freshProbe.items} 素材库请求=${freshProbe.libraryRequests}`)
} finally {
  await freshContext.close()
}

/* ======================================================================
 * 6. 分页不受「只显示前 8 个」限制
 * ==================================================================== */

const libraryTotal = listed.body?.data?.total ?? 0
const paging = await page.evaluate(() => {
  const picker = document.querySelector('[data-testid="reference-picker"]')
  if (!picker) return { found: false }
  return {
    found: true,
    items: picker.querySelectorAll('[data-testid="reference-picker-item"]').length,
    hasMore: Boolean(picker.querySelector('[data-testid="reference-picker-more"]')),
    hasSearch: Boolean(picker.querySelector('[data-testid="reference-picker-search"]')),
  }
})
if (paging.found && libraryTotal > paging.items) {
  check('素材超过一屏时提供继续查看/搜索能力（不只显示前几个）', paging.hasMore || paging.hasSearch,
    `素材库总数=${libraryTotal} 当前展示=${paging.items} 加载更多=${paging.hasMore} 搜索=${paging.hasSearch}`)
  // 触发一次「加载更多」，确认真的能展开而不是死按钮。
  if (paging.hasMore) {
    await page.locator('[data-testid="reference-picker-more"]').first().click()
    await page.waitForTimeout(600)
    const expanded = await page.locator('[data-testid="reference-picker-item"]').count()
    check('「加载更多」真的展开后续素材', expanded > paging.items, `${paging.items} → ${expanded}`)
  } else {
    info('素材库条目未超出单屏展示数量，未触发「加载更多」。')
  }
} else {
  check('素材库分页能力可用（本次素材数量未超出单屏）', paging.found ? paging.hasSearch : false,
    `素材库总数=${libraryTotal} 当前展示=${paging.items ?? 0}`)
}

/* ======================================================================
 * 7. 候选池与送审 URL 的纯函数断言（可在当前构建上直接执行）
 *
 *   这一节针对的是源码里真实存在的 `lib/studio/reference-assets.ts`：
 *   它现在承担了「上传素材如何进入候选池、已选素材如何变成请求体 references」
 *   的全部规则。3310 上跑的是修复前构建，浏览器步骤跑不到这段新代码，
 *   但这一节用**本次运行真实读取到的素材库响应**当输入，因此规则本身
 *   现在就能被验证 —— 而不是等到重新构建之后。
 * ==================================================================== */

let referenceLogic = null
try {
  referenceLogic = await import('../lib/studio/reference-assets.ts')
} catch (reason) {
  info(`无法直接加载 lib/studio/reference-assets.ts：${reason instanceof Error ? reason.message : reason}`)
}
check('源码里的候选池规则可被独立加载（纯函数，无 DOM/网络依赖）', Boolean(referenceLogic),
  referenceLogic ? 'loaded lib/studio/reference-assets.ts' : '加载失败，见上一行信息')

if (referenceLogic) {
  const { mergeReferenceAssets, resolveReferenceSelections, libraryAssetToReferenceAsset, workToReferenceAsset, isSubmittableReferenceUrl } = referenceLogic

  /** 用真实素材库响应构造候选（与组件里的用法完全一致）。 */
  const fromLibrary = (librarySnapshot.length ? librarySnapshot : [{ id: uploaded.assetId, kind: 'image', title: ASSET_TITLE, tags: ['E2E'], data: { serverUrl: uploaded.referenceUrl }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])
    .map(libraryAssetToReferenceAsset)
  const fromGenerated = [
    workToReferenceAsset({ id: 'w1', title: '生成结果 A', kind: 'image', src: uploaded.referenceUrl, fallback: 'A', status: '已完成', prompt: '', taskStatus: 'success' }),
    workToReferenceAsset({ id: 'w2', title: '生成结果 B', kind: 'image', src: '/api/generation-log-assets/permanent/b.png', fallback: 'B', status: '已完成', prompt: '', taskStatus: 'success' }),
    workToReferenceAsset({ id: 'w3', title: '坏链结果', kind: 'image', src: '', fallback: 'C', status: '已完成', prompt: '', taskStatus: 'success' }),
  ]

  const pool = mergeReferenceAssets([fromLibrary, fromGenerated])
  const poolUrls = pool.map((asset) => asset.src)
  check('上传素材进入候选池（修复前的图片工作台不会）', poolUrls.includes(uploaded.referenceUrl),
    `候选=${poolUrls.length} 包含上传素材=${poolUrls.includes(uploaded.referenceUrl)}`)
  check('同一 URL 不重复出现（上传 + 生成结果只保留一条）',
    poolUrls.filter((url) => url === uploaded.referenceUrl).length === 1 && new Set(poolUrls).size === poolUrls.length,
    `候选地址=${JSON.stringify(poolUrls).slice(0, 160)}`)
  check('没有可用地址的条目被排除（坏链不进候选池）', !poolUrls.includes('') && pool.length === 2,
    `候选=${pool.length} 空地址=${poolUrls.filter((url) => !url).length}`)
  check('blob:/data: 本地地址不进入候选池',
    !isSubmittableReferenceUrl('blob:http://127.0.0.1/abc') && !isSubmittableReferenceUrl('data:image/png;base64,AAA') && isSubmittableReferenceUrl('/api/reference-assets/permanent/a.png'),
    'blob/data 被拒绝，服务器地址被接受')

  const uploadedAssetId = fromLibrary.find((asset) => asset.src === uploaded.referenceUrl)?.id ?? uploaded.assetId
  const submitted = resolveReferenceSelections([uploadedAssetId], [pool], { maxReferences: 2, type: 'image' })
  check('已选的上传素材被解析成带**具体 URL** 的 references', submitted.length === 1 && submitted[0].url === uploaded.referenceUrl,
    `references=${JSON.stringify(submitted).slice(0, 200)}`)
  check('解析结果与 POST /api/image-tasks 的请求体结构一致（name/type/url）',
    submitted.every((reference) => typeof reference.name === 'string' && reference.type === 'image' && typeof reference.url === 'string'),
    JSON.stringify(submitted[0] ?? null))

  const capped = resolveReferenceSelections([uploadedAssetId, fromGenerated[1].id, fromGenerated[0].id], [pool], { maxReferences: 2 })
  check('选择数量受模型参考图上限约束', capped.length === 2, `上限=2 实际返回=${capped.length}`)
  check('模型上限为 0（不接受参考图）时不会提交任何参考素材',
    resolveReferenceSelections([uploadedAssetId], [pool], { maxReferences: 0 }).length === 0,
    'maxReferences=0 返回空数组')
}

/* ======================================================================
 * 8. 提交契约：真实后端接受「素材库地址」作为参考图（当前构建即可执行）
 *
 *   第 4 步的浏览器拦截要等 3310 换成含修复的构建才能跑；但「我们发出去的
 *   那个请求体，后端到底认不认」现在就能验：这里用**与
 *   `createImageTask` 完全相同的结构**（kind=edit + references[{name,type,url}]，
 *   url 就是素材库返回的站内地址）真实提交一次，断言后端接受并推进任务。
 * ==================================================================== */

const contractBody = {
  prompt: `${MARK} 参考图提交契约`,
  config: { model: 'e2e-image', size: '1:1' },
  kind: 'edit',
  references: [{ name: ASSET_TITLE, type: 'image', url: uploaded.referenceUrl }],
  source: 'image-workbench',
  context: { surface: 'chat' },
  title: `${MARK} 参考图提交契约`,
  clientRequestId: `e2e-ref-${MARK}`,
}
const contractCreated = await api('/api/image-tasks', { method: 'POST', body: JSON.stringify(contractBody) })
const contractTaskId = contractCreated.body?.task?.id ?? null
check('后端接受带素材库参考图的 POST /api/image-tasks', contractCreated.status === 200 && Boolean(contractTaskId),
  `status=${contractCreated.status} task=${contractTaskId ?? '-'} error=${contractCreated.body?.error ?? '-'}`)

let contractFinal = null
for (let index = 0; index < 10 && contractTaskId; index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const polled = await api(`/api/image-tasks/${contractTaskId}`)
  contractFinal = polled.body?.task ?? null
  if (['success', 'error', 'cancelled', 'needs_review'].includes(contractFinal?.status)) break
}
const referenceRejected = /参考(图|素材)|公网图片|能力不满足/.test(String(contractFinal?.error ?? ''))
check('参考图地址未被后端拒绝（任务没有因参考图失败）', Boolean(contractFinal) && !referenceRejected && contractFinal.status !== 'error',
  `最终状态=${contractFinal?.status ?? '-'} error=${contractFinal?.error ?? '-'}`)

/* ======================================================================
 * 9. 清理隔离测试素材
 * ==================================================================== */

const removed = await api(`/api/library-assets/${encodeURIComponent(uploaded.assetId)}`, { method: 'DELETE' })
check('隔离测试素材已删除', removed.status === 200, `status=${removed.status} body=${JSON.stringify(removed.body).slice(0, 120)}`)

/* ======================================================================
 * 汇总
 * ==================================================================== */

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`)
}
process.exit(failed.length ? 1 : 0)
