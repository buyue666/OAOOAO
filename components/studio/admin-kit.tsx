'use client'

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import { ControlButton, EmptyState, Modal, type Tone } from './ui'
import { cn } from '@/lib/utils'

/* ------------------------------ 状态与错误 ------------------------------ */

export function AdminError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div role="alert" className="studio-surface flex flex-wrap items-center justify-between gap-3 border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <span className="flex min-w-0 items-center gap-2"><AlertTriangle className="size-4 shrink-0" /><span className="min-w-0">{message}</span></span>
      {retry && <ControlButton size="sm" variant="secondary" onClick={retry}><RefreshCw className="size-3.5" />重试</ControlButton>}
    </div>
  )
}

export function AdminNotice({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'neutral' ? Info : AlertTriangle
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn(
      'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5',
      tone === 'success' && 'border-success/30 bg-success/10 text-success',
      tone === 'warning' && 'border-studio-warn/30 bg-studio-warn/10 text-studio-warn',
      tone === 'danger' && 'border-destructive/30 bg-destructive/10 text-destructive',
      tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
    )}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />{children}
    </div>
  )
}

export function AdminLoading({ label = '正在加载', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="studio-surface overflow-hidden" role="status" aria-live="polite">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{label}</div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, index) => <div key={index} className="flex items-center gap-3 px-4 py-3.5"><span className="h-3 w-28 animate-pulse rounded bg-muted" /><span className="h-3 w-40 animate-pulse rounded bg-muted" /><span className="ml-auto h-3 w-16 animate-pulse rounded bg-muted" /></div>)}
      </div>
    </div>
  )
}

export function AdminEmpty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <EmptyState title={title} description={description} action={action} />
}

/* --------------------------------- 表格 --------------------------------- */

export function AdminTableShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('admin-table-scroll studio-surface max-h-[min(70dvh,680px)] max-w-full overflow-auto', className)}>{children}</div>
}

