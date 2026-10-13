const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')
const { webcrypto } = require('node:crypto')
const ts = require('typescript')
let afterProductionFetch = null

// Execute the actual pure production helpers, rather than a copied algorithm.
const moduleCache = new Map()
function loadProductionModule(file) {
  const absolute = path.resolve(__dirname, '../lib/studio', file)
  if (moduleCache.has(absolute)) return moduleCache.get(absolute).exports
  const module = { exports: {} }; moduleCache.set(absolute, module)
  const source = fs.readFileSync(absolute, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = {
    exports: module.exports, module, crypto: webcrypto, URL, URLSearchParams, Headers, Response, Blob,
    fetch: async (url, options) => {
      const resolved = new URL(url, origin)
      const response = await fetch(resolved, options)
      if (afterProductionFetch) await afterProductionFetch(resolved, options, response)
      return response
    },
    require: (name) => { assert.ok(name.startsWith('./'), `unexpected runtime dependency ${name}`); return loadProductionModule(`${name.slice(2)}.ts`) },
  }
  vm.runInNewContext(compiled, context, { filename: absolute })
  return module.exports
}
const helpers = loadProductionModule('creative-project.ts')
const creativeApi = loadProductionModule('creative-api.ts')
const draftHelpers = loadProductionModule('creative-draft.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))

function projectFixture() {
  const shot = (id, patch = {}) => ({ ...helpers.newCreativeShot(1, { description: '杯沿的晨光', imagePrompt: '杯沿的晨光', duration: 5, ...patch }), id })
  return {
    id: 'project-a', title: '山野之间', summary: '', style: '自然光', ratio: '16:9', status: 'active',
    updatedAt: '2026-10-13T00:00:00.000Z', createdAt: '2026-10-13T00:00:00.000Z',
    activeEpisodeId: 'episode-a', defaultVideoMode: 'storyboard',
    characters: [], scenes: [], props: [{ id: 'cup', name: '咖啡杯', description: '米白色', profile: { consistencyRules: '保留杯形' }, references: [{ id: 'ref-a', url: '/api/reference-assets/cup-a.png' }, { id: 'ref-b', url: '/api/reference-assets/cup-b.png' }], primaryReferenceId: 'ref-b' }], clues: [], sourceAssets: [],
    episodes: [
      { id: 'episode-a', title: '第一集', script: '', scriptRichContent: { untouched: true }, customMetadata: { owner: 'keep' }, shots: [shot('shot-a', { propIds: ['cup'], videoUrl: '/api/generation-log-assets/old.mp4', generationTaskId: 'old-video', generationStatus: 'success' }), shot('shot-b')] },
      { id: 'episode-b', title: '第二集', script: '', shots: [shot('shot-c', { propIds: ['cup'] })] },
    ],
  }
}

function candidate(patch = {}) {
  const value = { id: 'candidate-a', projectId: 'project-a', episodeId: 'episode-a', shotId: 'shot-a', kind: 'image', taskId: 'task-a', resultIndex: 0, url: '/api/generation-log-assets/new.png', width: 960, height: 540, createdAt: '2026-10-13T00:00:00.000Z', ...patch }
  value.key = helpers.candidateKey(value, value.kind, value.taskId, value.resultIndex)
  return value
}

test('candidate identity distinguishes outputs and ambiguous separator IDs', () => {
  const scope = { projectId: 'p', episodeId: 'e', shotId: 's' }
  assert.notEqual(helpers.candidateKey(scope, 'image', 'task', 0), helpers.candidateKey(scope, 'image', 'task', 1))
  assert.notEqual(helpers.candidateKey({ ...scope, projectId: 'p:e', episodeId: 's' }, 'image', 'task', 0), helpers.candidateKey({ ...scope, projectId: 'p', episodeId: 'e:s' }, 'image', 'task', 0))
  assert.notEqual(helpers.candidateKey(scope, 'image', 'task', 0), helpers.candidateKey(scope, 'video', 'task', 0))
})

test('new shot from a copied draft always receives a fresh identity', () => {
  const copied = { id: 'existing-shot', title: '复制镜头', imagePrompt: '晨光' }
  const first = helpers.newCreativeShot(2, copied)
  const second = helpers.newCreativeShot(2, copied)
  assert.notEqual(first.id, copied.id)
  assert.notEqual(first.id, second.id)
  assert.equal(first.imagePrompt, copied.imagePrompt)
})

test('adopting image changes exactly one shot and preserves video, metadata and original snapshot', () => {
  const project = projectFixture(); const original = plain(project)
  const result = helpers.adoptShotCandidate(project, 'episode-a', 'shot-a', candidate())
  const shot = result.episodes[0].shots[0]
  assert.equal(shot.storyboardImageUrl, '/api/generation-log-assets/new.png')
  assert.equal(shot.storyboardTaskId, 'task-a')
  assert.equal(shot.storyboardStatus, 'success')
  assert.equal(shot.videoUrl, '/api/generation-log-assets/old.mp4')
  assert.equal(shot.generationTaskId, 'old-video')
  assert.equal(result.episodes[0].shots[1], project.episodes[0].shots[1])
  assert.equal(result.episodes[1], project.episodes[1])
  assert.equal(result.episodes[0].scriptRichContent, project.episodes[0].scriptRichContent)
  assert.equal(result.episodes[0].customMetadata, project.episodes[0].customMetadata)
  assert.equal(result.updatedAt, project.updatedAt, 'helper must not invent a server version')
  assert.deepEqual(plain(project), original)
})

test('adopting video preserves the chosen image and rejects mismatched scope or missing shots', () => {
  const project = helpers.adoptShotCandidate(projectFixture(), 'episode-a', 'shot-a', candidate())
  const result = helpers.adoptShotCandidate(project, 'episode-a', 'shot-a', candidate({ kind: 'video', taskId: 'video-b', url: '/api/generation-log-assets/new.mp4' }))
  assert.equal(result.episodes[0].shots[0].storyboardImageUrl, '/api/generation-log-assets/new.png')
  assert.equal(result.episodes[0].shots[0].videoUrl, '/api/generation-log-assets/new.mp4')
  for (const patch of [{ projectId: 'other' }, { episodeId: 'other' }, { shotId: 'other' }, { url: 'blob:temporary' }, { url: 'data:image/png;base64,abc' }]) {
    assert.throws(() => helpers.adoptShotCandidate(project, 'episode-a', 'shot-a', candidate(patch)))
  }
  assert.throws(() => helpers.adoptShotCandidate(project, 'episode-a', 'missing', candidate({ shotId: 'missing' })))
})

test('render invalidation is limited to changed render inputs in the affected episode', () => {
  const project = projectFixture()
  const render = { id: 'render-current', status: 'success', result: { url: '/api/generation-log-assets/finished.mp4' } }
  const otherRender = { id: 'render-other', status: 'success' }
  project.episodes[0].renderTask = render
  project.episodes[1].renderTask = otherRender
  project.episodes[0].shots[0].audioUrl = '/api/generation-log-assets/voice.mp3'
  const image = helpers.adoptShotCandidate(project, 'episode-a', 'shot-a', candidate())
  assert.equal(image.episodes[0].renderTask, render, 'a storyboard image does not change already adopted video bytes')
  const sameVideo = helpers.updateCreativeShot(project, 'episode-a', 'shot-a', { videoUrl: '/api/generation-log-assets/old.mp4' })
  assert.equal(sameVideo.episodes[0].renderTask, render)
  for (const patch of [{ videoUrl: '/api/generation-log-assets/new.mp4' }, { subtitle: '新字幕' }, { duration: 7 }, { audioUrl: undefined }, { audioMode: 'mute' }]) {
    const changed = helpers.updateCreativeShot(project, 'episode-a', 'shot-a', patch)
    assert.equal(changed.episodes[0].renderTask, undefined)
    assert.equal(changed.episodes[1].renderTask, otherRender)
    assert.equal(project.episodes[0].renderTask, render)
  }
})

test('persistent media keys reject unsupported paths and malformed encoded keys', () => {
  assert.equal(helpers.mediaStorageKey('/api/generation-log-assets/user/task/file.png'), 'user/task/file.png')
  assert.equal(helpers.mediaStorageKey('/api/reference-assets/user%2Ffile.png'), 'user/file.png')
  for (const value of ['/ordinary/file.png', 'blob:temporary', '/api/reference-assets/%ZZ', '/api/reference-assets/a%5Cb.png', '/api/reference-assets/a%00.png', '/api/reference-assets/a%2F..%2Fb']) assert.equal(helpers.mediaStorageKey(value), null, value)
})

test('references use linked identity, primary reference and deduplicate a global source', () => {
  const project = projectFixture()
  project.props.push({ id: 'unlinked', name: '无关物品', references: [{ id: 'irrelevant', url: '/api/reference-assets/irrelevant.png' }] })
  project.sourceAssets = [{ id: 'source', type: 'image', title: '同一杯子', serverUrl: '/api/reference-assets/cup-b.png' }]
  const refs = helpers.shotReferences(project, project.episodes[0].shots[0])
  assert.equal(refs.length, 1)
  assert.equal(refs[0].url, '/api/reference-assets/cup-b.png')
  const adopted = helpers.adoptShotCandidate(project, 'episode-a', 'shot-a', candidate())
  const videoRefs = helpers.shotReferences(adopted, adopted.episodes[0].shots[0], 'video')
  assert.equal(videoRefs.length, 1)
  assert.equal(videoRefs[0].role, 'first_frame')
  assert.equal(videoRefs[0].url, '/api/generation-log-assets/new.png')
  const prompt = helpers.buildShotPrompt(project, project.episodes[0].shots[0], 'image', '更柔和')
  assert.match(prompt, /米白色/); assert.match(prompt, /必须保持：保留杯形/); assert.match(prompt, /本次调整：更柔和/)
  assert.doesNotMatch(prompt, /无关物品/)
})

test('asset impact finds linked shots across episodes and subtitle gaps retain real timing', () => {
  const project = projectFixture()
  assert.deepEqual(plain(helpers.assetAffectedShots(project, 'cup')).map((item) => item.shotId), ['shot-a', 'shot-c'])
  assert.equal(helpers.assetAffectedShots(project, 'missing').length, 0)
  const episode = { shots: [{ duration: 2, subtitle: '第一句' }, { duration: 3 }, { duration: 1.25, narration: '第二句' }] }
  assert.equal(helpers.buildProjectSrt(episode), '1\n00:00:00,000 --> 00:00:02,000\n第一句\n\n2\n00:00:05,000 --> 00:00:06,250\n第二句\n')
})

test('candidate result normalization chooses the persisted alias and preserves separate outputs', () => {
  const result = creativeApi.normalizeCandidateMedia('image', { results: [
    { remoteUrl: 'https://upstream.invalid/one.png', serverUrl: '/api/generation-log-assets/one.png', dataUrl: 'data:image/png;base64,x', width: 960 },
    { serverUrl: '/api/generation-log-assets/two.png' },
    { url: '/api/generation-log-assets/one.png' },
  ] })
  assert.equal(result.length, 2)
  assert.equal(result[0].url, '/api/generation-log-assets/one.png')
  assert.equal(result[1].url, '/api/generation-log-assets/two.png')
  assert.equal(result[0].width, 960)
  assert.equal(creativeApi.normalizeCandidateMedia('image', { remoteUrl: 'blob:temporary' }).length, 0)
})

test('draft backups validate their account/project scope and reject malformed external records', () => {
  const base = projectFixture()
  const raw = draftHelpers.serializeCreativeDraft('account-a', base, base)
  assert.ok(draftHelpers.parseCreativeDraft(raw, 'account-a', base.id))
  assert.equal(draftHelpers.parseCreativeDraft(raw, 'account-b', base.id), null)
  assert.equal(draftHelpers.parseCreativeDraft(raw, 'account-a', 'other-project'), null)
  assert.notEqual(draftHelpers.creativeDraftStorageKey('a:b', 'c'), draftHelpers.creativeDraftStorageKey('a', 'b:c'))
  for (const value of [null, '{broken', 'x'.repeat(2 * 1024 * 1024 + 1)]) assert.equal(draftHelpers.parseCreativeDraft(value, 'account-a', base.id), null)
  const change = (mutate) => { const backup = JSON.parse(raw); mutate(backup); return JSON.stringify(backup) }
  for (const value of [
    change((backup) => { backup.version = 2 }),
    change((backup) => { backup.baseUpdatedAt = 'bad-date' }),
    change((backup) => { backup.draft.episodes[0].shots[0].duration = 0 }),
    change((backup) => { delete backup.draft.episodes[0].shots[0].imagePrompt }),
    change((backup) => { backup.draft.episodes[0].shots[1].id = backup.draft.episodes[0].shots[0].id }),
  ]) assert.equal(draftHelpers.parseCreativeDraft(value, 'account-a', base.id), null)
})

test('draft restore accepts only editable fields and preserves server task/media and unknown metadata', () => {
  const base = projectFixture()
  base.episodes[0].renderTask = { id: 'server-render', status: 'success', result: { url: '/api/generation-log-assets/server.mp4' } }
  base.episodes[0].shots[0].storyboardImageUrl = '/api/generation-log-assets/server.png'
  base.episodes[0].shots[0].storyboardTaskId = 'server-task'
  base.episodes[0].shots[0].storyboardStatus = 'success'
  base.episodes[0].shots[0].billing = { charged: 8 }
  const draft = plain(base)
  draft.title = '缓存不应改项目标题'
  draft.props = []
  draft.episodes[0].customMetadata = { owner: 'cache' }
  draft.episodes[0].renderTask = { id: 'cache-render', status: 'success' }
  Object.assign(draft.episodes[0].shots[0], { title: '恢复的镜头名', description: '恢复的描述', storyboardImageUrl: '/api/generation-log-assets/cache.png', storyboardTaskId: 'cache-task', storyboardStatus: 'error', videoUrl: '/api/generation-log-assets/cache.mp4', generationTaskId: 'cache-video', billing: { charged: 0 } })
  const backup = draftHelpers.parseCreativeDraft(draftHelpers.serializeCreativeDraft('account-a', base, draft), 'account-a', base.id)
  const restored = draftHelpers.restoreCreativeDraft(base, backup)
  const shot = restored.episodes[0].shots[0]
  assert.equal(shot.title, '恢复的镜头名')
  assert.equal(shot.description, '恢复的描述')
  assert.equal(shot.storyboardImageUrl, '/api/generation-log-assets/server.png')
  assert.equal(shot.storyboardTaskId, 'server-task')
  assert.equal(shot.storyboardStatus, 'success')
  assert.equal(shot.videoUrl, '/api/generation-log-assets/old.mp4')
  assert.equal(shot.generationTaskId, 'old-video')
  assert.deepEqual(plain(shot.billing), { charged: 8 })
  assert.equal(restored.title, base.title)
  assert.equal(restored.props, base.props)
  assert.equal(restored.episodes[0].customMetadata, base.episodes[0].customMetadata)
  assert.equal(restored.episodes[0].renderTask, base.episodes[0].renderTask)
  assert.equal(restored.episodes[0].scriptRichContent, base.episodes[0].scriptRichContent)
  assert.equal(base.episodes[0].shots[0].title, '镜头 1', 'restoring must not mutate the acknowledged project')
})

test('draft restore retains added shot identity but strips cached results and refuses version/structure conflicts', () => {
  const base = projectFixture()
  base.episodes[0].renderTask = { id: 'stale-render', status: 'success' }
  const draft = plain(base)
  const added = helpers.newCreativeShot(3, { title: '新镜头', description: '暮色', imagePrompt: '暮色', duration: 7 })
  draft.episodes[0].shots.push({ ...added, storyboardImageUrl: '/api/generation-log-assets/untrusted.png', storyboardTaskId: 'untrusted-task', storyboardStatus: 'success', videoUrl: '/api/generation-log-assets/untrusted.mp4' })
  draft.episodes[0].script = '恢复后的剧本'
  const backup = draftHelpers.parseCreativeDraft(draftHelpers.serializeCreativeDraft('account-a', base, draft), 'account-a', base.id)
  const restored = draftHelpers.restoreCreativeDraft(base, backup)
  const addedRestored = restored.episodes[0].shots.find((shot) => shot.id === added.id)
  assert.equal(addedRestored.title, '新镜头')
  assert.equal(addedRestored.duration, 7)
  assert.equal(addedRestored.storyboardImageUrl, undefined)
  assert.equal(addedRestored.storyboardTaskId, undefined)
  assert.equal(addedRestored.videoUrl, undefined)
  assert.equal(restored.episodes[0].renderTask, undefined)
  assert.equal(restored.episodes[0].script, '恢复后的剧本')
  assert.equal(restored.episodes[0].scriptRichContent, undefined)
  assert.throws(() => draftHelpers.restoreCreativeDraft({ ...base, updatedAt: '2026-10-13T00:00:01.000Z' }, backup))
  assert.throws(() => draftHelpers.restoreCreativeDraft(base, { ...backup, projectId: 'other-project' }))
  const missing = plain(backup); missing.draft.episodes[0].shots.splice(0, 1)
  assert.throws(() => draftHelpers.restoreCreativeDraft(base, missing))
  const moved = plain(backup); moved.draft.episodes[1].shots.push(moved.draft.episodes[0].shots.shift())
  assert.throws(() => draftHelpers.restoreCreativeDraft(base, moved))
})

let fixture
let origin
before(async () => {
  const { createCreativeFixture } = await import(pathToFileURL(path.join(__dirname, 'creative-fixture-server.mjs')).href)
  fixture = createCreativeFixture({ seed: false })
  origin = await fixture.listen(0)
})
after(async () => { if (fixture) await fixture.close() })
async function api(url, options = {}) {
  const response = await fetch(`${origin}${url}`, { ...options, headers: { 'content-type': 'application/json', origin, ...options.headers } })
  return { status: response.status, body: await response.json() }
}

test('HTTP project creation retries and concurrent requests reuse the stable sourceHandoffId', async () => {
  const before = (await api('/api/fixture/state')).body.projectCount
  const input = { title: '幂等创建项目', sourceHandoffId: 'creative-stable-request', initialScript: '最初描述' }
  const create = (body) => api('/api/drama/projects', { method: 'POST', body: JSON.stringify(body) })
  const first = await create(input)
  const retry = await create({ ...input, title: '响应丢失后的重试', initialScript: '不能覆盖已有内容' })
  assert.equal(first.status, 200)
  assert.equal(retry.status, 200)
  assert.equal(first.body.data.project.id, retry.body.data.project.id)
  assert.equal(retry.body.data.project.title, input.title)
  assert.equal(retry.body.data.project.episodes[0].script, input.initialScript)
  assert.equal((await api('/api/fixture/state')).body.projectCount, before + 1)
  const concurrent = await Promise.all([create(input), create(input)])
  assert.equal(concurrent[0].body.data.project.id, first.body.data.project.id)
  assert.equal(concurrent[1].body.data.project.id, first.body.data.project.id)
  assert.equal((await api('/api/fixture/state')).body.projectCount, before + 1)
  const separate = await create({ ...input, sourceHandoffId: 'creative-new-request' })
  assert.notEqual(separate.body.data.project.id, first.body.data.project.id)
  assert.equal((await api('/api/fixture/state')).body.projectCount, before + 2)
})

test('HTTP project create/save/read retains adopted URL, while stale and concurrent saves get 409', async () => {
  const created = await api('/api/drama/projects', { method: 'POST', body: JSON.stringify({ title: '契约回归项目' }) })
  assert.equal(created.status, 200)
  const project = created.body.data.project
  const url = `/api/drama/projects/${project.id}`
  project.episodes[0].shots = [{ ...helpers.newCreativeShot(1, { description: '晨光' }), id: 'http-shot' }]
  const scope = { projectId: project.id, episodeId: project.episodes[0].id, shotId: 'http-shot' }
  const adopted = helpers.adoptShotCandidate(project, scope.episodeId, scope.shotId, candidate(scope))
  const saved = await api(url, { method: 'PATCH', body: JSON.stringify(adopted) })
  assert.equal(saved.status, 200)
  assert.notEqual(saved.body.data.project.updatedAt, project.updatedAt)
  assert.equal((await api(url)).body.data.project.episodes[0].shots[0].storyboardImageUrl, '/api/generation-log-assets/new.png')
  assert.equal((await api(url, { method: 'PATCH', body: JSON.stringify({ ...project, title: '过期覆盖' }) })).status, 409)
  assert.equal((await api(url)).body.data.project.title, '契约回归项目')
  const baseline = saved.body.data.project
  const concurrent = await Promise.all(['A', 'B'].map((title) => api(url, { method: 'PATCH', body: JSON.stringify({ ...baseline, title }) })))
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 409])
  const current = (await api(url)).body.data.project
  assert.equal(current.title, concurrent.find((item) => item.status === 200).body.data.project.title)
  assert.equal((await api(url, { method: 'PATCH', body: JSON.stringify({ ...current, episodes: [] }) })).status, 400)
  assert.equal((await api(url)).body.data.project.updatedAt, current.updatedAt)
})

