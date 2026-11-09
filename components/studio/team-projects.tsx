'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowUpRight, FolderLock, FolderOpen, Plus } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useTeamAction, useTeamQuery } from '@/lib/studio/team-api'
import type { TeamMember, TeamProject, TeamSummary } from '@/lib/studio/team-types'
import { TeamError, TeamLoading } from './team-feedback'

export function ProjectAccessFields({ visibility, setVisibility, memberIds, setMemberIds, members }: { visibility: 'team' | 'restricted'; setVisibility: (value: 'team' | 'restricted') => void; memberIds: string[]; setMemberIds: (value: string[]) => void; members: TeamMember[] }) {
  return <><Field><FieldLabel htmlFor="project-visibility">项目可见范围</FieldLabel><NativeSelect id="project-visibility" value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}><NativeSelectOption value="restricted">仅指定成员</NativeSelectOption><NativeSelectOption value="team">全团队可见</NativeSelectOption></NativeSelect><FieldDescription>所有者与管理员保留治理访问权限；创作与审阅能力仍由成员角色决定。</FieldDescription></Field>{visibility === 'restricted' && <FieldSet><FieldLegend variant="label">授权成员</FieldLegend><div className="flex max-h-40 flex-col gap-2 overflow-y-auto">{members.filter(member => member.role !== 'owner' && member.role !== 'admin').map(member => <Field key={member.userId} orientation="horizontal"><input id={`project-member-${member.userId}`} type="checkbox" className="size-4 shrink-0 accent-primary" checked={memberIds.includes(member.userId)} onChange={event => setMemberIds(event.target.checked ? [...memberIds, member.userId] : memberIds.filter(id => id !== member.userId))} /><FieldLabel htmlFor={`project-member-${member.userId}`}>{member.name}</FieldLabel></Field>)}{!members.some(member => !['owner','admin'].includes(member.role)) && <p className="text-sm text-muted-foreground">还没有需要单独授权的成员，可以先创建项目。</p>}</div></FieldSet>}</>
}

export function TeamProjects({ team, intent }: { team: TeamSummary; intent?: string }) {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const query = useTeamQuery<{ projects: TeamProject[]; total: number }>(`/api/teams/${team.id}/projects?page=${page}&pageSize=12`)
  const members = useTeamQuery<{ members: TeamMember[] }>(team.role !== 'reviewer' ? `/api/teams/${team.id}/members` : null)
  const action = useTeamAction()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'team' | 'restricted'>('restricted')
  const [memberIds, setMemberIds] = useState<string[]>([])
  async function create(event: React.FormEvent) {
    event.preventDefault()
    const result = await action.run<{ project: TeamProject }>(`/api/teams/${team.id}/projects`, { title, description, visibility, memberIds })
    if (result) router.push(`/teams/${team.id}/projects/${result.project.id}`)
  }
  return <div className="flex flex-col gap-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{intent === 'create' ? '选择项目，开始团队创作' : '团队项目'}</h2><p className="mt-1 text-sm text-muted-foreground">{intent === 'create' ? '选择下方项目进入团队画布，或新建团队项目。创作使用当前团队的积分与素材。' : '只显示当前账号获授权的项目，个人项目不会出现在这里。'}</p></div>{team.role !== 'reviewer' && <Button onClick={() => { action.clearError(); setOpen(true) }}><Plus data-icon="inline-start" />新建项目</Button>}</div><TeamError error={query.error} />
    {query.isLoading ? <TeamLoading /> : query.data?.projects.length ? <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{query.data.projects.map(project => <Card key={project.id}><CardHeader><div className="mb-3 flex items-center justify-between"><FolderOpen className="size-6 text-muted-foreground" /><Badge variant="outline">{project.visibility === 'team' ? '全团队' : '指定成员'}</Badge></div><CardTitle>{project.title}</CardTitle><CardDescription>{project.description || '从一份素材、一段描述开始共同创作。'}</CardDescription></CardHeader><CardContent><p className="text-xs text-muted-foreground">{project.assetCount} 份素材 · 更新于 {new Date(project.updatedAt).toLocaleDateString('zh-CN')}</p></CardContent><CardFooter><Link href={`/teams/${team.id}/projects/${project.id}${intent === 'create' ? '/canvas' : intent === 'history' ? '?tab=generation' : ''}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{intent === 'create' ? '开始创作' : '打开项目'}<ArrowUpRight data-icon="inline-end" /></Link></CardFooter></Card>)}</div><div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button><Button variant="outline" size="sm" disabled={page * 12 >= query.data.total} onClick={() => setPage(value => value + 1)}>下一页</Button></div></> : !query.error && <Empty className="min-h-60 border"><EmptyHeader><EmptyMedia variant="icon"><FolderLock /></EmptyMedia><EmptyTitle>还没有可访问的团队项目</EmptyTitle><EmptyDescription>{team.role === 'reviewer' ? '请等待管理员将你加入项目，或开放全团队查看。' : '建立第一个项目，选择参与成员，再上传素材或发起团队创作。'}</EmptyDescription></EmptyHeader></Empty>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>新建团队项目</DialogTitle><DialogDescription>项目和生成结果归团队所有。默认仅指定成员可见。</DialogDescription></DialogHeader><form onSubmit={create} className="flex flex-col gap-5"><FieldGroup><Field><FieldLabel htmlFor="project-title">项目名称</FieldLabel><Input id="project-title" required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：秋季品牌短片" /></Field><Field><FieldLabel htmlFor="project-description">项目说明</FieldLabel><Input id="project-description" maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} placeholder="目标、交付要求或创作方向" /></Field><ProjectAccessFields visibility={visibility} setVisibility={setVisibility} memberIds={memberIds} setMemberIds={setMemberIds} members={members.data?.members ?? []} /></FieldGroup><TeamError error={action.error} /><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={action.pending || !title.trim()}>{action.pending ? '正在创建…' : '创建项目'}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>
}
