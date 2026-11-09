'use client'

import { Check, Moon, Sun } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { cn } from '@/lib/utils'

export function CanvasThemeButton() {
  const { state, toggleTheme } = useStudio()
  const label = state.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'
  const Icon = state.theme === 'dark' ? Sun : Moon
  return <button type="button" aria-label={label} title={label} onClick={toggleTheme} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Icon className="size-4" aria-hidden="true" /></button>
}

/** Explicit shape and check state, independent of the browser's native color scheme. */
export function CanvasViewToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><span>{label}</span><span aria-hidden="true" className={cn('grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/60 bg-background')}>{checked && <Check className="size-3" strokeWidth={2.5} />}</span></button>
}
