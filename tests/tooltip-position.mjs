import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const runtime = process.env.PLAYWRIGHT_ROOT
  ? `${process.env.PLAYWRIGHT_ROOT}/package.json`
  : fileURLToPath(new URL('../../backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web/package.json', import.meta.url))
const { chromium } = createRequire(runtime)('@playwright/test')
const base = process.env.OAOAO_BASE_URL || 'http://127.0.0.1:3310'
const testUsername = process.env.OAOAO_TEST_USERNAME?.trim()
const testPassword = process.env.OAOAO_TEST_PASSWORD
const artifacts = fileURLToPath(new URL('./artifacts/tooltip-position/', import.meta.url))
await mkdir(artifacts, { recursive: true })

const browser = await chromium.launch()
let checks = 0

function check(label, value) {
  assert.ok(value, label)
  checks++
  console.log(`PASS ${label}`)
}

async function waitForTooltip(page, trigger) {
  await trigger.hover()
  const tooltip = page.locator('[data-tooltip-content="true"]')
  await tooltip.waitFor({ state: 'visible' })
  return tooltip
}

async function login(page) {
  await page.goto(`${base}/login?next=%2Fstudio`, { waitUntil: 'networkidle' })
  await page.locator('input[autocomplete="username"]').waitFor({ state: 'visible' })
  await page.locator('input[autocomplete="username"]').fill(testUsername)
  await page.locator('input[autocomplete="current-password"]').fill(testPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/studio**')
  await page.waitForTimeout(500)
}

async function checkViewportBounds(page, tooltip, label) {
  const box = await tooltip.boundingBox()
  const viewport = page.viewportSize()
  check(`${label}: tooltip is fully inside the viewport`, Boolean(box && viewport && box.x >= 8 && box.y >= 8 && box.x + box.width <= viewport.width - 8 && box.y + box.height <= viewport.height - 8))
  check(`${label}: tooltip has readable text`, Boolean((await tooltip.innerText()).trim()))
  return box
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${base}/studio`, { waitUntil: 'networkidle' })

  if (!testUsername || !testPassword) {
    await page.locator('input[autocomplete="username"]').waitFor({ state: 'visible' })
    check('未登录访问工作台会先进入登录页', page.url().includes('/login'))
    console.log(`PASS tooltip regression: ${checks} checks (set OAOAO_TEST_USERNAME/OAOAO_TEST_PASSWORD to run authenticated tooltip checks)`)
    await context.close()
  } else {
    await login(page)

    const language = page.getByRole('button', { name: '切换到英文', exact: true })
  await language.waitFor({ state: 'visible' })
  const languageTooltip = await waitForTooltip(page, language)
  const languageBox = await checkViewportBounds(page, languageTooltip, '顶部语言按钮')
  check('顶部语言按钮在视口顶部时提示自动翻转到下方', await languageTooltip.getAttribute('data-side') === 'bottom')
  check('顶部语言按钮提示没有覆盖按钮', Boolean(languageBox && languageBox.y >= (await language.boundingBox()).y + (await language.boundingBox()).height))
  await page.screenshot({ path: `${artifacts}/topbar-tooltip.png`, animations: 'disabled' })

  const lightTooltipStyle = await languageTooltip.evaluate(element => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, color: style.color, border: style.borderTopColor }
  })

  await page.mouse.move(4, 450)
  await languageTooltip.waitFor({ state: 'hidden' })
  await language.focus()
  const focusedTooltip = page.locator('[data-tooltip-content="true"]')
  await focusedTooltip.waitFor({ state: 'visible' })
  await checkViewportBounds(page, focusedTooltip, '键盘聚焦语言按钮')
  check('键盘聚焦时提示关联到触发按钮', Boolean(await language.getAttribute('aria-describedby')))
  await page.keyboard.press('Escape')
  await focusedTooltip.waitFor({ state: 'hidden' })
  check('按 Escape 可以关闭提示', true)

  const theme = page.getByRole('button', { name: '切换到深色主题', exact: true })
  await theme.click()
  const darkTooltip = await waitForTooltip(page, language)
  const darkTooltipStyle = await darkTooltip.evaluate(element => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, color: style.color, border: style.borderTopColor }
  })
  check('浅色与深色 Tooltip 使用不同背景', lightTooltipStyle.background !== darkTooltipStyle.background)
  check('浅色与深色 Tooltip 使用不同文字对比', lightTooltipStyle.color !== darkTooltipStyle.color)
  await page.screenshot({ path: `${artifacts}/topbar-tooltip-dark.png`, animations: 'disabled' })
  await page.mouse.move(4, 450)
  await darkTooltip.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click()

  const collapse = page.getByRole('button', { name: '收起侧边栏', exact: true })
  await collapse.click()
  const canvasLink = page.getByRole('link', { name: '自由画布', exact: true })
  const canvasTooltip = await waitForTooltip(page, canvasLink)
  await checkViewportBounds(page, canvasTooltip, '收起侧栏导航按钮')
  check('收起侧栏提示保持在右侧', await canvasTooltip.getAttribute('data-side') === 'right')

  await context.close()

  const narrowContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const narrowPage = await narrowContext.newPage()
  await login(narrowPage)
  const narrowLanguage = narrowPage.getByRole('button', { name: '切换到英文', exact: true })
  await narrowLanguage.waitFor({ state: 'visible' })
  const narrowTooltip = await waitForTooltip(narrowPage, narrowLanguage)
  await checkViewportBounds(narrowPage, narrowTooltip, '窄屏顶部语言按钮')
  await narrowPage.screenshot({ path: `${artifacts}/narrow-topbar-tooltip.png`, animations: 'disabled' })
  await narrowContext.close()

    console.log(`PASS tooltip regression: ${checks} checks`)
  }
} finally {
  await browser.close()
}
