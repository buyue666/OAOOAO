'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ImagePlus, Loader2, Shirt, Sparkles, Upload, UserRound, WandSparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { filterModelsByCapability, imageQualityOptions, qualityLabel, ratioLabel } from '@/lib/studio/studio-models'
import { getGenerationTask, normalizeTaskResult } from '@/lib/studio/generation-api'
import { createLibraryAsset, uploadPersistentAsset } from '@/lib/studio/account-api'
import { useLibraryAssets } from '@/lib/studio/use-account-data'
import { libraryAssetMediaUrl } from '@/lib/studio/reference-assets'
import { cn } from '@/lib/utils'
import { ModelNote } from '../ui'

type TryOnRole = 'person' | 'garment' | 'general'
type TryOnSource = { id: string; title: string; url: string; coverUrl?: string; role?: TryOnRole }

const tryOnPrompt = `Dress the person in the first reference image in the garment from the second reference image. Keep the person's identity, face, hairstyle, body proportions, pose, background, and lighting consistent. Preserve the garment's exact color, fabric, pattern, neckline, sleeve length, hemline, and silhouette. Make the fit and folds physically natural. Output one photorealistic fashion image and nothing else.`

function tryOnRoleOf(asset: Parameters<typeof libraryAssetMediaUrl>[0]): TryOnRole {
  const data = (asset.data ?? {}) as Record<string, unknown>
  const raw = String(data.assetRole ?? data.category ?? '').toLowerCase()
  if (raw === 'character' || raw === 'person' || raw === 'model' || asset.tags?.some((tag) => ['模特', '人物', '角色'].includes(tag))) return 'person'
  if (raw === 'garment' || raw === 'clothing' || raw === 'outfit' || asset.tags?.some((tag) => ['服装', '衣服', '穿搭'].includes(tag))) return 'garment'
  return 'general'
}

function sourceFromLibrary(asset: Parameters<typeof libraryAssetMediaUrl>[0]): TryOnSource | null {
  const url = libraryAssetMediaUrl(asset)
  if (!url) return null
  return { id: asset.id, title: asset.title || '未命名素材', url, coverUrl: asset.coverUrl, role: tryOnRoleOf(asset) }
}

function roleLabel(role: TryOnRole | undefined) {
  return role === 'person' ? '模特' : role === 'garment' ? '服装' : '未分类'
}

function roleMatches(source: TryOnSource, requested: Exclude<TryOnRole, 'general'>) {
  return source.role === requested || source.role === 'general'
}

