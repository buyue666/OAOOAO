import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 模型别名（可请求别名）的复现与回归验收。
 *
 * 用户报告：「模型需要设置别名的功能」。
 *
 * 复现结论（本轮已在真实环境核实）：
 *  - 逻辑模型的字段只有 `["id","name","capability","enabled","bindings"]`，**没有别名字段**。
 *    特意写入 `aliases: ["oaooao-image"]` 后，后端归一化直接丢弃（读回 `null`）。
 *  - 「显示名称」`name` **只影响界面展示**：把 `e2e-image` 的 name 改成
 *    「OAOOAO 图片模型」后，工作台下拉确实显示新名字，
 *    但用这个名字**请求会被拒绝**：
 *      `e2e-image`        → 200 已创建任务
 *      `OAOOAO 图片模型`   → 400「任务参数不完整」
 *      `oaooao-image`     → 400「任务参数不完整」
 *    也就是说「对外可用的模型名」当时只有 `id`，而 `id` 被已有任务、计价键
 *    `modelPointCosts`、默认模型引用着，为了对外名字去改 `id` 风险很高。
 *  - 管理端「逻辑模型与路由」里也没有任何别名字段。
 *
 * 本脚本覆盖：
 *   A. 路由编辑器里有别名入口，且能保存/清空；
 *   B. 别名写入后端并随会话下发；
 *   C. 用别名请求与用 `id` 请求解析到**同一个**模型（返回体 model 仍是 id）；
 *   D. 别名忽略大小写与 `models/` 前缀；
 *   E. 未登记的模型名仍然被拒绝（别名不是「放行任意名字」）；
 *   F. 冲突别名（撞到别的模型标识或别名）被后端拒绝并给出明确原因；
 *   G. 能力不匹配的别名不会被解析（图片别名不能当视频模型用）；
 *   H. 禁用该模型后别名立即失效；
 *   I. 别名不会成为独立计价对象（价格键仍按 id 解析）；
 *   J. 删除别名后立即失效。
 *
 * 本脚本只改动 `e2e-image` 的 `aliases` 字段，结束时按快照还原，不新增/删除任何模型。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const ALIAS_ONE = 'oaooao-image'
const ALIAS_TWO = 'image-latest'
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
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}, { path, init })

const getSettings = async () => (await api('/api/admin/settings')).body.settings
const getModels = async () => (await getSettings()).logicalModels

const original = await getModels()
const originalSettings = await getSettings()
const originalDefaults = originalSettings.defaultModels
const imageModel = original.find((model) => model.capability === 'image')
if (!imageModel) {
  console.log('环境中没有图片逻辑模型，无法验收别名功能')
  await browser.close()
  process.exit(1)
}
console.log(`[被测模型] ${imageModel.id}（原 aliases=${JSON.stringify(imageModel.aliases ?? null)}）`)

/**
 * 起点必须是「无别名」。
 *
 * 上一次运行若在还原前中断（例如脚本被终止），会残留别名的活动状态，
 * 于是「初始为空」这类断言会因为环境脏而失败——那是**脚本自身遗留**，
 * 不是功能缺陷（实测踩到过）。这里先归零再开始，并保证结束时会还原到
 * 本次运行开始时的真实快照。
 */
const preexistingAliases = original.filter((model) => (model.aliases ?? []).length).map((model) => model.id)
if (preexistingAliases.length) {
  console.log(`[环境] 检测到残留别名（${preexistingAliases.join(',')}），先重置到无别名基线`)
  await api('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ logicalModels: original.map((model) => ({ ...model, aliases: [] })) }),
  })
}
console.log(`[默认模型] ${JSON.stringify(originalDefaults)}`)

/**
 * 按快照还原 logicalModels **与 defaultModels**。
 *
 * 禁用某个逻辑模型会让后端把它从默认模型里摘掉
 * （`normalizeDefaultModelsConfig` 会清空不可解析的默认值），
 * 所以只还原 `logicalModels` 会留下「默认图片模型变成空」的副作用
 * （实测踩到）。这里两者都还原。
 */
const restore = async () => {
  await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ logicalModels: original, defaultModels: originalDefaults }) })
}

