import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
function load(file, imports = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', code)(name => name in imports ? imports[name] : require(name), module, module.exports)
  return module.exports
}
const catalog = load('lib/studio/creative-plugins.ts', { './creative-plugin-releases.json': JSON.parse(read('lib/studio/creative-plugin-releases.json')) })
const showcase = load('lib/studio/creative-tool-showcase.ts', { './creative-plugins': catalog, './creative-tool-defaults.json': {} })
const tx = (text, values = []) => text.replace(/\{(\d+)\}/g, (_, index) => String(values[index]))
const locale = { useUiText: () => tx }
const utils = { cn: (...parts) => parts.filter(Boolean).join(' ') }

function homeHarness() {
  let settings = {}
  const captures = []
  const { HomeShowcase } = load('components/studio/home-showcase.tsx', {
    '@/lib/studio/i18n': locale, '@/lib/utils': utils,
    '@/lib/studio/creative-plugins': catalog, '@/lib/studio/creative-tool-showcase': showcase,
    '@/lib/studio/use-creative-tools': { useCreativeTools: () => ({ settings }) },
    'next/image': ({ fill, sizes, ...props }) => React.createElement('img', props),
    'next/link': ({ prefetch, ...props }) => React.createElement('a', props),
    './plugins/creative-tool-media': { CreativeToolMedia: props => { captures.push(props); return React.createElement('button', { type: 'button', 'data-preview': true }, 'Preview control') } },
  })
  return {
    render(next = settings) { settings = next; captures.length = 0; return renderToStaticMarkup(React.createElement(HomeShowcase, { onApplyPreset() {} })) },
    captures,
  }
}

test('home cards share configured title, description, media, effects, order and enabled state', () => {
  const h = homeHarness()
  const html = h.render({
    tryon: { title: '试穿作品展示', description: '后台更新的人物与服装组合', order: -10, effect: 'carousel', media: [{ type: 'image', url: '/configured-first.webp' }, { type: 'image', url: '/configured-second.webp' }] },
    drama: { enabled: false },
  })
  assert.ok(html.includes('试穿作品展示') && html.includes('后台更新的人物与服装组合'))
  assert.deepEqual([...html.matchAll(/data-home-tool="([^"]+)"/g)].map(match => match[1]), ['tryon', 'remix', 'canvas'])
  assert.equal(h.captures[0].showcase.effect, 'carousel')
  assert.deepEqual(h.captures[0].showcase.media.map(item => item.url), ['/configured-first.webp', '/configured-second.webp'])
  assert.ok(h.captures.every(props => props.compact))
  assert.ok(!/<a\b[^>]*>[^<]*<button/.test(html), 'Preview controls are siblings of the navigation link')
  assert.match(html, /aria-label="使用 试穿作品展示"/)
  assert.match(html, /href="\/tools\/tryon"/)
})

test('subsequent config reads update the home preview rather than retaining a separate card copy', () => {
  const h = homeHarness()
  h.render({ tryon: { title: '旧标题', media: [{ type: 'image', url: '/first.webp' }] } })
  const html = h.render({ tryon: { title: '新标题', description: '新描述', effect: 'video', media: [{ type: 'video', url: '/new.mp4', poster: '/new.webp' }] } })
  const preview = h.captures.find(props => props.showcase.title === '新标题')
  assert.ok(html.includes('新标题') && !html.includes('旧标题'))
  assert.equal(preview.showcase.media[0].url, '/new.mp4')
  assert.equal(preview.showcase.effect, 'video')
  assert.ok(h.captures.every(props => props.fallback.startsWith('/media/generated/')))
})

test('compact media fits home thumbnails while keeping controls outside navigation', () => {
  const { CreativeToolMedia } = load('components/studio/plugins/creative-tool-media.tsx', {
    '@/lib/studio/i18n': locale, '@/lib/utils': utils, './creative-tool-media.module.css': {},
  })
  const config = showcase.toolShowcase('tryon', { tryon: { effect: 'carousel', media: [{ type: 'image', url: '/a.webp', label: 'Long preview label' }, { type: 'image', url: '/b.webp' }] } })
  const compact = renderToStaticMarkup(React.createElement(CreativeToolMedia, { showcase: config, fallback: '/fallback.webp', compact: true }))
  const regular = renderToStaticMarkup(React.createElement(CreativeToolMedia, { showcase: config, fallback: '/fallback.webp' }))
  assert.match(compact, /h-full w-full/)
  assert.ok(!compact.includes('aspect-video') && !compact.includes('Long preview label'))
  assert.ok(compact.includes('下一张展示图') && compact.includes('暂停轮播'))
  assert.ok(!compact.includes('上一张展示图'))
  assert.ok(regular.includes('aspect-video') && regular.includes('上一张展示图') && regular.includes('Long preview label'))
})
