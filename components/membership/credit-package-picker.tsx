'use client'

import { useId, useState, type ReactNode } from 'react'
import { ArrowRight, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resolveTierDisplay } from '@/lib/studio/membership'
import { formatPrice } from './purchase-helpers'
import type { MembershipSelection } from './types'
import styles from './membership.module.css'

export function CreditPackagePicker({ packages, paymentControl, busy, canPurchase, onReview }: { packages: MembershipSelection[]; paymentControl?: ReactNode; busy: boolean; canPurchase: boolean; onReview: (offer: MembershipSelection) => void }) {
  const group = useId()
  const [productId, setProductId] = useState('')
  const selected = packages.find(offer => offer.pricing.productId === productId) ?? packages[0]
  if (!selected) return <div className={styles.catalogState}><p>暂无上架的积分包。</p></div>

  return <div className={styles.creditShop}>
    <fieldset className={styles.packList}>
      <legend>选择积分包</legend>
      {packages.map(offer => {
        const { plan, tier, pricing } = offer
        const active = selected.pricing.productId === pricing.productId
        const display = resolveTierDisplay(tier, 'once')
        const points = (pricing.credits ?? 0).toLocaleString('zh-CN')
        const customName = plan.name.replace(/[\s,，]/gu, '') !== `${points.replace(/,/gu, '')}积分包`
        return <label key={pricing.productId} className={styles.packOption} data-selected={active} aria-label={plan.name}>
          <input type="radio" name={group} checked={active} onChange={() => setProductId(pricing.productId!)} disabled={busy} />
          <span className={styles.packIcon} aria-hidden="true"><Coins size={20} /></span>
          <span className={styles.packName}><strong>{points} <small>积分</small></strong>{customName ? <span>{plan.name}{tier.label !== plan.name && plan.tiers.length > 1 ? ` · ${tier.label}` : ''}</span> : null}{display.promotionLabel ? <span className={styles.packPromo}>{display.promotionLabel}</span> : null}</span>
          <span className={styles.packPrice}><strong>{formatPrice(pricing)}</strong>{pricing.originalPriceInCents !== undefined && pricing.originalPriceInCents > (pricing.priceInCents ?? 0) ? <s>{formatPrice({ ...pricing, priceInCents: pricing.originalPriceInCents })}</s> : null}</span>
        </label>
      })}
    </fieldset>
    <aside className={styles.creditOrder} aria-label="订单摘要">
      <h2>订单摘要</h2>
      <dl aria-live="polite"><div><dt>购买积分</dt><dd>{(selected.pricing.credits ?? 0).toLocaleString('zh-CN')} 积分</dd></div><div className={styles.creditTotal}><dt>应付金额</dt><dd>{formatPrice(selected.pricing)}</dd></div></dl>
      {paymentControl}
      <Button type="button" className={styles.creditReview} onClick={() => onReview(selected)} disabled={busy || !canPurchase}>核对订单<ArrowRight size={16} aria-hidden="true" /></Button>
    </aside>
  </div>
}
