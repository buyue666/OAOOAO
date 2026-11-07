'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useTeamAction, useTeamQuery } from '@/lib/studio/team-api'
import { isTeamManager, type TeamMember, type TeamProject, type TeamSummary } from '@/lib/studio/team-types'
import { ProjectAccessFields } from './team-projects'
import { TeamError } from './team-feedback'

export function TeamProjectSettings({ team, project }: { team: TeamSummary; project: TeamProject }) {
  const [draft, setDraft] = useState(project)
  const [saved, setSaved] = useState(false)
  const action = useTeamAction()
  const manager = isTeamManager(team.role)
  const members = useTeamQuery<{ members: TeamMember[] }>(manager ? `/api/teams/${team.id}/members` : null)
  return <form className="flex max-w-3xl flex-col gap-5" onSubmit={async event => {
    event.preventDefault(); setSaved(false)
    const result = await action.run<{ project: TeamProject }>(`/api/teams/${team.id}/projects/${project.id}`, { version: draft.version, title: draft.title, description: draft.description, ...(manager ? { visibility: draft.visibility, memberIds: draft.memberIds } : {}) }, 'PATCH')
    if (result) { setDraft(result.project); setSaved(true) }
  }}>
    <div><h2 className="text-lg font-semibold">项目设置</h2><p className="mt-1 text-sm text-muted-foreground">{manager ? '编辑项目信息，并决定哪些成员可以访问。' : '可以编辑项目信息；访问范围由团队管理员管理。'}</p></div>
    {project.version !== draft.version && <Alert><AlertDescription>项目已被其他成员更新。你的输入仍保留，请核对最新信息后再保存。<Button type="button" variant="outline" className="mt-2 w-fit" onClick={() => { setDraft(project); setSaved(false); action.clearError() }}>载入最新版本</Button></AlertDescription></Alert>}
    <FieldGroup><Field><FieldLabel htmlFor="team-project-title">项目名称</FieldLabel><Input id="team-project-title" required maxLength={120} value={draft.title} onChange={event => { setSaved(false); setDraft({ ...draft, title: event.target.value }) }} /></Field><Field><FieldLabel htmlFor="team-project-description">项目说明</FieldLabel><Textarea id="team-project-description" maxLength={4000} value={draft.description} onChange={event => { setSaved(false); setDraft({ ...draft, description: event.target.value }) }} /></Field>
      {manager && <ProjectAccessFields visibility={draft.visibility} setVisibility={visibility => setDraft({ ...draft, visibility })} memberIds={draft.memberIds} setMemberIds={memberIds => setDraft({ ...draft, memberIds })} members={members.data?.members ?? []} />}
    </FieldGroup>
    <TeamError error={action.error || members.error} />
    {saved && <p role="status" className="text-sm text-muted-foreground">项目设置已保存。</p>}
    <Button type="submit" className="w-fit" disabled={action.pending || !draft.title.trim() || (manager && !members.data)}>{action.pending ? '正在保存…' : '保存项目设置'}</Button>
  </form>
}