test('HTTP generation retries retain one task and zero charges; fixture render refuses false success', async () => {
  const input = { prompt: '本地测试', config: { model: 'fixture-image' }, context: { projectId: 'project-a' } }
  const options = { method: 'POST', headers: { 'x-vozeb-pro-client-request-id': 'stable-retry' }, body: JSON.stringify(input) }
  const first = await api('/api/image-tasks', options)
  const second = await api('/api/image-tasks', options)
  assert.equal(first.body.task.id, second.body.task.id)
  assert.equal((await api(`/api/image-tasks/${first.body.task.id}`)).body.task.status, 'running')
  const completed = await api(`/api/image-tasks/${first.body.task.id}`)
  assert.equal(completed.body.task.status, 'success')
  assert.equal(completed.body.task.pointsCost, 0)
  const image = await fetch(`${origin}${completed.body.task.result.remoteUrl}`)
  assert.equal(image.headers.get('content-type'), 'image/svg+xml')
  assert.match(await image.text(), /LOCAL CONTRACT FIXTURE/)
  assert.equal((await api('/api/fixture/state')).body.taskCount, 1)
  assert.equal((await api('/api/fixture/state')).body.chargedPoints, 0)
  assert.equal((await api('/api/drama/render', { method: 'POST', body: '{}' })).status, 503)
  assert.equal(await creativeApi.getRenderCapability(), false)
  assert.equal((await api('/api/drama/projects', { method: 'POST', headers: { origin: 'https://unrelated.invalid' }, body: '{}' })).status, 403)
})

