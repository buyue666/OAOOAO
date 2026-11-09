import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function load(path, imports = {}) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(id => { assert.ok(id in imports, 'Unexpected dependency: ' + id); return imports[id] }, module, module.exports)
  return module.exports
}
const files = load('lib/studio/agent-files.ts')
const mentions = load('lib/studio/prompt-references.ts')
const director = load('lib/studio/director-workspace.ts', { './director-context': { buildAssistantPrompt: text => text }, './prompt-references': mentions, './agent-files': files })
const drama = load('lib/studio/drama-production.ts', { './api': {} })
const navigation = load('lib/studio/workspace-navigation.ts')

test('named file references support duplicate names, spaces, embedded @ and mixed file types', () => {
  const source = [{ id: 'a', title: '故事 @图1 设定.md', kind: 'text' }, { id: 'b', title: '故事 @图1 设定.md', kind: 'text' }, { id: 'c', title: '角色.png', kind: 'image' }, { id: 'd', title: '动作.mp4', kind: 'video' }]
  const refs = files.agentPromptReferences(source)
  assert.equal(refs[0].mention, '@「故事 @图1 设定.md」'); assert.equal(refs[1].mention, '@「故事 @图1 设定.md · 2」')
  const text = `按 ${refs[0].mention}，参考 ${refs[1].mention} 和 ${refs[3].mention}`
  assert.deepEqual(mentions.promptReferenceMentions(text, refs).map(token => token.index), [0, 1, 3])
  const prompt = director.directorRequestPrompt(text, { surface: 'chat' }, 'general', source)
  assert.match(prompt, /素材 ID：a/); assert.match(prompt, /素材 ID：b/); assert.match(prompt, /素材 ID：d/)
  assert.deepEqual(mentions.promptReferenceMentions('请用 @图1 @视频1 @文档2', refs).map(token => token.index), [2, 3, 1])
})

test('removing and reordering named attachments preserves identity and marks removed references', () => {
  const source = [{ id: 'a', title: 'a.md', kind: 'text' }, { id: 'b', title: 'b.png', kind: 'image' }]
  assert.equal(director.remapDirectorReferences('根据 @「a.md」 改 @「b.png」', source, [source[1]]), '根据 （已移除：a.md） 改 @「b.png」')
  assert.equal(director.remapDirectorReferences('@图1 @文档1', source, [...source].reverse()), '@「b.png」 @「a.md」')
})

test('file validation bounds count, text length and formats before uploads', () => {
  assert.equal(files.validateAgentFiles([{ name: 'script.md', type: '', size: 100 }], 0), '')
  assert.equal(files.agentFileKind({ name: 'voice.wav', type: 'audio/wav' }), 'audio')
  assert.match(files.validateAgentFiles([{ name: 'model.exe', type: '', size: 100 }], 0), /暂不支持/)
  assert.match(files.validateAgentFiles([{ name: 'a.png', type: 'image/png', size: 21 * 1024 ** 2 }], 0), /20 MB/)
  assert.match(files.validateAgentFiles([{ name: 'a.txt', type: 'text/plain', size: 100 }], 12), /12/)
  assert.equal(files.normalizeAgentText('\uFEFF第一行\r\n第二行\r\n'), '第一行\n第二行')
  assert.throws(() => files.normalizeAgentText('a'.repeat(24001))); assert.throws(() => files.normalizeAgentText('binary\u0000data'))
})

test('drama readiness requires all adopted videos and requested voiceovers', () => {
  const shot = drama.newDramaShot(0)
  assert.equal(drama.dramaEpisodeReadiness().canRender, false)
  const episode = { ...drama.newDramaEpisode(0), shots: [{ ...shot, videoUrl: '/owned-video', audioMode: 'voiceover' }] }
  assert.equal(drama.dramaEpisodeReadiness(episode).canRender, false)
  episode.shots[0].audioUrl = '/owned-audio'
  assert.equal(drama.dramaEpisodeReadiness(episode).canRender, true)
  assert.equal(drama.dramaEpisodeReadiness(episode).seconds, 5)
})

test('acknowledging a save never drops edits typed or switched to during the request', () => {
  const submitted = { id: 'p', updatedAt: 'old', episodes: [{ id: 'e1', script: 'first' }], activeEpisodeId: 'e1' }
  const saved = { ...submitted, updatedAt: 'new' }
  assert.equal(drama.acknowledgeDramaSave(submitted, submitted, saved), saved)
  const edited = { ...submitted, title: 'new title', activeEpisodeId: 'e2', episodes: [{ id: 'e1', script: 'new draft' }, { id: 'e2', script: 'another draft' }] }
  assert.deepEqual(drama.acknowledgeDramaSave(edited, submitted, saved), { ...edited, updatedAt: 'new' })
})

