import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import styles from './membership.module.css'
import type { BillingOption, MembershipPlan, MembershipSelection } from './types'

const money = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const credits = new Intl.NumberFormat('zh-CN')

interface MembershipDialogsProps {
  selection: MembershipSelection | null
  billingOption?: BillingOption
  pointsRulesOpen: boolean
  installmentPlan: MembershipPlan | null
  submitting: boolean
  errorMessage?: string
  onSelectionOpenChange: (open: boolean) => void
  onPointsRulesOpenChange: (open: boolean) => void
  onInstallmentOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function MembershipDialogs({
  selection,
  billingOption,
  pointsRulesOpen,
  installmentPlan,
  submitting,
  errorMessage,
  onSelectionOpenChange,
  onPointsRulesOpenChange,
  onInstallmentOpenChange,
  onConfirm,
}: MembershipDialogsProps) {
  return (
    <>
      <Dialog open={Boolean(selection)} onOpenChange={onSelectionOpenChange}>
        <DialogContent className={styles.dialogContent} showCloseButton={!submitting}>
          <DialogHeader>
            <Badge variant="outline">订单确认</Badge>
            <DialogTitle>确认开通会员</DialogTitle>
            <DialogDescription>
              请核对套餐、周期与金额，确认后进入支付。
            </DialogDescription>
          </DialogHeader>
          {selection ? (
            <dl className={styles.dialogSummary}>
              <div><dt>套餐</dt><dd>{selection.plan.name}</dd></div>
              <div><dt>周期</dt><dd>{billingOption?.label ?? selection.billingCycle}</dd></div>
              <div><dt>档位</dt><dd>{selection.tier.label}</dd></div>
              <div><dt>积分</dt><dd>{credits.format(selection.pricing.credits ?? selection.tier.credits)} {selection.pricing.creditLabel ?? '积分'}</dd></div>
              <div><dt>应付金额</dt><dd>{selection.pricing.priceInCents === undefined ? '待配置' : `${selection.pricing.currency === 'USD' ? '$' : selection.pricing.currency === 'CNY' ? '¥' : selection.pricing.currency ?? ''}${money.format(selection.pricing.priceInCents / 100)}/${billingOption?.priceSuffix ?? '期'}`}</dd></div>
            </dl>
          ) : null}
          {errorMessage && <p role="alert" className="text-sm text-red-400">{errorMessage}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => onSelectionOpenChange(false)}>取消</Button>
            <Button disabled={submitting} onClick={onConfirm}>{submitting ? '处理中…' : '确认并继续'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pointsRulesOpen} onOpenChange={onPointsRulesOpenChange}>
        <DialogContent className={styles.dialogContent}>
          <DialogHeader>
            <DialogTitle>积分规则</DialogTitle>
            <DialogDescription>按所选商品的权益和有效期发放。</DialogDescription>
          </DialogHeader>
          <div className={styles.policyPlaceholder}>
            商品标示的积分为该订单的发放数量；每日积分单独列出。周期价格为整期实付价格。付款成功后，可在账户中查看余额和订单。
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(installmentPlan)} onOpenChange={onInstallmentOpenChange}>
        <DialogContent className={styles.dialogContent}>
          <DialogHeader>
            <Badge variant="outline">说明</Badge>
            <DialogTitle>{installmentPlan?.name ?? '套餐'}分期</DialogTitle>
            <DialogDescription>此入口仅展示交互说明，不连接支付授权。</DialogDescription>
          </DialogHeader>
          <div className={styles.policyPlaceholder}>
            可用期数、免息范围、手续费和支付渠道均待正式支付系统配置。
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
