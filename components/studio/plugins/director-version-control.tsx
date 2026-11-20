'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, History, LoaderCircle } from 'lucide-react'
import { directorVersions, type DirectorPluginVersion } from '@/lib/studio/creative-plugin-versions'
import { usePlugins } from '@/lib/studio/plugin-context'
import { useUiText } from '@/lib/studio/i18n'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-3 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40'
export function DirectorVersionControl({ beforeChange, onChanged, activeVersion, compact = false, disabled = false }: { beforeChange?: () => Promise<boolean | void>; onChanged?: (version: DirectorPluginVersion) => void; activeVersion?: DirectorPluginVersion; compact?: boolean; disabled?: boolean }) {
  const plugins = usePlugins(), tx = useUiText()
  const [open, setOpen] = useState(false), [chosen, setChosen] = useState<DirectorPluginVersion>(plugins.directorVersion)
  const [automatic, setAutomatic] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState('')
  const current = activeVersion ?? plugins.directorVersion, latest = directorVersions[0].version
  useEffect(() => { if (!open) { setChosen(current); setAutomatic(plugins.preferences.director?.autoUpdate ?? false) } }, [open, current, plugins.preferences.director?.autoUpdate])
  async function apply() {
    setWorking(true); setError('')
    try {
      if (beforeChange && await beforeChange() === false) throw Error(tx('请先保存工程，再切换版本。'))
      if (!await plugins.setDirectorVersion(automatic ? latest : chosen, automatic)) throw Error(tx('版本设置未保存，仍使用原版本。'))
      setOpen(false)
      onChanged?.(automatic ? latest : chosen)
    } catch (reason) { setError(reason instanceof Error ? reason.message : tx('版本切换失败，请重试。')) }
    finally { setWorking(false) }
  }
  return <>
    <button type="button" className={button} disabled={disabled || !plugins.ready || Boolean(plugins.pending)} onClick={() => setOpen(true)} aria-label={tx('选择导演台版本')} title={tx('选择旧版本或更新功能')}><History className="size-3.5 shrink-0" aria-hidden="true" /><span>{compact ? `v${current}` : `${tx('版本')} ${current}`}</span>{!compact && current !== latest && <span className="rounded bg-studio-accent/15 px-1.5 py-0.5 text-[10px] text-studio-accent">{tx('有更新')}</span>}</button>
    <Dialog open={open} onOpenChange={value => { if (!working) setOpen(value) }}>
      <DialogContent className="z-[150] max-h-[85dvh] overflow-y-auto" overlayClassName="z-[140]" showCloseButton={false}>
        <DialogHeader><DialogTitle>{tx('导演台版本')}</DialogTitle><DialogDescription>{tx('保留熟悉的界面，按需更新或切回旧版。选择会保存到你的账号。')}</DialogDescription></DialogHeader>
        <fieldset disabled={working} className="space-y-2" aria-label={tx('可用版本')}>
          {directorVersions.map(release => <label key={release.version} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${chosen === release.version ? 'border-studio-accent bg-studio-accent/8' : 'border-border hover:bg-muted/50'}`}>
            <input type="radio" name="director-version" className="mt-1 accent-[var(--studio-accent)]" checked={chosen === release.version} onChange={() => { setChosen(release.version); setAutomatic(false) }} />
            <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">v{release.version}<span>{tx(release.label)}</span>{release.version === current && <span className="text-xs text-studio-accent">{tx('当前使用')}</span>}</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">{tx(release.note)}</span></span>
          </label>)}
        </fieldset>
        {chosen === '0.1.0' && <p className="flex gap-2 rounded-xl bg-muted p-3 text-xs leading-6 text-muted-foreground"><AlertCircle className="mt-1 size-4 shrink-0" aria-hidden="true" />{tx('经典简版使用原始人物与机位工程；新版的场景、道具和时间线会完整保留。切回新版即可继续，两份工程不会相互覆盖。')}</p>}
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={automatic} disabled={working} onChange={event => { setAutomatic(event.target.checked); if (event.target.checked) setChosen(latest) }} />{tx('自动使用最新版本（默认关闭）')}</label>
        {(error || plugins.error) && <p role="alert" className="text-xs leading-6 text-destructive">{error || plugins.error}</p>}
        <DialogFooter><button type="button" className={button} disabled={working} onClick={() => setOpen(false)}>{tx('取消')}</button><button type="button" className={`${button} border-studio-accent/40 bg-studio-accent/15`} disabled={working || Boolean(plugins.pending)} onClick={() => void apply()}>{working && <LoaderCircle className="size-4 animate-spin" />}{tx(working ? '正在保存并切换…' : beforeChange ? '保存工程并切换' : '应用版本')}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
