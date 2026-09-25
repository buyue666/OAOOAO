import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 交互验收：在真实浏览器中点击后台的编辑、确认弹窗、标签页与筛选，
 * 验证界面元素可操作且不会产生前端异常。只读浏览加打开/关闭弹窗，不提交写操作。
 */
import { createRequire } from 'node:module'

const WEB_ROOT = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web'
const require = createRequire(`${WEB_ROOT}/package.json`)
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:3310'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await context.newPage()
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 200)) })
page.on('pageerror', (error) => errors.push(`pageerror: ${String(error).slice(0, 200)}`))

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.evaluate(async (password) => {
  await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fusion_admin', password }) })
}, TEST_PASSWORD)

const results = []
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

async function goto(path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
}

/* 用户页：打开详情抽屉与编辑抽屉，校验权限勾选框 */
await goto('/admin/users')
const rowCount = await page.locator('table tbody tr').count()
record('用户表格渲染', rowCount > 0, `rows=${rowCount}`)

await page.getByRole('button', { name: '详情' }).first().click()
await page.waitForTimeout(700)
record('用户详情抽屉打开', await page.getByRole('dialog').isVisible())
const tabs = await page.getByRole('button', { name: /资料与权限|调用记录|订单消费/ }).count()
record('用户详情含资料/调用/订单三个标签', tabs === 3, `tabs=${tabs}`)
await page.getByRole('button', { name: /调用记录/ }).click()
await page.waitForTimeout(900)
record('调用记录标签可切换', (await page.getByRole('dialog').innerText()).includes('调用记录'))
await page.getByRole('button', { name: '关闭' }).first().click()
await page.waitForTimeout(400)

await page.getByRole('button', { name: /^编辑 / }).first().click()
await page.waitForTimeout(900)
const editor = page.getByRole('dialog')
const editorText = await editor.innerText()
record('用户编辑抽屉打开', await editor.isVisible())
record('编辑抽屉包含职责勾选项', (await editor.locator('input[type="checkbox"]').count()) >= 13, `checkboxes=${await editor.locator('input[type="checkbox"]').count()}`)
record('编辑抽屉套餐为下拉选择', (await editor.locator('select').count()) >= 2, `selects=${await editor.locator('select').count()}`)
record('编辑抽屉不显示明文密码', !/passwordHash|pbkdf2_sha256|\$2[aby]\$/.test(editorText))
await page.getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(400)

/* 危险操作确认弹窗：禁用按钮必须弹出确认框 */
/* 当前唯一用户就是登录中的管理员，禁用按钮应被自我保护禁用；先断言这一点。 */
const disableButton = page.getByRole('button', { name: /^禁用$/ }).first()
const selfRow = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('table tbody tr'))
  return rows.find((row) => /fusion_admin/.test(row.textContent || ''))?.textContent?.slice(0, 60) || ''
})
record('当前管理员行渲染', selfRow.length > 0, selfRow.replace(/\s+/g, ' '))
record('管理员不能禁用自己', await disableButton.isDisabled(), 'self-protection')

