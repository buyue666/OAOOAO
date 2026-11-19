'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, Power, LoaderCircle, PackageCheck, Puzzle, Search, PowerOff } from 'lucide-react'
import { creativePlugins, matchesPlugin, type CreativePlugin } from '@/lib/studio/creative-plugins'
import { usePlugins } from '@/lib/studio/plugin-context'
import { useWorkspace } from '@/lib/studio/workspace-context'
import { workspaceFeature } from '@/lib/studio/workspace-features'
import { useUiText } from '@/lib/studio/i18n'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PluginIcon } from './plugin-icon'

const categories = ['全部', '图像工具', '创作规划', '空间与画布'] as const
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50'

export function PluginCenter() {
  const tx = useUiText()
  const plugins = usePlugins()
  const workspace = useWorkspace()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('全部')
  const [installedOnly, setInstalledOnly] = useState(false)
  const [removing, setRemoving] = useState<CreativePlugin | null>(null)
  const [notice, setNotice] = useState<{ kind: 'installed' | 'removed'; id: CreativePlugin['id']; name: string } | null>(null)
  const team = workspace.identity
  const supported = creativePlugins.filter(plugin => workspaceFeature(plugin.id, team, false).supported)
  const availableCount = supported.filter(plugin => plugins.isInstalled(plugin.id)).length
  const keyword = query.trim().toLocaleLowerCase()
  const visible = creativePlugins.filter(plugin => (!team || !installedOnly || workspaceFeature(plugin.id, team, plugins.isInstalled(plugin.id)).available) && matchesPlugin(plugin, '', category, installedOnly, plugins.installed)
    && (!keyword || `${plugin.name} ${plugin.description} ${tx(plugin.name)} ${tx(plugin.description)} ${plugin.id}`.toLocaleLowerCase().includes(keyword)))

  async function install(plugin: CreativePlugin) {
    setNotice(null)
    if (await plugins.setInstalled(plugin.id, true)) setNotice({ kind: 'installed', id: plugin.id, name: plugin.name })
  }
  async function uninstall() {
    if (!removing) return
    const plugin = removing
    if (await plugins.setInstalled(plugin.id, false)) { setRemoving(null); setNotice({ kind: 'removed', id: plugin.id, name: plugin.name }) }
  }

  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-7 sm:px-6 md:px-8 md:py-9" data-testid="plugin-center">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="mb-3 inline-flex items-center gap-2 text-xs font-medium tracking-wider text-studio-accent"><Puzzle className="size-4" aria-hidden="true" />OAO · {tx('创作工具')}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{tx('功能中心')}</h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">{tx('为你的工作台，开启需要的功能。')}</p>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">{tx(team ? '这里只统计团队可用功能。启用偏好随登录账号保留。' : '按需启用，打开时加载。关闭后保留作品、项目与版本设置。')}</p>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">{tx('3D 导演台支持保留旧版、手动更新与版本切换。')}</p>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4"><span className="flex size-10 items-center justify-center rounded-xl bg-studio-accent/10 text-studio-accent"><PackageCheck className="size-5" aria-hidden="true" /></span><span><span className="block text-xs text-muted-foreground">{tx(team ? '团队当前可用' : '已启用功能')}</span><span className="mt-1 block text-xl font-semibold tabular-nums">{availableCount}<span className="ml-1 text-xs font-normal text-muted-foreground">/ {supported.length}</span></span></span></div>
    </header>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label={tx('官方功能')}>
      <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="group" aria-label={tx('功能范围')} className="inline-flex rounded-xl bg-muted/60 p-1">{[{ label: '全部功能', installed: false }, { label: '已启用', installed: true }].map(tab => <button key={tab.label} type="button" aria-pressed={installedOnly === tab.installed} onClick={() => setInstalledOnly(tab.installed)} className={cn('min-h-10 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', installedOnly === tab.installed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{tx(tab.label)}</button>)}</div>
          <label className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:w-72"><Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label={tx('搜索功能')} placeholder={tx('搜索功能名称或用途')} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" /></label>
        </div>
        <div role="group" aria-label={tx('功能分类')} className="flex flex-wrap gap-1.5">{categories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={cn('min-h-10 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', category === item ? 'bg-studio-accent/12 text-studio-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{tx(item)}</button>)}</div>
      </div>
      {visible.length ? <ul className="divide-y divide-border">{visible.map(plugin => {
        const installed = plugins.isInstalled(plugin.id), pending = plugins.pending === plugin.id
        const feature = workspaceFeature(plugin.id, team, installed)
        return <li key={plugin.id} className="flex flex-col gap-5 p-5 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center sm:gap-5 sm:p-6" data-plugin={plugin.id}>
          <div className="flex min-w-0 flex-1 items-start gap-4"><PluginIcon id={plugin.id} /><div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5"><h2 className="text-base font-semibold">{tx(plugin.name)}</h2><span className="text-xs text-muted-foreground">v{installed && plugin.id === 'director' ? plugins.directorVersion : plugin.version}</span>{feature.available ? <span className="inline-flex items-center gap-1 rounded-md bg-studio-accent/10 px-1.5 py-0.5 text-xs font-medium text-studio-accent"><Check className="size-3" aria-hidden="true" />{tx(team ? '团队可用' : '已启用')}</span> : !feature.supported ? <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-foreground">{tx('仅个人空间')}</span> : team && <span className="text-xs text-muted-foreground">{tx('未启用')}</span>}</div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{tx(plugin.description)}</p>
            <details className="group mt-2 max-w-xl text-xs text-muted-foreground">
              <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">{tx('更新记录')}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
              <div className="mt-2 rounded-xl border border-border bg-background/60 p-3"><p className="text-[11px] tabular-nums">v{plugin.version} · <time dateTime={plugin.releasedAt}>{plugin.releasedAt}</time></p><ul className="mt-2 list-disc space-y-1 pl-4 leading-6">{plugin.notes.map(note => <li key={note}>{tx(note)}</li>)}</ul></div>
            </details>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{tx('官方功能')}</span><span aria-hidden="true">·</span><span>{tx(plugin.category)}</span>{plugin.dependencies.length > 0 && <><span aria-hidden="true">·</span><span>{tx('包含自由画布')}</span></>}</p>
          </div></div>
          <div className="flex shrink-0 items-center justify-end gap-2 sm:self-center">
            {feature.supported && (installed ? <><button type="button" onClick={() => { setNotice(null); setRemoving(plugin) }} disabled={Boolean(plugins.pending)} aria-label={tx('关闭 {0}', [tx(plugin.name)])} title={tx('关闭')} className={cn(buttonClass, 'border border-border bg-background text-foreground hover:bg-muted')}><PowerOff className="size-4" aria-hidden="true" />{tx('关闭')}</button>{feature.href && <Link href={feature.href} prefetch={false} className={cn(buttonClass, 'border border-border bg-background text-foreground hover:bg-muted')}>{tx(plugin.id === 'director' ? '前往画布' : '打开工具')}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>}</> : <button type="button" onClick={() => void install(plugin)} disabled={!plugins.ready || Boolean(plugins.pending)} className={cn(buttonClass, 'min-w-28 bg-studio-accent text-studio-accent-foreground hover:opacity-90')}>{pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Power className="size-4" aria-hidden="true" />}{tx(pending ? '正在启用…' : '启用')}</button>)}
          </div>
        </li>
      })}</ul> : <div className="flex flex-col items-center gap-3 px-5 py-16 text-center"><Puzzle className="size-8 text-muted-foreground" aria-hidden="true" /><p className="font-medium">{tx(installedOnly && !plugins.installed.length ? '还没有启用功能' : '没有找到匹配的功能')}</p><p className="text-sm text-muted-foreground">{tx('试试其他分类，或查看全部功能。')}</p><button type="button" onClick={() => { setQuery(''); setCategory('全部'); setInstalledOnly(false) }} className={cn(buttonClass, 'mt-1 border border-border hover:bg-muted')}>{tx('查看全部功能')}</button></div>}
    </section>
    <div aria-live="polite" aria-atomic="true">{notice && workspaceFeature(notice.id, team, false).supported && <p role="status" className="text-sm text-studio-accent">{tx(notice.kind === 'installed' ? '已启用 {0}，可从创作工具菜单打开。' : '已关闭 {0}，作品、项目和版本设置已保留。', [tx(notice.name)])}</p>}{plugins.error && <p role="alert" className="text-sm text-destructive">{tx(plugins.error)}</p>}{!plugins.ready && <p className="text-sm text-muted-foreground">{tx('登录后可启用功能。')}</p>}</div>
    <Dialog open={Boolean(removing)} onOpenChange={open => { if (!open && !plugins.pending) setRemoving(null) }}>
      <DialogContent><DialogHeader><DialogTitle>{tx('关闭 {0}', [removing ? tx(removing.name) : ''])}</DialogTitle><DialogDescription>{tx('关闭后将隐藏功能入口，已有作品、项目、素材和版本设置会保留。需要时可重新启用。')}</DialogDescription></DialogHeader>
        {removing?.id === 'canvas' && plugins.isInstalled('director') && <p className="text-sm leading-6 text-muted-foreground">{tx('3D 导演台依赖自由画布，将一并关闭。')}</p>}
        {plugins.error && <p role="alert" className="text-sm text-destructive">{tx(plugins.error)}</p>}
        <DialogFooter><button type="button" onClick={() => setRemoving(null)} disabled={Boolean(plugins.pending)} className={cn(buttonClass, 'border border-border hover:bg-muted')}>{tx('取消')}</button><button type="button" onClick={() => void uninstall()} disabled={Boolean(plugins.pending)} className={cn(buttonClass, 'bg-foreground text-background hover:opacity-90')}>{plugins.pending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{tx(plugins.pending ? '正在关闭…' : '确认关闭')}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
