/**
 * 积分流水统计与月度聚合单元测试。
 *
 * 覆盖两个容易出错的点：
 * 1. 超过 100 条流水时必须逐页聚合，不能只统计第一页；
 * 2. 跨月必须按业务时区（Asia/Shanghai）归属，不能用 UTC 导致月初流水算进上月。
 *
 * 统计逻辑在 `lib/studio/ledger.ts`（纯函数、无网络依赖），因此可以直接导入测试；
 * 分页行为通过注入分页读取函数来驱动。
 *
 * 前端工程未引入测试框架且不允许改动 package.json，故以 Node 脚本运行。
 */
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const here = resolve(import.meta.dirname ?? '.')

// Node 22 支持通过 --experimental-strip-types 运行 TS；若当前 Node 不支持，
// 这里用一个最小的 TS 类型擦除加载器兜底，避免为了测试改动工程依赖。
let ledger
try {
  ledger = await import(pathToFileURL(resolve(here, '../lib/studio/ledger.ts')).href)
} catch (error) {
  console.log(`无法直接导入 TS 源码（${error.code || error.message}），改用类型擦除加载。`)
  register(new URL('./ts-strip-loader.mjs', import.meta.url))
  ledger = await import(pathToFileURL(resolve(here, '../lib/studio/ledger.ts')).href)
}

const {
  ledgerCategoryOf,
  ledgerMonthOf,
  summarizeLedgerMonth,
  currentLedgerMonth,
  summarizePointRecordsWith,
} = ledger

let passed = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`FAIL ${name} :: ${error.message}`)
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`FAIL ${name} :: ${error.message}`)
  }
}

/* ------------------------------- 流水分类 ------------------------------- */

test('按后端 type 分类，而不是按金额正负', () => {
  assert.equal(ledgerCategoryOf('consume'), 'consume')
  assert.equal(ledgerCategoryOf('refund'), 'refund')
  assert.equal(ledgerCategoryOf('credit'), 'recharge')
  assert.equal(ledgerCategoryOf('admin-adjust'), 'adjust')
  assert.equal(ledgerCategoryOf('grant'), 'grant')
  assert.equal(ledgerCategoryOf('expire'), 'expire')
  // 未知类型归入 adjust，不能当成消费或退款。
  assert.equal(ledgerCategoryOf('something-new'), 'adjust')
})

test('credit 需按幂等键区分充值（订单）与赠送（邀请奖励）', () => {
  assert.equal(ledgerCategoryOf('credit', { idempotencyKey: 'billing-order:abc:credit' }), 'recharge')
  assert.equal(ledgerCategoryOf('credit', { idempotencyKey: 'referral-reward:xyz:credit' }), 'grant')
})

test('admin-adjust 需区分订单退款与人工调整', () => {
  // 订单退款由后端写成 admin-adjust + 负金额 + billing-order:<id>:refund，
  // 业务上是退款，算进「调整」会让退款金额少算。
  assert.equal(ledgerCategoryOf('admin-adjust', { amount: -1000, idempotencyKey: 'billing-order:abc:refund' }), 'refund')
  // 管理员手工调整（admin-adjust:<user>:<uuid>）才是调整。
  assert.equal(ledgerCategoryOf('admin-adjust', { amount: 100, idempotencyKey: 'admin-adjust:user:uuid' }), 'adjust')
  assert.equal(ledgerCategoryOf('admin-adjust', { amount: -30, idempotencyKey: 'admin-adjust:user:uuid' }), 'adjust')
  // 没有幂等键时保守归入调整，不臆断为退款。
  assert.equal(ledgerCategoryOf('admin-adjust', { amount: -30 }), 'adjust')
})

test('金额为 0 的退款仍按 type 归为退款，不被当成收入', () => {
  assert.equal(ledgerCategoryOf('refund', { amount: 0 }), 'refund')
})

/* --------------------------- 业务时区月份归属 --------------------------- */

test('北京时间月初 00:30 属于当月，不是 UTC 的上个月', () => {
  const record = { createdAt: '2026-03-01T00:30:00+08:00' }
  assert.equal(ledgerMonthOf(record), '2026-03')
  // 用 UTC 取月会得到 2026-02，正是要避免的错误。
  assert.equal(new Date(record.createdAt).toISOString().slice(0, 7), '2026-02')
})

test('北京时间月末 23:30 属于当月', () => {
  assert.equal(ledgerMonthOf({ createdAt: '2026-03-31T23:30:00+08:00' }), '2026-03')
})

test('优先使用后端给出的 sourceDate', () => {
  assert.equal(ledgerMonthOf({ sourceDate: '2026-01-15', createdAt: '2026-02-20T10:00:00+08:00' }), '2026-01')
})

test('时间不可解析时安全回落而不是抛错', () => {
  assert.doesNotThrow(() => ledgerMonthOf({ createdAt: 'not-a-date' }))
  assert.equal(ledgerMonthOf({ createdAt: '' }), '')
})

/* ------------------------------- 月度统计 ------------------------------- */

const trendSummary = {
  rows: [],
  totals: { consume: 0, refund: 0, recharge: 0, grant: 0, expire: 0, adjust: 0 },
  trend: [
    { date: '2026-02-28', consume: 5, refund: 0, recharge: 0, grant: 0, expire: 0 },
    { date: '2026-03-01', consume: 10, refund: 3, recharge: 100, grant: 7, expire: 0 },
    { date: '2026-03-15', consume: 20, refund: 1, recharge: 0, grant: 0, expire: 2 },
  ],
  scanned: 3,
  scannedPages: 1,
  truncated: false,
}

