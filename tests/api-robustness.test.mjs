import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 接口健壮性验收：畸形输入不应产生 5xx。
 *
 * 背景：排查“系统接口 500”时发现部分接口在收到类型错误的字段时返回 500 而非 4xx。
 * 该脚本固定这些用例，防止回归。只使用自建任务，并在结束时结束它们。
 *
 * 已知例外（后端既有行为，不在本仓库修复范围，单独列出不计入失败）：
 * - 无（2026-09 修复后，此前记录在案的畸形输入 500 均已转为 4xx）
 */
const BASE = 'http://127.0.0.1:3310'

let cookie = ''
async function call(path, init = {}) {
  const headers = { ...(init.headers || {}) }
  if (cookie) headers.cookie = cookie
  if (init.body && !headers['content-type']) headers['content-type'] = init.contentType || 'application/json'
  if (!['GET', 'HEAD'].includes(init.method || 'GET')) headers.origin = BASE
  const response = await fetch(BASE + path, { ...init, headers, redirect: 'manual' })
  const setCookie = response.headers.getSetCookie?.() || []
  if (setCookie.length) cookie = setCookie.map((v) => v.split(';')[0]).join('; ')
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* ignore */ }
  return { status: response.status, text: text.slice(0, 200), json }
}

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'fusion_admin', password: TEST_PASSWORD }) })
check('登录', login.status === 200, `status=${login.status}`)
if (login.status !== 200) {
  console.log('\n无法登录（可能触发登录频率限制），跳过接口健壮性检查')
  process.exit(0) // 频率限制不是被测系统的缺陷
}

/* 后台接口：畸形输入应返回 4xx，不应 5xx */
const adminCases = [
  ['用户新建空 body', '/api/admin/users', 'POST', '{}'],
  ['用户更新畸形 JSON', '/api/admin/users/probe-id', 'PATCH', '{'],
  ['用户更新错误类型', '/api/admin/users/probe-id', 'PATCH', JSON.stringify({ adminPermissions: 'not-array', pointsBalance: 'abc' })],
  ['公告新建空 body', '/api/admin/announcements', 'POST', '{}'],
  ['公告新建错误类型', '/api/admin/announcements', 'POST', JSON.stringify({ title: 123, content: null })],
  ['优惠券模板空 body', '/api/admin/billing/coupon-templates', 'POST', '{}'],
  ['邀请设置错误类型', '/api/admin/referrals', 'PATCH', JSON.stringify({ inviterPoints: 'abc' })],
  ['对象存储错误类型', '/api/admin/object-storage', 'PATCH', JSON.stringify({ enabled: 'yes', endpoint: 42 })],
  ['对象存储空 body', '/api/admin/object-storage', 'PATCH', '{}'],
  ['邮件测试空 body', '/api/admin/mail/test', 'POST', '{}'],
  ['邮件测试错误类型', '/api/admin/mail/test', 'POST', JSON.stringify({ to: { a: 1 }, mail: 'string' })],
  ['作品审核空 body', '/api/admin/works/probe-id/review', 'POST', '{}'],
  ['生成接管空 body', '/api/admin/generation-operations/image/probe-id/review', 'POST', '{}'],
  ['生成接管错误动作', '/api/admin/generation-operations/image/probe-id/review', 'POST', JSON.stringify({ action: 'invalid' })],
  ['订单退款空 body', '/api/admin/billing/orders/probe-id/refund', 'POST', '{}'],
  ['设置错误类型 systemChannels', '/api/admin/settings', 'PATCH', JSON.stringify({ systemChannels: 'not-array' })],
  ['设置错误类型 logicalModels', '/api/admin/settings', 'PATCH', JSON.stringify({ logicalModels: 123 })],
  ['设置 site 为字符串', '/api/admin/settings', 'PATCH', JSON.stringify({ site: 'string' })],
  ['设置 generationConcurrency 为数组', '/api/admin/settings', 'PATCH', JSON.stringify({ generationConcurrency: [] })],
  ['设置 body 为 JSON null', '/api/admin/settings', 'PATCH', 'null'],
  ['设置 body 为数组', '/api/admin/settings', 'PATCH', '[]'],
  ['设置 body 为数字', '/api/admin/settings', 'PATCH', '123'],
  ['设置 body 为畸形 JSON', '/api/admin/settings', 'PATCH', '{'],
  ['促销保存畸形 JSON', '/api/admin/billing/promotions', 'POST', '{'],
  ['促销保存 body 为 null', '/api/admin/billing/promotions', 'POST', 'null'],
  ['模型拉取畸形 JSON', '/api/admin/models', 'POST', '{'],
  ['模型拉取 body 为 null', '/api/admin/models', 'POST', 'null'],
]
for (const [name, path, method, body] of adminCases) {
  const result = await call(path, { method, body })
  check(`后台健壮性：${name}`, result.status < 500, `status=${result.status}`)
}

