import { TEST_PASSWORD } from './test-credentials.mjs'
/**
 * 本地人工支付闭环验收。
 *
 * 覆盖：创建订单 → 继续支付参数 → 人工确认支付 → 积分与权益同步 →
 * 重复确认（幂等）→ 退款权限。全部走本地 manual 渠道，不接触任何真实支付网关。
 *
 * 前置：前端 3310、后端、本地 Postgres 均在运行；管理员账号具备 billing.manage。
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

try {
  /* 1) 可购买商品与支付渠道 */
  const products = await page.evaluate(async () => {
    const response = await fetch('/api/billing/products', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    return { status: response.status, products: payload?.products ?? [], providers: payload?.paymentProviders ?? [] }
  })
  check('可读取商品列表', products.status === 200 && products.products.length > 0, `${products.products.length} 个商品`)
  check('本地环境只启用 manual 支付渠道', products.providers.length > 0 && products.providers.every((item) => item === 'manual'), `providers=${products.providers.join(',')}`)

  const sellable = products.products.find((item) => item.enabled && Number(item.amountCents) > 0)
  check('存在可下单的积分商品', Boolean(sellable), sellable ? `${sellable.name} ${sellable.amountCents}分` : '无')

  if (sellable) {
    /* 2) 创建订单 */
    const created = await page.evaluate(async (productId) => {
      const response = await fetch('/api/billing/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity: 1, provider: 'manual' }),
      })
      const payload = await response.json().catch(() => null)
      return { status: response.status, order: payload?.data?.order ?? payload?.order ?? null, msg: payload?.error || payload?.msg }
    }, sellable.id)
    check('创建待支付订单', created.status === 200 && Boolean(created.order?.id), `status=${created.status} orderNo=${created.order?.orderNo} msg=${created.msg || ''}`)

    if (created.order?.id) {
      const orderId = created.order.id
      const orderNo = created.order.orderNo

      /* 3) 继续支付参数（待支付订单可重新获取） */
      const checkout = await page.evaluate(async (id) => {
        const response = await fetch(`/api/billing/orders/${id}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'manual' }),
        })
        const payload = await response.json().catch(() => null)
        return { status: response.status, kind: payload?.data?.checkout?.kind ?? payload?.checkout?.kind, msg: payload?.msg || payload?.error }
      }, orderId)
      check('待支付订单可继续支付（返回支付参数）', checkout.status === 200 && Boolean(checkout.kind), `kind=${checkout.kind} msg=${checkout.msg || ''}`)

      /* 4) 支付前快照 */
      const before = await page.evaluate(async () => {
        const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
        const points = await (await fetch('/api/points?page=1&pageSize=1', { cache: 'no-store' })).json()
        return { balance: Number(session?.user?.pointsBalance ?? 0), records: points?.total ?? 0 }
      })

      /* 5) 人工确认支付（管理员接口，本地人工渠道） */
      const completed = await page.evaluate(async ({ id, no }) => {
        const response = await fetch(`/api/admin/billing/orders/${id}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'manual', channel: 'manual-confirm', providerTradeId: `local-manual-${no}`, paidAt: new Date().toISOString() }),
        })
        const payload = await response.json().catch(() => null)
        return { status: response.status, orderStatus: payload?.order?.status, pointsGranted: payload?.pointsGranted, msg: payload?.error || payload?.msg }
      }, { id: orderId, no: orderNo })
      check('人工确认支付成功', completed.status === 200 && completed.orderStatus === 'paid', `status=${completed.status} orderStatus=${completed.orderStatus} msg=${completed.msg || ''}`)

      /* 6) 积分与账单同步 */
      const after = await page.evaluate(async () => {
        const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
        const points = await (await fetch('/api/points?page=1&pageSize=5', { cache: 'no-store' })).json()
        return { balance: Number(session?.user?.pointsBalance ?? 0), records: points?.total ?? 0, latest: points?.records?.[0] }
      })
      check('支付后积分余额增加', after.balance > before.balance, `${before.balance} → ${after.balance}`)
      check('支付后产生充值流水', after.records > before.records, `${before.records} → ${after.records} 条`)
      check('充值流水类型为 credit', after.latest?.type === 'credit', `type=${after.latest?.type} amount=${after.latest?.amount}`)

      /* 7) 重复确认同一订单必须幂等，不重复发放积分 */
      const duplicate = await page.evaluate(async ({ id, no }) => {
        const response = await fetch(`/api/admin/billing/orders/${id}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'manual', channel: 'manual-confirm', providerTradeId: `local-manual-${no}`, paidAt: new Date().toISOString() }),
        })
        const payload = await response.json().catch(() => null)
        const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
        const points = await (await fetch('/api/points?page=1&pageSize=1', { cache: 'no-store' })).json()
        return { status: response.status, orderStatus: payload?.order?.status, balance: Number(session?.user?.pointsBalance ?? 0), records: points?.total ?? 0, msg: payload?.error || payload?.msg }
      }, { id: orderId, no: orderNo })
      check('重复确认同一订单不报错', duplicate.status === 200 || duplicate.status === 409, `status=${duplicate.status} msg=${duplicate.msg || ''}`)
      check('重复确认不重复发放积分', duplicate.balance === after.balance, `${after.balance} → ${duplicate.balance}`)
      check('重复确认不重复写流水', duplicate.records === after.records, `${after.records} → ${duplicate.records} 条`)

      /* 8) 订单状态与订单列表一致 */
      const listed = await page.evaluate(async (id) => {
        const response = await fetch(`/api/billing/orders/${id}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        return { status: response.status, orderStatus: payload?.data?.order?.status ?? payload?.order?.status }
      }, orderId)
      check('订单详情状态为已支付', listed.orderStatus === 'paid', `status=${listed.orderStatus}`)

      /* 9) 界面：账户页订单显示已支付状态（必须在退款之前断言） */
      await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(3000)
      await page.click('button:has-text("订单记录")')
      await page.waitForTimeout(4000)
      const ordersBody = await page.locator('body').innerText()
      check('账户页显示该订单为已支付', ordersBody.includes(orderNo) && /已支付/.test(ordersBody), `orderNo=${orderNo}`)
      const rowHasRefundButton = await page.evaluate((no) => {
        const row = Array.from(document.querySelectorAll('tr')).find((item) => item.innerText.includes(no))
        return row ? row.innerText : ''
      }, orderNo)
      check('已支付订单不再提供继续支付按钮', !/继续支付/.test(rowHasRefundButton), rowHasRefundButton.replace(/\n/g, ' | ').slice(0, 100))

      /* 10) 退款：扣回积分并写退款流水，权限由管理员接口校验 */
      const beforeRefund = await page.evaluate(async () => {
        const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
        return Number(session?.user?.pointsBalance ?? 0)
      })
      const refunded = await page.evaluate(async (id) => {
        const response = await fetch(`/api/admin/billing/orders/${id}/refund`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '本地回归验证' }),
        })
        const payload = await response.json().catch(() => null)
        return { status: response.status, orderStatus: payload?.order?.status, msg: payload?.error || payload?.msg }
      }, orderId)
      check('管理员可发起退款', refunded.status === 200, `status=${refunded.status} orderStatus=${refunded.orderStatus} msg=${refunded.msg || ''}`)
      const afterRefund = await page.evaluate(async () => {
        const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
        return Number(session?.user?.pointsBalance ?? 0)
      })
      check('退款后积分被扣回', afterRefund < beforeRefund, `${beforeRefund} → ${afterRefund}`)

      /* 11) 重复退款幂等 */
      const duplicateRefund = await page.evaluate(async (id) => {
        const response = await fetch(`/api/admin/billing/orders/${id}/refund`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '重复退款验证' }),
        })
        const payload = await response.json().catch(() => null)
        const session = await (await fetch('/api/auth/session', { cache: 'no-store' })).json()
        return { status: response.status, balance: Number(session?.user?.pointsBalance ?? 0), msg: payload?.error || payload?.msg }
      }, orderId)
      check('重复退款被拒绝或幂等', duplicateRefund.status === 409 || duplicateRefund.status === 200, `status=${duplicateRefund.status} msg=${duplicateRefund.msg || ''}`)
      check('重复退款不再次扣减积分', duplicateRefund.balance === afterRefund, `${afterRefund} → ${duplicateRefund.balance}`)
    }
  }
} finally {
  const failed = results.filter((item) => !item.ok)
  console.log(`\n总计 ${results.length} 项，失败 ${failed.length} 项`)
  if (failed.length) console.log(JSON.stringify(failed, null, 1))
  await browser.close()
  process.exit(failed.length ? 1 : 0)
}
