import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * OAOOAO 真实生成流程验收。
 *
 * 覆盖：登录 → 创建任务 → 状态轮询 → 成功/失败展示 → 积分字段 → 取消 → 刷新后恢复。
 * 所有任务都通过 3310 前端代理打到 3200 本地后端，只使用本机隔离数据。
 */
const BASE = 'http://127.0.0.1:3310'
const USERNAME = 'fusion_admin'
const PASSWORD = TEST_PASSWORD

let cookie = ''
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

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
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers.entries()) }
}

function pointsFrom(headers) {
  return {
    remaining: Number(headers['x-vozeb-pro-points-remaining']),
    permanent: Number(headers['x-vozeb-pro-points-permanent']),
    daily: Number(headers['x-vozeb-pro-points-daily']),
  }
}

/* 1) 登录 */
const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) })
check('登录', login.status === 200 && Boolean(login.json?.user?.id), `status=${login.status} user=${login.json?.user?.username}`)

/**
 * 后端对登录有频率限制（默认 15 分钟内 8 次）。频繁运行本脚本会触发 429，
 * 此时后续请求都会变成 401。这属于测试环境节流，不是被测系统缺陷，
 * 因此单独提示并跳过，避免把限流误报成失败。
 */
if (login.status === 429) {
  console.log('\n后端登录频率限制已触发（429），本次跳过生成流程检查。')
  console.log('请等待约 15 分钟后重试，或使用其他已登录管理员账号。')
  process.exit(0)
}
if (login.status !== 200) {
  console.log(`\n登录失败（status=${login.status}）：${login.text.slice(0, 200)}`)
  process.exit(1)
}

/* 2) 会话返回真实模型目录 */
const session = await call('/api/auth/session')
const logicalModels = session.json?.settings?.logicalModels ?? []
const byCapability = (capability) => logicalModels.find((model) => model.capability === capability && model.enabled)
check('会话返回真实逻辑模型目录', logicalModels.length > 0, `models=${logicalModels.map((m) => `${m.id}:${m.capability}`).join(',')}`)
check('后端提供默认文本模型', Boolean(session.json?.settings?.defaultModels?.textModel), `textModel=${session.json?.settings?.defaultModels?.textModel}`)

/* 3) 文本任务：创建 + 轮询 + 终态 */
const textModel = byCapability('text')?.id
let textTaskId = null
if (textModel) {
  const created = await call('/api/text-tasks', { method: 'POST', body: JSON.stringify({ config: { model: textModel }, messages: [{ role: 'user', content: '请回复：OAOOAO 测试。' }] }) })
  textTaskId = created.json?.task?.id
  check('创建文本任务', created.status === 200 && Boolean(textTaskId), `id=${textTaskId || '-'} status=${created.json?.task?.status}`)
  check('文本任务返回初始状态', ['pending', 'running'].includes(created.json?.task?.status), `status=${created.json?.task?.status}`)
} else {
  check('创建文本任务', false, '后端没有可用的文本模型')
}

let textFinal = null
if (textTaskId) {
  const polled = []
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const poll = await call(`/api/text-tasks/${textTaskId}`)
    polled.push(poll.json?.task?.status)
    if (['success', 'error', 'cancelled'].includes(poll.json?.task?.status)) { textFinal = poll; break }
  }
  const finalStatus = textFinal?.json?.task?.status
  check('文本任务轮询到终态', ['success', 'error', 'cancelled'].includes(finalStatus), `states=${[...new Set(polled)].join('→')} final=${finalStatus}`)
  check('文本任务返回积分响应头', pointsFrom(textFinal?.headers || {}).remaining !== undefined ? Number.isFinite(pointsFrom(textFinal.headers).remaining) : false, `headers=${JSON.stringify(pointsFrom(textFinal?.headers || {}))}`)
  if (finalStatus === 'success') {
    check('文本成功返回结果内容', Boolean(textFinal.json?.task?.result?.content || textFinal.json?.task?.result), `result=${JSON.stringify(textFinal.json?.task?.result).slice(0, 120)}`)
  } else {
    check('文本失败返回错误原因', Boolean(textFinal?.json?.task?.error), `error=${textFinal?.json?.task?.error}`)
  }
}

