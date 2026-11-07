'use client'

import { useState } from 'react'
import { Download, FileAudio, FileText, Film, Plus, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTeamAction, useTeamQuery } from '@/lib/studio/team-api'
import { useStudio } from '@/lib/studio/store'
import { formatTeamBytes, isTeamManager, type TeamAsset, type TeamProject, type TeamSummary } from '@/lib/studio/team-types'
import { TeamError, TeamLoading } from './team-feedback'

export function TeamAssetVisual({ asset }: { asset: TeamAsset }) {
  if (asset.kind === 'image') return <img src={asset.url} alt={asset.title} loading="lazy" className="size-full object-contain" />
  const Icon = asset.kind === 'video' ? Film : asset.kind === 'audio' ? FileAudio : FileText
  return <Icon className="size-9 text-muted-foreground" aria-hidden="true" />
}

export function TeamProjectAssets({ team, project, onReference }: { team: TeamSummary; project: TeamProject; onReference: (asset: TeamAsset) => void }) {
  const { state } = useStudio()
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState<TeamAsset | null>(null)
  const [removing, setRemoving] = useState<TeamAsset | null>(null)
  const [upload, setUpload] = useState(false)
  const query = useTeamQuery<{ assets: TeamAsset[]; total: number }>(`/api/teams/${team.id}/assets?projectId=${project.id}&page=${page}&pageSize=24`)
  const action = useTeamAction()
  const canWrite = team.role !== 'reviewer'
  return <div className="flex flex-col gap-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">项目素材</h2><p className="mt-1 text-sm text-muted-foreground">上传与生成结果统一保存在团队，成员退出后仍保留。</p></div>{canWrite && <Button onClick={() => setUpload(true)}><Plus />添加素材</Button>}</div>
    <TeamError error={query.error} />
    {query.isLoading ? <TeamLoading /> : query.data && <>
      {query.data.assets.length ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{query.data.assets.map(asset => <Card key={asset.id} className="min-w-0 gap-3 overflow-hidden py-0">
        <button type="button" aria-label={`预览 ${asset.title}`} className="flex aspect-square w-full items-center justify-center bg-muted/40 p-3 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setPreview(asset)}><TeamAssetVisual asset={asset} /></button>
        <CardContent className="px-4"><p className="break-words text-sm font-medium">{asset.title}</p><p className="mt-1 text-xs text-muted-foreground">{formatTeamBytes(asset.bytes)} · {asset.creatorName || '团队成员'}</p></CardContent>
        <CardFooter className="flex flex-wrap gap-1 px-3 pb-3">{canWrite && asset.kind !== 'text' && <Button variant="ghost" size="sm" onClick={() => onReference(asset)}>作为参考</Button>}{team.canDownload && <a href={`${asset.url}?download=1`} className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label={`下载 ${asset.title}`}><Download className="size-4" /></a>}{canWrite && (isTeamManager(team.role) || asset.createdBy === state.user.id) && <Button variant="ghost" size="icon" aria-label={`删除 ${asset.title}`} onClick={() => { action.clearError(); setRemoving(asset) }}><Trash2 className="size-4" /></Button>}</CardFooter>
      </Card>)}</div> : <div className="rounded-xl border border-dashed border-border px-5 py-14 text-center text-sm text-muted-foreground">{canWrite ? '添加第一份素材，或在生成任务中开始创作。' : '此项目还没有素材。'}</div>}
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>共 {query.data.total} 份素材</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><Button variant="outline" disabled={page * 24 >= query.data.total} onClick={() => setPage(value => value + 1)}>下一页</Button></div></div>
    </>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>团队项目素材预览</DialogDescription></DialogHeader>{preview?.kind === 'image' ? <img src={preview.url} alt={preview.title} className="max-h-[65dvh] w-full object-contain" /> : preview?.kind === 'video' ? <video src={preview.url} controls className="max-h-[65dvh] w-full" /> : preview?.kind === 'audio' ? <audio src={preview.url} controls className="w-full" /> : preview && <a className="text-sm underline" target="_blank" rel="noreferrer" href={preview.url}>打开文本素材</a>}</DialogContent></Dialog>
    <Dialog open={!!removing} onOpenChange={open => { if (!open && !action.pending) setRemoving(null) }}><DialogContent><DialogHeader><DialogTitle>删除「{removing?.title}」？</DialogTitle><DialogDescription>将从团队素材中删除。正在被项目或未完成任务引用的素材会保留。</DialogDescription></DialogHeader><TeamError error={action.error} /><DialogFooter><Button variant="outline" disabled={action.pending} onClick={() => setRemoving(null)}>取消</Button><Button variant="destructive" disabled={action.pending} onClick={async () => { if (removing && await action.run(`/api/teams/${team.id}/assets/${removing.id}`, undefined, 'DELETE')) { setRemoving(null); if (query.data?.assets.length === 1 && page > 1) setPage(value => value - 1) } }}>确认删除</Button></DialogFooter></DialogContent></Dialog>
    {upload && <TeamAssetUploader teamId={team.id} projectId={project.id} onClose={() => setUpload(false)} />}
  </div>
}

function TeamAssetUploader({ teamId, projectId, onClose }: { teamId: string; projectId: string; onClose: () => void }) {
  const [mode, setMode] = useState('file')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [assetId, setAssetId] = useState('')
  const [page, setPage] = useState(1)
  const personal = useTeamQuery<{ data: { assets: Array<{ id: string; title: string; kind: string }>; total: number } }>(mode === 'copy' ? `/api/library-assets?page=${page}&pageSize=20` : null)
  const action = useTeamAction()
  return <Dialog open onOpenChange={open => { if (!open && !action.pending) onClose() }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>添加项目素材</DialogTitle><DialogDescription>上传文件或保存文本，也可以从个人素材库复制一份到团队。</DialogDescription></DialogHeader><form className="flex flex-col gap-5" onSubmit={async event => {
    event.preventDefault()
    const path = `/api/teams/${teamId}/projects/${projectId}/assets`
    let body: unknown = { title, text }
    if (mode === 'file') { if (!file) return; const form = new FormData(); form.append('file', file); body = form }
    if (await action.run(mode === 'copy' ? `${path}/copy` : path, mode === 'copy' ? { assetId } : body)) onClose()
  }}>
    <FieldGroup><Field><FieldLabel htmlFor="team-asset-mode">添加方式</FieldLabel><select id="team-asset-mode" className="h-11 rounded-md border border-input bg-background px-3 text-sm" value={mode} onChange={event => { setMode(event.target.value); action.clearError() }}><option value="file">上传文件</option><option value="text">保存文本</option><option value="copy">从个人素材库复制</option></select></Field>
      {mode === 'file' ? <Field><FieldLabel htmlFor="team-asset-file">图片、视频或音频</FieldLabel><Input id="team-asset-file" type="file" required accept="image/*,video/*,audio/*" onChange={event => setFile(event.target.files?.[0] ?? null)} /><p className="text-xs text-muted-foreground">图片、音频最大 24 MB，视频最大 200 MB。</p></Field> : mode === 'text' ? <><Field><FieldLabel htmlFor="team-asset-title">素材名称</FieldLabel><Input id="team-asset-title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></Field><Field><FieldLabel htmlFor="team-asset-text">文本内容</FieldLabel><Textarea id="team-asset-text" required maxLength={1000000} value={text} onChange={event => setText(event.target.value)} /></Field></> : <Field><FieldLabel htmlFor="personal-team-asset">个人素材</FieldLabel>{personal.isLoading ? <TeamLoading /> : <select id="personal-team-asset" required className="h-11 rounded-md border border-input bg-background px-3 text-sm" value={assetId} onChange={event => setAssetId(event.target.value)}><option value="">选择要复制的素材</option>{personal.data?.data.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select>}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={page <= 1 || personal.isLoading} onClick={() => { setAssetId(''); setPage(value => value - 1) }}>上一页</Button><Button type="button" variant="ghost" disabled={!personal.data || page * 20 >= personal.data.data.total || personal.isLoading} onClick={() => { setAssetId(''); setPage(value => value + 1) }}>下一页</Button></div><p className="text-xs text-muted-foreground">原个人素材保留；尚未保存到个人存储的上游链接需先保存。</p></Field>}
    </FieldGroup><TeamError error={action.error || personal.error} /><DialogFooter><Button type="submit" disabled={action.pending || (mode === 'file' ? !file : mode === 'copy' ? !assetId || !!personal.error : !title.trim() || !text.trim())}>{action.pending ? '正在保存…' : mode === 'copy' ? '复制到团队' : '保存素材'}</Button></DialogFooter>
  </form></DialogContent></Dialog>
}
