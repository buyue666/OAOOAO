import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const runtime = process.env.PLAYWRIGHT_ROOT || resolve('../backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web')
const require = createRequire(resolve(runtime, 'package.json'))
const { chromium } = require('@playwright/test')
const sharp = require('sharp')
const base = process.env.OAOAO_BASE || 'http://127.0.0.1:3310'
const artifacts = resolve('tests/artifacts/workspace-glass')
mkdirSync(artifacts, { recursive: true })
let checks = 0
const errors = []
const check = (label, ok) => { assert.ok(ok, label); checks++ }
const browser = await chromium.launch()
try {
  for (const [route, width, height, scale] of [['image',1280,720,1],['image',1440,900,1.25],['video',1280,720,1],['image',700,720,1]]) {
    const context = await browser.newContext({ storageState: resolve('tests/.sessions/fusion_admin-3310.json'), viewport: { width, height }, deviceScaleFactor: scale })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const label = `${route}-${width}-${scale}`
    const styles = await page.evaluate(() => {
      const panel = document.querySelector('.studio-workspace-shell aside > div')
      const surface = getComputedStyle(panel)
      const ancestor = getComputedStyle(document.querySelector('main > div'))
      const wallpaper = getComputedStyle(document.querySelector('.studio-app-shell'), '::before')
      return {
        backdrop: surface.backdropFilter,
        overlays: ['::before', '::after'].map(pseudo => getComputedStyle(panel, pseudo).content),
        transform: ancestor.transform,
        animation: ancestor.animationName,
        wallpaperFilter: wallpaper.filter,
        wallpaperAnimation: wallpaper.animationName,
      }
    })
    check(`${label}: 参数面板没有背景采样滤镜`, styles.backdrop === 'none')
    check(`${label}: 参数面板没有覆盖内容的伪元素`, styles.overlays.every(content => content === 'none' || content === 'normal'))
    check(`${label}: 内容祖先没有残留变换层`, styles.transform === 'none' && styles.animation === 'none')
    check(`${label}: 壁纸没有滤镜和动画`, styles.wallpaperFilter === 'none' && styles.wallpaperAnimation === 'none')
    if (width >= 1280) {
      const panel = page.locator('.studio-workspace-shell aside > div')
      const box = await panel.boundingBox()
      const clip = { x: box.x + 4, y: box.y + 60, width: 8, height: Math.floor(box.height - 100) }
      let previous
      let maxDelta = 0
      for (let frame = 0; frame < 12; frame++) {
        if (frame >= 6) {
          await page.mouse.move(box.x + 130, box.y + 170)
          await page.mouse.wheel(0, frame % 2 ? 220 : -150)
        }
        await page.waitForTimeout(200)
        const pixels = await sharp(await page.screenshot({ clip, scale: 'css' })).removeAlpha().raw().toBuffer()
        if (previous) {
          const delta = pixels.reduce((sum, value, index) => sum + Math.abs(value - previous[index]), 0) / pixels.length
          maxDelta = Math.max(maxDelta, delta)
        }
        previous = pixels
      }
      check(`${label}: 连续滚动帧面板边缘亮度稳定 (${maxDelta.toFixed(3)})`, maxDelta < 1)
      await page.screenshot({ path: resolve(artifacts, `${label}.png`) })
    } else {
      const toggle = page.getByRole('button', { name: /图片参数/ })
      await toggle.dispatchEvent('click')
      check(`${label}: 小屏参数仍可展开`, await toggle.getAttribute('aria-expanded') === 'true')
      await page.locator('#workspace-mobile-params').screenshot({ path: resolve(artifacts, `${label}.png`) })
    }
    await context.close()
  }
  check('连续帧测试没有浏览器异常', errors.length === 0)
  console.log(`WORKSPACE_GLASS_OK ${checks}`)
} finally { await browser.close() }
