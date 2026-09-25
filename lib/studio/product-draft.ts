/**
 * 商品编辑草稿：预览与保存共用的唯一转换逻辑。
 *
 * 关键约束（对应验收要求）：
 * - 预览必须复用真实组件（`MembershipPurchaseView` / `PlanCard`）与真实转换
 *   （`toMembershipPlans`），因此这里负责把「表单草稿」变成与后端返回结构一致的
 *   `BillingProduct`，再交给 `toMembershipPlans` 渲染。
 * - 保存使用**同一份** `draftToProduct`，保证「预览所见 = 保存所得」。
 * - 保留未编辑的 metadata 字段（只覆盖 `membership` 子树）。
 * - 活动价遵循后端规则：`pricing` 由后端在返回商品时计算，编辑器不能凭本地
 *   猜测写死；草稿只携带 `amountCents`（日常价），预览中的活动价来自后端返回的
 *   `pricing`。因此更改日常价后必须丢弃旧的 `pricing`，否则会继续显示过期活动价。
 */

/** 表单草稿：金额以「分」为单位，与后端契约一致，避免浮点误差。 */
export type ProductDraft = {
  id?: string
  name: string
  description: string
  productKind: 'points' | 'plan'
  planId: string
  amountCents: number
  currency: string
  pointsAmount: number
  dailyPoints: number
  periodDays: number
  sortOrder: number
  enabled: boolean
  /** 订阅页展示信息（写入 metadata.membership）。 */
  display: ProductDraftDisplay
  /** 原始 metadata，用于保留未编辑字段。 */
  baseMetadata: Record<string, unknown>
  /** 后端返回的当前价格快照（含活动价）；仅用于展示与按规则重算，不参与保存。 */
  serverPricing?: {
    listUnitAmountCents?: number
    saleUnitAmountCents?: number
    discountCents?: number
    promotion?: { id?: string; label?: string; unitAmountCents?: number; startsAt?: string; endsAt?: string }
  }
}

export type ProductDraftDisplay = {
  name: string
  audience: 'creator' | 'team'
  groupId: string
  /**
   * 配色。空字符串表示「未设置 → 由真实转换按分组顺序自动分配」。
   *
   * 不能把缺失值强制补成 `standard`：真实 `toMembershipPlans` 在
   * `display.tone` 缺失时会用 `tones[plans.size % tones.length]` 自动配色。
   * 若这里补成 standard，打开编辑器就会改变预览配色
   * （实测：「【测试】专业年卡」真实为 advanced，预览却是 standard），
   * 保存还会把这个错误的配色写回数据库。
   */
  tone: string
  tierId: string
  tierLabel: string
  badge: string
  generationSummary: string
  benefits: string
  promotions: string
  exclusiveBenefits: string
  extraBenefits: string
}

