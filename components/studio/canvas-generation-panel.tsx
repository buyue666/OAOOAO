'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, Coins, Image as ImageIcon, Loader2, Paperclip, Sparkles, Type, Video, X } from 'lucide-react'
import type { Node as FlowNode } from '@xyflow/react'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { defaultModelFor, filterModelsByCapability, qualityLabel } from '@/lib/studio/studio-models'
import { publishReferenceAsset } from '@/lib/studio/generation-api'
import type { AgentRun, GenerationTaskView } from '@/lib/studio/generation-types'
import type { Asset, AssetCategory, CanvasNodeData, ModelConfig } from '@/lib/studio/types'
import { assetCategoryLabels } from '@/lib/studio/reference-assets'
import { cn } from '@/lib/utils'
import { IconAction, MediaThumb } from './ui'

type CanvasGenerationMode = 'image' | 'video' | 'text' | 'agent'

export type CanvasCreatedGeneration = {
  task: GenerationTaskView
  mode: 'image' | 'video'
  prompt: string
  model: string
  ratio: string
  quality: string
  seconds?: number
  referenceUrls: string[]
}

export type CanvasCreatedText = {
  task: GenerationTaskView
  prompt: string
  model: string
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('文件读取失败'))
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

function secondsOf(value: string) {
  const match = value.match(/\d+(?:\.\d+)?/)
  const seconds = match ? Number(match[0]) : 0
  return Number.isFinite(seconds) ? seconds : 0
}

function taskStatusLabel(task: GenerationTaskView) {
  if (task.status === 'success') return '已完成'
  if (task.status === 'error') return '生成失败'
  if (task.status === 'cancelled') return '已取消'
  return '生成中'
}

