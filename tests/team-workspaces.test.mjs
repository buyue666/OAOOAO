import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(path, imports = {}, append = '') {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8') + append
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(id => { assert.ok(id in imports, 'Unexpected dependency: ' + id); return imports[id] }, module, module.exports)
  return module.exports
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
const all = node => node && typeof node === 'object' ? [node, ...[node.props?.children, node.props?.footer].flat(Infinity).flatMap(all)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const controls = new Proxy({}, { has: () => true, get: (_, key) => String(key) })
const teamHelpers = load('lib/studio/team-types.ts')
const modelHelpers = load('lib/studio/studio-models.ts')
const generationHelpers = load('lib/studio/team-generation.ts', { './studio-models': modelHelpers })
const pricingHelpers = load('lib/studio/team-admin.ts')
const videoHelpers = load('lib/studio/video-policy.ts')
function hooks() {
  const states = [], refs = [], effects = []
  let s = 0, r = 0, e = 0, queued = []
  return {
    react: {
      useState(initial) { const index = s++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
      useRef(value) { return refs[r++] ??= { current: value } },
      useCallback: fn => fn,
      useEffect(fn, deps) { const index = e++; if (!effects[index] || deps.some((dep, i) => dep !== effects[index][i])) { effects[index] = deps; queued.push(fn) } },
    },
    render(fn) { s = r = e = 0; const tree = fn(); const pending = queued; queued = []; pending.forEach(fn => fn()); return tree },
  }
}
const team = { id: '11111111-1111-4111-8111-111111111111', name: '测试团队', role: 'owner', modelIds: [], subscriptionExpiresAt: new Date(Date.now() + 86400000).toISOString(), canDownload: true }
const project = { id: '22222222-2222-4222-8222-222222222222', title: '测试项目' }
const caps = { ratios: ['1:1', '16:9'], resolutions: ['1K', '2K'], qualities: ['720p', '1080p'], durations: ['4 秒', '6 秒'], maxBatchSize: 2 }
function formFixture(options = {}) {
  const h = hooks(), writes = [], storage = options.storage || new Map()
  globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const modelList = ['image', 'video', 'audio', 'text'].map(kind => ({ id: kind, name: kind, capability: kind, status: '可用', capabilities: caps }))
  let id = 0, calls = 0
  const module = load('components/studio/team-project-generation.tsx', {
    react: h.react, 'react/jsx-runtime': jsx, swr: { useSWRConfig: () => ({ mutate: async () => {} }) }, 'lucide-react': controls,
    ...Object.fromEntries(['alert', 'button', 'card', 'field', 'input', 'textarea'].map(name => ['@/components/ui/' + name, controls])),
    '@/lib/studio/api': { request: async (path, init) => { const write = { path, body: JSON.parse(init.body), headers: init.headers }; writes.push(write); if (options.wait) await options.wait; if (!path.endsWith('/quote') && ++calls <= (options.failures || 0)) throw Object.assign(new Error('Synthetic connection failure'), { status: options.status || 0 }); return path.endsWith('/quote') ? { points: 2.0001 } : { task: { id: 'server-task' } } } },
    '@/lib/studio/generation-api': { newClientRequestId: () => `synthetic-request-${++id}`, normalizeTaskResult: () => ({ media: [] }) },
    '@/lib/studio/store': { useStudio: () => ({ state: { user: { id: 'actor' }, liveModels: modelList, sessionSettings: {} } }) },
    '@/lib/studio/team-generation': generationHelpers, '@/lib/studio/video-policy': videoHelpers,
    '@/lib/studio/team-api': {}, '@/lib/studio/team-types': teamHelpers, './team-feedback': controls,
  }, '\nexport { TeamGenerationForm };')
  const render = () => h.render(() => module.TeamGenerationForm({ team, project, references: [], onReferencesChange() {} }))
  return { render, writes, storage, set(id, value) { all(render()).find(node => node.props?.id === id).props.onChange({ target: { value } }) }, submit: () => all(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) }
}

test('dynamic team routes await their parameters and render the real workspace entries', async () => {
  for (const [path, name, params] of [
    ['app/teams/[teamId]/page.tsx', 'TeamWorkspace', { teamId: team.id }],
    ['app/teams/[teamId]/projects/[projectId]/page.tsx', 'TeamProjectWorkspace', { teamId: team.id, projectId: project.id }],
  ]) {
    const page = load(path, { react: { Suspense: 'Suspense' }, 'react/jsx-runtime': jsx, '@/components/studio/team-workspace': controls, '@/components/studio/team-project-workspace': controls, '@/components/studio/team-feedback': controls })
    const result = await page.default({ params: Promise.resolve(params) })
    assert.equal(result.props.children.type, name); assert.deepEqual(result.props.children.props, params)
    assert.equal(page.metadata.robots.index, false)
  }
})

test('account workspace options expose the selected space and close the account menu on selection', () => {
  let closed = 0, requested
  const module = load('components/studio/workspace-switcher.tsx', { 'react/jsx-runtime': jsx, 'next/link': { default: 'Link' }, 'next/navigation': { usePathname: () => `/teams/${team.id}/projects/${project.id}` }, 'lucide-react': controls, '@/lib/studio/team-types': teamHelpers, '@/lib/studio/team-api': { teamIdFromPath: () => team.id, useTeamQuery: path => { requested = path; return { data: { teams: [team] } } } } })
  const tree = module.WorkspaceSwitcher({ active: true, onSelect: () => closed++ })
  assert.equal(tree.props.role, 'group')
  const options = all(tree).filter(node => node.props?.role === 'menuitemradio')
  assert.deepEqual(options.map(node => [node.props.href, node.props['aria-checked']]), [['/studio', false], [`/teams/${team.id}`, true]])
  options[0].props.onClick(); assert.equal(closed, 1)
  module.WorkspaceSwitcher({ active: false }); assert.equal(requested, null, 'A closed account popup does not fetch teams')
})

test('team model restrictions include allowed request aliases and reject disabled or unrelated models', () => {
  const models = [{ id: 'image-a', status: '可用' }, { id: 'alias-a', status: '可用' }, { id: 'image-b', status: '可用' }, { id: 'image-a-off', status: '维护中' }]
  const settings = { logicalModels: [{ id: 'image-a', bindings: [{ requestAlias: 'alias-a', enabled: true }] }] }
  assert.deepEqual(generationHelpers.availableTeamModels(models, ['image-a'], settings).map(model => model.id), ['image-a', 'alias-a'])
  assert.equal(generationHelpers.availableTeamModels(models, [], settings).length, 3)
})

test('the header shows the team wallet and a direct usage link, including explicit unavailable state', () => {
  let response = { data: { balance: 5000 } }, requested
  const module = load('components/studio/workspace-switcher.tsx', { 'react/jsx-runtime': jsx, 'next/link': { default: 'Link' }, 'next/navigation': {}, 'lucide-react': controls, '@/lib/studio/team-types': teamHelpers, '@/lib/studio/team-api': { teamIdFromPath: () => team.id, useTeamQuery: path => { requested = path; return response } } })
  const node = module.WorkspaceCredits({ pathname: `/teams/${team.id}` })
  assert.equal(requested, `/api/teams/${team.id}/usage`); assert.equal(node.props.href, `/teams/${team.id}?tab=usage`); assert.match(text(node), /团队 5,000 积分/)
  response = { error: new Error('Unavailable') }
  assert.match(text(module.WorkspaceCredits({ pathname: `/teams/${team.id}` })), /团队积分暂不可用/)
})

test('team details expose management tabs by current role and do not mount private panels after access failure', () => {
  let role = 'owner', unavailable = false
  const imports = { 'react/jsx-runtime': jsx, 'next/link': { default: 'Link' }, 'next/navigation': { useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams('tab=members') }, 'lucide-react': controls, '@/components/ui/badge': controls, '@/components/ui/tabs': controls,
    '@/lib/studio/team-api': { useTeamQuery: () => ({ data: unavailable ? undefined : { team: { ...team, role } }, connected: true, error: unavailable ? new Error('Revoked') : undefined }) },
    '@/lib/studio/store': {}, '@/lib/studio/team-types': teamHelpers, ...Object.fromEntries(['team-feedback', 'team-projects', 'team-members', 'team-settings', 'team-usage', 'team-events'].map(name => ['./' + name, controls])),
  }
  const module = load('components/studio/team-workspace.tsx', imports, '\nexport { TeamWorkspaceContent };')
  assert.ok(all(module.TeamWorkspaceContent({ teamId: team.id })).some(node => node.type === 'TeamMembers'))
  role = 'reviewer'
  const readOnly = module.TeamWorkspaceContent({ teamId: team.id })
  assert.ok(!all(readOnly).some(node => ['TeamMembers', 'TeamEvents'].includes(node.type)))
  assert.equal(all(readOnly).find(node => node.type === 'Tabs').props.value, 'projects')
  unavailable = true
  assert.ok(!all(module.TeamWorkspaceContent({ teamId: team.id })).some(node => ['TeamProjects', 'TeamMembers', 'TeamUsagePanel'].includes(node.type)))
})

test('the team admin module separates plan editors from billing operators', () => {
  for (const [permission, expected] of [['commerce.manage', 'plans'], ['billing.manage', 'teams']]) {
    const h = hooks()
    const module = load('components/studio/admin-team-plans.tsx', { react: h.react, 'react/jsx-runtime': jsx, swr: {}, 'lucide-react': controls, '@/lib/studio/api': {}, '@/components/membership/team-plan-card': controls, '@/components/membership/membership.module.css': {}, './plan-model-control': controls, './plan-tone-picker': controls, '@/lib/studio/store': {}, '@/lib/studio/generation-api': {}, '@/lib/studio/team-admin': pricingHelpers, '@/lib/studio/team-generation': generationHelpers, '@/lib/studio/team-types': teamHelpers, './ui': controls, './admin-kit': controls, './admin-shell': { useAdminSession: () => ({ can: value => value === permission }) } })
    const tree = h.render(() => module.AdminTeamPlansPanel())
    const tabs = all(tree).find(node => node.type === 'AdminTabs')
    assert.deepEqual(tabs.props.items.map(item => item[0]), [expected]); assert.equal(tabs.props.value, expected)
  }
})

test('team generation requires a separate quote and approval; the submitted cost and id are server-quote based', async () => {
  const f = formFixture(); f.set('team-generation-model', 'image'); f.set('team-generation-prompt', '本地隔离测试')
  await f.submit(); assert.equal(f.writes.length, 1); assert.ok(f.writes[0].path.endsWith('/quote'))
  await f.submit(); assert.equal(f.writes.length, 2); assert.equal(f.writes[1].body.approvedCost, 2.0001); assert.match(f.writes[1].headers['idempotency-key'], /^synthetic-request-/)
  assert.equal(f.storage.size, 0)
})

test('changing input invalidates the old quote; configured video resolution and dragged duration reach the request', async () => {
  const f = formFixture(); f.set('team-generation-kind', 'video'); f.set('team-generation-model', 'video'); f.set('team-generation-prompt', 'A')
  f.set('team-generation-resolution', '1080p'); f.set('team-generation-seconds', '1'); await f.submit()
  assert.equal(f.writes[0].body.config.vquality, '1080p'); assert.equal(f.writes[0].body.config.videoSeconds, 6)
  f.set('team-generation-prompt', 'B'); await f.submit()
  assert.ok(f.writes[1].path.endsWith('/quote')); assert.equal(f.writes[1].body.prompt, 'B')
})

test('a fast double click cannot send two quote or generation requests', async () => {
  let release; const wait = new Promise(resolve => { release = resolve })
  const f = formFixture({ wait }); f.set('team-generation-model', 'image'); f.set('team-generation-prompt', 'A')
  const first = f.submit(); await f.submit(); assert.equal(f.writes.length, 1); release(); await first
  await Promise.all([f.submit(), f.submit()]); assert.equal(f.writes.length, 2)
})

test('unknown submissions survive remounts and retry exactly the same approved request', async () => {
  const f = formFixture({ failures: 1 }); f.set('team-generation-model', 'image'); f.set('team-generation-prompt', 'Original prompt')
  await f.submit(); await f.submit(); assert.equal(f.storage.size, 1)
  const original = f.writes[1]
  const restored = formFixture({ storage: f.storage }); restored.render(); await restored.submit()
  assert.deepEqual(restored.writes[0].body, original.body); assert.deepEqual(restored.writes[0].headers, original.headers)
  assert.equal(restored.storage.size, 0)
})

test('a definitive server rejection clears the pending operation without claiming success', async () => {
  const f = formFixture({ failures: 1, status: 402 }); f.set('team-generation-model', 'image'); f.set('team-generation-prompt', 'A')
  await f.submit(); await f.submit(); assert.equal(f.storage.size, 0)
  assert.ok(all(f.render()).some(node => node.type === 'TeamError' && node.props.error))
  assert.ok(!text(f.render()).includes('任务已提交'))
})

test('invalid recovery records cannot become a new paid operation', () => {
  for (const raw of [null, '{', '{}', JSON.stringify({ requestId: 'synthetic-request', points: -1, payload: {} }), JSON.stringify({ requestId: 'synthetic-request', points: 1, payload: { kind: 'render' } })]) assert.equal(generationHelpers.readPendingTeamGeneration(raw), null)
})

test('team plan money is exact in cents and invalid prices/capacity never become a save payload', () => {
  assert.equal(pricingHelpers.teamPlanPriceCents('0.29'), 29); assert.equal(pricingHelpers.teamPlanPriceCents('9.99'), 999); assert.equal(pricingHelpers.teamPlanPriceCents(''), null)
  for (const price of ['0', '-1', '1e3', '0.001', '1000000.01', 'NaN']) assert.throws(() => pricingHelpers.teamPlanPriceCents(price))
  assert.equal(pricingHelpers.teamPlanStorageBytes('1.5'), 1610612736)
  for (const capacity of ['', '-1', 'Infinity', '1048577']) assert.throws(() => pricingHelpers.teamPlanStorageBytes(capacity))
})
