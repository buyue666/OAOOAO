import type { BillingProduct } from './api'
import type {
  BillingCycle,
  BillingOption,
  MembershipPlan,
  MembershipTier,
  PlanTone,
  TierDisplayPayload,
} from '@/components/membership/types'

export const billingOptions: BillingOption[] = [
  { value: 'annual', label: '年付', priceSuffix: '年' },
  { value: 'quarterly', label: '季付', priceSuffix: '季' },
  { value: 'monthly', label: '月付', priceSuffix: '月' },
  { value: 'once', label: '积分包', priceSuffix: '次' },
]
export const tones: PlanTone[] = ['standard', 'advanced', 'premium', 'luxury', 'ultimate']
export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
export function productCycle(product: BillingProduct): BillingCycle {
  if (product.productKind === 'points') return 'once'
  if (product.periodDays >= 360) return 'annual'
  if (product.periodDays >= 85 && product.periodDays <= 95) return 'quarterly'
  return 'monthly'
}

/**
 * 由「日常价 / 活动价」计算折扣标签，例如 23920/29900 → `8折`。
 *
 * 与后端 `lib/billing-plan-view.ts` 的 `formatDiscount` 同一算法
 * （实付/原价 × 10，去掉多余的 `.0`），因此预览、套餐页与管理端提示完全一致。
 * 折扣是可推导的事实，不需要运营手填；手填的标签只作为展示文案。
 */
export function discountLabelOf(listCents: number, saleCents: number): string | null {
  if (!Number.isFinite(listCents) || !Number.isFinite(saleCents)) return null
  if (listCents <= 0 || saleCents <= 0 || saleCents >= listCents) return null
  const discount = (saleCents / listCents) * 10
  return `${discount.toFixed(1).replace(/\.0$/, '')}折`
}

/** 折扣展示文案：优先「限时 X折」，无有效活动价时返回 null。 */
export function promotionStripLabel(listCents: number, saleCents: number): string | null {
  const label = discountLabelOf(listCents, saleCents)
  return label ? `限时 ${label}` : null
}

// 折叠规则见 `components/membership/benefits.ts`（视图与转换共用，避免循环依赖）。

/**
 * 某个商品自己配置的基础权益。
 *
 * 优先 `metadata.membership.benefits`，回落到 `metadata.benefits`
 * （与 plan 级逻辑完全一致，只是作用于单个商品）。
 */
function configuredBenefitsFor(product: BillingProduct): string[] {
  const metadata = objectValue(product.metadata)
  const display = objectValue(metadata.membership)
  const configured = stringList(display.benefits)
  return configured.length ? configured : stringList(metadata.benefits)
}

/**
 * 一件商品的权益行：**该商品自己配置的权益** + 它自己的「每日 N 积分」。
 *
 * 与分组无关：同一 `tierId` 的月付/季付/年付是不同商品，权益行各自独立。
 */
function benefitRowsFor(product: BillingProduct): string[] {
  const dailyRow = product.dailyPoints > 0 ? `每日 ${product.dailyPoints.toLocaleString('zh-CN')} 积分` : ''
  const benefits = [...configuredBenefitsFor(product)]
  if (dailyRow && !benefits.includes(dailyRow)) benefits.push(dailyRow)
  if (!benefits.length) benefits.push(...[product.description, dailyRow].filter(Boolean) as string[])
  return benefits
}

/**
 * 由**单个商品**构造它的展示负载。
 *
 * 这是「按周期绑定」的唯一入口：所有展示字段（含促销条与折扣）
 * 都由这件商品自己的 metadata / 价格 / 每日积分推导，
 * 不存在任何来自同分组其它商品的兜底。
 */