const submitImage = (model) => page.evaluate(async (model) => {
  const response = await fetch('/api/image-tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'model alias probe', config: { model, count: 1, size: '1:1', quality: 'auto' } }),
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}, model)

const openRoutingEditor = async () => {
  await page.goto(`${BASE}/admin/channels`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4500)
  await page.locator('button:has-text("修改默认模型与价格"), button:has-text("管理路由")').first().click()
  await page.waitForTimeout(2500)
}

/* ======================================================================
 * A. 路由编辑器有别名入口
 * ==================================================================== */

await openRoutingEditor()
const editorProbe = await page.evaluate((id) => {
  const dialog = document.querySelector('[role="dialog"]')
  const editor = dialog?.querySelector(`[data-testid="model-alias-editor-${id}"]`)
  const input = dialog?.querySelector(`[data-testid="model-alias-input-${id}"]`)
  const list = dialog?.querySelector(`[data-testid="model-alias-list-${id}"]`)
  return {
    hasEditor: Boolean(editor),
    inputLabel: input?.getAttribute('aria-label') ?? null,
    inputValue: input?.value ?? null,
    listText: list?.innerText ?? null,
    hasApply: Boolean(dialog?.querySelector(`[data-testid="model-alias-apply-${id}"]`)),
    hasClear: Boolean(dialog?.querySelector(`[data-testid="model-alias-clear-${id}"]`)),
  }
}, imageModel.id)
check('模型路由编辑器出现「请求别名」入口', editorProbe.hasEditor && editorProbe.hasApply, `probe=${JSON.stringify(editorProbe)}`)
check('别名输入框可定位且初始为空', editorProbe.inputLabel === `${imageModel.id} 别名` && editorProbe.inputValue === '', `label=${JSON.stringify(editorProbe.inputLabel)} value=${JSON.stringify(editorProbe.inputValue)}`)
// 未设置别名时，可请求名字就只有标识本身（标识始终可请求）。
const baselineNames = (editorProbe.listText ?? '').replace('可请求名字：', '').trim().split('\n').map((item) => item.trim()).filter(Boolean)
check('未设置别名时可请求名字只有标识本身', JSON.stringify(baselineNames) === JSON.stringify([imageModel.id]), `names=${JSON.stringify(baselineNames)}`)

/* ======================================================================
 * B. 通过界面保存别名
 * ==================================================================== */

await page.fill(`[data-testid="model-alias-input-${imageModel.id}"]`, `${ALIAS_ONE}，${ALIAS_TWO}`)
await page.click(`[data-testid="model-alias-apply-${imageModel.id}"]`)
await page.waitForTimeout(1500)
const afterApply = await page.evaluate((id) => {
  const dialog = document.querySelector('[role="dialog"]')
  return {
    listText: dialog?.querySelector(`[data-testid="model-alias-list-${id}"]`)?.innerText ?? null,
    error: dialog?.querySelector(`[data-testid="model-alias-error-${id}"]`)?.textContent?.trim() ?? null,
  }
}, imageModel.id)
check('中文逗号分隔的多个别名被接受', !afterApply.error && /oaooao-image/.test(afterApply.listText ?? '') && /image-latest/.test(afterApply.listText ?? ''), `list=${JSON.stringify(afterApply.listText)} error=${JSON.stringify(afterApply.error)}`)
check('可请求名字同时列出标识与别名', (afterApply.listText ?? '').includes(imageModel.id), `list=${JSON.stringify(afterApply.listText)}`)

await page.locator('[role="dialog"] button:has-text("保存路由配置")').first().click()
await page.waitForTimeout(4000)
const savedModels = await getModels()
const savedImage = savedModels.find((model) => model.id === imageModel.id)
check('别名已写入后端并持久化', JSON.stringify(savedImage?.aliases) === JSON.stringify([ALIAS_ONE, ALIAS_TWO]), `aliases=${JSON.stringify(savedImage?.aliases)}`)

const sessionModels = (await api('/api/auth/session')).body.settings?.logicalModels ?? []
const sessionImage = sessionModels.find((model) => model.id === imageModel.id)
check('别名随会话下发', JSON.stringify(sessionImage?.aliases) === JSON.stringify([ALIAS_ONE, ALIAS_TWO]), `session aliases=${JSON.stringify(sessionImage?.aliases)}`)

await page.locator('[role="dialog"] button[aria-label="关闭"]').first().click().catch(() => null)
await page.waitForTimeout(1200)

/* ======================================================================
 * C/D. 别名请求解析到同一个模型
 * ==================================================================== */

// 生成接口有并发上限；逐个提交并留出间隔，避免把「并发限流」误判成「别名不生效」。
const submitSequential = async (names) => {
  const out = []
  for (const name of names) {
    await page.waitForTimeout(7000)
    const result = await submitImage(name)
    const record = result.body?.task ?? result.body
    out.push({ name, status: result.status, id: record?.id ?? null, model: record?.model ?? null, error: result.body?.error ?? result.body?.msg ?? null })
  }
  return out
}

const attempts = await submitSequential([imageModel.id, ALIAS_ONE, ALIAS_TWO, `models/${ALIAS_ONE.toUpperCase()}`, 'definitely-not-a-model'])
const byId = attempts.find((item) => item.name === imageModel.id)
const byAliasOne = attempts.find((item) => item.name === ALIAS_ONE)
const byAliasTwo = attempts.find((item) => item.name === ALIAS_TWO)
const byPrefixed = attempts.find((item) => item.name === `models/${ALIAS_ONE.toUpperCase()}`)
const byUnknown = attempts.find((item) => item.name === 'definitely-not-a-model')

check('用模型标识请求成功', byId?.status === 200 && byId.model === imageModel.id, JSON.stringify(byId))
check('用别名请求成功并解析到同一个模型', byAliasOne?.status === 200 && byAliasOne.model === imageModel.id, JSON.stringify(byAliasOne))
check('用第二个别名请求同样解析到该模型', byAliasTwo?.status === 200 && byAliasTwo.model === imageModel.id, JSON.stringify(byAliasTwo))
check('别名忽略 models/ 前缀与大小写', byPrefixed?.status === 200 && byPrefixed.model === imageModel.id, JSON.stringify(byPrefixed))
check('未登记的模型名仍被拒绝（别名不是放行任意名字）', byUnknown?.status === 400 && /任务参数不完整/.test(byUnknown.error ?? ''), JSON.stringify(byUnknown))

/* ======================================================================
 * E/G/H/I. 边界
 * ==================================================================== */

// 冲突：别名撞到别的逻辑模型标识。
const textModel = original.find((model) => model.capability === 'text')
if (textModel) {
  const clash = JSON.parse(JSON.stringify(savedModels))
  clash.find((model) => model.id === imageModel.id).aliases = [...(savedImage.aliases ?? []), textModel.id]
  const clashResult = await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ logicalModels: clash }) })
  check('别名撞到其它模型标识时被后端拒绝并说明原因', clashResult.status === 400
    && new RegExp(`${imageModel.id}.*${textModel.id}`).test(clashResult.body?.error ?? ''),
    `status=${clashResult.status} error=${JSON.stringify(clashResult.body?.error)}`)

  // 冲突：别名撞到别的模型的别名。
  const clashAlias = JSON.parse(JSON.stringify(savedModels))
  clashAlias.find((model) => model.id === textModel.id).aliases = ['shared-name']
  clashAlias.find((model) => model.id === imageModel.id).aliases = [...(savedImage.aliases ?? []), 'shared-name']
  const clashAliasResult = await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ logicalModels: clashAlias }) })
  check('两个模型使用同一别名时被拒绝', clashAliasResult.status === 400, `status=${clashAliasResult.status} error=${JSON.stringify(clashAliasResult.body?.error)}`)
} else {
  check('别名撞到其它模型标识时被后端拒绝并说明原因', false, '环境缺少文本模型，无法构造冲突')
  check('两个模型使用同一别名时被拒绝', false, '环境缺少文本模型，无法构造冲突')
}

