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
import { ModelNote } from './ui'

type Draft = {
  subject: Record<string, string>
  environment: Record<string, string>
  style: Record<string, string>
  camera: Record<string, string>
  prompt: string
  negativePrompt: string
  confidence: string
}

const emptyDraft: Draft = {
  subject: { summary: '', action: '', appearance: '', wardrobe: '', props: '' },
  environment: { location: '', lighting: '', weather: '' },
  style: { medium: '', palette: '', texture: '', mood: '' },
  camera: { angle: '', composition: '', lens: '' },
  prompt: '', negativePrompt: '', confidence: '',
}

function parseDraft(raw: string): Draft {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return { ...emptyDraft, prompt: raw.trim() }
  try {
    const value = JSON.parse(match[0]) as Partial<Draft>
    const section = (key: keyof Pick<Draft, 'subject' | 'environment' | 'style' | 'camera'>) => ({ ...emptyDraft[key], ...(value[key] || {}) })
    return { subject: section('subject'), environment: section('environment'), style: section('style'), camera: section('camera'), prompt: typeof value.prompt === 'string' ? value.prompt : '', negativePrompt: typeof value.negativePrompt === 'string' ? value.negativePrompt : '', confidence: typeof value.confidence === 'string' ? value.confidence : '' }
  } catch { return { ...emptyDraft, prompt: raw.trim() } }
}

function taskText(task: any) {
  if (typeof task?.result?.content === 'string') return task.result.content
  if (typeof task?.result?.text === 'string') return task.result.text
  return ''
}

