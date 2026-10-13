'use client'

import Link from 'next/link'
import { SiteBrand } from '@/components/site-brand'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MembershipPurchaseView } from './membership-purchase-view'
import { billingOptions, toMembershipPlans } from '@/lib/studio/membership'
import { listBillingProducts, type BillingProduct, type BillingAccess } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import type { MembershipSelection } from './types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import QRCode from 'qrcode'
import { RETURN_PATH_KEY, safeReturnPath } from '@/lib/studio/return-path'
import { useBillingCheckout } from '@/lib/studio/use-billing-checkout'

export function PlansPage() {
  const router = useRouter()
  const { state, refreshSession } = useStudio()
  const [returnPath, setReturnPath] = useState('/studio')
  useEffect(() => {
    let previous: string | null = null
    try { previous = sessionStorage.getItem(RETURN_PATH_KEY) } catch {}
    setReturnPath(safeReturnPath(new URLSearchParams(window.location.search).get('returnTo') || previous))
  }, [])
  const [products, setProducts] = useState<BillingProduct[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [qrState, setQrState] = useState<{ key: string; image?: string; error?: string } | null>(null)
  const billingCheckout = useBillingCheckout({ accountId: state.user.id, connected: state.backendStatus === 'connected', refreshSession, onReady: (checkout) => {
    if (checkout.kind === 'redirect' && checkout.url) window.location.assign(checkout.url)
    if (checkout.kind === 'form' && checkout.form) {
      const form = document.createElement('form')
      form.action = checkout.form.action; form.method = checkout.form.method
      for (const field of checkout.form.fields) {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = field.name; input.value = field.value; form.appendChild(input)
      }
      document.body.appendChild(form); form.submit(); form.remove()
    }
  } })
  const { checkout, orderStatus } = billingCheckout
  const qrContent = checkout?.kind === 'qr' ? checkout.qrContent || checkout.url : undefined
  const qrKey = `${checkout?.orderId || ''}:${qrContent || ''}`
  const qrImage = qrState?.key === qrKey ? qrState.image : undefined
  const qrError = qrState?.key === qrKey ? qrState.error : undefined
  // 默认按自用模式处理，避免计费接口异常时把充值入口误开放。
  const [billing, setBilling] = useState<BillingAccess>({ mode: 'self_use', rechargeEnabled: false })
  const load = useCallback(async () => {
    setStatus('loading'); setError('')
    try {
      const result = await listBillingProducts()
      setProducts(result.products)
      setProviders(result.paymentProviders)
      setBilling(result.billing ?? { mode: 'self_use', rechargeEnabled: false })
      setProvider(current => result.paymentProviders.includes(current) ? current : result.paymentProviders[0] || '')
      setStatus('ready')
    } catch (reason) { setBilling({ mode: 'self_use', rechargeEnabled: false }); setError(reason instanceof Error ? reason.message : '套餐加载失败'); setStatus('error') }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let active = true
    setQrState(null)
    if (qrContent) void QRCode.toDataURL(qrContent, { width: 280, margin: 2 }).then(url => { if (active) setQrState({ key: qrKey, image: url }) }).catch(() => { if (active) setQrState({ key: qrKey, error: '二维码生成失败，请重新打开支付。' }) })
    return () => { active = false }
  }, [qrContent, qrKey])
  const plans = useMemo(() => toMembershipPlans(products), [products])
  const availableCycles = billingOptions.filter(option => plans.some(plan => plan.tiers.some(t => t.pricing[option.value])))
  const options = availableCycles.length ? availableCycles : billingOptions

  async function purchase(selection: MembershipSelection) {
    await billingCheckout.purchase(selection.pricing.productId || '', provider)
  }
  return <div className="min-h-dvh bg-black text-zinc-100">
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 pr-16 text-sm">
      <Link href={returnPath} aria-label="返回创作" className="inline-flex items-center"><SiteBrand tone="dark" imageClassName="h-7" /></Link>
      <div className="flex flex-wrap items-center gap-4">
        {providers.length > 0 && <label>支付方式 <select aria-label="支付方式" value={provider} onChange={e => setProvider(e.target.value)} className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1">{providers.map(p => <option key={p} value={p}>{({manual:'人工支付', epay:'在线支付', stripe:'银行卡', ciyuan:'词元余额'} as Record<string,string>)[p] || p}</option>)}</select></label>}
        <Link href={state.backendStatus === 'connected' ? '/account' : '/login?next=/plans'}>{state.backendStatus === 'connected' ? '账户与订单' : '登录'}</Link>
        {state.backendStatus === 'connected' && state.user.role === 'admin' && <Link href="/admin/products">管理套餐</Link>}
      </div>
    </div>
    {status === 'loading' ? (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-2xl items-center justify-center px-6 py-16"><p className="text-sm text-white/60">正在读取套餐与购买状态…</p></div>
    ) : status === 'error' ? (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-2xl items-center justify-center px-6 py-16"><section className="w-full rounded-3xl border border-red-300/20 bg-red-300/[0.06] p-8 text-center"><p className="text-sm text-red-100">{error || '套餐加载失败'}</p><Button className="mt-6" onClick={() => void load()}>重新加载</Button></section></div>
    ) : !billing.rechargeEnabled ? (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-2xl items-center justify-center px-6 py-16">
        <section className="w-full rounded-3xl border border-white/15 bg-white/[0.06] p-8 text-center shadow-2xl shadow-black/20 backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">{billing.mode === 'commercial' ? '商用模式配置中' : '自用模式'}</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{billing.mode === 'commercial' ? '套餐购买暂未开放' : '充值与在线支付暂未开放'}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/60">{billing.mode === 'commercial' ? billing.purchaseReadiness?.ready ? '购买政策已发布，支付渠道尚未配置完成。支付服务准备就绪后将开放购买，已有积分仍可正常使用。' : '站点已经切换到商用模式，但购买政策和公开协议还没有完整发布。完成配置后，这里会自动开放套餐购买。' : '当前站点用于内部创作与测试，用户充值、套餐购买和在线支付入口已关闭。已有积分仍可正常使用。'}</p>
          {billing.mode === 'commercial' && billing.purchaseReadiness?.missing?.length ? <ul className="mx-auto mt-5 max-w-md space-y-1 text-left text-xs leading-5 text-amber-100/80">{billing.purchaseReadiness.missing.map((item) => <li key={item}>• {item}</li>)}</ul> : null}
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Link href={returnPath} className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-black transition-opacity hover:opacity-85">返回工作台</Link>
            {billing.mode === 'commercial' && state.backendStatus === 'connected' && state.user?.role === 'admin' ? <Link href="/admin/settings" className="inline-flex h-10 items-center rounded-full border border-white/20 px-5 text-sm font-medium text-white hover:bg-white/10">{billing.purchaseReadiness?.ready ? '打开支付设置' : '打开购买政策设置'}</Link> : null}
          </div>
        </section>
      </div>
    ) : (
      <MembershipPurchaseView key={`${state.user.id}:${state.backendStatus}:${options.map(o => o.value).join(',')}`} products={plans} billingOptions={options} initialBillingCycle={options[0].value} generationColumns={[]} generationRows={[]} faqItems={[]} status={status} errorMessage={error} onRetry={load} onSelectPlan={purchase} onClose={() => router.push(returnPath)} />
    )}
    <Dialog open={!!checkout} onOpenChange={open => { if (!open) billingCheckout.close() }}>
      <DialogContent><DialogHeader><DialogTitle>支付订单</DialogTitle><DialogDescription>{checkout?.orderNo} · {orderStatus}</DialogDescription></DialogHeader>
        {checkout?.kind === 'manual' && <div className="space-y-3"><p className="whitespace-pre-wrap break-words">{checkout.instructions?.trim() || '订单已创建，请联系管理员获取付款说明。'}</p><p className="text-sm text-muted-foreground">管理员核实收款后，积分将计入账户。请保留订单号，避免重复付款。</p></div>}
        {checkout?.kind === 'qr' && (qrImage ? <img src={qrImage} alt="支付二维码" width={280} height={280} className="mx-auto max-w-full" /> : <p role={qrError ? 'alert' : 'status'}>{qrError || '正在生成支付二维码'}</p>)}
        {checkout?.url && <a href={checkout.url} rel="noreferrer" target="_blank">前往支付</a>}
        <Button onClick={billingCheckout.refreshOrder} disabled={billingCheckout.querying || state.backendStatus !== 'connected'}>{billingCheckout.querying ? '正在查询…' : '查询支付结果'}</Button>
      </DialogContent>
    </Dialog>
  </div>
}
