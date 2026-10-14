'use client'

import { useEffect, useRef, useState } from 'react'
import { createBillingOrder, createCheckout, request, type Checkout } from './api'

type Input = { accountId: string; connected: boolean; refreshSession: () => Promise<{ status: string; error?: string }>; onReady: (checkout: Checkout) => void }
type Attempt = { accountId: string; productId: string; provider: string; id?: string }
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : '暂时无法完成订单请求。'

/** Only the active account can expose checkout data or trigger a payment redirect. */
export function useBillingCheckout({ accountId, connected, refreshSession, onReady }: Input) {
  const scope = useRef({ accountId, connected, epoch: 0, accountEpoch: 0 })
  const attempt = useRef<Attempt | null>(null)
  const purchaseLock = useRef<number | null>(null)
  const queryLock = useRef<number | null>(null)
  if (scope.current.accountId !== accountId || scope.current.connected !== connected) {
    const accountChanged = scope.current.accountId !== accountId
    scope.current = { accountId, connected, epoch: scope.current.epoch + 1, accountEpoch: scope.current.accountEpoch + Number(accountChanged) }
    if (accountChanged) attempt.current = null
    purchaseLock.current = null; queryLock.current = null
  }
  const epoch = scope.current.epoch
  const [record, setRecord] = useState<{ epoch: number; checkout: Checkout } | null>(null)
  const [status, setStatus] = useState('')
  const [querying, setQuerying] = useState(false)
  const recordRef = useRef(record)
  recordRef.current = record
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setRecord(null); setStatus(''); setQuerying(false) }, [epoch])
  const checkout = record?.epoch === epoch && connected ? record.checkout : null
  const current = () => mounted.current && scope.current.epoch === epoch && scope.current.connected && scope.current.accountId === accountId

  async function purchase(productId: string, provider: string) {
    if (!current() || !accountId) throw new Error('请先登录后再购买商品。')
    if (!provider) throw new Error('当前没有可用的支付方式。')
    if (!productId) throw new Error('该周期没有可购买的商品。')
    if (purchaseLock.current !== null) throw new Error('正在处理当前订单，请稍候。')
    if (attempt.current && !attempt.current.id) throw new Error('上一笔订单的创建结果尚未确认，请先到账户的订单记录核对，避免重复创建。')
    purchaseLock.current = epoch
    const accountEpoch = scope.current.accountEpoch
    let order = attempt.current
    try {
      if (!order || order.productId !== productId || order.provider !== provider) {
        order = { accountId, productId, provider }
        attempt.current = order
        try {
          const created = await createBillingOrder(productId, provider)
          if (!created.order.id) throw new Error('未返回订单编号，请先到账户的订单记录核对。')
          // Preserve a confirmed ID across a temporary disconnect, never across an account change.
          if (scope.current.accountEpoch === accountEpoch && attempt.current === order) order.id = String(created.order.id)
        } catch (reason) {
          const definite = reason && typeof reason === 'object' && 'outcome' in reason && ['rejected', 'failed', 'expired', 'not-found'].includes(String(reason.outcome))
          if (definite && attempt.current === order) attempt.current = null
          throw new Error(definite ? messageOf(reason) : `创建结果暂未确认，请先到账户的订单记录核对，勿重复购买。${messageOf(reason)}`)
        }
      }
      if (!current()) return
      if (!order.id) throw new Error('订单编号尚未确认，请先查看账户的订单记录。')
      const result = await createCheckout(order.id, provider)
      if (!current()) return
      const next = { epoch, checkout: result.checkout }
      recordRef.current = next; setRecord(next); setStatus('待支付')
      onReady(result.checkout)
    } catch (reason) { if (current()) throw reason }
    finally { if (purchaseLock.current === epoch) purchaseLock.current = null }
  }

  function close() { recordRef.current = null; setRecord(null); setStatus('') }
  async function refreshOrder() {
    if (!current() || !checkout || queryLock.current !== null) return
    const orderId = checkout.orderId
    const valid = () => current() && recordRef.current?.checkout.orderId === orderId
    queryLock.current = epoch; setQuerying(true); setStatus('查询中…')
    try {
      const result = await request<{ order: { status: string } }>(`/api/billing/orders/${encodeURIComponent(orderId)}`)
      if (!valid()) return
      const labels: Record<string, string> = { paid: '支付成功', pending: '待支付', canceled: '已取消', cancelled: '已取消', closed: '已关闭', refunded: '已退款' }
      const label = labels[result.order.status] || result.order.status
      setStatus(label)
      if (result.order.status !== 'pending' && attempt.current?.id === orderId) attempt.current = null
      if (result.order.status === 'paid' || result.order.status === 'refunded') {
        const session = await refreshSession()
        if (valid() && session.status !== 'connected') setStatus(`${label}；账户数据暂未同步，请稍后重新同步。`)
      }
    } catch (reason) { if (valid()) setStatus(`查询结果暂未确认：${messageOf(reason)}`) }
    finally { if (queryLock.current === epoch) { queryLock.current = null; if (current()) setQuerying(false) } }
  }
  return { checkout, orderStatus: checkout ? status : '', querying, purchase, refreshOrder, close }
}
