import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * OAOOAO 后台写入路径验证。
 * 每条用例都创建自己的测试数据并在结束时清理，不改动任何既有用户、订单或配置。
 */
const BASE = 'http://127.0.0.1:3310'
const USERNAME = 'fusion_admin'
const PASSWORD = TEST_PASSWORD

let cookie = ''
async function call(path, init = {}) {
  const headers = { ...(init.headers || {}) }
  if (cookie) headers.cookie = cookie
  if (init.body) headers['content-type'] = 'application/json'
  if (!['GET', 'HEAD'].includes(init.method || 'GET')) headers.origin = BASE
  const response = await fetch(BASE + path, { ...init, headers, redirect: 'manual' })
  const setCookie = response.headers.getSetCookie?.() || []
  if (setCookie.length) cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* keep null */ }
  return { status: response.status, json, text }
}

const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) })
if (login.status !== 200) { console.log('LOGIN FAILED', login.status); process.exit(1) }
console.log('LOGIN 200')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

/* 1) 公告：创建草稿 → 发布 → 下线并改区间 → 删除（只操作自建数据） */
const title = `OAOOAO 写入自检 ${new Date().toISOString().slice(0, 19)}`
const created = await call('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title, content: '写入路径自检，将立即删除。', enabled: false }) })
const announcementId = created.json?.announcement?.id
check('公告创建（草稿）', created.status === 200 && created.json?.announcement?.enabled === false, `id=${announcementId || '-'} enabled=${created.json?.announcement?.enabled}`)

if (announcementId) {
  const published = await call(`/api/admin/announcements/${announcementId}`, { method: 'PATCH', body: JSON.stringify({ enabled: true, popupHome: true, popupAfterLogin: true }) })
  const body = published.json?.announcement
  check('公告发布与弹窗设置', published.status === 200 && body?.enabled === true && body?.popupHome === true && body?.popupAfterLogin === true, `enabled=${body?.enabled} popupHome=${body?.popupHome} popupAfterLogin=${body?.popupAfterLogin}`)

  const startsAt = new Date(Date.now() - 3600_000).toISOString()
  const endsAt = new Date(Date.now() + 86400_000).toISOString()
  const windowed = await call(`/api/admin/announcements/${announcementId}`, { method: 'PATCH', body: JSON.stringify({ enabled: false, startsAt, endsAt }) })
  const windowedBody = windowed.json?.announcement
  check('公告下线与生效区间', windowed.status === 200 && windowedBody?.enabled === false && Boolean(windowedBody?.startsAt) && Boolean(windowedBody?.endsAt), `enabled=${windowedBody?.enabled} startsAt=${windowedBody?.startsAt ? 'set' : 'missing'} endsAt=${windowedBody?.endsAt ? 'set' : 'missing'}`)

  const listed = await call('/api/admin/announcements?page=1&pageSize=50')
  const found = (listed.json?.announcements || []).find((item) => item.id === announcementId)
  check('公告读取', Boolean(found), `listTotal=${listed.json?.total}`)

  const removed = await call(`/api/admin/announcements/${announcementId}`, { method: 'DELETE' })
  check('公告删除（清理自建数据）', removed.status === 200, `status=${removed.status}`)
}

/* 2) 设置：提交与当前完全相同的值（等价于无变更保存），验证保存链路与权限 */
const settings = await call('/api/admin/settings')
const current = settings.json?.settings
if (current) {
  const same = await call('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({
    registrationEnabled: current.registrationEnabled,
    emailRegistrationEnabled: current.emailRegistrationEnabled,
    freeDailyPointsEnabled: current.freeDailyPointsEnabled,
    freeDailyPoints: current.freeDailyPoints,
    generationConcurrency: current.generationConcurrency,
    generationDefaults: current.generationDefaults,
    dataLifecycle: current.dataLifecycle,
  }) })
  check('系统设置保存（同值回写）', same.status === 200, `status=${same.status} ${same.json?.error || ''}`)

  /* 3) 渠道：以已保存的密钥占位回写，验证 mergeSystemChannelSecrets 不会清空密钥 */
  const channels = current.systemChannels || []
  if (channels.length) {
    const keysBefore = channels.map((channel) => `${channel.id}:${channel.hasApiKey}`)
    const roundTrip = channels.map((channel) => ({
      id: channel.id, name: channel.name, baseUrl: channel.baseUrl, apiKey: '', webhookSecret: '',
      apiFormat: channel.apiFormat, models: channel.models, enabled: channel.enabled, advancedConfig: channel.advancedConfig,
    }))
    const saved = await call('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ systemChannels: roundTrip }) })
    const after = saved.json?.settings?.systemChannels || []
    const keysAfter = after.map((channel) => `${channel.id}:${channel.hasApiKey}`)
    check('渠道回写不丢密钥', saved.status === 200 && JSON.stringify(keysBefore) === JSON.stringify(keysAfter), `before=${keysBefore.join(',')} after=${keysAfter.join(',')}`)
    check('渠道接口不返回明文密钥', after.every((channel) => channel.apiKey === '' && channel.webhookSecret === ''), `apiKey 全部为空=${after.every((c) => c.apiKey === '')}`)
  }

  /* 4) 用户：以当前资料原值回写，验证用户编辑链路 */
  const users = await call('/api/admin/users?page=1&pageSize=5')
  const self = (users.json?.users || [])[0]
  if (self) {
    const patch = await call(`/api/admin/users/${self.id}`, { method: 'PATCH', body: JSON.stringify({
      displayName: self.displayName, email: self.email, status: self.status, role: self.role,
      adminPermissions: self.adminPermissions, planId: self.planId, pointsBalance: self.pointsBalance,
    }) })
    check('用户资料保存（原值回写）', patch.status === 200, `status=${patch.status} ${patch.json?.error || ''}`)
    check('用户接口不返回密码', !JSON.stringify(patch.json?.user || {}).match(/passwordHash|password"/i), 'no password field')
  }
}

/* 5) 越权与来源校验 */
const savedCookie = cookie
cookie = ''
const unauth = await call('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ registrationEnabled: true }) })
check('未登录写入被拒绝', unauth.status === 401, `status=${unauth.status}`)
cookie = savedCookie

const crossOrigin = await fetch(`${BASE}/api/admin/settings`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example.com' },
  body: JSON.stringify({ registrationEnabled: true }),
})
check('跨站来源写入被拒绝', crossOrigin.status === 403, `status=${crossOrigin.status}`)

/* 6) 敏感信息不落日志/响应：确认设置与渠道响应中没有明文密钥形态 */
const finalSettings = await call('/api/admin/settings')
const raw = finalSettings.text
const leaksPlainKey = /(sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{20,})/.test(raw)
check('设置响应无明文密钥', !leaksPlainKey, leaksPlainKey ? 'DETECTED' : 'clean')

const failed = results.filter((item) => !item.ok)
console.log(`\nFAILURES: ${failed.length}`)
if (failed.length) { console.log(JSON.stringify(failed, null, 1)); process.exit(1) }
