import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Reuse the browser runtime used by the existing local browser checks.
const runtime = process.env.PLAYWRIGHT_ROOT
  ? `${process.env.PLAYWRIGHT_ROOT}/package.json`
  : fileURLToPath(new URL('../../backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web/package.json', import.meta.url))
const { chromium } = createRequire(runtime)('@playwright/test')
const sharp = createRequire(runtime)('sharp')
const base = process.env.LANDING_BASE || 'http://127.0.0.1:3310'
const artifacts = new URL('./artifacts/landing-zh/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch()
const errors = []
let checks = 0
function check(label, value) {
  assert.ok(value, label)
  checks++
  console.log(`PASS ${label}`)
}
async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(180)
}
async function snapshot(page, name) {
  await settled(page)
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', artifacts)), animations: 'disabled' })
}

async function checkCanvasOcclusion(page, label) {
  const foreground = page.locator('[data-hero-foreground]')
  await foreground.evaluate(image => image.decode())
  const clip = await foreground.evaluate(image => {
    const rect = image.getBoundingClientRect()
    const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    return { x: rect.left + (rect.width - width) / 2 + 610 * scale, y: rect.top + (rect.height - height) / 2 + 390 * scale, width: 12, height: 12 }
  })
  const pixels = async () => sharp(await page.screenshot({ clip, animations: 'disabled' })).raw().toBuffer()
  const original = await pixels()
  const wordmark = page.locator('#hero h1').locator('..')
  const previous = await wordmark.getAttribute('style')
  try {
    // A loud color behind the scene exposes holes in the blue paint on the canvas.
    await wordmark.evaluate(element => {
      element.style.background = '#ff00ff'
      element.style.inset = '0'
      element.style.opacity = '1'
    })
    const covered = await pixels()
    // User-supplied foreground has a soft alpha (roughly 252/255) even on solid subjects.
    check(`Canvas blocks text without large transparency holes (${label})`, original.every((value, index) => Math.abs(value - covered[index]) <= 6))
    await foreground.evaluate(element => { element.style.visibility = 'hidden' })
    check(`Canvas occlusion regression detects a missing foreground (${label})`, !original.equals(await pixels()))
  } finally {
    await foreground.evaluate(element => { element.style.removeProperty('visibility') })
    await wordmark.evaluate((element, style) => {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }, previous)
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('[data-landing-version="oao-zh-v8-landscape-layered"]').waitFor()
  check('Chinese page metadata', (await page.title()) === 'OAO · 图片、视频与故事创作')
  check('Brand heading is visible', await page.getByRole('heading', { level: 1 }).isVisible())
  await page.waitForFunction(() => {
    const header = document.querySelector('header')
    const style = getComputedStyle(header)
    return header.dataset.ready === 'true' && Number(style.opacity) > 0.99 && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
  })
  check('Navigation and its backdrop appear without scrolling', await page.evaluate(() => scrollY === 0))
  check('User brand image appears in header and footer', await page.locator('header img[alt="OAO"], footer img[alt="OAO"]').evaluateAll(images => images.length === 2 && images.every(image => image.getAttribute('src').includes('oao-logo.png'))))
  const words = await page.locator('main').innerText()
  check('No English copy other than OAO', (words.match(/[A-Za-z]{2,}/g) || []).every(word => word === 'OAO'))
  check('Nine original sections, including footer', await page.locator('main > section, main > footer').count() === 9)
  check('Landing is independent of studio shell', await page.locator('[data-studio-route]').count() === 0)
  check('All section anchors resolve', await page.locator('main a[href^="#"]').evaluateAll(links => links.every(link => document.getElementById(link.hash.slice(1)))))
  const heroCenter = page.locator('img[alt="旷野中进行绘画与影像记录的 OAO 创作现场"]').locator('..')
  check('Hero starts full width', await heroCenter.evaluate(el => el.style.width) === '100%')
  check('No remote template video is embedded', await page.locator('video').count() === 0)
  check('User foreground replaces the old cutout and canvas patch', await page.locator('[data-hero-foreground]').evaluate(image => image.getAttribute('src').includes('ai-creative-hero-user-v1.png')) && await page.locator('[data-hero-canvas]').count() === 0)
  await heroCenter.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  await checkCanvasOcclusion(page, 'desktop')
  await snapshot(page, 'desktop-hero')
  await page.evaluate(() => scrollTo(0, innerHeight * 2))
  await page.waitForFunction(() => document.querySelector('img[alt="旷野中进行绘画与影像记录的 OAO 创作现场"]').parentElement.style.width === '20%')
  check('Five-column hero closes to 20% center', await heroCenter.evaluate(el => el.style.width) === '20%')
  check('Navigation still responds to scrolling', await page.locator('header').getAttribute('data-scrolled') === 'true')
  await snapshot(page, 'desktop-hero-expanded')

  await page.locator('section[aria-label="创作理念"] p').evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.2))
  await settled(page)
  check('Chinese description reveals in viewport', await page.locator('section[aria-label="创作理念"] p span').evaluateAll(spans => spans.every(el => Number(getComputedStyle(el).opacity) > 0.99)))
  await page.locator('section[aria-label="创意草图"]').scrollIntoViewIfNeeded()
  await snapshot(page, 'desktop-sketches')
  await page.locator('p[data-dark="true"]').evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.2))
  await settled(page)
  check('Dark section text is white and fully visible', await page.locator('p[data-dark="true"]').evaluate(el => getComputedStyle(el).color === 'rgb(255, 255, 255)' && [...el.children].every(span => Number(getComputedStyle(span).opacity) > 0.99)))
  await snapshot(page, 'desktop-dark-description')
  await page.locator('#gallery').evaluate(el => scrollTo(0, el.offsetTop + el.offsetHeight - innerHeight))
  await settled(page)
  check('Last gallery image expands fullscreen', await page.locator('#gallery img').last().evaluate(el => el.getBoundingClientRect().width >= innerWidth))
  await snapshot(page, 'desktop-gallery-expanded')
  await page.locator('#models').scrollIntoViewIfNeeded()
  await snapshot(page, 'desktop-modes')

  await page.locator('section[aria-label="创作影像"]').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => { const video = document.querySelector('video'); return !video || video.readyState >= 2 }, null, { timeout: 15000 })
  if (await page.locator('video').count()) {
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0.1)
    check('Reference video plays', await page.locator('video').evaluate(el => !el.paused))
    await page.getByRole('button', { name: '暂停视频' }).click()
    check('Video pause control works', await page.locator('video').evaluate(el => el.paused))
  } else {
    check('Video network failure retains local poster', await page.locator('section[aria-label="创作影像"] img').evaluate(el => el.complete && el.naturalWidth > 0))
  }
  await snapshot(page, 'desktop-video')

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => scrollTo(0, 0))
    await settled(page)
    check(`No overflow at ${viewport.width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    check(`Hero retains photograph to the bottom at ${viewport.width}px`, await page.locator('#hero img[aria-hidden="true"]').first().evaluate(image => image.getBoundingClientRect().bottom >= image.parentElement.getBoundingClientRect().bottom))
    check(`Large brand text fits at ${viewport.width}px`, await page.locator('#hero h1').evaluate(heading => heading.getBoundingClientRect().left >= 0 && heading.getBoundingClientRect().right <= innerWidth))
    await snapshot(page, `hero-${viewport.width}`)
    if (viewport.width === 390) {
      await checkCanvasOcclusion(page, 'mobile')
      await page.getByRole('button', { name: '打开菜单' }).click()
      check('Mobile navigation opens', await page.getByRole('navigation', { name: '移动端首页导航' }).isVisible())
      await snapshot(page, 'mobile-menu')
      await page.keyboard.press('Escape')
      check('Escape closes navigation and restores focus', await page.getByRole('button', { name: '打开菜单' }).evaluate(el => document.activeElement === el))
      await page.getByRole('button', { name: '打开菜单' }).click()
      await page.getByRole('navigation', { name: '移动端首页导航' }).getByRole('link', { name: '模型' }).click()
      check('Mobile menu anchors and closes', (await page.locator('#landing-mobile-menu').count()) === 0 && page.url().endsWith('#models'))
      await snapshot(page, 'mobile-modes')
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 })
  // Decode all images to catch missing files, including lazy-loaded frames.
  const badImages = await page.locator('main img').evaluateAll(async images => {
    const failed = []
    for (const image of images) {
      try { await image.decode() } catch { failed.push(image.getAttribute('src')) }
    }
    return failed
  })
  check('All referenced image assets decode', badImages.length === 0)
  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await reduced.goto(base, { waitUntil: 'networkidle' })
  await settled(reduced)
  check('Reduced-motion removes long pinned hero', await reduced.locator('#hero').evaluate(el => el.offsetHeight <= innerHeight + 1))
  check('Reduced-motion navigation is immediately visible', await reduced.locator('header').evaluate(header => Number(getComputedStyle(header).opacity) === 1))
  await reduced.locator('section[aria-label="创作影像"]').scrollIntoViewIfNeeded()
  await settled(reduced)
  check('Reduced-motion keeps local editorial media', await reduced.locator('section[aria-label="创作影像"] img').evaluate(el => el.complete && el.naturalWidth > 0))
  check('Reduced-motion keeps gallery content in flow', await reduced.locator('#gallery img').evaluateAll(images => images.every(image => image.getBoundingClientRect().height > 0)))
  await snapshot(reduced, 'mobile-reduced-motion')
  await reduced.close()

  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('navigation', { name: '首页导航', exact: true }).waitFor()
  await page.locator('header').getByRole('link', { name: '进入创作' }).click()
  await page.waitForURL('**/studio')
  check('Enter studio CTA preserves original workbench', await page.locator('[data-studio-route="home"]').count() === 1)
  for (const path of ['/image', '/video', '/projects', '/plans', '/admin']) {
    const response = await page.goto(base + path, { waitUntil: 'domcontentloaded' })
    check(`Existing route ${path} returns 200`, response.status() === 200)
    check(`Landing CSS stays scoped on ${path}`, await page.locator('[data-landing-version]').count() === 0)
  }
  check('No uncaught browser errors', errors.length === 0)
  console.log(`CHECKS: ${checks}; FAILURES: 0`)
} finally {
  await browser.close()
}
