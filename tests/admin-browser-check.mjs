import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 真实浏览器验收：登录 OAOOAO 后台，逐个访问页面，检查渲染、控制台错误与横向溢出。
 * 只做只读浏览，不执行任何写入操作。
 */
import { createRequire } from 'node:module'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const USERNAME = 'fusion_admin'
const PASSWORD = TEST_PASSWORD
const SECTIONS = ['/admin', '/admin/users', '/admin/generation', '/admin/channels', '/admin/products', '/admin/orders', '/admin/content', '/admin/settings', '/admin/audit']

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await context.newPage()

const consoleErrors = []
const failedRequests = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)) })
page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.slice(0, 220)))

// 登录
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const login = await page.evaluate(async ({ username, password }) => {
  const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  return { status: response.status }
}, { username: USERNAME, password: PASSWORD })
console.log('LOGIN', login.status)

const report = []
for (const section of SECTIONS) {
  consoleErrors.length = 0
  failedRequests.length = 0
  await page.goto(BASE + section, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const info = await page.evaluate(() => {
    const text = document.body.innerText || ''
    return {
      hasBrand: text.includes('OAOOAO'),
      hasVozeb: /VOZEB|Vozeb/i.test(text),
      hasPermissionWall: text.includes('需要管理员权限') || text.includes('需要登录'),
      hasModuleDenied: text.includes('没有访问该模块的职责权限'),
      hasErrorState: text.includes('加载失败') || text.includes('暂不可用') || text.includes('请求失败'),
      loadingStuck: text.includes('正在加载') || text.includes('正在验证管理员身份'),
      bodyText: text.slice(0, 400),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headings: Array.from(document.querySelectorAll('h1, h2')).map((node) => node.textContent?.trim()).filter(Boolean).slice(0, 6),
    }
  })

  report.push({ section, ...info, consoleErrors: [...consoleErrors], failedRequests: [...failedRequests] })
}

console.log('\n=== 桌面 1440px ===')
for (const item of report) {
  const ok = item.hasBrand && !item.hasVozeb && !item.hasPermissionWall && !item.hasModuleDenied && !item.loadingStuck && item.overflowX <= 1
  console.log(`\n${ok ? 'PASS' : 'CHECK'} ${item.section}`)
  console.log(`  品牌=${item.hasBrand} VOZEB=${item.hasVozeb} 权限墙=${item.hasPermissionWall} 模块拒绝=${item.hasModuleDenied} 加载中=${item.loadingStuck} 错误态=${item.hasErrorState} 横向溢出=${item.overflowX}px`)
  console.log(`  标题: ${item.headings.join(' | ')}`)
  if (item.consoleErrors.length) console.log(`  控制台错误: ${item.consoleErrors.slice(0, 3).join(' ;; ')}`)
  if (item.failedRequests.length) console.log(`  请求失败: ${item.failedRequests.slice(0, 3).join(' ;; ')}`)
}

// 移动端 390px 抽查
const mobile = await context.newPage()
await mobile.setViewportSize({ width: 390, height: 844 })
await mobile.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' })
await mobile.waitForTimeout(2500)
const mobileInfo = await mobile.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  hasBrand: (document.body.innerText || '').includes('OAOOAO'),
  hasNav: Boolean(document.querySelector('a[href="/admin/generation"]')),
}))
console.log(`\n=== 移动端 390px /admin/users ===\n  品牌=${mobileInfo.hasBrand} 横向导航=${mobileInfo.hasNav} 横向溢出=${mobileInfo.overflowX}px`)

await page.screenshot({ path: 'tests/artifacts/admin-overview-1440.png', fullPage: false })
await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
await page.screenshot({ path: 'tests/artifacts/admin-users-1440.png', fullPage: false })
await mobile.screenshot({ path: 'tests/artifacts/admin-users-390.png', fullPage: false })

await browser.close()

const hardFailures = report.filter((item) => !item.hasBrand || item.hasVozeb || item.hasPermissionWall || item.hasModuleDenied || item.loadingStuck || item.overflowX > 1)
console.log(`\nHARD FAILURES: ${hardFailures.length}`)
process.exit(hardFailures.length ? 1 : 0)
