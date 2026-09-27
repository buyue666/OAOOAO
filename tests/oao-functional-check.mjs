import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const runtime = process.env.PLAYWRIGHT_ROOT
  ? resolve(process.env.PLAYWRIGHT_ROOT, 'package.json')
  : resolve(process.cwd(), '..', 'backups', 'vozeb-pro-v007-points-loop-20260910', 'VOZEB-PRO-ciyuan-v007-20260824', 'web', 'package.json')
const { chromium } = createRequire(runtime)('@playwright/test')
const base = process.env.OAOAO_BASE || 'http://127.0.0.1:3310'
const storageState = process.env.OAOAO_STORAGE || resolve(process.cwd(), 'tests', '.sessions', 'fusion_admin-3310.json')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  ...(existsSync(storageState) ? { storageState } : {}),
  viewport: { width: 1440, height: 1000 },
})
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
let checks = 0

function check(label, value) {
  assert.ok(value, label)
  checks += 1
  console.log(`PASS ${label}`)
}

async function visit(pathname) {
  // Several list views keep image/task requests alive while rendering; DOM-ready
  // plus a short settle window tests the usable page without treating those
  // background requests as a navigation failure.
  await page.goto(`${base}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(320)
  check(`${pathname} responds`, page.url().startsWith(base))
  check(`${pathname} has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
}

try {
  await visit('/drama')
  check('短剧入口使用独立路由', await page.locator('a[href="/drama"]').count() >= 1)
  check('短剧页主标题不是项目列表', (await page.locator('h1').allTextContents()).includes('短剧制作'))
  check('侧栏不再暴露项目菜单', !(await page.locator('nav[aria-label="主导航"]').innerText()).includes('项目'))
  check('短剧页没有旧的 view=drama 链接', await page.locator('a[href*="view=drama"]').count() === 0)
  const createButton = page.getByRole('button', { name: '新建短剧' })
  check('短剧创建按钮可见', await createButton.first().isVisible())
  await createButton.first().click()
  check('短剧创建面板可以打开', await page.getByTestId('drama-create-panel').isVisible())
  await page.getByRole('button', { name: '取消' }).click()
  check('短剧创建面板可以关闭', await page.getByTestId('drama-create-panel').count() === 0)

  await visit('/projects?view=drama')
  check('旧短剧地址重定向到独立短剧页', page.url().endsWith('/drama'))

  await visit('/canvas/canvas-aurora')
  check('画布有本地生成入口', await page.getByRole('button', { name: '在画布内生成' }).count() >= 1)
  check('画布不包含跳转到其他生成工作台的链接', await page.locator('a').evaluateAll((links) => links.every((link) => !/\/(image|video|tasks|projects)(\/|$)/.test(link.getAttribute('href') || ''))))
  check('画布不再显示完整工作台跳转文案', !(await page.locator('body').innerText()).includes('打开完整工作台'))
  const pane = page.locator('.react-flow__pane')
  check('画布 React Flow 面板存在', await pane.count() === 1)
  await pane.click({ button: 'right', position: { x: 120, y: 120 } })
  check('画布右键菜单可以打开', await page.locator('.oao-canvas-context-menu').isVisible())
  await page.getByRole('button', { name: '生成图片' }).click()
  check('右键生成直接打开画布内创作面板', (await page.locator('body').innerText()).includes('画布内创作'))

  await visit('/plans')
  await page.getByRole('button', { name: '立即开通' }).first().click()
  const dialog = page.getByRole('dialog')
  check('套餐确认弹窗可以打开', await dialog.isVisible())
  const cancel = dialog.getByRole('button', { name: '取消' })
  const confirm = dialog.getByRole('button', { name: '确认并继续' })
  check('套餐确认弹窗的取消按钮可读', await cancel.isVisible() && (await cancel.evaluate((element) => getComputedStyle(element).color !== getComputedStyle(element).backgroundColor)))
  check('套餐确认弹窗的确认按钮可读', await confirm.isVisible() && (await confirm.evaluate((element) => getComputedStyle(element).color !== getComputedStyle(element).backgroundColor)))
  await cancel.click()
  await page.waitForTimeout(220)
  check('套餐确认弹窗可以关闭', await page.getByRole('dialog').count() === 0)

  for (const pathname of ['/studio', '/image', '/video', '/agent', '/tasks', '/assets', '/works', '/gallery', '/settings', '/admin']) {
    await visit(pathname)
  }
  check('核心页面没有未捕获浏览器异常', pageErrors.length === 0)
  console.log(`CHECKS: ${checks}; FAILURES: 0`)
} finally {
  await browser.close()
}
