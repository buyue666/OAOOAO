'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { ArrowRight, FolderLock, Link2, Plus, Users, Wallet } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useTeamAction, useTeamQuery } from '@/lib/studio/team-api'
import { teamRoleLabels, type TeamSummary } from '@/lib/studio/team-types'
import { useStudio } from '@/lib/studio/store'
import { TeamError, TeamLoading, TeamUnavailable } from './team-feedback'

export function TeamList() {
  const { state } = useStudio()
  return <TeamListContent key={state.user.id || 'signed-out'} />
}

function TeamListContent() {
  const search = useSearchParams()
  const router = useRouter()
  const query = useTeamQuery<{ teams: TeamSummary[] }>('/api/teams')
  const action = useTeamAction()
  const createOpen = search.get('create') === '1'
  const [joinOpen, setJoinOpen] = useState(false)
  const [name, setName] = useState('')
  const [invitation, setInvitation] = useState('')
  const [joinError, setJoinError] = useState('')
  function openCreate() {
    action.clearError()
    router.replace('/teams?create=1', { scroll: false })
  }
  function cancelCreate() {
    if (action.pending) return
    action.clearError()
    setName('')
    router.replace('/teams', { scroll: false })
  }
  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!query.connected || !name.trim() || action.pending) return
    const result = await action.run<{ team: TeamSummary }>('/api/teams', { name: name.trim() })
    if (result) router.push(`/teams/${result.team.id}`)
  }
  function join(event: React.FormEvent) {
    event.preventDefault()
    let token = invitation.trim()
    try { if (token.includes('/')) token = new URL(token, window.location.origin).searchParams.get('token') || '' } catch { token = '' }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setJoinError('请粘贴完整的团队邀请链接或有效邀请码。'); return }
    router.push(`/teams/join?token=${encodeURIComponent(token)}`)
  }
  return <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div className="flex max-w-2xl flex-col gap-3"><p className="text-xs font-medium tracking-widest text-muted-foreground">OAO / 团队空间</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">好作品，由我们一起完成。</h1><p className="text-sm leading-7 text-muted-foreground">给团队一个共同的创作空间。项目、素材与积分统一管理，个人作品依然只属于你。</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => setJoinOpen(true)}><Link2 data-icon="inline-start" />加入团队</Button>{!createOpen && <Button onClick={openCreate}><Plus data-icon="inline-start" />创建团队</Button>}</div>
    </header>
    {createOpen && <section aria-labelledby="create-team-heading">
      <Card className="grid gap-6 p-6 sm:p-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-10">
        <div className="flex min-w-0 flex-col items-start gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-muted"><Users className="size-5" aria-hidden /></div><h2 id="create-team-heading" className="text-xl font-semibold tracking-tight">创建团队空间</h2><p className="text-sm leading-7 text-muted-foreground">为团队起个名字，和同事一起管理项目与创作素材。</p><p className="text-xs leading-6 text-muted-foreground">使用你的现有账号。创建团队不会扣款，个人作品也不会自动共享。</p></div>
        <form aria-label="创建团队" onSubmit={create} className="flex min-w-0 flex-col gap-5">
          <FieldGroup><Field><FieldLabel htmlFor="team-name">团队名称</FieldLabel><Input id="team-name" autoFocus required maxLength={80} disabled={action.pending} aria-describedby="team-name-description" className="min-h-11" placeholder="例如：映像创意工作室" value={name} onChange={event => setName(event.target.value)} /><FieldDescription id="team-name-description">所有者占用一个创作席位。套餐与积分由管理员开通后生效。</FieldDescription></Field></FieldGroup>
          <TeamError error={action.error} />
          {!query.connected && <p className="text-sm text-muted-foreground">请先<Link href="/login?next=%2Fteams%3Fcreate%3D1" className="underline underline-offset-4">登录后创建团队</Link>。</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="min-h-11" disabled={action.pending} onClick={cancelCreate}>取消</Button><Button type="submit" className="min-h-11" disabled={!query.connected || !name.trim() || action.pending}>{action.pending ? '正在创建…' : '创建团队'}</Button></div>
        </form>
      </Card>
    </section>}
    {(!createOpen || !query.connected || query.isLoading || query.error || !!query.data?.teams.length) && <section aria-labelledby="my-teams" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3"><h2 id="my-teams" className="text-base font-semibold">我的团队{query.data && <span className="ml-2 text-sm font-normal text-muted-foreground">{query.data.teams.length}</span>}</h2><Link href="/plans?edition=team" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">了解团队版<ArrowRight className="size-4" /></Link></div>
      {query.isLoading ? <TeamLoading /> : !query.connected || query.error ? <TeamUnavailable connected={query.connected} error={query.error} retry={() => void query.mutate()} /> : !query.data?.teams.length ? <Empty className="min-h-64 border"><EmptyHeader><EmptyMedia variant="icon"><Users /></EmptyMedia><EmptyTitle>你的下一份作品，可以一起创作</EmptyTitle><EmptyDescription>创建一个团队，或通过同事分享的邀请链接加入。个人资产不会自动共享。</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={openCreate}>创建第一个团队</Button></EmptyContent></Empty> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{query.data.teams.map(team => <Card key={team.id}><CardHeader><div className="mb-2 flex items-center justify-between"><Users className="size-5 text-muted-foreground" /><Badge variant="secondary">{teamRoleLabels[team.role]}</Badge></div><CardTitle>{team.name}</CardTitle><CardDescription>{team.planName || '尚未开通团队套餐'}</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{team.occupiedSeats} / {team.seatLimit} 个创作席位 · {team.reservedSeats} 个待加入</p></CardContent><CardFooter><Link href={`/teams/${team.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>进入团队<ArrowRight data-icon="inline-end" /></Link></CardFooter></Card>)}</div>}
    </section>}
    <section aria-label="团队空间规则" className="grid gap-4 md:grid-cols-3">
      {[{ icon: FolderLock, title: '资产有归属', copy: '团队项目与个人资产独立，成员离开后作品继续保留。' }, { icon: Wallet, title: '预算有边界', copy: '共享团队积分池，成员额度是消费上限，不挪用个人余额。' }, { icon: Users, title: '每个人，各司其职', copy: '所有者、管理员、创作与审阅成员，按项目授予访问权限。' }].map(item => <Card key={item.title}><CardHeader><item.icon className="mb-2 size-5 text-muted-foreground" /><CardTitle>{item.title}</CardTitle><CardDescription>{item.copy}</CardDescription></CardHeader></Card>)}
    </section>
    <Dialog open={joinOpen} onOpenChange={setJoinOpen}><DialogContent><DialogHeader><DialogTitle>加入已有团队</DialogTitle><DialogDescription>粘贴团队管理员分享的链接。确认身份和团队信息后，才会接受邀请。</DialogDescription></DialogHeader><form onSubmit={join} className="flex flex-col gap-5"><FieldGroup><Field data-invalid={!!joinError}><FieldLabel htmlFor="team-invitation">邀请链接或邀请码</FieldLabel><Input id="team-invitation" required value={invitation} aria-invalid={!!joinError} onChange={event => { setInvitation(event.target.value); setJoinError('') }} placeholder="粘贴邀请链接" /></Field></FieldGroup><TeamError error={joinError} /><DialogFooter><Button type="submit">查看邀请</Button></DialogFooter></form></DialogContent></Dialog>
  </div>
}
