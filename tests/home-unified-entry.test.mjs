import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { chineseLocale } from './helpers/locale.mjs'

const require = createRequire(import.meta.url)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText

function loadIntentModule(storage) {
  const originalWindow = globalThis.window
  globalThis.window = { sessionStorage: storage }
  const module = { exports: {} }
  try {
    new Function('require', 'module', 'exports', compile(read('lib/studio/create-intent.ts')))(
      (name) => require(name),
      module,
      module.exports,
    )
  } finally {
    globalThis.window = originalWindow
  }
  return module.exports
}

function memoryStorage() {
  const map = new Map()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  }
}

test('create-intent isolates personal and team scopes and consumes once on match', () => {
  const storage = memoryStorage()
  const originalWindow = globalThis.window
  globalThis.window = { sessionStorage: storage }
  try {
    const intent = loadIntentModule(storage)
    const saved = intent.saveCreateIntent({
      mode: 'image',
      prompt: '统一入口测试描述',
      files: [],
      teamId: 'team-1',
      projectId: 'proj-1',
      settings: { model: 'img-a', ratio: '16:9', resolution: '2K', quality: 'high' },
    })
    assert.deepEqual(saved, { saved: true, droppedFiles: 0 })

    // Personal workspace check or wrong team must not consume team-1's intent
    assert.equal(intent.consumeCreateIntent('image', {}), null)
    assert.equal(intent.consumeCreateIntent('image', { teamId: 'team-2' }), null)
    assert.equal(intent.consumeCreateIntent('video', { teamId: 'team-1' }), null)

    // Matching team & mode consumes exactly once
    const consumed = intent.consumeCreateIntent('image', { teamId: 'team-1' })
    assert.equal(consumed?.prompt, '统一入口测试描述')
    assert.equal(consumed?.settings?.resolution, '2K')
    assert.equal(intent.consumeCreateIntent('image', { teamId: 'team-1' }), null)
  } finally {
    globalThis.window = originalWindow
  }
})

test('reference handoff preserves every file and never replaces a draft with a partial upload', async () => {
  const storage = memoryStorage()
  const originalWindow = globalThis.window
  globalThis.window = { sessionStorage: storage }
  try {
    const intent = loadIntentModule(storage)
    const files = Array.from({ length: 12 }, (_, index) => ({ name: `reference-${index}.png`, type: 'image/png', dataUrl: 'data:image/png;base64,YQ==' }))
    assert.deepEqual(intent.saveCreateIntent({ mode: 'agent', prompt: 'keep all references', files }), { saved: true, droppedFiles: 0 })
    assert.equal(intent.consumeCreateIntent('image'), null)
    assert.equal(intent.consumeCreateIntent('agent')?.files.length, 12)
    storage.setItem('oaooao-create-intent', 'previous draft')
    storage.setItem = () => { throw new Error('Quota exceeded') }
    assert.deepEqual(intent.saveCreateIntent({ mode: 'agent', prompt: 'new draft', files }), { saved: false, droppedFiles: 0 })
    assert.equal(storage.getItem('oaooao-create-intent'), 'previous draft')
  } finally {
    globalThis.window = originalWindow
  }
})

test('home composer keeps incompatible files visible with badge and renders compatibility notice', () => {
  const module = { exports: {} }
  const source = read('components/studio/home-composer.tsx')
  new Function('require', 'module', 'exports', compile(source))((name) => {
    if (name === '@/lib/studio/i18n') return chineseLocale
    if (name === '@/lib/utils') return { cn: (...items) => items.filter(Boolean).join(' ') }
    if (name === 'next/image') return { __esModule: true, default: ({ alt, ...props }) => React.createElement('img', { alt, ...props }) }
    if (name === 'next/link') return { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) }
    return require(name)
  }, module, module.exports)

  const files = [
    { name: 'reference.png', size: 1024, lastModified: 1, type: 'image/png' },
    { name: 'script.txt', size: 256, lastModified: 2, type: 'text/plain' },
  ]
  const html = renderToStaticMarkup(React.createElement(module.exports.PromptComposer, {
    value: '测试提示词',
    onChange: () => {},
    onSubmitShortcut: () => {},
    files,
    onFilesChange: () => {},
    placeholder: '输入描述',
    isFileCompatible: (file) => file.type.startsWith('image/'),
    incompatibleLabel: '仅创作助手',
  }))
  assert.match(html, /reference\.png/)
  assert.match(html, /script\.txt/)
  assert.match(html, /仅创作助手/)
})

