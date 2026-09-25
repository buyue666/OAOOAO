import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 第十轮 P1 回归：取消「保存并切换」后，迟到响应不得强制切换或丢稿。
 *
 * 缺陷（已复现）：
 *   编辑场景一 → 点场景二 → 弹窗点「保存并切换」（响应被挂起）→ 点「留在当前场景」
 *   → 继续输入新内容 → 释放"提交成功"的响应
 *   → 页面**仍然切到场景二**，新输入丢失，保存按钮变为禁用。
 *
 * 根因（两处叠加）：
 *   1. `confirmSceneChange` 在 await 之后直接 `selectScene(pendingSceneId)` ——
 *      用的是**过期的**切换意图。用户已经点了「留在当前场景」，那个意图应当作废；
 *   2. `persistDraft()` 返回 true 只代表"**提交的那一份**写成功了"，
 *      不代表当前草稿已全部保存。保存期间用户又输入了新内容时，
 *      自动切换会把这些新输入一并丢弃。
 *
 * 修复：
 *   - 切换意图**版本化**（`sceneIntentRef`）：设定/取消/改选都自增；
 *     await 之后比对版本，失效就只完成保存、**不切换**；
 *   - await 之后再核对编辑目标与编辑版本：期间有新输入 → 留在当前场景并提示；
 *   - 弹窗关闭 / 「留在当前场景」都走 `cancelSceneIntent`（只作废切换，不撤销已提交的保存）。
 *
 * 覆盖用户要求的全部场景：取消、关闭弹窗、继续输入、改选其他场景、保存失败、
 * 以及正常「保存并切换」与再次保存仍可用。
 *
 * 隔离数据：`SCENECANCEL-` 前缀的画布 + 短剧项目，结束即删。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = process.env.SCENECANCEL_BASE || 'http://127.0.0.1:3310'
const MARK = `SCENECANCEL-${Date.now().toString(36).toUpperCase()}`

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
const dramaUrl = (id) => `/api/drama/projects/${encodeURIComponent(id)}`
const readProject = async (id) => (await api(dramaUrl(id))).json.data.project

let dramaId = null, canvasId = null
const cleanup = async () => {
  if (dramaId) await api(dramaUrl(dramaId), { method: 'DELETE' }).catch(() => null)
  if (canvasId) await api('/api/canvas/projects', { method: 'DELETE', body: JSON.stringify({ ids: [canvasId] }) }).catch(() => null)
}

/* 挂起/改写 PATCH 响应 */
let hold = false
const held = []
await (async () => {
  /* route 在页面导航前注册 */
})()

