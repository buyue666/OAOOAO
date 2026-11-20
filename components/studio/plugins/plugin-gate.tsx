'use client'

import Link from 'next/link'
import { ArrowLeft, LoaderCircle, Puzzle } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { usePlugins } from '@/lib/studio/plugin-context'
import { creativePlugin, type CreativePluginId } from '@/lib/studio/creative-plugins'
import { useUiText } from '@/lib/studio/i18n'
import { PluginIcon } from './plugin-icon'
import { useWorkspace } from '@/lib/studio/workspace-context'
import { workspaceFeature } from '@/lib/studio/workspace-features'

export function PluginLoading() {
  const tx = useUiText()
  return <div role="status" className="flex min-h-64 items-center justify-center gap-2 px-5 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{tx('正在加载工具…')}</div>
}

/** Children must be dynamic client components so blocked tools do not download. */
export function PluginGate({ id, children, onClose }: { id: CreativePluginId; children: React.ReactNode; onClose?: () => void }) {
  const tx = useUiText()
  const plugins = usePlugins()
  const { state } = useStudio()
  const workspace = useWorkspace()
  const plugin = creativePlugin(id)
  const feature = workspaceFeature(id, workspace.identity)
  if (!state.hydrated || state.backendStatus === 'checking') return <PluginLoading />
  if (plugins.ready && feature.available) return children
  return <section className="mx-auto flex min-h-[60dvh] w-full max-w-xl flex-col items-center justify-center px-6 py-12 text-center" data-plugin-gate={id}>
    <PluginIcon id={id} className="mb-6 size-16" />
    <p className="mb-2 text-xs font-medium text-muted-foreground">{tx('官方功能')} · v{plugin.version}</p>
    <h1 className="text-2xl font-semibold tracking-tight">{tx(plugin.name)}</h1>
    <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">{tx(plugin.description)}</p>
    {!feature.supported ? <p className="mt-5 text-sm text-foreground">{tx('此工具暂仅支持个人空间，请切换空间后使用。')}</p>
      : state.backendStatus === 'offline' ? <p role="alert" className="mt-5 text-sm text-muted-foreground">{tx('暂时无法连接服务，请恢复连接后重试。')}</p>
      : <Link href={`/login?next=${encodeURIComponent(feature.href || plugin.href)}`} prefetch={false} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-studio-accent px-6 text-sm font-semibold text-studio-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{tx('登录后使用')}</Link>}
    <div className="mt-6 flex flex-wrap justify-center gap-5 text-sm text-muted-foreground">
      {onClose ? <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{tx('返回画布')}</button> : <Link href={workspace.href('/studio')} prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{tx('返回创作首页')}</Link>}
      <Link href={workspace.href('/tools')} prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 hover:text-foreground"><Puzzle className="size-4" aria-hidden="true" />{tx('浏览功能中心')}</Link>
    </div>
  </section>
}
