'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import type { RefObject } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, Bot, Check, ChevronDown, Clapperboard, Clock, Image as ImageIcon, LoaderCircle, Puzzle, Ratio, SlidersHorizontal, Sparkles, Video } from 'lucide-react'
import type { ModelConfig } from '@/lib/studio/types'
import { cn } from '@/lib/utils'
import { ModelIcon } from './model-icon'
import { ModelNote, ModelSubscriptionBadge } from './ui'

type CreateMode = 'agent' | 'image' | 'video' | 'text'

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
  formatRatio?: (value: string) => string
  resolutionOptions?: string[]
  resolution?: string
  onResolutionChange?: (value: string) => void
  qualityOptions: string[]
  quality: string
  onQualityChange: (value: string) => void
  formatQuality?: (value: string) => string
  durationOptions: string[]
  durationRange: { min: number; max: number } | null
  fixedDuration: string | null
  seconds: number
  onSecondsChange: (value: number) => void
  onSecondsCommit: () => void
  estimatedCredits: number | null
  creditNote?: string
  compatibilityNote?: string
  submitLabel?: string
  directHref?: string
  directLabel?: string
  hideSkillsLink?: boolean
  canStart: boolean
  starting: boolean
  startError: string
}

/**
 * 底部集成式控制栏：参数胶囊、模型选择与圆形发送按钮收束在同一个创作台底栏内，
 * 不再用大块灰色页脚和原生表单框割裂输入体验。
 */
