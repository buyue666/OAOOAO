'use client'

import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, LoaderCircle, Pencil, Plus, Upload, X } from 'lucide-react'
import { uploadCreativeReference } from '@/lib/studio/creative-api'
import { assetAffectedShots, stableMediaUrl } from '@/lib/studio/creative-project'
import type { DramaAssetReference, DramaNamedAsset, DramaProject, DramaSourceAsset } from '@/lib/studio/drama-types'
import { useStudio } from '@/lib/studio/store'
import { MediaThumb } from './ui'

type AssetKind = 'characters' | 'props' | 'scenes'
type AssetEditor = { kind: AssetKind; asset?: DramaNamedAsset; sourceId?: string }
type NamedAssetSave = { kind: AssetKind; asset: DramaNamedAsset }
const kinds: Array<{ value: AssetKind; label: string }> = [{ value: 'characters', label: '角色' }, { value: 'props', label: '产品与道具' }, { value: 'scenes', label: '场景' }]
const fieldClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50'

function primaryImage(asset: DramaNamedAsset) {
  const reference = asset.references?.find((item) => item.id === asset.primaryReferenceId) ?? asset.references?.[0]
  return stableMediaUrl(reference?.url || asset.referenceImageUrl)
}

export function CreativeProjectAssets({ project, disabled, onSave }: { project: DramaProject; disabled: boolean; onSave: (next: DramaProject) => Promise<void> }) {
  const { state } = useStudio()
  const [editor, setEditor] = useState<AssetEditor | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingSource, setPendingSource] = useState<DramaSourceAsset | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const scopeRef = useRef(0)
  const latestProjectRef = useRef(project)
  const identity = `${state.user.id}:${state.backendStatus}:${project.id}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  latestProjectRef.current = project
  const connected = state.backendStatus === 'connected'
  const blocked = disabled || busy || !connected
  const sources = project.sourceAssets ?? []
  const named = kinds.flatMap((kind) => project[kind.value].map((asset) => ({ kind: kind.value, label: kind.label, asset })))

  useEffect(() => {
    scopeRef.current += 1
    setEditor(null)
    setPendingSource(null)
    setError('')
    setNotice('')
    setBusy(false)
    busyRef.current = false
    return () => { scopeRef.current += 1 }
  }, [identity])

  async function persist(next: DramaProject, message: string) {
    if (disabled || busyRef.current || !connected || identityRef.current !== identity || next.id !== project.id) return false
    const scope = scopeRef.current
    const isCurrent = () => scopeRef.current === scope && identityRef.current === identity
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (!isCurrent()) return false
      await onSave(next)
      if (!isCurrent()) return false
      setNotice(message)
      return true
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : '资产保存失败，请重试。')
      return false
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy(false) }
    }
  }

  async function addUploadedReference(source: DramaSourceAsset) {
    const current = latestProjectRef.current
    if (await persist({ ...current, sourceAssets: [...(current.sourceAssets ?? []).filter((item) => item.id !== source.id), source] }, '参考已加入项目，并保存在创作资产中。')) setPendingSource(null)
  }

  async function upload(file: File) {
    if (blocked || busyRef.current || identityRef.current !== identity) return
    if (!file.type.startsWith('image/')) { setError('请选择图片参考。'); return }
    if (file.size > 20 * 1024 * 1024) { setError('图片超过 20 MB，请压缩后上传。'); return }
    const scope = scopeRef.current
    const isCurrent = () => scopeRef.current === scope && identityRef.current === identity
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('正在上传参考图片…')
    try {
      const source = await uploadCreativeReference(file, isCurrent)
      if (!isCurrent()) return
      setPendingSource(source)
      setNotice('参考已上传，正在加入项目…')
      const current = latestProjectRef.current
      if (!isCurrent()) return
      await onSave({ ...current, sourceAssets: [...(current.sourceAssets ?? []).filter((item) => item.id !== source.id), source] })
      if (!isCurrent()) return
      setPendingSource(null)
      setNotice('参考已加入项目，并保存在创作资产中。')
    } catch (reason) {
      if (isCurrent()) { setNotice(''); setError(reason instanceof Error ? reason.message : '参考上传失败，请重试。') }
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy(false) }
    }
  }

  async function saveNamedAsset({ kind, asset }: NamedAssetSave) {
    const current = latestProjectRef.current
    const existing = current[kind].some((item) => item.id === asset.id)
    const next = { ...current, [kind]: existing ? current[kind].map((item) => item.id === asset.id ? {
      ...item,
      name: asset.name,
      description: asset.description,
      profile: { visualIdentity: asset.profile?.visualIdentity || '', styling: item.profile?.styling || '', colorPalette: item.profile?.colorPalette || '', consistencyRules: asset.profile?.consistencyRules || '' },
      references: [...new Map([...(item.references ?? []), ...(asset.references ?? [])].map((reference) => [reference.id, reference])).values()],
      ...(asset.primaryReferenceId ? { primaryReferenceId: asset.primaryReferenceId, referenceImageUrl: asset.referenceImageUrl, referenceStorageKey: asset.referenceStorageKey } : {}),
    } : item) : [...current[kind], asset] }
    if (await persist(next, '身份设定已保存。已采用的镜头保持不变，可以按需要选择重做。')) setEditor(null)
  }

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label="项目参考与身份资产">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">这件作品的角色、产品与场景</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">保存名称、参考和必须保持的细节，再把它们关联到镜头。</p></div><button type="button" disabled={blocked} onClick={() => { setEditor({ kind: 'characters' }); setError(''); setNotice('') }} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50"><Plus className="size-4" aria-hidden="true" />添加身份资产</button></header>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm leading-6 text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm leading-6 text-muted-foreground">{notice}</p>}
      {pendingSource && !busy && <div className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-6"><p>「{pendingSource.title}」已保存在创作资产中，尚未确认加入项目。</p><button type="button" disabled={blocked} onClick={() => void addUploadedReference(pendingSource)} className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">将已上传参考加入项目</button></div>}
      {editor && <NamedAssetForm key={editor.asset?.id ?? `${editor.kind}:${editor.sourceId ?? 'new'}`} editor={editor} sources={sources} project={project} disabled={blocked} onCancel={() => setEditor(null)} onSave={saveNamedAsset} />}
      {named.length ? <div className="grid min-w-0 gap-4 md:grid-cols-2">{named.map(({ kind, label, asset }) => {
        const affected = assetAffectedShots(project, asset.id)
        return <article key={`${kind}:${asset.id}`} className="min-w-0 overflow-hidden rounded-lg border border-border"><div className="flex gap-3 p-4"><MediaThumb src={primaryImage(asset)} alt="" fallback={label} className="size-20 shrink-0 rounded-md" /><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{label}</p><h3 className="mt-1 truncate text-sm font-semibold">{asset.name}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{asset.description || '还没有描述'}</p></div><button type="button" disabled={blocked} onClick={() => { setEditor({ kind, asset }); setError(''); setNotice('') }} aria-label={`编辑${asset.name}`} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50"><Pencil className="size-3.5" aria-hidden="true" /></button></div><div className="border-t border-border px-4 py-3"><p className="text-xs font-medium">必须保持</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{asset.profile?.consistencyRules || '还未添加一致性约束'}</p><details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">关联镜头 · {affected.length}</summary>{affected.length ? <ul className="mt-2 flex flex-wrap gap-1.5">{affected.map((shot) => <li key={`${shot.episodeId}:${shot.shotId}`} className="rounded bg-muted px-2 py-1 text-xs">{project.episodes.find((episode) => episode.id === shot.episodeId)?.title} · {shot.title}</li>)}</ul> : <p className="mt-2 text-xs leading-5 text-muted-foreground">还没有镜头引用这个资产，可在镜头设置中选择。</p>}</details></div></article>
      })}</div> : !editor && <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center"><p className="text-sm font-medium">先定义作品里需要保持一致的对象</p><p className="mt-1 text-xs leading-5 text-muted-foreground">比如主角的发型、产品的轮廓，或反复出现的场景。</p></div>}

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="creative-source-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="creative-source-title" className="text-sm font-semibold">项目参考</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">项目图片参考会用于镜头生成。新增参考不会自动改变已有结果。</p></div><button type="button" disabled={blocked || Boolean(pendingSource)} onClick={() => inputRef.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}上传参考图</button><input ref={inputRef} type="file" accept="image/*" className="hidden" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} /></div>{sources.length ? <ul className="grid min-w-0 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">{sources.map((source) => <li key={source.id} className="min-w-0 overflow-hidden rounded-lg border border-border">{source.type === 'image' || source.type === 'video' ? <MediaThumb src={stableMediaUrl(source.serverUrl || source.remoteUrl)} kind={source.type} alt="" fallback={source.title} className="aspect-video w-full" /> : <div className="flex aspect-video items-center justify-center bg-muted text-xs text-muted-foreground">{source.type === 'audio' ? '音频参考' : '文字参考'}</div>}<div className="p-3"><p className="truncate text-sm font-medium">{source.title}</p>{source.type === 'image' && <button type="button" disabled={blocked} onClick={() => setEditor({ kind: 'props', sourceId: source.id })} className="mt-2 inline-flex items-center gap-1.5 rounded-md py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"><ImageIcon className="size-3.5" aria-hidden="true" />用作身份参考</button>}</div></li>)}</ul> : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">上传角色、产品或场景图片，每张最多 20 MB。</p>}</section>
    </section>
  )
}

function NamedAssetForm({ editor, sources, project, disabled, onCancel, onSave }: { editor: AssetEditor; sources: DramaSourceAsset[]; project: DramaProject; disabled: boolean; onCancel: () => void; onSave: (value: NamedAssetSave) => Promise<void> }) {
  const existing = editor.asset
  const initialSource = sources.find((source) => source.id === editor.sourceId)
  const [id] = useState(() => existing?.id ?? `asset-${crypto.randomUUID()}`)
  const [kind, setKind] = useState<AssetKind>(editor.kind)
  const [name, setName] = useState(existing?.name || initialSource?.title.replace(/\.[^.]+$/, '') || '')
  const [description, setDescription] = useState(existing?.description || '')
  const [identity, setIdentity] = useState(existing?.profile?.visualIdentity || '')
  const [rules, setRules] = useState(existing?.profile?.consistencyRules || '')
  const references: DramaAssetReference[] = [...(existing?.references ?? [])]
  if (existing?.referenceImageUrl && !references.some((reference) => reference.url === existing.referenceImageUrl)) references.push({ id: 'legacy-primary', url: existing.referenceImageUrl, storageKey: existing.referenceStorageKey, source: 'library', label: '当前参考', createdAt: project.createdAt })
  for (const source of sources) {
    const url = stableMediaUrl(source.serverUrl || source.remoteUrl)
    if (source.type !== 'image' || !url || references.some((reference) => reference.url === url)) continue
    references.push({ id: `source:${source.id}`, url, storageKey: source.storageKey, source: 'library', label: source.title, width: source.width, height: source.height, createdAt: project.createdAt })
  }
  const [primaryId, setPrimaryId] = useState(references.find((reference) => reference.id === existing?.primaryReferenceId)?.id || (existing ? references[0]?.id : references.find((reference) => reference.url === stableMediaUrl(initialSource?.serverUrl || initialSource?.remoteUrl))?.id) || '')
  const affected = existing ? assetAffectedShots(project, existing.id) : []

  async function submit() {
    if (disabled || !name.trim()) return
    const selected = references.find((reference) => reference.id === primaryId)
    const kept = [...(existing?.references ?? [])]
    if (selected && !kept.some((reference) => reference.id === selected.id)) kept.push(selected)
    await onSave({ kind, asset: { ...existing, id, name: name.trim(), description: description.trim(), profile: { visualIdentity: identity.trim(), styling: existing?.profile?.styling || '', colorPalette: existing?.profile?.colorPalette || '', consistencyRules: rules.trim() }, references: kept, primaryReferenceId: selected?.id, referenceImageUrl: selected?.url, referenceStorageKey: selected?.storageKey } })
  }

  return <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-muted/20 p-4" aria-label={existing ? `编辑${existing.name}` : '创建身份资产'}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{existing ? '编辑身份设定' : '创建身份资产'}</h3><button type="button" disabled={disabled} onClick={onCancel} aria-label="关闭身份编辑" className="flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"><X className="size-4" aria-hidden="true" /></button></div><div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]"><label className="flex flex-col gap-1.5 text-xs text-muted-foreground">类型<select value={kind} onChange={(event) => setKind(event.target.value as AssetKind)} disabled={disabled || Boolean(existing)} className={fieldClass}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">名称<input required value={name} maxLength={120} onChange={(event) => setName(event.target.value)} disabled={disabled} className={fieldClass} placeholder="例如：山野咖啡杯" /></label></div><label className="flex flex-col gap-1.5 text-xs text-muted-foreground">描述<textarea rows={2} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} disabled={disabled} className={`${fieldClass} resize-y leading-6`} placeholder="它在作品里是什么样的对象？" /></label><label className="flex flex-col gap-1.5 text-xs text-muted-foreground">外观身份<textarea rows={2} value={identity} maxLength={4000} onChange={(event) => setIdentity(event.target.value)} disabled={disabled} className={`${fieldClass} resize-y leading-6`} placeholder="材质、轮廓、面部或场景的关键特征" /></label><label className="flex flex-col gap-1.5 text-xs text-muted-foreground">必须保持<textarea rows={2} value={rules} maxLength={4000} onChange={(event) => setRules(event.target.value)} disabled={disabled} className={`${fieldClass} resize-y leading-6`} placeholder="例如：杯身颜色、商标位置和把手比例保持一致" /></label><label className="flex flex-col gap-1.5 text-xs text-muted-foreground">主要参考图<select value={primaryId} onChange={(event) => setPrimaryId(event.target.value)} disabled={disabled} className={fieldClass}>{!existing?.references?.length && !existing?.referenceImageUrl && <option value="">暂不设置参考图</option>}{references.map((reference) => <option key={reference.id} value={reference.id}>{reference.label || '参考图片'}</option>)}</select></label>{existing && <div className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground"><p>这项设定关联 {affected.length} 个镜头。保存后用于后续生成，已采用的版本不会自动替换。</p>{affected.length > 0 && <p className="mt-1">{affected.map((shot) => `${project.episodes.find((episode) => episode.id === shot.episodeId)?.title || ''} · ${shot.title}`).join('、')}</p>}</div>}<div className="flex justify-end gap-2"><button type="button" disabled={disabled} onClick={onCancel} className="min-h-9 rounded-md border border-border px-4 text-sm hover:bg-muted disabled:opacity-50">取消</button><button type="submit" disabled={disabled || !name.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">{disabled && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}保存身份设定</button></div></form>
}
