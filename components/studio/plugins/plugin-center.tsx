'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown, Search, WandSparkles } from 'lucide-react'
import { creativePlugins, type CreativePluginId } from '@/lib/studio/creative-plugins'
import { usePlugins } from '@/lib/studio/plugin-context'
import { useWorkspace } from '@/lib/studio/workspace-context'
import { workspaceFeature } from '@/lib/studio/workspace-features'
import { toolShowcase, toolEnabled, type ToolShowcase } from '@/lib/studio/creative-tool-showcase'
import { useCreativeTools } from '@/lib/studio/use-creative-tools'
import { useUiText } from '@/lib/studio/i18n'
import { cn } from '@/lib/utils'
import { DirectorVersionControl } from './director-version-control'
import { CreativeToolMedia } from './creative-tool-media'
import styles from './creative-tool-media.module.css'

const categories = ['全部', '图像工具', '创作规划', '空间与画布'] as const
export function ToolShowcaseCard({ id, showcase, href, unavailable, preview = false }: { id: CreativePluginId; showcase: ToolShowcase; href?: string; unavailable?: string; preview?: boolean }) {
  const tx = useUiText(), [active, setActive] = useState(false)
  return <article data-plugin={id} className={cn('studio-surface relative h-full min-w-0 overflow-hidden rounded-2xl', styles.card)} onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)} onFocusCapture={() => setActive(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false) }}>
    <div className="relative"><CreativeToolMedia showcase={showcase} fallback={`/media/tool-previews/${id}.webp`} active={active} />{href && (preview ? <button type="button" tabIndex={-1} aria-hidden="true" className={cn('absolute bottom-3 right-3 z-30 flex min-h-9 items-center justify-center rounded-lg bg-white px-4 text-xs font-semibold text-neutral-950 shadow-lg', styles.useAction)} data-tool-use>{tx('去使用')}</button> : <Link href={href} prefetch={false} tabIndex={-1} aria-hidden="true" className={cn('absolute bottom-3 right-3 z-30 flex min-h-9 items-center justify-center rounded-lg bg-white px-4 text-xs font-semibold text-neutral-950 shadow-lg', styles.useAction)} data-tool-use>{tx('去使用')}</Link>)}</div>
    <div className="p-4"><h3 className="text-base font-semibold leading-6 text-foreground">{tx(showcase.title)}</h3><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{tx(showcase.description)}</p>{unavailable && <p className="mt-2 text-xs leading-5 text-muted-foreground">{tx(unavailable)}</p>}</div>
    {href && (preview ? <button type="button" aria-label={tx('预览 {0}', [tx(showcase.title)])} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" /> : <Link href={href} prefetch={false} aria-label={tx('使用 {0}', [tx(showcase.title)])} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />)}
  </article>
}

export function PluginCenter() {
  const tx = useUiText(), plugins = usePlugins(), workspace = useWorkspace(), tools = useCreativeTools()
  const [query, setQuery] = useState(''), [category, setCategory] = useState<string>('全部')
  const keyword = query.trim().toLocaleLowerCase()
  const visible = creativePlugins.map(plugin => ({ ...plugin, showcase: toolShowcase(plugin.id, tools.settings) }))
    .filter(plugin => toolEnabled(plugin.id, tools.settings) && (category === '全部' || plugin.category === category)
      && (!keyword || `${plugin.showcase.title} ${plugin.showcase.description} ${tx(plugin.showcase.title)} ${tx(plugin.showcase.description)} ${plugin.id}`.toLocaleLowerCase().includes(keyword)))
    .sort((a,b) => a.showcase.order - b.showcase.order)
  const groups = categories.slice(1).map(name => ({ name, items: visible.filter(plugin => plugin.category === name) })).filter(group => group.items.length)
  return <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-7 px-4 py-7 sm:px-6 md:px-8 md:py-9" data-testid="plugin-center">
    <header><p className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-studio-accent"><WandSparkles className="size-4" aria-hidden="true" />OAO</p><h1 className="text-3xl font-semibold tracking-tight text-foreground">{tx('创作工具')}</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">{tx('选择工具，让想法成为作品。')}</p></header>
    <div className="flex flex-col-reverse justify-between gap-4 sm:flex-row sm:items-center">
      <div role="group" aria-label={tx('工具分类')} className="flex flex-wrap gap-1.5">{categories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={cn('min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', category === item ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{tx(item)}</button>)}</div>
      <label className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:w-64"><Search className="size-4 shrink-0" aria-hidden="true" /><input data-focus-managed type="search" aria-label={tx('搜索工具')} placeholder={tx('搜索工具名称或用途')} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" /></label>
    </div>
    {tools.error && <p role="status" className="text-sm text-muted-foreground">{tx('工具配置暂时未能刷新，正在显示上次读取的内容。')}</p>}
    {groups.length ? groups.map(group => <section key={group.name} aria-labelledby={`tools-${group.name}`} className="flex flex-col gap-4"><h2 id={`tools-${group.name}`} className="text-sm font-semibold text-foreground">{tx(group.name)}</h2><ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">{group.items.map(plugin => { const feature = workspaceFeature(plugin.id, workspace.identity); return <li key={plugin.id} className="min-w-0"><ToolShowcaseCard id={plugin.id} showcase={plugin.showcase} href={feature.href} unavailable={!feature.supported ? '此工具暂仅支持个人空间，请切换空间后使用。' : undefined} /></li> })}</ul></section>)
      : <div role="status" className="rounded-2xl border border-border px-5 py-14 text-center"><p className="font-medium">{tx('没有找到匹配的工具')}</p><button type="button" onClick={() => { setQuery(''); setCategory('全部') }} className="mt-4 min-h-11 rounded-xl border border-border px-4 text-sm hover:bg-muted">{tx('查看全部工具')}</button></div>}
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">{tx('版本与更新记录')}<ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
      <div className="flex flex-col gap-5 border-t border-border p-4 sm:p-5">
        {toolEnabled('director', tools.settings) && workspaceFeature('director', workspace.identity).supported && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{tx('3D 导演台支持保留旧版、手动更新与版本切换。')}</p><DirectorVersionControl /></div>}
        <ul className="grid gap-4 sm:grid-cols-2">{creativePlugins.filter(plugin => toolEnabled(plugin.id, tools.settings) && workspaceFeature(plugin.id, workspace.identity).supported).map(plugin => <li key={plugin.id} className="min-w-0 text-xs leading-6"><p className="font-medium">{tx(toolShowcase(plugin.id, tools.settings).title)} · v{plugin.version} <time className="ml-2 font-normal text-muted-foreground" dateTime={plugin.releasedAt}>{plugin.releasedAt}</time></p><ul className="mt-1 list-disc pl-4 text-muted-foreground">{plugin.notes.map(note => <li key={note}>{tx(note)}</li>)}</ul></li>)}</ul>
        {plugins.error && <p role="alert" className="text-sm text-destructive">{tx(plugins.error)}</p>}
      </div>
    </details>
  </div>
}
