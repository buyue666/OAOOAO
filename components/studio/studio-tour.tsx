'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useLocale } from '@/lib/studio/i18n'
import { studioTourPlacement, studioTourSteps, type TourRect } from '@/lib/studio/studio-tour'

export default function StudioTour({ kind, onClose }: { kind: 'studio' | 'tryon'; onClose: () => void }) {
  const { locale } = useLocale(), english = locale === 'en-US'
  const steps = studioTourSteps(kind, english)
  const [index, setIndex] = useState(0)
  const [target, setTarget] = useState<TourRect | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [cardHeight, setCardHeight] = useState(220)
  const popup = useRef<HTMLDivElement>(null)
  const maskId = useId().replace(/:/g, ''), descriptionId = useId()
  const step = steps[index]
  const positioned = viewport.width > 0
  useEffect(() => { if (positioned) popup.current?.focus() }, [positioned])
  useEffect(() => {
    let frame = 0
    const visibleTarget = () => Array.from(document.querySelectorAll<HTMLElement>(step.selector)).find(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
    const element = visibleTarget()
    if (element) element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    const measure = () => {
      const node = visibleTarget(), bounds = node?.getBoundingClientRect()
      setViewport({ width: document.documentElement.clientWidth, height: window.innerHeight })
      setTarget(bounds ? { top: Math.max(4, bounds.top - 5), left: Math.max(4, bounds.left - 5), width: Math.min(bounds.width + 10, innerWidth - Math.max(4, bounds.left - 5) - 4), height: Math.min(bounds.height + 10, innerHeight - Math.max(4, bounds.top - 5) - 4) } : null)
      if (popup.current) setCardHeight(popup.current.getBoundingClientRect().height)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    if (element) observer.observe(element)
    if (popup.current) observer.observe(popup.current)
    schedule(); window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true) }
  }, [index, step.selector, locale])
  const position = studioTourPlacement(target, viewport, { width: 380, height: cardHeight })
  const secondary = 'inline-flex min-h-11 items-center justify-center gap-1 rounded-lg px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent'
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-[80]">
        <svg aria-hidden="true" className="size-full text-black"><defs><mask id={maskId}><rect width="100%" height="100%" fill="white" />{target && <rect x={target.left} y={target.top} width={Math.max(0, target.width)} height={Math.max(0, target.height)} rx="10" fill="black" />}</mask></defs><rect width="100%" height="100%" fill="currentColor" fillOpacity="0.58" mask={`url(#${maskId})`} /></svg>
      </Dialog.Backdrop>
      {target && <div aria-hidden="true" data-testid="studio-tour-highlight" className="pointer-events-none fixed z-[81] rounded-xl border-2 border-studio-accent shadow-sm" style={{ left: target.left, top: target.top, width: Math.max(0, target.width), height: Math.max(0, target.height) }} />}
      <Dialog.Popup ref={popup} tabIndex={-1} data-testid="studio-tour-card" aria-describedby={descriptionId} className="fixed z-[82] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none" style={{ ...position, visibility: viewport.width ? 'visible' : 'hidden' }}>
        <div className="flex items-center justify-between gap-3"><Dialog.Title aria-live="polite" className="text-sm font-semibold">{step.title}</Dialog.Title><Dialog.Close aria-label={english ? 'Close tour' : '关闭引导'} className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"><X className="size-4" /></Dialog.Close></div>
        <Dialog.Description id={descriptionId} className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</Dialog.Description>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1.5" aria-label={`${index + 1} / ${steps.length}`}>{steps.map((_, item) => <span aria-hidden="true" key={item} className={item === index ? 'h-1.5 w-4 rounded-full bg-studio-accent' : 'size-1.5 rounded-full bg-muted-foreground/35'} />)}<span className="ml-1 text-[11px] tabular-nums text-muted-foreground">{index + 1}/{steps.length}</span></div><div className="flex flex-wrap justify-end gap-1">{index === 0 ? <button type="button" className={secondary} onClick={onClose}>{english ? 'Skip' : '跳过'}</button> : <button type="button" className={secondary} onClick={() => setIndex(value => value - 1)}><ChevronLeft className="size-3.5" />{english ? 'Back' : '上一步'}</button>}<button type="button" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-studio-accent px-3 text-xs font-semibold text-studio-accent-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground" onClick={() => index === steps.length - 1 ? onClose() : setIndex(value => value + 1)}>{index === steps.length - 1 ? english ? 'Finish' : '结束导览' : english ? 'Next' : '下一步'}{index < steps.length - 1 && <ChevronRight className="size-3.5" />}</button></div></div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
