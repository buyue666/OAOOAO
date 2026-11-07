'use client'

import { useState } from 'react'
import { Copy, Plus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useTeamAction, useTeamQuery } from '@/lib/studio/team-api'
import { isTeamManager, teamNumber, teamRoleLabels, type TeamInvitation, type TeamMember, type TeamRole, type TeamSummary } from '@/lib/studio/team-types'
import { useStudio } from '@/lib/studio/store'
import { TeamError, TeamLoading } from './team-feedback'

export function TeamMembers({ team }: { team: TeamSummary }) {
  const { state } = useStudio()
  const manager = isTeamManager(team.role)
  const members = useTeamQuery<{ members: TeamMember[] }>(`/api/teams/${team.id}/members`)
  const invites = useTeamQuery<{ invitations: TeamInvitation[] }>(manager ? `/api/teams/${team.id}/invitations` : null)
  const action = useTeamAction()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [role, setRole] = useState<Exclude<TeamRole, 'owner'>>('creator')
  const [inviteLink, setInviteLink] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [limit, setLimit] = useState('')
  const [download, setDownload] = useState(false)
  const [removing, setRemoving] = useState<TeamMember | null>(null)
  function edit(member: TeamMember) { action.clearError(); setEditing(member); setRole(member.role === 'owner' ? 'admin' : member.role); setLimit(member.monthlyLimit === null ? '' : String(member.monthlyLimit)); setDownload(member.canDownload) }
  async function invite(event: React.FormEvent) {
    event.preventDefault()
    const result = await action.run<{ invitePath: string }>(`/api/teams/${team.id}/invitations`, { target, role })
    if (result) setInviteLink(new URL(result.invitePath, window.location.origin).toString())
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!editing) return
    const result = await action.run(`/api/teams/${team.id}/members/${editing.userId}`, { role, monthlyLimit: limit.trim() === '' ? null : Number(limit), canDownload: download }, 'PATCH')
    if (result) setEditing(null)
  }
  return <div className="flex flex-col gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">成员与席位</h2><p className="mt-1 text-sm text-muted-foreground">创作席位 {team.occupiedSeats} / {team.seatLimit} · 待加入 {team.reservedSeats} · 审阅成员 {team.reviewers} / {team.reviewerLimit}</p></div>{manager && <Button onClick={() => { action.clearError(); setInviteLink(''); setCopyStatus(''); setRole('creator'); setTarget(''); setInviteOpen(true) }}><Plus data-icon="inline-start" />邀请成员</Button>}</div>
    <TeamError error={members.error || invites.error || (!inviteOpen && !editing && !removing ? action.error : '')} />
    {members.isLoading ? <TeamLoading /> : <Table><TableHeader><TableRow><TableHead>成员</TableHead><TableHead>角色</TableHead>{manager && <><TableHead>本月已用 / 上限</TableHead><TableHead>下载权限</TableHead><TableHead><span className="sr-only">操作</span></TableHead></>}</TableRow></TableHeader><TableBody>{members.data?.members.map(member => <TableRow key={member.userId}><TableCell><p className="font-medium">{member.name}{member.userId === state.user.id && <span className="ml-1 text-xs text-muted-foreground">（你）</span>}</p><p className="mt-0.5 text-xs text-muted-foreground">@{member.username}</p></TableCell><TableCell><Badge variant="secondary">{teamRoleLabels[member.role]}</Badge></TableCell>{manager && <><TableCell>{teamNumber(member.spent)} / {member.monthlyLimit === null ? '不单独设限' : teamNumber(member.monthlyLimit)}</TableCell><TableCell>{member.role !== 'reviewer' || member.canDownload ? '允许' : '未授权'}</TableCell><TableCell>{member.role !== 'owner' && member.userId !== state.user.id && (team.role === 'owner' || member.role !== 'admin') && <div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => edit(member)}>设置</Button><Button variant="destructive" size="sm" onClick={() => { action.clearError(); setRemoving(member) }}>移除</Button></div>}</TableCell></>}</TableRow>)}</TableBody></Table>}
    {manager && !!invites.data?.invitations.length && <section className="flex flex-col gap-3"><h3 className="text-sm font-semibold">待接受的邀请</h3><Table><TableHeader><TableRow><TableHead>邀请对象</TableHead><TableHead>角色</TableHead><TableHead>有效期至</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{invites.data.invitations.map(invite => <TableRow key={invite.id}><TableCell>{invite.target || '一次性邀请链接'}</TableCell><TableCell>{teamRoleLabels[invite.role]}</TableCell><TableCell>{new Date(invite.expiresAt).toLocaleDateString('zh-CN')}</TableCell><TableCell><Button variant="ghost" size="sm" disabled={action.pending || team.role !== 'owner' && invite.role === 'admin'} onClick={() => void action.run(`/api/teams/${team.id}/invitations/${invite.id}`, undefined, 'DELETE')}>撤销</Button></TableCell></TableRow>)}</TableBody></Table></section>}
    <Alert><ShieldCheck /><AlertTitle>角色只在当前团队内生效</AlertTitle><AlertDescription>团队管理员没有站点后台权限。待接受邀请会预留名额，7 天后自动释放；移除成员不会删除团队作品。</AlertDescription></Alert>
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogContent><DialogHeader><DialogTitle>邀请团队成员</DialogTitle><DialogDescription>链接只能使用一次，7 天内有效。不会自动发送邮件，请将链接安全地分享给受邀请人。</DialogDescription></DialogHeader>{inviteLink ? <div className="flex flex-col gap-4"><FieldGroup><Field><FieldLabel htmlFor="created-invite">邀请链接</FieldLabel><Input id="created-invite" value={inviteLink} readOnly onFocus={event => event.target.select()} /><FieldDescription>此链接仅在本次显示。关闭后可撤销邀请再重新创建。</FieldDescription></Field></FieldGroup><Button onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setCopyStatus('已复制邀请链接') } catch { setCopyStatus('无法自动复制，请选中上方链接手动复制') } }}><Copy data-icon="inline-start" />复制链接</Button><p role="status" className="text-sm text-muted-foreground">{copyStatus}</p></div> : <form onSubmit={invite} className="flex flex-col gap-5"><FieldGroup><Field><FieldLabel htmlFor="invite-target">用户名或邮箱（可选）</FieldLabel><Input id="invite-target" value={target} onChange={event => setTarget(event.target.value)} maxLength={320} placeholder="同事的用户名或邮箱" /><FieldDescription>填写后仅对应账号可接受；邮箱邀请需要验证邮箱。留空则持有链接的人可加入。</FieldDescription></Field><Field><FieldLabel htmlFor="invite-role">团队角色</FieldLabel><NativeSelect id="invite-role" value={role} onChange={event => setRole(event.target.value as typeof role)}><NativeSelectOption value="creator">创作成员 · 占创作席位</NativeSelectOption><NativeSelectOption value="reviewer">审阅成员 · 不占创作席位</NativeSelectOption>{team.role === 'owner' && <NativeSelectOption value="admin">管理员 · 占创作席位</NativeSelectOption>}</NativeSelect></Field></FieldGroup><TeamError error={action.error} /><DialogFooter><Button type="submit" disabled={action.pending}>{action.pending ? '正在创建…' : '创建邀请链接'}</Button></DialogFooter></form>}</DialogContent></Dialog>
    <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null) }}><DialogContent><DialogHeader><DialogTitle>设置成员 · {editing?.name}</DialogTitle><DialogDescription>预算是消费上限，不会把积分从团队池划走。按 UTC 自然月统计。</DialogDescription></DialogHeader><form onSubmit={save} className="flex flex-col gap-5"><FieldGroup><Field><FieldLabel htmlFor="member-role">团队角色</FieldLabel><NativeSelect id="member-role" value={role} onChange={event => setRole(event.target.value as typeof role)}><NativeSelectOption value="creator">创作成员</NativeSelectOption><NativeSelectOption value="reviewer">审阅成员</NativeSelectOption>{team.role === 'owner' && <NativeSelectOption value="admin">管理员</NativeSelectOption>}</NativeSelect></Field><Field><FieldLabel htmlFor="member-limit">每月积分上限</FieldLabel><Input id="member-limit" type="number" min="0" step="0.0001" max="100000000" value={limit} onChange={event => setLimit(event.target.value)} placeholder="留空表示不单独设限" /><FieldDescription>设为 0 会禁止产生费用，仍受团队余额和单次消费上限限制。</FieldDescription></Field><Field><FieldLabel htmlFor="member-download">审阅成员下载权限</FieldLabel><NativeSelect id="member-download" value={download ? 'yes' : 'no'} onChange={event => setDownload(event.target.value === 'yes')}><NativeSelectOption value="no">不允许下载</NativeSelectOption><NativeSelectOption value="yes">允许下载</NativeSelectOption></NativeSelect></Field></FieldGroup><TeamError error={action.error} /><DialogFooter><Button type="submit" disabled={action.pending}>{action.pending ? '正在保存…' : '保存设置'}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!removing} onOpenChange={open => { if (!open) setRemoving(null) }}><DialogContent><DialogHeader><DialogTitle>移除 {removing?.name}？</DialogTitle><DialogDescription>立即撤销此成员对团队和项目的访问权限，释放对应名额。团队作品和已提交任务保留，不影响其个人资产。</DialogDescription></DialogHeader><TeamError error={action.error} /><DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>取消</Button><Button variant="destructive" disabled={action.pending} onClick={async () => { if (removing && await action.run(`/api/teams/${team.id}/members/${removing.userId}`, undefined, 'DELETE')) setRemoving(null) }}>确认移除</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
