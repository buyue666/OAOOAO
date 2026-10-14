'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { request } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'

type WatermarkPreference = { enabled: boolean; policyVersion: string; acknowledgedAt?: string | null }
type PreferenceResponse = { watermark: WatermarkPreference }

export function AccountWatermarkMenuItem({ onSelect }: { onSelect?: () => void }) {
  const { state } = useStudio()
  // A new account gets a new dialog and cannot inherit the previous account's response or draft.
  return <WatermarkMenu key={state.user.id} userId={state.user.id} onSelect={onSelect} />
}

function WatermarkMenu({ userId, onSelect }: { userId: string; onSelect?: () => void }) {
  const [open, setOpen] = useState(false)
  const [preference, setPreference] = useState<WatermarkPreference | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [reload, setReload] = useState(0)
  const mounted = useRef(true)
  const saveLock = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(''); setSaved(false); setPreference(null); setAcknowledged(false)
    request<PreferenceResponse>('/api/account/watermark-preference', { signal: controller.signal })
      .then(({ watermark }) => { if (!controller.signal.aborted) { setPreference(watermark); setEnabled(watermark.enabled) } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '设置读取失败，请重试。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, reload, userId])

  async function save() {
    if (!preference || saveLock.current || (!enabled && !acknowledged)) return
    saveLock.current = true; setSaving(true); setError(''); setSaved(false)
    try {
      const { watermark } = await request<PreferenceResponse>('/api/account/watermark-preference', {
        method: 'PATCH', body: JSON.stringify({ enabled, ...(!enabled ? { acknowledgedPolicyVersion: preference.policyVersion } : {}) }),
      })
      if (mounted.current) { setPreference(watermark); setEnabled(watermark.enabled); setSaved(true) }
    } catch (reason) {
      if (mounted.current) setError(`${reason instanceof Error ? reason.message : '保存失败'}。可重新读取确认当前设置。`)
    } finally { saveLock.current = false; if (mounted.current) setSaving(false) }
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!saveLock.current) setOpen(value) }}>
    <button type="button" role="menuitem" onClick={() => { setOpen(true); onSelect?.() }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />AI 水印设置</button>
    <DialogContent className="max-h-[90dvh] overflow-y-auto p-6 sm:max-w-xl" showCloseButton={!saving}>
      <DialogTitle className="text-xl font-semibold">AI 生成内容水印</DialogTitle>
      <DialogDescription>决定此账户之后下载图片、视频时，是否添加 OAOOAO 的可见 AI 生成标识。</DialogDescription>
      <div className="space-y-3 text-sm leading-7 text-muted-foreground">
        <p>默认开启时，导出副本底部会增加 AI 生成标识条，文件高度略有增加，原画面不会被遮挡。此设置不修改项目源文件、模型参考素材或已经下载的文件。</p>
        <p>如果申请不添加可见标识，请在公开发布或传播时主动声明内容由 AI 生成，并使用发布平台提供的标识功能，避免引起误解。请勿违法删除、遮盖或篡改已有的 AI 标识；上游已附带的标识不会因此移除。</p>
        <p>平台会记录设置确认与无可见标识的导出操作，相关记录保留不少于六个月。此开关仅控制可见标识。</p>
      </div>
      {loading ? <p role="status" className="flex items-center gap-2 py-3 text-sm"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />正在读取账户设置…</p> : preference && <fieldset disabled={saving} className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
        <label className="flex cursor-pointer items-center justify-between gap-4"><span><span className="block font-medium">导出时添加 AI 生成标识</span><span className="mt-1 block text-xs text-muted-foreground">图片和视频 · 当前账户</span></span><span className="relative inline-flex shrink-0"><input type="checkbox" role="switch" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setAcknowledged(false); setSaved(false) }} className="peer sr-only" /><span aria-hidden="true" className="h-6 w-11 rounded-full border border-border bg-muted transition-colors peer-checked:border-teal-600 peer-checked:bg-teal-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-500 peer-disabled:opacity-50 after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5 motion-reduce:transition-none motion-reduce:after:transition-none" /></span></label>
        {!enabled && <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-4 text-xs leading-6"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 size-4 shrink-0 accent-teal-600" /><span>我已阅读以上说明，申请导出不添加 OAOOAO 可见 AI 标识的内容，并确认会履行发布时的标识义务。</span></label>}
      </fieldset>}
      {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><button type="button" disabled={saving} onClick={() => setReload((value) => value + 1)} className="underline underline-offset-4">重新读取</button></div>}
      {saved && <p role="status" className="flex items-center gap-2 text-sm text-teal-700 dark:text-teal-300"><Check className="size-4" />已保存，下一次导出时生效。</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" disabled={saving} onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 hover:bg-muted">关闭</button><button type="button" onClick={() => void save()} disabled={loading || saving || !preference || enabled === preference.enabled || (!enabled && !acknowledged)} className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:cursor-not-allowed disabled:opacity-40">{saving ? '正在保存…' : '保存设置'}</button></div>
    </DialogContent>
  </Dialog>
}
