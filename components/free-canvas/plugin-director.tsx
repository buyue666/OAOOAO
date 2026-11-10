'use client'

import dynamic from 'next/dynamic'
import { usePlugins } from '@/lib/studio/plugin-context'
import { useUiText } from '@/lib/studio/i18n'
import { PluginGate, PluginLoading } from '@/components/studio/plugins/plugin-gate'

const DirectorDesk = dynamic(() => import('./director-desk').then(module => module.DirectorDesk), { ssr: false, loading: PluginLoading })

export function PluginDirectorDesk({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const plugins = usePlugins(), tx = useUiText()
  if (plugins.isInstalled('director')) return <DirectorDesk nodeId={nodeId} onClose={onClose} />
  return <div role="dialog" aria-modal="true" aria-label={tx('3D 导演台')} className="fixed inset-0 z-[100] overflow-y-auto bg-background text-foreground"><PluginGate id="director" onClose={onClose}>{null}</PluginGate></div>
}
