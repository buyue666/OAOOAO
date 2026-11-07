'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Check, ChevronDown, House, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { teamIdFromPath, useTeamQuery } from '@/lib/studio/team-api'
import { teamRoleLabels, type TeamSummary } from '@/lib/studio/team-types'

export function WorkspaceSwitcher() {
  const pathname = usePathname()
  const router = useRouter()
  const teamId = teamIdFromPath(pathname)
  const { data, error } = useTeamQuery<{ teams: TeamSummary[] }>('/api/teams')
  const active = data?.teams.find(team => team.id === teamId)
  const Icon = teamId ? Users : House
  const workspaceName = active?.name ?? (teamId ? '团队空间' : '个人空间')
  const workspaceDescription = active ? `${teamRoleLabels[active.role]} · 团队钱包` : teamId ? '独立团队钱包' : '个人作品与个人钱包'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon-lg" className="sm:w-auto sm:gap-2 sm:px-3" aria-label={`切换个人或团队空间，当前为${workspaceName}`} title={workspaceName} />}>
        <Icon data-icon="inline-start" aria-hidden="true" />
        <span className="hidden max-w-36 truncate sm:block">{workspaceName}</span>
        <ChevronDown data-icon="inline-end" className="hidden sm:block" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60 max-w-[calc(100vw-1.5rem)]" align="end" side="bottom" sideOffset={8} aria-label="选择创作空间">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="truncate">{workspaceName}</span>
            <span className="font-normal">{workspaceDescription}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push('/studio')}><House />个人空间{!teamId && <Check className="ml-auto" />}</DropdownMenuItem>
        </DropdownMenuGroup>
        {!!data?.teams.length && <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuLabel>我的团队</DropdownMenuLabel>{data.teams.map(team => <DropdownMenuItem key={team.id} onClick={() => router.push(`/teams/${team.id}`)}><Users /><span className="max-w-44 truncate">{team.name}</span>{team.id === teamId && <Check className="ml-auto" />}</DropdownMenuItem>)}</DropdownMenuGroup></>}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push('/teams?create=1')}><Plus />创建团队</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/teams')}><Users />加入团队／管理团队</DropdownMenuItem>
          {error && <DropdownMenuItem disabled>团队列表暂时不可用</DropdownMenuItem>}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
