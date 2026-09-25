'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MembershipPurchaseView } from './membership-purchase-view'
import { billingOptions, toMembershipPlans } from '@/lib/studio/membership'
import { createBillingOrder, createCheckout, listBillingProducts, request, type BillingProduct, type Checkout } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import type { MembershipSelection } from './types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import QRCode from 'qrcode'

export function PlansPage() {
  const router = useRouter()
  const { state, refreshSession } = useStudio()
  const [products, setProducts] = useState<BillingProduct[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [orderStatus, setOrderStatus] = useState('')
  const [qrImage, setQrImage] = useState('')
  const [pendingOrder, setPendingOrder] = useState<{ id: string; productId: string; provider: string } | null>(null)
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await listBillingProducts()
      setProducts(result.products)
      setProviders(result.paymentProviders)
      setProvider(current => result.paymentProviders.includes(current) ? current : result.paymentProviders[0] || '')
      setStatus('ready')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '套餐加载失败'); setStatus('error') }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let active = true
    setQrImage('')
    const content = checkout?.kind === 'qr' ? checkout.qrContent || checkout.url : undefined
    if (content) void QRCode.toDataURL(content, { width: 280, margin: 2 }).then(url => { if (active) setQrImage(url) }).catch(() => { if (active) setOrderStatus('二维码生成失败，请重新打开支付') })
    return () => { active = false }
  }, [checkout])
  const plans = useMemo(() => toMembershipPlans(products), [products])
  const availableCycles = billingOptions.filter(option => plans.some(plan => plan.tiers.some(t => t.pricing[option.value])))
  const options = availableCycles.length ? availableCycles : billingOptions

  async function purchase(selection: MembershipSelection) {
    if (state.backendStatus !== 'connected') throw new Error('请先登录后再购买套餐。')
    if (!provider) throw new Error('当前没有可用的支付方式。')
    const productId = selection.pricing.productId
    if (!productId) throw new Error('该周期没有可购买的商品。')
    let order = pendingOrder
    if (!order || order.productId !== productId || order.provider !== provider) {
      const created = await createBillingOrder(productId, provider)
      if (!created.order.id) throw new Error('未返回订单编号')
      order = { id: String(created.order.id), productId, provider }
      setPendingOrder(order)
    }
    const result = await createCheckout(order.id, provider)
    setCheckout(result.checkout)
    setOrderStatus('待支付')
    if (result.checkout.kind === 'redirect' && result.checkout.url) window.location.assign(result.checkout.url)
    if (result.checkout.kind === 'form' && result.checkout.form) {
      const form = document.createElement('form')
      form.action = result.checkout.form.action
      form.method = result.checkout.form.method
      for (const field of result.checkout.form.fields) {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = field.name; input.value = field.value; form.appendChild(input)
      }
      document.body.appendChild(form); form.submit(); form.remove()
    }
  }
  async function refreshOrder() {
    if (!checkout) return
    setOrderStatus('查询中…')
    try {
      const result = await request<{ order: { status: string } }>(`/api/billing/orders/${encodeURIComponent(checkout.orderId)}`)
      const labels: Record<string, string> = { paid: '支付成功', pending: '待支付', canceled: '已取消', closed: '已关闭', refunded: '已退款' }
      setOrderStatus(labels[result.order.status] || result.order.status)
      if (result.order.status !== 'pending') setPendingOrder(null)
      /**
       * 支付到账后必须同步余额与套餐权益。
       *
       * 早先这里只更新订单文字，用户看到「支付成功」但页头积分与套餐仍是旧值，
       * 必须手动刷新页面。现在支付状态离开 pending 时立即重读会话
       * （refreshSession 会刷新用户、积分、模型目录与账户数据）。
       */
      if (result.order.status === 'paid' || result.order.status === 'refunded') {
        await refreshSession()
      }
    } catch (reason) {
      setOrderStatus(reason instanceof Error ? reason.message : '查询失败')
    }
  }
  return <div className="min-h-dvh bg-black text-zinc-100">
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 pr-16 text-sm">
      <Link href="/" className="font-semibold">OAOOAO</Link>
      <div className="flex flex-wrap items-center gap-4">
        {providers.length > 0 && <label>支付方式 <select aria-label="支付方式" value={provider} onChange={e => setProvider(e.target.value)} className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1">{providers.map(p => <option key={p} value={p}>{({manual:'人工支付', epay:'在线支付', stripe:'银行卡', ciyuan:'词元余额'} as Record<string,string>)[p] || p}</option>)}</select></label>}
        <Link href={state.backendStatus === 'connected' ? '/account' : '/login?next=/plans'}>{state.backendStatus === 'connected' ? '账户与订单' : '登录'}</Link>
        {state.backendStatus === 'connected' && state.user.role === 'admin' && <Link href="/admin/products">管理套餐</Link>}
      </div>
    </div>
    <MembershipPurchaseView key={options.map(o => o.value).join(',')} products={plans} billingOptions={options} initialBillingCycle={options[0].value} generationColumns={[]} generationRows={[]} faqItems={[]} status={status} errorMessage={error} onRetry={load} onSelectPlan={purchase} onClose={() => router.push('/')} />
    <Dialog open={!!checkout} onOpenChange={open => { if (!open) setCheckout(null) }}>
      <DialogContent><DialogHeader><DialogTitle>支付订单</DialogTitle><DialogDescription>{checkout?.orderNo} · {orderStatus}</DialogDescription></DialogHeader>
        {checkout?.kind === 'manual' && <p>订单已创建，请联系管理员完成支付。</p>}
        {checkout?.kind === 'qr' && (qrImage ? <img src={qrImage} alt="支付二维码" width={280} height={280} className="mx-auto max-w-full" /> : <p>正在生成支付二维码</p>)}
        {checkout?.url && <a href={checkout.url} rel="noreferrer" target="_blank">前往支付</a>}
        <Button onClick={refreshOrder}>查询支付结果</Button>
      </DialogContent>
    </Dialog>
  </div>
}
