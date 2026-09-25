import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 剧本 / 分镜真实持久化回归（缺陷 A + B）。
 *
 * 覆盖两个已经复现的 P1 缺陷：
 *  A. 剧本「假保存」：`ScriptWorkspace.saveDraft()` 只把本地 React state 改成
 *     「已保存 · 刚刚」，**一个写请求都没发**；正文来自 `mock-data.ts` 的演示镜头，
 *     刷新后回到硬编码默认值。
 *  B. 分镜「演示生成」：`StoryboardPanel.generateShot()` 调 `addDemoTask(...)`，
 *     只减本地 `state.credits` 并塞一条本地任务，从不调用真实生成接口。
 *
 * 因此本脚本的断言**全部针对修复后的行为**，并用真实浏览器 + 真实 HTTP 验证：
 *  1. 真实PATCH `/api/drama/projects/<真实短剧 id>`（URL 必须是短剧 id，绝不能是画布 id）
 *  2. 刷新后文本仍在（与服务端逐字比对）
 *  3. 换一个全新浏览器上下文（重新登录）后文本仍在
 *  4. 保存失败（路由拦截返回 500）时：不显示「已保存」、草稿保留、显示真实错误
 *  5. 分镜：点「生成当前镜头」发真实 `POST /api/image-tasks`，
 *     且镜头上的任务 id / 状态能从服务端读回
 *  6. 首页 → 短剧的创作意图（提示词与参考文件）是否真的到达（第 4 项验收）
 *
 * 环境说明：预览服务 3310 上的构建**可能早于本次改动**。
 * 脚本会在开始时探测当前构建到底具备哪些新行为，并把「无法执行的断言」
 * 明确打印成 NOT-EXECUTED，而不是静默通过或当作跳过。构建落后时退出码为 3。
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const USERNAME = 'fusion_admin'
const PASSWORD = TEST_PASSWORD
/** 本次运行创建的测试项目统一前缀，便于识别与清理。 */
const MARK_PREFIX = 'SCRIPTTEST-'
const RUN = Date.now().toString(36).toUpperCase()

const results = []
/** 因当前构建缺少新代码而无法执行的断言：既不算通过，也不算失败。 */
const notExecuted = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
const skip = (name, why) => {
  notExecuted.push({ name, why })
  console.log(`NOT-EXECUTED ${name} :: ${why}`)
}

mkdirSync(resolve(import.meta.dirname ?? '.', '.artifacts'), { recursive: true })

const browser = await chromium.launch()
let session
try {
  session = await authenticatedContext(browser, { base: BASE, username: USERNAME, password: PASSWORD })
} catch (error) {
  await browser.close()
  if (error.throttled) exitThrottled(error.message)
  throw error
}
const page = session.page
console.log(`[会话] ${session.reused ? '复用已登录会话' : '已重新登录'} · 运行标记 ${RUN}`)

