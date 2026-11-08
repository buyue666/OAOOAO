'use client'

import { useDeferredValue, useRef, useState } from 'react'
import { AudioLines, FileVideo, Search, Upload, X } from 'lucide-react'
import { request } from '@/lib/studio/api'
import { useTeamQuery } from '@/lib/studio/team-api'
import type { TeamAsset } from '@/lib/studio/team-types'
import { teamCanvasRoot, type CanvasWorkspace } from './canvas-workspace'
import type { NodeReference } from './types'

export function teamAssetReference(asset: TeamAsset): NodeReference {
  if (!asset.url || asset.kind === 'text') throw new Error('请选择图片、视频或音频素材')
  return { id: asset.id, title: asset.title, url: asset.url, mediaKind: asset.kind }
}

export async function saveTeamCanvasImage(workspace: CanvasWorkspace, url: string, title: string) {
  if (!url.startsWith('data:')) {
    if (!url.startsWith(`/api/teams/${workspace.teamId}/assets/`)) throw new Error('请先将图片复制到当前项目素材')
    return url
  }
  const { asset } = await request<{ asset: TeamAsset }>(`${teamCanvasRoot(workspace)}/assets`, { method: 'POST', body: JSON.stringify({ title, dataUrl: url }) })
  if (!asset.url) throw new Error('图片上传未返回可用地址')
  return asset.url
}

export function TeamCanvasAssets({ workspace, onPick, onClose }: { workspace: CanvasWorkspace; onPick: (reference: NodeReference) => void; onClose: () => void }) {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [kind, setKind] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false)
  const keyword = useDeferredValue(search)
  const query = useTeamQuery<{ assets: TeamAsset[]; total: number }>(`/api/teams/${workspace.teamId}/assets?projectId=${workspace.projectId}&page=${page}&pageSize=30&keyword=${encodeURIComponent(keyword)}&kind=${kind || 'media'}`)
  const assets = (query.data?.assets ?? []).filter(asset => asset.kind !== 'text')
  return <section aria-label="项目素材" className="flex max-h-[calc(100dvh-7rem)] flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xl">
    <header className="flex items-center gap-2"><div className="flex-1"><h2 className="text-sm font-semibold">项目素材</h2><p className="text-xs text-muted-foreground">仅使用当前团队项目中的素材</p></div><button type="button" aria-label="关闭项目素材" onClick={onClose} className="flex size-11 items-center justify-center rounded-xl hover:bg-muted"><X className="size-4" /></button></header>
    <div className="flex items-center gap-2 rounded-xl border border-border px-3"><Search className="size-4 text-muted-foreground" /><input aria-label="搜索项目素材" placeholder="搜索项目素材" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
    <select aria-label="素材类型" value={kind} onChange={event => { setKind(event.target.value); setPage(1) }} className="h-11 rounded-xl border border-border bg-background px-3 text-sm"><option value="">全部媒体</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select>
    {!workspace.readOnly && <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs hover:bg-muted"><Upload className="size-4" />{busy ? '正在上传…' : '上传到当前项目'}<input type="file" multiple accept="image/*,video/*,audio/*" disabled={busy} className="sr-only" onChange={async event => {
      const files = Array.from(event.target.files ?? []); event.target.value = ''
      if (lock.current || !files.length) return
      lock.current = true; setBusy(true); setError('')
      try {
        for (const file of files) {
          const body = new FormData(); body.set('file', file); body.set('title', file.name.replace(/\.[^.]+$/, '').slice(0, 120))
          await request(`${teamCanvasRoot(workspace)}/assets`, { method: 'POST', body })
        }
        await query.mutate()
      } catch (reason) { setError(reason instanceof Error ? reason.message : '上传未完成，请重试') }
      finally { lock.current = false; setBusy(false) }
    }} /></label>}
    {(error || query.error) && <p role="alert" className="text-xs text-destructive">{error || String(query.error.message)}</p>}
    <ul className="grid min-h-0 grid-cols-3 gap-2 overflow-y-auto">{assets.map(asset => <li key={asset.id}><button type="button" title={asset.title} aria-label={`选择素材 ${asset.title}`} onClick={() => onPick(teamAssetReference(asset))} className="w-full overflow-hidden rounded-xl border border-border text-left hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"><span className="flex aspect-square items-center justify-center bg-muted">{asset.kind === 'image' ? <img src={asset.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : asset.kind === 'video' ? <FileVideo className="size-6" /> : <AudioLines className="size-6" />}</span><span className="block truncate p-2 text-xs">{asset.title}</span></button></li>)}</ul>
    {!assets.length && <p className="py-6 text-center text-xs text-muted-foreground">{query.isLoading ? '正在读取项目素材…' : '本页没有匹配的素材'}</p>}
    <div className="flex items-center justify-between text-xs text-muted-foreground"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className="min-h-11 px-2 disabled:opacity-40">上一页</button><span>第 {page} 页 · 共 {query.data?.total ?? 0} 个素材</span><button type="button" disabled={page * 30 >= (query.data?.total ?? 0)} onClick={() => setPage(value => value + 1)} className="min-h-11 px-2 disabled:opacity-40">下一页</button></div>
  </section>
}
