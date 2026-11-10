import { Bot, Box, Clapperboard, PanelsTopLeft, Shirt, WandSparkles } from 'lucide-react'
import type { CreativePluginId } from '@/lib/studio/creative-plugins'
import { cn } from '@/lib/utils'

export const pluginIcons = { remix: WandSparkles, tryon: Shirt, agent: Bot, drama: Clapperboard, canvas: PanelsTopLeft, director: Box }
const tones: Record<CreativePluginId, string> = {
  remix: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  tryon: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  agent: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  drama: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  canvas: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  director: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
}

export function PluginIcon({ id, className }: { id: CreativePluginId; className?: string }) {
  const Icon = pluginIcons[id]
  return <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-current/10', tones[id], className)}><Icon className="size-6" aria-hidden="true" /></span>
}