test('creation and related navigation remain in the current team and project', () => {
  const team = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222'
  assert.equal(navigation.workspaceHref(`/teams/${team}`, '/studio'), `/teams/${team}?tab=projects&intent=create`)
  assert.equal(navigation.workspaceHref(`/teams/${team}/projects/${project}`, '/studio'), `/teams/${team}/projects/${project}/canvas`)
  assert.equal(navigation.workspaceHref(`/teams/${team}/projects/${project}/canvas`, '/works'), `/teams/${team}/projects/${project}?tab=generation`)
  assert.equal(navigation.workspaceHref(`/teams/${team}/projects/${project}`, '/assets'), `/teams/${team}/projects/${project}?tab=assets`)
  assert.equal(navigation.workspaceHref(`/teams/${team}`, '/projects'), `/teams/${team}?tab=projects`)
  for (const path of ['/studio', '/teams', '/teams/join', '/teams/not-a-team']) assert.equal(navigation.workspaceHref(path, '/studio'), '/studio')
})


test('team identity persists across unscoped navigation and validates saved workspace keys', () => {
  const identity = { teamId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222' }
  assert.deepEqual(navigation.parseWorkspaceIdentity(JSON.stringify(identity)), identity)
  for (const path of ['/studio', '/image', '/video', '/agent', '/canvas', '/drama']) assert.equal(navigation.workspaceDestination(path, identity), `/teams/${identity.teamId}/projects/${identity.projectId}/canvas`)
  assert.equal(navigation.workspaceDestination('/assets', identity), `/teams/${identity.teamId}/projects/${identity.projectId}?tab=assets`)
  assert.equal(navigation.workspaceDestination('/works', identity), `/teams/${identity.teamId}/projects/${identity.projectId}?tab=generation`)
  assert.equal(navigation.workspaceDestination('/settings', identity), `/teams/${identity.teamId}?tab=settings`)
  for (const path of ['/account', '/credits']) assert.equal(navigation.workspaceDestination(path, identity), `/teams/${identity.teamId}?tab=usage`)
  for (const path of ['/tools/remix', '/tools/tryon', '/skills']) assert.equal(navigation.workspaceDestination(path, identity), `/teams/${identity.teamId}/projects/${identity.projectId}/canvas`)
  assert.equal(navigation.workspaceDestination('/studio', null), '/studio')
  for (const raw of ['broken', '{}', '{"teamId":"not-a-team"}', '{"teamId":"11111111-1111-4111-8111-111111111111","projectId":"bad"}']) assert.equal(navigation.parseWorkspaceIdentity(raw), null)
})

test('working identity survives navigation and reload but never leaks between login accounts', () => {
  const previousStorage = globalThis.localStorage
  const saved = new Map()
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  let account = 'alice', pathname = '/studio'
  const teamId = '11111111-1111-4111-8111-111111111111', projectId = '22222222-2222-4222-8222-222222222222'
  function harness() {
    let cursor = 0, pending = []
    const slots = []
    const hooks = {
      createContext: () => ({ Provider: 'provider' }), useContext: () => null,
      useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial } },
      useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
      useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => !Object.is(value, old[index]))) { slots[i] = deps; pending.push(fn) } },
    }
    const provider = load('lib/studio/workspace-context.tsx', { react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) }, 'next/navigation': { usePathname: () => pathname }, './store': { useStudio: () => ({ state: { user: { id: account } } }) }, './workspace-navigation': navigation })
    return () => { cursor = 0; const tree = provider.WorkspaceProvider({ children: 'page' }); const effects = pending; pending = []; effects.forEach(fn => fn()); return tree.props.value }
  }
  try {
    let render = harness()
    assert.equal(render().ready, false); assert.equal(render().identity, null)
    pathname = `/teams/${teamId}/projects/${projectId}/canvas`; render()
    assert.deepEqual(render().identity, { teamId, projectId })
    pathname = '/studio'; render(); assert.deepEqual(render().identity, { teamId, projectId })
    assert.equal(render().href('/studio'), `/teams/${teamId}/projects/${projectId}/canvas`)
    render = harness(); render(); assert.deepEqual(render().identity, { teamId, projectId })
    account = 'bob'; assert.equal(render().ready, false); assert.equal(render().identity, null)
    account = 'alice'; render(); assert.deepEqual(render().identity, { teamId, projectId })
    render().select(null); assert.equal(render().identity, null)
    render = harness(); render(); assert.equal(render().identity, null)
  } finally { globalThis.localStorage = previousStorage }
})
