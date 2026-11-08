'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { SiteBrand } from '@/components/site-brand'
import { request } from '@/lib/studio/api'
import type { TeamPlan } from '@/lib/studio/team-types'
import { useStudio } from '@/lib/studio/store'
import { tones } from '@/lib/studio/membership'
import { TeamPlanCard } from './team-plan-card'
import styles from './membership.module.css'

export function TeamPlansPage() {
  const { state } = useStudio()
  const query = useSWR<{ plans: TeamPlan[]; purchaseEnabled: false }>('/api/team-plans', path => request(path), { shouldRetryOnError: false })
  return <div className={`${styles.themeScope} min-h-dvh`}>
    <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm"><Link href="/studio" aria-label="返回创作工作台"><SiteBrand tone="dark" imageClassName="h-7" /></Link><div className="flex items-center gap-4"><Link href="/teams" className="text-zinc-300">团队空间</Link>{state.backendStatus === 'connected' && state.user.role === 'admin' && <Link href="/admin/team-plans" className="text-zinc-300">管理团队套餐</Link>}</div></header>
    <nav aria-label="会员版本" className="mx-auto mb-5 flex w-fit gap-1 rounded-full border border-white/15 p-1 text-sm"><Link href="/plans" className="min-h-11 rounded-full px-6 py-3 text-zinc-300 hover:bg-white/10">个人版</Link><Link href="/plans?edition=team" aria-current="page" className="min-h-11 rounded-full bg-white px-6 py-3 font-medium text-black">团队版</Link></nav>
    <main className={styles.viewportScope}><div className={styles.storeRoot}><div className={styles.storeContent}>
      <div className={styles.storeHeader}><p className={styles.storeEyebrow}>团队会员</p><h1>一起创作，共享成果</h1><p className={styles.storeIntro}>独立账号、共享积分与资产，为每位成员安排清晰的权限和预算。</p></div>
      <div className={styles.browseBar}><div className={styles.browseGroup} aria-label="团队套餐周期"><button type="button" aria-pressed>30 天</button></div></div>
      <p className={styles.teamPlanNotice}>团队套餐由管理员人工开通。按创作席位计算价格，容量由团队共享；个人会员与团队会员分别管理。</p>
      {query.isLoading ? <div role="status" className={styles.catalogState}>正在读取团队套餐…</div> : query.error ? <div className={styles.catalogState}><p role="alert">团队套餐暂时不可用：{query.error instanceof Error ? query.error.message : '读取失败'}</p><button type="button" className={styles.moreBenefitsButton} onClick={() => void query.mutate()}>重新加载</button></div> : query.data?.plans.length ? <div className={styles.planGrid}>{query.data.plans.map((plan, index) => <TeamPlanCard key={plan.id} plan={plan} tone={tones[index % tones.length]} />)}</div> : <div className={styles.catalogState}>暂无已配置的团队套餐。</div>}
      <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-6 text-zinc-400">团队订阅到期不自动扣款，已有内容仍按权限查看；个人作品不会随加入团队而迁移。</p>
    </div></div></main>
  </div>
}
