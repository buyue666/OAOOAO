import { resolveTierDisplay } from '@/lib/studio/membership'
import type { BillingCycle, CurrentMembership, MembershipPlan, MembershipSelection, MembershipTier, TierPricing } from './types'

export function validPricing(pricing: TierPricing | undefined): pricing is TierPricing {
  return Boolean(pricing?.productId?.trim()) && /^[A-Za-z]{3}$/.test(pricing?.currency ?? '') && Number.isSafeInteger(pricing?.priceInCents) && (pricing?.priceInCents ?? -1) >= 0
    && Number.isFinite(pricing?.credits) && (pricing?.credits ?? -1) >= 0
}

export function formatPrice(pricing: TierPricing) {
  const amount = (pricing.priceInCents ?? 0) / 100
  const currency = pricing.currency || 'CNY'
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function selectedBenefits(plan: MembershipPlan, tier: MembershipTier, cycle: BillingCycle) {
  const display = resolveTierDisplay(tier, cycle)
  const specific = Boolean(tier.displayByCycle && Object.keys(tier.displayByCycle).length)
  return {
    promotionBenefits: display.promotionBenefits ?? (specific ? [] : plan.promotionBenefits),
    baseBenefits: display.baseBenefits ?? (specific ? [] : plan.baseBenefits),
    exclusiveBenefits: display.exclusiveBenefits ?? (specific ? [] : plan.exclusiveBenefits),
    extraBenefits: display.extraBenefits ?? (specific ? [] : plan.extraBenefits),
  }
}

export function isCurrentSelection(selection: Pick<MembershipSelection, 'plan' | 'tier' | 'billingCycle'>, current?: CurrentMembership) {
  return current?.planId === selection.plan.id && current.tierId === selection.tier.id && current.billingCycle === selection.billingCycle
}

/** Recheck the catalog before dispatching a previously reviewed selection. */
export function liveSelection(selection: MembershipSelection, products: MembershipPlan[]): MembershipSelection | null {
  const plan = products.find(item => item.id === selection.plan.id)
  const tier = plan?.tiers.find(item => item.id === selection.tier.id)
  const pricing = tier?.pricing[selection.billingCycle]
  if (!plan || plan.disabled || !tier || !validPricing(pricing)) return null
  if (pricing.productId !== selection.pricing.productId || pricing.priceInCents !== selection.pricing.priceInCents
    || pricing.credits !== selection.pricing.credits || pricing.currency !== selection.pricing.currency) return null
  return { plan, tier, billingCycle: selection.billingCycle, pricing }
}
