'use client'

import {AdminField, AdminInput} from './admin-kit'
import type {ResolutionPricing} from '@/lib/studio/video-profile'

export function VideoGenerationPrices({quality, row, unit, allowed, conditional, longMultiplier, onChange}: {quality: string; row: ResolutionPricing; unit: string; allowed: number[]; conditional: boolean; longMultiplier: number; onChange: (patch: Partial<ResolutionPricing>) => void}) {
  const field = (label: string, value: number | null | undefined, change: (value: number | null) => void) => <AdminField label={label} hint="按输出视频计费；0 为免费，留空表示未配置"><AdminInput aria-label={label} type="number" min="0" step="0.0001" value={value ?? ''} placeholder="未配置" onChange={event => change(event.target.value.trim() ? Number(event.target.value) : null)} /></AdminField>
  if (unit === 'duration') return <div className="grid gap-3 sm:grid-cols-2">{allowed.map(seconds => <div key={seconds} className="space-y-3 rounded-lg border border-border p-3">{field(`${quality} ${seconds} 秒 · 普通生成积分/次`, row.generationDurationRates?.[seconds], value => {const next = {...row.generationDurationRates}; if (value === null) delete next[seconds]; else next[seconds] = value; onChange({generationDurationRates: next})})}{conditional && field(`${quality} ${seconds} 秒 · 参考视频生成积分/次`, row.referenceVideoGenerationDurationRates?.[seconds], value => {const next = {...row.referenceVideoGenerationDurationRates}; if (value === null) delete next[seconds]; else next[seconds] = value; onChange({referenceVideoGenerationDurationRates: next})})}</div>)}</div>
  return <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
    {field(`${quality} ${conditional ? '普通生成价格' : '生成价格'} · 积分/${unit === 'second' ? '秒' : '次'}`, row.generationRate, generationRate => onChange({generationRate}))}
    {conditional && field(`${quality} 参考视频生成价格 · 积分/${unit === 'second' ? '秒' : '次'}`, row.referenceVideoGenerationRate, referenceVideoGenerationRate => onChange({referenceVideoGenerationRate}))}
  </div>{conditional && <p className="text-xs leading-5 text-muted-foreground">有参考视频时切换生成单价，按输出视频时长计算，不另收参考视频费用。{longMultiplier !== 1 && Math.max(...allowed) > 15 ? `4–15 秒使用所填单价，16–30 秒自动 ×${longMultiplier}。` : ''}</p>}</div>
}
