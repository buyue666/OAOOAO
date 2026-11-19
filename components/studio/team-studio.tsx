'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import { useTeamQuery } from '@/lib/studio/team-api'
import { useStudio } from '@/lib/studio/store'
import { useUiText } from '@/lib/studio/i18n'
import type { TeamProject, TeamSummary } from '@/lib/studio/team-types'
import type { TeamStudioArea } from '@/lib/studio/team-studio-routes'
import { TeamMediaProvider } from '@/lib/studio/team-media-context'
import { HomePage } from './home-page'
import { TeamProjects } from './team-projects'
import { TeamLoading, TeamUnavailable } from './team-feedback'
import { PluginCenter } from './plugins/plugin-center'
import { PluginGate, PluginLoading } from './plugins/plugin-gate'

const ImageWorkspace = dynamic(() => import('./workspaces').then(module => module.ImageWorkspace), { ssr: false, loading: PluginLoading })
const VideoWorkspace = dynamic(() => import('./workspaces').then(module => module.VideoWorkspace), { ssr: false, loading: PluginLoading })

export function TeamStudio(props: { teamId: string; projectId?: string; area: TeamStudioArea }) {
  const { state } = useStudio()
  return <TeamStudioContent key={`${state.user.id}:${props.teamId}:${props.projectId ?? ''}:${props.area}`} {...props} />
}

function TeamStudioContent({ teamId, projectId, area }: { teamId: string; projectId?: string; area: TeamStudioArea }) {
  const tx = useUiText()
  const root = `/teams/${encodeURIComponent(teamId)}`
  const teamQuery = useTeamQuery<{ team: TeamSummary }>(`/api${root}`)
  const projectQuery = useTeamQuery<{ project: TeamProject }>(projectId && teamQuery.data ? `/api${root}/projects/${encodeURIComponent(projectId)}` : null)
  const team = teamQuery.data?.team, project = projectQuery.data?.project
  const panel = (child: React.ReactNode) => <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">{child}</div>
  if (teamQuery.isLoading || projectQuery.isLoading) return panel(<TeamLoading />)
  if (!team || (projectId && !project)) return panel(<TeamUnavailable connected={teamQuery.connected} error={teamQuery.error || projectQuery.error} retry={() => { void teamQuery.mutate(); if (team) void projectQuery.mutate() }} />)
  if (area === 'home') return <HomePage team={team} project={project} />
  if (area === 'features') return <PluginCenter />

  const title = tx(area === 'image' ? '图片生成' : area === 'video' ? '视频生成' : '自由画布')
  if (!project || area === 'canvas') {
    const picker = panel(<div className="space-y-5"><Link href={`${root}/studio`} prefetch={false} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{tx('返回创作首页')}</Link><div><p className="break-words text-xs text-muted-foreground">{team.name}</p><h1 className="mt-1 text-2xl font-semibold">{title}</h1></div><TeamProjects team={team} studioArea={area} /></div>)
    return area === 'canvas' ? <PluginGate id="canvas">{picker}</PluginGate> : picker
  }

  const projectPath = `${root}/projects/${project.id}`
  if (team.role === 'reviewer') return panel(<div className="space-y-4"><h1 className="text-2xl font-semibold">{title}</h1><p className="text-sm text-foreground">{tx('你是审阅成员，可以查看已授权的项目和生成结果。')}</p><Link href={`${projectPath}?tab=generation`} className="inline-flex min-h-11 items-center gap-2 text-sm text-studio-accent underline">{tx('查看生成结果')}</Link></div>)

  return <TeamMediaProvider team={team} project={project}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-1 text-xs sm:px-6" data-team-creation={area}>
      <span className="min-w-0 break-words font-medium text-foreground">{team.name} / {project.title}</span>
      <Link href={`${root}/studio/${area}`} prefetch={false} className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-muted-foreground hover:text-foreground"><FolderOpen className="size-4" aria-hidden="true" />{tx('切换项目')}</Link>
    </div>
    {area === 'image' ? <ImageWorkspace /> : <VideoWorkspace />}
  </TeamMediaProvider>
}
