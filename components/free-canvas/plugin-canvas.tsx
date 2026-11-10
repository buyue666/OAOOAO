'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { CanvasBackendProject, CanvasSummary } from '@/lib/studio/api'
import { usePlugins } from '@/lib/studio/plugin-context'
import { useUiText } from '@/lib/studio/i18n'
import { PluginGate, PluginLoading } from '@/components/studio/plugins/plugin-gate'
import type { CanvasWorkspace } from './canvas-workspace'

const CanvasEditor = dynamic(() => import('./canvas-editor').then(module => module.CanvasEditor), { ssr: false, loading: PluginLoading })
const CanvasIndexPage = dynamic(() => import('./canvas-index-page').then(module => module.CanvasIndexPage), { ssr: false, loading: PluginLoading })

function CanvasInstallationRefresh({ loaded, children }: { loaded: boolean; children: React.ReactNode }) {
  const plugins = usePlugins(), router = useRouter(), tx = useUiText()
  const refreshed = useRef(false)
  useEffect(() => {
    if (loaded) { refreshed.current = false; return }
    if (plugins.isInstalled('canvas') && !refreshed.current) { refreshed.current = true; router.refresh() }
  }, [loaded, plugins, router])
  if (loaded) return children
  return <div className="flex min-h-64 flex-col items-center justify-center gap-3"><PluginLoading /><button type="button" onClick={() => router.refresh()} className="min-h-11 rounded-xl border border-border px-4 text-sm hover:bg-muted">{tx('重新读取')}</button></div>
}

export function PluginCanvasIndex({ loaded, projects, loadError }: { loaded: boolean; projects: CanvasSummary[]; loadError: string | null }) {
  return <PluginGate id="canvas"><CanvasInstallationRefresh loaded={loaded}><CanvasIndexPage projects={projects} loadError={loadError} /></CanvasInstallationRefresh></PluginGate>
}

export function PluginCanvasEditor({ loaded, ...props }: { loaded: boolean; projectId: string; project: CanvasBackendProject | null; loadError: string | null; workspace?: CanvasWorkspace }) {
  return <PluginGate id="canvas"><CanvasInstallationRefresh loaded={loaded}><CanvasEditor {...props} /></CanvasInstallationRefresh></PluginGate>
}