// 能力不匹配：把图片别名放到视频能力下不应被接受为视频模型。
const videoModel = original.find((model) => model.capability === 'video')
if (videoModel) {
  const wrongCapability = await page.evaluate(async ({ alias, videoId }) => {
    const response = await fetch('/api/video-generation-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'alias capability probe', config: { model: alias, seconds: 5, quality: '720' } }),
    })
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { body = text }
    return { status: response.status, body }
  }, { alias: ALIAS_ONE, videoId: videoModel.id })
  // 关键：不能因为「这个名字存在于图片模型上」就被视频接口当成视频模型接受。
  const record = wrongCapability.body?.task ?? wrongCapability.body
  check('图片模型的别名不会被视频能力接受', record?.model !== imageModel.id || wrongCapability.status >= 400,
    `status=${wrongCapability.status} model=${record?.model ?? '-'} error=${JSON.stringify(wrongCapability.body?.error ?? wrongCapability.body?.msg ?? '')}`)
} else {
  check('图片模型的别名不会被视频能力接受', false, '环境缺少视频模型，无法构造能力不匹配用例')
}

// 价格：别名不是独立计价对象，价格键仍按 id 解析。
const costs = (await getSettings()).modelPointCosts ?? {}
const costByAlias = costs[ALIAS_ONE]
const costById = costs[imageModel.id]
check('别名不会产生独立的计价键（价格仍记在标识上）', costByAlias === undefined && JSON.stringify(costs).includes(imageModel.id) === Object.prototype.hasOwnProperty.call(costs, imageModel.id),
  `costs[${ALIAS_ONE}]=${JSON.stringify(costByAlias)} costs[${imageModel.id}]=${JSON.stringify(costById)}`)

