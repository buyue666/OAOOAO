'use client'

import { useEffect, useMemo, useState } from 'react'
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
// LobeHub 官方静态包的同一份 SVG 资源。
const CDN_BASE = 'https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons'

export function lobeIconUrl(slug: string) {
  return `${CDN_BASE}/${encodeURIComponent(slug)}.svg`
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

export function filterLobeIcons(query: string) {
  const needle = normalize(query)
  if (!needle) return lobeIconCatalog
  return lobeIconCatalog.filter((item) => normalize([item.slug, item.label, ...item.aliases].join(' ')).includes(needle))
}

type LobeIconPickerProps = {
  value?: string
  onChange: (value?: string) => void
  className?: string
  compact?: boolean
  'aria-label'?: string
}

export function LobeIconPicker({ value, onChange, className, compact = false, 'aria-label': ariaLabel = '选择模型图标' }: LobeIconPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [remoteResults, setRemoteResults] = useState<LobeIconEntry[] | null>(null)
  const [remoteTotal, setRemoteTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const localResults = useMemo(() => filterLobeIcons(query), [query])
  const results = remoteResults ?? localResults
  const selected = [...lobeIconCatalog, ...(remoteResults || [])].find((item) => value === lobeIconUrl(item.slug) || value === item.url)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      void fetch(`/api/lobe-icons?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('icon search failed')))
        .then((data: { items?: LobeIconEntry[]; total?: number }) => {
          setRemoteResults(Array.isArray(data.items) ? data.items : [])
          setRemoteTotal(Number(data.total) || 0)
        })
        .catch((error: unknown) => { if ((error as { name?: string })?.name !== 'AbortError') setRemoteResults(null) })
        .finally(() => setSearching(false))
    }, 140)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query])

  return (
    <div className={cn('relative min-w-0', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={ariaLabel}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left transition-colors hover:border-studio-accent/60', compact ? 'h-9' : 'h-10')}
        >
          <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted p-1">
            {value ? <img src={value} alt="" className="size-full object-contain" /> : <span className="text-xs text-muted-foreground">—</span>}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{selected?.label || (value ? '自定义图标' : '选择图标')}</span>
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {value && <button type="button" aria-label="清除模型图标" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onChange(undefined)}><X className="size-3.5" /></button>}
      </div>

      {open && <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(430px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 shadow-2xl">
        <div className="flex items-center gap-2">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-muted-foreground">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <input autoFocus aria-label="搜索图标" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 OpenAI、GPT、Claude…" className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70" />
          </div>
          <button type="button" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭图标选择器" onClick={() => setOpen(false)}><X className="size-4" /></button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">实时搜索完整的 LobeHub Icons 图标索引，单选后立即写入模型设置。{remoteTotal > results.length ? ` 共 ${remoteTotal} 个匹配结果，显示前 ${results.length} 个。` : ''}</p>
        <div className="mt-2 grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label="模型图标结果">
          {results.map((item) => {
            const iconUrl = item.url || lobeIconUrl(item.slug)
            const checked = value === iconUrl
            return <button key={item.slug} type="button" role="radio" aria-checked={checked} title={`${item.label} · ${item.group}`} onClick={() => { onChange(iconUrl); setOpen(false) }} className={cn('relative flex min-w-0 flex-col items-center gap-1 rounded-md border p-2 text-center transition-colors', checked ? 'border-studio-accent bg-studio-accent/10' : 'border-border bg-background hover:border-studio-accent/50 hover:bg-muted')}>
              <span className="flex size-8 items-center justify-center overflow-hidden rounded-md bg-muted p-1.5"><img src={iconUrl} alt="" loading="lazy" className="size-full object-contain" /></span>
              <span className="w-full truncate text-[10px] text-foreground">{item.label}</span>
              {checked && <Check className="absolute right-1 top-1 size-3 text-studio-accent" />}
            </button>
          })}
          {!results.length && <p className="col-span-4 py-6 text-center text-xs text-muted-foreground">{searching ? '正在搜索图标…' : '没有匹配的图标'}</p>}
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-[11px] text-muted-foreground">或使用自定义图标地址</div>
          <AdminInput className="mt-1 h-8 text-xs" value={value || ''} placeholder="https://… 或 /media/models/…" onChange={(event) => onChange(event.target.value.trim() || undefined)} />
        </div>
      </div>}
    </div>
  )
}
