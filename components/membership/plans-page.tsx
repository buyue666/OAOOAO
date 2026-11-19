'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Coins, Crown, UserRound } from 'lucide-react'
import QRCode from 'qrcode'
import { SiteBrand } from '@/components/site-brand'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { listBillingProducts, type BillingProduct, type BillingAccess, type TeamPurchaseInput } from '@/lib/studio/api'
import { billingOptions, storefrontProducts, toMembershipPlans } from '@/lib/studio/membership'
import { billingStoreHref, billingStoreView, type BillingStoreView } from '@/lib/studio/billing-store-route'
import type { CommercePolicy } from '@/lib/studio/commerce-policy'
import { RETURN_PATH_KEY, safeReturnPath } from '@/lib/studio/return-path'
import { useStudio } from '@/lib/studio/store'
import { useBillingCheckout } from '@/lib/studio/use-billing-checkout'
import { MembershipPurchaseView } from './membership-purchase-view'
import { TeamPlansPage } from './team-plans-page'
import type { MembershipSelection } from './types'
import styles from './membership.module.css'

const paymentNames: Record<string, string> = { manual: '人工支付', epay: '在线支付', stripe: '银行卡', ciyuan: '词元余额', ciyuan_balance: 'New API 余额支付' }

export function PlansPage({ initialView, explicitReturnPath }: { initialView: BillingStoreView; explicitReturnPath?: string }) {
  const router = useRouter()
  const query = useSearchParams()
  const { state, refreshSession } = useStudio()
  const view = query ? billingStoreView(query.get('view'), query.get('edition')) : initialView
  const pointsStore = view === 'credits'
  const connected = state.backendStatus === 'connected'
  const productKind = pointsStore ? 'points' : 'plan'
  const pageTitle = pointsStore ? '积分超市' : '会员订阅'
  const [returnPath, setReturnPath] = useState(() => safeReturnPath(explicitReturnPath))
  useEffect(() => {
    let previous: string | null = null
    try { previous = sessionStorage.getItem(RETURN_PATH_KEY) } catch {}
    setReturnPath(safeReturnPath(explicitReturnPath || previous))
  }, [explicitReturnPath])
  const storeHref = (destination: BillingStoreView) => billingStoreHref(destination, returnPath)
  const storeNavigation = (destination: BillingStoreView) => {
    const href = storeHref(destination)
    return { href, prefetch: false, scroll: false, onNavigate(event: { preventDefault(): void }) {
      event.preventDefault()
      if (destination !== view) {
        window.history.pushState(null, '', href)
        window.scrollTo({ top: 0 })
      }
    } }
  }
  const loginHref = `/login?next=${encodeURIComponent(storeHref(view))}`
  const [products, setProducts] = useState<BillingProduct[]>([])
  const [commercePolicy, setCommercePolicy] = useState<CommercePolicy | null>(null)
  const [billing, setBilling] = useState<BillingAccess>({ mode: 'self_use', rechargeEnabled: false })
  const [providers, setProviders] = useState<string[]>([])
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [qrState, setQrState] = useState<{ key: string; image?: string; error?: string } | null>(null)
  const loadRevision = useRef(0)
  const billingCheckout = useBillingCheckout({ accountId: state.user.id, connected, refreshSession, onReady: (checkout) => {
    if (checkout.kind === 'redirect' && checkout.url) window.location.assign(checkout.url)
    if (checkout.kind === 'form' && checkout.form) {
      const form = document.createElement('form')
      form.action = checkout.form.action; form.method = checkout.form.method
      for (const field of checkout.form.fields) {
        const input = document.createElement('input')
        input.type = 'hidden'; input.name = field.name; input.value = field.value
        form.appendChild(input)
      }
      document.body.appendChild(form); form.submit(); form.remove()
    }
  } })
  const { checkout, orderStatus } = billingCheckout
  const qrContent = checkout?.kind === 'qr' ? checkout.qrContent || checkout.url : undefined
  const qrKey = `${checkout?.orderId || ''}:${qrContent || ''}`
  const qrImage = qrState?.key === qrKey ? qrState?.image : undefined
  const qrError = qrState?.key === qrKey ? qrState?.error : undefined
  const load = useCallback(async () => {
    const revision = ++loadRevision.current
    setStatus('loading'); setError('')
    try {
      const result = await listBillingProducts()
      if (revision !== loadRevision.current) return
      setProducts(result.products)
      setCommercePolicy(result.commercePolicy ?? null)
      setProviders(result.paymentProviders)
      setBilling(result.billing ?? { mode: 'self_use', rechargeEnabled: false })
      setProvider(current => result.paymentProviders.includes(current) ? current : result.paymentProviders[0] || '')
      setStatus('ready')
    } catch (reason) {
      if (revision !== loadRevision.current) return
      setBilling({ mode: 'self_use', rechargeEnabled: false }); setError(reason instanceof Error ? reason.message : '商品加载失败'); setStatus('error')
    }
  }, [])
  useEffect(() => { void load(); return () => { loadRevision.current++ } }, [load])
  useEffect(() => {
    let active = true
    setQrState(null)
    if (qrContent) void QRCode.toDataURL(qrContent, { width: 280, margin: 2 }).then(url => { if (active) setQrState({ key: qrKey, image: url }) }).catch(() => { if (active) setQrState({ key: qrKey, error: '二维码生成失败，请重新打开支付。' }) })
    return () => { active = false }
  }, [qrContent, qrKey])
  const plans = useMemo(() => toMembershipPlans(storefrontProducts(products, productKind)), [products, productKind])
  const availableCycles = billingOptions.filter(option => plans.some(plan => plan.tiers.some(t => t.pricing[option.value])))
  const options = availableCycles.length ? availableCycles : billingOptions.filter(option => pointsStore ? option.value === 'once' : option.value !== 'once')

  async function purchase(selection: MembershipSelection) {
    if (!billing.rechargeEnabled) throw new Error('当前暂未开放购买。')
    if (!storefrontProducts(products, productKind).some(product => product.enabled && product.id === selection.pricing.productId)) throw new Error('商品已变更，请重新加载后购买。')
    if (!connected) { router.push(loginHref); return }
    await billingCheckout.purchase(selection.pricing.productId || '', provider)
  }
  const paymentControl = providers.length > 1 ? <label className={styles.storePayment}><span>支付方式</span><select value={provider} onChange={event => setProvider(event.target.value)}>{providers.map(value => <option key={value} value={value}>{paymentNames[value] || value}</option>)}</select></label> : providers.length > 0 ? <div className={styles.storePayment}><span>支付方式</span><strong>{paymentNames[provider] || provider}</strong></div> : undefined

  return <div className={`${styles.themeScope} ${styles.storeShell}`}>
    <header className={styles.storeTopBar}>
      <div className={styles.storeTopInner}>
        <Link href={returnPath} prefetch={false} aria-label="返回创作" className={styles.storeBack}><ArrowLeft size={17} aria-hidden="true" /><SiteBrand tone="dark" imageClassName="h-5 w-auto" /></Link>
        <nav className={styles.storeNav} aria-label="会员与积分">
          <Link {...storeNavigation(view === 'team' ? 'team' : 'personal')} aria-current={!pointsStore ? 'page' : undefined}><Crown size={17} aria-hidden="true" />会员订阅</Link>
          <Link {...storeNavigation('credits')} aria-current={pointsStore ? 'page' : undefined}><Coins size={17} aria-hidden="true" />积分超市</Link>
        </nav>
        <div className={styles.storeAccount}>
          {connected && state.user.role === 'admin' && <Link className={styles.storeAdmin} href="/admin/products">管理商品</Link>}
          <Link href={connected ? '/account' : loginHref} prefetch={false}><UserRound size={16} aria-hidden="true" />{connected ? '账户与订单' : '登录'}</Link>
        </div>
      </div>
    </header>
    <main className={styles.storeFrame} data-store-view={view}>
      <div className={styles.storeTitlebar}>
        <div><h1>{pageTitle}</h1>{pointsStore ? <p>一次性购买，无需订阅</p> : null}</div>
        {!pointsStore ? <nav aria-label="会员版本" className={styles.storeEdition}>
          <Link {...storeNavigation('personal')} aria-current={view === 'personal' ? 'page' : undefined}>个人版</Link>
          <Link {...storeNavigation('team')} aria-current={view === 'team' ? 'page' : undefined}>团队版</Link>
        </nav> : connected ? <div className={styles.storeBalance}><Coins size={17} aria-hidden="true" /><span>可用积分</span><strong>{state.credits.toLocaleString('zh-CN')}</strong></div> : null}
      </div>
      {view === 'team' ? <TeamPlansPage purchaseEnabled={status==='ready' && billing.rechargeEnabled} policy={commercePolicy} paymentControl={paymentControl} onPurchase={async (input:TeamPurchaseInput) => { if(!connected){router.push(loginHref);return} if(!billing.rechargeEnabled)throw new Error('当前没有可用支付方式，请刷新重试');await billingCheckout.purchase('team:'+input.teamPlanId,provider,input) }} /> : status === 'loading' ? <div className={styles.catalogState} role="status">正在读取商品与价格…</div>
        : status === 'error' ? <div className={styles.catalogState} role="alert"><p>{error || '商品加载失败。'}</p><Button type="button" onClick={() => void load()}>重新加载</Button></div>
        : !billing.rechargeEnabled ? <section className={styles.catalogState}><h2>{pointsStore ? '积分购买暂未开放' : '套餐购买暂未开放'}</h2><p>{billing.purchaseReadiness?.ready ? '支付方式正在配置。' : '购买配置尚未完成。'}</p>{connected && state.user.role === 'admin' ? <Link href="/admin/settings?section=billing">打开购买设置</Link> : null}</section>
        : <MembershipPurchaseView key={`${view}:${state.user.id}:${state.backendStatus}:${options.map(o => o.value).join(',')}`} embedded paymentControl={paymentControl} guest={!connected} storefront={pointsStore ? 'credits' : 'plans'} commercePolicy={commercePolicy} products={plans} billingOptions={options} initialBillingCycle={options[0].value} generationColumns={[]} generationRows={[]} faqItems={[]} status={status} errorMessage={error} onRetry={load} onSelectPlan={purchase} onClose={() => router.push(returnPath)} />}
    </main>
    <Dialog open={!!checkout} onOpenChange={open => { if (!open) billingCheckout.close() }}>
      <DialogContent><DialogHeader><DialogTitle>支付订单</DialogTitle><DialogDescription>{checkout?.orderNo} · {orderStatus}</DialogDescription></DialogHeader>
        {checkout?.kind === 'qr' && (qrImage ? <img src={qrImage} alt="支付二维码" width={280} height={280} className="mx-auto max-w-full" /> : <p role={qrError ? 'alert' : 'status'}>{qrError || '正在生成支付二维码'}</p>)}
        {checkout?.url && <a href={checkout.url} rel="noreferrer" target="_blank">前往支付</a>}
        <Button onClick={billingCheckout.refreshOrder} disabled={billingCheckout.querying || !connected}>{billingCheckout.querying ? '正在查询…' : '查询支付结果'}</Button>
      </DialogContent>
    </Dialog>
  </div>
}
