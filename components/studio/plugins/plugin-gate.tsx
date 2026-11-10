'use client'

import Link from 'next/link'
import { ArrowLeft, Download, LoaderCircle, Puzzle } from 'lucide-react'
import { usePlugins } from '@/lib/studio/plugin-context'
import { creativePlugin, type CreativePluginId } from '@/lib/studio/creative-plugins'
import { useUiText } from '@/lib/studio/i18n'
import { PluginIcon } from './plugin-icon'

export function PluginLoading() {
  const tx = useUiText()
  return <div role="status" className="flex min-h-64 items-center justify-center gap-2 px-5 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{tx('正在加载工具…')}</div>
}

/** Children must be dynamic client components so blocked tools do not download. */
export function PluginGate({ id, children, onClose }: { id: CreativePluginId; children: React.ReactNode; onClose?: () => void }) {
  const tx = useUiText()
  const plugins = usePlugins()
  const plugin = creativePlugin(id)
  if (plugins.isInstalled(id)) return children
  return <section className="mx-auto flex min-h-[60dvh] w-full max-w-xl flex-col items-center justify-center px-6 py-12 text-center" data-plugin-gate={id}>
    <PluginIcon id={id} className="mb-6 size-16" />
    <p className="mb-2 text-xs font-medium text-muted-foreground">{tx('官方插件')} · v{plugin.version}</p>
    <h1 className="text-2xl font-semibold tracking-tight">{tx(plugin.name)}</h1>
    <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">{tx(plugin.description)}</p>
    <p className="mt-5 text-sm text-muted-foreground">{tx('安装后即可使用，已有项目和作品会继续保留。')}</p>
    {plugin.dependencies.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{tx('将同时安装自由画布。')}</p>}
    <button type="button" onClick={() => void plugins.setInstalled(id, true)} disabled={!plugins.ready || Boolean(plugins.pending)} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-studio-accent px-6 text-sm font-semibold text-studio-accent-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50">
      {plugins.pending === id ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
      {tx(plugins.pending === id ? '正在安装…' : '安装并使用')}
    </button>
    {!plugins.ready && <p className="mt-3 text-xs text-muted-foreground">{tx('登录后可安装插件。')}</p>}
    {plugins.error && <p role="alert" className="mt-4 text-sm text-destructive">{tx(plugins.error)}</p>}
    <div className="mt-6 flex flex-wrap justify-center gap-5 text-sm text-muted-foreground">
      {onClose ? <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{tx('返回画布')}</button> : <Link href="/studio" prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{tx('返回创作首页')}</Link>}
      <Link href="/tools" prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 hover:text-foreground"><Puzzle className="size-4" aria-hidden="true" />{tx('浏览插件中心')}</Link>
    </div>
  </section>
}
