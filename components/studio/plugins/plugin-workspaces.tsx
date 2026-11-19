'use client'

import dynamic from 'next/dynamic'
import { PluginGate, PluginLoading } from './plugin-gate'

const AgentHomePage = dynamic(() => import('../home-page').then(module => module.HomePage), { ssr: false, loading: PluginLoading })
const DramaPage = dynamic(() => import('../drama-page').then(module => module.DramaPage), { ssr: false, loading: PluginLoading })
const DramaDetailPage = dynamic(() => import('../drama-detail-page').then(module => module.DramaDetailPage), { ssr: false, loading: PluginLoading })
const CreativeWorkspace = dynamic(() => import('../creative-workspace').then(module => module.CreativeWorkspace), { ssr: false, loading: PluginLoading })
const CreativeProjectStarter = dynamic(() => import('../creative-project-starter').then(module => module.CreativeProjectStarter), { ssr: false, loading: PluginLoading })

export function PluginAgentPage() {
  return <PluginGate id="agent"><AgentHomePage initialAssistant /></PluginGate>
}

export function PluginDramaPage({ projectId, section }: { projectId?: string; section?: string }) {
  return <PluginGate id="drama">{projectId ? section ? <CreativeWorkspace key={projectId} projectId={projectId} initialView={section} /> : <DramaDetailPage key={projectId} projectId={projectId} /> : <DramaPage />}</PluginGate>
}

export function PluginProjectStarter(props: React.ComponentProps<typeof CreativeProjectStarter>) {
  return <PluginGate id="drama"><CreativeProjectStarter {...props} /></PluginGate>
}
