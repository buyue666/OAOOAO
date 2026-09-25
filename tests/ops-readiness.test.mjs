import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 运维能力验收：备份导出、数据留存策略、维护任务鉴权。
 *
 * 全部在本地运行，不接触生产数据；维护任务通过缺少令牌时的鉴权路径验证。
 */
import { createRequire } from 'node:module'
import { authenticatedContext, exitThrottled } from './session-helper.mjs'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const browser = await chromium.launch()
let page
try {
  const session = await authenticatedContext(browser, { base: BASE, username: 'fusion_admin', password: TEST_PASSWORD })
  page = session.page
  console.log(`[会话] ${session.reused ? '复用已登录会话（未消耗登录额度）' : '已通过真实登录表单建立会话'}`)
} catch (error) {
  if (error.throttled) {
    await browser.close()
    exitThrottled(error.message)
  }
  throw error
}

/* 1) 备份导出：管理员可导出，且不含敏感字段 */
const backup = await page.evaluate(async () => {
  const response = await fetch('/api/admin/backup/export', { method: 'POST', cache: 'no-store' })
  const text = await response.text()
  return { status: response.status, length: text.length, body: text.slice(0, 4000), disposition: response.headers.get('content-disposition') }
})
check('管理员可导出备份', backup.status === 200 && backup.length > 100, `status=${backup.status} bytes=${backup.length}`)
check('导出附带下载文件名', Boolean(backup.disposition) && /attachment/.test(backup.disposition || ''), backup.disposition || '无')
check('导出内容声明为 OAOOAO 账户配置备份', /"app":\s*"OAOOAO"/.test(backup.body), (backup.body.match(/"app":\s*"[^"]*"/) || ['未找到'])[0])

// 敏感字段必须被清理：密码哈希、会话令牌、密钥都不应出现在备份里。
const sensitiveFindings = ['passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'apiKey', 'api_key', 'secret', 'codeHash']
  .filter((key) => backup.body.includes(key))
check('备份不含密码 / 令牌 / 密钥字段', sensitiveFindings.length === 0, sensitiveFindings.length ? `仍出现：${sensitiveFindings.join(',')}` : '已清理')

/* 2) 数据留存策略可读 */
const lifecycle = await page.evaluate(async () => {
  const response = await fetch('/api/admin/settings', { cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  return { status: response.status, data: payload?.data ?? payload }
})
check('管理员可读取留存策略配置', lifecycle.status === 200, `status=${lifecycle.status}`)

/* 3) 维护任务鉴权：不带令牌必须被拒绝，而不是静默执行 */
const maintenance = await page.evaluate(async () => {
  const response = await fetch('/api/maintenance/data-lifecycle/run', { method: 'POST', cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  return { status: response.status, msg: payload?.msg }
})
check('维护任务无令牌被拒绝', maintenance.status === 401 || maintenance.status === 503, `status=${maintenance.status} msg=${maintenance.msg || ''}`)
check('维护任务不因缺少令牌而误执行', maintenance.status !== 200, `status=${maintenance.status}`)

const otherMaintenance = await page.evaluate(async () => {
  const out = {}
  for (const path of ['/api/maintenance/generation-tasks/run', '/api/maintenance/billing-orders/expire', '/api/maintenance/referrals/settle']) {
    const response = await fetch(path, { method: 'POST', cache: 'no-store' })
    out[path] = response.status
  }
  return out
})
check('其他维护端点同样要求令牌', Object.values(otherMaintenance).every((status) => status === 401 || status === 503), JSON.stringify(otherMaintenance))

/* 4) 健康检查覆盖数据库、加密与生成 worker */
const ready = await page.evaluate(async () => {
  const response = await fetch('/api/health/ready', { cache: 'no-store' })
  return { status: response.status, data: (await response.json().catch(() => null))?.data }
})
check('就绪探针报告数据库健康', ready.data?.database?.healthy === true, JSON.stringify(ready.data?.database))
check('就绪探针报告加密已就绪', ready.data?.encryptionReady === true)
check('就绪探针报告生成 worker 健康', ready.data?.generationWorker?.healthy === true, `lastHeartbeatAt=${ready.data?.generationWorker?.lastHeartbeatAt}`)

/* 5) 审计日志记录管理员操作 */
// 接口返回的字段是 `{ logs, total, page, pageSize }`（不是 data.items），
// 因此统一从 logs 读取；同时按 action 过滤，避免只看最近几条被其他操作挤掉。
const audit = await page.evaluate(async () => {
  const response = await fetch('/api/admin/audit-logs?page=1&pageSize=50', { cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  const items = payload?.logs ?? payload?.data?.items ?? payload?.items ?? []
  return { status: response.status, total: payload?.total ?? 0, actions: items.map((item) => item.action) }
})
check('审计日志可读', audit.status === 200 && audit.total > 0, `total=${audit.total}`)
check('审计日志包含管理员操作记录', audit.actions.some((action) => String(action).startsWith('admin.')), audit.actions.slice(0, 5).join(','))

// 备份导出必须留下审计记录：按 action 过滤查询而不是依赖最近列表。
const backupAudit = await page.evaluate(async () => {
  const response = await fetch('/api/admin/audit-logs?page=1&pageSize=50&action=admin.backup.export', { cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  const items = payload?.logs ?? payload?.data?.items ?? payload?.items ?? []
  return { status: response.status, total: payload?.total ?? 0, matched: items.filter((item) => item.action === 'admin.backup.export').length }
})
check('备份导出被记入审计日志', backupAudit.matched > 0, `matched=${backupAudit.matched} total=${backupAudit.total}`)

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n总计 ${results.length} 项，失败 ${failed.length} 项`)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
process.exit(failed.length ? 1 : 0)
