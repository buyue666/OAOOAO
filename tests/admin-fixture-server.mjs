/**
 * Isolated admin HTTP contract fixture. Run: node tests/admin-fixture-server.mjs
 * Local frontend: OAOAO_BACKEND_URL=http://127.0.0.1:3463
 *
 * Memory only; no outbound calls, database, provider, email or payment access.
 * All identities, metrics and orders below are explicitly local sample data.
 * This verifies frontend contracts and states, not backend business guarantees.
 * Response envelopes/permissions follow the transferred backend admin routes,
 * admin-types.ts and admin-api.ts. In particular readiness requires a management
 * permission, and the backend generation overview currently uses a fixed window.
 *
 * ADMIN_FIXTURE_PORT: defaults to 3463.
 * ADMIN_FIXTURE_PERMISSIONS: comma-separated exact permissions (default: all).
 * ADMIN_FIXTURE_FAIL: comma-separated paths or METHOD:path to return HTTP 503.
 * ADMIN_FIXTURE_DELAY_MS: delay all API responses for loading-state checks.
 * GET /__fixture (or /api/fixture/admin-state) returns counters and safe state.
 * POST /__fixture with {permissions:[...],fail:[...],delayMs:0} switches scenarios
 * without a restart; it is a loopback-only fixture control, never a product API.
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const ALL_PERMISSIONS = ['analytics.read', 'users.read', 'users.manage', 'administrators.manage', 'generation.read', 'generation.manage', 'upstream.manage', 'commerce.manage', 'billing.read', 'billing.manage', 'system.manage', 'content.manage', 'audit.read']
const FIELD_PERMISSION = {
  site: 'system.manage', registrationEnabled: 'system.manage', registrationPolicy: 'system.manage', emailRegistrationEnabled: 'system.manage', mail: 'system.manage', dataLifecycle: 'system.manage', mediaPolicy: 'system.manage',
  operationMode: 'billing.manage', commercePolicy: 'billing.manage', freeDailyPointsEnabled: 'billing.manage', freeDailyPoints: 'billing.manage', modelPointCosts: 'billing.manage', modelPricing: 'billing.manage', generationPointMultipliers: 'billing.manage', entitlements: 'billing.manage',
  generationCostControl: 'upstream.manage', generationConcurrency: 'upstream.manage', generationDefaults: 'upstream.manage', systemChannels: 'upstream.manage', logicalModels: 'upstream.manage', defaultModels: 'upstream.manage', agentSkills: 'upstream.manage',
}
const clone = (value) => JSON.parse(JSON.stringify(value))
const json = (body, status = 200) => ({ status, body })
const ok = (data, msg = 'OK') => json({ code: 0, data, msg })
const fail = (status, error) => json({ code: status, data: null, msg: error, error }, status)
const csv = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isLoopback = (hostname) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)

function pageOf(items, params) {
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(params.get('pageSize')) || 20)))
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}

function initialSettings() {
  return {
    site: { title: 'OAOOAO · 本地验收', logoUrl: '/media/brand/oao-logo-transparent.png', iconUrl: '/media/brand/oao-mark.png', seoTitle: '隔离后台验收', seoDescription: '仅用于本地浏览器验收的内存样本。', seoKeywords: '', footerCopyright: '本地验收样本', termsUrl: '/terms', termsVersion: 'fixture-v1', termsContent: '本地验收样本条款，不适用于商业交易。', privacyUrl: '/privacy', privacyVersion: 'fixture-v1', privacyContent: '本地验收仅保存进程内样本，重启清空。', heroVideoUrl: '', friendLinks: [], socials: {}, announcementBar: { enabled: false, text: '隔离验收环境', href: '', tone: 'info', dismissible: true } },
    operationMode: 'self_use', registrationEnabled: true, emailRegistrationEnabled: false, freeDailyPointsEnabled: false, freeDailyPoints: 0,
    commercePolicy: { version: 'fixture-v1', status: 'draft', refundPolicy: '本地样本，不提供支付。', pointsExpiryPolicy: '本地样本，不发生积分交易。', renewalPolicy: '无自动续费。', invoicePolicy: '本地样本，不提供发票。', supportEmail: 'fixture@example.invalid', supportUrl: '' },
    mail: { provider: 'smtp', host: '', port: 587, secure: false, username: '', password: '', fromEmail: '', fromName: 'OAOOAO · 本地验收' },
    modelPointCosts: { 'fixture-image': 1, 'fixture-video': 5 }, generationPointMultipliers: { imageQuality: { standard: 1 }, videoQuality: { standard: 1 }, videoSeconds: { 5: 1, 10: 2 } },
    generationCostControl: { maxPointsPerTask: 100, dailyUserPointSpend: 1000, dailyTotalPointSpend: 10000 },
    dataLifecycle: { cleanupExpiredSessions: true, cleanupExpiredEmailCodes: true, cleanupExpiredGenerationTasks: false, cleanupExpiredTemporaryMedia: true, maintenanceBatchSize: 100 },
    entitlements: { enabled: false, defaultPlanId: 'fixture-free', plans: [{ id: 'fixture-free', name: '本地验收样本', enabled: true, dailyPoints: 0, limits: { dailyPointSpend: 0, dailyApiCalls: 0, dailyImages: 0, dailyVideos: 0, dailyAudio: 0, dailyText: 0 }, features: [] }] },
    generationConcurrency: { agent: 2, image: 4, video: 2, audio: 1, text: 4, render: 1 },
    generationDefaults: { canvasImageCount: 1, imageSize: '1:1', imageQuality: 'standard', imageCount: 1, videoQuality: 'standard', videoSeconds: 5, audioVoice: 'alloy', audioFormat: 'mp3' },
    systemChannels: [{ id: 'fixture-local', name: '隔离样本渠道', baseUrl: 'https://provider.example.invalid', apiFormat: 'openai', enabled: true, hasApiKey: false, models: ['fixture-image', 'fixture-video'] }],
    logicalModels: ['image', 'video'].map((capability) => ({ id: `fixture-${capability}`, name: `本地样本${capability === 'image' ? '图片' : '视频'}`, capability, enabled: true, bindings: [{ id: `fixture-${capability}-binding`, channelId: 'fixture-local', upstreamModel: `fixture-${capability}`, enabled: true, priority: 1 }] })),
    defaultModels: { textModel: '', imageModel: 'fixture-image', videoModel: 'fixture-video', audioModel: '' },
  }
}

export function createAdminFixture(options = {}) {
  let permissions = options.permissions ?? (process.env.ADMIN_FIXTURE_PERMISSIONS === undefined ? [...ALL_PERMISSIONS] : csv(process.env.ADMIN_FIXTURE_PERMISSIONS))
  let failures = new Set(options.fail ?? csv(process.env.ADMIN_FIXTURE_FAIL))
  let delayMs = Math.max(0, Number(options.delayMs ?? process.env.ADMIN_FIXTURE_DELAY_MS) || 0)
  let authenticated = true
  let settings = initialSettings()
  let storage = { enabled: false, endpoint: '', region: 'us-east-1', bucket: '', prefix: 'fixture/', forcePathStyle: false, hasAccessKeyId: false, hasSecretAccessKey: false, updatedAt: new Date().toISOString() }
  const requests = []
  const counts = {}
  const changedFields = []
  const now = Date.now()
  const user = () => ({ id: 'fixture-admin', accountId: 'FIXTURE-ADMIN', username: 'fixture-admin', displayName: '本地验收管理员', role: 'admin', status: 'active', adminPermissions: [...permissions], pointsBalance: 0, permanentPointsBalance: 0, dailyPointsBalance: 0, planName: '隔离样本 · 不扣费' })
  const can = (permission) => permissions.includes(permission)
  const canAny = (required) => required.some(can)
  const denied = () => fail(403, '当前本地验收管理员没有此职责权限')
  const tasks = ['success', 'success', 'error', 'running', 'pending'].map((status, index) => ({ id: `fixture-task-${index + 1}`, userId: 'fixture-creator', accountId: 'FIXTURE-CREATOR', username: 'fixture-creator', displayName: '本地样本创作者', type: index % 2 ? 'video' : 'image', status, surface: index % 2 ? 'drama' : 'canvas', model: index % 2 ? 'fixture-video' : 'fixture-image', channelId: 'fixture-local', executionPhase: status === 'running' ? 'polling' : status === 'pending' ? 'created' : 'completed', leaseExpired: false, prompt: `隔离样本任务 ${index + 1}，无真实生成`, ...(status === 'error' ? { error: '本地模拟的上游失败，用于状态验收' } : {}), durationMs: status === 'pending' ? 0 : 1500 + index * 250, pointsCost: 0, createdAt: now - (index + 1) * 3600000, updatedAt: now - index * 60000, canCancel: false, canReview: false }))
  const orders = ['paid', 'pending', 'refunded', 'paid', 'closed'].map((status, index) => ({ id: `fixture-order-${index + 1}`, orderNo: `LOCAL-SAMPLE-${index + 1}`, productId: 'fixture-points', userId: 'fixture-creator', userUsername: '本地样本用户', productKind: 'points', status, subject: '本地样本积分包（不交易）', listAmountCents: 1000, promotionDiscountCents: 0, couponDiscountCents: 0, amountCents: 1000, currency: 'CNY', pointsAmount: 100, dailyPoints: 0, periodDays: 0, quantity: 1, provider: 'manual', createdAt: new Date(now - index * 3600000).toISOString(), ...(status === 'paid' ? { paidAt: new Date(now - index * 3600000 + 60000).toISOString() } : {}) }))
  let paymentConfig = { origin: 'http://127.0.0.1:3463', readyProviders: 0, generatedAt: new Date(now).toISOString(), providers: [{ id: 'epay', name: '易支付（本地样本）', description: '只验证配置表单，不连接支付服务。', checkoutKind: 'redirect', checkoutReady: false, webhookReady: false, ready: false, enabled: false, sourceLabel: '本地内存样本', webhookPath: '/api/billing/webhooks/epay', fields: [{ key: 'gatewayUrl', label: '网关地址', kind: 'url', required: true, configured: false, value: '', placeholder: 'https://pay.example.invalid' }, { key: 'merchantId', label: '商户 ID', kind: 'text', required: true, configured: false, value: '' }, { key: 'merchantKey', label: '商户密钥', kind: 'secret', secret: true, required: true, configured: false }], checkoutRequirements: [{ label: '隔离环境不支持下单', configured: false }], webhookRequirements: [{ label: '隔离环境不处理支付回调', configured: false }] }] }

  function publicSettings() {
    const { site, operationMode, modelPointCosts, generationPointMultipliers, generationConcurrency, generationDefaults, defaultModels, logicalModels } = settings
    return clone({ site, operationMode, modelPointCosts, generationPointMultipliers, generationConcurrency, generationDefaults, defaultModels, logicalModels, systemChannels: settings.systemChannels.map(({ apiKey, ...channel }) => channel) })
  }
  function safeSettings() {
    return clone({ ...settings, mail: { ...settings.mail, password: '' }, systemChannels: settings.systemChannels.map(({ apiKey, ...channel }) => ({ ...channel, hasApiKey: Boolean(apiKey || channel.hasApiKey) })) })
  }
  function readiness() {
    const items = [
      { id: 'first-admin', title: '管理员账号', level: 'ok', detail: '本地验收管理员已启用。' },
      { id: 'channels', title: '生成渠道', level: 'warning', detail: '隔离环境仅展示样本渠道，不连接上游。', action: '检查模型与渠道设置入口。' },
      { id: 'commerce-policy', title: '正式协议与购买政策', level: settings.commercePolicy.status === 'published' ? 'ok' : 'error', detail: settings.commercePolicy.status === 'published' ? '本地样本购买政策已发布。' : '本地样本购买政策尚未发布。', action: '到运营与支付查看购买政策。' },
      { id: 'mail', title: '邮件服务', level: 'warning', detail: '隔离环境不发送邮件。', action: '打开邮件服务配置。' },
      { id: 'object-storage', title: '对象存储', level: 'warning', detail: '隔离环境不连接外部存储。', action: '打开对象存储设置。' },
    ]
    const errors = items.filter((item) => item.level === 'error').length
    return { passed: errors === 0, errors, warnings: items.filter((item) => item.level === 'warning').length, checkedAt: new Date().toISOString(), items }
  }

  async function route(req, url, body) {
    const path = url.pathname
    const method = req.method || 'GET'
    if (path === '/__fixture' || path === '/api/fixture/admin-state') {
      if (method === 'POST') {
        if (Array.isArray(body.permissions)) permissions = body.permissions.filter((value) => ALL_PERMISSIONS.includes(value))
        if (Array.isArray(body.fail)) failures = new Set(body.fail.filter((value) => typeof value === 'string'))
        if (Number.isFinite(body.delayMs)) delayMs = Math.min(10000, Math.max(0, body.delayMs))
      }
      return json({ fixture: 'admin-local-memory-only', permissions, fail: [...failures], delayMs, counts, requests, changedFields, settings: safeSettings() })
    }
    const key = `${method} ${path}`
    counts[key] = (counts[key] || 0) + 1
    requests.push({ method, path, query: url.search, fields: Object.keys(body), at: new Date().toISOString() })
    if (requests.length > 1000) requests.shift()
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (failures.has(path) || failures.has(`${method}:${path}`)) return fail(503, `本地隔离验收：模拟接口暂时不可用 ${path}`)
    if (path === '/api/health/live') return json({ status: 'ok', fixture: true })
    if (path === '/api/auth/session' && method === 'GET') return json({ user: authenticated ? user() : null, settings: publicSettings(), install: { ready: true } })
    if (path === '/api/auth/login' && method === 'POST') { authenticated = true; return json({ success: true, user: user() }) }
    if (path === '/api/auth/logout' && method === 'POST') { authenticated = false; return json({ success: true }) }
    if (!authenticated) return fail(401, '请登录本地验收账号')
    if (path === '/api/admin/settings') {
      if (!permissions.length) return denied()
      if (method === 'GET') return json({ settings: safeSettings() })
      if (method === 'PATCH') {
        const fields = Object.keys(body)
        if (!fields.length || fields.some((field) => !FIELD_PERMISSION[field])) return fail(400, '没有可更新的设置字段')
        if (!fields.every((field) => can(FIELD_PERMISSION[field]))) return denied()
        if (body.site !== undefined && !isObject(body.site)) return fail(400, '站点设置必须是对象')
        for (const [field, value] of Object.entries(body)) {
          settings[field] = isObject(value) && isObject(settings[field]) ? { ...settings[field], ...clone(value) } : clone(value)
        }
        changedFields.push({ fields, at: new Date().toISOString() })
        return json({ settings: safeSettings() })
      }
    }
    if (path === '/api/admin/generation-overview' && method === 'GET') {
      if (!can('analytics.read')) return denied()
      const dailyCalls = [1, 0, 2, 1, 0, 1, 0].map((value, index) => { const date = new Date(now - (6 - index) * 86400000).toISOString().slice(0, 10); return { date, label: date.slice(5), value } })
      return ok({ windowDays: 7, totalCalls: 5, successCalls: 2, failedCalls: 1, activeUsers: 1, successRate: 40, dailyCalls, modelDistribution: [{ label: 'fixture-image', value: 3, percent: 60 }, { label: 'fixture-video', value: 2, percent: 40 }], sourceDistribution: [{ label: '画布（样本）', value: 3, percent: 60 }, { label: '项目（样本）', value: 2, percent: 40 }], kindDistribution: [{ label: 'image', value: 3, percent: 60 }, { label: 'video', value: 2, percent: 40 }] })
    }
    if (path === '/api/admin/generation-operations' && method === 'GET') {
      if (!can('generation.read')) return denied()
      const filtered = tasks.filter((task) => ['status', 'type', 'surface', 'userId'].every((field) => !url.searchParams.get(field) || task[field] === url.searchParams.get(field)) && (!url.searchParams.get('search') || `${task.id} ${task.username} ${task.prompt}`.includes(url.searchParams.get('search'))))
      return ok({ ...pageOf(filtered, url.searchParams), summary: { total: 5, active: 2, success: 2, failed: 1, averageDurationMs: 1900, totalPointsCost: 0, byType: { image: 3, video: 2 }, byStatus: { success: 2, error: 1, running: 1, pending: 1, paused: 0 } }, channels: [{ id: 'fixture-local', name: '本地样本渠道', capability: 'image', logicalModelId: 'fixture-image', logicalModelName: '本地样本图片', upstreamModel: 'fixture-image', enabled: true, runtimeHealth: { status: 'cooling', consecutiveFailures: 1, lastError: '隔离样本错误，不代表生产服务' }, planningRuntime: { successCount: 2, failureCount: 1, averageLatencyMs: 1900 } }], agentPerformance: { sampleSize: 0, planningP50Ms: 0, planningP95Ms: 0, firstResultP50Ms: 0, firstResultP95Ms: 0, queueAverageMs: 0, upstreamAverageMs: 0, reviewAverageMs: 0 } })
    }
    if (path === '/api/admin/billing/summary' && method === 'GET') {
      if (!can('billing.read')) return denied()
      return json({ summary: { orders: { total: 5, pending: 1, paid: 2, closed: 1, canceled: 0, refunded: 1, grossAmountCents: 5000, paidAmountCents: 2000, pendingAmountCents: 1000, refundedAmountCents: 1000 }, payments: { succeeded: 3, refunded: 1, succeededAmountCents: 3000, refundedAmountCents: 1000 }, commerce: { convertedOrders: 3, promotionOrders: 0, promotionConvertedOrders: 0, promotionDiscountCents: 0, couponOrders: 0, couponConvertedOrders: 0, couponDiscountCents: 0 }, providers: [{ provider: 'manual', totalOrders: 5, pendingOrders: 1, paidOrders: 2, refundedOrders: 1, paidAmountCents: 2000, refundedAmountCents: 1000 }], reconciliation: { paidOrdersWithoutSucceededPayment: 1, succeededPaymentsWithoutPaidOrder: 0, amountMismatchPayments: 0 } } })
    }
    if (path === '/api/admin/billing/orders' && method === 'GET') {
      if (!can('billing.read')) return denied()
      const filtered = orders.filter((order) => ['status', 'userId', 'productId'].every((field) => !url.searchParams.get(field) || order[field] === url.searchParams.get(field)) && (!url.searchParams.get('keyword') || `${order.orderNo} ${order.subject}`.includes(url.searchParams.get('keyword'))))
      const { items, ...pagination } = pageOf(filtered, url.searchParams)
      return json({ orders: items, ...pagination })
    }
    if (path === '/api/admin/launch-readiness' && method === 'GET') return canAny(['system.manage', 'upstream.manage', 'billing.manage']) ? ok(readiness()) : denied()
    if (path === '/api/admin/billing/payment-config') {
      if (method === 'GET') return canAny(['billing.read', 'billing.manage']) ? json({ paymentConfig }) : denied()
      if (method === 'PATCH') {
        if (!can('billing.manage')) return denied()
        const provider = paymentConfig.providers.find((item) => item.id === body.providerId)
        if (!provider) return fail(400, '未知支付方式')
        provider.enabled = body.enabled === true
        provider.fields = provider.fields.map((field) => ({ ...field, configured: field.configured || Boolean(body.values?.[field.key]), ...(!field.secret && typeof body.values?.[field.key] === 'string' ? { value: body.values[field.key] } : {}) }))
        paymentConfig.generatedAt = new Date().toISOString()
        return json({ paymentConfig })
      }
    }
    if (path === '/api/admin/object-storage') {
      if (!can('system.manage')) return denied()
      if (method === 'GET') return ok(storage)
      if (method === 'PATCH') {
        const { accessKeyId, secretAccessKey, clearAccessKeyId, clearSecretAccessKey, ...rest } = body
        storage = { ...storage, ...rest, hasAccessKeyId: clearAccessKeyId ? false : Boolean(accessKeyId || storage.hasAccessKeyId), hasSecretAccessKey: clearSecretAccessKey ? false : Boolean(secretAccessKey || storage.hasSecretAccessKey), updatedAt: new Date().toISOString() }
        return ok(storage, '本地样本存储配置已保存')
      }
      if (method === 'POST') return fail(503, '隔离验收环境不连接外部存储，连接检测未执行')
    }
    if (path === '/api/admin/mail/test' && method === 'POST') return can('system.manage') ? fail(503, '隔离验收环境不发送邮件，测试邮件未发送') : denied()
    if (path === '/api/admin/audit-logs' && method === 'GET') return can('audit.read') ? json({ logs: [], total: 0, page: 1, pageSize: 20 }) : denied()
    if (path === '/api/canvas/projects' && method === 'GET') return ok({ projects: [], total: 0 })
    if (path === '/api/drama/projects' && method === 'GET') return ok({ projects: [], total: 0, page: 1, pageSize: 20 })
    if (path === '/api/library-assets' && method === 'GET') return ok({ assets: [], total: 0, page: 1, pageSize: 20 })
    if (path === '/api/agent/runs' && method === 'GET') return ok({ runs: [] })
    if (path === '/api/points' && method === 'GET') return json({ records: [], total: 0, page: 1, pageSize: 20 })
    return fail(404, `本地管理夹具未实现 ${method} ${path}`)
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      if (!isLoopback(url.hostname)) throw Object.assign(new Error('Fixture accepts loopback hosts only'), { status: 403 })
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) {
        for (const header of ['origin', 'referer']) {
          if (req.headers[header] && !isLoopback(new URL(req.headers[header]).hostname)) throw Object.assign(new Error('Fixture accepts loopback origins only'), { status: 403 })
        }
      }
      let raw = ''
      for await (const part of req) { raw += part; if (raw.length > 1024 * 1024) throw Object.assign(new Error('Fixture body too large'), { status: 413 }) }
      const body = raw ? JSON.parse(raw) : {}
      if (!isObject(body)) throw Object.assign(new Error('Fixture body must be an object'), { status: 400 })
      const response = await route(req, url, body)
      res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-oao-fixture': 'admin-local-memory-only' })
      res.end(JSON.stringify(response.body))
    } catch (error) {
      res.writeHead(error.status || (error instanceof SyntaxError ? 400 : 500), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: error.message }))
    }
  })
  return { server, listen: (port = 3463) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)) }), close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()) }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = createAdminFixture()
  const url = await fixture.listen(Number(process.env.ADMIN_FIXTURE_PORT || 3463))
  console.log(`Admin fixture: ${url} (isolated in-memory samples; no outbound requests or charges)`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void fixture.close().then(() => process.exit(0)))
}
