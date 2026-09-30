import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const runtime = resolve(process.cwd(), '..', 'backups', 'vozeb-pro-v007-points-loop-20260910', 'VOZEB-PRO-ciyuan-v007-20260824', 'web', 'package.json')
const { chromium } = createRequire(runtime)('@playwright/test')
const base = process.env.OAOAO_BASE || 'http://127.0.0.1:3310'
const session = resolve(process.cwd(), 'tests', '.sessions', 'fusion_admin-3310.json')
const checks = []
const errors = []

function check(label, value) {
  assert.ok(value, label)
  checks.push(label)
}

async function run(viewport, route) {
  const context = await browser.newContext({
    ...(existsSync(session) ? { storageState: session } : {}),
    viewport,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`${route}@${viewport.width}: ${error.message}`))
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 20_000 })
  await page.waitForTimeout(900)

  const health = await page.evaluate(() => {
    const main = document.querySelector('main')
    const visibleText = (main?.innerText || '').trim()
    const scrollers = [...document.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"]')]
      .filter((element) => element.scrollHeight > element.clientHeight + 2)
      .map((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollTop: element.scrollTop,
        rect: element.getBoundingClientRect().toJSON(),
      }))
    const shell = document.querySelector('.studio-app-shell')
    const before = shell ? getComputedStyle(shell, '::before') : null
    return {
      visibleText,
      scrollers,
      background: shell ? getComputedStyle(shell).backgroundColor : '',
      environmentAnimation: before?.animationName || '',
      environmentFilter: before?.filter || '',
      primaryButtons: [...document.querySelectorAll('.studio-control-primary')].map((button) => ({
        disabled: button.disabled,
        text: button.textContent?.trim(),
        background: getComputedStyle(button).backgroundColor,
        color: getComputedStyle(button).color,
      })),
      lazyThumbs: [...document.querySelectorAll('[data-testid="reference-picker-item"] img')].filter((image) => image.loading === 'lazy').length,
      referenceItems: document.querySelectorAll('[data-testid="reference-picker-item"]').length,
    }
  })

  check(`${route} ${viewport.width}: 主内容可见`, health.visibleText.length > 80)
  check(`${route} ${viewport.width}: 没有横向文档溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2))

  if (route === '/image' || route === '/video') {
    check(`${route} ${viewport.width}: 工作台环境层不在滚动时动画`, health.environmentAnimation === 'none' || health.environmentAnimation === 'initial' || health.environmentAnimation === '')
    check(`${route} ${viewport.width}: 工作台有实色背景兜底`, health.background !== 'rgba(0, 0, 0, 0)')
    if (health.referenceItems > 0) check(`${route} ${viewport.width}: 素材缩略图使用懒加载`, health.lazyThumbs > 0)
    for (const [index, scroller] of health.scrollers.entries()) {
      for (const position of [0, Math.floor((scroller.scrollHeight - scroller.clientHeight) / 2), scroller.scrollHeight - scroller.clientHeight]) {
        await page.evaluate(({ index, position }) => {
          const elements = [...document.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"]')]
            .filter((element) => element.scrollHeight > element.clientHeight + 2)
          elements[index].scrollTop = Math.max(0, position)
        }, { index, position })
        await page.waitForTimeout(120)
        const state = await page.evaluate(() => ({
          mainVisible: Boolean(document.querySelector('main')?.getBoundingClientRect().height),
          textLength: (document.querySelector('main')?.innerText || '').trim().length,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
        }))
        check(`${route} ${viewport.width}: 滚动容器 ${index} 位置 ${position} 仍有内容`, state.mainVisible && state.textLength > 80 && state.bodyBackground !== 'rgb(255, 255, 255)')
      }
    }
  }

  await context.close()
}

const browser = await chromium.launch()
try {
  await run({ width: 1280, height: 720 }, '/image')
  await run({ width: 900, height: 720 }, '/image')
  await run({ width: 1280, height: 720 }, '/video')
  check('工作台滚动检查没有页面异常', errors.length === 0)
  console.log(`WORKSPACE_UI_OK ${checks.length}`)
} finally {
  await browser.close()
}
