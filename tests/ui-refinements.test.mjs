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

test('creative navigation provides direct tool entry and exactly one active primary destination', () => {
  const { studioPrimaryNav, isNavItemActive } = loadComponent('../components/studio/studio-nav.tsx', {}, {
    'next/navigation': { useRouter: () => ({ push() {} }) },
    './ui': { Tooltip: 'Tooltip' },
  })
  for (const path of ['/studio', '/image', '/video', '/agent', '/projects', '/assets']) {
    assert.ok(studioPrimaryNav.some((item) => item.href === path), `${path} has a direct navigation entry`)
    assert.equal(studioPrimaryNav.filter((item) => isNavItemActive(path, item)).length, 1)
  }
  assert.equal(studioPrimaryNav.filter((item) => isNavItemActive('/projects/example/canvas', item)).length, 1)
})

test('shared page headings preserve an h1, a description and the real action controls', () => {
  const { PageHeader } = loadComponent('../components/studio/ui.tsx')
  const action = jsx('button', { type: 'button', children: '新建项目' })
  const tree = PageHeader({ eyebrow: '创作空间', title: '我的项目', description: '接着上次的灵感继续创作。', actions: action })
  const nodes = all(tree)
  assert.equal(tree.type, 'header')
  assert.equal(nodes.filter((node) => node.type === 'h1').length, 1)
  assert.equal(nodes.find((node) => node.type === 'h1').props.children, '我的项目')
  assert.ok(nodes.includes(action))
  assert.ok(nodes.some((node) => node.props?.children === '接着上次的灵感继续创作。'))
})

function loadWorkspaceKit() {
  return loadComponent('../components/studio/workspace-kit.tsx', { useId: () => 'workspace-test' }, {
    './ui': { ControlButton: 'ControlButton', IconAction: 'IconAction', MediaThumb: 'MediaThumb', Modal: 'Modal', Notice: 'Notice', StatusBadge: 'StatusBadge', Tooltip: 'Tooltip' },
  })
}

test('workspace layout keeps one mounted parameter form and one result stage at every breakpoint', () => {
  const { WorkspaceShell } = loadWorkspaceKit()
  const params = jsx('input', { id: 'preserved-prompt', defaultValue: '保留创作草稿' })
  const stage = jsx('div', { 'data-result-stage': true })
  const tree = WorkspaceShell({ title: '图片生成', description: '创作工具说明', params, stage, onSubmit() {}, submitLabel: '生成图片' })
  const nodes = all(tree)
  assert.equal(tree.type, 'form')
  assert.equal(nodes.filter((node) => node.type === 'form').length, 1)
  assert.equal(nodes.filter((node) => node === params).length, 1)
  assert.equal(nodes.filter((node) => node === stage).length, 1)
  assert.equal(nodes.find((node) => node.type === 'h1').props.children, '图片生成')
  const panel = nodes.find((node) => node.props?.className?.includes('workspace-params-panel'))
  assert.ok(all(panel).some((node) => node.props?.className?.includes('md:flex')))
})

test('creative option grids support wrapping arrow navigation and a single tab stop', () => {
  const { OptionGrid } = loadWorkspaceKit()
  const options = [{ value: '1:1', label: '方形' }, { value: '16:9', label: '横屏' }, { value: '9:16', label: '竖屏' }]
  for (const [value, key, expected] of [['1:1', 'ArrowRight', '16:9'], ['9:16', 'ArrowRight', '1:1'], ['1:1', 'ArrowLeft', '9:16'], ['16:9', 'Home', '1:1'], ['1:1', 'End', '9:16']]) {
    let selected, focused
    const tree = OptionGrid({ label: '画面比例', value, options, onChange: (next) => { selected = next } })
    const buttons = all(tree).filter((node) => node.props?.role === 'radio')
    assert.equal(buttons.filter((button) => button.props.tabIndex === 0).length, 1)
    tree.props.onKeyDown({ key, nativeEvent: {}, preventDefault() {}, currentTarget: { querySelectorAll: () => buttons.map((button, index) => ({ focus: () => { focused = options[index].value } })) } })
    assert.equal(selected, expected)
    assert.equal(focused, expected)
  }
  let changed = false
  const tree = OptionGrid({ label: '画面比例', value: '1:1', options, onChange: () => { changed = true } })
  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) tree.props.onKeyDown({ key: 'ArrowRight', nativeEvent })
  assert.equal(changed, false)
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