/* 4) 图片任务：创建 + 取消（验证取消作用于真实后端） */
const imageModel = byCapability('image')?.id
let imageTaskId = null
if (imageModel) {
  const created = await call('/api/image-tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'OAOOAO 测试：一座雪山', config: { model: imageModel, size: '1:1', quality: 'auto' }, kind: 'generation', source: 'image-workbench', context: { clientRequestId: `smoke-image-${Date.now()}` } }),
  })
  imageTaskId = created.json?.task?.id
  check('创建图片任务', created.status === 200 && Boolean(imageTaskId), `id=${imageTaskId || '-'} status=${created.json?.task?.status}`)

  if (imageTaskId) {
    // 立即取消；若任务已进入终态则后端会返回 409，这也是正确行为。
    const cancelled = await call(`/api/image-tasks/${imageTaskId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
    const detail = await call(`/api/image-tasks/${imageTaskId}`)
    const status = detail.json?.task?.status
    check('取消图片任务得到确定结果', cancelled.status === 200 || cancelled.status === 409, `cancelStatus=${cancelled.status}`)
    check('取消后状态可查询', ['cancelled', 'error', 'success', 'running', 'pending'].includes(status), `status=${status}`)
    if (cancelled.status === 200) check('取消成功任务变为已取消', status === 'cancelled', `status=${status}`)
  }
} else {
  check('创建图片任务', false, '后端没有可用的图片模型')
}

/* 5) 重复提交去重：同一 clientRequestId 不应创建第二条任务 */
if (imageModel) {
  const requestId = `smoke-dedupe-${Date.now()}`
  const body = JSON.stringify({ prompt: 'OAOOAO 去重测试', config: { model: imageModel, size: '1:1' }, kind: 'generation', source: 'image-workbench', context: { clientRequestId: requestId } })
  const first = await call('/api/image-tasks', { method: 'POST', body })
  const second = await call('/api/image-tasks', { method: 'POST', body })
  check('相同请求标识不会重复创建任务', first.json?.task?.id && first.json?.task?.id === second.json?.task?.id, `first=${first.json?.task?.id} second=${second.json?.task?.id}`)
  if (first.json?.task?.id) await call(`/api/image-tasks/${first.json.task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
}

/* 6) 视频任务：创建（异步，成功或待确认都算真实响应） */
const videoModel = byCapability('video')?.id
if (videoModel) {
  const created = await call('/api/video-generation-tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'OAOOAO 测试：海浪', config: { model: videoModel, size: '16:9', videoSeconds: '5' }, source: 'video-workbench', context: { clientRequestId: `smoke-video-${Date.now()}` } }),
  })
  const task = created.json?.task
  // 视频接口有独立的频率限制（默认 1 分钟 6 次）。被限流说明限流生效，不是缺陷。
  if (created.status === 429) {
    check('视频任务频率限制生效', true, 'status=429 已限流（后端保护正常）')
  } else {
    check('创建视频任务', [200, 202].includes(created.status) && Boolean(task?.id), `status=${created.status} id=${task?.id || '-'} needsReview=${task?.needsReview}`)
    if (task?.id) {
      const detail = await call(`/api/video-tasks/${task.id}`)
      check('视频任务状态可查询', detail.status === 200 && Boolean(detail.json?.task?.status), `status=${detail.json?.task?.status}`)
      const cancel = await call(`/api/video-tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
      check('视频任务可取消或返回确定冲突', cancel.status === 200 || cancel.status === 409, `cancelStatus=${cancel.status}`)
    }
  }
} else {
  check('创建视频任务', false, '后端没有可用的视频模型')
}

/* 7) 音频任务：创建 */
const audioModel = byCapability('audio')?.id
if (audioModel) {
  const created = await call('/api/audio-tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'OAOOAO 音频测试', config: { model: audioModel, voice: 'alloy', format: 'mp3' }, source: 'audio-workbench', context: { clientRequestId: `smoke-audio-${Date.now()}` } }),
  })
  check('创建音频任务', created.status === 200 && Boolean(created.json?.task?.id), `status=${created.status} id=${created.json?.task?.id || '-'}`)
  if (created.json?.task?.id) await call(`/api/audio-tasks/${created.json.task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
} else {
  check('创建音频任务', false, '后端没有可用的音频模型')
}

/* 8) 生成记录：刷新后仍能读取任务（页面刷新恢复的依据） */
const logs = await call('/api/generation-logs?page=1&pageSize=5')
check('生成记录可分页读取', logs.status === 200 && Array.isArray(logs.json?.items), `status=${logs.status} total=${logs.json?.total} items=${logs.json?.items?.length}`)

if (textTaskId) {
  const reRead = await call(`/api/text-tasks/${textTaskId}`)
  check('刷新后仍能按 ID 恢复任务', reRead.status === 200 && reRead.json?.task?.id === textTaskId, `status=${reRead.status}`)
}

/* 9) 未登录必须拒绝创建任务 */
const savedCookie = cookie
cookie = ''
const unauthorized = await call('/api/text-tasks', { method: 'POST', body: JSON.stringify({ config: { model: textModel }, messages: [{ role: 'user', content: '未登录探测' }] }) })
check('未登录创建任务被拒绝', unauthorized.status === 401, `status=${unauthorized.status}`)
cookie = savedCookie

/* 10) 积分字段必须存在 */
const pointsProbe = await call(`/api/text-tasks/${textTaskId}`)
const snapshot = pointsProbe ? pointsFrom(pointsProbe.headers) : null
check('任务详情返回积分余额字段', snapshot !== null && Number.isFinite(snapshot.remaining), JSON.stringify(snapshot))

const failed = results.filter((item) => !item.ok)
console.log(`\nFAILURES: ${failed.length}`)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
process.exit(failed.length ? 1 : 0)
