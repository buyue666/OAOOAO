import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireFromWeb = createRequire(
  'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web/package.json',
)
const { chromium } = requireFromWeb('@playwright/test')

const BASE_URL = process.env.OAOAO_BASE_URL || 'http://127.0.0.1:3310'
const artifactDir = fileURLToPath(new URL('./artifacts/ordinary-user/', import.meta.url))

const checks = []
const failures = []

function check(condition, message) {
  checks.push(message)
  if (!condition) failures.push(message)
}

function recordFailure(message) {
  failures.push(message)
}

async function waitForSettled(page) {
  await page.waitForLoadState('domcontentloaded')
  // The canvas route loads a client runtime after hydration; allow that content to settle.
  await page.waitForTimeout(1000)
}

async function visibleText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
}

async function assertCustomerFacingAuthCopy(page, label) {
  const text = await visibleText(page)
  check(!/本地预览|开发预览|未配置后端|真实数据|真实创作账户|真实模型|服务端|前端不会|联系管理员获取验证码/.test(text), `${label}: 无开发预览说明或内部实现文案`)
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - window.innerWidth,
  )
  check(overflow <= 2, `${label}: 无横向溢出（${Math.max(0, Math.round(overflow))}px）`)
}

async function checkPublicRoute(page, path) {
  const errors = []
  const onPageError = (error) => errors.push(`pageerror: ${error.message}`)
  const onConsole = (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  }
  page.on('pageerror', onPageError)
  page.on('console', onConsole)

  try {
    const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await waitForSettled(page)
    const status = response?.status() ?? 0
    const text = await visibleText(page)
    check(status >= 200 && status < 400, `${path}: 页面响应 ${status}`)
    check(text.trim().length > 20, `${path}: 页面有可见内容`)
    await assertNoHorizontalOverflow(page, path)
    check(!/Application error|Unhandled Runtime Error|ChunkLoadError/i.test(text), `${path}: 无运行时错误页`)
    check(!/VOZEB|new-api|安装向导/i.test(text), `${path}: 无旧品牌或安装向导残留`)
    const unexpectedErrors = errors.filter((error) => !/status of 401/.test(error))
    if (unexpectedErrors.length) recordFailure(`${path}: ${unexpectedErrors.join(' | ')}`)
  } catch (error) {
    recordFailure(`${path}: ${error.message}`)
  } finally {
    page.off('pageerror', onPageError)
    page.off('console', onConsole)
  }
}

async function checkUnauthenticatedCreationRoutes(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  for (const path of ['/studio', '/image', '/video', '/agent', '/drama', '/canvas']) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await waitForSettled(page)
    check(page.url().includes('/login'), `${path}: 未登录访问会先进入登录页`)
    check(/登录/.test(await visibleText(page)), `${path}: 登录页内容可见`)
  }
  await page.close()
}