function FilePicker({ label, file, onChange, onClear, testId }: { label: string; file: File | null; onChange: (file: File | null) => void; onClear: () => void; testId: string }) {
  const preview = useMemo(() => file ? URL.createObjectURL(file) : '', [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  return <div className="rounded-xl border border-border bg-card/60 p-4">
    <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-medium">{label}</p>{file && <button type="button" aria-label={`清除${label}`} onClick={onClear} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>}</div>
    {file ? <div className="flex items-center gap-3"><img src={preview} alt="" className="size-16 rounded-lg object-cover" /><div className="min-w-0"><p className="truncate text-xs font-medium">{file.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{Math.ceil(file.size / 1024)} KB</p></div></div> : <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:border-studio-accent/60"><Upload className="size-5 text-muted-foreground" /><span className="text-xs text-muted-foreground">上传 PNG/JPG/WEBP 图片（≤24MB）</span><input data-testid={testId} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] || null)} /></label>}
  </div>
}

function DraftSection({ title, values, onChange }: { title: string; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  const labels: Record<string, string> = { summary: '摘要', action: '动作', appearance: '外观', wardrobe: '服装', props: '道具', location: '地点', lighting: '光线', weather: '天气', medium: '媒介', palette: '色彩', texture: '质感', mood: '氛围', angle: '角度', composition: '构图', lens: '镜头' }
  return <details open className="rounded-xl border border-border bg-card/40"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium"><span>{title}</span><ChevronDown className="size-4 text-muted-foreground" /></summary><div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">{Object.entries(values).map(([key, value]) => <label key={key} className="space-y-1.5"><span className="text-[11px] text-muted-foreground">{labels[key] || key}</span><textarea value={value} onChange={(event) => onChange(key, event.target.value)} rows={2} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-studio-accent/70" /></label>)}</div></details>
}

type TryOnSource = { id: string; title: string; url: string; coverUrl?: string; role?: TryOnRole }

type TryOnRole = 'person' | 'garment' | 'general'

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

function AiTryOnTool() {
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

export type CreativeTool = 'remix' | 'tryon'

export function ToolsPage({ tool = 'remix' }: { tool?: CreativeTool }) {
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8" data-testid="creative-tools-collapse">
    {tool === 'remix' ? <ImageRemixTool /> : <div data-testid="tool-ai-tryon"><AiTryOnTool /></div>}
  </div>
}

function ImageRemixTool() {
  const { state, estimateCredits } = useStudio()
  const generation = useGeneration()
  const router = useRouter()
  const textModels = useMemo(() => filterModelsByCapability(state.liveModels, 'text'), [state.liveModels])
  const imageModels = useMemo(() => filterModelsByCapability(state.liveModels, 'image'), [state.liveModels])
  const [expanded, setExpanded] = useState(true)
  const [mainFile, setMainFile] = useState<File | null>(null)
  const [styleFile, setStyleFile] = useState<File | null>(null)
  const [mainUrl, setMainUrl] = useState('')
  const [styleUrl, setStyleUrl] = useState('')
  const [analysisModel, setAnalysisModel] = useState('')
  const [imageModel, setImageModel] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [resolution, setResolution] = useState('1K')
  const [quality, setQuality] = useState('auto')
  const [mode, setMode] = useState('结构复刻')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [analysisTaskId, setAnalysisTaskId] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { if (!analysisModel && textModels[0]) setAnalysisModel(textModels[0].id) }, [analysisModel, textModels])
  useEffect(() => { if (!imageModel && imageModels.length) setImageModel(imageModels.find((model) => model.id === state.sessionSettings?.defaultModels?.imageModel)?.id ?? imageModels[0].id) }, [imageModel, imageModels, state.sessionSettings?.defaultModels?.imageModel])
  const selectedImageModel = imageModels.find((model) => model.id === imageModel) ?? imageModels[0]
  const imageRatios = useMemo(() => {
    const ratios = selectedImageModel?.capabilities.ratios ?? []
    return ratios.length ? ratios : ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9']
  }, [selectedImageModel])
  const imageResolutions = useMemo(() => {
    const resolutions = selectedImageModel?.capabilities.resolutions ?? []
    return resolutions.length ? resolutions : ['1K']
  }, [selectedImageModel])
  const imageQualities = useMemo(() => imageQualityOptions(selectedImageModel, resolution), [resolution, selectedImageModel])
  const estimatedPoints = imageModel ? estimateCredits(imageModel, { count: 1, quality }) : 0
  useEffect(() => {
    setRatio((current) => imageRatios.includes(current) ? current : imageRatios[0])
  }, [imageRatios])
  useEffect(() => {
    setResolution((current) => imageResolutions.includes(current) ? current : imageResolutions[0])
  }, [imageResolutions])
  useEffect(() => {
    setQuality((current) => imageQualities.includes(current) ? current : imageQualities[0])
  }, [imageQualities])
  useEffect(() => {
    if (!analysisTaskId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const response = await getGenerationTask('text', analysisTaskId)
        if (stopped) return
        const task = response.data.task
        if (task.status === 'success') { setDraft(parseDraft(taskText(task))); setBusy(''); setNotice('图片分析完成，请检查并编辑提示词后再提交。'); return }
        if (task.status === 'error' || task.status === 'cancelled') { setBusy(''); setNotice(task.error || '图片分析失败，请重试。'); return }
        timer = setTimeout(poll, 1800)
      } catch (error) { if (!stopped) { setBusy(''); setNotice(error instanceof Error ? error.message : '暂时无法获取任务状态。') } }
    }
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [analysisTaskId])

  const patchDraft = (section: 'subject' | 'environment' | 'style' | 'camera', key: string, value: string) => setDraft((current) => ({ ...current, [section]: { ...current[section], [key]: value } }))
  const upload = (file: File | null) => file ? uploadPersistentAsset(file, 'image') : Promise.resolve(null)
  const analyze = async () => {
    if (!mainFile) { setNotice('请先上传一张主图。'); return }
    if (!analysisModel) { setNotice('当前没有可用的文本模型，请到管理员后台配置模型。'); return }
    setBusy('uploading'); setNotice('正在安全上传图片…')
    try {
      const main = mainUrl ? { url: mainUrl } : await upload(mainFile)
      const style = styleFile ? await upload(styleFile) : (styleUrl ? { url: styleUrl } : null)
      if (!main?.url) throw new Error('主图上传失败')
      setMainUrl(main.url); if (style?.url) setStyleUrl(style.url)
      const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [{ type: 'text', text: `请按 OAOOAO 图片复刻规范分析这张图片。只返回 JSON，不要 Markdown。复刻模式：${mode}。字段必须包含 subject（summary/action/appearance/wardrobe/props）、environment（location/lighting/weather）、style（medium/palette/texture/mood）、camera（angle/composition/lens）、prompt、negativePrompt、confidence。prompt 要能直接用于图片生成，negativePrompt 写需要避免的内容。` }, { type: 'image_url', image_url: { url: main.url } }]
      if (style?.url) parts.push({ type: 'text', text: '第二张图片仅作为可选风格参考，请说明它与主图的差异。' }, { type: 'image_url', image_url: { url: style.url } })
      setBusy('analyzing'); setNotice('正在分析主体、环境和镜头…')
      const created = await generation.createText({ prompt: '', model: analysisModel, messages: [{ role: 'user', content: parts }] })
      setAnalysisTaskId(created.id)
    } catch (error) { setBusy(''); setNotice(error instanceof Error ? error.message : '图片分析失败，请重试。') }
  }
  const submit = async () => {
    if (!mainUrl || !draft.prompt.trim()) { setNotice('请上传图片并确认提示词内容。'); return }
    if (!imageModel) { setNotice('当前没有可用的图片模型。'); return }
    setBusy('submitting'); setNotice('正在提交图片生成任务…')
    try { await generation.createImage({ prompt: draft.prompt, model: imageModel, ratio, resolution, quality, kind: 'edit', references: [{ type: 'image', url: mainUrl }, ...(styleUrl ? [{ type: 'image', url: styleUrl }] : [])], surface: 'chat', title: '图片复刻' }); setBusy(''); setNotice('已提交图片生成任务。'); router.push('/works') } catch (error) { setBusy(''); setNotice(error instanceof Error ? error.message : '提交失败，请重试。') }
  }

  return <div className="space-y-6" data-testid="image-remix-tool">
    <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-studio-accent">创作工具</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">图片复刻：从参考图生成可编辑提示词</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">上传图片，使用可用的文本模型分析构图、主体和镜头；确认后提交到图片模型，结果会回到生成记录。</p></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><button type="button" data-testid="image-remix-collapse" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/30"><span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-studio-accent/12 text-studio-accent"><WandSparkles className="size-5" /></span><span><span className="block text-sm font-semibold">图片复刻</span><span className="mt-1 block text-xs text-muted-foreground">参考图 → 分析 → 编辑 → 生图</span></span></span><ChevronDown className={cn('size-5 text-muted-foreground transition-transform', expanded && 'rotate-180')} /></button>{expanded && <div className="grid gap-6 border-t border-border p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><div className="space-y-4"><FilePicker label="主图（必选）" file={mainFile} onChange={setMainFile} onClear={() => { setMainFile(null); setMainUrl('') }} testId="image-remix-upload" /><FilePicker label="可选风格参考" file={styleFile} onChange={setStyleFile} onClear={() => { setStyleFile(null); setStyleUrl('') }} testId="image-remix-style-upload" /><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><span className="text-xs text-muted-foreground">分析模型</span><span className="flex min-w-0 items-center gap-1"><select aria-label="分析模型" value={analysisModel} onChange={(e) => setAnalysisModel(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" disabled={!textModels.length}><option value="">{textModels.length ? '选择文本模型' : '暂无文本模型'}</option>{textModels.map((model) => <option key={model.id} value={model.id}>{model.shortName} · {model.creditCost} 积分/次</option>)}</select><ModelNote note={textModels.find(item => item.id === analysisModel)?.note} /></span></div><label className="space-y-1.5"><span className="text-xs text-muted-foreground">复刻模式</span><select value={mode} onChange={(e) => setMode(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option>结构复刻</option><option>参考融合</option></select></label></div><button type="button" data-testid="image-remix-analyze" onClick={() => void analyze()} disabled={Boolean(busy) || !mainFile} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">{busy === 'uploading' || busy === 'analyzing' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {busy === 'uploading' ? '正在上传…' : busy === 'analyzing' ? '正在分析…' : '分析图片'}</button>{notice && <p role="status" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">{notice}</p>}</div><div className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">分析结果（可编辑）</h2><button type="button" data-testid="image-remix-json" onClick={() => navigator.clipboard?.writeText(JSON.stringify(draft, null, 2))} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">复制 JSON</button></div><DraftSection title="主体与动作" values={draft.subject} onChange={(key, value) => patchDraft('subject', key, value)} /><DraftSection title="环境与光线" values={draft.environment} onChange={(key, value) => patchDraft('environment', key, value)} /><DraftSection title="风格与色彩" values={draft.style} onChange={(key, value) => patchDraft('style', key, value)} /><DraftSection title="构图与镜头" values={draft.camera} onChange={(key, value) => patchDraft('camera', key, value)} /><label className="block space-y-1.5"><span className="text-xs text-muted-foreground">正向提示词</span><textarea data-testid="image-remix-prompt" value={draft.prompt} onChange={(e) => setDraft((current) => ({ ...current, prompt: e.target.value }))} rows={5} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-studio-accent/70" placeholder="分析完成后会填入这里，也可以直接修改。" /></label><label className="block space-y-1.5"><span className="text-xs text-muted-foreground">负向约束</span><textarea value={draft.negativePrompt} onChange={(e) => setDraft((current) => ({ ...current, negativePrompt: e.target.value }))} rows={2} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-studio-accent/70" /></label><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-1.5"><span className="text-xs text-muted-foreground">图片模型</span><span className="flex min-w-0 items-center gap-1"><select aria-label="图片模型" data-testid="image-remix-model" value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" disabled={!imageModels.length}><option value="">{imageModels.length ? '选择图片模型' : '暂无图片模型'}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.shortName}</option>)}</select><ModelNote note={selectedImageModel?.note} /></span></div><label className="space-y-1.5"><span className="text-xs text-muted-foreground">画幅</span><select value={ratio} onChange={(e) => setRatio(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{imageRatios.map((item) => <option key={item} value={item}>{ratioLabel(item, selectedImageModel?.capabilities.outputDimensions, resolution, selectedImageModel?.capabilities.outputDimensionsByResolution)}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">清晰度</span><select value={resolution} onChange={(e) => setResolution(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{imageResolutions.map((item) => <option key={item}>{item}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">图片质量</span><select value={quality} onChange={(e) => setQuality(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{imageQualities.map((item) => <option key={item} value={item}>{qualityLabel(item, selectedImageModel?.capabilities.qualityLabels)}</option>)}</select></label></div><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{estimatedPoints > 0 ? `预计消耗 ${estimatedPoints} 积分。` : '实际消耗以提交后返回的账单为准。'}</p><button type="button" data-testid="image-remix-submit" onClick={() => void submit()} disabled={Boolean(busy) || !draft.prompt.trim() || !mainUrl} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-studio-accent px-4 text-sm font-medium text-studio-accent-foreground disabled:opacity-50 sm:w-auto">{busy === 'submitting' ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} 提交到图片模型</button></div></div></div>}</section>
  </div>
}

