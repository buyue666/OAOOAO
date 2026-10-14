import type { CommercePolicy } from '@/lib/studio/commerce-policy'

export type MembershipAudience = 'creator' | 'team'
export type BillingCycle = 'annual' | 'quarterly' | 'monthly' | 'once'
export type PlanTone = 'standard' | 'advanced' | 'premium' | 'luxury' | 'ultimate'
export type MembershipViewStatus = 'ready' | 'loading' | 'error'

export interface CampaignBannerConfig {
  imageSrc: string
  imageAlt: string
  title: string
  subtitle: string
}
export interface BillingOption {
  value: BillingCycle
  label: string
  discountLabel?: string
  priceSuffix: string
}
/** Pricing identifies the exact product submitted to checkout. */
export interface TierPricing {
  productId?: string
  currency?: string
  credits?: number
  creditLabel?: string
  priceInCents?: number
  originalPriceInCents?: number
  renewalText?: string
  equivalentText?: string
}
export interface PromotionBenefit {
  title: string
  note?: string
}
/** Display facts belong to one product and one billing cycle. */
export interface TierDisplayPayload {
  tone?: PlanTone
  dailyPoints?: number
  badge?: string
  promotionLabel?: string
  discountLabel?: string
  baseBenefits?: string[]
  exclusiveBenefits?: string[]
  extraBenefits?: string[]
  promotionBenefits?: PromotionBenefit[]
  generationSummary?: string
}
export interface MembershipTier {
  id: string
  label: string
  credits: number
  pricing: Partial<Record<BillingCycle, TierPricing>>
  displayByCycle?: Partial<Record<BillingCycle, TierDisplayPayload>>
  // Legacy inputs are supported only when no cycle-specific map exists.
  generationSummary?: string
  dailyPoints?: number
  badge?: string
  promotionLabel?: string
  discountLabel?: string
  baseBenefits?: string[]
  exclusiveBenefits?: string[]
  extraBenefits?: string[]
}
export interface MembershipPlan {
  id: string
  name: string
  audience: MembershipAudience
  tone: PlanTone
  tiers: MembershipTier[]
  promotionLabel?: string
  discountLabel?: string
  badge?: string
  installmentLabel?: string
  promotionBenefits: PromotionBenefit[]
  baseBenefits: string[]
  exclusiveBenefits: string[]
  extraBenefits: string[]
  disabled?: boolean
  disabledReason?: string
}
export interface GenerationColumn {
  id: string
  label: string
  planId: string
  tierId: string
}
export interface GenerationRow {
  name: string
  unit: '秒' | '张'
  values: Record<string, number>
  group: 'video' | 'image'
}
export interface FaqItem {
  question: string
  answer?: string
}
export interface CurrentMembership {
  planId: string
  tierId: string
  billingCycle: BillingCycle
}
export interface MembershipSelection {
  plan: MembershipPlan
  tier: MembershipTier
  billingCycle: BillingCycle
  pricing: TierPricing
}
/** Storefront and editor preview share this consumer contract. */
export interface MembershipPurchaseViewProps {
  storefront?: 'plans' | 'credits'
  commercePolicy?: CommercePolicy | null
  products: MembershipPlan[]
  campaign?: CampaignBannerConfig
  billingOptions: BillingOption[]
  generationColumns: GenerationColumn[]
  generationRows: GenerationRow[]
  faqItems: FaqItem[]
  currentMembership?: CurrentMembership
  initialAudience?: MembershipAudience
  initialBillingCycle?: BillingCycle
  status?: MembershipViewStatus
  errorMessage?: string
  preview?: boolean
  interactive?: boolean
  showMoreDefault?: boolean
  controlledAudience?: MembershipAudience
  controlledBillingCycle?: BillingCycle
  onAudienceChange?: (audience: MembershipAudience) => void
  onBillingCycleChange?: (cycle: BillingCycle) => void
  onTierChange?: (planId: string, tierId: string) => void
  onRetry?: () => void
  onSelectPlan: (selection: MembershipSelection) => void | Promise<void>
  onClose: () => void
}
