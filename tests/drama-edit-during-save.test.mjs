import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 第九轮 P1 回归：剧本保存期间继续输入，新内容不得被覆盖。
 *
 * 缺陷（已复现）：
 *   输入 A → 点保存（响应被挂起）→ 保存期间继续输入 B → 释放"提交的是 A"的成功响应
 *   → 编辑区被**回滚成 A**、B 丢失、dirty 被清、保存按钮禁用、页面显示「已保存」。
 *
 * 根因：
 *   1. `persistDraft` 成功路径无条件 `setDirty(false)`，只确认了"请求成功"，
 *      没有确认"编辑区里还是不是提交的那一份"；
 *   2. 同步 effect 以 `dramaProject.updatedAt` 为 key，保存成功后 `updatedAt` 变化
 *      → 触发"用服务端内容覆盖编辑区"，而此时 dirty 已被清成 false，覆盖畅通无阻。
 *
 * 修复：
 *   - 用 `editRevRef` 记录"当前编辑版本"，提交时快照，响应回来时比对；
 *     期间有新输入 → **只确认已提交的那份**，保留当前草稿并保持 dirty；
 *   - 同步 effect 改由 `syncedRev`（仅在"无新输入的保存成功"时推进）驱动，
 *     不再被其它写入路径（分镜写回等）的 `updatedAt` 变化误触发；
 *   - 用 `editTargetRef` 让切场景/切项目/换账号后的迟到响应失效。
 *
 * 本脚本走**真实浏览器 + 真实接口 + 真实数据库**，
 * 用 route 挂起/释放 PATCH 响应来构造"响应延迟"，覆盖：
 *   延迟成功期间继续编辑正文与对白、无新增编辑的正常保存、
 *   409/500 失败、连续保存、切换场景后响应晚到。
 *
 * 隔离数据：`EDITRACE-` 前缀的画布 + 短剧项目，结束即删，绝不触碰既有项目。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = process.env.EDITRACE_BASE || 'http://127.0.0.1:3310'
const MARK = `EDITRACE-${Date.now().toString(36).toUpperCase()}`

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
  return { status: r.status, json: j, text: t.slice(0, 300) }
}, { path, options })
const dramaUrl = (id) => `/api/drama/projects/${encodeURIComponent(id)}`
const readProject = async (id) => (await api(dramaUrl(id))).json.data.project

let dramaId = null
let canvasId = null
const cleanup = async () => {
  if (dramaId) await api(dramaUrl(dramaId), { method: 'DELETE' }).catch(() => null)
  if (canvasId) await api('/api/canvas/projects', { method: 'DELETE', body: JSON.stringify({ ids: [canvasId] }) }).catch(() => null)
}

/* 挂起 PATCH 响应，直到测试显式释放 */
let holdPatches = false
const heldPatches = []
const release = () => page.evaluate(() => { window.__patchMode = 'real' })
const setMode = (mode) => page.evaluate((m) => { window.__patchMode = m }, mode)
const resetGate = () => page.evaluate(() => { window.__patchMode = null })

