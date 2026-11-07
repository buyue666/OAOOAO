'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useTeamAction, useTeamQuery } from '@/lib/studio/team-api'
import { useStudio } from '@/lib/studio/store'
import type { TeamMember, TeamSummary } from '@/lib/studio/team-types'
import { TeamError } from './team-feedback'

export function TeamSettings({ team }: { team: TeamSummary }) {
  const { state } = useStudio()
  const router = useRouter()
  const action = useTeamAction()
  const members = useTeamQuery<{ members: TeamMember[] }>(team.role === 'owner' ? `/api/teams/${team.id}/members` : null)
  const [name, setName] = useState(team.name)
  const [target, setTarget] = useState('')
  const [confirm, setConfirm] = useState<'transfer' | 'accept' | 'leave' | null>(null)
  const [notice, setNotice] = useState('')
  const transferPending = team.transferExpiresAt && Date.parse(team.transferExpiresAt) > Date.now()
  async function proceed() {
    const path = confirm === 'leave' ? `/api/teams/${team.id}/members/${state.user.id}` : confirm === 'accept' ? `/api/teams/${team.id}/ownership/accept` : `/api/teams/${team.id}/ownership`
    const result = await action.run(path, confirm === 'transfer' ? { userId: target } : undefined, confirm === 'leave' ? 'DELETE' : 'POST')
    if (result) { if (confirm === 'leave') router.push('/teams'); else setNotice(confirm === 'accept' ? '所有权交接已完成。' : '交接申请已发送，等待对方在 24 小时内确认。'); setConfirm(null) }
  }
  return <div className="flex max-w-3xl flex-col gap-5"><TeamError error={!confirm ? action.error : ''} />{notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>团队基本信息</CardTitle><CardDescription>修改名称不改变团队归属、成员权限或资产。</CardDescription></CardHeader><CardContent><form className="flex flex-col gap-4" onSubmit={async event => { event.preventDefault(); if (await action.run(`/api/teams/${team.id}`, { name }, 'PATCH')) setNotice('团队名称已保存。') }}><FieldGroup><Field><FieldLabel htmlFor="settings-team-name">团队名称</FieldLabel><Input id="settings-team-name" value={name} disabled={team.role !== 'owner'} onChange={event => setName(event.target.value)} maxLength={80} required /></Field></FieldGroup>{team.role === 'owner' && <Button type="submit" disabled={action.pending || name.trim() === team.name}>保存名称</Button>}</form></CardContent></Card>
    {team.role === 'owner' && <Card><CardHeader><CardTitle>转让团队所有权</CardTitle><CardDescription>选择现有管理员或创作成员。对方确认后接管团队，你将成为管理员；资产与账本不发生迁移。</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><FieldGroup><Field><FieldLabel htmlFor="transfer-member">新所有者</FieldLabel><NativeSelect id="transfer-member" value={target} onChange={event => setTarget(event.target.value)}><NativeSelectOption value="">选择成员</NativeSelectOption>{members.data?.members.filter(member => member.userId !== state.user.id && member.role !== 'reviewer').map(member => <NativeSelectOption key={member.userId} value={member.userId}>{member.name}</NativeSelectOption>)}</NativeSelect></Field></FieldGroup>{transferPending && <p className="text-sm text-muted-foreground">已有交接申请，等待对方确认；再次申请将替换原申请。</p>}<Button variant="outline" disabled={!target || action.pending} onClick={() => { action.clearError(); setConfirm('transfer') }}>申请交接</Button></CardContent></Card>}
    {transferPending && team.transferTo === state.user.id && <Alert><AlertTitle>有一份团队所有权交接等待你确认</AlertTitle><AlertDescription>接受后，你将负责团队成员、套餐和账务管理。<Button className="mt-3" onClick={() => { action.clearError(); setConfirm('accept') }}>确认接受所有权</Button></AlertDescription></Alert>}
    {team.role !== 'owner' && <Card><CardHeader><CardTitle>退出团队</CardTitle><CardDescription>立即失去团队和指定项目的访问权限。已经提交的任务继续按原团队结算，所有团队作品保留。</CardDescription></CardHeader><CardContent><Button variant="destructive" onClick={() => { action.clearError(); setConfirm('leave') }}>退出此团队</Button></CardContent></Card>}
    <Dialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null) }}><DialogContent><DialogHeader><DialogTitle>{confirm === 'leave' ? '确认退出团队？' : confirm === 'accept' ? '确认接管团队？' : '确认发起所有权交接？'}</DialogTitle><DialogDescription>{confirm === 'leave' ? '你的个人账号和个人资产不会受影响。如需重新加入，必须由管理员重新邀请。' : confirm === 'accept' ? '确认后你将成为团队所有者，原所有者变为管理员。' : '只有受邀成员明确接受后才会完成交接，申请 24 小时内有效。'}</DialogDescription></DialogHeader><TeamError error={action.error} /><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button variant={confirm === 'leave' ? 'destructive' : 'default'} disabled={action.pending} onClick={() => void proceed()}>{action.pending ? '正在提交…' : '确认'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
