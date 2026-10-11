'use client'

import { memo, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { AudioLines, Clapperboard, Copy, Download, FileText, Image as ImageIcon, Loader2, RotateCcw, SlidersHorizontal, Sparkles, Square, Star, AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStudio } from '@/lib/studio/store'
import { filterModelsByCapability } from '@/lib/studio/studio-models'
import { useCanvasActions } from '../canvas-context'
import { useCanvasStore } from '../canvas-store'
import { NODE_SIZE } from '../node-factory'
import type { GenerationFlowNode, GenerationKind, GenerationNodeData, NodeResult, TaskPhase } from '../types'
import { NodeAnchors, NodeHandles, settingsPlacementFor, TitleEditor } from './node-kit'
import { GenerationSettings } from './generation-settings'

const KIND_ICON = { image: ImageIcon, video: Clapperboard, text: FileText, audio: AudioLines } satisfies Record<GenerationKind, typeof ImageIcon>

const PLACEHOLDER: Record<GenerationKind, string> = {
  image: '描述想生成的画面，可配合参考素材使用',
  video: '描述镜头内容、动作与节奏',
  text: '输入创作要求，例如文案方向、字数与语气',
  audio: '输入需要朗读或生成的内容',
}

const PHASE_LABEL: Record<TaskPhase | 'idle', string> = {
  idle: '待生成',
  queued: '排队中',
  running: '生成中',
  success: '已完成',
  error: '失败',
  cancelled: '已取消',
}

export const GenerationNode = memo(function GenerationNode({ id, data, selected }: NodeProps<GenerationFlowNode>) {
  const { state } = useStudio()
  const actions = useCanvasActions()
  const settingsPlacement = useCanvasStore((store) => (store.settingsNodeId === id ? store.settingsPlacement : null))
  const focusRequested = useCanvasStore((store) => store.focusNodeId === id)
  const clearFocus = useCanvasStore((store) => store.clearFocus)
  const openSettings = useCanvasStore((store) => store.openSettings)
  const updateNodeData = useCanvasStore((store) => store.updateNodeData)
  const beginEdit = useCanvasStore((store) => store.beginEdit)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!focusRequested) return
    textareaRef.current?.focus()
    clearFocus()
  }, [focusRequested, clearFocus])

  const Icon = KIND_ICON[data.kind]
  const phase: TaskPhase | 'idle' = data.task?.phase ?? 'idle'
  const busy = phase === 'queued' || phase === 'running'
  const modelName = data.model
    ? filterModelsByCapability(state.models, capabilityOf(data.kind)).find((model) => model.id === data.model)?.shortName ?? '指定模型'
    : '自动模型'
  const estimate = actions.estimateNode(data)
  const canSubmit = data.prompt.trim().length > 0 && !busy

  const handleSettingsClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    openSettings(settingsPlacement ? null : id, settingsPlacementFor(event.currentTarget))
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (canSubmit) void actions.submitNode(id)
    }
  }

  return (
    <div className="group relative" style={{ width: NODE_SIZE.generation.width }} data-selected={selected} data-node-kind={data.kind}>
      <NodeHandles />
      <NodeAnchors nodeId={id} />
      <article
        className={cn(
          'flex flex-col gap-3 rounded-2xl border bg-neutral-950 p-3 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] transition-colors',
          selected || settingsPlacement ? 'border-white' : 'border-white/15 hover:border-white/35',
        )}
      >
        <header className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
          <TitleEditor nodeId={id} title={data.title} />
          <span className="ml-auto shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300" aria-live="polite">
            {PHASE_LABEL[phase]}
          </span>
          <button
            type="button"
            aria-label="节点配置"
            aria-expanded={Boolean(settingsPlacement)}
            onClick={handleSettingsClick}
            onPointerDown={(event) => event.stopPropagation()}
            className="nodrag flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          </button>
        </header>

        <NodeResultArea id={id} data={data} phase={phase} />

        <div className="nodrag nowheel flex flex-col gap-2.5 rounded-xl border border-white/10 bg-black p-2.5 focus-within:border-white/50">
          <textarea
            ref={textareaRef}
            value={data.prompt}
            rows={2}
            aria-label="提示词"
            placeholder={PLACEHOLDER[data.kind]}
            onFocus={() => beginEdit()}
            onChange={(event) => updateNodeData(id, { prompt: event.target.value })}
            onKeyDown={handlePromptKeyDown}
            className="nodrag nowheel min-h-11 w-full resize-none bg-transparent text-sm leading-relaxed text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[11px] text-neutral-500">
              {modelName}
              {data.kind === 'image' || data.kind === 'video' ? ` · ${data.ratio}` : ''}
              {' · '}
              {estimate > 0 ? `约 ${estimate} 积分` : '按实际计费'}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {busy ? (
                <>
                  {data.task?.id ? (
                    <button type="button" onClick={() => void actions.checkNode(id)} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs text-neutral-300 hover:bg-white/10">
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                      检查
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void actions.cancelNode(id)} disabled={!data.task?.id} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs text-white hover:bg-white/10 disabled:opacity-40">
                    <Square className="size-3 fill-current" aria-hidden="true" />
                    取消
                  </button>
                </>
              ) : phase === 'error' ? (
                <button type="button" onClick={() => void actions.submitNode(id)} disabled={!canSubmit} className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-40">
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  重试
                </button>
              ) : (
                <button type="button" onClick={() => void actions.submitNode(id)} disabled={!canSubmit} className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-40">
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
                  {data.results.length || data.text ? '再次生成' : '生成'}
                </button>
              )}
            </div>
          </div>
        </div>
      </article>
      {settingsPlacement ? <GenerationSettings nodeId={id} placement={settingsPlacement} /> : null}
    </div>
  )
})