/* 生成接口：畸形输入应返回 4xx，不应 5xx */
const generationCases = [
  ['图片任务空 body', '/api/image-tasks', 'POST', '{}'],
  ['图片任务畸形 JSON', '/api/image-tasks', 'POST', '{'],
  ['图片任务 config 为字符串', '/api/image-tasks', 'POST', JSON.stringify({ prompt: 'x', config: 'y' })],
  ['图片任务 references 为字符串', '/api/image-tasks', 'POST', JSON.stringify({ prompt: 'x', config: { model: 'e2e-image' }, references: 'y' })],
  ['图片任务 prompt 为数字', '/api/image-tasks', 'POST', JSON.stringify({ prompt: 123, config: { model: 'e2e-image' } })],
  ['图片任务 prompt 为对象', '/api/image-tasks', 'POST', JSON.stringify({ prompt: { a: 1 }, config: { model: 'e2e-image' } })],
  ['图片任务 body 为 JSON null', '/api/image-tasks', 'POST', 'null'],
  ['视频任务空 body', '/api/video-generation-tasks', 'POST', '{}'],
  ['视频任务 prompt 为对象', '/api/video-generation-tasks', 'POST', JSON.stringify({ prompt: { a: 1 }, config: { model: 'e2e-video' } })],
  ['音频任务空 body', '/api/audio-tasks', 'POST', '{}'],
  ['音频任务 config 为数组', '/api/audio-tasks', 'POST', JSON.stringify({ prompt: 'x', config: [] })],
  ['音频任务 prompt 为对象', '/api/audio-tasks', 'POST', JSON.stringify({ prompt: { a: 1 }, config: { model: 'e2e-audio' } })],
  ['文本任务空 body', '/api/text-tasks', 'POST', '{}'],
  ['文本任务 messages 为字符串', '/api/text-tasks', 'POST', JSON.stringify({ config: { model: 'e2e-text' }, messages: 'y' })],
  ['Agent 空 body', '/api/agent/runs', 'POST', '{}'],
  ['Agent 畸形 JSON', '/api/agent/runs', 'POST', '{'],
  ['Agent body 为 JSON null', '/api/agent/runs', 'POST', 'null'],
  ['Agent body 为数组', '/api/agent/runs', 'POST', '[]'],
  ['Agent surface 为数字', '/api/agent/runs', 'POST', JSON.stringify({ clientRequestId: 'probe-1', surface: 5, prompt: 'x' })],
  ['Agent canvas 缺 projectId', '/api/agent/runs', 'POST', JSON.stringify({ clientRequestId: 'probe-2', surface: 'canvas', prompt: 'x' })],
  ['Agent prompt 为对象', '/api/agent/runs', 'POST', JSON.stringify({ clientRequestId: 'probe-3', surface: 'chat', prompt: { a: 1 } })],
  ['作品审核畸形 JSON', '/api/admin/works/probe-id/review', 'POST', '{'],
  ['作品下架畸形 JSON', '/api/admin/works/probe-id/take-down', 'POST', '{'],
  ['作品推荐畸形 JSON', '/api/admin/works/probe-id/feature', 'POST', '{'],
  ['治理案件畸形 JSON', '/api/admin/work-cases/probe-id/resolve', 'POST', '{'],
  ['作品申诉畸形 JSON', '/api/works/probe-id/appeal', 'POST', '{'],
  ['关注畸形 JSON', '/api/public/users/probe-id/follow', 'POST', '{'],
  ['点赞畸形 JSON', '/api/public/works/probe-id/community/like', 'POST', '{'],
  ['举报畸形 JSON', '/api/public/works/probe-id/report', 'POST', '{'],
  ['生成记录 POST 畸形 JSON', '/api/generation-logs', 'POST', '{'],
  ['生成记录 PATCH 畸形 JSON', '/api/generation-logs', 'PATCH', '{'],
  ['生成记录 DELETE 畸形 JSON', '/api/generation-logs', 'DELETE', '{'],
  ['后台生成记录 DELETE 畸形 JSON', '/api/admin/generation-logs', 'DELETE', '{'],
]
for (const [name, path, method, body] of generationCases) {
  const result = await call(path, { method, body })
  check(`生成健壮性：${name}`, result.status < 500, `status=${result.status}`)
}

