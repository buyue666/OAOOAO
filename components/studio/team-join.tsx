'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { Users } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { request } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { useTeamAction } from '@/lib/studio/team-api'
import { teamRoleLabels, type TeamRole } from '@/lib/studio/team-types'
import { TeamError, TeamLoading } from './team-feedback'

type InvitePreview = { teamName: string; role: TeamRole; expiresAt: string; emailRequired: boolean; identityMatches: boolean }

export function TeamJoin() {
  const { state } = useStudio()
  const token = useSearchParams().get('token') || ''
  const router = useRouter()
  const action = useTeamAction()
  const connected = state.backendStatus === 'connected'
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token)
  const preview = useSWR<InvitePreview>(connected && validToken ? ['team-invitation', state.user.id, token] : null, ([, , value]: [string, string, string]) => request('/api/team-invitations/inspect', { method: 'POST', body: JSON.stringify({ token: value }) }), { shouldRetryOnError: false, keepPreviousData: false, revalidateOnFocus: false })
  const invite = connected && !preview.error ? preview.data : undefined
  return <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-12"><Link href="/teams" className="text-sm text-muted-foreground hover:text-foreground">返回团队空间</Link>{preview.isLoading ? <TeamLoading /> : <Card><CardHeader><Users className="mb-3 size-7 text-muted-foreground" /><CardTitle>{invite ? `加入 ${invite.teamName}` : '团队邀请'}</CardTitle><CardDescription>{invite ? `邀请你以${teamRoleLabels[invite.role]}身份加入团队。` : '登录并确认邀请信息后才会加入，不会自动扣款。'}</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><TeamError error={!validToken ? '邀请链接无效，请向团队管理员索取新链接。' : preview.error || action.error} />{invite && <><p className="text-sm text-muted-foreground">邀请有效期至 {new Date(invite.expiresAt).toLocaleString('zh-CN')}。你的个人作品与余额不会被迁移到团队。</p>{!invite.identityMatches && <TeamError error={invite.emailRequired ? '请使用受邀邮箱登录并完成邮箱验证，再接受邀请。' : '此邀请属于另一位用户，请切换到受邀请账号。'} />}</>}</CardContent><CardFooter>{!connected ? <Link className={buttonVariants()} href={`/login?next=${encodeURIComponent(`/teams/join?token=${token}`)}`}>登录后查看邀请</Link> : <Button disabled={!invite?.identityMatches || action.pending} onClick={async () => { const result = await action.run<{ teamId: string }>('/api/team-invitations/accept', { token }); if (result) router.replace(`/teams/${result.teamId}`) }}>{action.pending ? '正在加入…' : '确认加入团队'}</Button>}</CardFooter></Card>}</div>
}
