'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminInput } from './admin-kit'

/**
 * A small, curated index of the LobeHub icon library.  The library does not
 * expose a public search API; its static SVG package is intentionally used as
 * the image source so the admin bundle stays small and new icons can be added
 * without a dependency upgrade.
 */
export type LobeIconEntry = {
  slug: string
  label: string
  aliases: string[]
  group: '模型' | '平台' | '工具'
  url?: string
}

export const lobeIconCatalog: LobeIconEntry[] = [
  { slug: 'openai', label: 'OpenAI', aliases: ['ChatGPT', 'GPT', 'DALL·E', 'Codex'], group: '平台' },
  { slug: 'openai-text', label: 'GPT-4', aliases: ['OpenAI', 'ChatGPT', 'GPT'], group: '模型' },
  { slug: 'claude', label: 'Claude', aliases: ['Anthropic'], group: '模型' },
  { slug: 'anthropic', label: 'Anthropic', aliases: ['Claude'], group: '平台' },
  { slug: 'gemini', label: 'Gemini', aliases: ['Google', 'Bard'], group: '模型' },
  { slug: 'google', label: 'Google', aliases: ['Gemini'], group: '平台' },
  { slug: 'deepseek', label: 'DeepSeek', aliases: ['深度求索'], group: '模型' },
  { slug: 'qwen', label: 'Qwen', aliases: ['通义千问', '阿里云'], group: '模型' },
  { slug: 'doubao', label: '豆包', aliases: ['Doubao', '火山引擎'], group: '模型' },
  { slug: 'jimeng', label: '即梦', aliases: ['Jimeng', '剪映', '字节跳动'], group: '模型' },
  { slug: 'zhipu', label: '智谱', aliases: ['GLM', 'ChatGLM'], group: '模型' },
  { slug: 'moonshot', label: 'Moonshot', aliases: ['Kimi', '月之暗面'], group: '模型' },
  { slug: 'minimax', label: 'MiniMax', aliases: ['海螺'], group: '模型' },
  { slug: 'mistral', label: 'Mistral', aliases: ['Mixtral'], group: '模型' },
  { slug: 'grok', label: 'Grok', aliases: ['xAI'], group: '模型' },
  { slug: 'xai', label: 'xAI', aliases: ['Grok'], group: '平台' },
  { slug: 'perplexity', label: 'Perplexity', aliases: ['搜索'], group: '平台' },
  { slug: 'cohere', label: 'Cohere', aliases: ['Command'], group: '平台' },
  { slug: 'ollama', label: 'Ollama', aliases: ['本地模型'], group: '工具' },
  { slug: 'azure', label: 'Azure OpenAI', aliases: ['Microsoft'], group: '平台' },
  { slug: 'vertexai', label: 'Vertex AI', aliases: ['Google Cloud'], group: '平台' },
  { slug: 'dalle', label: 'DALL·E', aliases: ['OpenAI', '图片生成'], group: '模型' },
  { slug: 'flux', label: 'FLUX', aliases: ['Black Forest Labs', '图片生成'], group: '模型' },
  { slug: 'midjourney', label: 'Midjourney', aliases: ['图片生成'], group: '模型' },
  { slug: 'stability', label: 'Stable Diffusion', aliases: ['Stability AI', '图片生成'], group: '模型' },
  { slug: 'runway', label: 'Runway', aliases: ['视频生成'], group: '模型' },
  { slug: 'kling', label: '可灵', aliases: ['Kling', '视频生成'], group: '模型' },
  { slug: 'sora', label: 'Sora', aliases: ['OpenAI', '视频生成'], group: '模型' },
  { slug: 'ideogram', label: 'Ideogram', aliases: ['图片生成'], group: '模型' },
]

// 国内后台优先走 npm 镜像，避免管理员在内网搜索图标时等待 unpkg；地址仍然是
// LobeHub 官方静态包的同一份 SVG 资源。彩色变体只在包中实际存在的图标上启用，
// 其余图标继续使用普通 SVG。
const CDN_BASE = 'https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons'
const COLOR_ICON_SLUGS = new Set([
  'claude', 'gemini', 'google', 'deepseek', 'qwen', 'doubao', 'jimeng', 'zhipu', 'minimax',
  'mistral', 'perplexity', 'cohere', 'azure', 'vertexai', 'dalle', 'stability', 'kling', 'sora',
  'ideogram',
])

