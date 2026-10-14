'use client'

import { useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { planNeedsFold } from './benefits'
import { PlanCard } from './plan-card'
import { isCurrentSelection, liveSelection, selectedBenefits, validPricing } from './purchase-helpers'
import { policyCanBeReviewed, PurchaseConfirmation } from './purchase-confirmation'
import type { BillingCycle, MembershipAudience, MembershipPurchaseViewProps, MembershipSelection } from './types'
import styles from './membership.module.css'

export function MembershipPurchaseView({ storefront = 'plans', products, campaign, billingOptions, generationColumns, generationRows, faqItems, currentMembership, initialAudience, initialBillingCycle, controlledAudience, controlledBillingCycle, onAudienceChange, onBillingCycleChange, onTierChange, commercePolicy, status = 'ready', errorMessage, onRetry, preview = false, interactive = true, showMoreDefault = false, onSelectPlan, onClose }: MembershipPurchaseViewProps) {
  const creditsStore = storefront === 'credits'
  const [localAudience, setLocalAudience] = useState<MembershipAudience>(initialAudience ?? products[0]?.audience ?? 'creator')
  const [localCycle, setLocalCycle] = useState<BillingCycle>(initialBillingCycle ?? billingOptions[0]?.value ?? 'monthly')
  const [tierIds, setTierIds] = useState<Record<string, string>>({})
  const [showMore, setShowMore] = useState(showMoreDefault)
  const [selection, setSelection] = useState<MembershipSelection | null>(null)
  const [agreementPolicy, setAgreementPolicy] = useState('')
  const [busy, setBusy] = useState(false)
  const [purchaseError, setPurchaseError] = useState('')
  const purchaseLock = useRef(false)
  const audience = controlledAudience ?? localAudience
  const cycle = creditsStore ? 'once' : controlledBillingCycle ?? localCycle
  const option = billingOptions.find(item => item.value === cycle)
  const browseOptions = billingOptions.filter(item => creditsStore ? item.value === 'once' : item.value !== 'once')
  const audiences = [...new Set(products.map(item => item.audience))]
  const visiblePlans = products.filter(plan => creditsStore || plan.audience === audience)
  const offers = option ? visiblePlans.flatMap(plan => {
    const tiers = plan.tiers.filter(tier => validPricing(tier.pricing[cycle]))
    const tier = tiers.find(item => item.id === tierIds[plan.id]) ?? tiers[0]
    return tier ? [{ plan, tier }] : []
  }) : []
  const folds = offers.some(({ plan, tier }) => planNeedsFold(selectedBenefits(plan, tier, cycle)))
  const canPurchase = interactive && !preview && status === 'ready'
  const policyIdentity = commercePolicy ? JSON.stringify(commercePolicy) : ''
  const agreed = Boolean(agreementPolicy) && agreementPolicy === policyIdentity

  function changeAudience(next: MembershipAudience) {
    if (purchaseLock.current) return
    setLocalAudience(next)
    onAudienceChange?.(next)
  }
  function changeCycle(next: BillingCycle) {
    if (purchaseLock.current) return
    setLocalCycle(next)
    onBillingCycleChange?.(next)
  }
  function review(next: MembershipSelection) {
    if (!canPurchase || purchaseLock.current || isCurrentSelection(next, currentMembership)) return
    const live = liveSelection(next, products)
    if (!live) return
    setSelection({ ...live, pricing: { ...live.pricing } })
    setAgreementPolicy('')
    setPurchaseError('')
  }
  function cancelReview() {
    if (purchaseLock.current) return
    setSelection(null)
    setAgreementPolicy('')
    setPurchaseError('')
  }
  async function confirm() {
    if (!selection || purchaseLock.current || !canPurchase || !agreed || !policyCanBeReviewed(commercePolicy)) return
    const live = liveSelection(selection, products)
    if (!live || isCurrentSelection(selection, currentMembership)) {
      setPurchaseError('商品或会员状态已变更，请返回重新选择并核对。')
      setAgreementPolicy('')
      return
    }
    purchaseLock.current = true
    setBusy(true)
    setPurchaseError('')
    try {
      await onSelectPlan(live)
      setSelection(null)
      setAgreementPolicy('')
    } catch (reason) {
      setPurchaseError(reason instanceof Error ? reason.message : '购买暂未完成，请重试。')
    } finally {
      purchaseLock.current = false
      setBusy(false)
    }
  }

  return <section className={`${styles.themeScope} ${styles.viewportScope} ${preview ? styles.previewRoot : styles.storeRoot}`} aria-label={creditsStore ? '积分超市' : '会员套餐'} aria-busy={busy || status === 'loading'} data-storefront={storefront}>
    <div className={styles.storeContent}>
      <header className={styles.storeHeader}>
        <div><p className={styles.storeEyebrow}>{creditsStore ? '积分超市' : '创作会员'}</p><h1>{creditsStore ? '给灵感，多一点可能' : '为下一部作品，选好创作空间'}</h1><p className={styles.storeIntro}>{creditsStore ? '无需开通会员，按需购买，支付确认后计入账户。' : '选择适合你的套餐，积分与权益清晰可见。'}</p></div>
        <button className={styles.exitButton} type="button" aria-label="关闭并返回" disabled={busy} onClick={onClose}><span aria-hidden="true">×</span><span>返回</span></button>
      </header>
      {campaign ? <aside className={styles.campaignPanel}><img src={campaign.imageSrc} alt={campaign.imageAlt} /><div><p>{campaign.title}</p><span>{campaign.subtitle}</span></div></aside> : null}
      {!creditsStore ? <div className={styles.browseBar}>
        {audiences.length > 1 ? <div className={styles.browseGroup} role="group" aria-label="会员类型">{audiences.map(value => <button type="button" key={value} aria-pressed={audience === value} disabled={busy} onClick={() => changeAudience(value)}>{value === 'team' ? '团队版' : '创作会员'}</button>)}</div> : null}
        <div className={styles.browseGroup} role="group" aria-label="付款周期">{browseOptions.map(item => <button type="button" key={item.value} aria-pressed={cycle === item.value} disabled={busy} onClick={() => changeCycle(item.value)}>{item.label}</button>)}</div>
      </div> : null}
      {preview || !interactive ? <p className={styles.previewNotice}>仅供预览 · 可切换商品选项，购买功能已关闭。</p> : null}

      {status === 'loading' ? <div className={styles.catalogState} role="status">正在读取商品与价格…</div> : status === 'error' ? <div className={styles.catalogState} role="alert"><p>{errorMessage || '商品加载失败。'}</p>{onRetry ? <Button type="button" onClick={onRetry}>重新加载</Button> : null}</div> : offers.length ? <>
        <div className={styles.planGrid} style={{ '--plan-count': offers.length } as CSSProperties}>
          {offers.map(({ plan, tier }) => <PlanCard key={plan.id} plan={plan} tier={tier} billingCycle={cycle} billingOption={option!} showMore={showMore} isCurrent={isCurrentSelection({ plan, tier, billingCycle: cycle }, currentMembership)} interactive={canPurchase} busy={busy} onTierChange={next => { if (purchaseLock.current) return; setTierIds(previous => ({ ...previous, [plan.id]: next.id })); onTierChange?.(plan.id, next.id) }} onSelect={review} onInstallment={() => undefined} />)}
        </div>
        {folds ? <button className={styles.moreBenefitsButton} type="button" aria-expanded={showMore} onClick={() => setShowMore(value => !value)}>{showMore ? '收起更多权益' : '查看更多权益'}</button> : null}
      </> : <div className={styles.catalogState}><p>{creditsStore ? '还没有上架的积分包。' : '当前类型和周期暂无可购买的商品。'}</p><span>{creditsStore ? '商品上架后会在这里显示真实价格与积分。' : '可以切换其他周期或会员类型查看。'}</span></div>}

      {generationColumns.length > 0 && generationRows.length > 0 ? <section className={styles.detailSection} aria-label="商品能力对比"><h2>商品能力对比</h2><div className={styles.comparisonScroll} tabIndex={0}><table><caption>以下数值由商品配置提供</caption><thead><tr><th scope="col">项目</th>{generationColumns.map(column => <th scope="col" key={column.id}>{column.label}</th>)}</tr></thead><tbody>{generationRows.map((row, index) => <tr key={`${row.name}-${index}`}><th scope="row">{row.name}（{row.unit}）</th>{generationColumns.map(column => <td key={column.id}>{row.values[column.id] ?? '—'}</td>)}</tr>)}</tbody></table></div></section> : null}
      {faqItems.length > 0 ? <section className={styles.detailSection} aria-label="购买常见问题"><h2>常见问题</h2>{faqItems.map((item, index) => <details className={styles.questionRow} key={`${index}-${item.question}`}><summary>{item.question}</summary>{item.answer ? <p>{item.answer}</p> : null}</details>)}</section> : null}
    </div>
    {selection && canPurchase ? <PurchaseConfirmation selection={selection} billingOption={billingOptions.find(item => item.value === selection.billingCycle)} commercePolicy={commercePolicy} agreed={agreed} busy={busy} error={purchaseError} onAgreementChange={value => setAgreementPolicy(value ? policyIdentity : '')} onConfirm={confirm} onCancel={cancelReview} /> : null}
  </section>
}