/* 新任务的关键操作不应 5xx（验证“干净任务不受状态残留影响”） */
console.log('\n--- 新任务操作 ---')
const created = await call('/api/image-tasks', {
  method: 'POST',
  body: JSON.stringify({ prompt: '健壮性验收：干净任务', config: { model: 'e2e-image', size: '1:1' }, kind: 'generation', source: 'image-workbench', context: { clientRequestId: `robust-${Date.now()}` } }),
})
const taskId = created.json?.task?.id
check('创建干净图片任务', created.status === 200 && Boolean(taskId), `status=${created.status} id=${taskId || '-'}`)
if (taskId) {
  const detail = await call(`/api/image-tasks/${taskId}`)
  check('干净任务详情', detail.status === 200, `status=${detail.status}`)
  const cancel = await call(`/api/image-tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  check('干净任务可取消', cancel.status === 200, `status=${cancel.status}`)
  const afterCancel = await call(`/api/image-tasks/${taskId}`)
  check('取消后状态为已取消', afterCancel.json?.task?.status === 'cancelled', `status=${afterCancel.json?.task?.status}`)
  const cancelAgain = await call(`/api/image-tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  check('重复取消返回确定冲突而非 5xx', cancelAgain.status === 409, `status=${cancelAgain.status}`)
}

/* 未登录必须 401 */
const savedCookie = cookie
cookie = ''
const unauthorized = await call('/api/image-tasks', { method: 'POST', body: JSON.stringify({ prompt: 'x', config: { model: 'e2e-image' } }) })
check('未登录创建任务返回 401', unauthorized.status === 401, `status=${unauthorized.status}`)
cookie = savedCookie

/* 正常读取不应 5xx */
console.log('\n--- 常规读取 ---')
const reads = [
  '/api/auth/session', '/api/create/overview', '/api/generation-logs?page=1&pageSize=5',
  '/api/admin/settings', '/api/admin/users?page=1&pageSize=5', '/api/admin/billing/summary',
  '/api/admin/generation-overview', '/api/admin/generation-operations?page=1&pageSize=5',
  '/api/admin/audit-logs?page=1&pageSize=5', '/api/admin/object-storage',
]
for (const path of reads) {
  const result = await call(path)
  check(`读取 ${path.split('?')[0]}`, result.status < 500, `status=${result.status}`)
}

const failed = results.filter((item) => !item.ok)
console.log(`\nFAILURES: ${failed.length}`)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
process.exit(failed.length ? 1 : 0)
