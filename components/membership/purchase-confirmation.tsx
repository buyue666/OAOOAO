'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isHttpsPolicyUrl, isSupportEmail, type CommercePolicy } from '@/lib/studio/commerce-policy'
import { resolveTierDisplay } from '@/lib/studio/membership'
import { formatPrice } from './purchase-helpers'
import type { BillingOption, MembershipSelection } from './types'
import styles from './membership.module.css'

export function policyCanBeReviewed(policy?: CommercePolicy | null): policy is CommercePolicy {
  return policy?.status === 'published' && [policy.version, policy.refundPolicy, policy.pointsExpiryPolicy, policy.renewalPolicy, policy.invoicePolicy].every(value => Boolean(value?.trim()))
    && (isSupportEmail(policy.supportEmail) || isHttpsPolicyUrl(policy.supportUrl))
}

export interface PurchaseConfirmationProps {
  selection: MembershipSelection | null
  billingOption?: BillingOption
  commercePolicy?: CommercePolicy | null
  agreed: boolean
  busy: boolean
  error: string
  onAgreementChange: (agreed: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

export function PurchaseConfirmation({ selection, billingOption, commercePolicy, agreed, busy, error, onAgreementChange, onConfirm, onCancel }: PurchaseConfirmationProps) {
  const reviewedPolicy = policyCanBeReviewed(commercePolicy) ? commercePolicy : null
  const display = selection ? resolveTierDisplay(selection.tier, selection.billingCycle) : null
  return <Dialog open={Boolean(selection)} onOpenChange={open => { if (!open && !busy) onCancel() }}>
    <DialogContent className={`${styles.themeScope} ${styles.reviewPanel}`} showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>{selection?.billingCycle === 'once' ? '确认购买积分' : '确认开通会员'}</DialogTitle>
        <DialogDescription>请核对商品、付款金额和购买规则后再继续。</DialogDescription>
      </DialogHeader>
      {selection ? <>
        <dl className={styles.reviewSummary}>
          <div><dt>商品</dt><dd>{selection.plan.name} · {selection.tier.label}</dd></div>
          <div><dt>周期</dt><dd>{selection.billingCycle === 'once' ? '一次性购买' : billingOption?.label ?? selection.billingCycle}</dd></div>
          <div><dt>本次支付</dt><dd><strong>{formatPrice(selection.pricing)}</strong></dd></div>
          <div><dt>一次发放</dt><dd>{selection.pricing.credits?.toLocaleString('zh-CN')} 积分</dd></div>
          {display?.dailyPoints !== undefined && display.dailyPoints > 0 ? <div><dt>每日积分</dt><dd>{display.dailyPoints.toLocaleString('zh-CN')} 积分</dd></div> : null}
        </dl>
        {selection.pricing.renewalText ? <p className={styles.reviewNote}>{selection.pricing.renewalText}</p> : null}
        {reviewedPolicy ? <>
          <dl className={styles.policyList}>
            {([['积分有效期', reviewedPolicy.pointsExpiryPolicy], ['退款规则', reviewedPolicy.refundPolicy], ['续费规则', reviewedPolicy.renewalPolicy], ['发票规则', reviewedPolicy.invoicePolicy]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            <div><dt>客服</dt><dd>{isSupportEmail(reviewedPolicy.supportEmail) ? <a href={`mailto:${reviewedPolicy.supportEmail}`}>{reviewedPolicy.supportEmail}</a> : null}{isHttpsPolicyUrl(reviewedPolicy.supportUrl) ? <a href={reviewedPolicy.supportUrl} target="_blank" rel="noopener noreferrer">联系客服</a> : null}</dd></div>
          </dl>
          <p className={styles.reviewNote}>购买政策版本：{reviewedPolicy.version}</p>
          <label className={styles.agreementRow}><input type="checkbox" checked={agreed} disabled={busy} onChange={event => onAgreementChange(event.target.checked)} /><span>我已阅读上述购买规则，并同意<a href="/terms" target="_blank" rel="noopener noreferrer">服务条款</a>及<a href="/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a>。</span></label>
        </> : <p className={styles.reviewError} role="alert">购买政策尚未完整发布，暂时无法下单。</p>}
        {error ? <p className={styles.reviewError} role="alert">{error}</p> : null}
        <div className={styles.reviewActions}>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>返回选择</Button>
          <Button type="button" disabled={busy || !agreed || !reviewedPolicy} onClick={onConfirm}>{busy ? '正在提交…' : error ? '重试购买' : '确认并继续支付'}</Button>
        </div>
      </> : null}
    </DialogContent>
  </Dialog>
}
