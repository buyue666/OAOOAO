'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, FolderOpen, History, Settings2, Users, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTeamQuery } from '@/lib/studio/team-api'
import { useStudio } from '@/lib/studio/store'
import { isTeamManager, teamRoleLabels, type TeamSummary } from '@/lib/studio/team-types'
import { TeamLoading, TeamUnavailable } from './team-feedback'
import { TeamProjects } from './team-projects'
import { TeamMembers } from './team-members'
import { TeamSettings } from './team-settings'
import { TeamUsagePanel } from './team-usage'
import { TeamEvents } from './team-events'

export function TeamWorkspace({ teamId }: { teamId: string }) {
  const { state } = useStudio()
  return <TeamWorkspaceContent key={`${state.user.id}:${teamId}`} teamId={teamId} />
}

function TeamWorkspaceContent({ teamId }: { teamId: string }) {
  const search = useSearchParams()
  const router = useRouter()
  const query = useTeamQuery<{ team: TeamSummary }>(`/api/teams/${encodeURIComponent(teamId)}`)
  const team = query.data?.team
  const requestedTab = search.get('tab') || 'projects'
  const tab = ['projects', 'usage', 'settings', ...(isTeamManager(team?.role) ? ['members', 'events'] : [])].includes(requestedTab) ? requestedTab : 'projects'
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
    <Link href="/teams" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />所有团队</Link>
    {query.isLoading ? <TeamLoading /> : !team ? <TeamUnavailable connected={query.connected} error={query.error} retry={() => void query.mutate()} /> : <>
      <header className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><p className="mb-2 text-xs text-muted-foreground">团队工作空间</p><h1 className="break-words text-3xl font-semibold tracking-tight">{team.name}</h1><p className="mt-3 text-sm text-muted-foreground">{team.planName || '尚未开通套餐'} · {team.occupiedSeats} / {team.seatLimit} 个创作席位</p></div><Badge variant="secondary">{teamRoleLabels[team.role]}</Badge></header>
      <Tabs value={tab} onValueChange={value => router.replace(`/teams/${team.id}?tab=${encodeURIComponent(String(value))}`, { scroll: false })} className="gap-6">
        <div className="overflow-x-auto overflow-y-hidden border-b border-border pb-3"><TabsList variant="line" aria-label="团队功能" className="h-auto min-h-11 gap-2">
          <TabsTrigger value="projects" className="min-h-11 px-3"><FolderOpen />项目</TabsTrigger>
          {isTeamManager(team.role) && <TabsTrigger value="members" className="min-h-11 px-3"><Users />成员</TabsTrigger>}
          <TabsTrigger value="usage" className="min-h-11 px-3"><Wallet />积分与容量</TabsTrigger>
          {isTeamManager(team.role) && <TabsTrigger value="events" className="min-h-11 px-3"><History />操作记录</TabsTrigger>}
          <TabsTrigger value="settings" className="min-h-11 px-3"><Settings2 />团队设置</TabsTrigger>
        </TabsList></div>
        <TabsContent value="projects"><TeamProjects team={team} intent={search.get('intent') || undefined} /></TabsContent>
        {isTeamManager(team.role) && <TabsContent value="members"><TeamMembers team={team} /></TabsContent>}
        <TabsContent value="usage"><TeamUsagePanel team={team} /></TabsContent>
        {isTeamManager(team.role) && <TabsContent value="events"><TeamEvents teamId={team.id} /></TabsContent>}
        <TabsContent value="settings"><TeamSettings key={`${team.id}:${team.name}`} team={team} /></TabsContent>
      </Tabs>
    </>}
  </div>
}
