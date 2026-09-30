'use client'

import { AudioLines, Bot, Image as ImageIcon, Sparkles, Video } from 'lucide-react'
import type { ModelConfig } from '@/lib/studio/types'
import { cn } from '@/lib/utils'

const fallbackIcons = {
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
  text: Bot,
} as const

export function ModelIcon({ model, className }: { model?: Pick<ModelConfig, 'iconUrl' | 'capability'>; className?: string }) {
  const Icon = fallbackIcons[model?.capability || 'text'] || Sparkles
  const iconUrl = model?.iconUrl?.trim()
  if (iconUrl) {
    return <img src={iconUrl} alt="" aria-hidden="true" className={cn('size-full object-contain', className)} />
  }
  return <Icon aria-hidden="true" className={cn('size-full', className)} />
}
