'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Image as ImageIcon, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

export function ControlButton({ className, variant = 'secondary', size = 'md', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      className={cn(
        'studio-control inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border text-sm font-medium shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60 disabled:pointer-events-none disabled:opacity-45',
        variant === 'primary' && 'border-foreground bg-foreground text-background hover:opacity-90',
        variant === 'secondary' && 'border-border bg-card text-foreground hover:bg-muted',
        variant === 'ghost' && 'border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        variant === 'danger' && 'border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3',
        size === 'lg' && 'h-10 px-4',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 轻量 Tooltip：通过 portal 渲染到 body，避免被侧栏 / 缩略图容器的 overflow 裁切。
 * 同时保留原生 title，保证在无 JS 或触屏场景下仍有提示。
 */
export function Tooltip({ label, side = 'top', className, children }: { label: string; side?: 'top' | 'right'; className?: string; children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const show = useCallback(() => {
    const element = anchorRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    setCoords(
      side === 'right'
        ? { top: rect.top + rect.height / 2, left: rect.right + 8 }
        : { top: rect.top - 8, left: rect.left + rect.width / 2 },
    )
  }, [side])

  const hide = useCallback(() => setCoords(null), [])

  return (
    <span ref={anchorRef} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} className={cn('inline-flex', className)}>
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            className={cn(
              'motion-fade pointer-events-none fixed z-[60] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md',
              side === 'right' ? '-translate-y-1/2' : '-translate-x-1/2 -translate-y-full',
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}

export function IconAction({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('studio-icon-action inline-flex size-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60', className)}
      {...props}
    >
      {children}
    </button>
  )
}

export function StatusBadge({ children, tone = 'neutral', className, solid = false }: { children: ReactNode; tone?: Tone; className?: string; solid?: boolean }) {
  return (
    <span data-solid={solid ? 'true' : undefined} className={cn(
      'studio-status-badge inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-5',
      tone === 'accent' && (solid ? 'border-studio-accent/40 bg-card text-studio-accent' : 'border-studio-accent/25 bg-studio-accent/10 text-studio-accent'),
      tone === 'success' && (solid ? 'border-success/40 bg-card text-success' : 'border-success/25 bg-success/10 text-success'),
      tone === 'warning' && (solid ? 'border-studio-warn/45 bg-card text-studio-warn' : 'border-studio-warn/30 bg-studio-warn/10 text-studio-warn'),
      tone === 'danger' && (solid ? 'border-destructive/40 bg-card text-destructive' : 'border-destructive/25 bg-destructive/10 text-destructive'),
      tone === 'muted' && (solid ? 'border-border bg-card text-muted-foreground' : 'border-border bg-muted text-muted-foreground'),
      tone === 'neutral' && (solid ? 'border-border bg-card text-card-foreground' : 'border-border bg-secondary text-secondary-foreground'),
      className,
    )}>
      {children}
    </span>
  )
}

/**
 * 页面主标题只出现一次。顶栏只保留面包屑，因此这里不再渲染眉题（eyebrow），
 * 标题也收敛到 18–20px，避免把后台页面做成 Hero 字号。
 */
export function PageHeader({ title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="studio-page-header flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-balance text-lg font-semibold tracking-[-0.02em] text-foreground md:text-xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="studio-section-heading flex items-end justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function StatBlock({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <div className="min-w-0 border-l-2 border-border pl-3 first:border-l-0 first:pl-0 md:first:border-l-2 md:first:pl-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tracking-[-0.03em]', tone === 'accent' && 'text-studio-accent', tone === 'warning' && 'text-studio-warn')}>{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}

export function MediaThumb({ src, poster, alt, fallback, kind = 'image', className, overlay, onLoadError }: { src?: string; poster?: string; alt: string; fallback: string; kind?: 'image' | 'video'; className?: string; overlay?: ReactNode; onLoadError?: () => void }) {
  const [failed, setFailed] = useState(false)
  const fail = () => { setFailed(true); onLoadError?.() }
  return (
    <div className={cn('relative min-h-0 overflow-hidden bg-muted', className)}>
      {!failed && kind === 'video' && src ? (
        <video className="size-full object-cover" src={src} poster={poster} muted playsInline preload="metadata" onError={fail} aria-label={alt} />
      ) : !failed && (src || poster) ? (
        <img className="size-full object-cover" src={src || poster} alt={alt} onError={fail} />
      ) : (
        <div className="flex size-full min-h-24 items-center justify-center bg-secondary px-4 text-center text-xs text-muted-foreground"><ImageIcon className="mr-2 size-4" aria-hidden="true" />{fallback}</div>
      )}
      {overlay}
    </div>
  )
}

export function SearchField({ value, onChange, placeholder = '搜索' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="studio-search-field studio-field flex h-8 min-w-0 items-center gap-2 border border-border bg-card px-2.5 text-muted-foreground transition-colors duration-150 focus-within:border-studio-accent/60 focus-within:ring-2 focus-within:ring-studio-accent/15">
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <input className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

export function SelectField({ label, value, onChange, options, className, hint, disabled }: { label?: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; className?: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <span className="relative">
        <select disabled={disabled} className="studio-select studio-field h-8 w-full appearance-none border border-border bg-card px-2.5 pr-8 text-sm text-foreground outline-none transition-colors duration-150 focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15 disabled:cursor-not-allowed disabled:opacity-60" value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </span>
      {hint && <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** 分段控制器：选中指示器用 transform 平滑移动，不改变任何元素尺寸。 */
export function SegmentedControl({ value, onChange, options, className }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string; icon?: ReactNode }>; className?: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const index = options.findIndex((option) => option.value === value)
      const target = list.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]
      if (!target) return
      setIndicator({ left: target.offsetLeft, width: target.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [options, value])

  return (
    <div ref={listRef} className={cn('studio-segmented studio-scroll-x relative inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted p-0.5 shadow-sm', className)} role="tablist">
      {indicator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded bg-card shadow-sm transition-[transform,width] duration-200 ease-out"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60', value === option.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: Tone }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className={cn('h-full rounded-full transition-[width] duration-300 ease-out', tone === 'accent' && 'bg-studio-accent', tone === 'warning' && 'bg-studio-warn', tone === 'success' && 'bg-success')} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="studio-empty-state studio-surface flex min-h-44 flex-col items-center justify-center border-dashed bg-card/40 px-5 text-center"><p className="text-sm font-medium text-foreground">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>{action && <div className="mt-4">{action}</div>}</div>
}

/** 打开时锁定焦点到对话框，关闭后把焦点还给触发元素；Escape 关闭。 */
function useDialogBehavior(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const container = containerRef.current
    const focusable = container?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ;(focusable ?? container)?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !container) return
      const items = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previous?.focus?.()
    }
  }, [onClose, open])

  return containerRef
}

export function Modal({ open, title, description, onClose, children, footer, className }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; className?: string }) {
  const containerRef = useDialogBehavior(open, onClose)
  if (!open) return null
  return (
    <div className="studio-modal-backdrop motion-fade fixed inset-0 z-50 flex items-center justify-center bg-studio-ink/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={containerRef} tabIndex={-1} className={cn('studio-modal-surface motion-panel flex max-h-[calc(100dvh-32px)] w-full max-w-lg flex-col overflow-hidden border border-border bg-background outline-none', className)} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 id="modal-title" className="text-base font-semibold text-foreground">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}</div><IconAction label="关闭" onClick={onClose}><X /></IconAction></div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex max-h-32 flex-wrap items-center justify-end gap-2 overflow-y-auto border-t border-border bg-muted/30 px-4 py-3 sm:px-5">{footer}</div>}
      </section>
    </div>
  )
}

/**
 * 右侧抽屉：桌面端为固定宽度侧栏，移动端自动变成全屏 Sheet。
 * 用于导演 Agent 和分镜页，避免长期挤压主预览区。
 */
export function SidePanel({ open, onClose, title, description, children, footer, width = 'lg:w-[360px]' }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  const containerRef = useDialogBehavior(open, onClose)
  if (!open || typeof document === 'undefined') return null
  const portalRoot = document.querySelector<HTMLElement>('[data-studio-portal-root]') ?? document.body

  return createPortal(
    <div className="studio-sidepanel-backdrop motion-fade fixed inset-0 z-50 flex justify-end bg-studio-ink/60 lg:bg-transparent" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside ref={containerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="side-panel-title" className={cn('studio-sidepanel motion-panel flex h-full w-full flex-col overflow-hidden border-l border-border bg-card shadow-2xl outline-none lg:mt-[60px] lg:h-[calc(100dvh-60px)] lg:max-w-[420px]', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="side-panel-title" className="truncate text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>}
          </div>
          <IconAction label="关闭面板" onClick={onClose}><X /></IconAction>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-border bg-muted/30 px-4 py-3">{footer}</div>}
      </aside>
    </div>,
    portalRoot,
  )
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <div className={cn('studio-notice flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5 shadow-sm', tone === 'warning' && 'border-studio-warn/30 bg-studio-warn/10 text-studio-warn', tone === 'accent' && 'border-studio-accent/25 bg-studio-accent/10 text-foreground', tone === 'neutral' && 'border-border bg-muted text-muted-foreground')}>{children}</div>
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return <div className="studio-key-value flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0"><span className="text-xs text-muted-foreground">{label}</span><span className="text-right text-sm font-medium text-foreground">{value}</span></div>
}

export function CheckMark() {
  return <Check className="size-3.5 text-studio-accent" aria-hidden="true" />
}
