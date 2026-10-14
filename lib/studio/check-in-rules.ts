export type CheckInRewardRule = { rewardPoints: number; validityDays?: number }
export type CheckInPlanReward = CheckInRewardRule & { planId: string }
export type CheckInSettings = CheckInRewardRule & { enabled: boolean; planRewards?: CheckInPlanReward[] }
export type CheckInStatus = CheckInRewardRule & {
  enabled: boolean; claimed: boolean; date: string; timeZone: string
  rulePlanId?: string | null; rulePlanName?: string | null
  claimedRewardPoints?: number | null; claimedValidityDays?: number | null
  claimedPlanId?: string | null; claimedPlanName?: string | null; expiresAt?: string | null
}

type FormValues = { get(name: string): unknown; has(name: string): boolean }
export function readCheckInForm(data: FormValues, plans: readonly { id: string }[]) {
  function integer(name: string, label: string, min: number, max: number) {
    const raw = data.get(name)
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) throw new Error(`${label}必须为整数。`)
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}须在 ${min.toLocaleString('zh-CN')}–${max.toLocaleString('zh-CN')} 之间。`)
    return value
  }
  function rule(prefix: string) {
    const mode = data.get(`${prefix}ValidityMode`)
    if (mode !== null && mode !== undefined && mode !== 'permanent' && mode !== 'limited') throw new Error('请选择签到奖励有效期。')
    return {
      rewardPoints: integer(`${prefix}RewardPoints`, '签到奖励积分', 1, 1_000_000),
      validityDays: mode === 'limited' ? integer(`${prefix}ValidityDays`, '有效天数', 1, 3650) : 0,
    }
  }
  return {
    enabled: data.has('checkInEnabled'),
    ...rule('checkIn'),
    // The entire array is replaced. Unchecking a plan removes its override instead
    // of merging an old rule back into the saved configuration.
    planRewards: plans.filter(plan => data.has(`checkInPlan:${plan.id}:Enabled`)).map(plan => ({ planId: plan.id, ...rule(`checkInPlan:${plan.id}:`) })),
  }
}

export function checkInRuleChanges(previous: CheckInSettings, next: CheckInSettings, plans: readonly { id: string; name: string }[]) {
  const result: string[] = []
  const describe = (rule: CheckInRewardRule) => `${rule.rewardPoints.toLocaleString('zh-CN')} 积分，${rule.validityDays ? `领取后 ${rule.validityDays} 天有效` : '永久有效'}`
  const differs = (a: CheckInRewardRule | undefined, b: CheckInRewardRule | undefined) => !a || !b ? a !== b : a.rewardPoints !== b.rewardPoints || (a.validityDays ?? 0) !== (b.validityDays ?? 0)
  if (next.enabled !== previous.enabled) result.push(`手动签到：${next.enabled ? '开启' : '关闭'}`)
  if (differs(previous, next)) result.push(`基础签到规则：${describe(next)}`)
  const before = new Map((previous.planRewards ?? []).map(rule => [rule.planId, rule]))
  const after = new Map((next.planRewards ?? []).map(rule => [rule.planId, rule]))
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id), rule = after.get(id)
    if (differs(old, rule)) result.push(`${plans.find(plan => plan.id === id)?.name || id}：${rule ? describe(rule) : '移除专属规则，沿用基础规则'}`)
  }
  return result
}

export function formatPointsExpiry(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date)
}

/** Claimed rewards use their immutable server snapshot, never today's new rule. */
export function checkInDisplay(status: CheckInStatus) {
  if (status.claimed) {
    const amount = typeof status.claimedRewardPoints === 'number' ? ` ${status.claimedRewardPoints.toLocaleString('zh-CN')} 积分` : ''
    const expiry = formatPointsExpiry(status.expiresAt)
    return {
      title: `今日已领取${amount}`,
      rule: status.claimedPlanName ? `${status.claimedPlanName} · 领取时规则` : '领取时的签到规则',
      validity: expiry ? `${expiry} 到期（北京时间）` : status.claimedValidityDays === 0 || (status.expiresAt === null && status.claimedValidityDays == null) ? '本次奖励永久有效' : '本次奖励有效期以账户记录为准',
    }
  }
  const days = status.validityDays ?? 0
  return {
    title: status.enabled ? `可领 ${status.rewardPoints.toLocaleString('zh-CN')} 积分` : '签到暂未开放',
    rule: status.rulePlanName ? `${status.rulePlanName} 专属签到` : '基础签到规则',
    validity: days === 0 ? '奖励永久有效' : `领取后 ${days} 天有效（每天 24 小时）`,
  }
}