async function checkLoginFlows(browser) {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })

  await desktop.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await waitForSettled(desktop)
  await assertCustomerFacingAuthCopy(desktop, '登录页')
  check((await desktop.locator('input[autocomplete="username"]').count()) === 1, '登录页：用户名输入框存在')
  check((await desktop.locator('input[autocomplete="current-password"]').count()) === 1, '登录页：密码输入框存在')
  check((await desktop.getByRole('button', { name: '显示密码', exact: true }).count()) === 1, '登录页：密码显示按钮存在')
  check((await desktop.getByRole('button', { name: '登录', exact: true }).count()) === 1, '登录页：登录按钮存在')
  check((await desktop.getByRole('button', { name: '注册新账户', exact: true }).count()) === 1, '登录页：注册入口存在')
  check((await desktop.getByRole('button', { name: '微信扫码登录', exact: true }).count()) === 0, '登录页：未配置微信凭证时隐藏微信登录入口')

  await desktop.getByRole('button', { name: '登录', exact: true }).click()
  await desktop.waitForTimeout(300)
  const loginError = await visibleText(desktop)
  check(/请输入用户名和密码/.test(loginError), '登录页：空表单给出明确错误')
  await desktop.getByRole('button', { name: '显示密码', exact: true }).click()
  check((await desktop.locator('input[autocomplete="current-password"]').getAttribute('type')) === 'text', '登录页：密码可切换为明文显示')

  await desktop.getByRole('button', { name: '注册新账户', exact: true }).click()
  await desktop.waitForTimeout(150)
  check(/创建账户/.test(await visibleText(desktop)), '注册页：可从登录页切换')
  await assertCustomerFacingAuthCopy(desktop, '注册页')
  check((await desktop.locator('input[autocomplete="new-password"]').count()) === 1, '注册页：新密码输入框存在')
  check((await desktop.getByRole('button', { name: '显示密码', exact: true }).count()) === 1, '注册页：密码显示按钮存在')
  check((await desktop.getByRole('button', { name: '获取验证码', exact: true }).count()) === 1, '注册页：邮箱验证码入口存在')
  check(await desktop.getByRole('button', { name: '获取验证码', exact: true }).isDisabled(), '注册页：未填写邮箱时验证码按钮禁用')

  await desktop.locator('input[autocomplete="username"]').fill('ordinary-ui-check')
  await desktop.locator('input[autocomplete="new-password"]').fill('12345678')
  await desktop.getByRole('button', { name: '注册并登录', exact: true }).click()
  await desktop.waitForTimeout(250)
  const registerError = await visibleText(desktop)
  check(/同意服务条款|隐私政策/.test(registerError), '注册页：未勾选协议时阻止提交并提示原因')
  await desktop.locator('input[type="checkbox"]').check()
  await desktop.getByRole('button', { name: '注册并登录', exact: true }).click()
  await desktop.waitForTimeout(150)
  check(/邮箱地址|邮箱验证码/.test(await visibleText(desktop)), '注册页：同意协议后仍要求邮箱验证')
  await desktop.route('**/api/auth/email-code', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await desktop.locator('input[autocomplete="email"]').fill('auth-copy-check@example.com')
  await desktop.getByRole('button', { name: '获取验证码', exact: true }).click()
  await desktop.getByText('验证码请求已提交，请查看邮箱。', { exact: true }).waitFor({ state: 'visible' })
  await assertCustomerFacingAuthCopy(desktop, '注册验证码反馈')

  await desktop.getByRole('button', { name: '返回登录', exact: true }).click()
  await desktop.getByRole('button', { name: '忘记密码', exact: true }).click()
  await desktop.waitForTimeout(150)
  check(/重置密码/.test(await visibleText(desktop)), '找回密码页：可从登录页进入')
  await assertCustomerFacingAuthCopy(desktop, '找回密码页')
  await desktop.getByRole('button', { name: '重置密码', exact: true }).click()
  await desktop.waitForTimeout(250)
  const resetError = await visibleText(desktop)
  check(/填写邮箱|验证码|新密码/.test(resetError), '找回密码页：空表单给出完整提示')

  await desktop.getByRole('button', { name: '返回登录', exact: true }).click()
  await desktop.locator('input[autocomplete="username"]').fill(`not-found-${Date.now()}`)
  await desktop.locator('input[autocomplete="current-password"]').fill('Wrong!2026')
  await desktop.getByRole('button', { name: '登录', exact: true }).click()
  await desktop.waitForTimeout(800)
  const invalidLoginText = await visibleText(desktop)
  check(/登录失败|用户名或密码|错误|不存在|无效/i.test(invalidLoginText), '登录页：无效账号显示失败原因')
  check(desktop.url().includes('/login'), '登录页：无效账号不会错误跳转')

  await desktop.screenshot({ path: `${artifactDir}/login-desktop.png`, fullPage: true })

  await mobile.goto(`${BASE_URL}/login?mode=register`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await waitForSettled(mobile)
  await assertCustomerFacingAuthCopy(mobile, '注册页移动端')
  await assertNoHorizontalOverflow(mobile, '注册页移动端')
  const mobileRegisterButton = mobile.getByRole('button', { name: '注册并登录', exact: true })
  check(await mobileRegisterButton.isVisible(), '注册页移动端：主要操作可见')
  const mobileBox = await mobileRegisterButton.boundingBox()
  check(Boolean(mobileBox && mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390), '注册页移动端：主要操作未被裁切')
  await mobile.screenshot({ path: `${artifactDir}/register-mobile.png`, fullPage: true })

  await desktop.close()
  await mobile.close()
}

async function main() {
  await mkdir(artifactDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    for (const path of ['/', '/gallery', '/works', '/plans']) {
      await checkPublicRoute(page, path)
    }
    await page.close()
    await checkUnauthenticatedCreationRoutes(browser)
    await checkLoginFlows(browser)
  } finally {
    await browser.close()
  }

  console.log(`ordinary-user-flow: ${checks.length - failures.length}/${checks.length} checks passed`)
  for (const failure of failures) console.log(`FAIL: ${failure}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