export function lobeIconUrl(slug: string) {
  const normalized = slug.trim()
  const iconSlug = COLOR_ICON_SLUGS.has(normalized) ? `${normalized}-color` : normalized
  return `${CDN_BASE}/${encodeURIComponent(iconSlug)}.svg`
}

function lobeIconPlainUrl(slug: string) {
  return `${CDN_BASE}/${encodeURIComponent(slug.trim())}.svg`
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

export function filterLobeIcons(query: string) {
  const needle = normalize(query)
  if (!needle) return lobeIconCatalog
  return lobeIconCatalog.filter((item) => normalize([item.slug, item.label, ...item.aliases].join(' ')).includes(needle))
}

type PickerRect = {left: number; right: number; top: number; bottom: number}

/** Keep the floating surface within the drawer and the visible viewport. */
export function iconPickerPosition(trigger: PickerRect, bounds: PickerRect) {
  const gap = 6, padding = 12
  const width = Math.max(0, Math.min(430, bounds.right - bounds.left - padding * 2))
  const below = Math.max(0, bounds.bottom - trigger.bottom - gap - padding)
  const above = Math.max(0, trigger.top - bounds.top - gap - padding)
  const placeAbove = below < 340 && above > below
  const maxHeight = Math.min(460, placeAbove ? above : below)
  return {
    left: Math.max(bounds.left + padding, Math.min(trigger.right - width, bounds.right - padding - width)),
    top: placeAbove ? trigger.top - gap - maxHeight : trigger.bottom + gap,
    width,
    maxHeight,
  }
}

type LobeIconPickerProps = {
  value?: string
  onChange: (value?: string) => void
  className?: string
  compact?: boolean
  'aria-label'?: string
}

export function LobeIconPicker({ value, onChange, className, compact = false, 'aria-label': ariaLabel = '选择模型图标' }: LobeIconPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({top: 12, left: 12, width: 430, maxHeight: 460})
  const [query, setQuery] = useState('')
  const [remoteResults, setRemoteResults] = useState<LobeIconEntry[] | null>(null)
  const [remoteTotal, setRemoteTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const localResults = useMemo(() => filterLobeIcons(query), [query])
  const results = remoteResults ?? localResults
  const selected = value ? [...lobeIconCatalog, ...(remoteResults || [])].find((item) => value === lobeIconUrl(item.slug) || value === lobeIconPlainUrl(item.slug) || value === item.url) : undefined
  const selectedIconUrl = selected?.url || (selected ? lobeIconUrl(selected.slug) : value)

  const closeAndFocus = () => {
    setOpen(false)
    triggerRef.current?.focus({preventScroll: true})
  }

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    const dialog = trigger.closest<HTMLElement>('[role="dialog"]')
    const place = () => {
      const rect = trigger.getBoundingClientRect(), surface = dialog?.getBoundingClientRect()
      const bounds = {left: Math.max(0, surface?.left || 0), right: Math.min(window.innerWidth, surface?.right ?? window.innerWidth), top: Math.max(0, surface?.top || 0), bottom: Math.min(window.innerHeight, surface?.bottom ?? window.innerHeight)}
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) {setOpen(false); return}
      setPosition(iconPickerPosition(rect, bounds))
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !trigger.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      setOpen(false); trigger.focus({preventScroll: true})
    }
    const scroll = (event: Event) => {if (!panelRef.current?.contains(event.target as Node)) place()}
    place()
    searchRef.current?.focus({preventScroll: true})
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(trigger); if (dialog) observer?.observe(dialog)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scroll, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scroll, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      void fetch(`/api/lobe-icons?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('icon search failed')))
        .then((data: { items?: LobeIconEntry[]; total?: number }) => {
          if (!controller.signal.aborted) {
            setRemoteResults(Array.isArray(data.items) ? data.items : [])
            setRemoteTotal(Number(data.total) || 0)
          }
        })
        .catch((error: unknown) => { if ((error as { name?: string })?.name !== 'AbortError') setRemoteResults(null) })
        .finally(() => {if (!controller.signal.aborted) setSearching(false)})
    }, 140)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query])

  return (
    <div className={cn('relative min-w-0', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((current) => !current)}
          className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left transition-colors hover:border-studio-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60', compact ? 'h-9' : 'h-10')}
        >
          <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted p-1">
            {value ? <img src={selectedIconUrl || value} alt="" className="size-full object-contain" onError={(event) => { const target = event.currentTarget; if (selected && target.src !== lobeIconPlainUrl(selected.slug)) target.src = lobeIconPlainUrl(selected.slug) }} /> : <span className="text-xs text-muted-foreground">—</span>}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{selected?.label || (value ? '自定义图标' : '选择图标')}</span>
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {value && <button type="button" aria-label="清除模型图标" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60" onClick={() => {onChange(undefined); triggerRef.current?.focus({preventScroll: true})}}><X className="size-3.5" /></button>}
      </div>

      {open && createPortal(<div ref={panelRef} id={panelId} role="dialog" aria-label={ariaLabel} data-lobe-icon-popover className="fixed z-[100] flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-3 text-foreground shadow-2xl" style={position} onBlur={event => {if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && !triggerRef.current?.contains(event.relatedTarget as Node)) setOpen(false)}}>
        <div className="flex items-center gap-2">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-muted-foreground">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <input ref={searchRef} aria-label="搜索图标" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 OpenAI、GPT、Claude…" className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70" />
          </div>
          <button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60" aria-label="关闭图标选择器" onClick={closeAndFocus}><X className="size-4" /></button>
        </div>
        <p className="mt-2 shrink-0 text-[11px] text-muted-foreground">搜索 LobeHub 图标，选择后更新当前草稿，保存路由配置后生效。{remoteTotal > results.length ? ` 共 ${remoteTotal} 个匹配结果，显示前 ${results.length} 个。` : ''}</p>
        <div className="mt-2 grid min-h-20 max-h-64 shrink grid-cols-4 gap-1.5 overflow-y-auto overscroll-contain pr-1" role="group" aria-label="模型图标结果">
          {results.map((item) => {
            const iconUrl = item.url || lobeIconUrl(item.slug)
            const checked = value === iconUrl || value === lobeIconUrl(item.slug) || value === lobeIconPlainUrl(item.slug)
            return <button key={item.slug} type="button" aria-pressed={checked} title={`${item.label} · ${item.group}`} onClick={() => { onChange(iconUrl); closeAndFocus() }} className={cn('relative flex min-w-0 flex-col items-center gap-1 rounded-md border p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60', checked ? 'border-studio-accent bg-studio-accent/10' : 'border-border bg-background hover:border-studio-accent/50 hover:bg-muted')}>
              <span className="flex size-8 items-center justify-center overflow-hidden rounded-md bg-muted p-1.5"><img src={iconUrl} alt="" loading="lazy" className="size-full object-contain" onError={(event) => { const target = event.currentTarget; const fallback = lobeIconPlainUrl(item.slug); if (target.src !== fallback) target.src = fallback }} /></span>
              <span className="w-full truncate text-[10px] text-foreground">{item.label}</span>
              {checked && <Check className="absolute right-1 top-1 size-3 text-studio-accent" />}
            </button>
          })}
          {!results.length && <p className="col-span-4 py-6 text-center text-xs text-muted-foreground">{searching ? '正在搜索图标…' : '没有匹配的图标'}</p>}
        </div>
        <div className="mt-3 shrink-0 border-t border-border pt-3">
          <label htmlFor={`${panelId}-url`} className="text-[11px] text-muted-foreground">或使用自定义图标地址</label>
          <AdminInput id={`${panelId}-url`} className="mt-1 h-8 text-xs" value={value || ''} placeholder="https://… 或 /media/models/…" onChange={(event) => onChange(event.target.value.trim() || undefined)} />
        </div>
      </div>, document.body)}
    </div>
  )
}