export function linesToList(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

/** 从后端商品构造草稿。 */
export function productToDraft(product: {
  id: string
  name: string
  description?: string
  productKind: string
  planId?: string
  amountCents: number
  currency: string
  pointsAmount: number
  dailyPoints: number
  periodDays: number
  sortOrder: number
  enabled: boolean
  metadata?: Record<string, unknown>
  pricing?: ProductDraft['serverPricing']
}): ProductDraft {
  const metadata = isRecord(product.metadata) ? product.metadata : {}
  const display = isRecord(metadata.membership) ? metadata.membership : {}
  const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  return {
    id: product.id,
    name: product.name,
    description: product.description ?? '',
    productKind: product.productKind === 'plan' ? 'plan' : 'points',
    planId: product.planId ?? '',
    amountCents: Math.max(0, Math.round(Number(product.amountCents) || 0)),
    currency: text(product.currency, 'CNY') || 'CNY',
    pointsAmount: Math.max(0, Math.round(Number(product.pointsAmount) || 0)),
    dailyPoints: Math.max(0, Math.round(Number(product.dailyPoints) || 0)),
    periodDays: Math.max(0, Math.round(Number(product.periodDays) || 0)),
    sortOrder: Math.round(Number(product.sortOrder) || 0),
    enabled: Boolean(product.enabled),
    display: {
      name: text(display.name),
      audience: display.audience === 'team' ? 'team' : 'creator',
      groupId: text(display.groupId),
      // 保留「未设置」语义：不补默认值，交给真实转换自动配色。
      tone: text(display.tone),
      tierId: text(display.tierId, 'default') || 'default',
      tierLabel: text(display.tierLabel),
      badge: text(display.badge),
      generationSummary: text(display.generationSummary),
      benefits: list(display.benefits).length ? list(display.benefits).join('\n') : list(metadata.benefits).join('\n'),
      promotions: list(display.promotions).join('\n'),
      exclusiveBenefits: list(display.exclusiveBenefits).join('\n'),
      extraBenefits: list(display.extraBenefits).join('\n'),
    },
    baseMetadata: metadata,
    serverPricing: product.pricing,
  }
}

export function emptyDraft(sortOrder: number): ProductDraft {
  return {
    name: '',
    description: '',
    productKind: 'points',
    planId: '',
    amountCents: 0,
    currency: 'CNY',
    pointsAmount: 0,
    dailyPoints: 0,
    periodDays: 0,
    sortOrder,
    enabled: false,
    display: { name: '', audience: 'creator', groupId: '', tone: '', tierId: 'default', tierLabel: '', badge: '', generationSummary: '', benefits: '', promotions: '', exclusiveBenefits: '', extraBenefits: '' },
    baseMetadata: {},
  }
}

/** 保存用请求体：字段与后端 PATCH/POST 契约一致。 */
export function draftToPayload(draft: ProductDraft) {
  const membership: Record<string, unknown> = {
    ...(isRecord(draft.baseMetadata.membership) ? draft.baseMetadata.membership : {}),
    name: draft.display.name.trim(),
    groupId: draft.display.groupId.trim(),
    tierId: draft.display.tierId.trim() || 'default',
    tierLabel: draft.display.tierLabel.trim(),
    audience: draft.display.audience,
    badge: draft.display.badge.trim(),
    generationSummary: draft.display.generationSummary.trim(),
    benefits: linesToList(draft.display.benefits),
    promotions: linesToList(draft.display.promotions),
    exclusiveBenefits: linesToList(draft.display.exclusiveBenefits),
    extraBenefits: linesToList(draft.display.extraBenefits),
  }
  const tone = draft.display.tone.trim()
  if (tone) {
    membership.tone = tone
  } else {
    /**
     * 空 tone 表示「未设置/自动」。
     * 必须**删除**该键而不是写入空字符串：真实转换把「缺失」视为自动配色，
     * 写入空串会变成非法值并被回退成自动配色之外的默认值，
     * 等于用户什么都没改却改变了展示配置。
     */
    delete membership.tone
  }
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    productKind: draft.productKind,
    ...(draft.productKind === 'plan' ? { planId: draft.planId.trim() } : { planId: undefined }),
    amountCents: draft.amountCents,
    currency: draft.currency,
    pointsAmount: draft.pointsAmount,
    dailyPoints: draft.productKind === 'plan' ? draft.dailyPoints : 0,
    periodDays: draft.productKind === 'plan' ? draft.periodDays : 0,
    sortOrder: draft.sortOrder,
    enabled: draft.enabled,
    metadata: { ...draft.baseMetadata, membership },
  }
}

/**
 * 促销价快照（来自后端 `product.pricing.promotion`）。
 * 字段与后端 `PromotionPrice` 一致。
 */
export type PromotionSnapshot = {
  id?: string
  label?: string
  unitAmountCents?: number
  startsAt?: string
  endsAt?: string
}

/**
 * 按后端规则重新判定活动价是否仍然适用。
 *
 * 这是后端 `lib/server/billing-pricing.ts` 中 `selectCurrentPromotion` 的**规则镜像**：
 *   活动价有效 ⇔ 是正整数 且 0 < 活动价 < **当前日常价** 且 当前时间落在 [startsAt, endsAt)
 *
 * 为什么必须重新判定而不是沿用旧快照、也不是直接清空：
 * - 沿用旧快照：日常价改变后可能已经不再满足「活动价 < 日常价」，显示错误价格；
 * - 直接清空：实测「日常价 299 → 399、活动价 239.20」时活动**仍然有效**
 *   （23920 < 39900 且时间窗未过），清空会丢掉合法的活动标签与优惠价。
 * 因此这里按规则重算：提高日常价时活动继续生效，降低到活动价以下时活动自动失效。
 *
 * 说明：预览是只读的，无法为「尚未保存的草稿」调用后端报价接口
 * （`/api/billing/quotes` 需要真实商品 ID，且只按数据库里的日常价计算）。
 * 因此这里镜像后端规则；保存后由后端返回的 `pricing` 作为权威结果，
 * 验收用例会核对两者一致。
 */
export function resolvePromotionForAmount(
  promotion: PromotionSnapshot | undefined,
  listAmountCents: number,
  options: { now?: Date; currencyChanged?: boolean } = {},
): PromotionSnapshot | undefined {
  if (!promotion) return undefined
  // 币种变化时旧活动价属于另一种币种，不能假定仍然适用。
  if (options.currencyChanged) return undefined
  const amount = Number(promotion.unitAmountCents)
  if (!Number.isInteger(amount) || amount <= 0 || amount >= listAmountCents) return undefined
  const now = (options.now ?? new Date()).getTime()
  const startsAt = Date.parse(String(promotion.startsAt ?? ''))
  const endsAt = Date.parse(String(promotion.endsAt ?? ''))
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return undefined
  if (!(startsAt <= now && now < endsAt)) return undefined
  return { ...promotion, unitAmountCents: amount }
}