test('real candidate API persists provenance, reads it on reload and rejects scope mismatches', async () => {
  const scope = { projectId: 'candidate-project', episodeId: 'candidate-episode', shotId: 'candidate-shot' }
  const input = { scope, media: { kind: 'image', url: '/api/generation-log-assets/fixture/result-a.svg', width: 960, height: 540 }, taskId: 'candidate-task', resultIndex: 0, title: '候选 A', prompt: '本地验收', model: 'fixture-image' }
  const registered = await creativeApi.registerShotCandidate(input)
  assert.equal(registered.url, input.media.url)
  assert.equal(registered.width, 960)
  const listed = await creativeApi.listShotCandidates(scope)
  assert.equal(listed.truncated, false)
  assert.equal(listed.candidates.length, 1)
  assert.equal(listed.candidates[0].key, registered.key)
  assert.equal((await creativeApi.registerShotCandidate(input)).id, registered.id, 'known output must reuse its registered candidate')
  const second = await creativeApi.registerShotCandidate({ ...input, resultIndex: 1, media: { ...input.media, url: '/api/generation-log-assets/fixture/result-b.svg' } })
  assert.notEqual(second.key, registered.key)
  assert.equal((await creativeApi.listShotCandidates(scope)).candidates.length, 2)
  assert.equal((await creativeApi.listShotCandidates({ ...scope, shotId: 'other-shot' })).candidates.length, 0)
  const raw = (await api('/api/library-assets?page=1&pageSize=100')).body.data.assets.find((asset) => asset.id === registered.id)
  assert.equal(raw.metadata.creativeCandidate.projectId, scope.projectId)
  assert.equal(raw.data.storageKey, 'fixture/result-a.svg')
  assert.equal(creativeApi.candidateFromLibraryAsset({ ...raw, metadata: { creativeCandidate: { ...raw.metadata.creativeCandidate, key: 'forged-key' } } }, scope), null)
  assert.equal(creativeApi.candidateFromLibraryAsset({ ...raw, kind: 'video' }, scope), null)
  await assert.rejects(() => creativeApi.registerShotCandidate({ ...input, media: { kind: 'image', url: 'https://upstream.invalid/unpersisted.png' } }))
})

