/**
 * 促销活动草稿：把「某商品的活动价」这件事收敛成一处逻辑。
 *
 * 背景：此前活动价只能在「促销活动」区块里按活动整体编辑，
 * 商品编辑器里只**显示**活动价与折扣、没有任何编辑入口，
 * 运营在编辑单个商品时无法设置/修改/清除它的活动价。
 *
 * 后端契约（`lib/server/promotion-service.ts`）：
 * - 活动价必须 **> 0 且 < 商品日常价**，否则 `savePromotionCampaign` 直接报错；
 * - 同一商品在**时间重叠**的启用活动中只能出现一次（409）；
 * - 一个活动可包含多个商品，每个商品各有自己的活动价。
 *
 * 因此「从商品侧编辑活动价」需要决定落到哪个活动：
 * 优先复用该商品当前生效/存在的活动（保持运营已有配置），
 * 没有活动时新建一个只含该活动的推广。
 */

export type PromotionLike = {
  id: string
  name: string
  label?: string
  enabled: boolean
  startsAt?: string
  endsAt?: string
  products: Array<{ productId: string; promotionalAmountCents: number }>
}

/** 找到某个商品参与的活动（优先启用中的，其次任意）。 */
export function findPromotionForProduct<T extends PromotionLike>(promotions: T[], productId: string): T | undefined {
  const owner = promotions.find((item) => item.products.some((entry) => entry.productId === productId))
  if (!owner) return undefined
  return promotions.find((item) => item.enabled && item.products.some((entry) => entry.productId === productId)) ?? owner
}

/** 读取某商品在活动中的活动价（分）。 */
export function promotionAmountFor(promotion: PromotionLike | undefined, productId: string): number | null {
  const entry = promotion?.products.find((item) => item.productId === productId)
  return entry ? entry.promotionalAmountCents : null
}

/** 活动价校验：与后端 `validatePromotionPrices` 同一规则。 */
export function validatePromotionAmount(amountCents: number, listAmountCents: number): string | null {
  if (!Number.isFinite(amountCents)) return '活动价必须是数字'
  if (!Number.isInteger(amountCents)) return '活动价必须精确到分'
  if (amountCents <= 0) return '活动价必须大于 0'
  if (amountCents >= listAmountCents) return `活动价必须低于日常价（${(listAmountCents / 100).toFixed(2)} 元）`
  return null
}

/**
 * 生成「把某商品活动价设为 value」所需的请求体。
 *
 * - 已有活动：在该活动内替换/追加该商品的价格，其它商品保持不变；
 * - 没有活动：新建一个默认 30 天、启用中的活动。
 * 返回 `{ id, body }`：`id` 为空表示需要 POST 新建。
 */
export function buildPromotionPayload(input: {
  promotion: PromotionLike | undefined
  productId: string
  productName: string
  promotionalAmountCents: number
  now?: Date
  /** 新建活动时的默认时长（天）。 */
  defaultDays?: number
}) {
  const now = input.now ?? new Date()
  const products = input.promotion
    ? [
        ...input.promotion.products.filter((entry) => entry.productId !== input.productId),
        { productId: input.productId, promotionalAmountCents: input.promotionalAmountCents },
      ]
    : [{ productId: input.productId, promotionalAmountCents: input.promotionalAmountCents }]
  if (input.promotion) {
    return {
      id: input.promotion.id as string | undefined,
      body: {
        id: input.promotion.id,
        name: input.promotion.name,
        // 标签为空时用商品名派生，避免后端「请填写促销标签」报错。
        label: input.promotion.label?.trim() || `${input.productName} 优惠`,
        enabled: input.promotion.enabled,
        startsAt: input.promotion.startsAt,
        endsAt: input.promotion.endsAt,
        products,
      },
    }
  }
  const days = input.defaultDays ?? 30
  const endsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return {
    id: undefined,
    body: {
      name: `${input.productName} 限时优惠`,
      label: `${input.productName} 优惠`,
      enabled: true,
      startsAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
      products,
    },
  }
}

/**
 * 生成「清除某商品活动价」所需的请求体。
 *
 * 从活动中移除该商品；活动因此变空时返回 `{ remove: true }`，
 * 由调用方改为删除整个活动（后端要求活动至少包含一个商品）。
 */
export function buildPromotionRemoval(input: { promotion: PromotionLike; productId: string }) {
  const remaining = input.promotion.products.filter((entry) => entry.productId !== input.productId)
  if (!remaining.length) return { remove: true as const }
  return {
    remove: false as const,
    id: input.promotion.id,
    body: {
      id: input.promotion.id,
      name: input.promotion.name,
      label: input.promotion.label?.trim() || input.promotion.name,
      enabled: input.promotion.enabled,
      startsAt: input.promotion.startsAt,
      endsAt: input.promotion.endsAt,
      products: remaining,
    },
  }
}
