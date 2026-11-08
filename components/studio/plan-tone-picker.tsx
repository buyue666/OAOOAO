'use client'

import { Check } from 'lucide-react'
import { allPlanTones, gradientPlanTones, toneLabels } from '@/lib/studio/membership'
import type { PlanTone } from '@/components/membership/types'
import styles from '@/components/membership/membership.module.css'
import { AdminSelect } from './admin-kit'

export function PlanTonePicker({ value, onChange, allowAutomatic = false }: { value: string; onChange: (value: string) => void; allowAutomatic?: boolean }) {
  return <div className="space-y-3">
    <AdminSelect aria-label="配色" value={value} onChange={event => onChange(event.target.value)}>{allowAutomatic && <option value="">自动（按分组顺序）</option>}<optgroup label="纯色">{allPlanTones.filter(tone => !gradientPlanTones.includes(tone)).map(tone => <option key={tone} value={tone}>{toneLabels[tone]}</option>)}</optgroup><optgroup label="渐变">{gradientPlanTones.map(tone => <option key={tone} value={tone}>{toneLabels[tone]}</option>)}</optgroup></AdminSelect>
    {(['solid','gradient'] as const).map(group => <div key={group}><p className="mb-2 text-xs text-muted-foreground">{group === 'solid' ? '纯色' : '渐变'}</p><div className={styles.toneOptions} role="group" aria-label={group === 'solid' ? '纯色配色' : '渐变配色'}>{allPlanTones.filter(tone => gradientPlanTones.includes(tone) === (group === 'gradient')).map((tone: PlanTone) => <button type="button" key={tone} className={styles.toneSwatch} data-tone={tone} title={toneLabels[tone]} aria-label={toneLabels[tone]} aria-pressed={value === tone} onClick={() => onChange(tone)}>{value === tone && <span className={styles.toneCheck}><Check aria-hidden className="size-3" /></span>}</button>)}</div></div>)}
  </div>
}