function GlassPicker({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof globalThis.Node) || !ref.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape) }
  }, [open])
  const current = options.find((option) => option.value === value)?.label || value || '自动'
  return (
    <div ref={ref} className="oao-canvas-picker">
      <span className="oao-canvas-control-label">{label}</span>
      <button type="button" className="oao-canvas-glass-select" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((state) => !state)}>
        <span className="truncate">{current}</span><ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="oao-canvas-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={cn('oao-canvas-select-option', option.value === value && 'is-selected')} onClick={() => { onChange(option.value); setOpen(false) }}>
              <span>{option.label}</span>{option.value === value && <Check className="size-3.5" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function CanvasGenerationPanel({
  projectId,
  selectedNode,
  availableAssets,
  initialMode = 'image',
  anchor,
  onClose,
  onCreated,
  onTextCreated,
  onAgentCreated,
}: {
  projectId: string
  selectedNode?: FlowNode<CanvasNodeData>
  availableAssets: Asset[]
  initialMode?: CanvasGenerationMode
  anchor?: { left: number; top: number; width: number }
  onClose: () => void
  onCreated: (created: CanvasCreatedGeneration) => void
  onTextCreated: (created: CanvasCreatedText) => void
  onAgentCreated: (run: AgentRun, prompt: string) => void
}) {
  const { state, estimateCredits } = useStudio()
  const generation = useGeneration()
  const [mode, setMode] = useState<CanvasGenerationMode>(initialMode)
  const [prompt, setPrompt] = useState(selectedNode?.data.content || selectedNode?.data.prompt || selectedNode?.data.detail || '')
  const [modelId, setModelId] = useState('')
  const [ratio, setRatio] = useState('')
  const [quality, setQuality] = useState('')
  const [seconds, setSeconds] = useState(8)
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [assetCategory, setAssetCategory] = useState<AssetCategory | 'all'>('all')
  const [uploads, setUploads] = useState<Array<{ name: string; type: 'image' | 'video'; dataUrl: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const sourceModels = state.liveModels.length ? state.liveModels : state.models
  const lockedMode: CanvasGenerationMode | null = selectedNode?.data.kind === 'task'
    ? 'agent'
    : selectedNode?.data.kind === 'image' || selectedNode?.data.kind === 'video' || selectedNode?.data.kind === 'text'
      ? selectedNode.data.kind
      : null
  const modeLocked = Boolean(lockedMode)
  const models = useMemo<ModelConfig[]>(() => mode === 'agent' ? [] : filterModelsByCapability(sourceModels, mode), [mode, sourceModels])
  const selectedModel = models.find((item) => item.id === modelId) ?? models[0]
  const capabilities = selectedModel?.capabilities
  const assets = useMemo(() => availableAssets.filter((asset) => asset.src && (asset.kind === 'image' || asset.kind === 'video')).slice(0, 24), [availableAssets])
  const filteredAssets = useMemo(() => assetCategory === 'all' ? assets : assets.filter((asset) => (asset.category ?? 'general') === assetCategory), [assetCategory, assets])
  const maxReferences = Math.max(1, capabilities?.maxReferences ?? 4)
  const ratios = capabilities?.ratios.length ? capabilities.ratios : mode === 'video' ? ['16:9', '9:16', '1:1'] : ['1:1', '16:9', '9:16']
  const qualities = capabilities?.qualities.length ? capabilities.qualities : mode === 'video' ? ['720', '1080'] : ['auto', 'high']
  const durations = capabilities?.durations.length ? capabilities.durations : ['5 秒', '8 秒', '10 秒']
  const estimatedCredits = selectedModel ? estimateCredits(selectedModel.id, { quality, duration: `${seconds} 秒` }) : 0
  const modeLabel = mode === 'image' ? '图片生成' : mode === 'video' ? '视频生成' : mode === 'text' ? '文本生成' : 'Agent 任务'

  useEffect(() => {
    setMode(lockedMode ?? initialMode)
    setPrompt(selectedNode?.data.content || selectedNode?.data.prompt || (selectedNode?.data.kind === 'text' ? selectedNode.data.detail : ''))
    setAssetIds([])
  }, [initialMode, lockedMode, selectedNode?.id])

  useEffect(() => {
    const fallback = defaultModelFor(mode === 'agent' ? 'text' : mode, state.sessionSettings, models)
    const nextModel = models.some((item) => item.id === modelId) ? modelId : fallback
    setModelId(nextModel)
    const next = models.find((item) => item.id === nextModel)
    const nextRatio = next?.capabilities.ratios[0] || (mode === 'video' ? '16:9' : '1:1')
    const nextQuality = next?.capabilities.qualities[0] || (mode === 'video' ? '720' : 'auto')
    setRatio((current) => next?.capabilities.ratios.includes(current) ? current : nextRatio)
    setQuality((current) => next?.capabilities.qualities.includes(current) ? current : nextQuality)
    const nextSeconds = next?.capabilities.durations[0] ? secondsOf(next.capabilities.durations[0]) : mode === 'video' ? 8 : 0
    if (nextSeconds) setSeconds(nextSeconds)
  }, [mode, models, modelId, state.sessionSettings])

  function toggleAsset(asset: Asset) {
    setAssetIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : current.length >= maxReferences ? current : [...current, asset.id])
  }

  async function addFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter((file) => file.type.startsWith('image/') || (mode === 'video' && file.type.startsWith('video/'))).slice(0, Math.max(0, maxReferences - uploads.length))
    if (!accepted.length) return
    const next = await Promise.all(accepted.map(async (file) => ({ name: file.name, type: file.type.startsWith('video/') ? 'video' as const : 'image' as const, dataUrl: await readDataUrl(file) })))
    setUploads((current) => [...current, ...next])
  }

  async function resolveReferences() {
    const urls: string[] = []
    if (selectedNode?.data.src) urls.push(selectedNode.data.src)
    for (const asset of assets.filter((item) => assetIds.includes(item.id))) urls.push(asset.src)
    for (const upload of uploads) urls.push(await publishReferenceAsset(upload.type, upload.dataUrl))
    return Array.from(new Set(urls)).slice(0, maxReferences)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!prompt.trim() || submitting) return
    setSubmitting(true); setError('')
    try {
      if (mode === 'agent') {
        const run = await generation.runAgent({ prompt: prompt.trim(), surface: 'canvas', projectId, assetIds })
        onAgentCreated(run, prompt.trim())
        return
      }
      if (mode === 'text') {
        const task = await generation.createText({ prompt: prompt.trim(), model: selectedModel?.id })
        onTextCreated({ task, prompt: prompt.trim(), model: selectedModel?.id || '' })
        return
      }
      const referenceUrls = await resolveReferences()
      if (mode === 'image') {
        const task = await generation.createImage({ prompt: prompt.trim(), model: selectedModel?.id, ratio, quality, kind: referenceUrls.length ? 'edit' : 'generation', referenceUrls, projectId, surface: 'canvas' })
        onCreated({ task, mode, prompt: prompt.trim(), model: selectedModel?.id || '', ratio, quality, referenceUrls })
      } else {
        const task = await generation.createVideo({ prompt: prompt.trim(), model: selectedModel?.id, ratio, quality, seconds, references: referenceUrls.map((url) => ({ url, type: 'image' })), projectId, surface: 'canvas' })
        onCreated({ task, mode, prompt: prompt.trim(), model: selectedModel?.id || '', ratio, quality, seconds, referenceUrls })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成任务创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <aside className="oao-canvas-generation-panel oao-canvas-generation-composer oao-canvas-generation-node-card" data-canvas-no-zoom style={anchor ? { left: anchor.left, top: anchor.top, width: anchor.width } : undefined} aria-label="画布内生成面板">
      <div className="oao-canvas-generation-header">
        <div className="oao-canvas-generation-title"><span className="oao-canvas-generation-title-icon">{mode === 'image' ? <ImageIcon aria-hidden="true" /> : mode === 'video' ? <Video aria-hidden="true" /> : mode === 'text' ? <Type aria-hidden="true" /> : <Bot aria-hidden="true" />}</span><div className="min-w-0"><p className="oao-canvas-panel-kicker">画布内创作</p><h2>{selectedNode ? `编辑${modeLabel}` : '创建生成节点'}</h2></div></div>
        <div className="oao-canvas-generation-header-actions">{selectedNode && <span className="oao-canvas-generation-target" title={selectedNode.data.title}>{selectedNode.data.title}</span>}<IconAction label="关闭生成面板" onClick={onClose}><X aria-hidden="true" /></IconAction></div>
      </div>
      <div className="oao-canvas-generation-scroll">
        {modeLocked ? <div className="oao-canvas-generation-locked"><span>节点类型</span><strong>{mode === 'image' ? '图片生成' : mode === 'video' ? '视频生成' : mode === 'text' ? '文本生成' : 'Agent 任务'}</strong><small>当前节点类型已锁定，避免把图片、视频和文本参数混在一起。</small></div> : <div className="oao-canvas-generation-tabs" role="tablist" aria-label="生成类型">
          {([['image', '图片', ImageIcon], ['video', '视频', Video], ['text', '文本', Type], ['agent', 'Agent', Bot]] as const).map(([value, label, Icon]) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={cn('oao-canvas-generation-tab', mode === value && 'is-active')} onClick={() => setMode(value)}><Icon aria-hidden="true" />{label}</button>)}
        </div>}
        <form onSubmit={submit} className="oao-canvas-generation-form flex flex-col gap-4">
          <label className="oao-canvas-generation-field"><span>创作描述</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === 'agent' ? '告诉 Agent 你要完成什么创作…' : '描述这个节点要生成的画面或镜头…'} rows={3} /></label>
          {mode !== 'agent' && (
            <div className="oao-canvas-generation-controls">
              <GlassPicker label="模型" value={selectedModel?.id || ''} options={models.map((item) => ({ value: item.id, label: `${item.shortName} · ${item.creditCost || 0} 积分` }))} onChange={setModelId} />
              {mode !== 'text' && <><GlassPicker label="比例" value={ratio} options={ratios.map((item) => ({ value: item, label: item }))} onChange={setRatio} /><GlassPicker label="清晰度" value={quality} options={qualities.map((item) => ({ value: item, label: `${item} · ${qualityLabel(item)}` }))} onChange={setQuality} /></>}
              {mode === 'video' && <GlassPicker label="时长" value={`${seconds} 秒`} options={durations.map((item) => ({ value: item, label: item }))} onChange={(value) => setSeconds(secondsOf(value) || 8)} />}
            </div>
          )}
          {(mode === 'image' || mode === 'video' || mode === 'agent') && (
            <section className="oao-canvas-reference-section">
              <div className="flex items-center justify-between gap-2"><div><p className="oao-canvas-control-label">我的资产</p><p className="mt-1 text-[10px] text-[var(--canvas-muted)]">角色、场景和生成结果只从你的资产库读取</p></div><span className="text-[10px] text-[var(--canvas-muted)]">{Math.min(maxReferences, assetIds.length + uploads.length + (selectedNode?.data.src ? 1 : 0))}/{maxReferences}</span></div>
              {assets.length > 0 && <>
                <div className="oao-canvas-asset-filters" role="tablist" aria-label="资产分类">
                  {(['all', 'character', 'scene', 'prop', 'general'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={assetCategory === value} className={cn(assetCategory === value && 'is-active')} onClick={() => setAssetCategory(value)}>{value === 'all' ? '全部' : assetCategoryLabels[value]}</button>)}
                </div>
                {filteredAssets.length > 0 ? <div className="oao-canvas-reference-grid">{filteredAssets.slice(0, 8).map((asset) => <button key={asset.id} type="button" className={cn('oao-canvas-reference-item', assetIds.includes(asset.id) && 'is-selected')} onClick={() => toggleAsset(asset)} aria-pressed={assetIds.includes(asset.id)}><MediaThumb src={asset.src} poster={asset.poster} alt={asset.title} fallback={asset.title} kind={asset.kind === 'video' ? 'video' : 'image'} className="h-12 w-full rounded-md" /><span className="truncate">{asset.title}</span>{assetIds.includes(asset.id) && <Check className="absolute right-1 top-1 size-3.5" aria-hidden="true" />}</button>)}</div> : <p className="oao-canvas-panel-empty">这个分类还没有资产。</p>}
              </>}
              <label className="oao-canvas-upload-control"><Paperclip className="size-3.5" aria-hidden="true" /><span>拖入或选择参考文件</span><input type="file" multiple accept={mode === 'video' ? 'image/*,video/*' : 'image/*'} onChange={(event) => { void addFiles(event.target.files ?? []); event.currentTarget.value = '' }} /></label>
              {uploads.length > 0 && <div className="flex flex-wrap gap-1.5">{uploads.map((upload, index) => <span key={`${upload.name}-${index}`} className="oao-canvas-reference-chip">{upload.name}</span>)}</div>}
            </section>
          )}
          {mode === 'agent' && <div className="oao-canvas-agent-hint"><Sparkles className="size-4" aria-hidden="true" /><span>Agent 会在当前画布创建任务，并根据画布节点、素材和你的描述拆解后续步骤。</span></div>}
          {error && <p className="oao-canvas-generation-error" role="alert">{error}</p>}
          <div className="oao-canvas-generation-submit"><span><Coins className="size-3.5" aria-hidden="true" />{mode === 'agent' ? '提交后按 Agent 任务计费' : estimatedCredits ? `预计 ${estimatedCredits} 积分` : '费用以后端返回为准'}</span><button type="submit" disabled={!prompt.trim() || submitting} className="oao-canvas-generate-button">{submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}{submitting ? '提交中' : '开始生成'}</button></div>
        </form>
      </div>
    </aside>
  )
}
