import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const jsx = (type, props) => ({ type, props })
const all = (node) => node && typeof node === 'object'
  ? [node, ...[node.props?.children].flat(Infinity).flatMap(all)]
  : []

function loadComponent(file, hooks, extra = {}) {
  const imports = {
    react: { useRef: (current) => ({ current }), useEffect() {}, useLayoutEffect() {}, useState: (initial) => [initial, () => {}], ...hooks },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-dom': { createPortal: (node) => node },
    'next/link': 'Link',
    'next/image': 'Image',
    'lucide-react': new Proxy({}, { get: (_, key) => key }),
    'radix-ui': { Tooltip: {} },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/studio/i18n': { useUiText: () => (value) => value, useLocale: () => ({ locale: 'zh-CN', t: (value) => value }) },
    ...extra,
  }
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in imports, `Unexpected import: ${name}`)
    return imports[name]
  }, module, module.exports)
  return module.exports
}

function galleryFrames(progress, reduced = false) {
  const { LandingPage } = loadComponent('../components/landing-page.tsx', {
    useState: (initial) => [typeof initial === 'number' ? progress : typeof initial === 'boolean' ? reduced : initial, () => {}],
  }, {
    './landing-page.module.css': new Proxy({}, { get: (_, key) => key }),
    './homepage-announcement': { HomepageAnnouncement: 'Announcement' },
    './site-brand': { SiteBrand: 'Brand' },
    './site-footer': { SiteFooter: 'Footer' },
  })
  const gallery = all(LandingPage()).find((node) => node.type?.name === 'Gallery')
  assert.ok(gallery)
  return all(gallery.type()).filter((node) => node.props?.['data-gallery-frame'] !== undefined)
}

test('gallery scroll reaches every work and newer frames cover earlier frames', () => {
  for (let index = 0; index < 4; index++) {
    const frames = galleryFrames(index / 3)
    assert.equal(frames.length, 4)
    assert.deepEqual(frames.map((frame) => frame.props.style.zIndex), [1, 2, 3, 4])
    assert.deepEqual(frames.map((frame) => frame.props.style.opacity), frames.map((_, frameIndex) => frameIndex <= index ? 1 : 0))
    assert.deepEqual(frames.map((frame) => frame.props['data-active']), frames.map((_, frameIndex) => frameIndex === index))
    assert.ok(frames.every((frame) => frame.props['aria-hidden'] === undefined))
  }
})

test('gallery interpolation remains visible and reduced motion exposes every work without transforms', () => {
  for (const progress of [0, 0.1, 0.45, 0.8, 1]) {
    const frames = galleryFrames(progress)
    assert.equal(frames[0].props.style.opacity, 1)
    assert.ok(frames.every((frame) => frame.props.style.opacity >= 0 && frame.props.style.opacity <= 1))
    assert.equal(frames.filter((frame) => frame.props['data-active']).length, 1)
  }
  for (const frame of galleryFrames(0, true)) {
    assert.equal(frame.props.style.opacity, 1)
    assert.equal(frame.props.style.transform, undefined)
    assert.equal(frame.props['aria-hidden'], undefined)
  }
})

test('segmented controls have roving focus, labelled panels and wrapping keyboard navigation', () => {
  const { SegmentedControl } = loadComponent('../components/studio/ui.tsx')
  const options = [{ value: 'quick', label: '快速生成' }, { value: 'project', label: '完整作品' }]
  for (const [value, key, expected] of [
    ['quick', 'ArrowRight', 'project'], ['project', 'ArrowRight', 'quick'],
    ['quick', 'ArrowLeft', 'project'], ['project', 'Home', 'quick'], ['quick', 'End', 'project'],
  ]) {
    let selected, focused, prevented = false
    const tree = SegmentedControl({ id: 'home-entry', label: '创作方式', value, options, onChange: (next) => { selected = next } })
    const buttons = all(tree).filter((node) => node.props?.role === 'tab')
    tree.props.ref.current = { querySelectorAll: () => buttons.map((button) => ({ focus: () => { focused = button.props.id } })) }
    assert.equal(tree.props['aria-label'], '创作方式')
    assert.equal(buttons.filter((button) => button.props.tabIndex === 0).length, 1)
    assert.equal(buttons.find((button) => button.props['aria-selected']).props.id, `home-entry-${value}`)
    assert.equal(buttons[0].props['aria-controls'], 'home-entry-panel-quick')
    tree.props.onKeyDown({ key, preventDefault: () => { prevented = true } })
    assert.ok(prevented)
    assert.equal(selected, expected)
    assert.equal(focused, `home-entry-${expected}`)
  }
})

test('home entry panels keep the project draft mounted and direction cards only select a brief', () => {
  for (const mode of ['quick', 'project']) {
    const changes = []
    const { HomePage } = loadComponent('../components/studio/home-page.tsx', {
      useState: (initial) => [initial === 'quick' ? mode : '保留的项目提纲', (value) => changes.push(value)],
    }, {
      './ui': { SegmentedControl: 'SegmentedControl' },
      './creative-project-starter': { CreativeProjectStarter: 'ProjectStarter' },
      './home-recent-works': { RecentWorks: 'RecentWorks' },
      '@/components/site-brand': { useSiteBrand: () => ({ title: 'OAO' }) },
      '@/components/site-footer': { SiteFooter: 'Footer' },
    })
    const nodes = all(HomePage())
    const panels = nodes.filter((node) => node.props?.role === 'tabpanel')
    assert.equal(panels.length, 2)
    assert.equal(panels[0].props.hidden, mode !== 'quick')
    assert.equal(panels[1].props.hidden, mode !== 'project')
    assert.equal(panels[1].props['aria-labelledby'], 'home-entry-project')
    assert.equal(nodes.find((node) => node.type === 'ProjectStarter').props.brief, '保留的项目提纲')
    const directions = nodes.filter((node) => node.type === 'button' && node.props.className.includes('studio-home-direction'))
    assert.equal(directions.length, 3)
    directions[0].props.onClick()
    assert.match(changes[0], /制作一支 15 秒的产品短片/)
    assert.equal(changes[1], 'project')
  }
})

test('search fields have an accessible name and only the composite field owns the focus ring', () => {
  const { SearchField } = loadComponent('../components/studio/ui.tsx')
  const input = all(SearchField({ value: '', onChange() {}, placeholder: '搜索创作资产' })).find((node) => node.type === 'input')
  assert.equal(input.props['aria-label'], '搜索创作资产')
  assert.equal(input.props['data-focus-managed'], true)
})

test('new animations retain their reduced-motion fallback and source attribution', () => {
  const landing = readFileSync(new URL('../components/landing-page.module.css', import.meta.url), 'utf8')
  const global = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
  assert.match(landing, /Motion Prompt #074 · MIT License/)
  assert.match(landing, /translate 700ms var\(--ease-out\)/)
  assert.match(landing, /\[data-landing-reveal='pending'\] \{ opacity: 0; translate: 0 28px;/)
  assert.match(landing, /prefers-reduced-motion: reduce[\s\S]*\.landing \[data-landing-reveal\] \{ opacity: 1; translate: none;/)
  assert.match(global, /Motion Prompt #060 · MIT License/)
  assert.match(global, /transform 250ms cubic-bezier\(0\.645, 0\.045, 0\.355, 1\)/)
  assert.match(global, /prefers-reduced-motion: reduce[\s\S]*\.studio-segmented-indicator,[\s\S]*transition: none;/)
})