export function AdminTable({ columns, children, minWidth = 760, caption }: { columns: string[]; children: ReactNode; minWidth?: number; caption?: string }) {
  return (
    <AdminTableShell>
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {/* 表头吸顶便于长表格对照。吸顶必须落在 th 上，且 th 自带底色，否则滚动时内容会穿透表头。 */}
        <thead className="text-xs text-muted-foreground">
          <tr>{columns.map((column) => <th key={column} scope="col" className="sticky top-0 z-10 whitespace-nowrap bg-muted px-4 py-3 font-medium">{column}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </AdminTableShell>
  )
}

export function AdminRow({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('border-t border-border align-top transition-colors duration-150 hover:bg-muted/40', className)}>{children}</tr>
}

export function AdminCell({ children, className, colSpan }: { children: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn('px-4 py-3', className)}>{children}</td>
}

export function TableMessageRow({ colSpan, loading, empty, error }: { colSpan: number; loading: boolean; empty: string; error?: string }) {
  const label = loading ? '正在加载' : error ? '数据暂不可用' : empty
  return <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">{loading && <LoaderCircle className="mr-2 inline size-4 animate-spin" />}{label}</td></tr>
}

/* -------------------------------- 分页 -------------------------------- */

export function AdminPagination({ page, pageSize, total, loading, onChange }: { page: number; pageSize: number; total: number; loading?: boolean; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>共 {total.toLocaleString('zh-CN')} 条 · 第 {Math.min(page, pages)} / {pages} 页</span>
      <div className="flex items-center gap-2">
        <ControlButton size="sm" variant="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft className="size-3.5" />上一页</ControlButton>
        <ControlButton size="sm" variant="secondary" disabled={loading || page >= pages} onClick={() => onChange(page + 1)}>下一页<ChevronRight className="size-3.5" /></ControlButton>
      </div>
    </div>
  )
}

/* -------------------------------- 确认操作 -------------------------------- */

export type ConfirmRequest = { title: string; description?: string; notice?: string; confirmLabel?: string; tone?: 'danger' | 'default'; onConfirm: () => Promise<void> | void }

/**
 * 危险操作统一走这个 hook：先弹确认框，确认后才执行。
 * 后端拒绝时把原始错误留在弹窗内，不会被静默吞掉。
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = useCallback((next: ConfirmRequest) => { setError(''); setRequest(next) }, [])
  const close = useCallback(() => { if (!busy) { setRequest(null); setError('') } }, [busy])

  const dialog = (
    <Modal
      open={request !== null}
      title={request?.title ?? ''}
      description={request?.description}
      onClose={close}
      footer={<>
        <ControlButton variant="secondary" onClick={close} disabled={busy}>取消</ControlButton>
        <ControlButton
          variant={request?.tone === 'default' ? 'primary' : 'danger'}
          disabled={busy}
          onClick={async () => {
            if (!request) return
            setBusy(true); setError('')
            try { await request.onConfirm(); setRequest(null) }
            catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
            finally { setBusy(false) }
          }}
        >{busy ? '处理中' : request?.confirmLabel || '确认执行'}</ControlButton>
      </>}
    >
      <div className="flex flex-col gap-3">
        <AdminNotice tone={request?.tone === 'default' ? 'neutral' : 'warning'}>{request?.notice ?? '该操作会立即写入后台并记录审计日志，请确认目标对象无误。'}</AdminNotice>
        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
      </div>
    </Modal>
  )

  return { confirm, dialog, busy }
}

/* ------------------------- 主从布局：详情停靠与抽屉 ------------------------- */

/**
 * 桌面端（≥1280px）详情面板停靠在主从布局右侧，列表与详情同时可见；
 * 更窄的视口下退回全屏抽屉，避免列表被挤到不可用的宽度。
 */
const DOCKED_QUERY = '(min-width: 1280px)'

function subscribeToDockedQuery(onChange: () => void) {
  const media = window.matchMedia(DOCKED_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function readDockedQuery() {
  return window.matchMedia(DOCKED_QUERY).matches
}

function useIsDockedViewport() {
  return useSyncExternalStore(subscribeToDockedQuery, readDockedQuery, () => false)
}

type AdminDetailSlotValue = { slot: HTMLElement | null }
const AdminDetailSlotContext = createContext<AdminDetailSlotValue>({ slot: null })

/**
 * 后台主从布局：主列承载列表与筛选，右侧是详情槽。
 * 槽位没有内容时以 `empty:hidden` 隐藏，只有打开详情才会压缩主列宽度。
 */
export function AdminWorkbench({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const value = useMemo(() => ({ slot }), [slot])
  return (
    <AdminDetailSlotContext.Provider value={value}>
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">{children}</div>
        <div ref={setSlot} className="admin-detail-slot sticky top-[88px] flex max-h-[calc(100dvh-112px)] w-[420px] shrink-0 flex-col empty:hidden" />
      </div>
    </AdminDetailSlotContext.Provider>
  )
}

type AdminDrawerProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
  /** 允许桌面端停靠到主从布局右侧。仅用于详情类面板；需要宽度的编辑器保持全屏抽屉。 */
  dock?: boolean
}

/**
 * 详情与编辑面板。
 *
 * - `dock` 且桌面端处于主从布局中：停靠在右侧，列表保持可见；底部操作栏固定在面板底部，内容区独立滚动。
 * - 其他情况：全屏遮罩抽屉。编辑器需要完整宽度，因此默认不停靠。
 */
export function AdminDrawer({ open, title, description, onClose, children, footer, width = 'sm:max-w-3xl', dock = false }: AdminDrawerProps) {
  const { slot } = useContext(AdminDetailSlotContext)
  const docked = useIsDockedViewport()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const isDockedPanel = dock && docked && slot !== null

  /* 停靠面板较高，首次打开时底部操作栏可能在首屏之外；仅在底部越界时滚动到可见。 */
  useEffect(() => {
    if (!open || !isDockedPanel) return
    slot?.firstElementChild?.scrollIntoView({ block: 'nearest' })
  }, [isDockedPanel, open, slot])

  if (!open) return null

  const panel = (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{title}</h2>{description && <p className="mt-1 truncate text-xs text-muted-foreground">{description}</p>}</div>
        <ControlButton variant="ghost" size="sm" onClick={onClose} aria-label="关闭"><X className="size-4" /></ControlButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</footer>}
    </>
  )

  if (dock && docked && slot) {
    return createPortal(
      <aside aria-label={title} className="motion-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {panel}
      </aside>,
      slot,
    )
  }

  return (
    <div className="studio-sidepanel-backdrop motion-fade fixed inset-0 z-50 flex justify-end bg-studio-ink/50" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label={title} className={cn('admin-drawer-surface motion-panel flex h-full w-full flex-col overflow-hidden border-l border-border shadow-2xl', width)}>
        {panel}
      </section>
    </div>
  )
}

/* -------------------------------- 表单 -------------------------------- */

export const adminFieldClass = 'studio-field h-9 w-full min-w-0 border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-studio-accent/60'

export function AdminField({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5 text-sm', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function AdminInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(adminFieldClass, className)} {...props} />
}

export function AdminSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(adminFieldClass, className)} {...props}>{children}</select>
}

export function AdminTextarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(adminFieldClass, 'h-auto resize-y py-2', className)} {...props} />
}

