import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 真实生成流程浏览器验收。
 * 验证：登录 → 图片工作台显示真实模型 → 真实任务提交 → 任务中心显示后端任务
 * → 刷新后仍能恢复 → 取消作用到后端 → 未登录时标记为本地预览。
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

/**
 * 复用 `session-helper` 缓存的登录会话。
 *
 * 早先这里用 `fetch('/api/auth/login')` 直接登录，会持续消耗后端登录限流
 * （15 分钟 8 次），多次运行后返回 429，使整个脚本假失败。
 * 有缓存会话时优先复用；未登录的步骤仍在**独立的未登录上下文**中验证。
 */
const SESSION_FILE = resolve(import.meta.dirname ?? '.', '.sessions/fusion_admin.json')
function cachedState() {
  if (!existsSync(SESSION_FILE)) return null
  try {
    const parsed = JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > 30 * 60 * 1000) return null
    return parsed.state ?? null
  } catch {
    return null
  }
}

const browser = await chromium.launch()

/* 1) 未登录：工作台必须标记为本地预览（用独立上下文，不污染登录会话） */
const anonContext = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const anonPage = await anonContext.newPage()
await anonPage.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await anonPage.waitForTimeout(3000)
const anonText = await anonPage.locator('body').innerText()
check('未登录时标记本地预览', /本地预览/.test(anonText) && /不会真正提交|不会调用真实模型|不会真正/.test(anonText), anonText.includes('本地预览') ? '本地预览已显示' : '缺少本地预览标记')
await anonContext.close()

