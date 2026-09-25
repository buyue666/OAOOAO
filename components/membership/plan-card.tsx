import { Check, Gift, Info, Sparkles } from 'lucide-react'
import type { CSSProperties } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resolveTierDisplay } from '@/lib/studio/membership'

import styles from './membership.module.css'
import type {
  BillingCycle,
  BillingOption,
  MembershipPlan,
  MembershipSelection,
  MembershipTier,
} from './types'

const money = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const credits = new Intl.NumberFormat('zh-CN')

interface PlanCardProps {
  plan: MembershipPlan
  tier: MembershipTier
  billingCycle: BillingCycle
  billingOption: BillingOption
  showMore: boolean
  isCurrent: boolean
  onTierChange: (tier: MembershipTier) => void
  onSelect: (selection: MembershipSelection) => void
  onInstallment: (plan: MembershipPlan) => void
}

export function PlanCard({
  plan,
  tier,
  billingCycle,
  billingOption,
  showMore,
  isCurrent,
  onTierChange,
  onSelect,
  onInstallment,
}: PlanCardProps) {
  const pricing = tier.pricing[billingCycle]
  const price = pricing?.priceInCents
  const isUnavailable = price === undefined
  const disabled = plan.disabled || isCurrent || isUnavailable
  const creditAmount = pricing?.credits ?? tier.credits
  const symbol = pricing?.currency === 'USD' ? '$' : pricing?.currency && pricing.currency !== 'CNY' ? `${pricing.currency} ` : '¥'
  const perCredit = price === undefined || creditAmount <= 0 ? null : price / 100 / creditAmount
  /**
   * 展示数据 = **当前周期那件真实商品**的负载。
   *
   * 同一分组的月付/季付/年付是不同商品，可能复用同一个 `tierId`
   * （月付每日 10 积分、年付每日 100 积分）。早先展示数据只在档位首次创建时
   * 写入一次，于是切到年付时价格是年付的、每日积分却还是月付的。
   *
   * `resolveTierDisplay` 只读 `displayByCycle[billingCycle]`：
   * 该周期没有商品时返回**空负载**，绝不借用兄弟周期的角标/促销/权益，
   * 也不回落到 `plan.*`（plan 级 = 分组里第一个商品的数据）。
   */
  const display = resolveTierDisplay(tier, billingCycle)
  const badgeText = display.badge
  const promotionText = display.promotionLabel
  const baseBenefits = display.baseBenefits ?? []
  const exclusiveBenefits = display.exclusiveBenefits ?? []
  const extraBenefits = display.extraBenefits ?? []
  const promotionBenefits = display.promotionBenefits ?? []
  /**
   * 折扣标签优先用**价格推导**的结果，而不是手填文案：
   * 折扣是可计算的事实，避免运营填写与实际价格不符的折扣。
   * 档位自身的 `discountLabel` 就是由该档位商品的价格推导出来的。
   */
  const discountLabel = display.discountLabel
    ?? (pricing?.originalPriceInCents && pricing.originalPriceInCents > (price ?? 0)
      ? `${(((price ?? 0) / pricing.originalPriceInCents) * 10).toFixed(1).replace(/\.0$/, '')}折`
      : undefined)

  return (
    <article className={styles.planCard} data-tone={plan.tone} data-tier-id={tier.id}>
      {promotionText ? (
        <div className={styles.promotionStrip} data-testid="plan-promotion-strip">{promotionText}</div>
      ) : null}

      <div className={styles.planSummary}>
        <div className={styles.planHeading}>
          <h2>{plan.name}</h2>
          {/* 活动角标（后台填写）与促销条独立展示，不再被促销文案覆盖。 */}
          {badgeText ? <Badge data-testid="plan-badge">{badgeText}</Badge> : null}
        </div>

        {isUnavailable ? (
          <div className={styles.priceUnavailable}>价格待配置</div>
        ) : (
          <div className={styles.priceLine}>
            <span>{symbol}</span>
            <strong>{money.format(price / 100)}</strong>
            <small>/{billingOption.priceSuffix}</small>
            {discountLabel ? <em className={styles.discountTag} data-testid="plan-discount">{discountLabel}</em> : null}
            {pricing?.originalPriceInCents ? (
              <del>{symbol}{money.format(pricing.originalPriceInCents / 100)}</del>
            ) : null}
          </div>
        )}

        <p className={styles.renewalCopy}>
          {pricing?.renewalText ?? `${billingOption.label}价格与续费规则待配置`}
        </p>
        <p className={styles.equivalentCopy}>
          {perCredit === null
            ? '折合价格待配置'
            : `1 积分约 ${symbol}${perCredit.toFixed(4)} ${pricing?.equivalentText ?? ''}`}
        </p>

        <div className={styles.creditValue}>
          <strong>{credits.format(creditAmount)}</strong>
          <span>{pricing?.creditLabel ?? '积分'}</span>
        </div>

        {/**
          * 档位。
          *
          * 多个档位 → 可切换的档位按钮（原有行为）。
          * **单档位也必须展示档位名称**：早先只在 `tiers.length > 1` 时渲染，
          * 于是运营编辑「档位名称」在预览与用户页都毫无反应。
          * 列数由 `--tier-count` 注入，让单档位占满整行、多档位等分，
          * 避免长档位名被挤在半宽格子里。
          */}
        {plan.tiers.length > 1 ? (
          <div
            className={styles.tierPills}
            role="group"
            aria-label={`${plan.name}积分档位`}
            data-testid="plan-tiers"
            style={{ '--tier-count': plan.tiers.length } as CSSProperties}
          >
            {plan.tiers.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === tier.id}
                title={option.label}
                onClick={() => onTierChange(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : tier.label ? (
          <div className={styles.tierPills} data-testid="plan-tier-single" style={{ '--tier-count': 1 } as CSSProperties}>
            <button type="button" aria-pressed="true" disabled title={tier.label}>{tier.label}</button>
          </div>
        ) : null}

        <p className={styles.generationSummary}>
          {/*
            只读**当前周期**的生成量说明。
            
            此前写成 `display?.generationSummary ?? tier.generationSummary`：
            `tier.generationSummary` 是「最近写入周期」的兼容快照，
            于是月付没配说明时会借用年付的说明（实测的跨周期串文案）。
            
            `resolveTierDisplay` 已经区分了三种情况，这里不能再加回退：
            1. 该周期有商品 → 返回该商品自己的负载，说明为空就**不显示**；
            2. 档位完全没有按周期负载（旧数据/演示 fixtures）→ 已由它退回档位快照；
            3. 有按周期负载但没有这个周期 → 返回空负载，同样不显示。
            再叠一层 `?? tier.x` 会把第 1、3 种情况重新变成「借用兄弟周期」。
          */}
          {display.generationSummary ?? ''}
        </p>

        <Button
          className={styles.purchaseButton}
          disabled={disabled}
          onClick={() => pricing && onSelect({ plan, tier, billingCycle, pricing })}
        >
          {isCurrent ? '当前套餐' : isUnavailable ? '价格待配置' : '立即开通'}
        </Button>

        {plan.installmentLabel ? (
          <button className={styles.installmentButton} type="button" onClick={() => onInstallment(plan)}>
            {plan.installmentLabel}
            <Badge variant="outline">免息标记</Badge>
          </button>
        ) : (
          <div className={styles.installmentPlaceholder} aria-hidden="true" />
        )}
      </div>

      <div className={styles.planBenefits}>
        {/**
          * 限时活动。
          *
          * 取**当前周期**的负载：活动是「商品 × 活动」的关系，
          * 某一周期没有活动就不显示「限时活动」区块，
          * 不能沿用兄弟周期的活动文案（实测：只有月付做活动时，
          * 切到年付仍显示月付的活动标题）。
          */}
        {promotionBenefits.length > 0 && <section className={styles.promotionGroup}>
          <h3><Gift aria-hidden="true" />限时活动</h3>
          <ul>
            {promotionBenefits.map((benefit) => (
              <li key={benefit.title}>
                <Sparkles aria-hidden="true" />
                <span>{benefit.title}</span>
                {benefit.note ? <Info aria-label={benefit.note} /> : null}
              </li>
            ))}
          </ul>
        </section>}

        {baseBenefits.length > 0 && <section className={styles.benefitGroup}>
          <h3>基础权益</h3>
          <ul>
            {baseBenefits.map((benefit) => (
              <li key={benefit}><Check aria-hidden="true" />{benefit}</li>
            ))}
          </ul>
        </section>}

        {(exclusiveBenefits.length > 0 || extraBenefits.length > 0) && <section className={styles.benefitGroup}>
          <h3>独家功能</h3>
          <ul>
            {exclusiveBenefits.map((benefit) => (
              <li key={benefit}><Check aria-hidden="true" />{benefit}</li>
            ))}
            {showMore
              ? extraBenefits.map((benefit) => (
                  <li key={benefit}><Check aria-hidden="true" />{benefit}</li>
                ))
              : null}
          </ul>
        </section>}
      </div>
    </article>
  )
}