export function AdminSearch({ value, onChange, placeholder, onSubmit }: { value: string; onChange: (value: string) => void; placeholder: string; onSubmit?: () => void }) {
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSubmit?.() }}
      className="flex min-w-0 items-center gap-2"
      role="search"
    >
      <label className="studio-field flex h-9 min-w-0 flex-1 items-center gap-2 border border-border bg-card px-3 text-muted-foreground sm:w-64 sm:flex-none">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70" />
      </label>
      {onSubmit && <ControlButton type="submit" variant="secondary">查询</ControlButton>}
    </form>
  )
}

export function AdminToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

/**
 * 列表上方的筛选栏：左侧放筛选条件，右侧放批量或刷新类操作。
 * 与表格共享同一个表面，形成「筛选 → 列表」的固定阅读顺序。
 */
export function AdminFilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* -------------------------------- 标签页与操作栏 -------------------------------- */

type AdminTabItem<T extends string> = readonly [value: T, label: string]

/**
 * 后台分区标签：横向用于同一模块内的分区切换，纵向用于设置类的主从导航。
 * 方向键在标签之间移动并同时切换，符合 WAI-ARIA Tabs 的键盘模型。
 */
export function AdminTabs<T extends string>({ label, items, value, onChange, orientation = 'horizontal' }: { label: string; items: ReadonlyArray<AdminTabItem<T>>; value: T; onChange: (value: T) => void; orientation?: 'horizontal' | 'vertical' }) {
  const vertical = orientation === 'vertical'
  const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft'
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight'

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== previousKey && event.key !== nextKey) return
    event.preventDefault()
    const current = items.findIndex(([itemValue]) => itemValue === value)
    const target = (current + (event.key === nextKey ? 1 : -1) + items.length) % items.length
    onChange(items[target][0])
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} aria-orientation={orientation} onKeyDown={handleKeyDown} className={cn(vertical ? 'flex flex-col gap-1' : 'flex flex-wrap gap-1 border-b border-border')}>
      {items.map(([itemValue, itemLabel]) => {
        const selected = itemValue === value
        return (
          <button
            key={itemValue}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(itemValue)}
            className={cn(
              'text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-studio-accent/60',
              vertical
                ? cn('flex h-9 w-full items-center rounded-md px-3 text-left', selected ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                : cn('-mb-px h-10 border-b-2 px-3 font-medium', selected ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'),
            )}
          >
            {itemLabel}
          </button>
        )
      })}
    </div>
  )
}

