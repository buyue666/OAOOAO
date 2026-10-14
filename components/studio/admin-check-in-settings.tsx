'use client'

import { useState } from 'react'
import type { CheckInRewardRule, CheckInSettings } from '@/lib/studio/check-in-rules'
import type { EntitlementPlan } from '@/lib/studio/admin-types'
import { AdminField, AdminInput, AdminSelect } from './admin-kit'

export function CheckInRewardFields({ prefix, initial }: { prefix: string; initial: CheckInRewardRule }) {
  const [limited, setLimited] = useState((initial.validityDays ?? 0) > 0)
  const [days, setDays] = useState(String(initial.validityDays || 7))
  return <div className="grid gap-4 sm:grid-cols-2">
    <AdminField label="奖励积分"><AdminInput name={`${prefix}RewardPoints`} type="number" min="1" max="1000000" step="1" required defaultValue={initial.rewardPoints} /></AdminField>
    <AdminField label="奖励有效期"><AdminSelect name={`${prefix}ValidityMode`} value={limited ? 'limited' : 'permanent'} onChange={event => setLimited(event.target.value === 'limited')}><option value="permanent">永久有效</option><option value="limited">指定天数</option></AdminSelect></AdminField>
    {limited && <div className="sm:col-span-2">
      <AdminField label="领取后有效天数"><AdminInput name={`${prefix}ValidityDays`} type="number" min="1" max="3650" step="1" required value={days} onChange={event => setDays(event.target.value)} /></AdminField>
      <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">常用</span>{[1, 7, 30].map(value => <button key={value} type="button" onClick={() => setDays(String(value))} aria-pressed={days === String(value)} className="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted aria-pressed:border-studio-accent aria-pressed:text-studio-accent">{value} 天</button>)}</div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">支持 1–3650 天。从实际领取时刻开始计算，每天为连续 24 小时。</p>
    </div>}
  </div>
}

function PlanCheckInReward({ plan, override, base }: { plan: EntitlementPlan; override?: CheckInRewardRule; base: CheckInRewardRule }) {
  const [custom, setCustom] = useState(Boolean(override))
  return <div className="rounded-lg border border-border p-4">
    <label className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="min-w-0 font-medium">{plan.name || plan.id}{!plan.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">套餐已停用</span>}</span><span className="flex items-center gap-2"><input type="checkbox" name={`checkInPlan:${plan.id}:Enabled`} checked={custom} onChange={event => setCustom(event.target.checked)} />单独配置</span></label>
    {!custom && <p className="mt-2 text-xs text-muted-foreground">沿用基础签到规则。</p>}
    <fieldset hidden={!custom} disabled={!custom} className="mt-4"><legend className="sr-only">{plan.name || plan.id} 专属签到规则</legend><CheckInRewardFields prefix={`checkInPlan:${plan.id}:`} initial={override ?? base} /></fieldset>
  </div>
}

export function AdminCheckInSettings({ settings, plans, saving }: { settings: CheckInSettings; plans: EntitlementPlan[]; saving: boolean }) {
  const knownIds = new Set(plans.map(plan => plan.id))
  const orphanRules = (settings.planRewards ?? []).filter(rule => !knownIds.has(rule.planId))
  return <fieldset disabled={saving} className="space-y-5">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="checkInEnabled" defaultChecked={settings.enabled} />开启手动签到</label>
    <fieldset className="space-y-3"><legend className="text-sm font-medium">基础规则</legend><p className="mt-1 text-xs text-muted-foreground">普通用户及未单独配置签到规则的套餐使用此规则。</p><CheckInRewardFields prefix="checkIn" initial={settings} /></fieldset>
    <div className="space-y-3 border-t border-border pt-5"><div><h3 className="text-sm font-medium">套餐专属规则</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">按领取时生效的套餐匹配。取消「单独配置」并保存后，该套餐恢复沿用基础规则。</p></div>
      {plans.length ? plans.map(plan => <PlanCheckInReward key={plan.id} plan={plan} base={settings} override={settings.planRewards?.find(rule => rule.planId === plan.id)} />) : <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">尚未配置套餐。可先在「计费与权益」中添加方案。</p>}
      {orphanRules.length > 0 && <p role="status" className="text-xs leading-5 text-amber-700 dark:text-amber-300">有 {orphanRules.length} 条规则对应的套餐已从列表移除；保存时将一并移除这些失效规则。</p>}
    </div>
  </fieldset>
}
