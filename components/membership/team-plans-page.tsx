'use client'

import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { ArrowLeft, Check, Users } from 'lucide-react'
import { SiteBrand } from '@/components/site-brand'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { request } from '@/lib/studio/api'
import { formatTeamBytes, teamNumber, type TeamPlan } from '@/lib/studio/team-types'
import { useStudio } from '@/lib/studio/store'
import { TeamLoading } from '@/components/studio/team-feedback'

function PlanCard({ plan }: { plan: TeamPlan }) {
  const [seats, setSeats] = useState(plan.minSeats)
  const priced = plan.enabled && plan.priceCents !== null
  const validSeats = Number.isInteger(seats) && seats >= plan.minSeats && seats <= plan.maxSeats
  const money = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return <Card className="flex-1 [--card-spacing:--spacing(6)]"><CardHeader><div className="mb-2 flex items-center justify-between"><Users className="size-6 text-muted-foreground" /><Badge variant="secondary">{plan.enabled ? '人工开通' : '尚未发布'}</Badge></div><CardTitle>{plan.name}</CardTitle><CardDescription>{plan.description}</CardDescription></CardHeader><CardContent className="flex flex-col gap-6"><div><p className="text-3xl font-semibold tracking-tight">{priced ? `¥${money(plan.priceCents!)}` : '价格待配置'}</p><p className="mt-2 text-sm text-muted-foreground">每个创作席位 / 30 天 · 包含所有者</p></div><Field><FieldLabel htmlFor={`seats-${plan.id}`}>创作席位数量</FieldLabel><Input id={`seats-${plan.id}`} type="number" min={plan.minSeats} max={plan.maxSeats} step="1" value={Number.isFinite(seats) ? seats : ''} aria-invalid={!validSeats} onChange={event => setSeats(event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field><div className="flex flex-col gap-3 border-y border-border py-4"><div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">本周期参考总价</span><strong>{priced && validSeats ? `¥${money(plan.priceCents! * seats)}` : '待确认'}</strong></div><div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">团队共享积分</span><strong>{validSeats ? teamNumber(plan.pointsPerSeat * seats) : '—'}</strong></div><p className="text-xs leading-5 text-muted-foreground">积分由管理员核实后发放，有效期 {plan.creditValidityDays} 天。此处计算不会创建订单或扣款。</p></div><ul className="flex flex-col gap-3 text-sm">{[`${formatTeamBytes(plan.storageBytes)} 团队总容量，不是每席容量`, `${plan.reviewerLimit} 个审阅名额，下载单独授权`, `团队并发 ${plan.teamConcurrency} / 单成员并发 ${plan.memberConcurrency}`, `单次任务上限 ${teamNumber(plan.taskLimit)} 积分`, '成员月预算、项目授权与操作记录'].map(feature => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{feature}</span></li>)}</ul></CardContent><CardFooter>{plan.enabled ? <Link href="/teams" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>前往团队，联系管理员开通</Link> : <Button className="w-full" disabled>套餐尚未开放</Button>}</CardFooter></Card>
}

export function TeamPlansPage() {
  const { state } = useStudio()
  const query = useSWR<{ plans: TeamPlan[]; purchaseEnabled: false }>('/api/team-plans', path => request(path), { shouldRetryOnError: false })
  return <div className="dark min-h-dvh bg-background text-foreground"><header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6"><Link href="/studio" aria-label="返回创作工作台"><SiteBrand tone="dark" imageClassName="h-7" /></Link><Link href="/teams" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />团队空间</Link></header><main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pb-16 pt-6"><nav aria-label="会员版本" className="mx-auto flex gap-1 rounded-full border border-border p-1"><Link href="/plans" className="rounded-full px-6 py-2 text-sm text-muted-foreground hover:text-foreground">个人版</Link><Link href="/plans?edition=team" aria-current="page" className="rounded-full bg-foreground px-6 py-2 text-sm font-medium text-background">团队版</Link></nav><div className="mx-auto max-w-xl text-center"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">让团队，专注于好作品。</h1><p className="mt-4 text-sm leading-7 text-muted-foreground">一人一个账号，一个共同的团队空间。共享积分与资产，保留每个人清晰的权限和预算。</p></div><Alert><AlertTitle>团队版暂不开放在线收费</AlertTitle><AlertDescription>价格由站点管理员核算成本后配置。目前使用人工权益开通；自动续费、周期内加席补差价和下周期减席尚未开放，不会沿用个人订单或扣个人积分。</AlertDescription></Alert>{query.isLoading ? <TeamLoading /> : query.error ? <div className="flex flex-col items-start gap-3"><Alert variant="destructive"><AlertTitle>团队套餐暂时不可用</AlertTitle><AlertDescription>{query.error instanceof Error ? query.error.message : '请连接后端并完成团队模块部署。'}</AlertDescription></Alert><Button variant="outline" onClick={() => void query.mutate()}>重新加载</Button></div> : <div className="grid gap-5 md:grid-cols-2">{query.data?.plans.map(plan => <PlanCard key={plan.id} plan={plan} />)}</div>}<p className="text-center text-sm leading-7 text-muted-foreground">团队资产不会随成员退出而删除。订阅到期不自动扣款，已有内容仍按权限查看与下载。<br />个人会员与团队会员分别管理，加入团队不迁移个人作品。</p>{state.backendStatus === 'connected' && state.user.role === 'admin' && <Link href="/admin/team-plans" className="mx-auto text-sm underline underline-offset-4">配置团队套餐与权益</Link>}</main></div>
}
