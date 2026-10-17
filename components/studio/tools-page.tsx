'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ImagePlus, Loader2, Sparkles, Upload, WandSparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { filterModelsByCapability, imageQualityOptions, qualityLabel, ratioLabel } from '@/lib/studio/studio-models'
import { getGenerationTask } from '@/lib/studio/generation-api'
import { uploadPersistentAsset } from '@/lib/studio/account-api'
import { cn } from '@/lib/utils'

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

export function ToolsPage() {
  const { state } = useStudio()
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
  useEffect(() => { if (!imageModel && imageModels[0]) setImageModel(imageModels[0].id) }, [imageModel, imageModels])
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

  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8" data-testid="image-remix-tool">
    <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-studio-accent">创作工具</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">图片复刻：从参考图生成可编辑提示词</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">上传图片，使用可用的文本模型分析构图、主体和镜头；确认后提交到图片模型，结果会回到生成记录。</p></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><button type="button" data-testid="image-remix-collapse" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/30"><span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-studio-accent/12 text-studio-accent"><WandSparkles className="size-5" /></span><span><span className="block text-sm font-semibold">图片复刻</span><span className="mt-1 block text-xs text-muted-foreground">参考图 → 分析 → 编辑 → 生图</span></span></span><ChevronDown className={cn('size-5 text-muted-foreground transition-transform', expanded && 'rotate-180')} /></button>{expanded && <div className="grid gap-6 border-t border-border p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><div className="space-y-4"><FilePicker label="主图（必选）" file={mainFile} onChange={setMainFile} onClear={() => { setMainFile(null); setMainUrl('') }} testId="image-remix-upload" /><FilePicker label="可选风格参考" file={styleFile} onChange={setStyleFile} onClear={() => { setStyleFile(null); setStyleUrl('') }} testId="image-remix-style-upload" /><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-xs text-muted-foreground">分析模型</span><select value={analysisModel} onChange={(e) => setAnalysisModel(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" disabled={!textModels.length}><option value="">{textModels.length ? '选择文本模型' : '暂无文本模型'}</option>{textModels.map((model) => <option key={model.id} value={model.id}>{model.shortName} · {model.creditCost} 积分/次</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">复刻模式</span><select value={mode} onChange={(e) => setMode(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option>结构复刻</option><option>参考融合</option></select></label></div><button type="button" data-testid="image-remix-analyze" onClick={() => void analyze()} disabled={Boolean(busy) || !mainFile} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">{busy === 'uploading' || busy === 'analyzing' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {busy === 'uploading' ? '正在上传…' : busy === 'analyzing' ? '正在分析…' : '分析图片'}</button>{notice && <p role="status" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">{notice}</p>}</div><div className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">分析结果（可编辑）</h2><button type="button" data-testid="image-remix-json" onClick={() => navigator.clipboard?.writeText(JSON.stringify(draft, null, 2))} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">复制 JSON</button></div><DraftSection title="主体与动作" values={draft.subject} onChange={(key, value) => patchDraft('subject', key, value)} /><DraftSection title="环境与光线" values={draft.environment} onChange={(key, value) => patchDraft('environment', key, value)} /><DraftSection title="风格与色彩" values={draft.style} onChange={(key, value) => patchDraft('style', key, value)} /><DraftSection title="构图与镜头" values={draft.camera} onChange={(key, value) => patchDraft('camera', key, value)} /><label className="block space-y-1.5"><span className="text-xs text-muted-foreground">正向提示词</span><textarea data-testid="image-remix-prompt" value={draft.prompt} onChange={(e) => setDraft((current) => ({ ...current, prompt: e.target.value }))} rows={5} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-studio-accent/70" placeholder="分析完成后会填入这里，也可以直接修改。" /></label><label className="block space-y-1.5"><span className="text-xs text-muted-foreground">负向约束</span><textarea value={draft.negativePrompt} onChange={(e) => setDraft((current) => ({ ...current, negativePrompt: e.target.value }))} rows={2} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-studio-accent/70" /></label><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="space-y-1.5"><span className="text-xs text-muted-foreground">图片模型</span><select data-testid="image-remix-model" value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" disabled={!imageModels.length}><option value="">{imageModels.length ? '选择图片模型' : '暂无图片模型'}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.shortName}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">画幅</span><select value={ratio} onChange={(e) => setRatio(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{imageRatios.map((item) => <option key={item} value={item}>{ratioLabel(item, selectedImageModel?.capabilities.outputDimensions, resolution, selectedImageModel?.capabilities.outputDimensionsByResolution)}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">清晰度</span><select value={resolution} onChange={(e) => setResolution(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{imageResolutions.map((item) => <option key={item}>{item}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">图片质量</span><select value={quality} onChange={(e) => setQuality(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{imageQualities.map((item) => <option key={item} value={item}>{qualityLabel(item, selectedImageModel?.capabilities.qualityLabels)}</option>)}</select></label></div><button type="button" data-testid="image-remix-submit" onClick={() => void submit()} disabled={Boolean(busy) || !draft.prompt.trim() || !mainUrl} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-studio-accent px-4 text-sm font-medium text-studio-accent-foreground disabled:opacity-50">{busy === 'submitting' ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} 提交到图片模型</button></div></div>}</section>
  </div>
}

