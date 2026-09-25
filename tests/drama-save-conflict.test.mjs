import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * P1 回归测试：短剧项目保存的并发冲突（数据丢失）。
 *
 * 缺陷（修复前，已实测复现）：
 *  前端 `saveDramaProject` 主动 `delete updatedAt`，后端 `updateDramaProjectForUser`
 *  的「最后写入优先」守卫因为 `incomingUpdatedAt` 为假而被跳过 → 整份过期快照
 *  畅通无阻地覆盖别人的保存；即便显式带上过期版本，后端也只是**静默返回 current**
 *  并回 200（假成功）。用户看到「已保存」，实际内容被回滚或被丢弃。
 *
 * 本脚本走**真实 HTTP**（前端 3310 → 代理 → 后端 3200）验证修复后的行为：
 *  1. 两个「窗口」读到同一版本；
 *  2. A 保存第 1 集 → 200 且落库；
 *  3. B 用它的过期版本保存第 2 集 → **409**；A 的第 1 集原样还在；B 的第 2 集没写进去；
 *  4. 同时提交（`Promise.all`，同一版本）→ 恰好一个 200、一个 409，落库内容等于赢家；
 *  5. 带当前版本正常保存 → 200（不误伤正常路径）；
 *  6. 刷新/重读拿到的就是保存后的内容；
 *  7. 兼容性：不带 `updatedAt` 的 PATCH 仍然 200（老客户端通道）。
 *
 * 第 8 项「冲突时草稿被保留（真实 UI）」只有在 3310 跑的是**包含本轮改动**的构建时
 * 才能执行；否则如实记为 SKIP 并说明原因，不假装通过。
 *
 * 只创建带 `SAVECONF-` 前缀的隔离短剧项目，结束时删除并断言零残留。
 * 绝不触碰既有的真实项目。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')
/** 前端仓库自己的依赖（TypeScript 编译器），用于转译被验证的真实源码。 */
const frontendRequire = createRequire(resolve(import.meta.dirname ?? '.', '..', 'package.json'))

const BASE = process.env.SAVECONF_BASE || 'http://127.0.0.1:3310'
/**
 * 承载 HTTP 断言的源。
 *
 * 默认与 `BASE` 相同（经前端代理打到共享后端 3200）。当需要在**另一个后端实例**上
 * 验证修复时（例如隔离构建起在 3299、而 3200 仍是改动前的产物），把它指向那个实例：
 * cookie 不区分端口，登录会话可直接复用，但 `fetch` 必须同源，
 * 因此断言走一个导航到该源的独立页面。
 */
const API_BASE = process.env.SAVECONF_API_BASE || BASE
const MARK = `SAVECONF-${Date.now().toString(36).toUpperCase()}`

const results = []
/** 因运行中的构建缺少新前端代码而**无法执行**的断言：既不算通过，也不算失败。 */
const notExecuted = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
const skip = (name, why) => {
  notExecuted.push({ name, why })
  console.log(`NOT-EXECUTED ${name} :: ${why}`)
}

const browser = await chromium.launch()
let session
try {
  session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
} catch (error) {
  if (error?.throttled) exitThrottled(error.message)
  await browser.close()
  throw error
}
const page = session.page
console.log(`[会话] reused=${session.reused}`)

/**
 * 断言所用的页面。
 *
 * `API_BASE === BASE` 时直接用已登录页面；否则新开一个页面导航到目标源
 * （cookie 按域共享、不区分端口，会话随之可用）。
 */
