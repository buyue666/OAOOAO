'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Check, Coins, House, Plus, Users } from 'lucide-react'
import { teamIdFromPath, useTeamQuery } from '@/lib/studio/team-api'
import { teamNumber, teamRoleLabels, type TeamSummary } from '@/lib/studio/team-types'

export function WorkspaceCredits({ pathname }: { pathname: string }) {
  const teamId = teamIdFromPath(pathname)
  const query = useTeamQuery<{ balance: number }>(teamId ? `/api/teams/${teamId}/usage` : null, 15000)
  const label = query.data ? `团队 ${teamNumber(query.data.balance)} 积分` : query.error ? '团队积分暂不可用' : '正在读取团队积分…'
  return <Link href={`/teams/${teamId}?tab=usage`} aria-label={`${label}，查看团队积分与容量`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground shadow-[var(--lg-shadow-1)] hover:bg-muted"><Coins className="size-4 text-studio-accent" aria-hidden="true" /><span className="tabular-nums">{label}</span></Link>
}

export function WorkspaceSwitcher({ onSelect, active: open = true }: { onSelect?: () => void; active?: boolean }) {
  const pathname = usePathname()
  const teamId = teamIdFromPath(pathname)
  const { data, error, isLoading, mutate } = useTeamQuery<{ teams: TeamSummary[] }>(open ? '/api/teams' : null)
  const active = data?.teams.find(team => team.id === teamId)
  const workspaceName = active?.name ?? (teamId ? '团队空间' : '个人空间')
  const workspaceDescription = active ? `${teamRoleLabels[active.role]} · 团队钱包` : teamId ? '独立团队钱包' : '个人作品与个人钱包'
  const itemClass = 'flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-checked:bg-muted aria-checked:font-medium'
  return (
    <div role="group" aria-label="切换个人或团队空间" className="my-2 border-y border-border py-2">
      <div className="px-2.5 pb-2"><p className="text-[11px] font-medium text-muted-foreground">当前空间</p><p className="mt-1 break-words text-sm font-semibold">{workspaceName}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{workspaceDescription}</p></div>
      <Link href="/studio" role="menuitemradio" aria-checked={!teamId} className={itemClass} onClick={onSelect}><House className="size-4 shrink-0 text-muted-foreground" />个人空间{!teamId && <Check className="ml-auto size-4" />}</Link>
      <div className="max-h-48 overflow-y-auto">{data?.teams.map(team => <Link key={team.id} href={`/teams/${team.id}`} role="menuitemradio" aria-checked={team.id === teamId} className={itemClass} onClick={onSelect}><Users className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-words">{team.name}</span>{team.id === teamId && <Check className="size-4 shrink-0" />}</Link>)}</div>
      {isLoading && <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">正在读取团队…</p>}
      {error && <button type="button" role="menuitem" className={itemClass} onClick={() => void mutate()}>团队列表读取失败，点击重试</button>}
      <Link href="/teams?create=1" role="menuitem" className={itemClass} onClick={onSelect}><Plus className="size-4 text-muted-foreground" />创建团队</Link>
      <Link href="/teams" role="menuitem" className={itemClass} onClick={onSelect}><Users className="size-4 text-muted-foreground" />加入／管理团队</Link>
    </div>
  )
}