// 禁用模型后别名立即失效。
const disabled = JSON.parse(JSON.stringify(savedModels))
disabled.find((model) => model.id === imageModel.id).enabled = false
await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ logicalModels: disabled }) })
const disabledSession = (await api('/api/auth/session')).body.settings?.logicalModels ?? []
check('禁用逻辑模型后别名不再随会话下发', !disabledSession.some((model) => model.id === imageModel.id), `会话模型数=${disabledSession.length}`)
await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ logicalModels: savedModels }) })

/* ======================================================================
 * J. 删除别名后立即失效
 * ==================================================================== */

await openRoutingEditor()
const hadDraft = await page.evaluate((id) => document.querySelector(`[data-testid="model-alias-input-${id}"]`)?.value ?? null, imageModel.id)
check('重新打开编辑器时别名回填', (hadDraft ?? '').includes(ALIAS_ONE), `input=${JSON.stringify(hadDraft)}`)
await page.click(`[data-testid="model-alias-clear-${imageModel.id}"]`)
await page.waitForTimeout(1200)
await page.locator('[role="dialog"] button:has-text("保存路由配置")').first().click()
await page.waitForTimeout(4000)
const cleared = (await getModels()).find((model) => model.id === imageModel.id)
check('清空别名后后端不再保存别名', !cleared?.aliases?.length, `aliases=${JSON.stringify(cleared?.aliases ?? null)}`)

await page.waitForTimeout(7000)
const afterClear = await submitImage(ALIAS_ONE)
check('清空别名后该名字不再可请求', afterClear.status === 400 && /任务参数不完整/.test(afterClear.body?.error ?? ''), `status=${afterClear.status} error=${JSON.stringify(afterClear.body?.error)}`)

await page.locator('[role="dialog"] button[aria-label="关闭"]').first().click().catch(() => null)
await page.waitForTimeout(1000)

/* ======================================================================
 * 还原
 * ==================================================================== */

await restore()
const restored = (await getModels()).find((model) => model.id === imageModel.id)
check('被测模型已还原（aliases 与初始一致）', JSON.stringify(restored?.aliases ?? null) === JSON.stringify(imageModel.aliases ?? null), `aliases=${JSON.stringify(restored?.aliases ?? null)}`)
const finalModels = await getModels()
check('逻辑模型数量未变化', finalModels.length === original.length, `前后=${original.length}/${finalModels.length}`)
const finalDefaults = (await getSettings()).defaultModels
check('默认模型已还原（禁用测试不留下副作用）', JSON.stringify(finalDefaults) === JSON.stringify(originalDefaults),
  `前后=${JSON.stringify(originalDefaults)} / ${JSON.stringify(finalDefaults)}`)

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