/** 在页面上下文里发真实 HTTP 请求（带会话 Cookie）。 */
const api = (path, init) => page.evaluate(async ({ path, init }) => {
  const response = await fetch(path, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}, { path, init })

/* ======================================================================
 * 0. 环境与构建探测
 * ==================================================================== */

const buildProbe = await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' }).then(() => page.evaluate(() => true)).catch(() => false)
if (!buildProbe) {
  console.log('FAIL 无法打开发布在 3310 的前端')
  await browser.close()
  process.exit(1)
}
await page.waitForTimeout(2500)

const sessionOk = await page.evaluate(async () => {
  const payload = await (await fetch('/api/auth/session', { cache: 'no-store' })).json().catch(() => null)
  return Boolean(payload?.user?.id)
})
check('测试账号已登录且服务端确认会话有效', sessionOk)

/* ======================================================================
 * 1. 建立真实测试数据：短剧项目 + 关联画布项目
 * ==================================================================== */

/** 画布 id → handoff（后端 canvas-project-service: `canvas-${sourceHandoffId}`）。 */
const handoff = `scripttest-${RUN}`
const canvasId = `canvas-${handoff}`
/** 后端 drama-project-service: `drama-${sourceHandoffId}`。 */
const expectedDramaId = `drama-${handoff}`

/** 1a. 创建一个带初始正文与一集的短剧项目，并带上 sourceHandoffId 建立关联。 */
const created = await api('/api/drama/projects', {
  method: 'POST',
  body: JSON.stringify({
    title: `${MARK_PREFIX}${RUN} 剧本持久化验收`,
    summary: '由 drama-script-persistence.test.mjs 创建，用于验收真实保存',
    style: '电影感国漫',
    initialScript: `【验收初始正文 ${RUN}】`,
    sourceHandoffId: handoff,
  }),
})
const dramaId = created.body?.data?.project?.id ?? null
check('创建真实短剧项目（带 sourceHandoffId）', created.status === 200 && Boolean(dramaId), `status=${created.status} id=${dramaId}`)
check('短剧 id 由后端按 handoff 规则生成（drama-<handoff>）', dramaId === expectedDramaId, `expected=${expectedDramaId} actual=${dramaId}`)

/** 1b. 创建与之关联的画布项目（用同一个 handoff，画布 id 因此可反推短剧 id）。 */
const canvasCreated = await api('/api/canvas/projects', {
  method: 'POST',
  body: JSON.stringify({ title: `${MARK_PREFIX}${RUN} 关联画布`, sourceHandoffId: handoff }),
})
const realCanvasId = canvasCreated.body?.data?.project?.id ?? null
check('创建关联画布项目（canvas-<handoff>）', canvasCreated.status === 200 && realCanvasId === canvasId, `expected=${canvasId} actual=${realCanvasId}`)

/* ---------------- 静态解析规则自检（纯字符串规则，可离线验证） ---------------- */

/**
 * 与 `lib/studio/drama-link.ts` 同一套规则的最长匹配解析。
 * 这里**独立重写一份**而不是 import 前端源码：验收脚本必须能发现实现被改错，
 * 而不是跟着实现一起错。
 */
function resolveLinked(canvasProject, dramaIds, sourceHandoffId) {
  const id = String(canvasProject || '').trim()
  const explicit = String(sourceHandoffId || '').trim()
  const handoffValue = explicit || (id.startsWith('canvas-') ? id.slice(7) : id)
  if (!handoffValue) return null
  let matched = null
  for (const candidate of dramaIds) {
    const drama = String(candidate || '').trim()
    if (!drama) continue
    const hit = handoffValue.startsWith(`${drama}-`)
      || handoffValue.startsWith(`drama-${drama}-`)
      || handoffValue === drama
      || drama === `drama-${handoffValue}`
    if (!hit) continue
    if (!matched || drama.length > matched.length) matched = drama
  }
  return matched
}

/** 生产环境实测到的真实 id（探针输出），用于验证规则本身。 */
const REAL_DRAMA_ID = 'drama-SEzZ-MYSkXDT8G3cJ-2g7'
const REAL_CANVAS_ID = 'canvas-drama-drama-SEzZ-MYSkXDT8G3cJ-2g7-episode-FPMypfkUlh1lbDumDj4mU'
check(
  '关联规则：真实画布 id 能解析到对应的真实短剧 id',
  resolveLinked(REAL_CANVAS_ID, [REAL_DRAMA_ID]) === REAL_DRAMA_ID,
  `${REAL_CANVAS_ID} → ${resolveLinked(REAL_CANVAS_ID, [REAL_DRAMA_ID])}`,
)
check(
  '关联规则：没有短剧来源的画布项目（canvas-aurora）如实返回 null',
  resolveLinked('canvas-aurora', [REAL_DRAMA_ID]) === null,
  `canvas-aurora → ${resolveLinked('canvas-aurora', [REAL_DRAMA_ID])}`,
)
check(
  '关联规则：多个候选时取最长匹配（短 id 不抢长 id）',
  resolveLinked(`canvas-drama-${REAL_DRAMA_ID}-x`, [REAL_DRAMA_ID, `drama-${REAL_DRAMA_ID}-x`]) === `drama-${REAL_DRAMA_ID}-x`,
  `→ ${resolveLinked(`canvas-drama-${REAL_DRAMA_ID}-x`, [REAL_DRAMA_ID, `drama-${REAL_DRAMA_ID}-x`])}`,
)
check(
  '关联规则：画布先建、短剧后建（canvas-H ↔ drama-H）也能连上',
  resolveLinked(`canvas-${handoff}`, [expectedDramaId]) === expectedDramaId,
  `canvas-${handoff} → ${resolveLinked(`canvas-${handoff}`, [expectedDramaId])}`,
)
check(
  '关联规则：画布未关联短剧时如实返回 null（不误连到别人的项目）',
  resolveLinked(canvasId, [`drama-${handoff}-other`, REAL_DRAMA_ID]) === null,
  `→ ${resolveLinked(canvasId, [`drama-${handoff}-other`, REAL_DRAMA_ID])}`,
)
check('关联规则：本次测试画布 id 解析到本次测试短剧 id', resolveLinked(canvasId, [dramaId]) === dramaId, `${canvasId} → ${dramaId}`)

/** 服务端读回完整短剧项目（断言用，独立于页面实现）。 */
const readDrama = async (id = dramaId) => {
  const response = await api(`/api/drama/projects/${encodeURIComponent(id)}`)
  return response.body?.data?.project ?? null
}

/**
 * 1c. 给分集补一个真实镜头。
 *
 * 剧本页与分镜页的所有断言都需要镜头存在：
 *  - 有镜头时正文/对白写进 `shot.description` / `shot.dialogue`；
 *  - 分镜生成需要镜头的 `imagePrompt`。
 * 这里用真实 PATCH（与页面走同一条服务合同）写入，不走 UI。
 */
const SHOT_ID = `shot-scripttest-${RUN}`
const SHOT_PROMPT = `SCRIPTTESTSHOT${RUN} 雨夜青石长街，女捕亲手提暖黄灯笼立于街心，电影感国漫`
{
  const project = await readDrama()
  const episode = project?.episodes?.find((item) => item.id === project.activeEpisodeId) ?? project?.episodes?.[0]
  const seeded = await api(`/api/drama/projects/${encodeURIComponent(dramaId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...project,
      episodes: project.episodes.map((item) => item.id !== episode.id ? item : {
        ...item,
        shots: [{
          id: SHOT_ID,
          order: 1,
          title: `验收镜头 ${RUN}`,
          description: `脚本正文占位 ${RUN}`,
          sourceText: '',
          shotBoundary: '',
          dialogue: '',
          narration: '',
          utterances: [],
          imagePrompt: SHOT_PROMPT,
          videoPrompt: '',
          cameraMotion: '',
          duration: 5,
          characterIds: [],
          propIds: [],
          clueIds: [],
          storyboardStatus: 'idle',
          generationStatus: 'idle',
        }],
      }),
    }),
  })
  const readBack = await readDrama()
  const readBackShot = (readBack?.episodes?.find((item) => item.id === readBack.activeEpisodeId) ?? readBack?.episodes?.[0])?.shots?.find((item) => item.id === SHOT_ID)
  check('准备分镜镜头（真实 PATCH 写入短剧项目）', seeded.status === 200 && Boolean(readBackShot), `status=${seeded.status} shot=${readBackShot?.id}`)
}

/* ======================================================================
 * 1d. 服务合同自检（与构建无关，直接打真实后端）
 *
 * 这一节验证的是**新代码所依赖的服务端行为**：如果这些前提不成立，
 * 即使前端代码正确也保存不了。因此它现在就能给出确定结论。
 * ==================================================================== */

{
  const CONTRACT_BODY = `CONTRACTBODY${RUN} 合同自检正文`
  const CONTRACT_DIALOGUE = `CONTRACTDIALOGUE${RUN} 合同自检对白`

  /**
   * (a) 不提交 updatedAt → 兼容通道，必须真的写入。
   *
   * 后端对「不带版本」的请求保留宽松语义（老客户端 / 脚本不被这次修复打断）；
   * 本项目自己的保存路径一律带版本，见本文件第 3 节的 409 用例与
   * `drama-save-conflict.test.mjs` 的并发用例。
   */
  const base = await readDrama()
  const patched = await api(`/api/drama/projects/${encodeURIComponent(dramaId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...base,
      updatedAt: undefined,
      episodes: base.episodes.map((item) => item.id !== base.activeEpisodeId ? item : {
        ...item,
        shots: item.shots.map((shot) => shot.id === SHOT_ID ? { ...shot, description: CONTRACT_BODY, dialogue: CONTRACT_DIALOGUE } : shot),
      }),
    }),
  })
  const afterPatch = await readDrama()
  const patchedShot = (afterPatch?.episodes?.find((item) => item.id === afterPatch.activeEpisodeId) ?? afterPatch?.episodes?.[0])?.shots?.find((item) => item.id === SHOT_ID)
  check(
    '服务合同：不带 updatedAt 的 PATCH 会真实写入镜头 description/dialogue',
    patched.status === 200 && patchedShot?.description === CONTRACT_BODY && patchedShot?.dialogue === CONTRACT_DIALOGUE,
    `status=${patched.status} description=${JSON.stringify(patchedShot?.description)}`,
  )
  check(
    '服务合同：PATCH 返回体里带新的 updatedAt（页面据此判断「已保存」）',
    typeof patched.body?.data?.project?.updatedAt === 'string' && patched.body.data.project.updatedAt !== base.updatedAt,
    `before=${base.updatedAt} after=${patched.body?.data?.project?.updatedAt}`,
  )

  /** (b) 缺 episodes 必须被拒绝（新实现因此始终回传完整项目）。 */
  const missingEpisodes = await api(`/api/drama/projects/${encodeURIComponent(dramaId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '缺集的请求' }),
  })
  check(
    '服务合同：缺 episodes 的 PATCH 被后端拒绝（400 短剧项目至少需要一集）',
    missingEpisodes.status === 400 && /至少需要一集/.test(String(missingEpisodes.body?.msg ?? '')),
    `status=${missingEpisodes.status} msg=${missingEpisodes.body?.msg}`,
  )

  /**
   * (c) 过期 updatedAt 必须被拒绝——契约已变更（P1 数据丢失修复）。
   *
   * 旧契约是「返回 200 但内容不变」（静默 no-op 假成功），本次修复把它改成**409**：
   * 客户端提交的是整份项目快照，200 会让它以为保存成功，实际编辑被整份丢弃。
   * 因此这里断言 409 + 明确文案 + 内容确实没被改动。
   */
  const staleBase = await readDrama()
  const stale = await api(`/api/drama/projects/${encodeURIComponent(dramaId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...staleBase,
      title: `${staleBase.title}（不应生效）`,
      updatedAt: new Date(Date.parse(staleBase.updatedAt) - 60_000).toISOString(),
    }),
  })
  const afterStale = await readDrama()
  check(
    '服务合同：过期 updatedAt 的 PATCH 返回 409（不再是 200 假成功）且内容不变',
    stale.status === 409 && /其他页面更新|其他窗口/.test(String(stale.body?.msg ?? '')) && afterStale.title === staleBase.title,
    `status=${stale.status} msg=${JSON.stringify(stale.body?.msg ?? '')} title=${JSON.stringify(afterStale.title)}`,
  )

  /** (d) 没有镜头时正文写进分集 script，且必须清掉 scriptRichContent（否则富文本会覆盖它）。 */
  const noShotBase = await readDrama()
  const SCRIPT_MARK = `CONTRACTSCRIPT${RUN} 分集正文`
  const noShotTarget = noShotBase.episodes[0].id
  const scripted = await api(`/api/drama/projects/${encodeURIComponent(dramaId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...noShotBase,
      episodes: noShotBase.episodes.map((item) => item.id !== noShotTarget ? item : { ...item, script: SCRIPT_MARK, scriptRichContent: undefined }),
    }),
  })
  const afterScript = await readDrama()
  const scriptedEpisode = afterScript?.episodes?.find((item) => item.id === noShotTarget)
  check(
    '服务合同：分集 script 能被真实写入并读回（无镜头时的写入位置）',
    scripted.status === 200 && scriptedEpisode?.script === SCRIPT_MARK && (scriptedEpisode?.scriptRichContent === undefined || scriptedEpisode?.scriptRichContent === null),
    `status=${scripted.status} script=${JSON.stringify(scriptedEpisode?.script)} rich=${JSON.stringify(scriptedEpisode?.scriptRichContent ?? null)}`,
  )
}

/* ======================================================================
 * 2. 剧本页：真实保存（缺陷 A 的验收）
 * ==================================================================== */

const scriptUrl = `${BASE}/projects/${canvasId}/script`
/** 记录非 GET 请求，用于断言「真的发了 PATCH」。 */
const writes = []
page.on('request', (request) => {
  if (request.method() === 'GET') return
  writes.push({ method: request.method(), url: request.url(), body: request.postData() ?? '', headers: request.headers() })
})
page.on('response', (response) => {
  if (response.request().method() === 'GET') return
  const record = writes.find((item) => item.url === response.url() && !item.status)
  if (record) record.status = response.status()
})

await page.goto(scriptUrl, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

/** 构建探测：新实现会渲染 aria-label="保存草稿" 的保存按钮（旧实现没有 aria-label）。 */
const hasNewSaveButton = await page.locator('button[aria-label="保存草稿"]').count() > 0
const bodyBox = page.locator('textarea[aria-label="环境与动作正文"]')
const dialogueBox = page.locator('textarea[aria-label="对白正文"]')
const hasScriptEditors = (await bodyBox.count()) > 0 && (await dialogueBox.count()) > 0
check('剧本页渲染正文与对白编辑区', hasScriptEditors)
console.log(`[构建探测] 新版保存按钮=${hasNewSaveButton}（false 表示 3310 仍是改动前的构建）`)

/** 2a. 内容来源必须是真实短剧项目，而不是演示数据。 */
const initialBody = hasScriptEditors ? await bodyBox.inputValue() : null
const initialDialogue = hasScriptEditors ? await dialogueBox.inputValue() : null
if (hasScriptEditors && hasNewSaveButton) {
  const project = await readDrama()
  const episode = project?.episodes?.find((item) => item.id === project.activeEpisodeId) ?? project?.episodes?.[0]
  const shot = episode?.shots?.[0]
  check(
    '进入剧本页时正文来自真实短剧项目（不是 mock-data 的演示正文）',
    shot ? initialBody === shot.description : initialBody === episode?.script,
    `页面=${JSON.stringify((initialBody ?? '').slice(0, 60))} 服务端=${JSON.stringify((shot ? shot.description : episode?.script ?? '').slice(0, 60))}`,
  )
} else {
  skip('进入剧本页时正文来自真实短剧项目', '当前构建仍是旧实现（无新版保存按钮），无法断言')
}

/** 2b. 编辑 + 保存。 */
const BODY_MARK = `SCRIPTBODY${RUN}`
const DIALOGUE_MARK = `SCRIPTDIALOGUE${RUN}`
if (!hasScriptEditors) {
  skip('保存草稿发出真实 PATCH 且 URL 含短剧 id', '剧本页缺少编辑区，无法执行')
  skip('刷新后编辑内容仍在', '剧本页缺少编辑区，无法执行')
} else {
  await bodyBox.fill(`${BODY_MARK} 阿箬在雨夜长街点亮灯笼。`)
  await dialogueBox.fill(`${DIALOGUE_MARK} 阿箬：这盏灯，我等了七年。`)
  await page.waitForTimeout(400)

  const badgeBefore = await page.locator('text=/未保存草稿|已保存|尚未保存/').first().innerText().catch(() => '')
  check('编辑后徽标显示未保存草稿', /未保存/.test(badgeBefore), `badge=${badgeBefore}`)

  writes.length = 0
  const saveButton = hasNewSaveButton ? page.locator('button[aria-label="保存草稿"]').first() : page.locator('button:has-text("保存草稿")').first()
  await saveButton.click()
  await page.waitForTimeout(3500)

  const dramaWrites = writes.filter((item) => item.method === 'PATCH' && item.url.includes('/api/drama/projects/'))
  check('点击保存草稿发出了写请求（不再是纯本地 state）', writes.length > 0, `写请求=${JSON.stringify(writes.map((item) => `${item.method} ${item.url.replace(BASE, '')}`))}`)
  check(
    'PATCH 指向 /api/drama/projects/<真实短剧 id>',
    dramaWrites.length > 0 && dramaWrites.every((item) => item.url.includes(encodeURIComponent(dramaId)) || item.url.endsWith(`/api/drama/projects/${dramaId}`)),
    `短剧 id=${dramaId} 写请求=${JSON.stringify(dramaWrites.map((item) => item.url.replace(BASE, '')))}`,
  )
  check(
    'PATCH 的 URL 绝不含画布 id（两个命名空间不能混用）',
    writes.every((item) => !item.url.includes(canvasId)),
    `画布 id=${canvasId}`,
  )

  const badgeAfter = await page.locator('text=/未保存草稿|已保存|尚未保存/').first().innerText().catch(() => '')
  check('保存成功后徽标显示已保存', /已保存/.test(badgeAfter), `badge=${badgeAfter}`)

  /** 2c. 服务端逐字比对。 */
  const afterSave = await readDrama()
  const episodeAfter = afterSave?.episodes?.find((item) => item.id === afterSave.activeEpisodeId) ?? afterSave?.episodes?.[0]
  const shotAfter = episodeAfter?.shots?.[0]
  const persistedBody = shotAfter ? shotAfter.description : episodeAfter?.script
  const persistedDialogue = shotAfter ? shotAfter.dialogue : ''
  check('服务端持久化了正文（逐字相等）', persistedBody === `${BODY_MARK} 阿箬在雨夜长街点亮灯笼。`, `服务端=${JSON.stringify((persistedBody ?? '').slice(0, 80))}`)
  check('服务端持久化了对白（逐字相等）', persistedDialogue === `${DIALOGUE_MARK} 阿箬：这盏灯，我等了七年。`, `服务端=${JSON.stringify((persistedDialogue ?? '').slice(0, 80))}`)

  /** 2d. 刷新后仍在。 */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  const reloadedBody = await bodyBox.inputValue()
  check('刷新页面后正文仍是编辑后的内容', reloadedBody === `${BODY_MARK} 阿箬在雨夜长街点亮灯笼。`, `刷新后=${JSON.stringify(reloadedBody.slice(0, 80))}`)
  const reloadedDialogue = await dialogueBox.inputValue()
  check('刷新页面后对白仍是编辑后的内容', reloadedDialogue === `${DIALOGUE_MARK} 阿箬：这盏灯，我等了七年。`, `刷新后=${JSON.stringify(reloadedDialogue.slice(0, 80))}`)
}

/* ======================================================================
 * 3. 全新浏览器上下文（重新登录）后仍然存在
 * ==================================================================== */

if (!hasScriptEditors) {
  skip('换一个全新浏览器上下文后内容仍在', '剧本页缺少编辑区，无法执行')
} else {
  const fresh = await authenticatedContext(browser, { base: BASE, username: USERNAME, password: PASSWORD, name: `${USERNAME}-fresh` }).catch((error) => {
    if (error.throttled) {
      skip('换一个全新浏览器上下文后内容仍在', `独立上下文登录被限流：${error.message}`)
      return null
    }
    throw error
  })
  if (fresh) {
    // 独立上下文本来就是全新会话：断言它读到的是**服务端**的值。
    await fresh.page.goto(scriptUrl, { waitUntil: 'networkidle' })
    await fresh.page.waitForTimeout(4000)
    const freshBody = await fresh.page.locator('textarea[aria-label="环境与动作正文"]').inputValue().catch(() => null)
    check(
      '全新浏览器上下文（独立登录会话）读到同一份内容',
      freshBody === `${BODY_MARK} 阿箬在雨夜长街点亮灯笼。`,
      `独立上下文=${JSON.stringify((freshBody ?? '').slice(0, 80))}`,
    )
    await fresh.context.close()
  }
}

/* ======================================================================
 * 4. 保存失败：不显示已保存、草稿保留、显示真实错误
 * ==================================================================== */

if (!hasScriptEditors || !hasNewSaveButton) {
  skip('保存失败时保留草稿并显示真实错误', '当前构建缺少新版保存按钮（无法可靠定位保存动作）')
} else {
  /**
   * 用路由拦截让 PATCH 返回 500。
   * 只拦 PATCH 且只拦短剧项目路径，不影响页面其它请求。
   */
  await page.route('**/api/drama/projects/**', async (route) => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return }
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 500, data: null, msg: '验收注入的服务端错误' }) })
  })
  const FAIL_MARK = `SCRIPTFAIL${RUN}`
  await bodyBox.fill(`${FAIL_MARK} 这段草稿在保存失败后必须保留。`)
  await page.waitForTimeout(400)
  await page.locator('button[aria-label="保存草稿"]').first().click()
  await page.waitForTimeout(3500)

  const badgeOnFailure = await page.locator('text=/未保存草稿|已保存|尚未保存/').first().innerText().catch(() => '')
  check('保存失败时徽标不显示「已保存」', !/已保存/.test(badgeOnFailure), `badge=${badgeOnFailure}`)
  const keptDraft = await bodyBox.inputValue()
  check('保存失败时草稿仍保留在编辑区', keptDraft === `${FAIL_MARK} 这段草稿在保存失败后必须保留。`, `编辑区=${JSON.stringify(keptDraft.slice(0, 80))}`)
  const pageText = await page.locator('body').innerText()
  check('保存失败时页面显示真实错误原因', /保存失败|验收注入的服务端错误/.test(pageText), `包含错误提示=${/验收注入的服务端错误/.test(pageText)}`)
  /** 服务端没有被这次失败请求改动（拦截在浏览器侧，未到达后端）。 */
  const afterFailure = await readDrama()
  const failureEpisode = afterFailure?.episodes?.find((item) => item.id === afterFailure.activeEpisodeId) ?? afterFailure?.episodes?.[0]
  const failureBody = failureEpisode?.shots?.[0] ? failureEpisode.shots[0].description : failureEpisode?.script
  check('保存失败后服务端内容未被破坏', !String(failureBody ?? '').includes(FAIL_MARK), `服务端=${JSON.stringify(String(failureBody ?? '').slice(0, 60))}`)

  await page.unroute('**/api/drama/projects/**')
  await page.screenshot({ path: resolve(import.meta.dirname ?? '.', '.artifacts', 'drama-script-save-failure.png'), fullPage: true }).catch(() => {})
}

/* ======================================================================
 * 5. 分镜：真实生成任务（缺陷 B 的验收）
 * ==================================================================== */

const storyboardUrl = `${BASE}/projects/${canvasId}/storyboard`
await page.goto(storyboardUrl, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

const hasNewStoryboardButton = await page.locator('button[data-testid="storyboard-generate"]').count() > 0
console.log(`[构建探测] 新版分镜生成按钮=${hasNewStoryboardButton}`)
/** 镜头已在本文件 1c 节用真实 PATCH 准备好。 */
const shotForStoryboard = (await readDrama())?.episodes?.flatMap((item) => item.shots ?? []).find((item) => item.id === SHOT_ID) ?? null

if (!hasNewStoryboardButton) {
  skip('分镜「生成当前镜头」发出真实 POST /api/image-tasks', '当前构建仍是旧实现（无 data-testid="storyboard-generate"）')
  skip('镜头上的真实任务 id / 状态能从服务端读回', '当前构建仍是旧实现')
} else {
  const beforeTaskId = shotForStoryboard?.storyboardTaskId ?? ''
  writes.length = 0
  const generateButton = page.locator('button[data-testid="storyboard-generate"]').first()
  await generateButton.click()
  /**
   * 必须**立刻**采样提示文案。
   *
   * 本地模拟上游完成得很快：任务进入终态后，结果写回 effect 会把提示替换成
   * 「镜头“…”生成完成，已写入短剧项目…」，于是 7 秒后再找「已创建真实生成任务 <id>」
   * 自然找不到。这不是功能缺陷，而是采样太晚（实测踩到）。
   * 因此这里改成轮询前几秒内的文案并累计命中，而不是固定等待 7 秒后只取最后一次。
   */
  let pageTaskId = null
  for (let attempt = 0; attempt < 40 && !pageTaskId; attempt += 1) {
    const text = await page.locator('body').innerText()
    const match = text.match(/已创建真实生成任务\s+([A-Za-z0-9._:-]+)/)
    if (match) pageTaskId = match[1]
    else await page.waitForTimeout(250)
  }
  await page.waitForTimeout(5000)

  const imageTaskWrites = writes.filter((item) => item.method === 'POST' && item.url.includes('/api/image-tasks'))
  check('点击「生成当前镜头」发出真实 POST /api/image-tasks', imageTaskWrites.length > 0, `写请求=${JSON.stringify(writes.map((item) => `${item.method} ${item.url.replace(BASE, '')}`))}`)
  if (imageTaskWrites[0]) {
    const sent = JSON.parse(imageTaskWrites[0].body || '{}')
    check(
      'POST 请求体带真实模型与来源（surface=drama），不是演示参数',
      Boolean(sent.prompt) && sent.source === 'drama' && Boolean(sent.config?.model),
      `source=${sent.source} model=${sent.config?.model} prompt=${JSON.stringify(String(sent.prompt ?? '').slice(0, 40))}`,
    )
    check(
      '分镜任务的幂等标识为 drama-storyboard-*（真实 clientRequestId）',
      String(imageTaskWrites[0].headers?.['x-vozeb-pro-client-request-id'] ?? '').startsWith('drama-storyboard-'),
      `header=${imageTaskWrites[0].headers?.['x-vozeb-pro-client-request-id']}`,
    )
  }

  check('页面显示了真实任务 id（不是演示任务）', Boolean(pageTaskId), `提示中的任务 id=${pageTaskId}`)

  /** 服务端读回镜头上的 task id / status —— 这才是「真实写回」的证据。 */
  const projectAfter = await readDrama()
  const shotAfterGen = projectAfter?.episodes?.flatMap((item) => item.shots ?? []).find((item) => item.id === SHOT_ID) ?? null
  check(
    '服务端镜头记录了真实 storyboardTaskId（且与页面显示一致）',
    /**
     * `pageTaskId` 必须存在且与服务端一致。
     * 早先写成 `(!pageTaskId || …)`：取不到页面 id 时该条件恒真，
     * 于是「页面没显示任务 id」这一真实失败会被这条断言**掩盖**（实测踩到）。
     */
    Boolean(shotAfterGen?.storyboardTaskId)
      && shotAfterGen.storyboardTaskId !== beforeTaskId
      && Boolean(pageTaskId)
      && shotAfterGen.storyboardTaskId === pageTaskId,
    `服务端=${shotAfterGen?.storyboardTaskId} 页面=${pageTaskId}`,
  )
  check(
    '服务端镜头 state 为 queued/running/success/error（真实任务状态，非演示）',
    ['queued', 'running', 'success', 'error'].includes(String(shotAfterGen?.storyboardStatus)),
    `storyboardStatus=${shotAfterGen?.storyboardStatus}`,
  )
  check(
    '任务是真实后端任务（能被 /api/image-tasks/<id> 查到）',
    Boolean(shotAfterGen?.storyboardTaskId) && (await api(`/api/image-tasks/${encodeURIComponent(shotAfterGen.storyboardTaskId)}`)).status === 200,
    `taskId=${shotAfterGen?.storyboardTaskId}`,
  )
}

/* ======================================================================
 * 6. 首页 → 短剧的创作意图是否真的到达（第 4 项验收）
 * ==================================================================== */

const INTENT_PROMPT = `SCRIPTINTENT${RUN} 雨夜长街上的重逢`
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const homeReady = await page.locator('#home-prompt').count() > 0
if (!homeReady) {
  skip('首页 → 短剧创作意图到达', '首页缺少 #home-prompt 输入框')
} else {
  await page.fill('#home-prompt', INTENT_PROMPT)
  await page.waitForTimeout(300)
  /** 切到「短剧」模式并开始创作。 */
  const dramaModeClicked = await page.locator('button:has-text("短剧")').first().click().then(() => true).catch(() => false)
  await page.waitForTimeout(500)
  const startButton = page.locator('button:has-text("开始创作")').first()
  const started = await startButton.click().then(() => true).catch(() => false)
  await page.waitForTimeout(7000)

  const currentUrl = page.url()
  console.log(`[首页跳转] dramaMode=${dramaModeClicked} started=${started} url=${currentUrl.replace(BASE, '')}`)

  /**
   * 首页会把意图写到 sessionStorage，目标项目是「当前选中的真实项目」。
   * 因此这里直接把意图写到本次测试的画布项目上，再打开剧本页，
   * 这样断言的是**工作台是否消费意图**，而不是首页选了哪个项目。
   */
  await page.evaluate(({ prompt, canvas }) => {
    window.sessionStorage.setItem('oaooao-create-intent', JSON.stringify({
      mode: 'drama', prompt, files: [], createdAt: Date.now(), projectId: canvas,
    }))
  }, { prompt: INTENT_PROMPT, canvas: canvasId })

  const beforeIntent = await readDrama()
  const episodeBeforeIntent = beforeIntent?.episodes?.find((item) => item.id === beforeIntent.activeEpisodeId) ?? beforeIntent?.episodes?.[0]
  const shotsBeforeIntent = episodeBeforeIntent?.shots?.length ?? 0
  const scriptBeforeIntent = episodeBeforeIntent?.script ?? ''

  await page.goto(scriptUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(7000)

  const afterIntent = await readDrama()
  const episodeAfterIntent = afterIntent?.episodes?.find((item) => item.id === afterIntent.activeEpisodeId) ?? afterIntent?.episodes?.[0]
  const scriptAfterIntent = episodeAfterIntent?.script ?? ''
  const outlineAfterIntent = episodeAfterIntent?.outline ?? ''

  /**
   * 真实结论：分集已有镜头时，提示词写入 `outline`（不覆盖镜头正文）；
   * 没有镜头时并入 `script`。两种情况都必须真的出现提示词才算「到达」。
   */
  const arrived = scriptAfterIntent.includes(INTENT_PROMPT) || outlineAfterIntent.includes(INTENT_PROMPT)
  check(
    '首页创作描述被真正写入短剧项目（script 或 outline）',
    arrived,
    `镜头数=${shotsBeforeIntent} script 前 60 字=${JSON.stringify(scriptAfterIntent.slice(0, 60))} outline=${JSON.stringify(outlineAfterIntent.slice(0, 60))}`,
  )
  check(
    '意图写入没有破坏分集正文（原内容仍在）',
    !scriptBeforeIntent || scriptAfterIntent.includes(scriptBeforeIntent.slice(0, 20)) || shotsBeforeIntent > 0,
    `写前=${JSON.stringify(scriptBeforeIntent.slice(0, 40))}`,
  )
}

/* ======================================================================
 * 7. 清理：删除本次创建的测试项目
 * ==================================================================== */

const cleanup = { drama: null, canvas: null }
if (dramaId) {
  const deleted = await api(`/api/drama/projects/${encodeURIComponent(dramaId)}`, { method: 'DELETE' })
  cleanup.drama = deleted.status
}
if (canvasId) {
  const deleted = await api('/api/canvas/projects', { method: 'DELETE', body: JSON.stringify({ ids: [canvasId] }) })
  cleanup.canvas = deleted.status
}
const remaining = await api('/api/drama/projects?page=1&pageSize=100')
const leftovers = (remaining.body?.data?.projects ?? []).filter((item) => String(item.id).startsWith(expectedDramaId))
check('清理测试短剧项目', (cleanup.drama === 200 || cleanup.drama === 404) && leftovers.length === 0, `DELETE=${cleanup.drama} 残留=${leftovers.length}`)
check('清理测试画布项目', cleanup.canvas === 200 || cleanup.canvas === 404, `DELETE=${cleanup.canvas}`)

await page.screenshot({ path: resolve(import.meta.dirname ?? '.', '.artifacts', 'drama-script-persistence.png'), fullPage: true }).catch(() => {})
await browser.close()

/* ======================================================================
 * 汇总
 * ==================================================================== */

const failed = results.filter((item) => !item.ok)
console.log('')
if (notExecuted.length) {
  console.log(`因当前构建（3310 上的预构建产物）不含本次改动，以下 ${notExecuted.length} 条断言**未执行**：`)
  for (const item of notExecuted) console.log(` - ${item.name} :: ${item.why}`)
  console.log('这些断言既不算通过，也不算失败；需要重新构建后再跑。')
}
console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}，未执行 ${notExecuted.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const item of failed) console.log(` - ${item.name} :: ${item.detail}`)
}
if (failed.length) process.exit(1)
if (notExecuted.length) process.exit(3)
process.exit(0)