function capabilityOf(kind: GenerationKind) {
  return kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'text'
}

function NodeResultArea({ id, data, phase }: { id: string; data: GenerationNodeData; phase: TaskPhase | 'idle' }) {
  const actions = useCanvasActions()

  if (phase === 'queued' || phase === 'running') {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03]" role="status">
        <div className="h-px w-2/3 overflow-hidden bg-white/10">
          <div className="h-full w-1/2 animate-pulse bg-white" />
        </div>
        <p className="text-xs text-neutral-400">正在生成，可随时取消</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div role="alert" className="flex gap-2.5 rounded-xl border border-white/25 bg-white/[0.04] p-3 text-xs leading-relaxed text-neutral-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-white" aria-hidden="true" />
        <p className="min-w-0 break-words">{data.task?.error || '生成失败，可以调整后重试'}</p>
      </div>
    )
  }

  if (data.kind === 'text' && data.text) {
    return (
      <div className="flex flex-col gap-2">
        <div className="nowheel max-h-44 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/50 p-3 text-sm leading-relaxed text-neutral-100">
          {data.text}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(data.text)} className="nodrag flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-neutral-400 hover:bg-white/10 hover:text-white">
            <Copy className="size-3.5" aria-hidden="true" />
            复制文本
          </button>
        </div>
      </div>
    )
  }

  if (data.results.length) {
    return (
      <div className={cn('grid gap-2', data.results.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {data.results.map((result, index) => (
          <ResultItem key={`${result.url}-${index}`} nodeId={id} title={data.title} result={result} index={index} onFavorite={() => void actions.saveResultToLibrary(id, index)} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-white/15 px-6 text-center text-xs leading-relaxed text-neutral-500">
      输入提示词后生成，结果会回写到这个节点
    </div>
  )
}

function ResultItem({ title, result, index, onFavorite }: { nodeId: string; title: string; result: NodeResult; index: number; onFavorite: () => void }) {
  const label = `${title} 结果 ${index + 1}`
  return (
    <figure className="nodrag relative overflow-hidden rounded-xl border border-white/10 bg-black">
      {result.mediaKind === 'image' ? (
        <img src={result.url} alt={label} loading="lazy" decoding="async" draggable={false} className="block w-full object-cover" />
      ) : result.mediaKind === 'video' ? (
        <video src={result.url} poster={result.poster} controls playsInline preload="metadata" aria-label={label} className="nowheel block w-full bg-black" />
      ) : (
        <div className="flex items-center gap-3 p-3">
          <AudioLines className="size-5 shrink-0 text-neutral-400" aria-hidden="true" />
          <audio src={result.url} controls preload="none" aria-label={label} className="nowheel min-w-0 flex-1" />
        </div>
      )}
      <figcaption className="absolute right-2 bottom-2 flex gap-1">
        <button type="button" aria-label={`收藏${label}`} title="收藏到资产库" onClick={onFavorite} className="flex size-7 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-white hover:text-black">
          <Star className="size-3.5" aria-hidden="true" />
        </button>
        <a href={result.url} download aria-label={`下载${label}`} title="下载" className="flex size-7 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-white hover:text-black">
          <Download className="size-3.5" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  )
}