test('preserving an older adopted URL cannot assign it the newest unadopted task identity', async () => {
  const project = projectFixture()
  project.id = 'preserve-project'
  const episodeId = project.episodes[0].id
  const shot = project.episodes[0].shots[0]
  const scope = { projectId: project.id, episodeId, shotId: shot.id }
  const oldUrl = '/api/generation-log-assets/fixture/old-adopted.svg'
  const newUrl = '/api/generation-log-assets/fixture/new-unadopted.svg'
  shot.storyboardImageUrl = oldUrl
  shot.storyboardTaskId = 'latest-unadopted-task'
  shot.storyboardStatus = 'success'
  const preserved = await creativeApi.registerAdoptedShotCandidate(project, episodeId, shot.id, 'image')
  assert.equal(preserved.url, oldUrl)
  assert.notEqual(preserved.taskId, 'latest-unadopted-task')
  const newer = await creativeApi.registerShotCandidate({ scope, media: { kind: 'image', url: newUrl }, taskId: 'latest-unadopted-task' })
  assert.equal(newer.url, newUrl)
  assert.notEqual(newer.key, preserved.key)
  assert.equal((await creativeApi.registerAdoptedShotCandidate(project, episodeId, shot.id, 'image')).id, preserved.id)
  const listed = await creativeApi.listShotCandidates(scope)
  assert.equal(listed.candidates.length, 2)
  assert.deepEqual(plain(listed.candidates).map((item) => item.url).sort(), [oldUrl, newUrl].sort())
})

