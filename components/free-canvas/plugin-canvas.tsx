'use client'

import dynamic from 'next/dynamic'
import type { CanvasBackendProject, CanvasSummary } from '@/lib/studio/api'
import { PluginGate, PluginLoading } from '@/components/studio/plugins/plugin-gate'
import type { CanvasWorkspace } from './canvas-workspace'

const CanvasEditor = dynamic(() => import('./canvas-editor').then(module => module.CanvasEditor), { ssr: false, loading: PluginLoading })
const CanvasIndexPage = dynamic(() => import('./canvas-index-page').then(module => module.CanvasIndexPage), { ssr: false, loading: PluginLoading })

export function PluginCanvasIndex({ projects, loadError }: { projects: CanvasSummary[]; loadError: string | null }) {
  return <PluginGate id="canvas"><CanvasIndexPage projects={projects} loadError={loadError} /></PluginGate>
}

export function PluginCanvasEditor(props: { projectId: string; project: CanvasBackendProject | null; loadError: string | null; workspace?: CanvasWorkspace }) {
  return <PluginGate id="canvas"><CanvasEditor {...props} /></PluginGate>
}
