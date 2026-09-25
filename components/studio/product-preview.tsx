'use client'

/**
 * 商品编辑实时预览。
 *
 * 设计约束：
 * - **复用真实组件与真实转换**：`MembershipPurchaseView`（完整套餐页）、
 *   `PlanCard`（当前套餐卡片）与 `toMembershipPlans`（后端商品 → 会员方案）。
 * - **主题与响应式同源**：预览渲染真实视图组件本身，因此拿到 `.themeScope`
 *   （--membership-page / --membership-ink 等变量）与 `.viewportScope`
 *   （容器查询上下文）。CSS 响应式规则用 `@container` 表达，
 *   于是「后台 390px 预览框」与「真实 390px 手机页」走完全相同的规则。
 * - **桌面预览是隔离视口**：桌面模式把作用域固定在 1440px（见下方
 *   `DESKTOP_PREVIEW_WIDTH`），再整体缩放到面板可用宽度。窄面板不再参与
 *   桌面响应式计算，容器查询拿到的始终是真实桌面宽度。
 * - **零写入**：预览只读，不能保存、上架、下单或支付。
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { StatusBadge } from '@/components/studio/ui'
import { benefitGroupsOf, planNeedsFold } from '@/components/membership/benefits'
import { MembershipPurchaseView } from '@/components/membership/membership-purchase-view'
import { PlanCard } from '@/components/membership/plan-card'
import membershipStyles from '@/components/membership/membership.module.css'
import { billingOptions, toMembershipPlans } from '@/lib/studio/membership'
import { draftToProduct, mergeDraftIntoProducts, type ProductDraft } from '@/lib/studio/product-draft'
import type { BillingCycle, MembershipAudience, MembershipSelection } from '@/components/membership/types'

type Viewport = 'desktop' | 'mobile'

/**
 * 桌面预览的**固定视口宽度**。
 *
 * 必须与真实桌面端点一致：`/plans` 在 1440px 浏览器下，`.viewportScope`
 * 正好是 1440px，因此这里也固定 1440px，容器查询才会算出与真实页相同的布局
 * （`.planGrid` 的 `repeat(--plan-count, minmax(0, 1fr))` + `max-width:
 * calc(--plan-count * 280px)` → 单列时卡宽严格 280px）。
 *
 * 这里**不能**改用 `100vw` 之类的「跟随浏览器」写法：预览面板宽度由后台
 * 抽屉决定（实测 426px），拿它当桌面作用域会把桌面预览压成手机布局。
 */
const DESKTOP_PREVIEW_WIDTH = 1440
/** 手机预览宽度：与真实手机视口一致（`.viewportScope` = 390px）。 */
const MOBILE_PREVIEW_WIDTH = 390
/** 缩放比例下限：面板极窄时仍保持可读，而不是缩到 0。 */
const MIN_PREVIEW_SCALE = 0.18
/** 缩放比例上限：面板很宽时不放大，避免桌面预览被拉成模糊的大图。 */
const MAX_PREVIEW_SCALE = 1

/** `toMembershipPlans` 读取的商品形状；用于统一两处 BillingProduct 声明的差异。 */
type MembershipProduct = Parameters<typeof toMembershipPlans>[0][number]

/** 由商品类型与有效期推出它真正售卖的周期，与 `toMembershipPlans` 的判定一致。 */
function cycleOfDraft(draft: ProductDraft): BillingCycle {
  if (draft.productKind === 'points') return 'once'
  if (draft.periodDays >= 360) return 'annual'
  if (draft.periodDays >= 85 && draft.periodDays <= 95) return 'quarterly'
  return 'monthly'
}