/** 表单底部的固定操作栏：长表单滚动时，保存按钮始终停留在视口底部。 */
export function AdminSaveBar({ hint, children }: { hint?: string; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-[var(--lg-shadow-2)]">
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/**
 * 数据列表面板：标题与主操作 → 筛选栏 → 数据表格 → 分页。
 * 运营列表统一采用这一结构，保证「先筛选、再比较、后操作」的阅读顺序。
 */
export function AdminDataPanel({ title, description, actions, filters, filterActions, footer, children }: { title: string; description?: string; actions?: ReactNode; filters?: ReactNode; filterActions?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="studio-surface min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {(filters || filterActions) && <AdminFilterBar actions={filterActions}>{filters}</AdminFilterBar>}
      <div className="min-w-0 p-4">{children}</div>
      {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
    </section>
  )
}

export function AdminSectionCard({ title, description, action, children, className }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('studio-surface p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}</div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function AdminDefinition({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-all text-right text-sm', mono && 'font-mono text-xs')}>{value === undefined || value === null || value === '' ? '-' : value}</span>
    </div>
  )
}

export type AdminKpi = { label: string; value: string; detail?: string; tone?: Tone }

/** 指标条：多个指标共用一条边框，以 1px 间隔线分隔，读数集中在同一块面板里。 */
export function AdminKpiStrip({ label, items }: { label: string; items: AdminKpi[] }) {
  return (
    <dl aria-label={label} className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-2 bg-card p-4">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className={cn('text-xl font-semibold tabular-nums tracking-tight', item.tone === 'success' && 'text-success', item.tone === 'danger' && 'text-destructive', item.tone === 'warning' && 'text-studio-warn')}>{item.value}</dd>
          {item.detail && <dd className="truncate text-xs text-muted-foreground" title={item.detail}>{item.detail}</dd>}
        </div>
      ))}
    </dl>
  )
}

export function AdminStat({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <div className="studio-surface min-w-0 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-xl font-semibold tracking-tight tabular-nums', tone === 'success' && 'text-success', tone === 'danger' && 'text-destructive', tone === 'warning' && 'text-studio-warn')}>{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p>}
    </div>
  )
}

/* -------------------------------- 格式化 -------------------------------- */

export function formatAdminDate(value?: string | number) {
  if (value === undefined || value === null || value === '') return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

export function formatAdminNumber(value?: number) {
  return (Number(value) || 0).toLocaleString('zh-CN')
}

export function formatAdminDuration(value?: number) {
  const ms = Number(value) || 0
  if (ms <= 0) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}分${seconds}秒`
}

export function formatAdminMoney(amountCents?: number, currency = 'CNY') {
  const amount = (Number(amountCents) || 0) / 100
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `
  return `${symbol}${amount.toFixed(2)}`
}

export function statusTone(status?: string): Tone {
  const value = String(status || '').toLowerCase()
  if (['success', 'paid', 'active', 'healthy', 'completed', 'approved', 'published', 'settled', 'succeeded'].includes(value)) return 'success'
  if (['error', 'failed', 'disabled', 'cancelled', 'canceled', 'refunded', 'rejected', 'taken_down', 'failure', 'closed'].includes(value)) return 'danger'
  if (['running', 'processing', 'pending', 'queued', 'cooling', 'refunding', 'needs_review', 'paused', 'draft'].includes(value)) return 'accent'
  return 'muted'
}

export const taskStatusLabels: Record<string, string> = { pending: '排队中', running: '执行中', success: '成功', error: '失败', paused: '已暂停', cancelled: '已取消' }
export const executionPhaseLabels: Record<string, string> = {
  created: '已创建',
  submitted: '已提交上游',
  polling: '轮询上游',
  result_ready: '结果待落库',
  persisting: '正在保存结果',
  completed: '已完成',
  needs_review: '待人工确认',
}
export const orderStatusLabels: Record<string, string> = { pending: '待支付', paid: '已支付', closed: '已关闭', canceled: '已取消', refunding: '退款中', refunded: '已退款' }
export const capabilityLabels: Record<string, string> = { text: '文本', image: '图片', video: '视频', audio: '音频' }
export const taskTypeLabels: Record<string, string> = { agent: '导演 Agent', image: '图片', video: '视频', audio: '音频', text: '文本' }
export const surfaceLabels: Record<string, string> = { chat: '对话', canvas: '画布', drama: '短剧' }

export function labelOf(map: Record<string, string>, value?: string) {
  if (!value) return '-'
  return map[value] || value
}