function displayPayloadFor(product: BillingProduct): TierDisplayPayload {
  const metadata = objectValue(product.metadata)
  const display = objectValue(metadata.membership)
  const listCents = product.pricing?.listUnitAmountCents ?? product.amountCents
  const saleCents = product.pricing?.saleUnitAmountCents ?? product.amountCents
  return {
    dailyPoints: product.dailyPoints,
    badge: typeof display.badge === 'string' && display.badge.trim() ? display.badge.trim() : undefined,
    // 促销条文案：只取**本商品**的活动标签；没有活动就没有促销条，
    // 不回落「限时 X 折」以外的任何兄弟周期文案。折扣本身是可推导的事实。
    promotionLabel: product.pricing?.promotion?.label || promotionStripLabel(listCents, saleCents) || undefined,
    discountLabel: discountLabelOf(listCents, saleCents) || undefined,
    baseBenefits: benefitRowsFor(product),
    exclusiveBenefits: stringList(display.exclusiveBenefits),
    extraBenefits: stringList(display.extraBenefits),
    promotionBenefits: stringList(display.promotions).map(title => ({ title })),
    generationSummary: typeof display.generationSummary === 'string' && display.generationSummary.trim()
      ? display.generationSummary.trim()
      : undefined,
  }
}

/**
 * 取某个档位在**指定周期**下的展示负载。
 *
 * 关键约束：只读该周期自己那一份。
 *  - 该周期有商品 → 返回它的负载；
 *  - 该档位完全没有按周期负载（旧数据/演示 fixtures）→ 才退回档位上的兼容快照；
 *  - 有按周期负载但**没有**这个周期 → 返回空负载。
 *
 * 第三种情况是本轮修复的要点：绝不能借用兄弟周期的每日积分/角标/促销/权益，
 * 「这个周期没有商品」就必须什么都不显示。
 */
export function resolveTierDisplay(tier: MembershipTier, cycle: BillingCycle): TierDisplayPayload {
  const payload = tier.displayByCycle?.[cycle]
  if (payload) return payload
  const hasCycleMap = Boolean(tier.displayByCycle && Object.keys(tier.displayByCycle).length)
  if (!hasCycleMap) {
    return {
      dailyPoints: tier.dailyPoints,
      badge: tier.badge,
      promotionLabel: tier.promotionLabel,
      discountLabel: tier.discountLabel,
      baseBenefits: tier.baseBenefits,
      exclusiveBenefits: tier.exclusiveBenefits,
      extraBenefits: tier.extraBenefits,
      generationSummary: tier.generationSummary,
    }
  }
  return emptyTierDisplay()
}

/** 空展示负载：该周期没有真实商品时的唯一合法结果。 */
export function emptyTierDisplay(): TierDisplayPayload {
  return {
    dailyPoints: undefined,
    badge: undefined,
    promotionLabel: undefined,
    discountLabel: undefined,
    baseBenefits: [],
    exclusiveBenefits: [],
    extraBenefits: [],
    promotionBenefits: [],
    generationSummary: undefined,
  }
}