try {
  const handoff = MARK.toLowerCase()
  canvasId = (await api('/api/canvas/projects', { method: 'POST', body: JSON.stringify({ title: `${MARK} 画布`, sourceHandoffId: handoff }) })).json?.data?.project?.id
  dramaId = (await api('/api/drama/projects', { method: 'POST', body: JSON.stringify({ title: `${MARK} 短剧`, summary: '隔离测试数据', sourceHandoffId: handoff, initialScript: '初始' }) })).json?.data?.project?.id
  console.log(`[隔离] canvas=${canvasId} drama=${dramaId}`)
  if (!canvasId || !dramaId) throw new Error('隔离项目创建失败')

  const seed = await readProject(dramaId)
  await api(dramaUrl(dramaId), {
    method: 'PATCH',
    body: JSON.stringify({
      ...seed,
      episodes: seed.episodes.map((e) => ({
        ...e,
        shots: [
          { id: 's1', order: 1, title: '场景一', description: `${MARK} 场景一初始`, dialogue: `${MARK} 场景一对白`, duration: 5 },
          { id: 's2', order: 2, title: '场景二', description: `${MARK} 场景二初始`, dialogue: `${MARK} 场景二对白`, duration: 5 },
          { id: 's3', order: 3, title: '场景三', description: `${MARK} 场景三初始`, dialogue: `${MARK} 场景三对白`, duration: 5 },
        ],
      })),
    }),
  })

  await page.route('**/api/drama/projects/**', async (route) => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return }
    if (!hold) {
      let real = null
      try { real = await route.fetch() } catch { /* ignore */ }
      const text = real ? await real.text() : '{}'
      held.push({ body: route.request().postData() ?? '', status: real?.status() ?? 0, sent: true })
      await route.fulfill({ status: real?.status() ?? 500, contentType: 'application/json', body: text })
      return
    }
    const pending = { body: route.request().postData() ?? '', status: null, sent: null }
    held.push(pending)
    await page.waitForFunction(() => Boolean(window.__rel), null, { timeout: 60000 }).catch(() => null)
    const mode = await page.evaluate(() => window.__rel)
    try {
      if (mode === 'fail') {
        Object.assign(pending, { status: 500, sent: false })
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模拟失败' }) })
        return
      }
      let real = null
      try { real = await route.fetch() } catch { /* ignore */ }
      const text = real ? await real.text() : '{}'
      Object.assign(pending, { status: real?.status() ?? 0, sent: true })
      await route.fulfill({ status: real?.status() ?? 200, contentType: 'application/json', body: text })
    } catch (error) { console.log(`[释放失败] ${error.message.split('\n')[0]}`) }
  })

  await page.goto(`${BASE}/projects/${canvasId}/script`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4500)

  const bodyBox = page.locator('textarea[aria-label="环境与动作正文"]')
  const saveBtn = page.locator('[data-testid="script-save"], button[aria-label="保存草稿"]').first()
  if (!(await bodyBox.count())) { skip('全部场景切换断言', '运行构建的剧本页没有正文编辑区'); throw new Error('缺少编辑区') }

  const state = () => page.evaluate(() => {
    const text = document.body.innerText
    const dirty = /未保存草稿/.test(text)
    const btn = document.querySelector('[data-testid="script-save"], button[aria-label="保存草稿"]')
    /** 当前活动场景名（侧栏里 aria-current 的那一项）。 */
    const active = document.querySelector('[aria-current="true"], [aria-current="page"]')?.textContent?.trim() ?? ''
    return {
      body: document.querySelector('textarea[aria-label="环境与动作正文"]')?.value ?? '',
      dialogue: document.querySelector('textarea[aria-label="对白正文"]')?.value ?? '',
      active,
      dirty,
      disabled: btn ? (btn.disabled === true || btn.getAttribute('aria-disabled') === 'true') : null,
      modalOpen: /当前场景还有未保存修改/.test(text),
      notice: (document.body.innerText.match(/保存期间你又修改了内容[^\n]*/) || [''])[0],
    }
  })
  const sceneButton = (name) => page.locator('button', { hasText: name }).first()
  const resetGate = () => page.evaluate(() => { window.__rel = null })
  const release = (mode) => page.evaluate((m) => { window.__rel = m }, mode)

  /**
   * 进入"场景一有脏草稿 + 已点场景二弹出确认框"的前置状态。
   *
   * 每次都**先回到场景一**再制造脏草稿：上一段用例结束时可能已经切到了别的场景，
   * 或者草稿已经保存过（那时点场景二**不会**弹确认框，
   * 后续 `button:has-text("保存并切换")` 会一直等不到而超时 —— 实测踩到）。
   */
  const openConfirmForSceneTwo = async (text) => {
    /** 先回到场景一（有脏草稿时会弹确认框，选「放弃并切换」）。 */
    await sceneButton('场景一').click({ force: true })
    await page.waitForTimeout(600)
    const maybeModal = page.locator('button:has-text("放弃并切换")').first()
    if (await maybeModal.count()) { await maybeModal.click({ force: true }); await page.waitForTimeout(700) }
    await bodyBox.fill(text)
    await page.waitForTimeout(400)
    await sceneButton('场景二').click({ force: true })
    await page.waitForTimeout(700)
    if (!(await page.locator('button:has-text("保存并切换")').count())) {
      throw new Error('未弹出确认框：草稿可能未标记为脏')
    }
  }

  /* ================================================================
   * 1. 核心：保存期间点「留在当前场景」+ 继续输入
   * ============================================================== */
  console.log('\n--- 1. 取消切换 + 继续输入 ---')
  hold = true
  resetGate()
  const T1 = `${MARK} 一稿`
  const T1_NEW = `${MARK} 取消后新输入`
  await openConfirmForSceneTwo(T1)
  check('点其他场景弹出确认框', (await state()).modalOpen)

  held.length = 0
  await page.locator('button:has-text("保存并切换")').first().click({ force: true })
  await page.waitForTimeout(1200)
  check('「保存并切换」发出保存请求并挂起', held.length === 1, `挂起=${held.length}`)

  await page.locator('button:has-text("留在当前场景")').first().click({ force: true })
  await page.waitForTimeout(500)
  check('点「留在当前场景」后确认框关闭', !(await state()).modalOpen)

  await bodyBox.fill(T1_NEW)
  await page.waitForTimeout(400)
  await release('ok')
  await page.waitForTimeout(4000)
  const after1 = await state()
  check('取消切换后，迟到成功响应不得强制切换到场景二', !after1.body.includes('场景二初始'),
    `编辑区="${after1.body.slice(-28)}"`)
  check('取消切换后，保存期间新输入的内容被保留', after1.body === T1_NEW, `编辑区="${after1.body.slice(-28)}"`)
  check('取消切换后，新输入仍是未保存状态', after1.dirty, `dirty=${after1.dirty}`)
  check('取消切换后，保存按钮仍可用', after1.disabled === false, `disabled=${after1.disabled}`)

  /* 已提交的那一份必须真的落库（取消切换 = 不撤销已提交的保存） */
  const persisted1 = await readProject(dramaId)
  const shot1 = persisted1.episodes[0].shots.find((s) => s.id === 's1')
  check('取消切换不撤销已提交的保存（服务端存的是提交的那一份）', shot1?.description === T1,
    `服务端="${String(shot1?.description).slice(-24)}"`)

  /* ================================================================
   * 2. 关闭弹窗（右上角关闭按钮）同样作废切换意图
   * ============================================================== */
  console.log('\n--- 2. 关闭弹窗 ---')
  resetGate()
  const T2 = `${MARK} 二稿`
  const T2_NEW = `${MARK} 关窗后新输入`
  await openConfirmForSceneTwo(T2)
  held.length = 0
  await page.locator('button:has-text("保存并切换")').first().click({ force: true })
  await page.waitForTimeout(1200)
  /* 关闭弹窗：点右上角关闭按钮 */
  const closeBtn = page.locator('[role="dialog"] button[aria-label="关闭"]').first()
  if (await closeBtn.count()) { await closeBtn.click({ force: true }) } else { await page.keyboard.press('Escape') }
  await page.waitForTimeout(600)
  await bodyBox.fill(T2_NEW)
  await page.waitForTimeout(400)
  await release('ok')
  await page.waitForTimeout(4000)
  const after2 = await state()
  check('关闭弹窗后，迟到响应不得切换场景', !after2.body.includes('场景二初始'), `编辑区="${after2.body.slice(-28)}"`)
  check('关闭弹窗后，新输入被保留', after2.body === T2_NEW, `编辑区="${after2.body.slice(-28)}"`)

  /* ================================================================
   * 3. 保存期间改选其他场景：旧意图失效，走新意图
   * ============================================================== */
  console.log('\n--- 3. 改选其他场景 ---')
  resetGate()
  const T3 = `${MARK} 三稿`
  await openConfirmForSceneTwo(T3)
  held.length = 0
  await page.locator('button:has-text("保存并切换")').first().click({ force: true })
  await page.waitForTimeout(1200)
  /* 保存挂起期间，确认框仍在；点「留在当前场景」后改选场景三 */
  const stayBtn = page.locator('button:has-text("留在当前场景")').first()
  if (await stayBtn.count()) { await stayBtn.click({ force: true }); await page.waitForTimeout(400) }
  await sceneButton('场景三').click({ force: true })
  await page.waitForTimeout(700)
  const modal3 = await state()
  if (modal3.modalOpen) {
    /** 场景三也弹确认框（草稿仍脏）→ 选「放弃并切换」。 */
    await page.locator('button:has-text("放弃并切换")').first().click({ force: true })
    await page.waitForTimeout(700)
  }
  const afterSwitch3 = await state()
  await release('ok')
  await page.waitForTimeout(4000)
  const after3 = await state()
  check('改选场景三后确实切到了场景三', afterSwitch3.body.includes('场景三初始'), `切换后="${afterSwitch3.body.slice(-24)}"`)
  check('迟到响应不得把编辑区改回场景二', !after3.body.includes('场景二初始'), `释放后="${after3.body.slice(-24)}"`)

  /* ================================================================
   * 4. 保存失败：必须留在原场景
   * ============================================================== */
  console.log('\n--- 4. 保存失败 ---')
  hold = true
  resetGate()
  const T4 = `${MARK} 四稿`
  await openConfirmForSceneTwo(T4)
  held.length = 0
  await page.locator('button:has-text("保存并切换")').first().click({ force: true })
  await page.waitForTimeout(1200)
  await release('fail')
  await page.waitForTimeout(4000)
  const after4 = await state()
  check('保存失败时留在原场景（不切换）', !after4.body.includes('场景二初始'), `编辑区="${after4.body.slice(-24)}"`)
  check('保存失败时草稿保留', after4.body === T4, `编辑区="${after4.body.slice(-24)}"`)
  check('保存失败时不谎报已保存', after4.dirty, `dirty=${after4.dirty}`)

  /* ================================================================
   * 5. 正常「保存并切换」仍可用 + 再次保存可用
   * ============================================================== */
  console.log('\n--- 5. 正常保存并切换 ---')
  hold = false
  resetGate()
  const T5 = `${MARK} 五稿`
  await openConfirmForSceneTwo(T5)
  await page.locator('button:has-text("保存并切换")').first().click({ force: true })
  await page.waitForTimeout(4500)
  const after5 = await state()
  check('无新增编辑时「保存并切换」正常切到场景二', after5.body.includes('场景二初始'),
    `编辑区="${after5.body.slice(-24)}"`)
  check('切换后场景二不脏', !after5.dirty, `dirty=${after5.dirty}`)
  const persisted5 = await readProject(dramaId)
  check('「保存并切换」把内容真实落库',
    persisted5.episodes[0].shots.find((s) => s.id === 's1')?.description === T5,
    `服务端="${String(persisted5.episodes[0].shots.find((s) => s.id === 's1')?.description).slice(-24)}"`)

  /* 再次保存仍可用 */
  const T5B = `${MARK} 场景二编辑`
  await bodyBox.fill(T5B)
  await page.waitForTimeout(400)
  await saveBtn.click({ force: true })
  await page.waitForTimeout(4000)
  const after5b = await state()
  /**
   * 保存成功后 dirty 为假、按钮禁用是**正确**行为（没有未保存内容就没什么可保存的）。
   * 早先这里断言 `disabled=false`，把"正确状态"判成了失败（实测踩到）。
   * 真正要验证的是：保存确实成功且内容落库。
   */
  check('切换后再次保存成功（dirty 清除）', !after5b.dirty, `dirty=${after5b.dirty}`)
  check('保存成功后按钮按预期禁用（无未保存内容）', after5b.disabled === true, `disabled=${after5b.disabled}`)
  const persisted5b = await readProject(dramaId)
  check('再次保存的内容真实落库',
    persisted5b.episodes[0].shots.find((s) => s.id === 's2')?.description === T5B,
    `服务端="${String(persisted5b.episodes[0].shots.find((s) => s.id === 's2')?.description).slice(-24)}"`)
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