test('candidate history scans beyond the first page and reports a truncated bounded read', async () => {
  const scope = { projectId: 'deep-project', episodeId: 'deep-episode', shotId: 'deep-shot' }
  for (let index = 0; index < 101; index += 1) {
    assert.equal((await api('/api/library-assets', { method: 'POST', body: JSON.stringify({ kind: 'text', title: `无关素材 ${index}`, data: { content: '分页回归' } }) })).status, 200)
  }
  const candidate = await creativeApi.registerShotCandidate({ scope, taskId: 'deep-task', media: { kind: 'image', url: '/api/generation-log-assets/fixture/deep.svg' } })
  const complete = await creativeApi.listShotCandidates(scope)
  assert.equal(complete.truncated, false)
  assert.equal(complete.candidates[0].id, candidate.id)
  const bounded = await creativeApi.listShotCandidates(scope, { maxPages: 1 })
  assert.equal(bounded.truncated, true)
  assert.equal(bounded.candidates.length, 0, 'first-page absence cannot be treated as exhaustive history')
})

test('account continuation guard prevents all requests initially and stops a library write after a delayed read', async () => {
  const scope = { projectId: 'guard-project', episodeId: 'guard-episode', shotId: 'guard-shot' }
  const input = { scope, taskId: 'guard-task', media: { kind: 'image', url: '/api/generation-log-assets/fixture/guard.svg' } }
  const before = (await api('/api/fixture/state')).body.requests.length
  await assert.rejects(() => creativeApi.registerShotCandidate({ ...input, shouldContinue: () => false }), (error) => error.name === 'AbortError')
  assert.equal((await api('/api/fixture/state')).body.requests.length, before, 'already-stale work must not reach even the read endpoint')

  let currentAccount = true
  let readReturned = false
  afterProductionFetch = (url, options) => {
    if (url.pathname === '/api/library-assets' && (!options?.method || options.method === 'GET')) {
      readReturned = true
      currentAccount = false // The account changed while the real HTTP read was in flight.
    }
  }
  try {
    await assert.rejects(() => creativeApi.registerShotCandidate({ ...input, shouldContinue: () => currentAccount }), (error) => error.name === 'AbortError')
  } finally { afterProductionFetch = null }
  assert.equal(readReturned, true)
  const issued = (await api('/api/fixture/state')).body.requests.slice(before)
  assert.equal(issued.length, 1)
  assert.equal(issued[0].method, 'GET')
  assert.equal(issued[0].path, '/api/library-assets')
  assert.equal(issued.filter((request) => request.method === 'POST').length, 0, 'no old-account candidate may be written after its read returns')
})