// A selected tier and cycle always point to a real sellable product ID.
export function toMembershipPlans(products: BillingProduct[]): MembershipPlan[] {
  const plans = new Map<string, MembershipPlan>()
  for (const product of [...products].filter(p => p.enabled).sort((a, b) => a.sortOrder - b.sortOrder)) {
    const metadata = objectValue(product.metadata)
    const display = objectValue(metadata.membership)
    const audience = display.audience === 'team' ? 'team' : 'creator'
    const group = typeof display.groupId === 'string' && display.groupId.trim() ? display.groupId : product.id
    const groupId = `${audience}:${product.productKind}:${group}`
    const tierId = typeof display.tierId === 'string' && display.tierId.trim() ? display.tierId : 'default'
    let plan = plans.get(groupId)
    if (!plan) {
      /**
       * 权益行。
       *
       * 关键修复：「每日 N 积分」必须**始终**作为一行权益追加，
       * 而不是只在「没配基础权益」时作为兜底。
       * 早先的实现把兜底数组放在三元的 else 分支里，运营一填「基础权益」，
       * 每日积分那一行就整段消失——编辑「每日积分」看起来毫无反应。
       */
      const configuredBenefits = stringList(display.benefits).length ? stringList(display.benefits) : stringList(metadata.benefits)
      const dailyRow = product.dailyPoints > 0 ? `每日 ${product.dailyPoints.toLocaleString('zh-CN')} 积分` : ''
      const baseBenefits = [...configuredBenefits]
      if (dailyRow && !baseBenefits.includes(dailyRow)) baseBenefits.push(dailyRow)
      if (!baseBenefits.length) {
        baseBenefits.push(...[product.description, dailyRow].filter(Boolean) as string[])
      }
      const listCents = product.pricing?.listUnitAmountCents ?? product.amountCents
      const saleCents = product.pricing?.saleUnitAmountCents ?? product.amountCents
      plan = {
        id: groupId, name: typeof display.name === 'string' && display.name ? display.name : product.name,
        audience, tone: tones.includes(display.tone as PlanTone) ? display.tone as PlanTone : tones[plans.size % tones.length],
        tiers: [],
        // 促销条文案：优先后端配置的活动标签，缺失时用「限时 X折」自动计算。
        promotionLabel: product.pricing?.promotion?.label || promotionStripLabel(listCents, saleCents) || undefined,
        // 折扣标签始终按价格计算，供管理端与预览显示推导结果。
        discountLabel: discountLabelOf(listCents, saleCents) || undefined,
        // 活动角标是运营在后台填的展示文案，与促销条是两件事，必须独立保留。
        badge: typeof display.badge === 'string' && display.badge.trim() ? display.badge.trim() : undefined,
        promotionBenefits: stringList(display.promotions).map(title => ({ title })),
        baseBenefits,
        exclusiveBenefits: stringList(display.exclusiveBenefits), extraBenefits: stringList(display.extraBenefits),
      }
      plans.set(groupId, plan)
    }
    const cycle = productCycle(product)
    let tier = plan.tiers.find(t => t.id === tierId)
    // Keep duplicate products visible instead of silently replacing a price.
    if (tier?.pricing[cycle]) tier = undefined
    if (!tier) {
      /**
       * 档位只承载「分组级」信息：档位名、发放积分、生成量说明。
       *
       * 展示数据（每日积分 / 角标 / 促销 / 折扣 / 各类权益）**不在这里写死**，
       * 而是按周期写进 `displayByCycle`，见下方 `displayPayloadFor`。
       */
      tier = {
        id: plan.tiers.some(t => t.id === tierId) ? product.id : tierId,
        label: typeof display.tierLabel === 'string' && display.tierLabel ? display.tierLabel : product.name,
        credits: product.pointsAmount,
        pricing: {},
        displayByCycle: {},
      }
      plan.tiers.push(tier)
    }
    const price = product.pricing?.saleUnitAmountCents ?? product.amountCents
    /**
     * 每个周期写入**自己那件商品**的展示负载。
     *
     * 这是本轮修复的核心：早先只在档位「首次创建」时写入一次，
     * 于是同 `tierId` 的月付/季付/年付共用第一件商品的每日积分与权益
     * （实测：年付已选中、价格是年付的，每日积分却还是月付的 10）。
     * 现在按周期键写入，渲染端按当前周期取值，跨周期串数据在结构上不可能。
     */
    const payload = displayPayloadFor(product)
    tier.displayByCycle = { ...tier.displayByCycle, [cycle]: payload }
    /**
     * 兼容快照：与最近写入的周期一致。
     * 旧代码/演示数据（fixtures、membership-demo）仍可显示合理内容。
     */
    Object.assign(tier, {
      dailyPoints: payload.dailyPoints,
      badge: payload.badge,
      promotionLabel: payload.promotionLabel,
      discountLabel: payload.discountLabel,
      baseBenefits: payload.baseBenefits,
      exclusiveBenefits: payload.exclusiveBenefits,
      extraBenefits: payload.extraBenefits,
      generationSummary: payload.generationSummary,
    })
    tier.pricing[cycle] = {
      productId: product.id, currency: product.currency, priceInCents: price,
      originalPriceInCents: price < product.amountCents ? product.amountCents : undefined,
      credits: product.pointsAmount, creditLabel: '积分 / 次发放',
      renewalText: product.productKind === 'points' ? '一次性购买' : `整期 ${product.periodDays} 天，一次支付`,
    }
  }
  return [...plans.values()]
}
