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

/**
 * 一件商品（= 分组里的一个档位 × 一个周期）的展示负载。
 *
 * 这些字段全部来自**该商品自己**的 `metadata.membership` / 价格 / 每日积分，
 * 不允许来自同分组里的其它商品。
 */
export interface TierDisplayPayload {
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
  generationSummary?: string
  pricing: Partial<Record<BillingCycle, TierPricing>>
  /**
   * 按周期（= 按真实商品）保存的展示负载。
   *
   * 同一个 `tierId` 字符串可能被月付/季付/年付**复用**（例如月付每日 10 积分、
   * 年付每日 100 积分）。因此展示数据不能挂在档位上「只写一次」：
   * 那会让后处理的周期沿用先处理周期的每日积分、角标、促销与权益
   * （实测：切到年付，价格对了，每日积分仍显示月付的 10）。
   *
   * 这里以周期为键保存，渲染时只读**当前周期**的那一份，
   * 于是「一个周期显示另一个周期的文案」在结构上不可能发生。
   */
  displayByCycle?: Partial<Record<BillingCycle, TierDisplayPayload>>
  /**
   * 兼容字段：与 `displayByCycle` 中**最后一次**写入的周期一致
   * （即最近处理过的那件商品），仅供不做周期选择的旧代码/演示数据读取。
   * 渲染请使用 `resolveTierDisplay(tier, cycle)`，不要直接读这里的值。
   */
  dailyPoints?: number
  badge?: string
  promotionLabel?: string
  discountLabel?: string
  baseBenefits?: string[]
  exclusiveBenefits?: string[]
  extraBenefits?: string[]
}

export interface PromotionBenefit {
  title: string
  note?: string
}

export interface MembershipPlan {
  id: string
  name: string
  audience: MembershipAudience
  tone: PlanTone
  tiers: MembershipTier[]
  promotionLabel?: string
  /** 由日常价/活动价推导的折扣标签（例如 `8折`），不是手填文案。 */
  discountLabel?: string
  /** 运营在后台填写的活动角标，与促销条文案相互独立。 */
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

export interface MembershipPurchaseViewProps {
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
  /** 预览模式：去掉整屏高度、关闭按钮改为容器内绝对定位。 */
  preview?: boolean
  /** false 时禁用下单/支付相关交互（预览用）；浏览类交互仍然保留。 */
  interactive?: boolean
  /** 权益区默认展开状态；与用户页保持一致（默认折叠）。 */
  showMoreDefault?: boolean
  /** 受控受众：预览需要把会员类型变化同步给外部。 */
  controlledAudience?: MembershipAudience
  /** 受控周期：预览需要把周期变化同步给外部。 */
  controlledBillingCycle?: BillingCycle
  onAudienceChange?: (audience: MembershipAudience) => void
  onBillingCycleChange?: (cycle: BillingCycle) => void
  /** 档位切换回调（预览用；档位浏览是只读的，不会下单）。 */
  onTierChange?: (planId: string, tierId: string) => void
  onRetry?: () => void
  onSelectPlan: (selection: MembershipSelection) => void | Promise<void>
  onClose: () => void
}
