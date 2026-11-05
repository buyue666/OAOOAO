'use client'

import {useId} from 'react'

/** Indexing the supported values keeps discrete provider durations valid. */
export function VideoDurationSlider({value, options, onChange, disabled = false}: {value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean}) {
  const id = useId()
  const index = Math.max(0, options.indexOf(value))
  const selected = options[index] || ''
  const percent = options.length > 1 ? index / (options.length - 1) * 100 : 0
  return <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
    <div className="flex items-center justify-between gap-3 text-xs"><label htmlFor={id} className="font-medium">时长</label><output htmlFor={id} className="font-semibold tabular-nums text-studio-accent">{selected || '暂无可选时长'}</output></div>
    <input id={id} type="range" aria-label="视频时长" aria-valuetext={selected} min="0" max={Math.max(0, options.length - 1)} step="1" value={index} disabled={disabled || options.length < 2} onChange={event => {const next = options[Number(event.target.value)]; if (next) onChange(next)}} className="video-duration-slider min-h-11 w-full cursor-pointer accent-studio-accent disabled:cursor-default" style={{backgroundSize: `${percent}% 100%`}} />
    <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground"><span>{options[0] || '—'}</span><span>{options.at(-1) || '—'}</span></div>
  </div>
}
