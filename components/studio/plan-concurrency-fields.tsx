import { ChevronDown } from 'lucide-react'
import type { GenerationConcurrencySettings } from '@/lib/studio/admin-types'
import { AdminField, AdminInput } from './admin-kit'

export const CONCURRENCY_FIELDS = [
  ['agent', '创作助手'], ['image', '图片'], ['video', '视频'],
  ['audio', '音频'], ['text', '文本'], ['render', '成片合成'],
] as const satisfies ReadonlyArray<readonly [keyof GenerationConcurrencySettings, string]>

type Overrides = Partial<GenerationConcurrencySettings>
export function PlanConcurrencyFields({ value, defaults, disabled, onChange }: {
  value?: Overrides; defaults: GenerationConcurrencySettings; disabled?: boolean; onChange: (value?: Overrides) => void;
}) {
  const count = CONCURRENCY_FIELDS.filter(([key]) => value?.[key] !== undefined).length
  return (
    <details className="group/concurrency mt-4 rounded-lg border border-border" onInvalid={event => { event.currentTarget.open = true }}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        生成并发限制 <span className="text-xs font-normal text-muted-foreground">{count ? `${count} 项单独设置` : '沿用全局默认'}</span>
        <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground group-open/concurrency:rotate-180" />
      </summary>
      <fieldset disabled={disabled} className="space-y-3 border-t border-border px-3 py-3">
        <legend className="sr-only">各类任务的个人并发上限</legend>
        <p className="text-xs leading-5 text-muted-foreground">每人按任务类型分别限制。留空则沿用全局默认，可填 1–100；排队、运行和暂停的任务均占用名额。</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{CONCURRENCY_FIELDS.map(([key, label]) => (
          <AdminField key={key} label={`${label}并发`} hint={`全局默认 ${defaults[key]} 项`}>
            <AdminInput type="number" min="1" max="100" step="1" value={value?.[key] ?? ''} placeholder={`默认 ${defaults[key]}`} onChange={event => {
              const next = { ...value }
              if (event.target.value === '') delete next[key]
              else next[key] = Number(event.target.value)
              onChange(Object.keys(next).length ? next : undefined)
            }} />
          </AdminField>
        ))}</div>
      </fieldset>
    </details>
  )
}
