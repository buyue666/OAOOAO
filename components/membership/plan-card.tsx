'use client'

import { Button } from '@/components/ui/button'
import { useEffect, useId, useRef, useState } from 'react'
import { CalendarCheck, CircleAlert, Coins, Sparkles } from 'lucide-react'
import { Popover } from 'radix-ui'
import { MEMBERSHIP_CHECK_IN_VALIDITY_LABEL } from '@/backend/src/membership-policy'
import { resolveTierDisplay } from '@/lib/studio/membership'
import { BENEFIT_FOLD_THRESHOLD } from './benefits'
import { formatPrice, selectedBenefits, subscriptionCredits, validPricing } from './purchase-helpers'
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

function PlanInfo({ label, note }: { label: string; note: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const cancelClose = () => clearTimeout(closeTimer.current)
  const deferClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 160) }
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild>
      <button type="button" ref={trigger} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined} className={styles.metricInfo}
        onPointerEnter={event => { if (event.pointerType === 'mouse') { cancelClose(); setOpen(true) } }}
        onPointerLeave={event => { if (event.pointerType === 'mouse' && !event.currentTarget.matches(':focus-visible')) deferClose() }}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) { cancelClose(); setOpen(true) } }}
        onBlur={() => { cancelClose(); setOpen(false) }}
        onClick={() => { cancelClose(); setOpen(value => !value) }}><CircleAlert size={14} aria-hidden="true" /></button>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content id={id} role="tooltip" data-tooltip-content="true" side="top" sideOffset={6} collisionPadding={8} className={styles.planTooltip}
        onPointerEnter={cancelClose} onPointerLeave={event => { if (event.pointerType === 'mouse') deferClose() }}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => { if (event.target instanceof Node && trigger.current?.contains(event.target)) event.preventDefault() }}>
        {note}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}

