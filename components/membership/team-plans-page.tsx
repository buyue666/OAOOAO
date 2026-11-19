'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { request } from '@/lib/studio/api'
import type { TeamPlan } from '@/lib/studio/team-types'
import { useStudio } from '@/lib/studio/store'
import { tones } from '@/lib/studio/membership'
import { TeamPlanCard } from './team-plan-card'
import { TeamPurchaseDialog } from './team-purchase-dialog'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { CommercePolicy } from '@/lib/studio/commerce-policy'
import type { TeamPurchaseInput } from '@/lib/studio/api'
import styles from './membership.module.css'

export function TeamPlansPage({ purchaseEnabled, policy, paymentControl, onPurchase }: { purchaseEnabled: boolean; policy: CommercePolicy | null; paymentControl?: ReactNode; onPurchase: (input: TeamPurchaseInput) => Promise<void> }) {
  const router=useRouter()
  const [selection,setSelection]=useState<{plan:TeamPlan;seats:number}|null>(null)
  const { state } = useStudio()
  const query = useSWR<{ plans: TeamPlan[]; purchaseEnabled: boolean }>('/api/team-plans', path => request(path), { shouldRetryOnError: false })
  return <div className={`${styles.viewportScope} ${styles.embeddedPurchase}`}>
      <div className={styles.teamCatalogBar}><p>按席位计价 · 在线支付自动开通</p><Link href="/teams">团队空间</Link>{state.backendStatus === 'connected' && state.user.role === 'admin' && <Link href="/admin/team-plans">管理团队套餐</Link>}</div>
      {query.isLoading ? <div role="status" className={styles.catalogState}>正在读取团队套餐…</div> : query.error ? <div className={styles.catalogState}><p role="alert">团队套餐暂时不可用：{query.error instanceof Error ? query.error.message : '读取失败'}</p><button type="button" className={styles.moreBenefitsButton} onClick={() => void query.mutate()}>重新加载</button></div> : query.data?.plans.length ? <div className={styles.planGrid}>{query.data.plans.map((plan, index) => <TeamPlanCard key={plan.id} plan={plan} tone={tones[index % tones.length]} purchaseEnabled={purchaseEnabled && query.data?.purchaseEnabled === true} onPurchase={(plan,seats) => { if(state.backendStatus!=='connected'){router.push('/login?next='+encodeURIComponent('/plans?edition=team'));return} setSelection({plan,seats}) }} />)}</div> : <div className={styles.catalogState}>暂无已配置的团队套餐。</div>}
      {!purchaseEnabled && <p role="status" className={styles.teamCatalogFoot}>正在确认可用支付方式，请稍候；如持续不可用可刷新重试。</p>}
      <TeamPurchaseDialog key={state.user.id} selection={selection} accountId={state.user.id} policy={policy} paymentControl={paymentControl} onCancel={() => setSelection(null)} onPurchase={async input => { await onPurchase(input); setSelection(null) }} />
      <p className={styles.teamCatalogFoot}>团队套餐到期不自动扣款。团队积分和容量由团队成员共享。</p>
  </div>
}
