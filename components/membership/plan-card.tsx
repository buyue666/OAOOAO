'use client'

import { Button } from '@/components/ui/button'
import { resolveTierDisplay } from '@/lib/studio/membership'
import { BENEFIT_FOLD_THRESHOLD } from './benefits'
import { formatPrice, selectedBenefits, validPricing } from './purchase-helpers'
import type { BillingCycle, BillingOption, MembershipPlan, MembershipSelection, MembershipTier } from './types'
import styles from './membership.module.css'

export interface PlanCardProps {
  plan: MembershipPlan
  tier: MembershipTier
  billingCycle: BillingCycle
  billingOption: BillingOption
  showMore: boolean
  isCurrent: boolean
  onTierChange: (tier: MembershipTier) => void
  onSelect: (selection: MembershipSelection) => void
  onInstallment: (plan: MembershipPlan) => void
  interactive?: boolean
  busy?: boolean
}

export function PlanCard({ plan, tier, billingCycle, billingOption, showMore, isCurrent, onTierChange, onSelect, interactive = true, busy = false }: PlanCardProps) {
  const pricing = tier.pricing[billingCycle]
  const available = validPricing(pricing)
  const display = resolveTierDisplay(tier, billingCycle)
  const benefits = selectedBenefits(plan, tier, billingCycle)
  const rows = [
    ...benefits.promotionBenefits.map(item => ({ title: item.title, note: item.note })),
    ...benefits.baseBenefits.map(title => ({ title, note: undefined })),
    ...benefits.exclusiveBenefits.map(title => ({ title, note: undefined })),
    ...benefits.extraBenefits.map(title => ({ title, note: undefined })),
  ]
  const visibleRows = showMore ? rows : rows.slice(0, BENEFIT_FOLD_THRESHOLD)
  const disabled = !available || Boolean(plan.disabled) || isCurrent || !interactive || busy
  const label = isCurrent ? '当前会员' : !interactive ? '仅供预览' : plan.disabled ? '暂不可购买' : !available ? '此周期不可购买' : billingCycle === 'once' ? '购买积分' : '选择会员'
  const select = () => {
    if (!disabled && pricing) onSelect({ plan, tier, billingCycle, pricing })
  }

  return (
    <article className={styles.offerCard} data-tone={display.tone ?? plan.tone} data-plan-id={plan.id} data-product-id={pricing?.productId} aria-label={plan.name}>
      <div className={styles.offerHeader}>
        <div className={styles.offerMarker} aria-hidden="true" />
        <div className={styles.offerHeading}>
          <h2>{plan.name}</h2>
          {available && display.badge ? <span className={styles.offerBadge} data-testid="plan-badge">{display.badge}</span> : null}
        </div>
        {available && display.promotionLabel ? <p className={styles.offerPromotion} data-testid="plan-promotion-strip">{display.promotionLabel}</p> : null}
      </div>

      <div className={styles.offerBody}>
        <div className={styles.tierChoices} role="group" aria-label={`${plan.name}积分档位`} data-testid={plan.tiers.length > 1 ? 'plan-tiers' : 'plan-tier-single'}>
          {plan.tiers.map(item => (
            <button key={item.id} type="button" aria-pressed={item.id === tier.id} disabled={!validPricing(item.pricing[billingCycle]) || busy} onClick={() => onTierChange(item)}>{item.label}</button>
          ))}
        </div>
        {available && pricing ? (
          <>
            <div className={styles.creditMetric}><strong>{pricing.credits?.toLocaleString('zh-CN')}</strong><span>{pricing.creditLabel || '积分 / 次发放'}</span></div>
            {display.dailyPoints !== undefined && display.dailyPoints > 0 ? <p className={styles.dailyMetric}>每日 {display.dailyPoints.toLocaleString('zh-CN')} 积分</p> : null}
            <div className={styles.costLine}><strong>{formatPrice(pricing)}</strong><span>/{billingOption.priceSuffix}</span></div>
            {pricing.originalPriceInCents !== undefined && pricing.originalPriceInCents > (pricing.priceInCents ?? 0) ? <p className={styles.previousCost}><s>{formatPrice({ ...pricing, priceInCents: pricing.originalPriceInCents })}</s>{display.discountLabel ? <span data-testid="plan-discount">{display.discountLabel}</span> : null}</p> : null}
            {pricing.renewalText ? <p className={styles.paymentNote}>{pricing.renewalText}</p> : null}
            {pricing.equivalentText ? <p className={styles.paymentNote}>{pricing.equivalentText}</p> : null}
            {display.generationSummary ? <p className={styles.paymentNote}>{display.generationSummary}</p> : null}
          </>
        ) : <p className={styles.unavailableNote}>此档位在当前周期没有可购买的商品。</p>}
        <Button type="button" className={styles.offerAction} disabled={disabled} onClick={select}>{busy ? '正在处理…' : label}</Button>
        {plan.disabledReason ? <p className={styles.paymentNote}>{plan.disabledReason}</p> : null}
      </div>

      {available && visibleRows.length > 0 ? (
        <div className={styles.entitlementBlock}>
          <p className={styles.entitlementCaption}>所选商品权益</p>
          <ul>{visibleRows.map((row, index) => <li key={`${index}-${row.title}`}><span className={styles.entitlementDot} aria-hidden="true" /><span>{row.title}{row.note ? <small>{row.note}</small> : null}</span></li>)}</ul>
          {!showMore && rows.length > visibleRows.length ? <p className={styles.foldHint}>还有 {rows.length - visibleRows.length} 项权益</p> : null}
        </div>
      ) : null}
    </article>
  )
}
