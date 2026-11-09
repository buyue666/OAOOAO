'use client'

import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Plus, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FIGURE_LABELS, POSE_LABELS, type FigureModel, type PoseId } from './catalog'
import { figureThumbnails } from './figure-thumbnails'

function useThumbnails(model: FigureModel) {
  const [images, setImages] = useState<Partial<Record<PoseId, string>>>({})
  useEffect(() => {
    let active = true; setImages({})
    void figureThumbnails(model).then(value => { if (active) setImages(value) }).catch(() => {})
    return () => { active = false }
  }, [model])
  return images
}

export function DirectorFigureLibrary({ onAdd, disabled }: { onAdd: (model: FigureModel) => void; disabled: boolean }) {
  return <details open className="mb-4 rounded-xl border border-border bg-muted/20 p-2.5">
    <summary className="min-h-8 cursor-pointer text-xs font-medium">人物模型</summary>
    <div className="mt-1 grid grid-cols-2 gap-2">{(['male', 'female'] as const).map(model => <FigureCard key={model} model={model} disabled={disabled} onAdd={() => onAdd(model)} />)}</div>
  </details>
}

function FigureCard({ model, onAdd, disabled }: { model: FigureModel; onAdd: () => void; disabled: boolean }) {
  const images = useThumbnails(model)
  return <button type="button" disabled={disabled} aria-label={`添加${FIGURE_LABELS[model]}`} title={disabled ? '当前场景最多支持 8 个角色' : `添加${FIGURE_LABELS[model]}`} onClick={onAdd} className="group flex min-h-28 flex-col items-center overflow-hidden rounded-lg border border-border bg-card p-1.5 text-xs hover:border-studio-accent/60 hover:bg-muted/50 disabled:opacity-40">
    <span className="flex h-20 w-full items-center justify-center">{images.stand ? <img src={images.stand} alt="" className="size-full object-contain" /> : <UserRound className="size-8 text-muted-foreground" />}</span>
    <span className="flex items-center gap-1 pb-1"><Plus className="size-3 text-studio-accent" />{FIGURE_LABELS[model]}</span>
  </button>
}

export function DirectorPoseLibrary({ model, value, onSelect }: { model: FigureModel; value: PoseId; onSelect: (pose: PoseId) => void }) {
  const images = useThumbnails(model)
  return <section aria-label="人台动作预设" className="space-y-2">
    <div className="flex items-center justify-between"><h4 className="text-xs font-medium">动作姿势</h4><span className="text-[10px] text-muted-foreground">12 种 · {FIGURE_LABELS[model]}</span></div>
    <div role="group" aria-label="人台动作" className="grid grid-cols-3 gap-1.5">{(Object.entries(POSE_LABELS) as Array<[PoseId, string]>).map(([pose, label]) => <button key={pose} type="button" aria-label={`${label}姿势`} aria-pressed={value === pose} onClick={() => onSelect(pose)} className={cn('relative flex min-h-24 flex-col items-center rounded-lg border p-1 text-[11px] transition-colors', value === pose ? 'border-studio-accent bg-studio-accent/10 text-studio-accent ring-1 ring-studio-accent/30' : 'border-border bg-card text-foreground hover:border-studio-accent/50 hover:bg-muted')}>
      <span className="flex h-16 w-full items-center justify-center">{images[pose] ? <img src={images[pose]} alt="" className="size-full object-contain" /> : <LoaderCircle className="size-4 animate-spin text-muted-foreground" />}</span><span>{label}</span>{value === pose && <Check className="absolute right-1 top-1 size-3" aria-hidden="true" />}
    </button>)}</div>
    <p className="text-[10px] leading-5 text-muted-foreground">姿势包含手指与身体关节，应用后仍可微调。走位和运镜通过下方时间轴设置。</p>
  </section>
}