export function PlanCard({ plan, tier, billingCycle, billingOption, showMore, isCurrent, onTierChange, onSelect, interactive = true, busy = false }: PlanCardProps) {
  const pricing = tier.pricing[billingCycle]
  const available = validPricing(pricing)
  const display = resolveTierDisplay(tier, billingCycle)
  const subscription = billingCycle !== 'once'
  const points = pricing ? subscriptionCredits(pricing, subscription ? display.dailyPoints : 0) : null
  const pointsText = (amount: number) => amount.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
  const generationNote = display.generationSummaryNote?.trim()
  const signInNote = points && points.daily > 0 ? `每天主动签到可领 ${pointsText(points.daily)} 积分。\n${MEMBERSHIP_CHECK_IN_VALIDITY_LABEL}` : null
  const benefits = selectedBenefits(plan, tier, billingCycle)
  const groups: { title: string; rows: { title: string; note?: string }[] }[] = [
    { title: '限时活动', rows: benefits.promotionBenefits.map(item => ({ title: item.title, note: item.note })) },
    { title: '基础权益', rows: benefits.baseBenefits.map(title => ({ title })) },
    { title: '独家功能', rows: benefits.exclusiveBenefits.map(title => ({ title })) },
    { title: '更多权益', rows: benefits.extraBenefits.map(title => ({ title })) },
  ]
  const rowCount = groups.reduce((total, group) => total + group.rows.length, 0)
  let remaining = showMore ? rowCount : BENEFIT_FOLD_THRESHOLD
  const visibleGroups = groups.flatMap(group => {
    const rows = group.rows.slice(0, Math.max(0, remaining))
    remaining -= rows.length
    return rows.length ? [{ ...group, rows }] : []
  })
  const visibleCount = visibleGroups.reduce((total, group) => total + group.rows.length, 0)
  const disabled = !available || Boolean(plan.disabled) || isCurrent || !interactive || busy
  const label = isCurrent ? '当前会员' : !interactive ? '仅供预览' : plan.disabled ? '暂不可购买' : !available ? '此周期不可购买' : subscription ? '订阅' : '购买积分'
  const select = () => {
    if (!disabled && pricing) onSelect({ plan, tier, billingCycle, pricing })
  }

  return (
    <article className={styles.offerCard} data-subscription={subscription} data-tone={display.tone ?? plan.tone} data-plan-id={plan.id} data-product-id={pricing?.productId} aria-label={plan.name}>
      <div className={styles.offerHeader}>
        <div className={styles.offerMarker} aria-hidden="true" />
        <div className={styles.offerHeading}>
          <h2>{plan.name}</h2>
          {available && display.badge ? <span className={styles.offerBadge} data-testid="plan-badge">{display.badge}</span> : null}
        </div>
        {available && display.promotionLabel ? <p className={styles.offerPromotion} data-testid="plan-promotion-strip">{display.promotionLabel}</p> : null}
      </div>

      <div className={styles.offerBody}>
        {available && pricing ? (
          <>
            <div className={styles.costLine}><strong>{formatPrice(pricing)}</strong><span>/{billingOption.priceSuffix}</span></div>
            {pricing.originalPriceInCents !== undefined && pricing.originalPriceInCents > (pricing.priceInCents ?? 0) ? <p className={styles.previousCost}><s>{formatPrice({ ...pricing, priceInCents: pricing.originalPriceInCents })}</s>{display.discountLabel ? <span data-testid="plan-discount">{display.discountLabel}</span> : null}</p> : null}
            {pricing.renewalText ? <p className={styles.paymentNote}>{pricing.renewalText}</p> : null}
            {!subscription && points ? <div className={styles.creditMetric}><strong>{pointsText(points.upfront)}</strong><span>{pricing.creditLabel || '积分'}</span></div> : null}
          </>
        ) : <p className={styles.unavailableNote}>此档位在当前周期没有可购买的商品。</p>}
        {plan.tiers.length > 1 && <div className={styles.tierChoices} role="group" aria-label={`${plan.name}积分档位`} data-testid="plan-tiers">
          {plan.tiers.map(item => (
            <button key={item.id} type="button" aria-pressed={item.id === tier.id} disabled={plan.tiers.length === 1 || !validPricing(item.pricing[billingCycle]) || busy} onClick={() => onTierChange(item)}>{item.label}</button>
          ))}
        </div>}
        <Button type="button" className={styles.offerAction} disabled={disabled} onClick={select}>{busy ? '正在处理…' : label}</Button>
        {plan.disabledReason ? <p className={styles.paymentNote}>{plan.disabledReason}</p> : null}
      </div>

      {available && pricing && points && <section aria-label="积分与预计生成量" className={styles.creditSummary}>
        <div className={styles.creditSummaryHeader}><Coins aria-hidden="true" size={16} /><strong>{pointsText(points.total)} 积分</strong><span>{points.signInTotal ? '全期最高' : subscription ? '开通到账' : '本次到账'}</span></div>
        <dl className={styles.creditRows}>
          {subscription && <div><dt>立得</dt><dd>{pointsText(points.upfront)} 积分</dd></div>}
          {subscription && <div><dt><CalendarCheck aria-hidden="true" size={14} />会员签到{signInNote ? <PlanInfo label="会员签到积分说明" note={signInNote} /> : null}</dt><dd>{points.daily > 0 ? `每日 ${pointsText(points.daily)} 积分${points.signInTotal ? ` · 全期最多 ${pointsText(points.signInTotal)}` : ''}` : '此套餐无奖励'}</dd></div>}
          {subscription && (points.daily > 0 || display.generationSummary || generationNote) && <div><dt><Sparkles aria-hidden="true" size={14} />约生成{generationNote ? <PlanInfo label="生成量说明备注" note={generationNote} /> : null}</dt><dd>{display.generationSummary ? display.generationSummary.replace(/^\s*(?:约可生成|大约生成|约生成|可生成约|≈|约)\s*/u, '') : '依所选模型而定'}</dd></div>}
          {points.unitPrice !== null && <div><dt>1 积分 =</dt><dd className={styles.unitPrice}>{formatPrice({ ...pricing, priceInCents: points.unitPrice }, points.unitPrice > 0 && points.unitPrice < .01 ? 6 : 4).replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1')}</dd></div>}
        </dl>
        {points.daily > 0 && <p className={styles.summaryNote}>单价按签到领满折算。</p>}
      </section>}

      {available && visibleCount > 0 ? (
        <div className={styles.entitlementBlock}>
          {visibleGroups.map(group => <section key={group.title} aria-label={group.title} className={styles.entitlementGroup}>
            <h3 className={styles.entitlementCaption}>{group.title}</h3>
            <ul>{group.rows.map((row, index) => <li key={`${index}-${row.title}`}><span className={styles.entitlementDot} aria-hidden="true" /><span>{row.title}{row.note ? <small>{row.note}</small> : null}</span></li>)}</ul>
          </section>)}
          {!showMore && rowCount > visibleCount ? <p className={styles.foldHint}>还有 {rowCount - visibleCount} 项权益</p> : null}
        </div>
      ) : null}
    </article>
  )
}
