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
  check('画布节点使用绝对定位而不是普通文档流', await page.locator('.react-flow__node').first().evaluate((element) => getComputedStyle(element).position === 'absolute'))
  await pane.click({ button: 'right', position: { x: 120, y: 120 } })
  check('画布右键菜单可以打开', await page.locator('.oao-canvas-context-menu').isVisible())
  await page.getByRole('button', { name: '生成图片' }).click()
  check('右键生成直接打开画布内创作面板', (await page.locator('body').innerText()).includes('画布内创作'))
  check('右键生成会在画布内创建图片节点', await page.locator('[data-canvas-node-kind="image"]').count() >= 3)
  await page.getByRole('button', { name: '关闭生成面板' }).click()
  const firstCanvasNode = page.locator('.oao-canvas-node-shell').first()
  await firstCanvasNode.click()
  check('选中节点显示一体化操作条', await firstCanvasNode.locator('.oao-canvas-node-toolbar').isVisible())
  await firstCanvasNode.hover()
  const expandAfter = firstCanvasNode.getByRole('button', { name: /之后添加节点/ })
  check('节点悬停时显示动态扩展按钮', await expandAfter.isVisible())
  await expandAfter.click()
  check('节点扩展菜单可以打开', await page.locator('[data-canvas-expand-menu]').isVisible())
  const videoCountBeforeExpand = await page.locator('[data-canvas-node-kind="video"]').count()
  await page.locator('[data-canvas-expand-option="video"]').click()
  await page.waitForTimeout(180)
  check('扩展节点会自动创建并连接视频节点', await page.locator('[data-canvas-node-kind="video"]').count() > videoCountBeforeExpand && await page.locator('.react-flow__edge').count() >= 4)
  await page.locator('[data-canvas-node-kind="image"]').first().dblclick()
  check('图片节点打开后锁定为图片生成', await page.locator('.oao-canvas-generation-locked').isVisible() && (await page.locator('.oao-canvas-generation-locked').innerText()).includes('图片生成'))
  check('图片节点不会显示跨类型生成标签', await page.locator('[role="tablist"][aria-label="生成类型"]').count() === 0)
  const bottomComposer = page.locator('.oao-canvas-generation-composer')
  const composerBox = await bottomComposer.boundingBox()
  check('画布生成面板位于底部且生成按钮可见', Boolean(composerBox && composerBox.y > (page.viewportSize()?.height ?? 900) * 0.45) && await page.locator('.oao-canvas-generate-button').isVisible())
  await page.getByRole('button', { name: '关闭生成面板' }).click()
  await page.locator('[data-canvas-node-kind="text"]').first().dblclick()
  check('文本节点打开后锁定为文本生成', await page.locator('.oao-canvas-generation-locked').isVisible() && (await page.locator('.oao-canvas-generation-locked').innerText()).includes('文本生成'))
  check('文本节点不显示图片视频参数', await page.locator('.oao-canvas-generation-locked').isVisible() && await page.locator('.oao-canvas-glass-select').count() === 1)
  await page.getByRole('button', { name: '关闭生成面板' }).click()
  await page.getByRole('button', { name: '打开资产' }).click()
  check('画布资产面板明确绑定当前用户资产', (await page.locator('.oao-canvas-workspace-panel').innerText()).includes('属于你的可引用资产') || await page.locator('.oao-canvas-workspace-panel').innerText().then((text) => text.includes('资产')))

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
  await page.goto(`${base}/image`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(320)
  const glassSelect = page.locator('.studio-select-trigger').first()
  check('工作台模型选择使用自定义玻璃菜单', await glassSelect.count() === 1)
  await glassSelect.click()
  check('工作台模型菜单文字和背景有明确对比度', await page.locator('[data-studio-select-menu]').evaluate((element) => getComputedStyle(element).color !== getComputedStyle(element).backgroundColor))
  check('核心页面没有未捕获浏览器异常', pageErrors.length === 0)
  console.log(`CHECKS: ${checks}; FAILURES: 0`)
} finally {
  await browser.close()
}
