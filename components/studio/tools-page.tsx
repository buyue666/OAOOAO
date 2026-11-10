'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useUiText } from '@/lib/studio/i18n'
import { PluginGate, PluginLoading } from './plugins/plugin-gate'

export type CreativeTool = 'remix' | 'tryon'
const ImageRemixTool = dynamic(() => import('./tools/image-remix-tool'), { ssr: false, loading: PluginLoading })
const AiTryOnTool = dynamic(() => import('./tools/ai-tryon-tool'), { ssr: false, loading: PluginLoading })

export function ToolsPage({ tool = 'remix' }: { tool?: CreativeTool }) {
  const tx = useUiText()
  return <PluginGate id={tool}><div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8" data-testid="creative-tools-collapse">
    <Link href="/tools" prefetch={false} className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{tx('插件中心')}</Link>
    {tool === 'remix' ? <ImageRemixTool /> : <div data-testid="tool-ai-tryon"><AiTryOnTool /></div>}
  </div></PluginGate>
}
