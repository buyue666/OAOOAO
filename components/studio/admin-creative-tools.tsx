'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Save, Trash2, Upload } from 'lucide-react'
import { getAdminSettings, updateAdminSettings } from '@/lib/studio/admin-api'
import { request } from '@/lib/studio/api'
import { creativePlugins, type CreativePluginId } from '@/lib/studio/creative-plugins'
import { toolShowcase, toolEffects, type CreativeToolsSettings, type ToolShowcase, type ToolMedia } from '@/lib/studio/creative-tool-showcase'
import { refreshCreativeTools } from '@/lib/studio/use-creative-tools'
import { AdminError, AdminField, AdminInput, AdminLoading, AdminNotice, AdminSelect, AdminTextarea, useConfirm } from './admin-kit'
import { useAdminNavigation, useAdminReload } from './admin-shell'
import { ToolShowcaseCard } from './plugins/plugin-center'
import { cn } from '@/lib/utils'

export function AdminCreativeToolsPanel() {
  const [saved, setSaved] = useState<CreativeToolsSettings | null>(null), [drafts, setDrafts] = useState<CreativeToolsSettings>({})
  const [selected, setSelected] = useState<CreativePluginId>('tryon'), [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const revision = useRef(0), dirtyRef = useRef(false), { reloadKey } = useAdminReload(), { registerGuard } = useAdminNavigation(), confirm = useConfirm()
  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved || {})
  dirtyRef.current = dirty
  const load = useCallback(async () => {
    const id = ++revision.current; setLoading(true); setError('')
    try {
      const settings = await getAdminSettings()
      if (id !== revision.current) return
      setSaved(settings.creativeTools || {})
      if (!dirtyRef.current) setDrafts(settings.creativeTools || {})
    } catch (err) { if (id === revision.current) setError(err instanceof Error ? err.message : '工具展示配置读取失败') }
    finally { if (id === revision.current) setLoading(false) }
  }, [])
  useEffect(() => { void load(); return () => { revision.current += 1 } }, [load, reloadKey])
  useEffect(() => {
    registerGuard(dirty ? proceed => confirm.confirm({ title: '放弃未保存的工具展示更改？', description: '切换工具会保留草稿，离开本页会丢失尚未保存的更改。', confirmLabel: '放弃并离开', onConfirm: proceed }) : null)
    return () => registerGuard(null)
  }, [dirty, registerGuard, confirm.confirm])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault() }
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent)
  }, [])
  const current = toolShowcase(selected, drafts), original = toolShowcase(selected, saved || {})
  const currentDirty = JSON.stringify(current) !== JSON.stringify(original)
  function change(patch: Partial<ToolShowcase>) { setDrafts(old => ({ ...old, [selected]: { ...toolShowcase(selected, old), ...patch } })); setMessage('') }
  function mediaChange(index: number, patch: Partial<ToolMedia>) { change({ media: current.media.map((item, i) => i === index ? { ...item, ...patch } : item) }) }
  function move(index: number, direction: number) { const media = [...current.media]; [media[index], media[index + direction]] = [media[index + direction], media[index]]; change({ media }) }
  async function upload(file: File, index?: number, poster = false) {
    if (!file) return
    const image = file.type.startsWith('image/'), video = file.type.startsWith('video/')
    if ((!image && !video) || (poster && !image)) { setError('请选择图片或视频；视频封面只能使用图片。'); return }
    if (file.size > (image ? 6 : 25) * 1024 * 1024) { setError(image ? '展示图片不得超过 6 MiB，请先压缩。' : '展示视频不得超过 25 MiB。'); return }
    setUploading(true); setError('')
    try {
      const data = new FormData(); data.append('file', file)
      const result = await request<{ media: ToolMedia }>('/api/admin/creative-tools/media', { method: 'POST', body: data })
      if (typeof index === 'number') mediaChange(index, poster ? { poster: result.media.url } : result.media)
      else change({ media: [...current.media, { ...result.media, label: '' }] })
    } catch (err) { setError(err instanceof Error ? err.message : '上传失败，请重试') }
    finally { setUploading(false) }
  }
  async function save() {
    setSaving(true); setError(''); setMessage('')
    try {
      const { settings } = await updateAdminSettings({ creativeTools: { [selected]: current } })
      revision.current += 1
      setSaved(settings.creativeTools || {}); setDrafts(old => ({ ...old, [selected]: settings.creativeTools?.[selected] || current }))
      await refreshCreativeTools()
      setMessage(`「${current.title}」已保存，用户端下次打开工具页时会读取新配置。`)
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败，请重试') }
    finally { setSaving(false) }
  }
  if (loading && !saved) return <AdminLoading label="正在读取创作工具展示" rows={4} />
  if (!saved) return <AdminError message={error || '读取失败'} retry={() => void load()} />
  const busy = saving || uploading
  return <div className="space-y-5" data-testid="admin-creative-tools">
    {confirm.dialog}
    {error && <AdminError message={error} />}{message && <AdminNotice tone="success">{message}</AdminNotice>}
    <div className="grid items-start gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label="选择创作工具" className="flex gap-2 overflow-x-auto rounded-xl border border-border bg-card p-2 lg:sticky lg:top-4 lg:flex-col">
        {creativePlugins.map(tool => { const display = toolShowcase(tool.id, drafts), changed = JSON.stringify(display) !== JSON.stringify(toolShowcase(tool.id, saved)); return <button key={tool.id} type="button" disabled={busy} onClick={() => { setSelected(tool.id); setError(''); setMessage('') }} aria-current={selected === tool.id ? 'true' : undefined} className={cn('flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', selected === tool.id ? 'bg-studio-accent/10 font-medium text-studio-accent' : 'text-foreground hover:bg-muted')}><span>{tool.name}{changed && <span aria-label="未保存" className="ml-1">·</span>}</span><span className={cn('size-1.5 shrink-0 rounded-full', display.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/50')} aria-label={display.enabled ? '已开放' : '已关闭'} /></button> })}
      </nav>
      <div className="grid min-w-0 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <form className="min-w-0 space-y-5" onSubmit={event => { event.preventDefault(); void save() }}>
          <fieldset disabled={busy} className="space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{creativePlugins.find(tool => tool.id === selected)?.name}</h2><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={current.enabled} onChange={event => change({ enabled: event.target.checked })} className="size-4 accent-current" />向用户开放</label></div>
            <p className="text-xs leading-6 text-muted-foreground">关闭后隐藏工具入口并停止接受新的使用请求。已有作品、下载和任务结果保留。团队空间仍以工具支持范围为准。</p>
            {selected === 'director' && <p className="text-xs leading-6 text-muted-foreground">3D 导演台依赖自由画布；自由画布关闭时，导演台也会暂停开放。</p>}
            <div className="grid gap-4 sm:grid-cols-2"><AdminField label="展示标题"><AdminInput aria-label="展示标题" maxLength={40} value={current.title} onChange={event => change({ title: event.target.value })} required /></AdminField><AdminField label="分类内排序" hint="数值越小越靠前"><AdminInput aria-label="分类内排序" type="number" min={0} max={1000} step={1} value={current.order} onChange={event => change({ order: Number(event.target.value) })} /></AdminField></div>
            <AdminField label="展示描述"><AdminTextarea aria-label="展示描述" maxLength={240} rows={3} value={current.description} onChange={event => change({ description: event.target.value })} /></AdminField>
            <div className="grid gap-4 sm:grid-cols-2"><AdminField label="展示效果"><AdminSelect aria-label="展示效果" value={current.effect} onChange={event => change({ effect: event.target.value as ToolShowcase['effect'] })}>{toolEffects.map(effect => <option key={effect.value} value={effect.value}>{effect.label}</option>)}</AdminSelect></AdminField><AdminField label="画面适配"><AdminSelect aria-label="画面适配" value={current.fit} onChange={event => change({ fit: event.target.value as ToolShowcase['fit'] })}><option value="cover">铺满封面</option><option value="contain">完整展示</option></AdminSelect></AdminField></div>
            <p className="text-xs leading-6 text-muted-foreground">{toolEffects.find(effect => effect.value === current.effect)?.hint}</p>
            {current.effect === 'carousel' && <AdminField label="轮播间隔（秒）"><AdminInput aria-label="轮播间隔（秒）" type="number" min={2.5} max={15} step={0.5} value={current.intervalMs / 1000} onChange={event => change({ intervalMs: Number(event.target.value) * 1000 })} /></AdminField>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><div><h3 className="text-sm font-semibold">展示媒体</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">最多 8 项。使用自有的生成结果，图片建议 WebP、16:9；视频建议短片并提供封面。</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={current.media.length >= 8} onClick={() => change({ media: [...current.media, { type: 'image', url: '', label: '' }] })} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"><ImagePlus className="size-4" />添加链接</button><label className={cn('inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted', (busy || current.media.length >= 8) && 'pointer-events-none opacity-50')}><Upload className="size-4" />上传媒体<input aria-label="上传展示媒体" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" disabled={busy || current.media.length >= 8} className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /></label></div></div>
            {current.media.length === 0 && <p className="rounded-xl border border-dashed border-border p-4 text-xs leading-6 text-muted-foreground">使用默认封面。添加真实效果图后即可替换；不会自动生成或消耗模型额度。</p>}
            {current.media.map((item, index) => <div key={index} className="space-y-3 rounded-xl border border-border bg-background/50 p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">媒体 {index + 1}</span><div className="flex gap-1"><button type="button" aria-label={`上移媒体 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)} className="flex size-9 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" /></button><button type="button" aria-label={`下移媒体 ${index + 1}`} disabled={index === current.media.length - 1} onClick={() => move(index, 1)} className="flex size-9 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" /></button><button type="button" aria-label={`移除媒体 ${index + 1}`} onClick={() => change({ media: current.media.filter((_, i) => i !== index) })} className="flex size-9 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></button></div></div><div className="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)]"><AdminField label="类型"><AdminSelect aria-label={`媒体 ${index + 1} 类型`} value={item.type} onChange={event => mediaChange(index, { type: event.target.value as ToolMedia['type'] })}><option value="image">图片</option><option value="video">视频</option></AdminSelect></AdminField><AdminField label="媒体链接"><AdminInput aria-label={`媒体 ${index + 1} 链接`} value={item.url} maxLength={2048} placeholder="https://…" required onChange={event => mediaChange(index, { url: event.target.value })} /></AdminField></div><AdminField label="媒体说明（可选）" hint="例如：同一人物 · 服装 A · 站姿 · 城市场景"><AdminInput aria-label={`媒体 ${index + 1} 说明`} value={item.label || ''} maxLength={80} onChange={event => mediaChange(index, { label: event.target.value })} /></AdminField>{item.type === 'video' && <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><AdminField label="视频封面"><AdminInput aria-label={`媒体 ${index + 1} 视频封面`} value={item.poster || ''} maxLength={2048} onChange={event => mediaChange(index, { poster: event.target.value })} placeholder="https://…" /></AdminField></div><label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-xs"><Upload className="size-4" />上传<input aria-label={`上传媒体 ${index + 1} 封面`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, index, true); event.target.value = '' }} /></label></div>}</div>)}
            <p className="text-xs leading-6 text-muted-foreground">上传素材保存到站点对象存储，用于公开工具展示；不占用个人创作资产容量。图片上限 6 MiB，视频上限 25 MiB。</p>
          </fieldset>
          <div className="sticky bottom-3 z-40 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur-xl"><p className="text-xs text-muted-foreground">{uploading ? '正在上传…' : currentDirty ? '此工具有未保存的更改' : '此工具配置已保存'}</p><button type="submit" disabled={busy || !currentDirty} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background disabled:opacity-40"><Save className="size-4" />{saving ? '正在保存…' : '保存此工具'}</button></div>
        </form>
        <aside className="min-w-0 space-y-3 2xl:sticky 2xl:top-4"><div><h2 className="text-sm font-semibold">用户端预览</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">悬浮或聚焦可预览效果。此处不会进入工具。</p></div><ToolShowcaseCard key={selected} id={selected} showcase={{ ...current, media: current.media.filter(item => item.url.trim()) }} href="#tool-preview" preview unavailable={!current.enabled ? '已关闭：用户端不会展示此工具。' : undefined} /><p className="text-xs leading-6 text-muted-foreground">配置按工具独立保存；切换左侧工具会保留未保存的草稿。</p></aside>
      </div>
    </div>
  </div>
}
