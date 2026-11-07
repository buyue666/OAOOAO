'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Check, ChevronsUpDown, House, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { teamIdFromPath, useTeamQuery } from '@/lib/studio/team-api'
import { teamRoleLabels, type TeamSummary } from '@/lib/studio/team-types'
import { cn } from '@/lib/utils'

export function WorkspaceSwitcher({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const teamId = teamIdFromPath(pathname)
  const { data, error } = useTeamQuery<{ teams: TeamSummary[] }>('/api/teams')
  const active = data?.teams.find(team => team.id === teamId)
  const Icon = teamId ? Users : House
  const navigate = (href: string) => { onNavigate?.(); router.push(href) }
  return <div className={cn('shrink-0 px-2 pb-3', collapsed && 'px-3')}>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size={collapsed ? 'icon' : 'default'} className={cn(!collapsed && 'h-auto w-full justify-start py-2.5')} aria-label="切换个人或团队空间" />}>
        <Icon data-icon="inline-start" />
        {!collapsed && <><span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"><span className="truncate">{active?.name ?? (teamId ? '团队空间' : '个人空间')}</span><span className="text-xs font-normal text-muted-foreground">{active ? `${teamRoleLabels[active.role]} · 团队钱包` : teamId ? '独立团队钱包' : '个人作品与个人钱包'}</span></span><ChevronsUpDown data-icon="inline-end" /></>}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60" side={collapsed ? 'right' : 'bottom'}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>选择创作空间</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => navigate('/studio')}><House />个人空间{!teamId && <Check className="ml-auto" />}</DropdownMenuItem>
        </DropdownMenuGroup>
        {!!data?.teams.length && <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuLabel>我的团队</DropdownMenuLabel>{data.teams.map(team => <DropdownMenuItem key={team.id} onClick={() => navigate(`/teams/${team.id}`)}><Users /><span className="max-w-44 truncate">{team.name}</span>{team.id === teamId && <Check className="ml-auto" />}</DropdownMenuItem>)}</DropdownMenuGroup></>}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigate('/teams?create=1')}><Plus />创建团队</DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/teams')}><Users />加入团队／管理团队</DropdownMenuItem>
          {error && <DropdownMenuItem disabled>团队列表暂时不可用</DropdownMenuItem>}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}
