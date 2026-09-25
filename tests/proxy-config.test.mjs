/**
 * 代理配置健壮性验收。
 *
 * 回归背景：`OAOAO_BACKEND_URL` 缺少协议（例如 `127.0.0.1:3200`）时，
 * 旧实现会在 try/catch 之外调用 `new URL()` 抛错，被 Next.js 转成 500，
 * 表现为全站「系统接口 500」且看不到原因。现应返回 503 与明确提示。
 *
 * 该脚本以非法后端地址在独立端口启动一份生产构建，验证：
 * 1. 接口返回 503，不是 500
 * 2. 错误信息明确指出需要 http:// 或 https:// 前缀
 * 3. 使用正确地址时接口恢复正常
 *
 * 不修改 .env.local，也不影响正在运行的预览实例。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE_PORT = Number(process.env.PROXY_TEST_PORT || 3399)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

/** 每个场景使用独立端口，避免上一个实例尚未释放端口时误连。 */
async function withServer(port, env, run) {
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'start', '-p', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...env },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  try {
    let ready = false
    for (let index = 0; index < 45; index += 1) {
      await sleep(1000)
      try {
        const response = await fetch(`${base}/api/auth/session`)
        if (response.status) { ready = true; break }
      } catch { /* 仍在启动 */ }
    }
    if (!ready) return null
    return await run(base)
  } finally {
    child.kill('SIGTERM')
    await sleep(2500)
    try { child.kill('SIGKILL') } catch { /* 已退出 */ }
    await sleep(1000)
  }
}

console.log('=== 非法后端地址（缺少协议）===')
const invalid = await withServer(BASE_PORT, { OAOAO_BACKEND_URL: '127.0.0.1:3200' }, async (base) => {
  const probePaths = ['/api/auth/session', '/api/admin/settings', '/api/points', '/api/create/overview', '/api/generation-logs']
  const observed = []
  for (const path of probePaths) {
    const response = await fetch(base + path, { redirect: 'manual' })
    const text = await response.text()
    observed.push({ path, status: response.status, text: text.slice(0, 200) })
  }
  return observed
})

if (!invalid) {
  check('非法后端地址场景启动测试实例', false, '实例未能在超时内启动')
} else {
  for (const item of invalid) {
    check(`${item.path} 返回 503 而非 500`, item.status === 503, `status=${item.status}`)
    check(`${item.path} 提示缺少协议前缀`, /http/.test(item.text) && /OAOAO_BACKEND_URL/.test(item.text), item.text.replace(/\n/g, ' ').slice(0, 90))
  }
}

console.log('\n=== 正确的后端地址 ===')
const valid = await withServer(BASE_PORT + 1, { OAOAO_BACKEND_URL: 'http://127.0.0.1:3200' }, async (base) => {
  const response = await fetch(`${base}/api/auth/session`, { redirect: 'manual' })
  const text = await response.text()
  return { status: response.status, text: text.slice(0, 120) }
})

if (!valid) {
  check('正确后端地址场景启动测试实例', false, '实例未能在超时内启动')
} else {
  check('正确后端地址时接口恢复正常', valid.status === 200, `status=${valid.status}`)
}

const failed = results.filter((item) => !item.ok)
console.log(`\nFAILURES: ${failed.length}`)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
process.exit(failed.length ? 1 : 0)
