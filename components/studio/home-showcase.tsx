'use client'

import { useUiText } from '@/lib/studio/i18n'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CreativePluginId } from '@/lib/studio/creative-plugins'

export type ShowcasePreset = {
  id: string
  title: string
  subtitle: string
  badge: string
  image: string
  mode: 'agent' | 'image' | 'video'
  prompt: string
}

const FEATURED_SLIDES: readonly ShowcasePreset[] = [
  {
    id: 'product-film',
    title: '产品概念短片 · 三镜叙事',
    subtitle: '整体造型、材质微距与使用场景一次生成，保持外观一致',
    badge: '创作助手',
    image: '/media/generated/hero-film-v2.png',
    mode: 'agent',
    prompt: '制作一支 15 秒的产品短片。用三个镜头分别表现产品的整体造型、材质细节和使用场景，保持产品外观一致，电影级棚拍光影。',
  },
  {
    id: 'tokyo-rain',
    title: '电影感概念主视觉',
    subtitle: '雨夜霓虹与暖色橱窗反差构图，胶片颗粒与景深层次',
    badge: '图片生成',
    image: '/media/generated/work-city-night-v2.png',
    mode: 'image',
    prompt: '雨夜东京街角的复古咖啡馆橱窗，暖黄色室内灯光洒在湿润的石板路上，玻璃上挂着细密水珠，电影感构图与柔和胶片质感。',
  },
  {
    id: 'architectural-push',
    title: '空间漫游与运镜转场',
    subtitle: '清晨光影穿过几何建筑走廊，平稳推镜带来呼吸感',
    badge: '视频生成',
    image: '/media/generated/architectural-hero-v3.png',
    mode: 'video',
    prompt: '清晨海边极简混凝土长廊，金色低角度阳光斜射入室内，镜头平稳向前推进并微幅摇摄，写实电影质感。',
  },
]

const STUDIO_TOOLS: ReadonlyArray<{
  id: CreativePluginId
  title: string
  subtitle: string
  badge?: string
  href: string
  image: string
}> = [
  {
    id: 'drama',
    title: '短剧工作室',
    subtitle: '剧本、角色、分镜与镜头成片全流程',
    badge: '热门',
    href: '/drama',
    image: '/media/generated/scene-storyboard-v2.png',
  },
  {
    id: 'canvas',
    title: '自由画布',
    subtitle: '无限画布串联生成节点与 3D 导演台',
    badge: '画布',
    href: '/canvas',
    image: '/media/generated/landing-canvas-v1.png',
  },
  {
    id: 'remix',
    title: '图片复刻',
    subtitle: '解析参考图构图、光影与细节重绘',
    href: '/tools/remix',
    image: '/media/generated/scene-product-v2.png',
  },
  {
    id: 'tryon',
    title: 'AI 换装',
    subtitle: '人物、服装与多视角商业试穿成片',
    badge: '工具',
    href: '/tools/tryon',
    image: '/media/generated/scene-character-v2.png',
  },
]

export function HomeShowcase({ onApplyPreset }: { onApplyPreset: (preset: ShowcasePreset) => void }) {
  const tx = useUiText()
  const [slideIndex, setSlideIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((current) => (current + 1) % FEATURED_SLIDES.length)
    }, 6500)
    return () => window.clearInterval(timer)
  }, [])

  const activeSlide = FEATURED_SLIDES[slideIndex] ?? FEATURED_SLIDES[0]
  const visibleTools = STUDIO_TOOLS

  return (
    <section aria-labelledby="showcase-title" className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="showcase-title" className="text-sm font-semibold tracking-[-0.01em] text-foreground">
          {tx('灵感探索与创作工作室')}
        </h2>
        <Link
          prefetch={false}
          href="/tools"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          {tx('全部功能')}<ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="group relative flex h-[228px] w-full flex-col justify-end overflow-hidden rounded-2xl border border-border bg-studio-ink text-studio-ink-foreground shadow-sm">
            <Image
              src={activeSlide.image}
              alt=""
              fill
              sizes="(min-width: 1024px) 42vw, 100vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/88 via-black/38 to-black/10" />

            <div className="relative z-10 flex flex-col gap-2 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
                  <Sparkles className="size-3" aria-hidden="true" />
                  {tx(activeSlide.badge)}
                </span>
                <div className="flex items-center gap-1.5" role="tablist" aria-label={tx('轮播推荐')}>
                  {FEATURED_SLIDES.map((slide, idx) => (
                    <button
                      key={slide.id}
                      type="button"
                      role="tab"
                      aria-selected={idx === slideIndex}
                      aria-label={`${idx + 1} / ${FEATURED_SLIDES.length}: ${tx(slide.title)}`}
                      onClick={() => setSlideIndex(idx)}
                      className={cn(
                        'h-1.5 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                        idx === slideIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/75',
                      )}
                    />
                  ))}
                </div>
              </div>

              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-[-0.01em] text-white">{tx(activeSlide.title)}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-white/85">{tx(activeSlide.subtitle)}</p>
              </div>

              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => onApplyPreset(activeSlide)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-neutral-900 transition-transform duration-150 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {tx('填入同款描述')}<ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
          {visibleTools.map((tool) => (
            <Link
              key={tool.id}
              href={tool.href}
              prefetch={false}
              className="studio-surface studio-surface-interactive group flex h-[108px] items-center gap-3.5 overflow-hidden rounded-2xl p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <div className="relative h-[86px] w-[112px] shrink-0 overflow-hidden rounded-xl bg-muted">
                <Image
                  src={tool.image}
                  alt=""
                  fill
                  sizes="120px"
                  className="object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-foreground">{tx(tool.title)}</span>
                  {tool.badge && (
                    <span className="shrink-0 rounded-full bg-studio-accent/12 px-2 py-0.5 text-[10px] font-semibold text-studio-accent">
                      {tx(tool.badge)}
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs leading-[18px] text-muted-foreground">{tx(tool.subtitle)}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
