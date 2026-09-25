/**
 * 权益折叠规则（纯函数，无框架依赖）。
 *
 * 单独成文件的原因：视图组件与数据转换层都要用它，
 * 放在任一侧都会造成 `components/membership` ↔ `lib/studio` 的循环依赖。
 */

/**
 * 权益自动折叠阈值（行数）。
 *
 * 卡片权益超过该行数时自动折叠，并出现「查看更多权益」按钮。
 * 早先实现只看 `extraBenefits` 是否配置：没配「更多权益」的卡片
 * 即使有十几行权益也不会折叠，按钮也不出现（运营看不到折叠效果）。
 */
export const BENEFIT_FOLD_THRESHOLD = 6

type BenefitGroups = {
  promotionBenefits: readonly unknown[]
  baseBenefits: readonly unknown[]
  exclusiveBenefits: readonly unknown[]
  extraBenefits: readonly unknown[]
}

/**
 * 权益来源：与数据转换层 `toMembershipPlans` 写入的结构一一对应。
 *
 * `displayByCycle` 是**按周期**保存的展示负载；同一个 `tierId` 可能被
 * 月付/季付/年付复用（月付每日 10 积分、年付每日 100 积分），
 * 因此折叠判定必须能读到「当前周期」那一份，而不是档位上的兼容快照。
 */
export type BenefitSource = {
  promotionBenefits: readonly unknown[]
  baseBenefits: readonly unknown[]
  exclusiveBenefits: readonly unknown[]
  extraBenefits: readonly unknown[]
}

export type BenefitTierSource = {
  baseBenefits?: readonly unknown[]
  exclusiveBenefits?: readonly unknown[]
  extraBenefits?: readonly unknown[]
  promotionBenefits?: readonly unknown[]
  displayByCycle?: Partial<Record<string, {
    baseBenefits?: readonly unknown[]
    exclusiveBenefits?: readonly unknown[]
    extraBenefits?: readonly unknown[]
    promotionBenefits?: readonly unknown[]
  }>>
}

/**
 * 取「当前档位 + 当前周期」的权益分组。
 *
 * 与 `lib/studio/membership.ts` 的 `resolveTierDisplay` **同一套取值规则**：
 *  1. 该档位在该周期下的 `displayByCycle[cycle]`（当前商品自己的权益）；
 *  2. 该档位完全没有按周期负载（旧数据/演示 fixtures）→ 用档位兼容快照；
 *  3. 有按周期负载但没有这个周期 → **空**（绝不借用兄弟周期）。
 * 第 3 条是关键：早先 `tier?.baseBenefits ?? plan.baseBenefits` 会退到
 * plan 级（= 分组里第一个商品），于是「月付 3 行」按年付的行数折叠。
 */
export function benefitGroupsOf(
  plan: BenefitSource,
  tier?: BenefitTierSource,
  cycle?: string,
): BenefitGroups {
  const cyclePayload = cycle ? tier?.displayByCycle?.[cycle] : undefined
  const hasCycleMap = Boolean(tier?.displayByCycle && Object.keys(tier.displayByCycle).length)
  const fallback = hasCycleMap ? undefined : tier
  return {
    // 限时活动同样按周期取：某周期没有活动就不显示，不沿用兄弟周期的活动文案。
    promotionBenefits: cyclePayload?.promotionBenefits ?? fallback?.promotionBenefits ?? plan.promotionBenefits,
    baseBenefits: cyclePayload?.baseBenefits ?? fallback?.baseBenefits ?? plan.baseBenefits,
    exclusiveBenefits: cyclePayload?.exclusiveBenefits ?? fallback?.exclusiveBenefits ?? plan.exclusiveBenefits,
    extraBenefits: cyclePayload?.extraBenefits ?? fallback?.extraBenefits ?? plan.extraBenefits,
  }
}

/** 一张卡片的权益总行数。 */
export function benefitRowCount(plan: BenefitGroups) {
  return plan.promotionBenefits.length + plan.baseBenefits.length + plan.exclusiveBenefits.length + plan.extraBenefits.length
}

/**
 * 是否需要折叠。
 *
 * 规则：折叠状态下只显示「限时活动 + 基础权益 + 独家功能」；
 * `extraBenefits`（更多权益）在折叠时隐藏、展开时显示。
 * 因此当权益行数超过阈值时自动折叠并给出展开入口。
 */
export function planNeedsFold(plan: BenefitGroups) {
  return benefitRowCount(plan) > BENEFIT_FOLD_THRESHOLD
}

/** 折叠状态下实际可见的权益行数（用于界面说明）。 */
export function visibleBenefitRowCount(plan: BenefitGroups) {
  return plan.promotionBenefits.length + plan.baseBenefits.length + plan.exclusiveBenefits.length
}
