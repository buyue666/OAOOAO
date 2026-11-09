'use client'

import Link from 'next/link'
import { HardDrive } from 'lucide-react'
import { formatStorageBytes, useStorageUsage } from '@/lib/studio/account-storage'
import { useUiText } from '@/lib/studio/i18n'
import { cn } from '@/lib/utils'
import { useTeamQuery } from '@/lib/studio/team-api'
import type { TeamUsage } from '@/lib/studio/team-types'

export function StorageUsageLink(props:{collapsed?:boolean;detail?:boolean;teamId?:string}) { return props.teamId ? <TeamStorageUsageLink teamId={props.teamId} collapsed={props.collapsed} /> : <PersonalStorageUsageLink {...props} /> }
function TeamStorageUsageLink({teamId,collapsed}:{teamId:string;collapsed?:boolean}) {
  const query=useTeamQuery<TeamUsage>(`/api/teams/${teamId}/usage`,15000),usage=query.data?.storage
  const caption=usage?`${formatStorageBytes(usage.usedBytes)} / ${formatStorageBytes(usage.quotaBytes)}`:query.error?'团队容量读取失败':'正在读取团队容量'
  return <Link href={`/teams/${teamId}?tab=usage`} title={caption} aria-label={`管理团队存储空间：${caption}`} className={cn('flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',collapsed&&'justify-center px-2')}><HardDrive className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />{!collapsed&&<span className="min-w-0 flex-1"><span className="block text-[11px] font-medium">团队存储空间</span><span className="mt-1 block text-[11px] text-muted-foreground">{caption}</span></span>}</Link>
}
function PersonalStorageUsageLink({collapsed=false,detail=false}:{collapsed?:boolean;detail?:boolean}) {
  const {usage,error}=useStorageUsage(),tx=useUiText()
  const full=Boolean(usage&&!usage.unlimited&&usage.usedBytes>=usage.quotaBytes)
  const caption=usage?`${formatStorageBytes(usage.usedBytes)} / ${usage.unlimited?tx('不限容量'):formatStorageBytes(usage.quotaBytes)}`:error?tx('容量读取失败'):tx('正在读取容量')
  return <Link href="/assets" aria-label={`${tx('管理存储空间')}：${caption}`} title={caption} className={cn('flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',detail?'studio-surface':null,collapsed?'justify-center px-2':null)}>
    <HardDrive className={cn('size-[18px] shrink-0',full?'text-destructive':'text-muted-foreground')} aria-hidden="true" />
    {!collapsed&&<div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]"><span className="font-medium">{tx('存储空间')}</span><span className={full?'text-destructive':'text-muted-foreground'}>{caption}</span></div>
      {usage&&!usage.unlimited&&<div role="progressbar" aria-label={tx('已用容量')} aria-valuemin={0} aria-valuemax={usage.quotaBytes} aria-valuenow={Math.min(usage.usedBytes,usage.quotaBytes)} aria-valuetext={caption} className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full',full?'bg-destructive':'bg-studio-accent')} style={{width:`${Math.min(100,usage.usedBytes/usage.quotaBytes*100)}%`}} /></div>}
      {detail&&<p className="mt-1 text-xs text-muted-foreground">{tx('上传素材与生成结果共用容量')}{usage?.pendingDeletionBytes?` · ${formatStorageBytes(usage.pendingDeletionBytes)} ${tx('等待清理')}`:''}</p>}
    </div>}
  </Link>
}
