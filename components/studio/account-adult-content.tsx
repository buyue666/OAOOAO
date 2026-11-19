'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { request } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { useUiText } from '@/lib/studio/i18n'

type ContentPreference = { enabled: boolean; policyVersion: string; acknowledgedAt: string | null }
type ContentResponse = { adultContent: ContentPreference; agreement: { title: string; sections: { title: string; text: string }[] }; models: { allowed: { id: string; name: string }[]; blocked: { id: string; name: string }[] } }

export function AccountAdultContentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, refreshSession } = useStudio()
  return <ContentDialog key={state.user.id} open={open} onOpenChange={onOpenChange} refreshSession={refreshSession} />
}

function ContentDialog({ open, onOpenChange, refreshSession }: { open: boolean; onOpenChange: (open: boolean) => void; refreshSession: () => Promise<unknown> }) {
  const tx = useUiText()
  const [data, setData] = useState<ContentResponse | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [adultConfirmed, setAdultConfirmed] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [revision, setRevision] = useState(0)
  const lock = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(''); setSaved(false); setData(null); setAdultConfirmed(false); setAgreed(false)
    request<ContentResponse>('/api/account/content-preference', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setData(value); setEnabled(value.adultContent.enabled) } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '设置读取失败，请重试。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, revision])
  async function save() {
    if (!data || lock.current || enabled && (!adultConfirmed || !agreed)) return
    lock.current = true; setSaving(true); setError(''); setSaved(false)
    try {
      const result = await request<ContentResponse>('/api/account/content-preference', { method: 'PATCH', body: JSON.stringify({ enabled, ...(enabled ? { adultConfirmed, acknowledgedPolicyVersion: data.adultContent.policyVersion } : {}) }) })
      if (!alive.current) return
      setData(result); setEnabled(result.adultContent.enabled)
      await refreshSession()
      if (alive.current) setSaved(true)
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '保存失败，请重试。') }
    finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!lock.current) onOpenChange(value) }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto p-5 sm:max-w-2xl sm:p-6" showCloseButton={!saving}>
      <DialogTitle className="text-xl font-semibold">{tx('成人内容设置')}</DialogTitle>
      <DialogDescription>{tx('默认关闭。仅面向已成年并同意使用约定的用户，对当前账号的所有空间生效。')}</DialogDescription>
      {loading && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{tx('正在读取设置…')}</p>}
      {data && <>
        <fieldset disabled={saving} className="rounded-xl border border-border bg-muted/30 p-4">
          <label className="flex cursor-pointer items-start justify-between gap-4"><span><span className="block font-medium">{tx('展示成人内容')}</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">{tx('开启后展示成人风格素材，并仅允许调用管理员授权用于成人内容的模型。')}</span></span><input type="checkbox" role="switch" aria-label={tx('展示成人内容')} checked={enabled} onChange={event => { setEnabled(event.target.checked); setAdultConfirmed(false); setAgreed(false); setSaved(false) }} className="mt-1 size-5 shrink-0 accent-teal-600" /></label>
        </fieldset>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6 text-foreground"><p className="flex items-center gap-2 font-medium"><CircleAlert className="size-4 shrink-0" />{tx('开启后，部分模型将禁止使用')}</p><p className="mt-1 text-xs">{data.models.allowed.length ? tx('可用模型：{0}', [data.models.allowed.map(model => model.name || model.id).join('、')]) : tx('目前没有获准用于成人内容的模型。开启后将无法发起模型生成；可以关闭成人内容恢复普通模型。')}</p>{data.models.blocked.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">{tx('查看受限模型（{0}）', [data.models.blocked.length])}</summary><p className="mt-2 text-muted-foreground">{data.models.blocked.map(model => model.name || model.id).join('、')}</p></details>}</div>
        <section aria-label={tx('成人内容使用约定')} className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-semibold">{tx(data.agreement.title)}</h3>{data.agreement.sections.map((section, index) => <div key={section.title} className="space-y-1"><h4 className="text-sm font-medium">{index + 1}. {tx(section.title)}</h4><p className="text-xs leading-6 text-muted-foreground">{tx(section.text)}</p></div>)}</section>
        {enabled && !data.adultContent.enabled && <fieldset disabled={saving} className="space-y-3 rounded-xl border border-border p-4 text-sm"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0 accent-teal-600" /><span>{tx('我声明已满 18 周岁，并达到所在地适用的成年年龄。')}</span></label><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} className="mt-1 size-4 shrink-0 accent-teal-600" /><span>{tx('我已阅读并同意成人内容使用约定，理解开启后部分模型将不可用。')}</span></label></fieldset>}
      </>}
      {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{tx(error)}</p><button type="button" disabled={saving} onClick={() => setRevision(value => value + 1)} className="underline underline-offset-4">{tx('重新读取')}</button></div>}
      {saved && <p role="status" className="flex items-center gap-2 text-sm text-teal-700 dark:text-teal-300"><Check className="size-4" />{tx(enabled ? '成人内容已开启，模型列表已按权限更新。' : '成人内容已关闭，成人素材已隐藏，普通模型已恢复。')}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" disabled={saving} onClick={() => onOpenChange(false)} className="rounded-lg border border-border px-4 py-2 hover:bg-muted">{tx('关闭')}</button><button type="button" onClick={() => void save()} disabled={loading || saving || !data || enabled === data.adultContent.enabled || enabled && (!adultConfirmed || !agreed)} className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:cursor-not-allowed disabled:opacity-40">{tx(saving ? '正在保存…' : '保存设置')}</button></div>
    </DialogContent>
  </Dialog>
}

export function AdultContentNotice() {
  const { state } = useStudio(), tx = useUiText(), [open, setOpen] = useState(false)
  if (state.backendStatus !== 'connected' || !state.sessionSettings?.adultContent?.enabled) return null
  return <><div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs text-foreground"><span className="flex items-center gap-2"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />{tx('成人内容已开启，仅可使用获准的模型。')}</span><button type="button" onClick={() => setOpen(true)} className="font-medium underline underline-offset-4 hover:text-studio-accent">{tx('管理成人内容')}</button></div><AccountAdultContentDialog open={open} onOpenChange={setOpen} /></>
}
