'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, ImageOff } from 'lucide-react'
import type { ToolShowcase, ToolMedia } from '@/lib/studio/creative-tool-showcase'
import { useUiText } from '@/lib/studio/i18n'
import { cn } from '@/lib/utils'
import styles from './creative-tool-media.module.css'

/** Media only. No tool implementation or reference catalog is imported here. */
export function CreativeToolMedia({ showcase, fallback, active = false, compact = false }: { showcase: ToolShowcase; fallback: string; active?: boolean; compact?: boolean }) {
  const tx = useUiText(), root = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null)
  const [near, setNear] = useState(false), [visible, setVisible] = useState(false), [pageVisible, setPageVisible] = useState(true)
  const [reduced, setReduced] = useState(true), [index, setIndex] = useState(0), [position, setPosition] = useState(50)
  const [paused, setPaused] = useState(false), [manualPlayback, setManualPlayback] = useState<boolean | null>(null), [failed, setFailed] = useState<Record<string, boolean>>({})
  const media: ToolMedia[] = showcase.media.length ? showcase.media : [{ type: 'image', url: fallback }]
  const currentIndex = Math.min(index, media.length - 1)
  const item = showcase.effect === 'video' ? media.find(m => m.type === 'video') || media[0] : media[currentIndex]
  const isCarousel = showcase.effect === 'carousel' && media.length > 1
  const isCompare = showcase.effect === 'compare' && media.length > 1 && media[0].type === 'image' && media[1].type === 'image'
  const playing = visible && pageVisible && item.type === 'video' && (manualPlayback ?? (active && !reduced))

  useEffect(() => {
    const node = root.current
    if (!node) return
    const preload = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), { rootMargin: '160px' })
    const viewport = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { threshold: 0.05 })
    preload.observe(node); viewport.observe(node)
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionChange = () => setReduced(motion.matches), visibilityChange = () => setPageVisible(!document.hidden)
    motionChange(); visibilityChange(); motion.addEventListener('change', motionChange); document.addEventListener('visibilitychange', visibilityChange)
    return () => { preload.disconnect(); viewport.disconnect(); motion.removeEventListener('change', motionChange); document.removeEventListener('visibilitychange', visibilityChange) }
  }, [])
  useEffect(() => {
    if (!isCarousel || !visible || !pageVisible || reduced || paused || active) return
    const timer = window.setInterval(() => setIndex(i => (i + 1) % media.length), showcase.intervalMs)
    return () => window.clearInterval(timer)
  }, [isCarousel, visible, pageVisible, reduced, paused, active, media.length, showcase.intervalMs])
  useEffect(() => {
    const element = video.current
    if (!element) return
    if (playing) void element.play().catch(() => setManualPlayback(false))
    else element.pause()
  }, [playing, item.url])

  function picture(src: string, extra?: string) {
    return <img key={src} src={near ? src : undefined} alt="" loading="lazy" decoding="async" onError={() => setFailed(old => ({ ...old, [src]: true }))} className={cn('absolute inset-0 size-full', showcase.fit === 'contain' ? 'object-contain' : 'object-cover', styles.picture, isCarousel && styles.fade, extra)} />
  }
  const controls = cn('relative z-20 flex items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white', compact ? 'size-6' : 'size-8')
  // Thumbnail controls have their own 24px target; the global touch density would cover the preview.
  const controlStyle = compact ? { minHeight: 24 } : undefined
  return <div ref={root} className={cn('relative overflow-hidden bg-muted', compact ? 'h-full w-full' : 'aspect-video')} data-effect={showcase.effect} data-media-index={currentIndex} data-compact={compact || undefined}>
    {isCompare ? <>
      {picture(media[1].url)}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>{picture(media[0].url)}</div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[15] w-0.5 bg-white shadow" style={{ left: `${position}%` }}><span className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-black/60 text-white">↔</span></div>
      <input aria-label={tx('拖动查看前后效果')} type="range" min="5" max="95" value={position} onChange={event => setPosition(Number(event.target.value))} className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0 focus-visible:opacity-25" />
      {!compact && <><span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">{media[0].label || tx('之前')}</span><span className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">{media[1].label || tx('之后')}</span></>}
    </> : <>
      {item.type === 'image' ? picture(item.url, active && !reduced ? styles.zoom : undefined) : <>
        {picture(item.poster || fallback)}
        {near && playing && <video ref={video} src={item.url} poster={item.poster || fallback} autoPlay muted playsInline loop preload="none" aria-label={tx('工具效果视频')} onError={() => { setFailed(old => ({ ...old, [item.url]: true })); setManualPlayback(false) }} className={cn('absolute inset-0 size-full', showcase.fit === 'contain' ? 'object-contain' : 'object-cover')} />}
        <button type="button" style={controlStyle} className={cn(controls, compact ? 'absolute left-2 top-2' : 'absolute left-3 top-3')} aria-label={tx(playing ? '暂停效果视频' : '播放效果视频')} aria-pressed={playing} onClick={() => setManualPlayback(!playing)}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
      </>}
      {!compact && item.label && <p className={cn('pointer-events-none absolute top-3 max-w-[calc(100%-2rem)] rounded-md bg-black/60 px-2.5 py-1 text-xs leading-5 text-white', item.type === 'video' ? 'left-14' : 'left-3')}>{item.label}</p>}
    </>}
    {failed[item.url] && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-xs text-muted-foreground"><ImageOff className="size-6" /><span className={compact ? 'sr-only' : undefined}>{tx('预览暂不可用')}</span></div>}
    {isCarousel && <div className={cn('absolute z-20 flex items-center gap-1 rounded-full bg-black/45 p-1 text-white backdrop-blur-sm', compact ? 'bottom-1.5 left-1.5' : 'bottom-3 left-3')} aria-label={tx('展示轮播')}>
      {!compact && <button type="button" aria-label={tx('上一张展示图')} onClick={() => { setPaused(true); setIndex((currentIndex - 1 + media.length) % media.length) }} className={controls}><ChevronLeft className="size-4" /></button>}
      <span aria-live="off" className={cn('text-center text-xs tabular-nums', compact ? 'min-w-5' : 'min-w-8')}>{currentIndex + 1}/{media.length}</span>
      <button type="button" style={controlStyle} aria-label={tx('下一张展示图')} onClick={() => { setPaused(true); setIndex((currentIndex + 1) % media.length) }} className={controls}><ChevronRight className="size-4" /></button>
      <button type="button" style={controlStyle} aria-label={tx(paused ? '继续轮播' : '暂停轮播')} aria-pressed={paused} onClick={() => setPaused(value => !value)} className={controls}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</button>
    </div>}
  </div>
}