/* 用一个临时普通用户验证危险操作确认弹窗，随后立即删除该自建账号。 */
const created = await page.evaluate(async () => {
  const username = `oaooao_confirm_${Date.now().toString(36)}`
  const response = await fetch('/api/admin/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName: '确认弹窗自检', password: 'LocalCheck!2026', role: 'user', status: 'active', pointsBalance: 0, planId: 'free' }),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, id: payload?.user?.id, username }
})
record('创建临时用户用于确认弹窗验证', created.status === 200 && Boolean(created.id), `id=${created.id || '-'}`)

if (created.id) {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  const tempRow = page.locator('table tbody tr').filter({ hasText: created.username })
  record('临时用户出现在列表', (await tempRow.count()) > 0)
  await tempRow.getByRole('button', { name: /^禁用$/ }).click()
  await page.waitForTimeout(700)
  const dialogText = await page.getByRole('dialog').innerText()
  record('禁用用户弹出确认框', dialogText.includes('确认') && dialogText.includes('审计日志'), dialogText.split('\n')[0])
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(500)
  const stillActive = await page.locator('table tbody tr').filter({ hasText: created.username }).innerText()
  record('取消后未执行禁用', stillActive.includes('正常'), stillActive.replace(/\s+/g, ' ').slice(0, 60))

  const cleaned = await page.evaluate(async (id) => {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return response.status
  }, created.id)
  record('删除临时用户（清理自建数据）', cleaned === 200, `status=${cleaned}`)
}

/* 生成运维页：筛选控件与任务详情 */
await goto('/admin/generation')
record('生成运维查询条件渲染', (await page.getByLabel('任务类型').count()) === 1 && (await page.getByLabel('渠道').count()) === 1)
const detailButtons = page.getByRole('button', { name: '详情' })
const detailCount = await detailButtons.count()
record('生成任务可展开详情', detailCount > 0, `detailButtons=${detailCount}`)
if (detailCount) {
  await detailButtons.first().click()
  await page.waitForTimeout(900)
  const detailText = await page.getByRole('dialog').innerText()
  record('任务详情含上游与积分信息', detailText.includes('上游') && detailText.includes('积分消耗'))
  record('任务详情含完整请求内容', detailText.includes('完整请求内容'))
  await page.getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(400)
}

/* 渠道页：编辑抽屉、模型能力与密钥脱敏 */
await goto('/admin/channels')
const channelEdit = page.getByRole('button', { name: /^编辑$/ }).first()
record('渠道卡片渲染', (await channelEdit.count()) > 0)
await channelEdit.click()
await page.waitForTimeout(1000)
const channelDialog = page.getByRole('dialog')
const channelText = await channelDialog.innerText()
record('渠道编辑抽屉打开', await channelDialog.isVisible())
record('渠道密钥输入为密码类型且不回显', (await channelDialog.locator('input[name="apiKey"]').getAttribute('type')) === 'password')
record('渠道编辑含连通性测试', channelText.includes('连通性测试'))
record('渠道编辑含拉取模型', channelText.includes('拉取模型列表'))
record('渠道编辑含能力配置', channelText.includes('模型能力配置'))
await page.getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(400)

const routingButton = page.getByRole('button', { name: '管理路由' })
if (await routingButton.count()) {
  await routingButton.click()
  await page.waitForTimeout(900)
  const routingText = await page.getByRole('dialog').innerText()
  record('路由编辑含默认模型与权重说明', routingText.includes('默认模型') && routingText.includes('权重'))
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(400)
}

/* 商品页：新增商品抽屉与订阅页展示字段 */
await goto('/admin/products')
await page.getByRole('button', { name: '新增商品' }).click()
await page.waitForTimeout(900)
const productDialog = page.getByRole('dialog')
const productText = await productDialog.innerText()
record('商品新增抽屉打开', await productDialog.isVisible())
record('商品抽屉含订阅页展示分组', productText.includes('订阅页展示') && productText.includes('基础权益'))
record('商品类型可切换为订阅套餐', (await productDialog.locator('select').first().locator('option').count()) >= 2)
await page.getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(400)

/* 订单页标签页 */
await goto('/admin/orders')
const orderTabs = await page.getByRole('button', { name: /订单与支付|优惠券|邀请返利/ }).count()
record('订单页含三个标签', orderTabs === 3, `tabs=${orderTabs}`)
await page.getByRole('button', { name: '优惠券' }).click()
await page.waitForTimeout(900)
record('优惠券标签可切换', (await page.locator('body').innerText()).includes('优惠券模板'))
await page.getByRole('button', { name: '邀请返利' }).click()
await page.waitForTimeout(900)
const referralText = await page.locator('body').innerText()
record('邀请返利标签含规则表单', referralText.includes('邀请奖励规则') && referralText.includes('邀请人积分'))

/* 内容页标签页与公告编辑器 */
await goto('/admin/content')
const contentTabs = await page.getByRole('button', { name: /公告管理|作品审核|举报与治理/ }).count()
record('内容页含三个标签', contentTabs === 3, `tabs=${contentTabs}`)
await page.getByRole('button', { name: '新增公告' }).click()
await page.waitForTimeout(900)
const announcementText = await page.getByRole('dialog').innerText()
record('公告编辑器含发布与弹窗开关', announcementText.includes('发布公告') && announcementText.includes('首页弹窗展示') && announcementText.includes('登录后弹窗展示'))
record('公告编辑器含生效区间', announcementText.includes('开始时间') && announcementText.includes('结束时间'))
await page.getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(400)

/* 设置页各分节 */
await goto('/admin/settings')
const settingsTabs = await page.getByRole('button', { name: /站点与品牌|注册与积分|计费与权益|生成限制与默认参数|邮件服务|对象存储|数据保留/ }).count()
record('设置页含七个分节', settingsTabs === 7, `tabs=${settingsTabs}`)
for (const label of ['注册与积分', '计费与权益', '生成限制与默认参数', '邮件服务', '对象存储', '数据保留']) {
  await page.getByRole('button', { name: label }).click()
  await page.waitForTimeout(700)
  const text = await page.locator('main').innerText()
  record(`设置分节可切换：${label}`, text.length > 80, `len=${text.length}`)
}

/* 保存路径必须走确认弹窗 */
await page.getByRole('button', { name: '站点与品牌' }).click()
await page.waitForTimeout(700)
const saveButton = page.getByRole('button', { name: /保存站点设置/ })
if (await saveButton.count()) {
  await saveButton.click()
  await page.waitForTimeout(800)
  const confirmText = await page.getByRole('dialog').innerText()
  record('设置保存前展示确认并列出变更', confirmText.includes('确认保存') || confirmText.includes('将提交'), confirmText.split('\n').slice(0, 2).join(' / '))
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(400)
}

/* 审计页筛选与详情脱敏 */
await goto('/admin/audit')
record('审计页含筛选控件', (await page.getByLabel('操作类型').count()) === 1 && (await page.getByLabel('结果').count()) === 1)
const auditDetail = page.getByRole('button', { name: '查看' }).first()
if (await auditDetail.count()) {
  await auditDetail.click()
  await page.waitForTimeout(800)
  const auditText = await page.getByRole('dialog').innerText()
  record('审计详情含操作者与 IP', auditText.includes('操作者') && auditText.includes('来源 IP'))
  record('审计详情说明脱敏', auditText.includes('脱敏'))
  const leaks = /sk-[A-Za-z0-9]{16,}|pbkdf2_sha256\$|\$2[aby]\$/.test(auditText)
  record('审计详情无明文密钥', !leaks, leaks ? 'DETECTED' : 'clean')
  await page.getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(400)
}

console.log(`\n控制台错误（去重）: ${[...new Set(errors)].slice(0, 8).join(' | ') || '无'}`)
const failed = results.filter((item) => !item.ok)
console.log(`\nFAILURES: ${failed.length}`)
if (failed.length) console.log(JSON.stringify(failed, null, 1))
await browser.close()
process.exit(failed.length ? 1 : 0)
