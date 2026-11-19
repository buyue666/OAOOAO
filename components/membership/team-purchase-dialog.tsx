'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { request, type TeamPurchaseInput } from '@/lib/studio/api'
import type { TeamPlan, TeamSummary } from '@/lib/studio/team-types'
import type { CommercePolicy } from '@/lib/studio/commerce-policy'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { policyCanBeReviewed } from './purchase-confirmation'
import styles from './membership.module.css'

export function TeamPurchaseDialog({ selection, accountId, policy, paymentControl, onCancel, onPurchase }: { selection: { plan: TeamPlan; seats: number } | null; accountId: string; policy?: CommercePolicy | null; paymentControl?: ReactNode; onCancel: () => void; onPurchase: (input: TeamPurchaseInput) => Promise<void> }) {
  const teams = useSWR<{ teams: TeamSummary[] }>(selection ? ['purchase-teams', accountId] : null, () => request('/api/teams'), { shouldRetryOnError: false })
  const [teamId, setTeamId] = useState(''), [name, setName] = useState(''), [agreed, setAgreed] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const lock = useRef(false), epoch = useRef(accountId)
  epoch.current = accountId
  const managed = teams.data?.teams.filter(team => team.role === 'owner' || team.role === 'admin') ?? []
  useEffect(() => { setTeamId(''); setName(''); setAgreed(false); setError('') }, [selection, accountId])
  const selectedTeam = managed.find(team => team.id === teamId)
  const active = selectedTeam?.subscriptionExpiresAt && Date.parse(selectedTeam.subscriptionExpiresAt) > Date.now()
  const currentPlan = selectedTeam as TeamSummary & { planId?: string } | undefined
  const mismatch = active && (currentPlan?.planId !== selection?.plan.id || selectedTeam?.seatLimit !== selection?.seats)
  const total = selection ? selection.plan.priceCents! * selection.seats : 0
  const valid = !!selection && !teams.isLoading && !teams.error && !mismatch && (teamId ? !!selectedTeam : !!name.trim()) && agreed && policyCanBeReviewed(policy)
  async function confirm() {
    if (!valid || lock.current || !selection) return
    lock.current = true; setBusy(true); setError('')
    const actor = accountId
    try { await onPurchase({teamPlanId:selection.plan.id,seats:selection.seats,expectedAmountCents:total,...(teamId ? {teamId} : {teamName:name.trim()})}) }
    catch (reason) { if (epoch.current === actor) setError(reason instanceof Error ? reason.message : '订单创建失败，请重试') }
    finally { lock.current = false; if (epoch.current === actor) setBusy(false) }
  }
  return <Dialog open={!!selection} onOpenChange={open => { if (!open && !busy) onCancel() }}><DialogContent showCloseButton={false} className={`${styles.themeScope} ${styles.reviewPanel}`}>
    <DialogHeader><DialogTitle>确认开通团队套餐</DialogTitle><DialogDescription>选择要开通的团队，核对金额后前往支付。付款确认后自动生效。</DialogDescription></DialogHeader>
    {selection && <>
      <dl className={styles.reviewSummary}><div><dt>套餐与席位</dt><dd>{selection.plan.name} · {selection.seats} 席 / 30 天</dd></div><div><dt>本次支付</dt><dd><strong>¥{(total / 100).toLocaleString('zh-CN')}</strong></dd></div><div><dt>团队积分</dt><dd>{(selection.plan.pointsPerSeat * selection.seats).toLocaleString('zh-CN')} 积分，到账后发放</dd></div><div><dt>积分有效期</dt><dd>{selection.plan.creditValidityDays} 天；续费按延长后的周期计算</dd></div></dl>
      <label className="block text-sm font-medium">开通到哪个团队<select aria-label="开通团队" value={teamId} disabled={busy || teams.isLoading} onChange={event => { setTeamId(event.target.value); setError('') }} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"><option value="">创建新团队并开通</option>{managed.map(team => <option key={team.id} value={team.id}>{team.name}{team.subscriptionExpiresAt && Date.parse(team.subscriptionExpiresAt)>Date.now() ? ' · 续费' : ''}</option>)}</select></label>
      {!teamId && <label className="block text-sm font-medium">新团队名称<input aria-label="新团队名称" maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：我的创作团队" className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" /></label>}
      {teams.isLoading && <p role="status" className={styles.reviewNote}>正在读取你的团队…</p>}
      {teams.error && <p role="alert" className={styles.reviewError}>团队读取失败。<button type="button" onClick={() => void teams.mutate()}>重新加载</button></p>}
      {mismatch && <p role="alert" className={styles.reviewError}>当前团队套餐仍有效，请选择相同套餐和席位续费，或创建新团队。</p>}
      {paymentControl}
      <p className={styles.reviewNote}>团队积分进入团队钱包，与个人积分分开。现有套餐续费会延长 30 天，不会自动续扣费用。</p>
      {policyCanBeReviewed(policy) ? <><details className="rounded-lg border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">查看购买规则</summary><dl className={styles.policyList}>{[['退款规则',policy.refundPolicy],['续费规则',policy.renewalPolicy],['发票规则',policy.invoicePolicy]].map(([title,description]) => <div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}</dl></details><label className={styles.agreementRow}><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} /><span>我已核对团队、席位和金额，阅读并同意购买规则（{policy.version}）。</span></label></> : <p role="alert" className={styles.reviewError}>购买规则暂时不可用，请刷新后重试。</p>}
      {error && <p role="alert" className={styles.reviewError}>{error}</p>}
      <div className={styles.reviewActions}><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>返回修改</Button><Button type="button" disabled={busy || !valid} onClick={() => void confirm()}>{busy ? '正在创建订单…' : '确认并前往支付'}</Button></div>
    </>}
  </DialogContent></Dialog>
}