export function ProductPreviewPanel({
  draft,
  products,
}: {
  draft: ProductDraft
  products: Parameters<typeof mergeDraftIntoProducts>[0]
}) {
  const [mode, setMode] = useState<'current' | 'full'>('current')
  const [viewport, setViewport] = useState<Viewport>('desktop')
  /**
   * 周期与受众：默认**跟随草稿**，但允许像真实页面一样切换浏览。
   *
   * 早先 `cycle = browseCycle ?? draftCycle`，而 `browseCycle` 一旦被点击就永久保留：
   * 实测「先点年付，再把有效期从 365 改成 30 天」，预览仍停在年付——
   * 用户改的是售卖周期，预览却在展示另一个周期，看起来像没生效。
   *
   * 现在记录「浏览选择是基于哪个草稿周期做的」：
   *  - 草稿周期没变 → 尊重用户的浏览选择；
   *  - 草稿周期变了 → 自动跟随新周期，并清除过期的浏览选择。
   * 这样既有明确的自动跟随，也保留了自由浏览。
   */
  const draftCycle = cycleOfDraft(draft)
  const [browseCycle, setBrowseCycle] = useState<BillingCycle | null>(null)
  /** 记录浏览选择是在哪个草稿周期下做出的。 */
  const browseCycleBaseRef = useRef<BillingCycle | null>(null)
  if (browseCycle !== null && browseCycleBaseRef.current !== null && browseCycleBaseRef.current !== draftCycle) {
    /**
     * 草稿周期已变化：丢弃旧的浏览选择。
     * 在渲染期同步修正 ref/state（而不是放 effect），避免先渲染一帧错误的周期。
     */
    browseCycleBaseRef.current = null
    setBrowseCycle(null)
  }
  const cycle = browseCycle ?? draftCycle

  const [browseAudience, setBrowseAudience] = useState<MembershipAudience | null>(null)
  const audience = browseAudience ?? draft.display.audience

  /** 用户主动切换周期：记住这次浏览所基于的草稿周期。 */
  const handleBrowseCycle = useCallback((next: BillingCycle) => {
    browseCycleBaseRef.current = next === draftCycle ? null : draftCycle
    setBrowseCycle(next === draftCycle ? null : next)
  }, [draftCycle])

  /**
   * 受众同理：草稿从「创作会员」改成「团队版」后，
   * 旧的浏览选择会把预览留在创作会员，看起来像受众没改。
   */
  const browseAudienceBaseRef = useRef<MembershipAudience | null>(null)
  if (browseAudience !== null && browseAudienceBaseRef.current !== null && browseAudienceBaseRef.current !== draft.display.audience) {
    browseAudienceBaseRef.current = null
    setBrowseAudience(null)
  }
  const handleBrowseAudience = useCallback((next: MembershipAudience) => {
    browseAudienceBaseRef.current = next === draft.display.audience ? null : draft.display.audience
    setBrowseAudience(next === draft.display.audience ? null : next)
  }, [draft.display.audience])
  /** 权益折叠状态：默认折叠，与真实用户页一致；展开是纯浏览行为。 */
  const [showMore, setShowMore] = useState(false)

  /**
   * 可用宽度测量。
   *
   * 关键在于**测哪一个元素**：必须测一个尺寸完全由面板决定、
   * 自身不随 `previewScale` 变化的元素（下面的 `preview-measure` 探针）。
   * 如果直接测 `preview-surface` 本身，它的宽度又由缩放推出的
   * `surfaceVisualWidth` 决定，就会形成
   * 「测宽 → 定比例 → 改宽度 → 再测宽」的自激循环。
   */
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)

  useLayoutEffect(() => {
    const node = measureRef.current
    if (!node) return
    /**
     * 用 `getBoundingClientRect().width`（含小数）而不是 `clientWidth`（取整）。
     *
     * `zoom` 的坐标系换算里，内层可用宽度 = 外层可用宽度 ÷ 缩放比。
     * 面板宽度实测带小数（抽屉里是 425.98px），若用取整后的 426 反推缩放比，
     * 算回去的 1440px 会被浏览器夹成 1439.95px，卡宽跟着变成 279.98px
     * （虽然只差 0.02px，但会污染「与真实页逐像素一致」的判据）。
     */
    const measure = () => setAvailableWidth(node.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const viewportWidth = viewport === 'desktop' ? DESKTOP_PREVIEW_WIDTH : MOBILE_PREVIEW_WIDTH
  /**
   * 缩放比 = 面板可用宽度 / 隔离视口宽度，上限 1（不放大）。
   *
   * 两个视口共用同一套规则，因此「面板再窄，内部也始终是完整的桌面/手机布局」，
   * 差别只在缩放比：
   *  - 桌面 1440px → 面板 426px 时约 0.2958；
   *  - 手机 390px → 面板 ≥390px 时为 1（手机预览与真实手机页逐像素一致）。
   *
   * 用 `zoom` 而不是 `transform: scale`：`zoom` 会同时参与布局，
   * 缩放后的盒子就是视觉尺寸（不会在面板里留下 1440px 的横向溢出），
   * 而内部布局宽度仍是 `viewportWidth`，容器查询因此拿到真实宽度。
   */
  const previewScale = availableWidth <= 0
    ? 1
    : Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, availableWidth / viewportWidth))
  /** 缩放后的视觉宽度：外壳按这个宽度贴合内容（面板更宽时不会拉出空白）。 */
  const surfaceVisualWidth = viewportWidth * previewScale

  /** 缩放后的视觉高度：`zoom` 不改变父级布局高度，需要显式占位。 */
  const [contentHeight, setContentHeight] = useState(0)

  const contentRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) return
    const measure = () => setContentHeight(node.offsetHeight * previewScale)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [previewScale, viewport, mode])

  const original = useMemo(
    () => products.find((item) => item.id === draft.id) as { amountCents?: number; currency?: string } | undefined,
    [draft.id, products],
  )

  const draftProduct = useMemo(
    () => draftToProduct(draft, {
      original: original ? { amountCents: Number(original.amountCents) || 0, currency: String(original.currency || 'CNY') } : undefined,
    }) as unknown as MembershipProduct,
    [draft, original],
  )

  const asProducts = useMemo(() => products as unknown as MembershipProduct[], [products])

  /**
   * 「当前套餐」：把草稿放进真实集合（原位替换）后取它所在的分组。
   *
   * 定位必须用**真实商品 ID**：
   * 草稿的 pricing.productId 就是 draftProduct.id，因此可以直接在分组里找到
   * 指向该商品的档位；这修复了「编辑其他档位时预览错商品」的问题
   * （上一轮固定取 tiers[0]）。
   */
  const currentPlan = useMemo(() => {
    // 局部预览需要看到下架草稿的长相，因此临时置为可见（只影响内存副本）。
    const withDraft = mergeDraftIntoProducts(asProducts, draftProduct, { previewDisabled: 'force-visible' })
    const plans = toMembershipPlans(withDraft)
    const groupId = draft.display.groupId.trim()
    const targetId = `${draft.display.audience}:${draft.productKind}:${groupId || draftProduct.id}`
    const byGroupId = plans.find((plan) => plan.id === targetId)
    if (byGroupId) return byGroupId
    // 回退：任何包含本草稿商品的档位的分组（新草稿可能与已有商品合并进同一分组）。
    const containsDraft = plans.find((plan) =>
      plan.tiers.some((tier) => Object.values(tier.pricing).some((pricing) => pricing?.productId === draftProduct.id)),
    )
    return containsDraft ?? plans[plans.length - 1] ?? null
  }, [asProducts, draft.display.audience, draft.display.groupId, draft.productKind, draftProduct])

  /** 当前草稿在分组里的**真实档位**（按 productId 匹配，而不是取第一个）。 */
  const draftTier = useMemo(() => {
    if (!currentPlan) return null
    return currentPlan.tiers.find((tier) =>
      Object.values(tier.pricing).some((pricing) => pricing?.productId === draftProduct.id),
    ) ?? null
  }, [currentPlan, draftProduct.id])

  const [browseTierId, setBrowseTierId] = useState<string | null>(null)

  // 完整套餐页：草稿原位替换进真实集合，遵循实际上架规则。
  const fullPageProducts = useMemo(
    () => toMembershipPlans(mergeDraftIntoProducts(asProducts, draftProduct)),
    [asProducts, draftProduct],
  )
  const draftVisibleInFullPage = fullPageProducts.some((plan) =>
    plan.tiers.some((tier) => Object.values(tier.pricing).some((pricing) => pricing?.productId === draftProduct.id)),
  )

  const billingOption = billingOptions.find((option) => option.value === cycle) ?? billingOptions[0]
  const currentPlanTiers = currentPlan ? currentPlan.tiers.filter((tier) => tier.pricing[cycle]) : []
  const activeTier = currentPlanTiers.find((tier) => tier.id === browseTierId)
    ?? (draftTier && draftTier.pricing[cycle] ? draftTier : undefined)
    ?? currentPlanTiers[0]
  const noop = () => undefined

  /**
   * 只读交互的边界。
   *
   * 允许：切换受众、切换周期、切换档位（都是**浏览**行为，与用户页一致）。
   * 禁止：下单、支付、安装分期（会产生订单或写入）。
   * 通过把 `onSelectPlan` 传空实现实现，而不是 `pointer-events: none`
   * ——后者会连带禁掉键盘焦点与滚动，且不符合无障碍要求。
   */
  const handleTierChange = (planId: string, tierId: string) => setBrowseTierId(tierId)

  /**
   * 预览内的回车隔离。
   *
   * `preview-surface` 的祖先链里**确实有** `<form onSubmit={submit}>`
   * （商品编辑抽屉的保存表单，已用 `closest('form')` 核对）。
   * 浏览器对「input 中按 Enter」会做隐式表单提交，一旦触发就会走上层表单的
   * 保存逻辑——那是业务写入，预览必须完全隔离。
   *
   * 预览目前没有任何 input（真实视图组件只渲染按钮），所以这条分支当前是
   * 兜底；但真实视图组件将来引入输入框时，这里能保证回车不会穿透到外层表单。
   * 只在 **INPUT** 上拦截：textarea 的回车是换行语义，隐式提交不由它触发，
   * 拦掉会破坏正常输入。
   */
  const handlePreviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT') event.preventDefault()
  }

  return (
    <section className="studio-surface flex min-w-0 flex-col gap-3 p-4" data-testid="product-preview-panel" aria-label="商品实时预览">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">实时预览</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            使用用户套餐页的真实组件与样式渲染；预览不会保存、上架、创建订单或付款。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([['current', '当前套餐'], ['full', '完整套餐页']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              data-testid={`preview-mode-${value}`}
              onClick={() => setMode(value)}
              className={`h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors ${mode === value ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}
            >{label}</button>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          {([['desktop', '桌面'], ['mobile', '手机']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={viewport === value}
              data-testid={`preview-viewport-${value}`}
              onClick={() => setViewport(value)}
              className={`h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors ${viewport === value ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">草稿属性：</span>
        <StatusBadge tone={draft.enabled ? 'success' : 'muted'}>{draft.enabled ? '已上架' : '未上架'}</StatusBadge>
        <span className="text-[11px] text-muted-foreground" data-testid="preview-cycle-hint">
          {draft.productKind === 'plan' ? `订阅套餐 · 有效期 ${draft.periodDays} 天 → ${billingOptions.find((option) => option.value === draftCycle)?.label}` : '积分包 · 一次性'}
        </span>
        <span className="text-[11px] text-muted-foreground">会员类型：{draft.display.audience === 'team' ? '团队版' : '创作会员'}</span>
      </div>

      {/**
        * 周期浏览按钮。
        *
        * 与真实套餐页一致：所有周期都可点击浏览（上一轮把它们禁用了，
        * 与用户页行为不符）。切到草稿未售卖的周期时会如实显示没有可展示的价格。
        */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="预览周期">
        {billingOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={cycle === option.value}
            data-testid={`preview-cycle-${option.value}`}
            onClick={() => handleBrowseCycle(option.value)}
            className={`h-7 rounded-md px-2.5 text-[11px] transition-colors ${cycle === option.value ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}
          >{option.label}</button>
        ))}
      </div>

      {/**
        * 可用宽度探针（`preview-measure`）。
        *
        * 尺寸完全由面板决定，内部不渲染任何随缩放变化的东西，
        * 因此观测它不会自激；`preview-surface` 的缩放比与视觉宽度都由它推出。
        */}
      <div ref={measureRef} data-testid="preview-measure" aria-hidden="true" className="w-full" />

      {/**
        * 预览视口（`preview-surface`）。
        *
        * 这是「隔离预览视口」的外壳，只负责两件事：按缩放后的视觉尺寸占位、裁掉溢出。
        * 它**不**参与响应式计算——真正的容器查询上下文是内层的
        * `.viewportScope`，其宽度由 `viewportWidth` 固定给出：
        *
        *  - 手机 → 390px，与真实手机视口一致；
        *  - 桌面 → 1440px，与 1440px 浏览器下的真实 `/plans` 一致。
        *
        * 此前桌面模式用的是 `w-full`，于是「后台抽屉的 426px 面板宽度」
        * 直接成了桌面作用域宽度，`@container (max-width: 760px)` 命中，
        * 桌面预览渲染成了手机布局（实测卡宽 300px vs 真实 280px）。
        *
        * 外框用 `outline`（不参与布局），保证内层作用域宽度精确等于
        * `viewportWidth`；缩放用 `zoom`（同时参与布局，见 previewScale 注释）。
        */}
      <div
        data-testid="preview-surface"
        data-viewport={viewport}
        data-preview-scale={Number(previewScale.toFixed(4))}
        onKeyDown={handlePreviewKeyDown}
        className="mx-auto overflow-hidden rounded-xl outline outline-1 outline-border [container-type:normal]"
        style={{
          width: `${surfaceVisualWidth}px`,
          maxWidth: '100%',
          ...(previewScale !== 1 && contentHeight > 0 ? { height: `${contentHeight}px` } : null),
        }}
      >
        <div
          ref={contentRef}
          data-testid="preview-viewport"
          data-viewport-width={viewportWidth}
          /**
           * 固定视口宽度 + 解除最大宽度限制。
           *
           * `.viewportScope` 的容器宽度**必须**正好是 `viewportWidth`：
           * 手机预览此前踩过「外层 2px 边框吃掉宽度 → 82cqw 算出 278.8px」
           * 的坑，这里用 `outline` + 固定 `width` 保证不存在任何扣减。
           *
           * `maxWidth: 'none'` 是必需的：手机预览宽度（390px）可能大于
           * 面板可用宽度，若继承外层约束会被压回面板宽度，
           * 容器查询随之失真。
           */
          className="block"
          style={{
            width: `${viewportWidth}px`,
            maxWidth: 'none',
            zoom: previewScale,
          }}
        >
          {mode === 'current' ? (
            /**
             * 当前套餐：用真实的 PlanCard + 真实分组数据渲染。
             * 外层补上 `themeScope`，使卡片拿到与真实套餐页完全相同的 CSS 变量
             * （上一轮只用了 planGrid，变量为空导致卡片背景透明）。
             */
            <div className={`${membershipStyles.themeScope} ${membershipStyles.viewportScope} ${membershipStyles.previewRoot}`}>
              {currentPlan && activeTier ? (
                <>
                  <div className={membershipStyles.planGrid} style={{ '--plan-count': 1 } as React.CSSProperties}>
                    <PlanCard
                      plan={currentPlan}
                      tier={activeTier}
                      billingCycle={cycle}
                      billingOption={billingOption}
                      /* 折叠状态默认与真实用户页一致（折叠）；展开是纯浏览行为。 */
                      showMore={showMore}
                      isCurrent={false}
                      onTierChange={(nextTier) => handleTierChange(currentPlan.id, nextTier.id)}
                      onSelect={noop as (selection: MembershipSelection) => void}
                      onInstallment={noop}
                    />
                  </div>
                  {/* 与真实页一致的折叠入口：按**当前档位 + 当前周期**的行数判定。 */}
                  {planNeedsFold(benefitGroupsOf(currentPlan, activeTier, cycle)) ? (
                    <button
                      className={membershipStyles.moreBenefitsButton}
                      type="button"
                      aria-expanded={showMore}
                      data-testid="preview-more-benefits"
                      onClick={() => setShowMore((value) => !value)}
                    >
                      {showMore ? '收起更多权益' : '查看更多权益'}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  当前草稿在「{billingOption.label}」周期、{audience === 'team' ? '团队版' : '创作会员'}类型下没有可展示的价格。
                </p>
              )}
            </div>
          ) : (
            /**
             * 完整套餐页：直接渲染真实视图组件（含真实主题、受众/周期切换、容器查询布局）。
             * 关闭按钮由 `preview` 模式改为容器内绝对定位，不再跑到后台窗口右上角。
             */
            <MembershipPurchaseView
              key={`preview-${viewport}`}
              products={fullPageProducts}
              billingOptions={billingOptions}
              initialBillingCycle={draftCycle}
              generationColumns={[]}
              generationRows={[]}
              faqItems={[]}
              status="ready"
              preview
              interactive={false}
              controlledAudience={audience}
              controlledBillingCycle={cycle}
              onAudienceChange={handleBrowseAudience}
              onBillingCycleChange={handleBrowseCycle}
              onTierChange={handleTierChange}
              onSelectPlan={noop}
              onClose={noop}
            />
          )}
        </div>
      </div>

      <p className="text-[11px] leading-5 text-muted-foreground">
        {mode === 'full'
          ? draftVisibleInFullPage
            ? `完整预览共 ${fullPageProducts.length} 个方案：草稿已按真实分组/档位/周期原位替换进商品集合。`
            : `完整预览共 ${fullPageProducts.length} 个方案：草稿当前未上架，用户页按实际上架规则不会展示它。`
          : '「当前套餐」按真实商品 ID 定位草稿所在档位，便于核对文案与价格。'}
      </p>
      {/**
        * 隔离视口说明。
        *
        * 预览内部按固定宽度（桌面 1440px / 手机 390px）渲染、再缩放到面板宽度，
        * 因此面板里量到的卡宽是**缩放后的视觉宽度**，不是布局宽度。
        * 这里如实标出两个数，避免把缩放后的尺寸当成真实卡宽。
        */}
      <p className="text-[11px] leading-5 text-muted-foreground" data-testid="preview-viewport-note">
        隔离视口：{viewport === 'desktop' ? '桌面' : '手机'} {viewportWidth}px
        {previewScale < 1
          ? ` → 缩放到 ${Math.round(previewScale * 1000) / 10}% 适配面板（内部布局宽度仍为 ${viewportWidth}px）`
          : '（按原始比例显示）'}
      </p>
      {mode === 'full' && !draftVisibleInFullPage && (
        <p className="text-[11px] leading-5 text-studio-warn" data-testid="preview-disabled-notice">
          草稿未上架：完整用户页预览不会出现该商品（这正是用户实际看到的结果）。勾选「上架商品」后可查看它加入列表后的效果。
        </p>
      )}
    </section>
  )
}

/** 供 Playwright 断言使用的稳定入口。 */
export const previewTestIds = ['product-preview-panel', 'preview-mode-current', 'preview-mode-full', 'preview-surface', 'preview-measure', 'preview-viewport'] as const
/** 桌面/手机预览各自固定的隔离视口宽度（供测试断言，避免测试里硬编码常量）。 */
export const previewViewportWidths = { desktop: DESKTOP_PREVIEW_WIDTH, mobile: MOBILE_PREVIEW_WIDTH } as const

export type { BillingCycle }

