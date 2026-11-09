'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, FolderLock, Images, Settings2, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStudio } from '@/lib/studio/store'
import { useTeamQuery } from '@/lib/studio/team-api'
import type { TeamAsset, TeamProject, TeamSummary } from '@/lib/studio/team-types'
import { TeamLoading, TeamUnavailable } from './team-feedback'
import { TeamProjectAssets } from './team-project-assets'
import { TeamProjectGeneration } from './team-project-generation'
import { TeamProjectSettings } from './team-project-settings'

export function TeamProjectWorkspace({ teamId, projectId }: { teamId: string; projectId: string }) {
  const { state } = useStudio()
  return <ProjectContent key={`${state.user.id}:${teamId}:${projectId}`} teamId={teamId} projectId={projectId} />
}

function ProjectContent({ teamId, projectId }: { teamId: string; projectId: string }) {
  const teamQuery = useTeamQuery<{ team: TeamSummary }>(`/api/teams/${encodeURIComponent(teamId)}`)
  const projectQuery = useTeamQuery<{ project: TeamProject }>(`/api/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}`)
  const search = useSearchParams(), router = useRouter()
  const tab = ['assets', 'generation', 'settings'].includes(search.get('tab') || '') ? search.get('tab')! : 'assets'
  const setTab = (value: string) => router.replace(`/teams/${teamId}/projects/${projectId}?tab=${encodeURIComponent(value)}`, { scroll: false })
  const [references, setReferences] = useState<TeamAsset[]>([])
  const team = teamQuery.data?.team, project = projectQuery.data?.project
  const loading = teamQuery.isLoading || projectQuery.isLoading
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
    <Link href={`/teams/${teamId}`} className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回团队</Link>
    {loading ? <TeamLoading /> : !team || !project ? <TeamUnavailable connected={teamQuery.connected} error={projectQuery.error || teamQuery.error} retry={() => { void teamQuery.mutate(); void projectQuery.mutate() }} /> : <>
      <header><p className="mb-2 text-sm text-muted-foreground">{team.name}</p><div className="flex flex-wrap items-center gap-3"><h1 className="break-words text-3xl font-semibold tracking-tight">{project.title}</h1><Badge variant="outline"><FolderLock className="mr-1 size-3" />{project.visibility === 'team' ? '全团队可见' : '指定成员'}</Badge></div>{project.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{project.description}</p>}{team.role === 'reviewer' && <p className="mt-3 text-sm text-muted-foreground">你以审阅成员身份查看此项目{team.canDownload ? '，可下载素材。' : '，下载需要管理员授权。'}</p>}</header>
      <Link href={`/teams/${teamId}/projects/${projectId}/canvas`} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Sparkles className="size-4" />打开项目画布</Link>
      <Tabs value={tab} onValueChange={value => setTab(String(value))} className="gap-6">
        <TabsList variant="line" aria-label="团队项目功能" className="h-auto min-h-11 border-b border-border">
          <TabsTrigger value="assets" className="min-h-11 px-4"><Images />项目素材</TabsTrigger>
          <TabsTrigger value="generation" className="min-h-11 px-4"><Sparkles />生成任务</TabsTrigger>
          {team.role !== 'reviewer' && <TabsTrigger value="settings" className="min-h-11 px-4"><Settings2 />项目设置</TabsTrigger>}
        </TabsList>
        <TabsContent value="assets"><TeamProjectAssets team={team} project={project} onReference={asset => { setReferences(items => items.some(item => item.id === asset.id) ? items : [...items, asset]); setTab('generation') }} /></TabsContent>
        <TabsContent value="generation" keepMounted><TeamProjectGeneration team={team} project={project} references={references} onReferencesChange={setReferences} /></TabsContent>
        {team.role !== 'reviewer' && <TabsContent value="settings"><TeamProjectSettings team={team} project={project} /></TabsContent>}
      </Tabs>
    </>}
  </div>
}