export function GenerationPanel(props: GenerationPanelProps) {
  const tx = useUiText()
  const {
    mode,
    estimatedCredits,
    creditNote,
    compatibilityNote,
    submitLabel,
    directHref,
    directLabel,
    hideSkillsLink,
    canStart,
    starting,
    startError,
  } = props
  const hasModelControls = mode === 'image' || mode === 'video'
  const showResolution = mode === 'image' && (props.resolutionOptions?.length ?? 0) > 1 && Boolean(props.onResolutionChange)
  const modelUnavailable = hasModelControls && !props.selectedModel

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-3.5 pt-1.5 sm:px-5 sm:pb-4">
      {compatibilityNote && (
        <p role="status" className="rounded-xl border border-border bg-muted/50 px-3 py-1.5 text-xs leading-5 text-muted-foreground">
          {compatibilityNote}
        </p>
      )}

      {startError && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs leading-5 text-destructive">
          {startError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {hasModelControls ? (
            <>
              <CapsuleSelect
                icon={<Ratio className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                label={tx('比例')}
                value={props.ratio}
                options={props.ratioOptions}
                onChange={props.onRatioChange}
                formatOption={props.formatRatio}
              />
              {showResolution && (
                <CapsuleSelect
                  icon={<SlidersHorizontal className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                  label={tx('分辨率')}
                  value={props.resolution ?? props.resolutionOptions![0]}
                  options={props.resolutionOptions!}
                  onChange={props.onResolutionChange!}
                />
              )}
              <CapsuleSelect
                label={tx('清晰度')}
                value={props.quality}
                options={props.qualityOptions}
                onChange={props.onQualityChange}
                formatOption={props.formatQuality}
              />
              {mode === 'video' && (
                <DurationCapsule
                  durationOptions={props.durationOptions}
                  durationRange={props.durationRange}
                  fixedDuration={props.fixedDuration}
                  seconds={props.seconds}
                  onSecondsChange={props.onSecondsChange}
                  onSecondsCommit={props.onSecondsCommit}
                />
              )}
            </>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-studio-accent/10 px-3 text-xs font-medium text-studio-accent">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {tx('智能规划 · 自动拆解步骤')}
            </span>
          )}

          {!hideSkillsLink && (
            <Link
              href="/skills"
              target="_blank"
              rel="noopener noreferrer"
              className="studio-jimeng-pill"
            >
              <Puzzle className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{tx('技能')}</span>
              <span className="sr-only">{tx('（在新标签页打开）')}</span>
            </Link>
          )}

          {directHref && (
            <Link
              prefetch={false}
              href={directHref}
              className="studio-jimeng-workbench-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"
            >
              {mode === 'image' ? (
                <ImageIcon className="size-3.5 text-studio-accent" aria-hidden="true" />
              ) : mode === 'video' ? (
                <Video className="size-3.5 text-studio-accent" aria-hidden="true" />
              ) : mode === 'agent' ? (
                <Bot className="size-3.5 text-studio-accent" aria-hidden="true" />
              ) : (
                <Clapperboard className="size-3.5 text-studio-accent" aria-hidden="true" />
              )}
              <span>{tx(directLabel || '工作台')}</span>
              <ArrowUpRight className="size-3.5 text-studio-accent" aria-hidden="true" />
            </Link>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {hasModelControls && <ModelPicker {...props} />}

          {modelUnavailable ? (
            <span role="status" className="text-xs text-muted-foreground">{tx('当前暂无可用模型')} · {tx('模型配置完成后可估算')}</span>
          ) : (
            creditNote ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">{creditNote}</span>
            ) : estimatedCredits !== null ? (
              <span className="hidden items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 text-xs tabular-nums text-muted-foreground sm:inline-flex">
                {estimatedCredits.toLocaleString()} {tx('积分')}
              </span>
            ) : (
              <span className="hidden text-xs text-muted-foreground sm:inline">{tx('按步计费')}</span>
            )
          )}

          <button
            type="submit"
            disabled={starting || !canStart || modelUnavailable}
            aria-busy={starting || undefined}
            aria-label={submitLabel || tx('开始创作')}
            title={submitLabel || tx('开始创作')}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-all duration-150 hover:scale-105 hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:scale-100"
          >
            {starting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden="true" />
            )}
            <span className="sr-only">{starting ? tx('正在进入工作台…') : submitLabel || tx('开始创作')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function CapsuleSelect({
  icon,
  label,
  value,
  options,
  onChange,
  formatOption,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  formatOption?: (value: string) => string
}) {
  const tx = useUiText()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const display = options.length
    ? formatOption ? formatOption(value) : value
    : tx('暂无可用选项')

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={!options.length}
        aria-label={`${label}: ${display}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="studio-jimeng-pill max-w-[160px] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
        <span className="truncate">{display}</span>
        <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && options.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="lg-glass-overlay motion-panel absolute left-0 top-[calc(100%+8px)] z-50 max-h-64 min-w-[168px] overflow-y-auto rounded-2xl border border-border p-1.5 shadow-[var(--lg-shadow-4)]"
        >
          <p className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{label}</p>
          {options.map((item) => {
            const active = item === value
            const text = formatOption ? formatOption(item) : item
            return (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(item)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                  active ? 'bg-studio-accent/12 text-studio-accent' : 'text-foreground',
                )}
              >
                <span className="truncate">{text}</span>
                {active && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DurationCapsule({
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
  const tx = useUiText()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onSecondsCommit()
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onSecondsCommit])

  if (fixedDuration) {
    return (
      <span className="studio-jimeng-pill cursor-default">
        <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="tabular-nums">{fixedDuration}</span>
      </span>
    )
  }

  if (durationRange) {
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={tx('时长')}
          className="studio-jimeng-pill tabular-nums"
        >
          <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span>{seconds} {tx('秒')}</span>
          <ChevronDown className={cn('size-3 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
        {open && (
          <div className="lg-glass-overlay motion-panel absolute left-0 top-[calc(100%+8px)] z-50 w-52 rounded-2xl border border-border p-3 shadow-[var(--lg-shadow-4)]">
            <div className="flex items-center justify-between text-xs font-medium text-foreground">
              <span>{tx('时长（秒）')}</span>
              <span className="tabular-nums text-studio-accent">{seconds}s</span>
            </div>
            <input
              type="range"
              min={durationRange.min}
              max={durationRange.max}
              step={1}
              value={seconds}
              onChange={(event) => onSecondsChange(Number(event.target.value))}
              onMouseUp={onSecondsCommit}
              onTouchEnd={onSecondsCommit}
              className="mt-2.5 w-full accent-studio-accent"
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{durationRange.min}s</span>
              <span>{durationRange.max}s</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  const currentValue = durationOptions.find((item) => parseSeconds(item) === seconds) ?? durationOptions[0] ?? `${seconds}s`
  return (
    <CapsuleSelect
      icon={<Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />}
      label={tx('时长')}
      value={currentValue}
      options={durationOptions}
      onChange={(item) => onSecondsChange(parseSeconds(item) ?? seconds)}
    />
  )
}

function ModelPicker({ selectedModel, modelOptions, groupedModels, dropdownOpen, pickerRef, onToggleDropdown, onSelectModel }: GenerationPanelProps) {
  const tx = useUiText()
  const listId = useId()
  return (
    <div ref={pickerRef} className="relative">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleDropdown}
          aria-label={tx('选择模型')}
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
          className="studio-jimeng-pill max-w-[200px] sm:max-w-[240px]"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-studio-accent">
            <ModelIcon model={selectedModel} />
          </span>
          <span className="truncate font-medium text-foreground">
            {selectedModel ? selectedModel.shortName || selectedModel.name : modelOptions.length ? tx('选择模型') : tx('暂无模型')}
          </span>
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-150', dropdownOpen && 'rotate-180')} aria-hidden="true" />
        </button>
        {selectedModel?.note?.trim() && <ModelNote note={selectedModel.note} />}
      </div>

      {dropdownOpen && (
        <div
          role="listbox"
          id={listId}
          aria-label={tx('可选模型')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onToggleDropdown(); pickerRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus(); return }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
            const index = options.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            options[next]?.focus()
          }}
          className="lg-glass-overlay motion-panel absolute right-0 top-[calc(100%+8px)] z-50 max-h-[min(420px,60dvh)] w-[min(340px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-2xl border border-border p-1.5 text-left shadow-[var(--lg-shadow-4)]"
        >
          {modelOptions.length ? Object.entries(groupedModels).map(([provider, items]) => (
            <div key={provider} className="border-b border-border/70 pb-1 last:border-b-0 last:pb-0">
              <p className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">{provider}</p>
              {items.map((item) => {
                const selected = selectedModel?.id === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-description={item.subscriptionLocked ? tx('需要订阅套餐才可使用') : item.note?.trim() || undefined}
                    aria-disabled={item.subscriptionLocked || undefined}
                    title={item.subscriptionLocked ? tx('需要订阅套餐才可使用') : undefined}
                    onClick={() => { if (!item.subscriptionLocked) onSelectModel(item.id) }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                      selected && !item.subscriptionLocked && 'bg-studio-accent/10',
                      item.subscriptionLocked && 'cursor-not-allowed text-muted-foreground',
                    )}
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-studio-accent"><ModelIcon model={item} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn('truncate text-xs font-semibold', item.subscriptionLocked ? 'text-muted-foreground' : 'text-foreground')}>{item.name}</span>
                        <ModelSubscriptionBadge required={item.requiresSubscription} locked={item.subscriptionLocked} />
                        {item.note?.trim() && <ModelNote note={item.note} interactive={false} />}
                        {selected && !item.subscriptionLocked && <Check className="size-3.5 shrink-0 text-studio-accent" aria-hidden="true" />}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-muted-foreground">{item.description || tx('当前可用模型')}</span>
                      {item.subscriptionLocked && <span data-model-disabled-reason className="mt-1 block text-[11px] font-medium leading-4 text-foreground">{tx('需要订阅套餐才可使用')}</span>}
                      <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        {item.capabilities.ratios.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{item.capabilities.ratios.slice(0, 3).join(' / ')}</span>}
                        {item.capabilities.durations.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{item.capabilities.durations.slice(0, 3).join(' / ')}</span>}
                        <span className="rounded bg-studio-accent/10 px-1.5 py-0.5 text-studio-accent">{item.creditCost || 0} {tx('积分起')}</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )) : <div className="px-3 py-4 text-xs leading-5 text-muted-foreground">{tx('当前模式暂无可用模型，请检查后台渠道配置。')}</div>}
        </div>
      )}
    </div>
  )
}
