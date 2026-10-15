'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ImagePlus, Loader2, Sparkles, Upload, WandSparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { filterModelsByCapability } from '@/lib/studio/studio-models'
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
    <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-medium">{label}</p>{file && <button type="button" aria-label={`�Ƴ�${label}`} onClick={onClear} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>}</div>
    {file ? <div className="flex items-center gap-3"><img src={preview} alt="" className="size-16 rounded-lg object-cover" /><div className="min-w-0"><p className="truncate text-xs font-medium">{file.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{Math.ceil(file.size / 1024)} KB</p></div></div> : <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:border-studio-accent/60"><Upload className="size-5 text-muted-foreground" /><span className="text-xs text-muted-foreground">���������ͼƬ��PNG/JPG/WEBP��24MB �ڣ�</span><input data-testid={testId} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] || null)} /></label>}
  </div>
}

function DraftSection({ title, values, onChange }: { title: string; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  const labels: Record<string, string> = { summary: '����', action: '����', appearance: '���', wardrobe: '����', props: '����', location: '�ص�', lighting: '����', weather: '����', medium: 'ý��', palette: 'ɫ��', texture: '�ʸ�', mood: '����', angle: '�ӽ�', composition: '��ͼ', lens: '��ͷ' }
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
  const [quality, setQuality] = useState('auto')
  const [mode, setMode] = useState('���̹�ͼ')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [analysisTaskId, setAnalysisTaskId] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { if (!analysisModel && textModels[0]) setAnalysisModel(textModels[0].id) }, [analysisModel, textModels])
  useEffect(() => { if (!imageModel && imageModels[0]) setImageModel(imageModels[0].id) }, [imageModel, imageModels])
  useEffect(() => {
    if (!analysisTaskId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const response = await getGenerationTask('text', analysisTaskId)
        if (stopped) return
        const task = response.data.task
        if (task.status === 'success') { setDraft(parseDraft(taskText(task))); setBusy(''); setNotice('������ɣ����鲢�༭��ʾ�ʺ����ύ��'); return }
        if (task.status === 'error' || task.status === 'cancelled') { setBusy(''); setNotice(task.error || 'ͼƬ����ʧ�ܣ������ԡ�'); return }
        timer = setTimeout(poll, 1800)
      } catch (error) { if (!stopped) { setBusy(''); setNotice(error instanceof Error ? error.message : '��ʱ�޷���ȡ����״̬��') } }
    }
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [analysisTaskId])

  const patchDraft = (section: 'subject' | 'environment' | 'style' | 'camera', key: string, value: string) => setDraft((current) => ({ ...current, [section]: { ...current[section], [key]: value } }))
  const upload = (file: File | null) => file ? uploadPersistentAsset(file, 'image') : Promise.resolve(null)
  const analyze = async () => {
    if (!mainFile) { setNotice('�����ϴ�һ����ͼ��'); return }
    if (!analysisModel) { setNotice('��ǰû�п��õ��ı�ģ�ͣ������ڹ���Ա��̨����ģ�͡�'); return }
    setBusy('uploading'); setNotice('���ڰ�ȫ�ϴ�ͼƬ��')
    try {
      const main = mainUrl ? { url: mainUrl } : await upload(mainFile)
      const style = styleFile ? await upload(styleFile) : (styleUrl ? { url: styleUrl } : null)
      if (!main?.url) throw new Error('��ͼ�ϴ�ʧ��')
      setMainUrl(main.url); if (style?.url) setStyleUrl(style.url)
      const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [{ type: 'text', text: `���� OAOOAO ��ͼƬ���̷������֡�������ο�ͼ����ֻ���� JSON����Ҫ Markdown��ģʽ��${mode}���ֶα������ subject��summary/action/appearance/wardrobe/props����environment��location/lighting/weather����style��medium/palette/texture/mood����camera��angle/composition/lens����prompt��negativePrompt��confidence��prompt Ҫ��ֱ������ͼƬ���ɣ�negativePrompt д��Ҫ��������ݡ�` }, { type: 'image_url', image_url: { url: main.url } }]
      if (style?.url) parts.push({ type: 'text', text: '��������ͼֻ������ѡ���ο�����ֱ�������ͼ�Ĳ��졣' }, { type: 'image_url', image_url: { url: style.url } })
      setBusy('analyzing'); setNotice('���ڷ������塢���������;�ͷ��')
      const created = await generation.createText({ prompt: '', model: analysisModel, messages: [{ role: 'user', content: parts }] })
      setAnalysisTaskId(created.id)
    } catch (error) { setBusy(''); setNotice(error instanceof Error ? error.message : 'ͼƬ����ʧ�ܣ������ԡ�') }
  }
  const submit = async () => {
    if (!mainUrl || !draft.prompt.trim()) { setNotice('�������ͼƬ��������ȷ����ʾ�����ݡ�'); return }
    if (!imageModel) { setNotice('��ǰû�п��õ�ͼƬģ�͡�'); return }
    setBusy('submitting'); setNotice('�����ύͼƬ��������')
    try { await generation.createImage({ prompt: draft.prompt, model: imageModel, ratio, quality, kind: 'edit', references: [{ type: 'image', url: mainUrl }, ...(styleUrl ? [{ type: 'image', url: styleUrl }] : [])], surface: 'chat', title: 'ͼƬ����' }); setBusy(''); setNotice('���ύ����ͼ������С�'); router.push('/works') } catch (error) { setBusy(''); setNotice(error instanceof Error ? error.message : '�ύʧ�ܣ������ԡ�') }
  }

  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8" data-testid="image-remix-tool">
    <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-studio-accent">������</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">�Ѳο�ͼ��ɿɱ༭��������ʾ��</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">�ϴ�ͼƬ���������õ��ı�ģ�ͷ�����������޸ķ��������ȷ�Ϻ����ύ������ͼƬģ�ͣ����ֺ�����״̬���ù���̨����</p></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><button type="button" data-testid="image-remix-collapse" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/30"><span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-studio-accent/12 text-studio-accent"><WandSparkles className="size-5" /></span><span><span className="block text-sm font-semibold">ͼƬ����</span><span className="mt-1 block text-xs text-muted-foreground">�ο�ͼ �� ���� �� �༭ �� ��ͼ</span></span></span><ChevronDown className={cn('size-5 text-muted-foreground transition-transform', expanded && 'rotate-180')} /></button>{expanded && <div className="grid gap-6 border-t border-border p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><div className="space-y-4"><FilePicker label="��ͼ����ѡ��" file={mainFile} onChange={setMainFile} onClear={() => { setMainFile(null); setMainUrl('') }} testId="image-remix-upload" /><FilePicker label="��ѡ���ο�" file={styleFile} onChange={setStyleFile} onClear={() => { setStyleFile(null); setStyleUrl('') }} testId="image-remix-style-upload" /><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-xs text-muted-foreground">����ģ��</span><select value={analysisModel} onChange={(e) => setAnalysisModel(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" disabled={!textModels.length}><option value="">{textModels.length ? 'ѡ���ı�ģ��' : '�����ı�ģ��'}</option>{textModels.map((model) => <option key={model.id} value={model.id}>{model.shortName} �� {model.creditCost} ����/��</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">����ģʽ</span><select value={mode} onChange={(e) => setMode(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option>���̹�ͼ</option><option>�ο����</option></select></label></div><button type="button" data-testid="image-remix-analyze" onClick={() => void analyze()} disabled={Boolean(busy) || !mainFile} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">{busy === 'uploading' || busy === 'analyzing' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {busy === 'uploading' ? '�����ϴ���' : busy === 'analyzing' ? '���ڷ�����' : '����ͼƬ'}</button>{notice && <p role="status" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">{notice}</p>}</div><div className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">����������ɱ༭��</h2><button type="button" data-testid="image-remix-json" onClick={() => navigator.clipboard?.writeText(JSON.stringify(draft, null, 2))} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">���� JSON</button></div><DraftSection title="�����붯��" values={draft.subject} onChange={(key, value) => patchDraft('subject', key, value)} /><DraftSection title="���������" values={draft.environment} onChange={(key, value) => patchDraft('environment', key, value)} /><DraftSection title="�����ɫ��" values={draft.style} onChange={(key, value) => patchDraft('style', key, value)} /><DraftSection title="��ͼ�뾵ͷ" values={draft.camera} onChange={(key, value) => patchDraft('camera', key, value)} /><label className="block space-y-1.5"><span className="text-xs text-muted-foreground">������ʾ��</span><textarea data-testid="image-remix-prompt" value={draft.prompt} onChange={(e) => setDraft((current) => ({ ...current, prompt: e.target.value }))} rows={5} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-studio-accent/70" placeholder="������ɺ����������Ҳ����ֱ���޸ġ�" /></label><label className="block space-y-1.5"><span className="text-xs text-muted-foreground">����Լ��</span><textarea value={draft.negativePrompt} onChange={(e) => setDraft((current) => ({ ...current, negativePrompt: e.target.value }))} rows={2} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-studio-accent/70" /></label><div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1.5"><span className="text-xs text-muted-foreground">ͼƬģ��</span><select data-testid="image-remix-model" value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" disabled={!imageModels.length}><option value="">{imageModels.length ? 'ѡ��ͼƬģ��' : '����ͼƬģ��'}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.shortName}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">����</span><select value={ratio} onChange={(e) => setRatio(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option>1:1</option><option>16:9</option><option>9:16</option><option>4:5</option></select></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">����</span><select value={quality} onChange={(e) => setQuality(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option>auto</option><option>low</option><option>medium</option><option>high</option></select></label></div><button type="button" data-testid="image-remix-submit" onClick={() => void submit()} disabled={Boolean(busy) || !draft.prompt.trim() || !mainUrl} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-studio-accent px-4 text-sm font-medium text-studio-accent-foreground disabled:opacity-50">{busy === 'submitting' ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} �ύ��ͼƬģ��</button></div></div>}</section>
  </div>
}