/** 由日常价与（可能的）活动价计算预览用的 pricing，与后端 `resolveProductPrice` 对齐。 */
export function resolvePreviewPricing(
  listAmountCents: number,
  promotion: PromotionSnapshot | undefined,
  options: { now?: Date; currencyChanged?: boolean } = {},
) {
  const active = resolvePromotionForAmount(promotion, listAmountCents, options)
  const activeAmount = Number(active?.unitAmountCents)
  const hasActive = Number.isInteger(activeAmount) && activeAmount > 0 && activeAmount < listAmountCents
  const saleUnitAmountCents = hasActive ? activeAmount : listAmountCents
  return {
    listUnitAmountCents: listAmountCents,
    saleUnitAmountCents,
    discountCents: Math.max(0, listAmountCents - saleUnitAmountCents),
    ...(hasActive && active ? { promotion: { label: active.label ?? '', ...active, unitAmountCents: activeAmount } } : {}),
  }
}

/**
 * 预览用商品对象：形状与后端 `BillingProduct` 一致，可直接交给 `toMembershipPlans`。
 *
 * `pricing` 按后端规则重算（见 `resolvePreviewPricing`），因此：
 * - 日常价不变 → 与后端下发的 pricing 一致；
 * - 提高日常价 → 活动价仍有效（只要小于新日常价且在时间窗内）；
 * - 降低日常价到活动价以下 → 活动价自动失效；
 * - 改币种 → 旧活动价不再假定适用。
 */
export function draftToProduct(draft: ProductDraft, options: { original?: { amountCents: number; currency: string } } = {}) {
  const payment = draftToPayload(draft)
  const currencyChanged = Boolean(options.original && options.original.currency !== draft.currency)
  const pricing = resolvePreviewPricing(draft.amountCents, draft.serverPricing?.promotion as PromotionSnapshot | undefined, { currencyChanged })
  return {
    id: draft.id ?? 'draft-preview',
    productKind: draft.productKind,
    planId: draft.productKind === 'plan' ? draft.planId.trim() : undefined,
    name: draft.name.trim() || '未命名商品',
    description: draft.description.trim(),
    amountCents: draft.amountCents,
    currency: draft.currency,
    pointsAmount: draft.pointsAmount,
    dailyPoints: draft.productKind === 'plan' ? draft.dailyPoints : 0,
    periodDays: draft.productKind === 'plan' ? draft.periodDays : 0,
    enabled: draft.enabled,
    sortOrder: draft.sortOrder,
    metadata: payment.metadata,
    pricing,
  }
}

/**
 * 把草稿替换进真实商品集合。
 *
 * 这是「完整套餐页预览」的关键：不能把每个商品都当成独立卡片，
 * 必须让草稿参与 `toMembershipPlans` 的分组/档位/周期/排序计算。
 *
 * **必须原位替换**：早先实现先删除原商品、再把草稿追加到末尾，
 * 这会改变相同 `sortOrder` 商品的相对顺序，进而改变分组的展示信息来源
 * 与自动配色（`toMembershipPlans` 用 `plans.size` 作为自动配色索引），
 * 于是「没改任何字段的预览」也会与真实套餐页不一致。
 * 新增商品（不在原集合中）才追加到末尾。
 */
export function mergeDraftIntoProducts<T extends { id: string }>(products: T[], draftProduct: T, options: { previewDisabled?: 'force-visible' } = {}): T[] {
  const next = { ...draftProduct }
  if (options.previewDisabled === 'force-visible') {
    // 局部预览需要看到下架草稿的长相，因此临时置为可见。
    Object.assign(next, { enabled: true })
  }
  const index = products.findIndex((item) => item.id === draftProduct.id)
  if (index < 0) return [...products, next]
  const copy = products.slice()
  copy[index] = next
  return copy
}

/**
 * 草稿校验：返回字段级错误，供界面定位。
 *
 * 覆盖验收要求：金额精度、整数积分、有效期、权益方案关联、同组同档同周期重复。
 */
export type DraftIssue = { field: string; message: string; level: 'error' | 'warning' }

