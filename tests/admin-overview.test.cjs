const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { pathToFileURL } = require('node:url')

function modules(fetch) {
  const cache = new Map()
  function load(file) {
    const absolute = path.resolve(__dirname, '../lib/studio', file)
    if (cache.has(absolute)) return cache.get(absolute).exports
    const module = { exports: {} }
    cache.set(absolute, module)
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(source, { module, exports: module.exports, Error, Date, Intl, URL, URLSearchParams, Headers, Response, fetch,
      require: (name) => { assert.ok(name.startsWith('./'), `unexpected import: ${name}`); return load(`${name.slice(2)}.ts`) },
    }, { filename: absolute })
    return module.exports
  }
  return { overview: load('admin-overview.ts'), api: load('admin-api.ts') }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const plain = (data) => JSON.parse(JSON.stringify(data))
const analytics = { windowDays: 7, totalCalls: 100, successCalls: 85, failedCalls: 10, activeUsers: 12, dailyCalls: [{ date: '2026-10-14', label: '10/14', value: 17 }, { date: '2026-10-13', label: '10/13', value: 3 }], modelDistribution: [], kindDistribution: [], sourceDistribution: [] }
const generation = { items: [], total: 22, page: 1, pageSize: 5, summary: { total: 22, active: 14, success: 2, failed: 6, averageDurationMs: 2000, totalPointsCost: 220, byStatus: { pending: 3, running: 4, paused: 7 }, byType: {} }, channels: [], agentPerformance: {} }
const finance = { orders: { total: 16, pending: 4, paid: 8, closed: 2, canceled: 1, refunded: 1, grossAmountCents: 1234500, paidAmountCents: 765400, pendingAmountCents: 467900, refundedAmountCents: 1200 }, payments: {}, commerce: {}, providers: [], reconciliation: { paidOrdersWithoutSucceededPayment: 2, succeededPaymentsWithoutPaidOrder: 3, amountMismatchPayments: 0 } }
const channel = (patch = {}) => ({ id: 'channel-a', name: 'A', capability: 'image', logicalModelId: 'model-a', logicalModelName: 'A', upstreamModel: 'upstream', enabled: true, runtimeHealth: { status: 'cooling', consecutiveFailures: 2 }, ...patch })
function fetchFixture(calls, overrides = {}) {
  return async (input) => {
    const url = new URL(input, 'http://localhost')
    calls.push(url.pathname + url.search)
    if (overrides[url.pathname]) return overrides[url.pathname](url)
    if (url.pathname === '/api/admin/generation-overview') return json({ code: 0, data: analytics })
    if (url.pathname === '/api/admin/generation-operations') return json({ code: 0, data: generation })
    if (url.pathname === '/api/admin/billing/summary') return json({ summary: finance })
    if (url.pathname === '/api/admin/billing/orders') return json({ orders: [], total: 0, page: 1, pageSize: 5 })
    throw new Error(`unexpected request ${url.pathname}`)
  }
}

test('real API aggregation calls only endpoints allowed by each read permission', async () => {
  for (const [permissions, expected] of [
    [[], []],
    [['analytics.read'], ['/api/admin/generation-overview?windowDays=7']],
    [['generation.read'], ['/api/admin/generation-operations?page=1&pageSize=5']],
    [['billing.read'], ['/api/admin/billing/orders?page=1&pageSize=5', '/api/admin/billing/summary']],
    [['system.manage', 'upstream.manage', 'billing.manage'], []],
  ]) {
    const calls = []
    const { overview } = modules(fetchFixture(calls))
    const result = await overview.loadAdminOverview(permissions)
    assert.deepEqual(calls.sort(), expected.sort())
    assert.equal(result.analytics.status, permissions.includes('analytics.read') ? 'ready' : 'forbidden')
    assert.equal(result.generation.status, permissions.includes('generation.read') ? 'ready' : 'forbidden')
    assert.equal(result.finance.status, permissions.includes('billing.read') ? 'ready' : 'forbidden')
    assert.equal(result.orders.status, permissions.includes('billing.read') ? 'ready' : 'forbidden')
  }
})

test('one authorized endpoint failing leaves the other resources usable and cannot create zero finances', async () => {
  const calls = []
  const { overview } = modules(fetchFixture(calls, { '/api/admin/billing/summary': () => json({ error: '财务服务暂不可用' }, 503) }))
  const result = await overview.loadAdminOverview(['analytics.read', 'generation.read', 'billing.read'])
  assert.equal(result.analytics.status, 'ready')
  assert.equal(result.generation.status, 'ready')
  assert.equal(result.orders.status, 'ready')
  assert.equal(result.finance.status, 'error')
  assert.match(result.finance.error, /财务服务暂不可用/)
  assert.equal('data' in result.finance, false)
  assert.equal(overview.overviewAttention(result).some((item) => item.id === 'pending-orders'), false)
})

test('empty summary and a failed order list stay unavailable rather than showing no orders', async () => {
  const { overview } = modules(fetchFixture([], {
    '/api/admin/billing/summary': () => json({ summary: null }),
    '/api/admin/billing/orders': () => json({ error: '订单读取失败' }, 500),
  }))
  const result = await overview.loadAdminOverview(['billing.read'])
  assert.equal(result.finance.status, 'error')
  assert.equal(result.orders.status, 'error')
  assert.equal('data' in result.orders, false)
})

test('analytics success and today buckets use actual UTC+8 date, not the last bucket or default zeros', () => {
  const { overview } = modules(fetchFixture([]))
  const result = overview.generationOverviewMetrics(analytics, new Date('2026-10-13T16:30:00.000Z'))
  assert.equal(result.todayCalls, 17)
  assert.equal(result.successRate, 85)
  assert.equal(result.failureRate, 10)
  assert.equal(overview.generationOverviewMetrics(analytics, new Date('2026-10-15T01:00:00Z')).todayCalls, null)
  const empty = overview.generationOverviewMetrics({ ...analytics, totalCalls: 0, successCalls: 0, failedCalls: 0 }, new Date('2026-10-14T00:00:00Z'))
  assert.equal(empty.successRate, null)
  assert.equal(empty.failureRate, null)
})

test('attention counts separate paused from running, deduplicate channel bindings and include every reconciliation issue', async () => {
  const { overview } = modules(fetchFixture([], {
    '/api/admin/generation-operations': () => json({ code: 0, data: { ...generation, channels: [channel(), channel({ logicalModelId: 'model-b' }), channel({ id: 'disabled', enabled: false }), channel({ id: 'ok', runtimeHealth: { status: 'healthy', consecutiveFailures: 0 } })] } }),
  }))
  const snapshot = await overview.loadAdminOverview(['generation.read', 'billing.read'])
  const items = overview.overviewAttention(snapshot)
  assert.equal(items.find((item) => item.id === 'active').count, 7)
  assert.equal(items.find((item) => item.id === 'paused').count, 7)
  assert.equal(items.find((item) => item.id === 'channels').count, 1)
  assert.equal(items.find((item) => item.id === 'reconciliation').count, 5)
  assert.equal(items.find((item) => item.id === 'reconciliation').tone, 'danger')
  assert.equal(items.find((item) => item.id === 'pending-orders').count, 4)
  assert.ok(items.every((item) => ['/admin/generation', '/admin/orders'].includes(item.href)))
  assert.equal(items[0].tone, 'danger')
})

test('launch readiness has actual management permissions and sends the selected backend profile', async () => {
  const calls = []
  const { overview, api } = modules(async (input) => { calls.push(input); return json({ code: 0, data: { passed: true, errors: 0, warnings: 0, checkedAt: '2026-10-14T00:00:00Z', items: [] } }) })
  assert.equal(overview.adminOverviewAccess(['analytics.read']).readiness, false)
  assert.equal(overview.adminOverviewAccess(['billing.read']).readiness, false)
  for (const permission of ['system.manage', 'upstream.manage', 'billing.manage']) assert.equal(overview.adminOverviewAccess([permission]).readiness, true)
  await api.getLaunchReadiness('production')
  await api.getLaunchReadiness('paid_beta')
  await api.getLaunchReadiness()
  assert.deepEqual(calls, ['/api/admin/launch-readiness?profile=production', '/api/admin/launch-readiness?profile=paid_beta', '/api/admin/launch-readiness?profile=self_use'])
})

// Render the real overview content with small presentational boundaries. This checks
// values sent to KPI/table components and error visibility, without CSS snapshots.
function renderOverview(data, helpers) {
  const module = { exports: {} }
  const element = (name) => ({ children }) => React.createElement(name, null, children)
  const kit = new Proxy({
    AdminKpiStrip: ({ items }) => React.createElement('dl', null, items.map((item) => React.createElement('div', { key: item.label }, `${item.label} ${item.value} ${item.detail}`))),
    AdminError: ({ message }) => React.createElement('p', { role: 'alert' }, message),
    AdminEmpty: ({ title, description }) => React.createElement('p', null, `${title} ${description}`),
    TableMessageRow: ({ empty }) => React.createElement('tr', null, React.createElement('td', null, empty)),
    formatAdminMoney: (value) => `¥${(value / 100).toFixed(2)}`,
    formatAdminNumber: (value) => String(Number(value) || 0),
    formatAdminDate: (value) => String(value),
    formatAdminDuration: (value) => String(value),
    labelOf: (_, value) => value, statusTone: () => 'neutral',
  }, { get: (target, key) => target[key] || element('div') })
  const file = path.resolve(__dirname, '../components/studio/admin-overview.tsx')
  const source = fs.readFileSync(file, 'utf8') + '\nmodule.exports.testRenderOverview = OverviewData;'
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInNewContext(compiled, { module, exports: module.exports, Date,
    require: (name) => {
      if (name === '@/lib/studio/admin-overview') return helpers
      if (name === './admin-kit') return kit
      if (name === './ui') return { StatusBadge: element('span') }
      if (name === './admin-shell' || name === '@/lib/studio/admin-api') return {}
      if (name === '@/lib/utils') return { cn: (...parts) => parts.filter(Boolean).join(' ') }
      if (name === 'next/link') return { __esModule: true, default: ({ href, children }) => React.createElement('a', { href }, children) }
      return require(name)
    },
  }, { filename: file })
  return renderToStaticMarkup(React.createElement(module.exports.testRenderOverview, { data, retry: () => {} }))
}

test('actual overview displays cumulative paid amount and preserves failed order messaging', async () => {
  const { overview } = modules(fetchFixture([], { '/api/admin/billing/orders': () => json({ error: '请稍后重试订单' }, 503) }))
  const snapshot = await overview.loadAdminOverview(['billing.read'])
  const html = renderOverview(plain(snapshot), overview)
  assert.match(html, /累计已支付订单金额 ¥7654\.00/)
  assert.match(html, /最近订单暂不可用/)
  assert.doesNotMatch(html, /今日收入|暂无订单|实时数据/)
})

test('real helpers read the isolated admin HTTP fixture with scoped requests and partial availability', async () => {
  const { createAdminFixture } = await import(pathToFileURL(path.join(__dirname, 'admin-fixture-server.mjs')).href)
  const fixture = createAdminFixture({ permissions: ['analytics.read', 'billing.read'], fail: ['/api/admin/billing/orders'], delayMs: 0 })
  const origin = await fixture.listen(0)
  try {
    const { overview } = modules((url, options) => fetch(new URL(url, origin), options))
    const result = await overview.loadAdminOverview(['analytics.read', 'billing.read'])
    assert.equal(result.analytics.status, 'ready')
    assert.equal(result.finance.status, 'ready')
    assert.equal(result.orders.status, 'error')
    assert.equal(result.generation.status, 'forbidden')
    assert.equal(result.finance.data.orders.paidAmountCents, 2000)
    const state = await (await fetch(`${origin}/__fixture`)).json()
    assert.equal(state.counts['GET /api/admin/generation-overview'], 1)
    assert.equal(state.counts['GET /api/admin/billing/summary'], 1)
    assert.equal(state.counts['GET /api/admin/billing/orders'], 1)
    assert.equal(state.counts['GET /api/admin/generation-operations'], undefined)
    assert.deepEqual(state.changedFields, [])
  } finally { await fixture.close() }
})
