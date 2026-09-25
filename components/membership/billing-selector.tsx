import { CircleHelp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import styles from './membership.module.css'
import type { BillingCycle, BillingOption, MembershipAudience } from './types'

const audienceOptions: Array<{ value: MembershipAudience; label: string }> = [
  { value: 'creator', label: '创作会员' },
  { value: 'team', label: '团队版会员' },
]

interface BillingSelectorProps {
  audience: MembershipAudience
  billingCycle: BillingCycle
  options: BillingOption[]
  onAudienceChange: (audience: MembershipAudience) => void
  onBillingCycleChange: (cycle: BillingCycle) => void
  onOpenPointsRules: () => void
  /** 预览中只允许浏览筛选，不允许打开积分规则弹窗等会产生额外状态的操作。 */
  disabled?: boolean
}

export function BillingSelector({
  audience,
  billingCycle,
  options,
  onAudienceChange,
  onBillingCycleChange,
  onOpenPointsRules,
  disabled = false,
}: BillingSelectorProps) {
  return (
    <section className={styles.selectorArea} aria-label="会员方案筛选">
      <div className={styles.audienceTabs} role="tablist" aria-label="会员类型">
        {audienceOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={audience === option.value}
            disabled={disabled}
            onClick={() => onAudienceChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.billingRow}>
        <div className={styles.billingSwitch} role="group" aria-label="付费周期">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={billingCycle === option.value}
              disabled={disabled}
              onClick={() => onBillingCycleChange(option.value)}
            >
              <span>{option.label}</span>
              {option.discountLabel ? (
                <Badge variant="secondary">{option.discountLabel}</Badge>
              ) : null}
            </button>
          ))}
        </div>
        <button className={styles.pointsRulesButton} type="button" disabled={disabled} onClick={onOpenPointsRules}>
          <CircleHelp aria-hidden="true" />
          积分规则
        </button>
      </div>
    </section>
  )
}
