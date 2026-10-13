'use client'

import type { RefObject } from 'react'
import { useId } from 'react'
import { ArrowRight, Check, ChevronDown, LoaderCircle } from 'lucide-react'
import type { ModelConfig } from '@/lib/studio/types'
import { cn } from '@/lib/utils'
import { ModelIcon } from './model-icon'

type CreateMode = 'agent' | 'image' | 'video' | 'text'

const fieldClass = 'h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm tabular-nums text-foreground outline-none transition-colors duration-150 focus-visible:border-studio-accent focus-visible:ring-2 focus-visible:ring-studio-accent/25'

/** 导演 Agent 与文本模式没有固定积分，因此用文字说明任务与计费方式。 */
const directorNotes: Partial<Record<CreateMode, { task: string; cost: string }>> = {
  agent: {
    task: '描述目标与约束，导演 Agent 会拆解为文案、分镜与素材步骤，并按顺序执行。',
    cost: '只有实际执行的生成步骤会扣减积分，积分随所用模型与参数变化。',
  },
  text: {
    task: '输入要撰写、改写或总结的内容，结果会在导演 Agent 对话中返回。',
    cost: '按实际生成的文本步骤计费，开始前不显示固定积分。',
  },
}

/** 从「5 秒」「8s」这类文本里取出秒数；无法识别时返回 null。 */
export function parseSeconds(value?: string | null) {
  const match = value?.match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

export type GenerationPanelProps = {
  mode: CreateMode
  selectedModel?: ModelConfig
  modelOptions: ModelConfig[]
  groupedModels: Record<string, ModelConfig[]>
  dropdownOpen: boolean
  pickerRef: RefObject<HTMLDivElement | null>
  onToggleDropdown: () => void
  onSelectModel: (id: string) => void
  ratioOptions: string[]
  ratio: string
  onRatioChange: (value: string) => void
  qualityOptions: string[]
  quality: string
  onQualityChange: (value: string) => void
  durationOptions: string[]
  durationRange: { min: number; max: number } | null
  fixedDuration: string | null
  seconds: number
  onSecondsChange: (value: number) => void
  onSecondsCommit: () => void
  estimatedCredits: number | null
  canStart: boolean
  starting: boolean
  startError: string
}

/**
 * 生成设置条：模型与参数紧贴创作描述，「预计消耗」与「开始创作」在同一行收尾。
 * 模型下拉以绝对定位展开；外层没有 overflow 裁切，因此可以越过输入区边界。
 */
export function GenerationPanel(props: GenerationPanelProps) {
  const { mode, estimatedCredits, canStart, starting, startError } = props
  const hasModelControls = mode === 'image' || mode === 'video'
  const modelUnavailable = hasModelControls && !props.selectedModel
  const note = directorNotes[mode]
  const gridClass = mode === 'video'
    ? 'xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]'
    : 'xl:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]'

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-muted/40 p-4 sm:p-5">
      {hasModelControls ? (
        <div className={cn('grid gap-3 sm:grid-cols-2', gridClass)}>
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 xl:col-span-1">
            <span className="text-xs font-medium text-muted-foreground">模型</span>
            <ModelPicker {...props} />
          </div>
          <ParamSelect label="比例" value={props.ratio} options={props.ratioOptions} onChange={props.onRatioChange} />
          <ParamSelect label="清晰度" value={props.quality} options={props.qualityOptions} onChange={props.onQualityChange} />
          {mode === 'video' && (
            <DurationControl
              durationOptions={props.durationOptions}
              durationRange={props.durationRange}
              fixedDuration={props.fixedDuration}
              seconds={props.seconds}
              onSecondsChange={props.onSecondsChange}
              onSecondsCommit={props.onSecondsCommit}
            />
          )}
        </div>
      ) : (
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">任务说明</dt>
            <dd className="leading-6 text-foreground">{note?.task}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">消耗逻辑</dt>
            <dd className="leading-6 text-foreground">{note?.cost}</dd>
          </div>
        </dl>
      )}

      {startError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive">{startError}</p>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">预计消耗</p>
          {modelUnavailable ? <p className="mt-0.5 text-sm font-medium text-foreground">模型配置完成后可估算</p> : estimatedCredits !== null ? (
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-xl font-semibold tabular-nums text-foreground">{estimatedCredits.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">积分 · 按当前模型与参数估算</span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm font-medium text-foreground">按实际执行计费</p>
          )}
          {modelUnavailable ? <p className="mt-1 text-xs leading-5 text-muted-foreground" role="status">当前暂无可用模型，请联系管理员配置后再试。</p> : !canStart && <p className="mt-1 text-xs leading-5 text-muted-foreground">输入创作描述或添加参考素材后即可开始。</p>}
        </div>

        <button
          type="submit"
          disabled={starting || !canStart || modelUnavailable}
          aria-busy={starting || undefined}
          className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md bg-foreground px-6 text-sm font-semibold text-background transition-colors duration-150 hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground sm:w-auto sm:min-w-[168px]"
        >
          {starting ? (
            <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在进入工作台…</>
          ) : (
            <>开始创作<ArrowRight className="size-4" aria-hidden="true" /></>
          )}
        </button>
      </div>
    </div>
  )
}

function ModelPicker({ selectedModel, modelOptions, groupedModels, dropdownOpen, pickerRef, onToggleDropdown, onSelectModel }: GenerationPanelProps) {
  const listId = useId()
  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        onClick={onToggleDropdown}
        aria-label="选择模型"
        aria-expanded={dropdownOpen}
        aria-haspopup="listbox"
        aria-controls={dropdownOpen ? listId : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!dropdownOpen) onToggleDropdown()
            requestAnimationFrame(() => pickerRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus())
          }
        }}
        className="flex h-12 w-full min-w-0 items-center gap-2.5 rounded-md border border-border bg-background px-3 text-left transition-colors duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/40"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-studio-accent"><ModelIcon model={selectedModel} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{selectedModel ? selectedModel.shortName || selectedModel.name : modelOptions.length ? '选择模型' : '暂无可用模型'}</span>
          {selectedModel && <span className="block truncate text-xs text-muted-foreground">{selectedModel.provider || '可用模型'}</span>}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-150', dropdownOpen && 'rotate-180')} aria-hidden="true" />
      </button>

      {dropdownOpen && (
        <div
          role="listbox"
          id={listId}
          aria-label="可选模型"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onToggleDropdown(); pickerRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus(); return }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
            const index = options.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            options[next]?.focus()
          }}
          className="lg-glass-overlay motion-panel absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(440px,60dvh)] min-w-0 overflow-y-auto overscroll-contain rounded-lg border border-border p-1.5 text-left shadow-[var(--lg-shadow-4)]"
        >
          {modelOptions.length ? Object.entries(groupedModels).map(([provider, items]) => (
            <div key={provider} className="border-b border-border/70 pb-1 last:border-b-0 last:pb-0">
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{provider}</p>
              {items.map((item) => {
                const selected = selectedModel?.id === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onSelectModel(item.id)}
                    className={cn('flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none', selected && 'bg-studio-accent/10')}
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-studio-accent"><ModelIcon model={item} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                        {selected && <Check className="size-3.5 shrink-0 text-studio-accent" aria-hidden="true" />}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">{item.description || '当前可用模型'}</span>
                      <span className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {item.capabilities.ratios.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{item.capabilities.ratios.slice(0, 3).join(' / ')}</span>}
                        {item.capabilities.durations.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{item.capabilities.durations.slice(0, 3).join(' / ')}</span>}
                        <span className="rounded bg-studio-accent/10 px-1.5 py-0.5 text-studio-accent">{item.creditCost || 0} 积分起</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )) : <div className="px-3 py-4 text-xs leading-5 text-muted-foreground">当前模式暂无可用模型，请检查后台渠道配置。</div>}
        </div>
      )}
    </div>
  )
}

function ParamSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select value={value} disabled={!options.length} onChange={(event) => onChange(event.target.value)} className={cn(fieldClass, 'disabled:text-muted-foreground')}>
        {!options.length && <option value="">暂无可用选项</option>}
        {options.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}

function DurationControl({
  durationOptions,
  durationRange,
  fixedDuration,
  seconds,
  onSecondsChange,
  onSecondsCommit,
}: {
  durationOptions: string[]
  durationRange: { min: number; max: number } | null
  fixedDuration: string | null
  seconds: number
  onSecondsChange: (value: number) => void
  onSecondsCommit: () => void
}) {
  if (fixedDuration) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">时长</span>
        <span className="flex h-10 items-center rounded-md border border-border bg-muted px-3 text-sm tabular-nums text-foreground">{fixedDuration}</span>
      </div>
    )
  }

  if (durationRange) {
    return (
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">时长（秒）</span>
        <span className="flex items-center gap-2">
          <input
            type="number"
            min={durationRange.min}
            max={durationRange.max}
            step={1}
            value={seconds}
            onChange={(event) => onSecondsChange(Number(event.target.value))}
            onBlur={onSecondsCommit}
            className={cn(fieldClass, 'w-24')}
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">{durationRange.min}–{durationRange.max} 秒</span>
        </span>
      </label>
    )
  }

  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">时长</span>
      <select
        value={durationOptions.find((item) => parseSeconds(item) === seconds) ?? durationOptions[0]}
        disabled={!durationOptions.length}
        onChange={(event) => onSecondsChange(parseSeconds(event.target.value) ?? seconds)}
        className={fieldClass}
      >
        {!durationOptions.length && <option value="">模型默认</option>}
        {durationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}