let apiPage = page
if (API_BASE !== BASE) {
  apiPage = await session.context.newPage()
  await apiPage.goto(`${API_BASE}/api/health/live`, { waitUntil: 'domcontentloaded' })
  /**
   * 会话确认走**业务只读接口**而不是 `/api/auth/session`：
   * 前者只依赖会话与数据库，后者还会解密站点设置（要求目标实例持有同一把
   * `VOZEB_PRO_ENCRYPTION_KEY`）。这里要证明的只是「会话在这个源上有效」。
   */
  const ok = await apiPage.evaluate(async () => {
    const response = await fetch('/api/drama/projects?page=1&pageSize=1', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    return response.status === 200 && payload?.code === 0
  })
  if (!ok) throw new Error(`目标实例 ${API_BASE} 上没有可用会话，无法执行断言`)
  console.log(`[断言源] ${API_BASE}（与页面源 ${BASE} 不同，已确认会话可用）`)
}

/** 统一走浏览器 fetch（带真实会话），不引额外的 Node HTTP 客户端。 */
const api = (path, options = {}) => apiPage.evaluate(async ({ path, options }) => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options, cache: 'no-store' })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 保留 null */ }
  return { status: response.status, json, text: text.slice(0, 300) }
}, { path, options })

const dramaUrl = (id) => `/api/drama/projects/${encodeURIComponent(id)}`
const readProject = async (id) => {
  const response = await api(dramaUrl(id))
  if (response.status !== 200 || !response.json?.data?.project) {
    throw new Error(`读取短剧项目失败：status=${response.status} body=${response.text}`)
  }
  return response.json.data.project
}

let dramaId = null
/** 为真实 UI 用例额外创建的隔离画布项目（`/projects/<canvasId>/script` 的入口）。 */
let canvasId = null
let cleaned = false
const cleanup = async () => {
  if (cleaned) return
  cleaned = true
  if (dramaId) {
    const removed = await api(dramaUrl(dramaId), { method: 'DELETE' }).catch(() => ({ status: 0 }))
    console.log(`[清理] DELETE ${dramaId} status=${removed.status}`)
  }
  if (canvasId) {
    const removed = await api('/api/canvas/projects', { method: 'DELETE', body: JSON.stringify({ ids: [canvasId] }) }).catch(() => ({ status: 0 }))
    console.log(`[清理] DELETE ${canvasId} status=${removed.status}`)
  }
}