test('只统计目标月份，不混入相邻月份', () => {
  const march = summarizeLedgerMonth(trendSummary, '2026-03')
  assert.equal(march.consume, 30)
  assert.equal(march.refund, 4)
  assert.equal(march.recharge, 100)
  assert.equal(march.grant, 7)
  assert.equal(march.expire, 2)
  const february = summarizeLedgerMonth(trendSummary, '2026-02')
  assert.equal(february.consume, 5)
  assert.equal(february.recharge, 0)
})

test('透传截断状态，提示合计可能偏小', () => {
  assert.equal(summarizeLedgerMonth(trendSummary, '2026-03').truncated, false)
  assert.equal(summarizeLedgerMonth({ ...trendSummary, truncated: true }, '2026-03').truncated, true)
})

test('当前月份键使用业务时区', () => {
  assert.equal(currentLedgerMonth('Asia/Shanghai', new Date('2026-03-01T00:30:00+08:00')), '2026-03')
})

/* ------------------------- 超过 100 条逐页聚合 ------------------------- */

/** 造 count 条跨两个月、类型混合的流水。 */
function makeRecords(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = index < 60 ? '2026-03-10T10:00:00+08:00' : '2026-02-10T10:00:00+08:00'
    const type = index % 3 === 0 ? 'consume' : index % 3 === 1 ? 'refund' : 'credit'
    const amount = index % 3 === 0 ? -2 : index % 3 === 1 ? 2 : 50
    return {
      id: `record-${index}`,
      type,
      amount,
      balanceAfter: 0,
      permanentAmount: 0,
      dailyAmount: 0,
      permanentBalanceAfter: 0,
      dailyBalanceAfter: 0,
      description: `记录 ${index}`,
      idempotencyKey: type === 'credit' ? 'billing-order:x:credit' : undefined,
      createdAt: date,
    }
  })
}

/** 用内存数据模拟后端分页接口，记录每次请求的页码。 */
function pagedFetcher(records, calls) {
  return async ({ page, pageSize }) => {
    calls.push({ page, pageSize })
    return {
      records: records.slice((page - 1) * pageSize, page * pageSize),
      total: records.length,
      page,
      pageSize,
    }
  }
}

await testAsync('超过 100 条时逐页拉取而不是只读第一页', async () => {
  const records = makeRecords(123)
  const calls = []
  const result = await summarizePointRecordsWith(pagedFetcher(records, calls), { maxPages: 10, pageSize: 50 })
  // 123 条 / 每页 50 → 必须有 3 次请求。
  assert.equal(calls.length, 3)
  assert.equal(result.scanned, 123)
  assert.equal(result.scannedPages, 3)
  assert.equal(result.truncated, false)
  // 总额必须等于全部记录绝对值之和，而不是第一页之和。
  const expectedTotal = records.reduce((total, record) => total + Math.abs(record.amount), 0)
  const actualTotal = Object.values(result.totals).reduce((total, value) => total + value, 0)
  assert.equal(actualTotal, expectedTotal)
})

await testAsync('跨月流水分别归入各自月份', async () => {
  const records = makeRecords(123)
  const result = await summarizePointRecordsWith(pagedFetcher(records, []), { maxPages: 10, pageSize: 50 })
  const march = summarizeLedgerMonth(result, '2026-03')
  const february = summarizeLedgerMonth(result, '2026-02')
  assert.ok(march.consume > 0, '三月应有消费')
  assert.ok(february.consume > 0, '二月应有消费')
  assert.equal(march.consume + february.consume, result.totals.consume)
  // 月度合计不得把相邻月份算进来。
  const marchRecords = records.filter((record) => record.createdAt.startsWith('2026-03'))
  const expectedMarchConsume = marchRecords.filter((record) => record.type === 'consume').reduce((total, record) => total + Math.abs(record.amount), 0)
  assert.equal(march.consume, expectedMarchConsume)
})

await testAsync('达到 maxPages 时标记截断而不是谎称统计完整', async () => {
  const records = makeRecords(123)
  const result = await summarizePointRecordsWith(pagedFetcher(records, []), { maxPages: 1, pageSize: 50 })
  assert.equal(result.scanned, 50)
  assert.equal(result.truncated, true)
})

await testAsync('充值只统计订单流水，邀请奖励单独归为赠送', async () => {
  const records = [
    { id: 'a', type: 'credit', amount: 1000, idempotencyKey: 'billing-order:1:credit', createdAt: '2026-03-05T10:00:00+08:00' },
    { id: 'b', type: 'credit', amount: 50, idempotencyKey: 'referral-reward:2:credit', createdAt: '2026-03-06T10:00:00+08:00' },
  ].map((record) => ({ ...record, balanceAfter: 0, permanentAmount: 0, dailyAmount: 0, permanentBalanceAfter: 0, dailyBalanceAfter: 0, description: '' }))
  const result = await summarizePointRecordsWith(pagedFetcher(records, []), { maxPages: 5, pageSize: 50 })
  assert.equal(result.totals.recharge, 1000)
  assert.equal(result.totals.grant, 50)
  const march = summarizeLedgerMonth(result, '2026-03')
  assert.equal(march.recharge, 1000)
  assert.equal(march.grant, 50)
})

await testAsync('空流水不报错且统计为 0', async () => {
  const result = await summarizePointRecordsWith(pagedFetcher([], []), { maxPages: 5, pageSize: 50 })
  assert.equal(result.scanned, 0)
  assert.equal(result.truncated, false)
  assert.equal(Object.values(result.totals).reduce((total, value) => total + value, 0), 0)
})

console.log(`\n总计 ${passed + failures.length} 项，失败 ${failures.length} 项`)
if (failures.length) console.log(JSON.stringify(failures, null, 1))
process.exit(failures.length ? 1 : 0)
