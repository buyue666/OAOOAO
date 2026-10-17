'use client'

import { AudioLines, Bot, Image as ImageIcon, Sparkles, Video } from 'lucide-react'
import { useState } from 'react'
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
  const [loadedUrl, setLoadedUrl] = useState('')
  const [failedUrl, setFailedUrl] = useState('')
  if (iconUrl && iconUrl !== failedUrl) {
    const loaded = loadedUrl === iconUrl
    return (
      <span className={cn('relative inline-flex size-full items-center justify-center', className)}>
        {/* 先显示能力图标作为占位，避免远程 SVG 加载期间出现空白或浏览器破图框。 */}
        <Icon aria-hidden="true" className={cn('size-full transition-opacity', loaded ? 'opacity-0' : 'opacity-100')} />
        <img
          src={iconUrl}
          alt=""
          aria-hidden="true"
          className={cn('absolute inset-0 size-full object-contain transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setLoadedUrl(iconUrl)}
          onError={() => setFailedUrl(iconUrl)}
        />
      </span>
    )
  }
  return <Icon aria-hidden="true" className={cn('size-full', className)} />
}
