'use client'

import { useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ControlButton } from './ui'
import { AdminInput, AdminSelect } from './admin-kit'

export type PlanModelOption = { id: string; name: string; capability: string; enabled: boolean }
const groups = [['image', '图片模型'], ['video', '视频模型'], ['text', '文本模型'], ['audio', '音频模型']] as const

/** Both plan editors persist logical IDs, so aliases cannot bypass a model scope. */
export function PlanModelControl({ models, value, onChange, disabled = false }: { models: readonly PlanModelOption[]; value?: string[]; onChange: (value: string[] | undefined) => void; disabled?: boolean }) {
  const [keyword, setKeyword] = useState('')
  const id = useId()
  const restricted = value !== undefined
  const selected = value || []
  const filtered = useMemo(() => models.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(keyword.trim().toLowerCase())), [models, keyword])
  const missing = selected.filter(key => !models.some(model => model.id === key))
  return <fieldset disabled={disabled} className="min-w-0 rounded-xl border border-border bg-card p-4">
    <legend className="px-1 text-sm font-semibold">可用模型</legend>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-muted-foreground">模型使用范围</label>
      <AdminSelect id={id} value={restricted ? 'selected' : 'all'} onChange={event => onChange(event.target.value === 'all' ? undefined : [])} className="w-full sm:w-48"><option value="all">全部可用模型</option><option value="selected">仅限所选模型</option></AdminSelect>
    </div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{restricted ? `已选 ${selected.length} 个模型。模型别名与原模型使用相同权限。` : '包含当前及以后新增的可用模型；已停用或没有渠道的模型不会开放。'}</p>
    {restricted && <div className="mt-4 space-y-4">
      <label className="relative block"><span className="sr-only">搜索套餐模型</span><Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><AdminInput type="search" placeholder="搜索模型名称或 ID" value={keyword} onChange={event => setKeyword(event.target.value)} className="min-h-11 pl-9" /></label>
      <div className="flex flex-wrap gap-2"><ControlButton type="button" size="sm" onClick={() => onChange([...new Set([...selected, ...filtered.filter(model => model.enabled).map(model => model.id)])])}>选择当前结果</ControlButton><ControlButton type="button" size="sm" onClick={() => onChange([])}>清空选择</ControlButton></div>
      <div className="max-h-72 space-y-4 overflow-y-auto overscroll-contain pr-1">
        {groups.map(([kind, label]) => {
          const list = filtered.filter(model => model.capability === kind)
          return list.length ? <div key={kind}><p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p><div className="grid gap-1 sm:grid-cols-2">{list.map(model => <label key={model.id} className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selected.includes(model.id) ? 'border-primary/40 bg-primary/5 font-medium' : 'border-transparent hover:bg-muted/60'}`}><input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.includes(model.id)} onChange={event => onChange(event.target.checked ? [...selected, model.id] : selected.filter(key => key !== model.id))} /><span className="min-w-0 break-words">{model.name || model.id}{!model.enabled && <small className="ml-1 text-muted-foreground">（已停用）</small>}</span></label>)}</div></div> : null
        })}
        {!filtered.length && <p className="py-3 text-sm text-muted-foreground">没有匹配的模型。</p>}
        {missing.length > 0 && <div><p className="mb-1 text-xs text-muted-foreground">已移除的模型（保留原配置，可取消选择）</p>{missing.map(key => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked className="size-4 shrink-0 accent-primary" onChange={() => onChange(selected.filter(id => id !== key))} /><span className="break-all">{key}</span></label>)}</div>}
      </div>
      {!selected.length && <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">当前未选择模型，保存后将无法使用模型生成。</p>}
    </div>}
  </fieldset>
}
