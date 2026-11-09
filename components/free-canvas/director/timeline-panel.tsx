'use client'

import { useState } from 'react'
import { Diamond, Pause, Play, SkipBack, Trash2, UserRound, Video } from 'lucide-react'
import type { DirectorSceneData } from '../types'
import { cn } from '@/lib/utils'
import { CAMERA_MOTIONS, directorDuration, type CameraMotion } from './timeline'

export function DirectorTimeline({ readOnly=false, scene, time, playing, selectedId, onTime, onPlaying, onDuration, onRecord, onDelete, onMotion, onSelect }: {
  readOnly?:boolean; scene: DirectorSceneData; time: number; playing: boolean; selectedId: string | null
  onTime: (time: number) => void; onPlaying: (value: boolean) => void; onDuration: (value: number) => void
  onRecord: () => void; onDelete: () => void; onMotion: (motion: CameraMotion) => void; onSelect: (id: string, kind: 'actor' | 'camera') => void
}) {
  const [motion, setMotion] = useState<CameraMotion>('dollyIn')
  const duration = directorDuration(scene)
  const rows = [...scene.actors.map(item => ({ ...item, kind: 'actor' as const })), ...scene.cameras.map(item => ({ ...item, kind: 'camera' as const }))]
  const selected = rows.find(item => item.id === selectedId)
  const button = 'flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-foreground hover:bg-muted disabled:opacity-35'
  return <section aria-label="走位与运镜时间轴" className="shrink-0 border-t border-border bg-card">
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
      <button type="button" title={playing ? '暂停（空格）' : '播放预演（空格）'} aria-label={playing ? '暂停预演' : '播放预演'} onClick={() => onPlaying(!playing)} className={cn(button, 'size-9 bg-primary text-primary-foreground hover:bg-primary/90')}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
      <button type="button" aria-label="回到开头" title="回到开头" className={button} onClick={() => { onPlaying(false); onTime(0) }}><SkipBack className="size-4" /></button>
      <output className="min-w-24 shrink-0 px-1 text-xs tabular-nums">{time.toFixed(2)} / {duration.toFixed(1)} 秒</output>
      <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">时长<select aria-label="预演时长" disabled={readOnly} value={duration} onChange={event => onDuration(Number(event.target.value))} className="h-8 rounded-md border border-border bg-background px-1 text-foreground">{Array.from({ length: 29 }, (_, i) => 1 + i / 2).map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label>
      <button type="button" disabled={readOnly || !selected || playing} title="记录选中角色或机位当前状态（K）" className={cn(button, 'bg-muted')} onClick={onRecord}><Diamond className="size-3.5" />记录关键帧</button>
      <button type="button" disabled={readOnly || !selected?.keys?.some(key => Math.abs(key.t - time) < .03) || playing} title="删除当前时刻关键帧" aria-label="删除当前关键帧" className={button} onClick={onDelete}><Trash2 className="size-3.5" /></button>
      <select aria-label="运镜预设" value={motion} onChange={event => setMotion(event.target.value as CameraMotion)} className="ml-2 h-8 min-w-24 shrink-0 rounded-md border border-border bg-background px-2 text-xs">{Object.entries(CAMERA_MOTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <button type="button" disabled={readOnly || selected?.kind !== 'camera' || playing} className={button} onClick={() => onMotion(motion)}>应用运镜</button>
    </div>
    <div className="flex items-center gap-3 px-3 py-1"><span className="w-24 shrink-0 text-[10px] text-muted-foreground">播放头</span><input aria-label="预演时间" type="range" min="0" max={duration} step="0.01" value={time} className="h-6 min-w-0 flex-1 accent-studio-accent" onChange={event => { onPlaying(false); onTime(Number(event.target.value)) }} /></div>
    <div className="max-h-24 overflow-y-auto px-3 pb-2">{rows.map(item => <div key={item.id} className={cn('flex h-7 items-center gap-3 rounded', selectedId === item.id && 'bg-studio-accent/5')}>
      <button type="button" title={item.name} onClick={() => {if(!readOnly)onSelect(item.id, item.kind)}} className={cn('flex h-7 w-24 shrink-0 items-center gap-1 truncate text-left text-[10px]', selectedId === item.id ? 'font-medium text-studio-accent' : 'text-muted-foreground')}>{item.kind === 'actor' ? <UserRound className="size-3 shrink-0" /> : <Video className="size-3 shrink-0" />}<span className="truncate">{item.name}</span></button>
      <div className="relative h-5 min-w-0 flex-1 rounded bg-muted/50" aria-label={`${item.name}关键帧`}>
        <div className="pointer-events-none absolute inset-y-0 w-px bg-studio-accent" style={{ left: `${time / duration * 100}%` }} />
        {(item.keys ?? []).map(key => <button key={key.t} type="button" title={`${item.name} · ${key.t} 秒`} aria-label={`${item.name} ${key.t} 秒关键帧`} className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-studio-accent', Math.abs(time - key.t) < .03 && 'text-studio-accent')} style={{ left: `${key.t / duration * 100}%` }} onClick={() => { onPlaying(false); if(!readOnly)onSelect(item.id, item.kind); onTime(key.t) }}><Diamond className="size-3 fill-current" /></button>)}
      </div>
    </div>)}</div>
  </section>
}
