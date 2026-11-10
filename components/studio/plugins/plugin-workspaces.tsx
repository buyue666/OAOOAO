'use client'

import dynamic from 'next/dynamic'
import { PluginGate, PluginLoading } from './plugin-gate'

const DirectorAgentWorkspace = dynamic(() => import('../director-agent').then(module => module.DirectorAgentWorkspace), { ssr: false, loading: PluginLoading })
const DramaPage = dynamic(() => import('../drama-page').then(module => module.DramaPage), { ssr: false, loading: PluginLoading })
const DramaDetailPage = dynamic(() => import('../drama-detail-page').then(module => module.DramaDetailPage), { ssr: false, loading: PluginLoading })
const CreativeWorkspace = dynamic(() => import('../creative-workspace').then(module => module.CreativeWorkspace), { ssr: false, loading: PluginLoading })
const CreativeProjectStarter = dynamic(() => import('../creative-project-starter').then(module => module.CreativeProjectStarter), { ssr: false, loading: PluginLoading })

export function PluginAgentPage() {
  return <PluginGate id="agent"><div className="mx-auto flex min-h-[calc(100dvh-60px)] w-full max-w-[1560px] px-4 py-5 sm:px-6 md:px-8 md:py-7 xl:h-[calc(100dvh-60px)] xl:min-h-0 xl:px-10"><DirectorAgentWorkspace /></div></PluginGate>
}

export function PluginDramaPage({ projectId, section }: { projectId?: string; section?: string }) {
  return <PluginGate id="drama">{projectId ? section ? <CreativeWorkspace key={projectId} projectId={projectId} initialView={section} /> : <DramaDetailPage key={projectId} projectId={projectId} /> : <DramaPage />}</PluginGate>
}

export function PluginProjectStarter(props: React.ComponentProps<typeof CreativeProjectStarter>) {
  return <PluginGate id="drama"><CreativeProjectStarter {...props} /></PluginGate>
}