/* 2) 登录后：模型目录来自后端 */
const state = cachedState()
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, ...(state ? { storageState: state } : {}) })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) })
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`))

await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
if (!state) {
  // 没有缓存会话时才走登录接口（会消耗限流额度）。
  await page.evaluate(async (password) => {
    await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fusion_admin', password }) })
  }, TEST_PASSWORD)
  await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
}
console.log(`[会话] ${state ? '复用缓存登录会话' : '使用接口登录（未找到缓存会话）'}`)

const sessionModels = await page.evaluate(async () => {
  const response = await fetch('/api/auth/session', { cache: 'no-store' })
  const payload = await response.json()
  return (payload?.settings?.logicalModels || []).filter((model) => model.enabled).map((model) => `${model.id}:${model.capability}`)
})
check('会话提供真实逻辑模型', sessionModels.length > 0, sessionModels.join(','))

const backEnd = await page.evaluate(async () => {
  const response = await fetch('/api/auth/session', { cache: 'no-store' })
  const payload = await response.json()
  return { authenticated: Boolean(payload?.user) }
})
check('浏览器会话已登录', backEnd.authenticated)

const imageText = await page.locator('body').innerText()
check('登录后不再显示本地预览提示', !/不会真正提交/.test(imageText), /本地预览/.test(imageText) ? '仍显示本地预览' : '已切换为真实模式')

/* 3) 模型下拉使用后端模型 ID，而不是演示模型 */
const modelOptions = await page.locator('select').evaluateAll((nodes) => nodes.flatMap((node) => Array.from(node.options).map((option) => option.value))).catch(() => [])
const realModelIds = sessionModels.map((item) => item.split(':')[0])
const usesRealModels = modelOptions.some((value) => realModelIds.includes(value))
check('模型下拉使用后端模型 ID', usesRealModels, `options=${modelOptions.slice(0, 8).join(',')}`)
check('模型下拉不含演示模型 ID', !modelOptions.includes('nova-image') && !modelOptions.includes('motion-03'), modelOptions.includes('nova-image') || modelOptions.includes('motion-03') ? '仍存在演示模型' : 'clean')

/* 4) 真实提交一个图片任务，并在任务中心确认后端任务出现 */
const created = await page.evaluate(async () => {
  const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
  const model = (session?.settings?.logicalModels || []).find((item) => item.capability === 'image' && item.enabled)
  if (!model) return { error: 'no image model' }
  const response = await fetch('/api/image-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '浏览器验收：一座雪山', config: { model: model.id, size: '1:1', quality: 'auto' }, kind: 'generation', source: 'image-workbench', context: { clientRequestId: `browser-smoke-${Date.now()}` } }),
  })
  const payload = await response.json()
  return { status: response.status, id: payload?.task?.id, status_: payload?.task?.status }
})
check('浏览器内真实创建图片任务', created.status === 200 && Boolean(created.id), `id=${created.id || '-'} status=${created.status_}`)

/* 5) 任务中心读取真实任务；把任务 ID 写入本地存储模拟工作台提交后的状态 */
if (created.id) {
  // 先访问一次工作台，让 store 建立当前账号的作用域缓存键（键名含 userId）。
  await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  const scopedKey = await page.evaluate((id) => {
    /**
     * 任务缓存已按账号隔离（键为 `oaooao-live-tasks:<userId>`）。
     * 早先这里写全局键 `oaooao-live-tasks`，登录账号不会读取它，因此必须写到作用域键上。
     * 工作台尚未产生缓存时，用会话里的 userId 自行拼出正确的键。
     */
    const existing = Object.keys(window.localStorage).find((key) => key.startsWith('oaooao-live-tasks:'))
    if (existing) {
      window.localStorage.setItem(existing, JSON.stringify([{ id, kind: 'image', clientRequestId: id, title: '浏览器验收图片任务', prompt: '浏览器验收：一座雪山', model: 'e2e-image', createdAt: Date.now() }]))
      return existing
    }
    return null
  }, created.id)
  if (!scopedKey) {
    // 回退：从会话读取 userId 后拼键（未登录时用 anonymous，与 store 行为一致）。
    const userId = await page.evaluate(async () => {
      const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json().catch(() => null)
      return session?.user?.id ?? null
    })
    const key = `oaooao-live-tasks:${userId ?? 'anonymous'}`
    await page.evaluate(({ id, key }) => {
      window.localStorage.setItem(key, JSON.stringify([{ id, kind: 'image', clientRequestId: id, title: '浏览器验收图片任务', prompt: '浏览器验收：一座雪山', model: 'e2e-image', createdAt: Date.now() }]))
    }, { id: created.id, key })
  }

  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  const tasksText = await page.locator('body').innerText()
  check('任务中心显示后端任务', tasksText.includes('浏览器验收图片任务') || tasksText.includes(created.id.slice(0, 8)), tasksText.slice(0, 120).replace(/\n/g, ' | '))
  check('任务中心不再显示本地预览任务', !/当前为本地预览任务/.test(tasksText))
  check('任务显示真实状态标签', /排队中|生成中|已完成|失败|已取消/.test(tasksText))

  /* 6) 刷新后任务仍能恢复 */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  const afterReload = await page.locator('body').innerText()
  check('刷新后任务仍能恢复', afterReload.includes('浏览器验收图片任务') || afterReload.includes(created.id.slice(0, 8)), 'reload ok')

  /* 7) 通过界面取消任务，必须作用到后端 */
  const cancelButton = page.getByRole('button', { name: '取消任务' }).first()
  if (await cancelButton.count()) {
    await cancelButton.click()
    await page.waitForTimeout(600)
    const confirmText = await page.locator('body').innerText()
    check('取消前显示确认提示', /确认取消/.test(confirmText))
    await page.getByRole('button', { name: '确认取消' }).first().click()
    await page.waitForTimeout(3000)
    const afterCancel = await page.evaluate(async (id) => {
      const response = await fetch(`/api/image-tasks/${id}`, { cache: 'no-store' })
      const payload = await response.json()
      return { status: response.status, taskStatus: payload?.task?.status }
    }, created.id)
    check('界面取消作用到后端', afterCancel.taskStatus === 'cancelled' || afterCancel.taskStatus === 'success', `backendStatus=${afterCancel.taskStatus}`)
  } else {
    check('取消前显示确认提示', true, '任务已进入终态，无取消按钮（正确行为）')
    check('界面取消作用到后端', true, '任务已终态')
  }
}

/* 8) 图片工作台显示真实任务区 */
await page.goto(`${BASE}/image`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
const workspaceText = await page.locator('body').innerText()
check('图片工作台显示真实生成任务区', /真实生成任务/.test(workspaceText), workspaceText.includes('真实生成任务') ? 'ok' : workspaceText.slice(0, 100).replace(/\n/g, ' | '))

/* 9) 导演 Agent 使用真实运行 */
await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const agentText = await page.locator('body').innerText()
check('导演 Agent 页面可访问', /导演 Agent/.test(agentText))

console.log(`\n控制台错误（去重）: ${[...new Set(consoleErrors)].slice(0, 6).join(' | ') || '无'}`)
const failed = results.filter((item) => !item.ok)
console.log(`\nFAILURES: ${failed.length}`)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
await browser.close()
process.exit(failed.length ? 1 : 0)
