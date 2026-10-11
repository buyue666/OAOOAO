'use client'

import type { RefObject } from 'react'
import { ArrowRight, Check, ChevronDown, LoaderCircle } from 'lucide-react'
import type { ModelConfig } from '@/lib/studio/types'
import { cn } from '@/lib/utils'
import { ModelIcon } from './model-icon'

type CreateMode = 'agent' | 'image' | 'video' | 'text' | 'drama'

const controlClass = 'h-9 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-sm tabular-nums text-foreground outline-none transition-colors duration-150 focus-visible:border-studio-accent focus-visible:ring-2 focus-visible:ring-studio-accent/25'

/** 导演 Agent 与文本模式没有可预估的固定积分，因此用文字说明任务与计费方式。 */
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

export type GenerationPanelProps = {
  mode: CreateMode
  modeLabel: string
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
  estimatedCredits: number | null
  starting: boolean
  canStart: boolean
  startError: string
  className?: string
}

/**
 * 生成设置：模型与参数在上，「预计消耗」与「开始创作」在下相邻排列。
 * 面板不裁切内容，模型下拉以浮层展开，可以越过面板边界。
 */
export function GenerationPanel(props: GenerationPanelProps) {
  const { mode, modeLabel, estimatedCredits, starting, canStart, startError, className } = props
  const hasModelControls = mode !== 'text' && mode !== 'agent'
  const note = directorNotes[mode]

  return (
    <aside aria-labelledby="generation-settings-title" className={cn('studio-surface flex flex-col lg:sticky lg:top-20', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 id="generation-settings-title" className="text-base font-semibold text-foreground">生成设置</h2>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{modeLabel}</span>
      </header>

      <div className="flex flex-col gap-5 p-5">
        {hasModelControls ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">模型</span>
              <ModelPicker {...props} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {props.ratioOptions.length > 0 && (
                <ParamSelect label="比例" value={props.ratio} options={props.ratioOptions} onChange={props.onRatioChange} />
              )}
              {props.qualityOptions.length > 0 && (
                <ParamSelect label="清晰度" value={props.quality} options={props.qualityOptions} onChange={props.onQualityChange} />
              )}
              {mode === 'video' && (
                <DurationControl
                  className="col-span-2"
                  durationOptions={props.durationOptions}
                  durationRange={props.durationRange}
                  fixedDuration={props.fixedDuration}
                  seconds={props.seconds}
                  onSecondsChange={props.onSecondsChange}
                />
              )}
            </div>
          </>
        ) : (
          <dl className="flex flex-col gap-4 text-sm">
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
      </div>

      <footer className="flex flex-col gap-3 border-t border-border p-5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-medium text-muted-foreground">预计消耗</span>
            {estimatedCredits !== null ? (
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{estimatedCredits.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground">积分</span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm font-medium text-foreground">按实际执行计费</p>
            )}
          </div>
          {estimatedCredits !== null && <p className="max-w-[8.5rem] text-right text-[11px] leading-4 text-muted-foreground">按当前模型与参数估算</p>}
        </div>

        {!canStart && <p className="text-xs leading-5 text-muted-foreground">先输入创作描述或添加参考素材，即可开始。</p>}
        {startError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{startError}</p>
        )}

        <button
          type="submit"
          disabled={starting || !canStart}
          aria-busy={starting || undefined}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background transition-colors duration-150 hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {starting ? (
            <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在进入工作台…</>
          ) : (
            <>开始创作<ArrowRight className="size-4" aria-hidden="true" /></>
          )}
        </button>
        <p className="text-[11px] leading-5 text-muted-foreground">提交后进入对应创作工作台，描述与参考素材会一并带入。</p>
      </footer>
    </aside>
  )
}

function ModelPicker({ selectedModel, modelOptions, groupedModels, dropdownOpen, pickerRef, onToggleDropdown, onSelectModel }: GenerationPanelProps) {
  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        onClick={onToggleDropdown}
        aria-label="选择模型"
        aria-expanded={dropdownOpen}
        aria-haspopup="listbox"
        className="flex h-12 w-full min-w-0 items-center gap-2.5 rounded-lg border border-border bg-background px-3 text-left transition-colors duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/40"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-studio-accent"><ModelIcon model={selectedModel} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{selectedModel ? selectedModel.shortName || selectedModel.name : '选择模型'}</span>
          {selectedModel && <span className="block truncate text-[11px] text-muted-foreground">{selectedModel.provider || '可用模型'}</span>}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-150', dropdownOpen && 'rotate-180')} aria-hidden="true" />
      </button>

      {dropdownOpen && (
        <div
          role="listbox"
          aria-label="可选模型"
          className="lg-glass-overlay motion-panel absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(440px,60dvh)] overflow-y-auto rounded-lg border border-border p-1.5 text-left shadow-[var(--lg-shadow-4)]"
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
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description || '当前可用模型'}</span>
                      <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
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
      <select value={value} onChange={(event) => onChange(event.target.value)} className={controlClass}>
        {options.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}

function DurationControl({
  className,
  durationOptions,
  durationRange,
  fixedDuration,
  seconds,
  onSecondsChange,
}: {
  className?: string
  durationOptions: string[]
  durationRange: { min: number; max: number } | null
  fixedDuration: string | null
  seconds: number
  onSecondsChange: (value: number) => void
}) {
  if (fixedDuration) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <span className="text-xs font-medium text-muted-foreground">时长</span>
        <span className="flex h-9 items-center rounded-md border border-border bg-muted px-2.5 text-sm tabular-nums text-foreground">{fixedDuration}</span>
      </div>
    )
  }

  if (durationRange) {
    return (
      <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <span className="text-xs font-medium text-muted-foreground">时长（秒）</span>
        <span className="flex items-center gap-2">
          <input
            type="number"
            min={durationRange.min}
            max={durationRange.max}
            step={1}
            value={seconds}
            onChange={(event) => onSecondsChange(Number(event.target.value))}
            onBlur={() => onSecondsChange(Math.min(durationRange.max, Math.max(durationRange.min, Number.isFinite(seconds) ? seconds : durationRange.min)))}
            className={cn(controlClass, 'w-24')}
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">{durationRange.min}–{durationRange.max} 秒</span>
        </span>
      </label>
    )
  }

  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-muted-foreground">时长</span>
      <select
        value={`${seconds} 秒`}
        onChange={(event) => onSecondsChange(Number(event.target.value.match(/\d+(?:\.\d+)?/)?.[0] || 8))}
        className={controlClass}
      >
        {durationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}