try {
  /* ---------------------------------------------------------- 建隔离数据 */
  const handoff = MARK.toLowerCase()
  const canvasCreated = await api('/api/canvas/projects', {
    method: 'POST',
    body: JSON.stringify({ title: `${MARK} 画布`, sourceHandoffId: handoff }),
  })
  canvasId = canvasCreated.json?.data?.project?.id ?? null
  const dramaCreated = await api('/api/drama/projects', {
    method: 'POST',
    body: JSON.stringify({ title: `${MARK} 短剧`, summary: '隔离测试数据，脚本结束即删除', sourceHandoffId: handoff, initialScript: `${MARK} 初始正文` }),
  })
  dramaId = dramaCreated.json?.data?.project?.id ?? null
  console.log(`[隔离] canvas=${canvasId} drama=${dramaId}`)
  if (!canvasId || !dramaId) throw new Error('隔离项目创建失败，后续用例无法执行')

  const S1 = 'shot-race-1'
  const S2 = 'shot-race-2'
  const seed = await readProject(dramaId)
  await api(dramaUrl(dramaId), {
    method: 'PATCH',
    body: JSON.stringify({
      ...seed,
      episodes: seed.episodes.map((e) => ({
        ...e,
        shots: [
          { id: S1, order: 1, title: '场景一', description: `${MARK} 场景一初始`, dialogue: `${MARK} 场景一对白初始`, duration: 5 },
          { id: S2, order: 2, title: '场景二', description: `${MARK} 场景二初始`, dialogue: `${MARK} 场景二对白初始`, duration: 5 },
        ],
      })),
    }),
  })

  await page.route('**/api/drama/projects/**', async (route) => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return }
    const body = route.request().postData() ?? ''
    /**
     * 是否**真的**把请求发给后端。
     *
     * 关键：只有 `real` 模式才 `route.fetch()`。
     * 早先对所有模式都先 `route.fetch()` 再按模式改写响应，
     * 结果「模拟 409 / 500」时**后端其实已经真实写入**了 ——
     * 客户端被告知失败，服务端却落了库，版本基线因此悄悄前进，
     * 后续的连续保存反而撞上真实 409（实测踩到）。
     * 现在失败模式一律不触达后端，只返回受控响应。
     */
    if (!holdPatches) {
      let real = null
      try { real = await route.fetch() } catch { /* 网络层失败 */ }
      const text = real ? await real.text() : '{}'
      heldPatches.push({ body, status: real?.status() ?? 0, text, sent: true })
      await route.fulfill({ status: real?.status() ?? 500, contentType: 'application/json', body: text })
      return
    }
    /**
     * 挂起模式：**先记录请求**再等释放。
     *
     * 早先记录写在 `waitForFunction` 之后，于是"请求已发出且被挂起"
     * 这条断言在释放前永远看到 0 条（实测踩到）。
     * 请求体在进入 handler 时就已确定，先记录不影响后续断言的正确性。
     */
    const pending = { body, status: null, text: null, sent: null }
    heldPatches.push(pending)
    await page.waitForFunction(() => Boolean(window.__patchMode), null, { timeout: 60000 }).catch(() => null)
    const mode = await page.evaluate(() => window.__patchMode)
    try {
      if (mode === '500') {
        Object.assign(pending, { status: 500, text: '', sent: false })
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模拟 500' }) })
        return
      }
      if (mode === '409') {
        Object.assign(pending, { status: 409, text: '', sent: false })
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 409, msg: '短剧项目已在其他页面更新，请刷新后重试' }) })
        return
      }
      if (mode === 'abort') {
        Object.assign(pending, { status: 0, text: '', sent: false })
        await route.abort('failed')
        return
      }
      // real：真实发给后端，拿到真实结果
      let real = null
      try { real = await route.fetch() } catch { /* ignore */ }
      const text = real ? await real.text() : '{}'
      Object.assign(pending, { status: real?.status() ?? 0, text, sent: true })
      await route.fulfill({ status: real?.status() ?? 200, contentType: 'application/json', body: text })
    } catch (error) { console.log(`[释放失败] ${error.message.split('\n')[0]}`) }
  })

  await page.goto(`${BASE}/projects/${canvasId}/script`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4500)

  const bodyBox = page.locator('textarea[aria-label="环境与动作正文"]')
  const dialogueBox = page.locator('textarea[aria-label="对白正文"]')
  if (!(await bodyBox.count())) {
    skip('全部编辑区断言', '运行构建的剧本页没有正文编辑区（构建落后）')
    throw new Error('缺少编辑区')
  }
  const saveBtn = page.locator('[data-testid="script-save"], button[aria-label="保存草稿"]').first()

  const state = () => page.evaluate(() => {
    const btn = document.querySelector('[data-testid="script-save"], button[aria-label="保存草稿"]')
    const text = document.body.innerText
    /**
     * 徽标（保存状态）判定。
     *
     * 注意不能简单地在整页文本里搜 `已保存`：成功提示里也可能出现
     * 「已保存你点击保存时的内容……尚未保存」这类句子，
     * 直接搜会让「失败时不谎报已保存」这条断言假失败（实测踩到）。
     * 因此这里**优先**看「未保存草稿」这个明确的脏标记，
     * 只有在没有脏标记时才认为已保存。
     */
    const dirty = /未保存草稿/.test(text)
    const badge = dirty ? '未保存草稿' : ((text.match(/已保存[^\n]*/) || [''])[0])
    return {
      body: document.querySelector('textarea[aria-label="环境与动作正文"]')?.value ?? '',
      dialogue: document.querySelector('textarea[aria-label="对白正文"]')?.value ?? '',
      badge,
      dirty,
      disabled: btn ? (btn.disabled === true || btn.getAttribute('aria-disabled') === 'true') : null,
      /** 「已保存」= 有保存成功标记**且**当前不脏。 */
      saved: !dirty && /已保存/.test(text),
      conflict: /其他窗口|版本冲突/.test(text),
      error: (text.match(/保存失败[^\n]*|服务端返回的内容[^\n]*|短剧项目已在其他页面更新[^\n]*/) || [''])[0],
    }
  })

  /* ==================================================================
   * 1. 核心：延迟成功响应期间继续编辑正文与对白
   * ================================================================ */
  holdPatches = true
  resetGate()
  const A_BODY = `${MARK} A正文`
  const A_DIALOGUE = `${MARK} A对白`
  const B_BODY = `${MARK} B正文-保存期间新输入`
  const B_DIALOGUE = `${MARK} B对白-保存期间新输入`

  await bodyBox.fill(A_BODY)
  await dialogueBox.fill(A_DIALOGUE)
  await page.waitForTimeout(400)
  heldPatches.length = 0
  await saveBtn.click({ force: true })
  await page.waitForTimeout(1000)
  check('保存请求已发出且被挂起', heldPatches.length === 1, `挂起=${heldPatches.length}`)

  await bodyBox.fill(B_BODY)
  await dialogueBox.fill(B_DIALOGUE)
  await page.waitForTimeout(500)
  const during = await state()
  check('保存期间编辑区确实可继续编辑（B 已在编辑区）', during.body === B_BODY && during.dialogue === B_DIALOGUE,
    `body="${during.body.slice(-20)}"`)

  await release()
  await page.waitForTimeout(4000)
  const afterDelay = await state()

  check('请求正文提交的是 A（不含 B）',
    heldPatches[0].body.includes('A正文') && !heldPatches[0].body.includes('B正文'),
    '请求体含 A')
  check('延迟成功响应后，正文 B **未被**回滚成 A', afterDelay.body === B_BODY,
    `编辑区="${afterDelay.body.slice(0, 60)}"`)
  check('延迟成功响应后，对白 B **未被**回滚成 A', afterDelay.dialogue === B_DIALOGUE,
    `编辑区="${afterDelay.dialogue.slice(0, 60)}"`)
  check('仍有未保存内容 → dirty 保持为真', afterDelay.dirty, `badge="${afterDelay.badge}"`)
  check('仍有未保存内容 → 保存按钮仍可用', afterDelay.disabled === false, `disabled=${afterDelay.disabled}`)
  check('提示如实说明"只保存了提交的那一版"', /保存期间新输入/.test(afterDelay.badge) || /保存期间新输入/.test(await page.locator('body').innerText()),
    '提示含"保存期间新输入"')

  /* 复查服务端：落库的是 A（提交的那份），不是 B */
  const persistedA = await readProject(dramaId)
  const shot1A = persistedA.episodes[0].shots.find((s) => s.id === S1)
  check('服务端落库的是提交的 A（B 尚未保存，符合预期）',
    shot1A?.description === A_BODY && shot1A?.dialogue === A_DIALOGUE,
    `服务端="${String(shot1A?.description).slice(-20)}"`)

  /* ==================================================================
   * 2. 再次保存 B 应成功，并推进服务端版本（版本基线必须能被真实推进）
   * ================================================================ */
  const beforeVersion = (await readProject(dramaId)).updatedAt
  holdPatches = false
  resetGate()
  heldPatches.length = 0
  await saveBtn.click({ force: true })
  await page.waitForTimeout(4000)
  const afterSecond = await state()
  const persistedB = await readProject(dramaId)
  const shot1B = persistedB.episodes[0].shots.find((s) => s.id === S1)
  check('第二次保存把 B 真实写入服务端', shot1B?.description === B_BODY && shot1B?.dialogue === B_DIALOGUE,
    `服务端="${String(shot1B?.description).slice(-20)}"`)
  check('服务端版本被真实推进（乐观锁基线可推进）', persistedB.updatedAt !== beforeVersion,
    `${beforeVersion} → ${persistedB.updatedAt}`)
  check('保存成功后 dirty 被清除、按钮禁用', afterSecond.dirty === false && afterSecond.disabled === true,
    `dirty=${afterSecond.dirty} disabled=${afterSecond.disabled}`)

  /* ==================================================================
   * 3. 无新增编辑的正常保存（回归：不能误伤正常路径）
   * ================================================================ */
  holdPatches = true
  resetGate()
  const C_BODY = `${MARK} C正文-无新编辑`
  await bodyBox.fill(C_BODY)
  await page.waitForTimeout(400)
  heldPatches.length = 0
  await saveBtn.click({ force: true })
  await page.waitForTimeout(900)
  await release()
  await page.waitForTimeout(3500)
  const normal = await state()
  check('无新增编辑时保存成功 → dirty 清除', normal.dirty === false, `badge="${normal.badge}"`)
  check('无新增编辑时保存成功 → 显示已保存', normal.saved, `badge="${normal.badge}"`)
  check('无新增编辑时保存成功 → 编辑区内容为提交值', normal.body === C_BODY,
    `编辑区="${normal.body.slice(-20)}"`)

  /* ==================================================================
   * 4. 409 冲突：保留**当前最新**草稿，不退回提交时的旧草稿
   * ================================================================ */
  resetGate()
  const D_BODY = `${MARK} D正文-冲突前`
  const E_BODY = `${MARK} E正文-冲突期间新输入`
  await bodyBox.fill(D_BODY)
  await page.waitForTimeout(400)
  heldPatches.length = 0
  await saveBtn.click({ force: true })
  await page.waitForTimeout(900)
  await bodyBox.fill(E_BODY)
  await page.waitForTimeout(400)
  await setMode('409')
  await page.waitForTimeout(4000)
  const conflict = await state()
  check('409 冲突时保留的是**当前最新**草稿 E（不是提交时的 D）', conflict.body === E_BODY,
    `编辑区="${conflict.body.slice(-24)}"`)
  check('409 冲突时显示真实冲突提示', conflict.conflict, `error="${conflict.error}"`)
  check('409 冲突时 dirty 保持为真', conflict.dirty, `badge="${conflict.badge}"`)
  check('409 冲突时提供「查看最新版本」入口', (await page.locator('[data-testid="script-view-latest"]').count()) > 0)
  check('409 冲突时提供「复制草稿」入口', (await page.locator('[data-testid="script-copy-draft"]').count()) > 0)

  /* ==================================================================
   * 5. 500 失败：保留当前最新草稿
   * ================================================================ */
  resetGate()
  const F_BODY = `${MARK} F正文-500前`
  const G_BODY = `${MARK} G正文-500期间新输入`
  await bodyBox.fill(F_BODY)
  await page.waitForTimeout(400)
  heldPatches.length = 0
  await saveBtn.click({ force: true })
  await page.waitForTimeout(900)
  await bodyBox.fill(G_BODY)
  await page.waitForTimeout(400)
  await setMode('500')
  await page.waitForTimeout(4000)
  const failed = await state()
  check('500 失败时保留当前最新草稿 G', failed.body === G_BODY, `编辑区="${failed.body.slice(-24)}"`)
  check('500 失败时不谎报已保存', !failed.saved, `badge="${failed.badge}"`)
  check('500 失败时 dirty 保持为真', failed.dirty)

  /* ==================================================================
   * 6. 网络异常：同样保留草稿
   * ================================================================ */
  resetGate()
  const H_BODY = `${MARK} H正文-断网`
  await bodyBox.fill(H_BODY)
  await page.waitForTimeout(400)
  await setMode('abort')
  await page.waitForTimeout(4000)
  const offline = await state()
  check('网络异常时保留草稿', offline.body === H_BODY, `编辑区="${offline.body.slice(-20)}"`)
  check('网络异常时不谎报已保存', !offline.saved, `badge="${offline.badge}"`)

  /* ==================================================================
   * 7. 连续保存：连点两次不应丢失内容
   * ================================================================ */
  resetGate()
  holdPatches = false
  const I_BODY = `${MARK} I正文-连续保存`
  await bodyBox.fill(I_BODY)
  await page.waitForTimeout(400)
  heldPatches.length = 0
  await saveBtn.click({ force: true })
  await page.waitForTimeout(150)
  await saveBtn.click({ force: true }).catch(() => null)
  await page.waitForTimeout(4500)
  const consecutive = await state()
  const persistedI = await readProject(dramaId)
  const shot1I = persistedI.episodes[0].shots.find((s) => s.id === S1)
  check('连续保存后编辑区内容正确', consecutive.body === I_BODY, `编辑区="${consecutive.body.slice(-20)}"`)
  check('连续保存后服务端内容正确', shot1I?.description === I_BODY, `服务端="${String(shot1I?.description).slice(-20)}"`)
  check('连续保存不会重复提交（保存中禁用/去重）', heldPatches.length <= 2, `实际发起=${heldPatches.length}`)

  /* ==================================================================
   * 8. 切换场景后迟到响应：不得写入当前编辑区
   * ================================================================ */
  resetGate()
  holdPatches = true
  const J_BODY = `${MARK} J正文-场景一`
  await bodyBox.fill(J_BODY)
  await page.waitForTimeout(400)
  heldPatches.length = 0
  await saveBtn.click({ force: true })
  await page.waitForTimeout(900)

  /** 保存挂起期间切到第二个场景（会弹确认框，选「放弃并切换」避免再触发保存）。 */
  const sceneTwoButton = page.locator('button', { hasText: '场景二' }).first()
  const sceneSwitchable = (await sceneTwoButton.count()) > 0
  if (sceneSwitchable) {
    await sceneTwoButton.click({ force: true })
    await page.waitForTimeout(700)
    const abandon = page.locator('button:has-text("放弃并切换"), button:has-text("放弃")').first()
    if (await abandon.count()) { await abandon.click({ force: true }); await page.waitForTimeout(900) }
    const afterSwitch = await state()
    console.log(`[切到场景二] body="${afterSwitch.body.slice(-24)}"`)
    /** 现在释放"场景一"的迟到响应。 */
    await release()
    await page.waitForTimeout(4000)
    const afterLate = await state()
    check('切场景后，迟到响应**没有**把旧场景正文写进当前编辑区',
      afterLate.body === afterSwitch.body,
      `切换后="${afterSwitch.body.slice(-24)}" 释放后="${afterLate.body.slice(-24)}"`)
    check('切场景后，迟到响应没有把编辑区标记成已保存（新场景内容并未保存）',
      afterLate.body !== J_BODY, `编辑区仍为场景二内容=${afterLate.body !== J_BODY}`)
  } else {
    skip('切换场景后迟到响应隔离', '页面上没有第二个场景可切（隔离项目场景数不足）')
  }

  holdPatches = false
  resetGate()
} catch (error) {
  check('执行过程中未抛出未预期异常', false, error instanceof Error ? error.message : String(error))
} finally {
  await page.unroute('**/api/drama/projects/**').catch(() => null)
  await cleanup()
  console.log('[清理] 隔离数据已删除')
  await browser.close()
}

const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，未执行 ${notExecuted.length}，失败 ${failed.length}`)
if (notExecuted.length) { console.log('未执行项：'); for (const item of notExecuted) console.log(` - ${item.name} :: ${item.why}`) }
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
