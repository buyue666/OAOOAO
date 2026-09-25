import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * OAOOAO 后台冒烟测试：通过 3310 前端代理登录并逐个请求真实管理接口。
 * 只读取数据，不执行任何写操作（新增/修改/删除）。
 */
const BASE = 'http://127.0.0.1:3310'
const USERNAME = 'fusion_admin'
const PASSWORD = TEST_PASSWORD

let cookie = ''
const results = []

async function call(path, init = {}) {
  const headers = { ...(init.headers || {}) }
  if (cookie) headers.cookie = cookie
  if (init.body) headers['content-type'] = 'application/json'
  if (!['GET', 'HEAD'].includes(init.method || 'GET')) headers.origin = BASE
  const response = await fetch(BASE + path, { ...init, headers, redirect: 'manual' })
  const setCookie = response.headers.getSetCookie?.() || []
  if (setCookie.length) cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  const text = await response.text()
  return { status: response.status, text }
}

const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) })
console.log('LOGIN', login.status)
if (login.status !== 200) { console.log(login.text.slice(0, 400)); process.exit(1) }

// 1) 页面路由必须返回 200 且包含 OAOOAO 品牌文字
const pages = ['/admin', '/admin/users', '/admin/generation', '/admin/channels', '/admin/products', '/admin/orders', '/admin/content', '/admin/settings', '/admin/audit']
for (const path of pages) {
  const result = await call(path)
  const hasBrand = result.text.includes('OAOOAO')
  const hasVozeb = /VOZEB|Vozeb/i.test(result.text)
  results.push({ kind: 'page', path, status: result.status, brand: hasBrand, vozeb: hasVozeb })
}

// 2) 管理接口读取
const endpoints = [
  '/api/admin/users?page=1&pageSize=5',
  '/api/admin/generation-overview?windowDays=7',
  '/api/admin/generation-operations?page=1&pageSize=5',
  '/api/admin/settings',
  '/api/admin/billing/products',
  '/api/admin/billing/orders?page=1&pageSize=5',
  '/api/admin/billing/summary',
  '/api/admin/billing/promotions',
  '/api/admin/billing/coupon-templates',
  '/api/admin/referrals',
  '/api/admin/referrals/relationships',
  '/api/admin/referrals/rewards',
  '/api/admin/announcements?page=1&pageSize=5',
  '/api/admin/works?page=1&pageSize=5',
  '/api/admin/work-cases?page=1&pageSize=5',
  '/api/admin/audit-logs?page=1&pageSize=5',
  '/api/admin/object-storage',
]
for (const path of endpoints) {
  const result = await call(path)
  let note = ''
  try {
    const parsed = JSON.parse(result.text)
    const payload = parsed?.data ?? parsed
    if (Array.isArray(payload?.users)) note = `users=${payload.users.length} total=${payload.total}`
    else if (Array.isArray(payload?.items)) note = `items=${payload.items.length} total=${payload.total}`
    else if (Array.isArray(payload?.orders)) note = `orders=${payload.orders.length} total=${payload.total}`
    else if (Array.isArray(payload?.announcements)) note = `announcements=${payload.announcements.length}`
    else if (Array.isArray(payload?.logs)) note = `logs=${payload.logs.length} total=${payload.total}`
    else if (Array.isArray(payload?.products)) note = `products=${payload.products.length}`
    else if (Array.isArray(payload?.campaigns)) note = `campaigns=${payload.campaigns.length}`
    else if (Array.isArray(payload?.templates)) note = `templates=${payload.templates.length}`
    else if (payload?.settings) note = `channels=${payload.settings.systemChannels?.length} models=${payload.settings.logicalModels?.length}`
    else if (payload?.program) note = `referral enabled=${payload.program.enabled}`
    else if (typeof payload?.enabled === 'boolean') note = `objectStorage enabled=${payload.enabled}`
    else if (payload?.totalCalls !== undefined) note = `totalCalls=${payload.totalCalls} successRate=${payload.successRate}`
    else if (payload?.orders && payload?.payments) note = `finance paid=${payload.orders.paid}`
  } catch { note = 'non-json' }
  results.push({ kind: 'api', path, status: result.status, note })
}

// 3) 未登录必须返回 401，禁止绕过权限
const savedCookie = cookie
cookie = ''
for (const path of ['/api/admin/users', '/api/admin/settings', '/api/admin/audit-logs']) {
  const result = await call(path)
  results.push({ kind: 'authz', path, status: result.status, note: result.status === 401 ? 'unauthorized as expected' : 'UNEXPECTED' })
}
cookie = savedCookie

console.log('\n=== 页面 ===')
for (const item of results.filter((r) => r.kind === 'page')) {
  const ok = item.status === 200 && item.brand && !item.vozeb
  console.log(`${ok ? 'PASS' : 'FAIL'} ${item.path} status=${item.status} OAOOAO=${item.brand} VOZEB=${item.vozeb}`)
}
console.log('\n=== 接口 ===')
for (const item of results.filter((r) => r.kind === 'api')) {
  console.log(`${item.status === 200 ? 'PASS' : 'FAIL'} ${item.path} status=${item.status} ${item.note}`)
}
console.log('\n=== 权限 ===')
for (const item of results.filter((r) => r.kind === 'authz')) {
  console.log(`${item.status === 401 ? 'PASS' : 'FAIL'} ${item.path} status=${item.status} ${item.note}`)
}

const failed = results.filter((item) => item.kind === 'page' ? !(item.status === 200 && item.brand && !item.vozeb) : item.kind === 'api' ? item.status !== 200 : item.status !== 401)
console.log(`\nFAILURES: ${failed.length}`)
if (failed.length) { console.log(JSON.stringify(failed, null, 1)); process.exit(1) }
