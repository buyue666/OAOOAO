'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { ArrowUpRight, ChevronDown, Search, WandSparkles } from 'lucide-react'
import { creativePlugins, type CreativePlugin, type CreativePluginId } from '@/lib/studio/creative-plugins'
import { usePlugins } from '@/lib/studio/plugin-context'
import { useWorkspace } from '@/lib/studio/workspace-context'
import { workspaceFeature } from '@/lib/studio/workspace-features'
import { useUiText } from '@/lib/studio/i18n'
import { cn } from '@/lib/utils'
import { DirectorVersionControl } from './director-version-control'

const categories = ['全部', '图像工具', '创作规划', '空间与画布'] as const
// Directory artwork only. Tool code and reference catalogs remain in their own lazy entries.
const covers: Record<CreativePluginId, string> = {
  remix: '/media/tool-previews/remix.webp',
  tryon: '/media/tool-previews/tryon.webp',
  agent: '/media/tool-previews/agent.webp',
  drama: '/media/tool-previews/drama.webp',
  canvas: '/media/tool-previews/canvas.webp',
  director: '/media/tool-previews/director.webp',
}
const captions: Record<CreativePluginId, string> = {
  remix: '参考构图与光影，创作新的画面',
  tryon: '人物、服装、姿势与背景自由组合',
  agent: '带上想法与素材，梳理创作计划',
  drama: '从剧本到分镜，逐步完成故事',
  canvas: '组织素材，连接你的创作流程',
  director: '布置场景，预演动作与镜头',
}

export function PluginCenter() {
  const tx = useUiText()
  const plugins = usePlugins()
  const workspace = useWorkspace()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('全部')
  const keyword = query.trim().toLocaleLowerCase()
  const visible = creativePlugins.filter(plugin => (category === '全部' || plugin.category === category)
    && (!keyword || `${plugin.name} ${plugin.description} ${captions[plugin.id]} ${tx(plugin.name)} ${tx(plugin.description)} ${tx(captions[plugin.id])} ${plugin.id}`.toLocaleLowerCase().includes(keyword)))
  const groups = categories.slice(1).map(name => ({ name, items: visible.filter(plugin => plugin.category === name) })).filter(group => group.items.length)

  function card(plugin: CreativePlugin) {
    const feature = workspaceFeature(plugin.id, workspace.identity)
    const content = <>
      <div className="relative aspect-[16/9] overflow-hidden bg-muted">
        <Image src={covers[plugin.id]} alt="" fill loading="lazy" sizes="(min-width: 1536px) 380px, (min-width: 1024px) 30vw, (min-width: 640px) 44vw, 90vw" className={cn('object-cover transition-transform duration-300 motion-reduce:transition-none', feature.available && 'group-hover:scale-[1.035]')} />
        {!feature.supported && <span className="absolute right-3 top-3 rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">{tx('仅个人空间')}</span>}
      </div>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0"><h3 className="text-base font-semibold text-foreground">{tx(plugin.name)}</h3><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{tx(captions[plugin.id])}</p></div>
        {feature.available && <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />}
      </div>
    </>
    return <li key={plugin.id} className="min-w-0" data-plugin={plugin.id}>
      {feature.href ? <Link href={feature.href} prefetch={false} aria-label={tx('使用 {0}', [tx(plugin.name)])} className="studio-surface studio-surface-interactive group block h-full overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">{content}</Link>
        : <div aria-disabled="true" className="studio-surface overflow-hidden rounded-2xl">{content}<p className="px-4 pb-4 text-xs leading-6 text-muted-foreground">{tx('此工具暂仅支持个人空间，请切换空间后使用。')}</p></div>}
    </li>
  }

  return <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-7 px-4 py-7 sm:px-6 md:px-8 md:py-9" data-testid="plugin-center">
    <header><p className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-studio-accent"><WandSparkles className="size-4" aria-hidden="true" />OAO · {tx('创作工具')}</p><h1 className="text-3xl font-semibold tracking-tight text-foreground">{tx('功能中心')}</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">{tx('选择工具，开始创作。')}</p></header>
    <div className="flex flex-col-reverse justify-between gap-4 sm:flex-row sm:items-center">
      <div role="group" aria-label={tx('功能分类')} className="flex flex-wrap gap-1.5">{categories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={cn('min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', category === item ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{tx(item)}</button>)}</div>
      <label className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:w-64"><Search className="size-4 shrink-0" aria-hidden="true" /><input data-focus-managed type="search" aria-label={tx('搜索功能')} placeholder={tx('搜索功能名称或用途')} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" /></label>
    </div>
    {groups.length ? groups.map(group => <section key={group.name} aria-labelledby={`tools-${group.name}`} className="flex flex-col gap-4"><h2 id={`tools-${group.name}`} className="text-sm font-semibold text-foreground">{tx(group.name)}</h2><ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{group.items.map(card)}</ul></section>)
      : <div role="status" className="rounded-2xl border border-border px-5 py-14 text-center"><p className="font-medium">{tx('没有找到匹配的功能')}</p><button type="button" onClick={() => { setQuery(''); setCategory('全部') }} className="mt-4 min-h-11 rounded-xl border border-border px-4 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{tx('查看全部功能')}</button></div>}
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">{tx('版本与更新记录')}<ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
      <div className="flex flex-col gap-5 border-t border-border p-4 sm:p-5">
        {workspaceFeature('director', workspace.identity).supported && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{tx('3D 导演台支持保留旧版、手动更新与版本切换。')}</p><DirectorVersionControl /></div>}
        <ul className="grid gap-4 sm:grid-cols-2">{creativePlugins.filter(plugin => workspaceFeature(plugin.id, workspace.identity).supported).map(plugin => <li key={plugin.id} className="min-w-0 text-xs leading-6"><p className="font-medium text-foreground">{tx(plugin.name)} · v{plugin.version} <time className="ml-2 font-normal text-muted-foreground" dateTime={plugin.releasedAt}>{plugin.releasedAt}</time></p><ul className="mt-1 list-disc pl-4 text-muted-foreground">{plugin.notes.map(note => <li key={note}>{tx(note)}</li>)}</ul></li>)}</ul>
        {plugins.error && <p role="alert" className="text-sm text-destructive">{tx(plugins.error)}</p>}
      </div>
    </details>
  </div>
}