'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTeamQuery } from '@/lib/studio/team-api'
import type { TeamEvent } from '@/lib/studio/team-types'
import { TeamError, TeamLoading } from './team-feedback'

const eventLabels: Record<string, string> = { 'team.created': '创建团队', 'team.renamed': '修改团队名称', 'member.joined': '加入团队', 'member.removed': '移除成员', 'member.left': '退出团队', 'member.updated': '调整成员权限或预算', 'invitation.created': '创建邀请', 'invitation.revoked': '撤销邀请', 'ownership.requested': '发起所有权交接', 'ownership.accepted': '接受所有权交接', 'project.created': '创建项目', 'project.updated': '更新项目', 'project.permissions': '调整项目授权', 'asset.created': '保存团队素材', 'asset.copied': '复制个人素材到团队', 'asset.deleted': '删除团队素材', 'credits.grant': '发放团队积分', 'generation.created': '提交团队生成任务', 'subscription.assigned': '配置团队权益' }

export function TeamEvents({ teamId }: { teamId: string }) {
  const [page, setPage] = useState(1)
  const query = useTeamQuery<{ events: TeamEvent[]; hasMore: boolean }>(`/api/teams/${teamId}/events?page=${page}&pageSize=20`)
  return <div className="flex flex-col gap-4"><div><h2 className="text-lg font-semibold">操作记录</h2><p className="mt-1 text-sm text-muted-foreground">成员、权限、资产和积分的关键变更记录。仅所有者和管理员可见。</p></div><TeamError error={query.error} />{query.isLoading ? <TeamLoading /> : <Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>操作者</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{query.data?.events.map(event => <TableRow key={event.id}><TableCell>{new Date(event.createdAt).toLocaleString('zh-CN')}</TableCell><TableCell>{event.actorName}</TableCell><TableCell>{eventLabels[event.action] || event.action}</TableCell></TableRow>)}</TableBody></Table>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><Button variant="outline" disabled={!query.data?.hasMore} onClick={() => setPage(value => value + 1)}>下一页</Button></div></div>
}