export function validateDraft(draft: ProductDraft, context: { products: Array<{ id: string; productKind: string; periodDays: number; metadata?: Record<string, unknown>; amountCents: number }> } = { products: [] }): DraftIssue[] {
  const issues: DraftIssue[] = []
  if (!draft.name.trim()) issues.push({ field: 'name', message: '商品名称不能为空', level: 'error' })
  // 金额必须是精确到分的整数，避免 19.999 这类无法落库的精度。
  if (!Number.isFinite(draft.amountCents) || draft.amountCents <= 0) issues.push({ field: 'amountCents', message: '日常价必须大于 0', level: 'error' })
  else if (!Number.isInteger(draft.amountCents)) issues.push({ field: 'amountCents', message: `金额必须精确到分（当前 ${draft.amountCents} 分），请重新输入`, level: 'error' })
  else if (draft.amountCents > 100_000_000) issues.push({ field: 'amountCents', message: '金额超出上限（100 万元）', level: 'error' })
  if (!Number.isInteger(draft.pointsAmount) || draft.pointsAmount < 0) issues.push({ field: 'pointsAmount', message: '发放积分必须是不小于 0 的整数', level: 'error' })
  if (draft.productKind === 'points' && draft.pointsAmount <= 0) issues.push({ field: 'pointsAmount', message: '积分包必须发放至少 1 积分', level: 'error' })
  if (!Number.isInteger(draft.dailyPoints) || draft.dailyPoints < 0) issues.push({ field: 'dailyPoints', message: '每日积分必须是不小于 0 的整数', level: 'error' })
  if (!Number.isInteger(draft.sortOrder)) issues.push({ field: 'sortOrder', message: '显示顺序必须是整数', level: 'error' })
  /**
   * 档位名称长度。
   *
   * 档位标签渲染在卡片内的圆角按钮里，宽度有限（单档位约 246px，多档位等分）。
   * 过长会换行撑高卡片或被省略，因此这里给出提示上限（24 字），
   * 与输入框 `maxLength` 保持一致。
   */
  if (draft.display.tierLabel.trim().length > 24) {
    issues.push({ field: 'tierLabel', message: `档位名称建议不超过 24 个字（当前 ${draft.display.tierLabel.trim().length} 个），过长会在卡片上换行或省略显示`, level: 'warning' })
  }
  if (draft.productKind === 'plan') {
    if (!draft.planId.trim()) issues.push({ field: 'planId', message: '订阅套餐必须关联权益方案 ID（否则无法发放权益）', level: 'error' })
    if (!Number.isInteger(draft.periodDays) || draft.periodDays <= 0) issues.push({ field: 'periodDays', message: '有效期必须是不小于 1 的天数', level: 'error' })
    else if (draft.periodDays > 36500) issues.push({ field: 'periodDays', message: '有效期超出上限（36500 天）', level: 'error' })
    else {
      // 周期归属必须与 toMembershipPlans 的判定一致，否则预览与用户页会落到不同周期。
      const cycle = draft.periodDays >= 360 ? '年付' : draft.periodDays >= 85 && draft.periodDays <= 95 ? '季付' : '月付'
      issues.push({ field: 'periodDays', message: `按后端规则该有效期归入「${cycle}」档`, level: 'warning' })
    }
  }

  // 同组 + 同档位 + 同周期重复。
  const groupId = draft.display.groupId.trim()
  if (groupId) {
    const cycleOf = (days: number, kind: string) => kind === 'points' ? 'once' : days >= 360 ? 'annual' : days >= 85 && days <= 95 ? 'quarterly' : 'monthly'
    const myCycle = cycleOf(draft.periodDays, draft.productKind)
    const duplicates = context.products.filter((product) => {
      if (product.id === draft.id) return false
      if (product.productKind !== draft.productKind) return false
      const display = isRecord(product.metadata?.membership) ? product.metadata.membership : {}
      const otherGroup = typeof display.groupId === 'string' && display.groupId.trim() ? display.groupId : product.id
      if (otherGroup !== groupId) return false
      const otherTier = typeof display.tierId === 'string' && display.tierId.trim() ? display.tierId : 'default'
      if (otherTier !== (draft.display.tierId.trim() || 'default')) return false
      return cycleOf(product.periodDays, product.productKind) === myCycle
    })
    if (duplicates.length) {
      /**
       * 提示必须与真实转换规则一致。
       *
       * `toMembershipPlans` 遇到「同档位 + 同周期已有价格」时，会把后续商品
       * **保留为额外档位**（`tier = undefined` → 用 product.id 新建一个档位），
       * 而不是覆盖价格、也不是只展示其中一个。
       * 早先的提示写成「只会展示其中一个 / 覆盖价格」，与实际规则不符，会误导运营。
       */
      issues.push({
        field: 'tierId',
        message: `同组「${groupId}」的「${draft.display.tierId || 'default'}」档位在${myCycle === 'once' ? '积分包' : myCycle === 'annual' ? '年付' : myCycle === 'quarterly' ? '季付' : '月付'}周期已有 ${duplicates.length} 个商品（${duplicates.map((item) => item.id.slice(0, 8)).join('、')}）。转换规则会把它们保留为**额外档位**展示，而不会覆盖价格或互相隐藏；请确认这是预期的档位设计。`,
        level: 'warning',
      })
    }
  }
  return issues
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
