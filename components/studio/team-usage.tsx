'use client'

import Link from 'next/link'
import { CreditCard, Database, Info, Wallet } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buttonVariants } from '@/components/ui/button'
import { useTeamQuery } from '@/lib/studio/team-api'
import { formatTeamBytes, isTeamManager, teamNumber, type TeamSummary, type TeamUsage } from '@/lib/studio/team-types'
import { TeamError, TeamLoading } from './team-feedback'

export function TeamUsagePanel({ team }: { team: TeamSummary }) {
  const query = useTeamQuery<TeamUsage>(`/api/teams/${team.id}/usage`, 15000)
  const data = query.data
  if (query.isLoading) return <TeamLoading />
  if (!data) return <TeamError error={query.error || '用量暂时不可用，请刷新后重试。'} />
  return <div className="flex flex-col gap-6">
    <div className="grid gap-4 md:grid-cols-3">
      <Card><CardHeader><Wallet className="mb-2 size-5 text-muted-foreground" /><CardDescription>团队可用积分</CardDescription><CardTitle><span className="text-3xl tabular-nums">{teamNumber(data.balance)}</span></CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">独立于你的个人钱包</p></CardContent></Card>
      <Card><CardHeader><CreditCard className="mb-2 size-5 text-muted-foreground" /><CardDescription>{isTeamManager(team.role) ? '团队本月已用' : '我本月已用'}</CardDescription><CardTitle><span className="text-3xl tabular-nums">{teamNumber(data.monthlySpent)}</span></CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{data.month} · UTC 自然月</p></CardContent></Card>
      <Card><CardHeader><Database className="mb-2 size-5 text-muted-foreground" /><CardDescription>团队总存储</CardDescription><CardTitle>{formatTeamBytes(data.storage.usedBytes)} / {formatTeamBytes(data.storage.quotaBytes)}</CardTitle></CardHeader><CardContent className="flex flex-col gap-2"><progress aria-label="团队存储使用量" value={data.storage.usedBytes} max={data.storage.quotaBytes} className="h-2 w-full accent-primary" /><p className="text-xs text-muted-foreground">{data.storage.assets} 份素材 · 待清理文件也占用容量</p></CardContent></Card>
    </div>
    <Alert><Info /><AlertTitle>我的本月预算</AlertTitle><AlertDescription>已使用 {teamNumber(data.mySpent)} 积分，{data.myLimit === null ? '未设置单独的成员上限' : `上限 ${teamNumber(data.myLimit)} 积分，剩余 ${teamNumber(Math.max(0, data.myLimit - data.mySpent))} 积分`}。任务失败或确认取消后，预算退回原消费月份；过期积分不延长有效期。</AlertDescription></Alert>
    <section className="flex flex-col gap-3"><h2 className="text-base font-semibold">可用积分批次</h2><Table><TableHeader><TableRow><TableHead>来源</TableHead><TableHead>剩余积分</TableHead><TableHead>有效期</TableHead></TableRow></TableHeader><TableBody>{data.batches.length ? data.batches.map(batch => <TableRow key={batch.id}><TableCell>{{ subscription: '套餐积分', topup: '额外充值', adjustment: '管理员发放' }[batch.source] || batch.source}</TableCell><TableCell>{teamNumber(batch.remaining)}</TableCell><TableCell>{batch.expiresAt ? new Date(batch.expiresAt).toLocaleString('zh-CN') : '永久有效'}</TableCell></TableRow>) : <TableRow><TableCell colSpan={3}>暂无可用积分，请联系站点管理员开通团队权益。</TableCell></TableRow>}</TableBody></Table></section>
    <section className="flex flex-col gap-3"><h2 className="text-base font-semibold">{isTeamManager(team.role) ? '团队' : '我的'}最近积分流水</h2><Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>操作者</TableHead><TableHead>说明</TableHead><TableHead className="text-right">积分变化</TableHead></TableRow></TableHeader><TableBody>{data.operations.length ? data.operations.map(operation => <TableRow key={operation.id}><TableCell>{new Date(operation.createdAt).toLocaleString('zh-CN')}</TableCell><TableCell>{operation.actorName}</TableCell><TableCell>{operation.reason}</TableCell><TableCell className="text-right tabular-nums">{operation.amount > 0 ? '+' : ''}{teamNumber(operation.amount)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4}>暂无积分记录</TableCell></TableRow>}</TableBody></Table></section>
    <Card><CardHeader><CardTitle>{team.planName || '尚未开通团队套餐'}</CardTitle><CardDescription>{team.subscriptionExpiresAt ? `团队权益有效期至 ${new Date(team.subscriptionExpiresAt).toLocaleString('zh-CN')}` : '创建团队不会自动购买套餐，个人会员不会转换成团队会员。'}</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{team.seatLimit} 个创作席位 · {team.reviewerLimit} 个审阅名额 · {formatTeamBytes(data.storage.quotaBytes)} 团队总容量</p></CardContent><CardFooter><Link href="/plans?edition=team" className={buttonVariants({ variant: 'outline' })}>查看团队套餐</Link></CardFooter></Card>
  </div>
}
