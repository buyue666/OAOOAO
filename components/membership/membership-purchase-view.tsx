'use client'

import { ChevronDown, RefreshCw, X } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { BillingSelector } from './billing-selector'
import { benefitGroupsOf, planNeedsFold } from './benefits'
import { CampaignBanner } from './campaign-banner'
import { ComparisonTable } from './comparison-table'
import { MembershipDialogs } from './membership-dialogs'
import { MembershipFaq } from './membership-faq'
import membershipStyles from './membership.module.css'
import { PlanCard } from './plan-card'
import type {
  BillingCycle,
  MembershipAudience,
  MembershipPlan,
  MembershipPurchaseViewProps,
  MembershipSelection,
} from './types'

function LoadingPlans() {
  return (
    <div className={membershipStyles.planGrid} aria-label="套餐加载中">
      {Array.from({ length: 5 }, (_, index) => (
        <div className={membershipStyles.loadingCard} key={index}>
          <Skeleton className={membershipStyles.loadingTitle} />
          <Skeleton className={membershipStyles.loadingPrice} />
          <Skeleton className={membershipStyles.loadingButton} />
          <Skeleton className={membershipStyles.loadingBody} />
        </div>
      ))}
    </div>
  )
}

export function MembershipPurchaseView({
  products,
  campaign,
  billingOptions,
  generationColumns,
  generationRows,
  faqItems,
  currentMembership,
  initialAudience = 'creator',
  initialBillingCycle = 'annual',
  status = 'ready',
  errorMessage = '会员套餐加载失败，请稍后重试。',
  // 预览模式：复用同一套主题与容器查询规则，只调整整屏高度与关闭按钮定位。
  preview = false,
  interactive = true,
  showMoreDefault = false,
  controlledAudience,
  controlledBillingCycle,
  onAudienceChange,
  onBillingCycleChange,
  onTierChange,
  onRetry,
  onSelectPlan,
  onClose,
}: MembershipPurchaseViewProps) {
  const [audience, setAudience] = useState<MembershipAudience>(initialAudience)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(initialBillingCycle)
  const [tierByPlan, setTierByPlan] = useState<Record<string, string>>({})
  // 默认为折叠：与真实用户页一致（此前预览固定 showMore，与真实页不一致）。
  const [showMore, setShowMore] = useState(showMoreDefault)
  const [selection, setSelection] = useState<MembershipSelection | null>(null)
  const [pointsRulesOpen, setPointsRulesOpen] = useState(false)
  const [installmentPlan, setInstallmentPlan] = useState<MembershipPlan | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [purchaseError, setPurchaseError] = useState('')

  /**
   * 受控受众与周期。
   *
   * 预览需要把「受众/周期变化」同步给外部（否则会员类型改成 team 后
   * 完整预览仍停留在 creator，显示「暂无可用套餐」）。因此当外部传入
   * 受控值时以外部为准。
   */
  const effectiveAudience = controlledAudience ?? audience
  const effectiveCycle = controlledBillingCycle ?? billingCycle

  const visibleProducts = useMemo(
    () => products.filter((product) => product.audience === effectiveAudience && product.tiers.some(t => t.pricing[effectiveCycle])),
    [effectiveAudience, products, effectiveCycle],
  )
  const billingOption = billingOptions.find((option) => option.value === effectiveCycle)
    ?? billingOptions[0]

  const changeAudience = (nextAudience: MembershipAudience) => {
    setAudience(nextAudience)
    onAudienceChange?.(nextAudience)
    setSelection(null)
  }

  const changeBillingCycle = (nextCycle: BillingCycle) => {
    setBillingCycle(nextCycle)
    onBillingCycleChange?.(nextCycle)
    setSelection(null)
  }

  const confirmSelection = async () => {
    if (!selection) return
    setSubmitting(true)
    setPurchaseError('')
    try {
      await onSelectPlan(selection)
      setSelection(null)
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : '订单创建失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // themeScope 提供与真实套餐页完全一致的主题变量；viewportScope 提供容器查询上下文。
    <div className={[membershipStyles.themeScope, membershipStyles.root, membershipStyles.viewportScope, preview ? membershipStyles.previewRoot : ''].filter(Boolean).join(' ')} data-membership-preview={preview ? 'true' : undefined}>
      <button className={membershipStyles.closeButton} type="button" onClick={onClose} aria-label="关闭会员页面" tabIndex={interactive ? undefined : -1}>
        <X aria-hidden="true" />
      </button>

      <main className={membershipStyles.main}>
        {campaign ? <CampaignBanner campaign={campaign} /> : null}
        <BillingSelector
          audience={effectiveAudience}
          billingCycle={effectiveCycle}
          options={billingOptions}
          onAudienceChange={changeAudience}
          onBillingCycleChange={changeBillingCycle}
          onOpenPointsRules={() => setPointsRulesOpen(true)}
          disabled={!interactive}
        />

        <section className={membershipStyles.plansSection} aria-label="会员套餐">
          <div className={membershipStyles.planScroller} tabIndex={0} aria-label="会员套餐，可横向滚动">
            {status === 'loading' ? <LoadingPlans /> : null}

            {status === 'error' ? (
              <div className={membershipStyles.statePanel} role="alert">
                <p>{errorMessage}</p>
                {onRetry ? (
                  <Button variant="outline" onClick={onRetry}>
                    <RefreshCw data-icon="inline-start" aria-hidden="true" />
                    重试
                  </Button>
                ) : null}
              </div>
            ) : null}

            {status === 'ready' && visibleProducts.length === 0 ? (
              <div className={membershipStyles.statePanel}>
                <strong>{effectiveAudience === 'team' ? '团队版会员方案待配置' : '暂无可用套餐'}</strong>
                <p>未提供的方案不会使用推测价格或虚构权益。</p>
              </div>
            ) : null}

            {status === 'ready' && visibleProducts.length > 0 ? (
              <div className={membershipStyles.planGrid} style={{ '--plan-count': Math.min(5, visibleProducts.length) } as CSSProperties}>
                {visibleProducts.map((plan) => {
                  const availablePlan = { ...plan, tiers: plan.tiers.filter(t => t.pricing[effectiveCycle]) }
                  const tier = availablePlan.tiers.find((item) => item.id === tierByPlan[plan.id])
                    ?? availablePlan.tiers[0]
                  const isCurrent = currentMembership?.planId === plan.id
                    && currentMembership.tierId === tier.id
                    && currentMembership.billingCycle === effectiveCycle

                  return (
                    <PlanCard
                      key={plan.id}
                      plan={availablePlan}
                      tier={tier}
                      billingCycle={effectiveCycle}
                      billingOption={billingOption}
                      showMore={showMore}
                      isCurrent={isCurrent}
                      /* 预览中档位切换是只读浏览：允许切换查看，但不会下单或写入。 */
                      onTierChange={(nextTier) => {
                        setTierByPlan((current) => ({ ...current, [plan.id]: nextTier.id }))
                        onTierChange?.(plan.id, nextTier.id)
                      }}
                      /* interactive=false（预览）时不进入下单流程；浏览与键盘导航仍然可用。 */
                      onSelect={interactive ? setSelection : () => undefined}
                      /* 预览中分期入口同样不应产生订单，交由父层决定是否可用。 */
                      onInstallment={setInstallmentPlan}
                    />
                  )
                })}
              </div>
            ) : null}
          </div>

          {/**
            * 「查看更多权益」按钮。
            *
            * 出现条件是**卡片权益行数超过阈值**（自动折叠），
            * 而不是「是否配置了 extraBenefits」：
            * 早先没配 extraBenefits 的卡片即使有十几行权益也不会折叠，
            * 按钮也不出现，运营看不到折叠效果。
            */}
          {/* 折叠状态按「当前档位 + 当前周期」的行数判定，与卡片展示同一份来源。 */}
          {status === 'ready' && visibleProducts.some((plan) => {
            const active = plan.tiers.find((tier) => tier.pricing[billingCycle]) ?? plan.tiers[0]
            return planNeedsFold(benefitGroupsOf(plan, active, billingCycle))
          }) ? (
            <button
              className={membershipStyles.moreBenefitsButton}
              type="button"
              aria-expanded={showMore}
              data-testid="plan-more-benefits"
              onClick={() => setShowMore((current) => !current)}
            >
              {showMore ? '收起更多权益' : '查看更多权益'}
              <ChevronDown data-open={showMore ? 'true' : 'false'} aria-hidden="true" />
            </button>
          ) : null}
        </section>

        {status === 'ready' && effectiveAudience === 'creator' && visibleProducts.length > 0 ? (
          <>
            {generationColumns.length > 0 && generationRows.length > 0 ? <ComparisonTable columns={generationColumns} rows={generationRows} /> : null}
            {faqItems.length > 0 ? <MembershipFaq items={faqItems} /> : null}
          </>
        ) : null}
      </main>

      <MembershipDialogs
        selection={selection}
        billingOption={billingOption}
        pointsRulesOpen={pointsRulesOpen}
        installmentPlan={installmentPlan}
        submitting={submitting}
        errorMessage={purchaseError}
        onSelectionOpenChange={(open) => {
          if (!open && !submitting) setSelection(null)
        }}
        onPointsRulesOpenChange={setPointsRulesOpen}
        onInstallmentOpenChange={(open) => {
          if (!open) setInstallmentPlan(null)
        }}
        onConfirm={confirmSelection}
      />
    </div>
  )
}
