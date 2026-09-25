/**
 * 测试登录辅助：缓存已登录会话，避免反复消耗后端登录限流。
 *
 * 后端登录限流是 15 分钟 8 次，按 IP + 设备指纹 + 账号维度计算。
 * 多个验收脚本连续运行时，每个脚本独立登录会很快触顶，
 * 于是把「功能缺陷」和「环境限流」混在一起。
 *
 * 这里把登录后的 storageState 落盘复用：
 * - 首次运行：走**真实登录表单**登录并保存会话；
 * - 后续运行：优先复用未过期的会话；
 * - 会话失效时：重新走真实表单登录。
 *
 * 复用会话不影响验收有效性：登录流程本身的正确性由
 * `commercial-readiness.test.mjs` 的表单登录用例单独覆盖。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SESSION_DIR = resolve(import.meta.dirname ?? '.', '.sessions')
/** 后端会话有效期通常为小时级；这里保守取 30 分钟再复用。 */
const MAX_SESSION_AGE_MS = 30 * 60 * 1000

function sessionPath(name) {
  return resolve(SESSION_DIR, `${name}.json`)
}

function readFreshSession(name) {
  const file = sessionPath(name)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAX_SESSION_AGE_MS) return null
    return parsed.state ?? null
  } catch {
    return null
  }
}

export function saveSession(name, state) {
  try {
    mkdirSync(dirname(sessionPath(name)), { recursive: true })
    writeFileSync(sessionPath(name), JSON.stringify({ savedAt: Date.now(), state }), 'utf8')
  } catch {
    // 落盘失败不影响本次运行。
  }
}

/**
 * 取得一个已登录的浏览器上下文。
 * 返回 `{ context, reused }`；`reused` 为 true 表示复用了缓存会话（未消耗登录额度）。
 */
export async function authenticatedContext(browser, { base, username, password, name = username, viewport = { width: 1440, height: 950 } } = {}) {
  const options = { viewport }
  const cached = readFreshSession(name)
  if (cached) {
    const context = await browser.newContext({ ...options, storageState: cached })
    const page = await context.newPage()
    await page.goto(`${base}/account`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    /**
     * 必须向服务端确认会话真的有效。
     * 早先只看「账户菜单按钮存在」，而该按钮的渲染不依赖服务端校验，
     * 于是过期会话被误判为有效 → 后续用例在未登录状态下运行（实测踩到）。
     */
    const authenticated = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' })
        const payload = await response.json()
        return Boolean(payload?.user?.id)
      } catch {
        return false
      }
    })
    if (authenticated) return { context, page, reused: true }
    await context.close()
  }

  const context = await browser.newContext(options)
  const page = await context.newPage()
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="username"]', username)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(4500)
  const body = await page.locator('body').innerText()
  if (page.url().includes('/login') && /过于频繁|请稍后重试/.test(body)) {
    const error = new Error(`登录被后端限流（${username}）：${(body.match(/[^\n]*频繁[^\n]*/) || [''])[0]}`)
    error.throttled = true
    await context.close()
    throw error
  }
  if (page.url().includes('/login')) {
    const error = new Error(`登录失败：${(body.match(/[^\n]*失败[^\n]*/) || ['页面仍停留在登录页'])[0]}`)
    await context.close()
    throw error
  }
  await page.goto(`${base}/account`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  // 登录成功也要向服务端确认，避免把「页面能打开」当成「已登录」。
  const confirmed = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' })
      const payload = await response.json()
      return Boolean(payload?.user?.id)
    } catch {
      return false
    }
  })
  if (!confirmed) {
    const error = new Error(`登录后服务端仍未返回用户（${username}）`)
    await context.close()
    throw error
  }
  saveSession(name, await context.storageState())
  return { context, page, reused: false }
}

/** 限流时的统一退出方式：退出码 2 表示环境受限而非功能缺陷。 */
export function exitThrottled(message) {
  console.log(`\n[环境限流] ${message}`)
  console.log('这不是功能缺陷：后端登录限流为 15 分钟 8 次，请等待窗口结束后重新运行。')
  process.exit(2)
}