test('home page renders unified mode bar and composer for personal and team workspaces', () => {
  const studioModels = (() => {
    const out = { exports: {} }
    new Function('require', 'module', 'exports', compile(read('lib/studio/studio-models.ts')))(
      (name) => require(name),
      out,
      out.exports,
    )
    return out.exports
  })()

  const composerMod = { exports: {} }
  new Function('require', 'module', 'exports', compile(read('components/studio/home-composer.tsx')))((name) => {
    if (name === '@/lib/studio/i18n') return chineseLocale
    if (name === '@/lib/utils') return { cn: (...items) => items.filter(Boolean).join(' ') }
    if (name === 'next/image') return { __esModule: true, default: ({ alt, ...props }) => React.createElement('img', { alt, ...props }) }
    if (name === 'next/link') return { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) }
    return require(name)
  }, composerMod, composerMod.exports)

  const panelMod = { exports: {} }
  new Function('require', 'module', 'exports', compile(read('components/studio/home-generation-panel.tsx')))((name) => {
    if (name === '@/lib/studio/i18n') return chineseLocale
    if (name === '@/lib/utils') return { cn: (...items) => items.filter(Boolean).join(' ') }
    if (name === './model-icon') return { ModelIcon: () => null }
    if (name === './ui') return { ModelNote: () => null, ModelSubscriptionBadge: () => null }
    return require(name)
  }, panelMod, panelMod.exports)

  const homeMod = { exports: {} }
  new Function('require', 'module', 'exports', compile(read('components/studio/home-page.tsx')))((name) => {
    if (name === '@/lib/studio/i18n') return chineseLocale
    if (name === '@/lib/utils') return { cn: (...items) => items.filter(Boolean).join(' ') }
    if (name === 'next/link') return { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) }
    if (name === 'next/navigation') return { useRouter: () => ({ push: () => {} }) }
    if (name === '@/lib/studio/store') return {
      useStudio: () => ({
        state: { liveModels: [], sessionSettings: {}, backendStatus: 'connected', user: { id: 'u1' }, projects: [] },
        estimateCredits: () => 10,
        defaultModels: { imageSize: '16:9', imageCount: 1, videoQuality: '720', videoSeconds: 5 },
      }),
    }
    if (name === '@/lib/studio/studio-models') return studioModels
    if (name === '@/lib/studio/team-generation') return { availableTeamModels: () => [] }
    if (name === '@/lib/studio/video-policy') return { selectableVideoDurations: () => [] }
    if (name === '@/lib/studio/agent-files') return { AGENT_FILE_ACCEPT: 'image/*', AGENT_FILE_LIMIT: 12, validateAgentFiles: () => '' }
    if (name === '@/lib/studio/create-intent') return { readIntentFiles: async () => ({ files: [], failed: [] }), saveCreateIntent: () => ({ saved: true, droppedFiles: 0 }) }
    if (name === '@/lib/studio/workspace-navigation') return { workspaceHref: (root, target) => `${root}${target === '/image' || target === '/video' ? `/studio${target}` : target}`, workspaceRoot: ({ teamId }) => `/teams/${teamId}` }
    if (name === '@/components/site-brand') return { useSiteBrand: () => ({ title: 'OAO' }) }
    if (name === '@/components/site-footer') return { SiteFooter: () => null }
    if (name === './home-composer') return composerMod.exports
    if (name === './home-generation-panel') return panelMod.exports
    if (name === './home-recent-works') return { RecentWorks: () => null }
    if (name === './home-showcase') return { HomeShowcase: () => null }
    if (name === './plugins/plugin-workspaces') return { PluginProjectStarter: () => null }
    if (name === './team-projects') return { TeamProjects: () => null }
    return require(name)
  }, homeMod, homeMod.exports)

  const personalHtml = renderToStaticMarkup(React.createElement(homeMod.exports.HomePage))
  assert.match(personalHtml, /data-tour="creator"/)
  assert.match(personalHtml, /id="home-prompt"/)
  assert.match(personalHtml, /创作助手/)
  assert.match(personalHtml, /图片生成/)
  assert.match(personalHtml, /视频生成/)
  assert.match(personalHtml, /完整作品/)
  assert.match(personalHtml, /data-studio-spotlight="image"/)
  assert.match(personalHtml, /data-studio-spotlight="video"/)
  assert.match(personalHtml, /图片工作台/)
  assert.match(personalHtml, /视频工作台/)

  const teamHtml = renderToStaticMarkup(React.createElement(homeMod.exports.HomePage, {
    team: { id: 't1', name: '设计组', role: 'owner', modelIds: [] },
  }))
  assert.doesNotMatch(teamHtml, />创作助手</)
  assert.match(teamHtml, /图片生成/)
  assert.match(teamHtml, /视频生成/)
  assert.match(teamHtml, /团队项目/)
  assert.match(teamHtml, /href="\/teams\/t1\/studio\/image"/)
  assert.match(teamHtml, /href="\/teams\/t1\/studio\/video"/)
})