function SourcePicker({
  label,
  icon,
  source,
  assets,
  loading,
  emptyText,
  onSelect,
  onUpload,
  onClear,
}: {
  label: string
  icon: ReactNode
  source: TryOnSource | null
  assets: TryOnSource[]
  loading: boolean
  emptyText: string
  onSelect: (source: TryOnSource) => void
  onUpload: (file: File) => void
  onClear: () => void
}) {
  const [tab, setTab] = useState<'library' | 'upload'>('library')
  return <section className="rounded-2xl border border-border bg-card/60 p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-studio-accent/12 text-studio-accent">{icon}</span><div><p className="text-sm font-semibold">{label}</p><p className="text-[11px] text-muted-foreground">从素材库选择，或上传并保存</p></div></div>
      {source && <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">清除选择</button>}
    </div>
    {source ? <div className="mt-4 flex items-center gap-3 rounded-xl border border-studio-accent/35 bg-studio-accent/5 p-3"><img src={source.coverUrl || source.url} alt="" className="size-16 rounded-lg object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{source.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">已选为{label}</p></div><Check className="size-4 text-studio-accent" aria-hidden="true" /></div> : <>
      <div className="mt-4 flex gap-1 rounded-lg bg-muted/60 p-1"><button type="button" onClick={() => setTab('library')} className={cn('flex-1 rounded-md px-3 py-2 text-xs font-medium', tab === 'library' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>从素材库选择</button><button type="button" onClick={() => setTab('upload')} className={cn('flex-1 rounded-md px-3 py-2 text-xs font-medium', tab === 'upload' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>上传图片</button></div>
      {tab === 'library' ? <div className="mt-3"><div className="grid grid-cols-4 gap-2 sm:grid-cols-5">{loading ? <div className="col-span-full rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">正在读取素材库…</div> : assets.length ? assets.slice(0, 10).map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)} title={item.title} className="group overflow-hidden rounded-lg border border-border bg-background text-left transition hover:border-studio-accent/70"><img src={item.coverUrl || item.url} alt={item.title} className="aspect-square w-full object-cover" /><span className="flex items-center justify-between gap-1 px-1.5 py-1"><span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">{item.title}</span><span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">{roleLabel(item.role)}</span></span></button>) : <div className="col-span-full rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</div>}</div>{assets.length > 10 && <p className="mt-2 text-[11px] text-muted-foreground">已展示最近 10 个匹配素材，可到创作资产中管理全部素材。</p>}<p className="mt-2 text-[11px] text-muted-foreground">未分类图片也会显示，可在创作资产中修改素材分类。</p></div> : <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-7 text-center hover:border-studio-accent/60"><Upload className="size-5 text-muted-foreground" /><span className="text-xs text-muted-foreground">上传 PNG / JPG / WEBP（≤24MB）</span><input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = '' }} /></label>}
    </>}
  </section>
}

export default function AiTryOnTool() {
  const { state, estimateCredits } = useStudio()
  const generation = useGeneration()
  const router = useRouter()
  const imageLibrary = useLibraryAssets({ kind: 'image', pageSize: 60 })
  const { assets: libraryAssets, state: libraryState, reload: reloadLibrary } = imageLibrary
  const imageModels = useMemo(() => filterModelsByCapability(state.liveModels, 'image'), [state.liveModels])
  const [imageModel, setImageModel] = useState('')
  const [personSource, setPersonSource] = useState<TryOnSource | null>(null)
  const [garmentSource, setGarmentSource] = useState<TryOnSource | null>(null)
  const [ratio, setRatio] = useState('2:3')
  const [resolution, setResolution] = useState('1K')
  const [quality, setQuality] = useState('auto')
  const [count, setCount] = useState('1')
  const [presetPrompt, setPresetPrompt] = useState(tryOnPrompt)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [modelPrompt, setModelPrompt] = useState('一名普通身材的亚洲男性模特，全身站立，正面，简洁浅色背景，光线均匀，适合用于虚拟换装。')
  const [modelTaskId, setModelTaskId] = useState('')

  useEffect(() => { if (!imageModel && imageModels.length) setImageModel(imageModels.find((model) => model.id === state.sessionSettings?.defaultModels?.imageModel)?.id ?? imageModels[0].id) }, [imageModel, imageModels, state.sessionSettings?.defaultModels?.imageModel])
  const selectedImageModel = imageModels.find((model) => model.id === imageModel) ?? imageModels[0]
  const ratios = useMemo(() => selectedImageModel?.capabilities.ratios?.length ? selectedImageModel.capabilities.ratios : ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16'], [selectedImageModel])
  const resolutions = useMemo(() => selectedImageModel?.capabilities.resolutions?.length ? selectedImageModel.capabilities.resolutions : ['1K'], [selectedImageModel])
  const qualities = useMemo(() => imageQualityOptions(selectedImageModel, resolution), [resolution, selectedImageModel])
  useEffect(() => { setRatio((value) => ratios.includes(value) ? value : ratios[0]) }, [ratios])
  useEffect(() => { setResolution((value) => resolutions.includes(value) ? value : resolutions[0]) }, [resolutions])
  useEffect(() => { setQuality((value) => qualities.includes(value) ? value : qualities[0]) }, [qualities])
  const librarySources = useMemo(() => libraryAssets.map(sourceFromLibrary).filter((item): item is TryOnSource => Boolean(item)), [libraryAssets])
  const personSources = useMemo(() => librarySources.filter((source) => roleMatches(source, 'person')), [librarySources])
  const garmentSources = useMemo(() => librarySources.filter((source) => roleMatches(source, 'garment')), [librarySources])
  const maxCount = Math.max(1, Math.min(4, selectedImageModel?.capabilities.maxBatchSize ?? 1))
  const countOptions = useMemo(() => Array.from({ length: maxCount }, (_, index) => String(index + 1)), [maxCount])
  const estimatedPoints = imageModel ? estimateCredits(imageModel, { count: Number(count), quality }) : 0
  const estimatedModelPoints = imageModel ? estimateCredits(imageModel, { count: 1, quality }) : 0
  useEffect(() => { setCount((value) => countOptions.includes(value) ? value : countOptions[countOptions.length - 1]) }, [countOptions])

  useEffect(() => {
    if (!modelTaskId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const response = await getGenerationTask('image', modelTaskId)
        if (stopped) return
        const task = response.data.task
        if (task.status === 'success') {
          const media = normalizeTaskResult('image', task.result).media[0]
          if (!media?.url) throw new Error('模特生成完成，但没有可用图片结果。')
          const saved = await createLibraryAsset({ kind: 'image', title: 'AI 模特', tags: ['AI换装', '模特'], source: 'ai-try-on', data: { serverUrl: media.url, assetRole: 'character' } })
          const source = sourceFromLibrary(saved)
          if (source) setPersonSource(source)
          await reloadLibrary()
          setBusy(''); setModelTaskId(''); setNotice('模特已生成并保存到创作资产。')
          return
        }
        if (task.status === 'error' || task.status === 'cancelled') { setBusy(''); setModelTaskId(''); setNotice(task.error || '模特生成失败，请重试。'); return }
        timer = setTimeout(poll, 1800)
      } catch (error) { if (!stopped) { setBusy(''); setModelTaskId(''); setNotice(error instanceof Error ? error.message : '暂时无法获取模特任务状态。') } }
    }
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [modelTaskId, reloadLibrary])

  const uploadSource = async (file: File, role: 'person' | 'garment') => {
    setBusy(role === 'person' ? 'upload-person' : 'upload-garment'); setNotice('正在上传并保存素材…')
    try {
      const stored = await uploadPersistentAsset(file, 'image')
      const saved = await createLibraryAsset({ kind: 'image', title: file.name.replace(/\.[^.]+$/, '') || '未命名素材', tags: ['AI换装', role === 'person' ? '模特' : '服装'], source: 'ai-try-on', data: { storageKey: stored.key, serverUrl: stored.url, assetRole: role === 'person' ? 'character' : 'garment' } })
      const source = sourceFromLibrary(saved)
      if (source) role === 'person' ? setPersonSource(source) : setGarmentSource(source)
      await reloadLibrary()
      setBusy(''); setNotice('素材已保存并选中。')
    } catch (error) { setBusy(''); setNotice(error instanceof Error ? error.message : '素材上传失败，请重试。') }
  }

  const generateModel = async () => {
    if (!imageModel) { setNotice('当前没有可用的图片模型。'); return }
    setBusy('generate-model'); setNotice('正在提交模特生成任务…')
    try {
      const task = await generation.createImage({ prompt: modelPrompt.trim(), model: imageModel, ratio: '2:3', resolution, quality, count: 1, title: 'AI 模特', surface: 'chat' })
      setModelTaskId(task.id); setNotice('模特生成中，完成后会自动保存到创作资产。')
    } catch (error) { setBusy(''); setNotice(error instanceof Error ? error.message : '模特生成提交失败，请重试。') }
  }

  const submit = async () => {
    if (!personSource || !garmentSource) { setNotice('请选择模特和服装素材。'); return }
    if (!imageModel) { setNotice('当前没有可用的图片模型。'); return }
    if (!presetPrompt.trim() && !prompt.trim()) { setNotice('请填写换装要求，或保留预置提示词。'); return }
    setBusy('submit'); setNotice('正在提交 AI 换装任务…')
    try {
      await generation.createImage({ prompt: [presetPrompt.trim(), prompt.trim(), 'Reference 1 is the person. Reference 2 is the garment.'].filter(Boolean).join('\n\n'), model: imageModel, ratio, resolution, quality, count: Number(count), kind: 'edit', references: [{ name: personSource.title, type: 'image', url: personSource.url, role: 'reference' }, { name: garmentSource.title, type: 'image', url: garmentSource.url, role: 'reference' }], title: 'AI换装', surface: 'chat' })
      setBusy(''); setNotice('已提交 AI 换装任务。'); router.push('/works')
    } catch (error) { setBusy(''); setNotice(error instanceof Error ? error.message : '换装任务提交失败，请重试。') }
  }

  return <div className="space-y-6" data-testid="ai-tryon-tool">
    <div><h1 className="text-2xl font-semibold tracking-tight">AI 换装</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">选择模特和服装素材，使用现有图片模型生成虚拟试穿结果。上传素材会自动保存到创作资产。</p></div>
    <section className="grid gap-4 lg:grid-cols-2"><SourcePicker label="模特" icon={<UserRound className="size-4" />} source={personSource} assets={personSources} loading={libraryState === 'loading'} emptyText="素材库里还没有模特图片，可上传或生成一张" onSelect={setPersonSource} onUpload={(file) => void uploadSource(file, 'person')} onClear={() => setPersonSource(null)} /><SourcePicker label="服装" icon={<Shirt className="size-4" />} source={garmentSource} assets={garmentSources} loading={libraryState === 'loading'} emptyText="素材库里还没有服装图片，可直接上传" onSelect={setGarmentSource} onUpload={(file) => void uploadSource(file, 'garment')} onClear={() => setGarmentSource(null)} /></section>
    <section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">生成模特</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">没有合适人物图时，可以先生成一张模特图；完成后会自动保存到创作资产并选中。</p></div><Sparkles className="size-5 text-studio-accent" aria-hidden="true" /></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><textarea value={modelPrompt} onChange={(event) => setModelPrompt(event.target.value)} rows={2} className="min-h-10 flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-studio-accent/70" /><button type="button" onClick={() => void generateModel()} disabled={Boolean(busy) || !modelPrompt.trim()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">{busy === 'generate-model' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} 生成模特{estimatedModelPoints > 0 && <span className="text-xs text-muted-foreground">· {estimatedModelPoints} 积分</span>}</button></div></section>
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">换装要求</h2>
      <p id="tryon-requirements-hint" className="mt-1 text-xs leading-5 text-muted-foreground">默认保留人物身份、姿势、背景和服装细节，可以继续输入补充要求。</p>
      <label className="mt-4 block space-y-1.5">
        <span className="text-xs font-medium">补充要求（选填）</span>
        <textarea data-testid="ai-tryon-requirements" aria-describedby="tryon-requirements-hint" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="例如：让衣服更合身，保留原图背景。" className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-studio-accent/70 focus-visible:ring-2 focus-visible:ring-studio-accent/20" />
      </label>
      <details data-testid="ai-tryon-preset" className="group mt-3 rounded-lg border border-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60 [&::-webkit-details-marker]:hidden">
          <span>预置提示词</span>
          <span className="flex items-center gap-1.5"><span className="group-open:hidden">展开</span><span className="hidden group-open:inline">收起</span><ChevronDown className="size-3.5 motion-safe:transition-transform group-open:rotate-180" aria-hidden="true" /></span>
        </summary>
        <label className="block border-t border-border p-3">
          <span className="sr-only">编辑预置提示词</span>
          <textarea data-testid="ai-tryon-preset-prompt" value={presetPrompt} onChange={(event) => setPresetPrompt(event.target.value)} rows={5} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-6 outline-none focus:border-studio-accent/70 focus-visible:ring-2 focus-visible:ring-studio-accent/20" />
        </label>
      </details>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><div className="space-y-1.5 lg:col-span-2"><span className="text-xs text-muted-foreground">图片模型</span><span className="flex min-w-0 items-center gap-1"><select aria-label="图片模型" value={imageModel} onChange={(event) => setImageModel(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" disabled={!imageModels.length}><option value="">{imageModels.length ? '选择图片模型' : '暂无图片模型'}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.shortName} · {model.creditCost} 积分/次</option>)}</select><ModelNote note={selectedImageModel?.note} /></span></div><label className="space-y-1.5"><span className="text-xs text-muted-foreground">画幅</span><select value={ratio} onChange={(event) => setRatio(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{ratios.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">清晰度</span><select value={resolution} onChange={(event) => setResolution(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{resolutions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">图片质量</span><select value={quality} onChange={(event) => setQuality(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{qualities.map((item) => <option key={item} value={item}>{qualityLabel(item, selectedImageModel?.capabilities.qualityLabels)}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">生成数量</span><select value={count} onChange={(event) => setCount(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{countOptions.map((item) => <option key={item} value={item}>{item} 张</option>)}</select></label></div><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">模特和服装会作为两张参考图提交，结果进入生成记录。{estimatedPoints > 0 ? ` 预计消耗 ${estimatedPoints} 积分。` : '实际消耗以提交后返回的账单为准。'}</p><button type="button" data-testid="ai-tryon-submit" onClick={() => void submit()} disabled={Boolean(busy) || !personSource || !garmentSource || !(presetPrompt.trim() || prompt.trim())} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-studio-accent px-5 text-sm font-medium text-studio-accent-foreground disabled:opacity-50">{busy === 'submit' ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} 开始 AI 换装</button></div>{notice && <p role="status" className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">{notice}</p>}</section>
  </div>
}

