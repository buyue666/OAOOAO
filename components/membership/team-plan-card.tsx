'use client'

import Link from 'next/link'
import { useState } from 'react'
import { formatTeamBytes, teamNumber, type TeamPlan } from '@/lib/studio/team-types'
import type { PlanTone } from './types'
import styles from './membership.module.css'

export function TeamPlanCard({ plan, tone = 'standard', preview = false }: { plan: TeamPlan; tone?: PlanTone; preview?: boolean }) {
  const [seats, setSeats] = useState(plan.minSeats)
  const valid = Number.isSafeInteger(seats) && seats >= plan.minSeats && seats <= plan.maxSeats
  const priced = plan.enabled && plan.priceCents !== null
  const money = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
  const benefits = [
    `${formatTeamBytes(plan.storageBytes)} 团队共享容量`, `${plan.reviewerLimit} 个审阅名额`,
    `团队并发 ${plan.teamConcurrency} · 每人并发 ${plan.memberConcurrency}`,
    `单次任务上限 ${teamNumber(plan.taskLimit)} 积分`,
    plan.modelIds.length ? `可使用 ${plan.modelIds.length} 个指定模型` : '全部可用模型',
    ...(plan.display?.benefits || []),
  ]
  return <article className={`${styles.offerCard} ${styles.teamOfferCard}`} data-tone={plan.display?.tone || tone} data-plan-id={plan.id} aria-label={plan.name}>
    <div className={styles.offerHeader}><div className={styles.offerHeading}><h2>{plan.name}</h2><span className={styles.offerBadge}>{plan.display?.badge || (plan.enabled ? '团队版' : '尚未发布')}</span></div><p className={styles.paymentNote}>{plan.description}</p></div>
    <div className={styles.offerBody}>
      <div className={styles.costLine}>{priced || preview && plan.priceCents !== null ? <><strong>{money(plan.priceCents!)}</strong><span>/ 席 / 30 天</span></> : <strong className={styles.teamUnpriced}>价格待配置</strong>}</div>
      <p className={styles.paymentNote}>创作席位包含所有者，审阅名额另计。</p>
      <label className={styles.teamSeatField} htmlFor={`team-seats-${plan.id}`}>创作席位数量 <span>{plan.minSeats}–{plan.maxSeats} 席</span><input id={`team-seats-${plan.id}`} type="number" inputMode="numeric" min={plan.minSeats} max={plan.maxSeats} step={1} value={Number.isFinite(seats) ? seats : ''} aria-invalid={!valid} onChange={event => setSeats(event.target.value === '' ? Number.NaN : Number(event.target.value))} /></label>
      <div className={styles.creditMetric}><strong>{valid ? teamNumber(plan.pointsPerSeat * seats) : '—'}</strong><span>团队积分 / 次发放</span></div>
      <p className={styles.paymentNote}>积分有效 {plan.creditValidityDays} 天 · 每席 {teamNumber(plan.pointsPerSeat)} 积分</p>
      <div className={styles.teamPriceTotal}><span>30 天参考总价</span><strong>{(priced || preview) && plan.priceCents !== null && valid ? money(plan.priceCents * seats) : '待确认'}</strong></div>
      {!valid && <p role="alert" className={styles.reviewError}>请输入 {plan.minSeats}–{plan.maxSeats} 之间的整数席位。</p>}
      {preview ? <button type="button" disabled className={styles.offerAction}>仅供预览</button> : priced && valid ? <Link href="/teams" className={`${styles.offerAction} ${styles.teamOfferLink}`}>联系管理员开通</Link> : <button type="button" disabled className={styles.offerAction}>{!valid ? '请检查席位数量' : '套餐尚未开放'}</button>}
      <p className={styles.paymentNote}>人工开通，本页不会创建订单或扣款。</p>
    </div>
    <div className={styles.entitlementBlock}><p className={styles.entitlementCaption}>团队套餐权益</p><ul>{benefits.map((benefit, index) => <li key={`${index}:${benefit}`}><span className={styles.entitlementDot} aria-hidden /><span>{benefit}</span></li>)}</ul></div>
  </article>
}