try {
  /* ---------------------------------------------------------------- 建隔离项目 */
  const created = await api('/api/drama/projects', {
    method: 'POST',
    body: JSON.stringify({ title: `${MARK} 保存冲突回归`, summary: '隔离测试数据，脚本结束即删除', initialScript: '初始正文' }),
  })
  dramaId = created.json?.data?.project?.id
  console.log(`[隔离项目] ${dramaId} status=${created.status}`)
  if (!dramaId || !String(dramaId).startsWith('drama-')) {
    console.log(created.text)
    throw new Error('隔离项目创建失败，后续用例无法执行')
  }

  /** 种两集，便于「A 存第 1 集、B 存第 2 集」。 */
  const seedBase = await readProject(dramaId)
  const EP1 = 'ep-conflict-1'
  const EP2 = 'ep-conflict-2'
  const INITIAL_EP1 = '第一集初始'
  const INITIAL_EP2 = '第二集初始'
  const seeded = await api(dramaUrl(dramaId), {
    method: 'PATCH',
    body: JSON.stringify({
      ...seedBase,
      episodes: [
        { ...seedBase.episodes[0], id: EP1, episodeNumber: 1, title: '第 1 集', script: INITIAL_EP1 },
        { ...seedBase.episodes[0], id: EP2, episodeNumber: 2, title: '第 2 集', script: INITIAL_EP2 },
      ],
    }),
  })
  if (seeded.status !== 200) throw new Error(`种子写入失败：status=${seeded.status} body=${seeded.text}`)

  const scriptOf = (project, episodeId) => project.episodes.find((item) => item.id === episodeId)?.script
  const setScript = (project, episodeId, text) => ({
    ...project,
    episodes: project.episodes.map((episode) => episode.id === episodeId ? { ...episode, script: text } : episode),
  })
  /** 模拟前端 `saveDramaProject`：整份项目 + **它读到的那一版** `updatedAt`。 */
  const saveAs = (project, episodeId, text, projectId = dramaId, version = project.updatedAt) =>
    api(dramaUrl(projectId), { method: 'PATCH', body: JSON.stringify({ ...setScript(project, episodeId, text), updatedAt: version }) })

  /* -------------------------------------------------- 1. 两个窗口读到同一版本 */
  const windowA = await readProject(dramaId)
  const windowB = await readProject(dramaId)
  check('1. 两个窗口读到同一版本', windowA.updatedAt === windowB.updatedAt && Boolean(windowA.updatedAt), `A=${windowA.updatedAt} B=${windowB.updatedAt}`)

  /* --------------------------------------------------------- 2. A 保存第 1 集 */
  const A_TEXT = `${MARK} A 改的第一集`
  const aSave = await saveAs(windowA, EP1, A_TEXT)
  const afterA = await readProject(dramaId)
  check('2. A 保存第 1 集返回 200', aSave.status === 200, `status=${aSave.status} msg=${JSON.stringify(aSave.json?.msg ?? '')}`)
  check('2. A 的保存已落库', scriptOf(afterA, EP1) === A_TEXT, `服务端=${JSON.stringify(scriptOf(afterA, EP1))}`)
  check('2. 保存后版本前进（乐观锁基线可推进）', Date.parse(afterA.updatedAt) > Date.parse(windowA.updatedAt), `${windowA.updatedAt} → ${afterA.updatedAt}`)

  /* --------------------------------------------- 3. B 用过期版本保存第 2 集 */
  const B_TEXT = `${MARK} B 改的第二集`
  const bSave = await saveAs(windowB, EP2, B_TEXT)
  const afterB = await readProject(dramaId)
  check('3. B 用过期版本保存必须收到 409（不是 200 假成功）', bSave.status === 409, `实际 status=${bSave.status} msg=${JSON.stringify(bSave.json?.msg ?? '')}`)
  check('3. 409 带有可操作的中文提示', /其他页面更新|其他窗口/.test(String(bSave.json?.msg ?? '')), `msg=${JSON.stringify(bSave.json?.msg ?? '')}`)
  check('3. A 的第 1 集修改未被 B 覆盖（核心要求）', scriptOf(afterB, EP1) === A_TEXT, `第1集=${JSON.stringify(scriptOf(afterB, EP1))} 期望=${JSON.stringify(A_TEXT)}`)
  check('3. B 的第 2 集内容未被写入（请求被拒绝）', scriptOf(afterB, EP2) === INITIAL_EP2, `第2集=${JSON.stringify(scriptOf(afterB, EP2))}`)
  check('3. 被拒绝的请求没有推进版本', afterB.updatedAt === afterA.updatedAt, `${afterA.updatedAt} → ${afterB.updatedAt}`)

  /* ------------------------------------------------ 4. 同时提交（同一版本） */
  const concurrentBase = await readProject(dramaId)
  const CONCURRENT_EP1 = `${MARK} 并发赢家-第1集`
  const CONCURRENT_EP2 = `${MARK} 并发输家-第2集`
  const [race1, race2] = await Promise.all([
    saveAs(concurrentBase, EP1, CONCURRENT_EP1, dramaId, concurrentBase.updatedAt),
    saveAs(concurrentBase, EP2, CONCURRENT_EP2, dramaId, concurrentBase.updatedAt),
  ])
  const statuses = [race1.status, race2.status].sort((a, b) => a - b)
  check('4. 同时提交恰好一个 200、一个 409', statuses[0] === 200 && statuses[1] === 409, `statuses=${race1.status},${race2.status}`)

  const afterRace = await readProject(dramaId)
  /** 赢家 = 唯一 200 的那次提交；落库内容必须与赢家一致，输家一个字都不能进。 */
  const winnerWroteEp1 = race1.status === 200
  const winnerText = winnerWroteEp1 ? CONCURRENT_EP1 : CONCURRENT_EP2
  const winnerEpisode = winnerWroteEp1 ? EP1 : EP2
  const loserEpisode = winnerWroteEp1 ? EP2 : EP1
  const loserPrevious = winnerWroteEp1 ? INITIAL_EP2 : A_TEXT
  check('4. 落库内容等于赢家提交的内容', scriptOf(afterRace, winnerEpisode) === winnerText, `赢家集=${JSON.stringify(scriptOf(afterRace, winnerEpisode))} 期望=${JSON.stringify(winnerText)}`)
  check('4. 输家的内容没有落库', scriptOf(afterRace, loserEpisode) === loserPrevious, `输家集=${JSON.stringify(scriptOf(afterRace, loserEpisode))} 期望=${JSON.stringify(loserPrevious)}`)

  /* ------------------------------------------- 5. 带当前版本正常保存 → 200 */
  const freshBase = await readProject(dramaId)
  const NORMAL_TEXT = `${MARK} 正常保存`
  const normalSave = await saveAs(freshBase, EP1, NORMAL_TEXT)
  check('5. 携带当前版本保存返回 200（不误伤正常路径）', normalSave.status === 200, `status=${normalSave.status} msg=${JSON.stringify(normalSave.json?.msg ?? '')}`)

  /* ------------------------------------------------------ 6. 刷新/重读一致 */
  const reloaded = await readProject(dramaId)
  check('6. 重新读取（等价于刷新）返回已保存内容', scriptOf(reloaded, EP1) === NORMAL_TEXT, `第1集=${JSON.stringify(scriptOf(reloaded, EP1))}`)

  /* ------------------------------------------------ 7. 向后兼容：不带版本 */
  const compatBase = await readProject(dramaId)
  const COMPAT_TITLE = `${MARK} 无版本更新`
  const compat = await api(dramaUrl(dramaId), {
    method: 'PATCH',
    body: JSON.stringify({ ...compatBase, title: COMPAT_TITLE, episodes: compatBase.episodes.map((episode) => ({ ...episode })) }),
  })
  const afterCompat = await readProject(dramaId)
  check('7. 不带 updatedAt 的 PATCH 仍然成功（老客户端兼容通道）', compat.status === 200, `status=${compat.status} msg=${JSON.stringify(compat.json?.msg ?? '')}`)
  check('7. 不带 updatedAt 的 PATCH 确实写入', afterCompat.title === COMPAT_TITLE, `title=${JSON.stringify(afterCompat.title)}`)

  /* ------------------------------------------ 8. 真实 UI：冲突时保留草稿 */
  /**
   * 3310 是**改动前的预构建产物**：本轮新增的冲突 UI（版本冲突提示 +
   * 查看最新版本 + 复制草稿）不在其中，因此相关断言无法在该构建上执行。
   *
   * 这里先探测构建是否包含新 UI，包含才跑，否则如实记 SKIP。
   *
   * 隔离性：**自己新建一个画布项目**并让它关联到本脚本的隔离短剧项目，
   * 再打开 `/projects/<自己建的画布 id>/script`。
   * 绝不打开既有的真实项目页面 —— 那样会把真实项目的草稿/保存路径卷进来。
   */
  const handoff = `saveconf-${Date.now().toString(36)}`
  const canvasCreated = await api('/api/canvas/projects', {
    method: 'POST',
    body: JSON.stringify({ title: `${MARK} UI 隔离画布`, sourceHandoffId: handoff }),
  })
  canvasId = canvasCreated.json?.data?.project?.id ?? null
  console.log(`[隔离画布] ${canvasId} status=${canvasCreated.status}`)

  /**
   * 关联规则：画布 `canvas-<handoff>` ↔ 短剧 `drama-<handoff>`。
   * 用同一 handoff 再建一个短剧项目最容易，但本脚本的短剧项目 id 是随机的，
   * 因此改为**用画布来源重建**：先把既有隔离短剧项目的 sourceHandoffId 换成 handoff。
   * 后端在 PATCH 时保留 `current.sourceHandoffId`，所以走不通；
   * 直接新建一个以该 handoff 为来源的短剧项目，并把它作为 UI 用例的专属项目。
   */
  const uiDrama = handoff ? await api('/api/drama/projects', {
    method: 'POST',
    body: JSON.stringify({ title: `${MARK} UI 隔离短剧`, summary: 'UI 用例专属', sourceHandoffId: handoff, initialScript: `${MARK} UI 初始正文` }),
  }) : { status: 0 }
  const uiDramaId = uiDrama.json?.data?.project?.id ?? null
  console.log(`[隔离短剧(UI)] ${uiDramaId} status=${uiDrama.status}`)

  const scriptUrl = canvasId ? `${BASE}/projects/${canvasId}/script` : ''
  let buildHasConflictUi = false
  let hasEditors = false
  let uiShotId = ''
  if (scriptUrl && uiDramaId) {
    // 给 UI 专属短剧项目种一个镜头，让「保存草稿」走镜头写入路径。
    const uiBase = await readProject(uiDramaId)
    uiShotId = 'shot-ui-isolated'
    await api(dramaUrl(uiDramaId), {
      method: 'PATCH',
      body: JSON.stringify({
        ...uiBase,
        episodes: uiBase.episodes.map((episode) => ({
          ...episode,
          shots: [{ id: uiShotId, order: 1, title: 'UI 镜头', description: `${MARK} UI 初始正文`, dialogue: '', duration: 5 }],
        })),
      }),
    })
    await page.goto(scriptUrl, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3500)
    hasEditors = (await page.locator('textarea[aria-label="环境与动作正文"]').count()) > 0
    /**
     * 判断「运行中的构建是否包含本轮的新 UI」。
     *
     * 早先这里找的是「其他窗口被修改 / 查看最新版本」**文案**——
     * 但那些文案只在**冲突发生之后**才渲染，刚打开页面时永远不存在，
     * 于是一个已经重新构建过的产物也会被误判成「旧构建」，
     * 5 条本可执行的断言被错误地记成 NOT-EXECUTED（实测踩到）。
     *
     * 改为探测**无条件渲染**的新结构特征：`data-testid="script-save"`
     * 是本轮新增的保存按钮钩子，只要页面渲染出来就存在，与是否冲突无关。
     */
    buildHasConflictUi = (await page.locator('[data-testid="script-save"]').count()) > 0
  }

  if (!hasEditors) {
    skip('8. 冲突时草稿被保留（真实 UI）', '当前 3310 构建的剧本页没有正文编辑区，无法执行')
  } else {
    /**
     * 制造冲突：先由脚本用**当前版本**把 UI 专属项目推进一版，
     * 页面里持有的仍是它自己加载时的旧版本 → 点「保存草稿」必然 409。
     */
    const beforeUiSave = await readProject(uiDramaId)
    const UI_DRAFT = `${MARK} UI 草稿必须保留 ${Date.now().toString(36)}`
    const bodyBox = page.locator('textarea[aria-label="环境与动作正文"]')
    const originalBody = await bodyBox.inputValue()
    await bodyBox.fill(UI_DRAFT)
    await page.waitForTimeout(300)

    const interfered = await saveAs(beforeUiSave, beforeUiSave.episodes[0].id, `${MARK} 别的窗口写入`, uiDramaId, beforeUiSave.updatedAt)
    if (interfered.status !== 200) {
      skip('8. 冲突时草稿被保留（真实 UI）', `无法制造冲突：干扰写入 status=${interfered.status}`)
    } else {
      const saveButton = page.locator('[data-testid="script-save"], button[aria-label="保存草稿"]').first()
      await saveButton.click({ force: true }).catch(() => {})
      await page.waitForTimeout(3500)

      const keptDraft = await bodyBox.inputValue()
      if (buildHasConflictUi) {
        check('8. 冲突后编辑区里的草稿被保留（未被清空/回滚）', keptDraft === UI_DRAFT, `编辑区=${JSON.stringify(keptDraft.slice(0, 60))} 期望=${JSON.stringify(UI_DRAFT.slice(0, 60))}`)
        const pageText = await page.locator('body').innerText().catch(() => '')
        check(
          '8. 冲突时显示真实错误（不谎报已保存）',
          /其他窗口|版本冲突/.test(pageText) && !/已保存 · (刚刚|\d)/.test(pageText),
          `页面含冲突提示=${/其他窗口|版本冲突/.test(pageText)}`,
        )
        check('8. 提供「查看最新版本」入口', (await page.locator('[data-testid="script-view-latest"]').count()) > 0, '')
        check('8. 提供「复制草稿」入口', (await page.locator('[data-testid="script-copy-draft"]').count()) > 0, '')

        /** UI 专属项目里，被拒绝的那次保存绝不能落库。 */
        const uiAfter = await readProject(uiDramaId)
        check('8. 被拒绝的冲突保存没有写入 UI 专属项目', uiAfter.episodes[0].shots[0]?.description !== UI_DRAFT, `服务端=${JSON.stringify(String(uiAfter.episodes[0].shots[0]?.description ?? '').slice(0, 50))}`)
      } else {
        /**
         * 3310 是改动前的构建：它的 `saveDramaProject` 仍然 `delete updatedAt`，
         * 所以这次「冲突保存」按设计会**成功**并覆盖 —— 这不是新代码的缺陷，
         * 而是旧构建的已知行为。相关断言无法执行，如实记为 NOT-EXECUTED。
         */
        skip('8. 冲突后编辑区里的草稿被保留（未被清空/回滚）', '3310 是改动前的构建：它发出的 PATCH 不带 updatedAt，按旧契约本就不会冲突，无法制造 409 场景')
        skip('8. 冲突时显示真实错误（不谎报已保存）', '同上：旧构建下这次保存返回 200，冲突 UI 不可能出现')
        skip('8. 提供「查看最新版本」入口', '新 UI 不在 3310 的构建产物里（源码已实现，需重新构建才能断言）')
        skip('8. 提供「复制草稿」入口', '新 UI 不在 3310 的构建产物里（源码已实现，需重新构建才能断言）')
        skip('8. 被拒绝的冲突保存没有写入 UI 专属项目', '同上：旧构建下这次保存没有被拒绝，无从断言「未写入」')
      }

      // 还原页面草稿，避免影响后续断言。
      await bodyBox.fill(originalBody).catch(() => {})
    }
    // UI 专属项目用完即删（cleanup 只管主隔离项目）。
    if (uiDramaId) {
      const removed = await api(dramaUrl(uiDramaId), { method: 'DELETE' }).catch(() => ({ status: 0 }))
      console.log(`[清理] DELETE ${uiDramaId} status=${removed.status}`)
    }
  }
  /**
   * 8b. 前端源码行为：`saveDramaProject` 必须把版本发出去。
   *
   * 3310 跑的是改动前的构建，无法用真实 UI 断言「请求体里带 updatedAt」。
   * 但这条恰恰是缺陷的第一环（`delete payload.updatedAt`），必须被锁住。
   *
   * 做法：用**本仓库真实的 TypeScript 编译器**把 `lib/studio/api.ts` 转译成 JS，
   * 在 Node 里求值，并用一个捕获请求体的 `fetch` 桩驱动**真实的**
   * `saveDramaProject` + `request`（不是重写一份实现）。
   * `api.ts` 的 import 全是 `import type`，转译后会被完全擦除，因此模块可独立求值。
   * 任何转译/求值失败都会走 NOT-EXECUTED，不会静默通过。
   */
  {
    const apiPath = resolve(import.meta.dirname ?? '.', '..', 'lib', 'studio', 'api.ts')
    let probe
    try {
      const ts = frontendRequire('typescript')
      const transpiled = ts.transpileModule(readFileSync(apiPath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
        fileName: 'api.ts',
      }).outputText
      // 去掉 ESM 导出关键字，把整个模块求值成一个可调用的函数体。
      const moduleBody = transpiled.replace(/^export /gm, '')
      const captured = []
      const fetchStub = async (_path, init) => {
        const payload = JSON.parse(init.body)
        captured.push(payload)
        /**
         * 复刻后端语义：携带**过期**版本时返回 409。
         * 用来验证前端确实把 409 原样抛出（而不是吞掉或转成成功）。
         */
        if (payload.updatedAt === '2020-01-01T00:00:00.000Z') {
          return new Response(JSON.stringify({ code: 409, data: null, msg: '短剧项目已在其他页面更新，请刷新后重试' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ code: 0, data: { project: { id: 'drama-probe' } }, msg: 'OK' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // 真实 api.ts 里的 request / StudioApiError / saveDramaProject 由模块自身提供。
      const factory = new Function('fetch', `${moduleBody}\nreturn { saveDramaProject, StudioApiError }`)
      const api = factory(fetchStub)
      const project = { id: 'drama-probe', title: 'T', episodes: [{ id: 'e1' }], updatedAt: '2026-01-01T00:00:00.000Z' }
      // 用例一：显式传入版本（use-drama-project 的实际调用方式）。
      await api.saveDramaProject('drama-probe', project, project.updatedAt)
      // 用例二：不传版本 → 退回项目对象自带的版本。
      await api.saveDramaProject('drama-probe', project)
      // 用例三：409 必须原样抛出（不能被吞掉或转成成功）。
      let conflictStatus = null
      try {
        await api.saveDramaProject('drama-probe', project, '2020-01-01T00:00:00.000Z')
      } catch (error) {
        conflictStatus = error?.status ?? null
      }
      probe = { captured, conflictStatus }
    } catch (error) {
      probe = { error: String(error?.stack ?? error) }
    }

    if (probe.error) {
      skip('8b. 前端源码：saveDramaProject 必须把读到的版本发出去', `无法转译/求值 lib/studio/api.ts：${probe.error.split('\n')[0]}`)
    } else {
      const explicit = probe.captured[0] ?? {}
      const implicit = probe.captured[1] ?? {}
      check('8b. 前端源码：saveDramaProject 发出的 payload 带上了显式传入的版本', explicit.updatedAt === '2026-01-01T00:00:00.000Z', `payload.updatedAt=${JSON.stringify(explicit.updatedAt)}`)
      check('8b. 前端源码：不再删除 updatedAt（缺陷根因已消除）', 'updatedAt' in explicit && 'updatedAt' in implicit, `keys=${JSON.stringify(Object.keys(explicit).slice(0, 8))}`)
      check('8b. 前端源码：未显式传版本时退回项目自带版本（而不是新读一版）', implicit.updatedAt === '2026-01-01T00:00:00.000Z', `payload.updatedAt=${JSON.stringify(implicit.updatedAt)}`)
      check('8b. 前端源码：后端返回的 409 原样抛出给调用方（不吞、不重试）', probe.conflictStatus === 409, `status=${probe.conflictStatus}`)
    }
  }
} finally {
  await cleanup()
}

/* ------------------------------------------------------------ 零残留断言 */
const listed = await api('/api/drama/projects?page=1&pageSize=100')
const residue = (listed.json?.data?.projects ?? []).filter((item) => String(item.id || '').includes(MARK) || String(item.title || '').includes(MARK))
check('9. 隔离项目已删除，零残留', residue.length === 0, `残留=${residue.length} titles=${JSON.stringify(residue.map((item) => item.title))}`)
if (dramaId) {
  const gone = await api(dramaUrl(dramaId))
  check('9. 隔离项目 id 已不可读（404）', gone.status === 404, `GET status=${gone.status}`)
}
const canvasListed = await api('/api/canvas/projects?page=1&pageSize=100')
const canvasResidue = (canvasListed.json?.data?.projects ?? []).filter((item) => String(item.id || '').includes(MARK) || String(item.title || '').includes(MARK))
check('9. 隔离画布项目已删除，零残留', canvasResidue.length === 0, `残留=${canvasResidue.length} titles=${JSON.stringify(canvasResidue.map((item) => item.title))}`)

await browser.close()

const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed.length}，未执行 ${notExecuted.length}，失败 ${failed.length}`)
if (notExecuted.length) { console.log('未执行项（构建落后，既不算通过也不算失败）：'); for (const item of notExecuted) console.log(` - ${item.name} :: ${item.why}`) }
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`) }
process.exit(failed.length ? 1 : 0)
