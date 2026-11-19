'use client'

import { Check, Moon, RotateCcw, Sun } from 'lucide-react'
import { SettingsDisclosure } from './settings-disclosure'
import { useStudio } from '@/lib/studio/store'
import { appearancePresets, defaultAppearance, type StudioAppearance } from '@/lib/studio/appearance'
import type { StudioSkin } from '@/lib/studio/types'

export function AppearanceSettings() {
  const { state, dispatch, setTheme, setSkin } = useStudio()
  const appearance = state.appearance
  const update = (patch: Partial<StudioAppearance>) => dispatch({ type: 'SET_APPEARANCE', appearance: { ...appearance, ...patch } })
  const choice = 'appearance-choice relative min-h-11 rounded-xl border border-border px-3 py-2 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  const material = state.skin === 'minimal' ? '极简' : state.skin === 'soft' ? '柔雾' : '液态玻璃'
  return <SettingsDisclosure id="appearance" title="界面主题" summary={`${material} · ${state.theme === 'dark' ? '深色' : '浅色'} · ${appearancePresets.find(item => item.id === appearance.preset)?.label || '薄荷光影'}`}>
    <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-6 text-muted-foreground">配色、材质与布局独立选择，自动保存。</p><button type="button" onClick={() => { setSkin('glass'); dispatch({ type: 'SET_APPEARANCE', appearance: { ...defaultAppearance } }) }} className={`${choice} flex items-center gap-2`}><RotateCcw className="size-3.5" />恢复默认外观</button></div>
    <fieldset><legend className="mb-3 text-xs font-semibold">明暗模式</legend><div className="grid gap-2 sm:grid-cols-2">{([{ id: 'dark', label: '深色', icon: Moon }, { id: 'light', label: '浅色', icon: Sun }] as const).map(item => <button key={item.id} type="button" aria-pressed={state.theme === item.id} onClick={() => setTheme(item.id)} className={`${choice} flex items-center gap-2`}><item.icon className="size-4" />{item.label}{state.theme === item.id && <Check className="ml-auto size-4" />}</button>)}</div></fieldset>
    <fieldset><legend className="mb-3 text-xs font-semibold">界面材质</legend><div className="grid gap-3 sm:grid-cols-3">{([{ id: 'glass', label: '液态玻璃', hint: '透光面板 · 柔和折射高光' }, { id: 'soft', label: '柔雾', hint: '细腻柔光 · 低透明层次' }, { id: 'minimal', label: '极简', hint: '实心表面 · 清晰利落' }] as Array<{ id: StudioSkin; label: string; hint: string }>).map(item => <button key={item.id} type="button" aria-pressed={state.skin === item.id} onClick={() => setSkin(item.id)} className={`${choice} p-3`}><span aria-hidden="true" className={`appearance-material-preview appearance-material-${item.id}`}><span /><span /></span><span className="mt-3 flex items-center justify-between text-sm font-semibold">{item.label}{state.skin === item.id && <Check className="size-4" />}</span><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{item.hint}</span></button>)}</div></fieldset>
    <fieldset><legend className="mb-3 text-xs font-semibold">颜色预设</legend><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{appearancePresets.map(item => <button key={item.id} type="button" aria-pressed={appearance.preset === item.id} onClick={() => update({ preset: item.id })} className={`${choice} p-2.5`}><span aria-hidden="true" className="block h-16 rounded-lg border border-black/10" style={{ background: `linear-gradient(135deg,${item.colors.join(',')})` }} /><span className="mt-2 flex items-center justify-between gap-1 leading-5">{item.label}{appearance.preset === item.id && <Check className="size-4 shrink-0" />}</span></button>)}</div></fieldset>
    <div className="grid gap-6 xl:grid-cols-3">
      <fieldset><legend className="mb-3 text-xs font-semibold">字体</legend><div className="grid grid-cols-3 gap-2">{([{ id: 'auto', label: '系统' }, { id: 'sans', label: '无衬线' }, { id: 'serif', label: '衬线' }] as const).map(item => <button key={item.id} type="button" aria-pressed={appearance.font === item.id} onClick={() => update({ font: item.id })} className={`${choice} px-1 text-center`}><span className="mb-1 block text-lg" style={{ fontFamily: item.id === 'serif' ? 'Georgia,serif' : item.id === 'sans' ? 'Arial,sans-serif' : 'system-ui' }}>Aa</span>{item.label}</button>)}</div></fieldset>
      <fieldset><legend className="mb-3 text-xs font-semibold">圆角</legend><div className="grid grid-cols-4 gap-2">{([{ id: 'square', label: '直角', size: 0 }, { id: 'small', label: '小', size: 5 }, { id: 'medium', label: '中', size: 10 }, { id: 'large', label: '大', size: 17 }] as const).map(item => <button key={item.id} type="button" aria-pressed={appearance.radius === item.id} onClick={() => update({ radius: item.id })} className={`${choice} px-1 text-center`}><span aria-hidden="true" className="mx-auto mb-2 block size-7 border-l-2 border-t-2 border-current" style={{ borderTopLeftRadius: item.size }} />{item.label}</button>)}</div></fieldset>
      <fieldset><legend className="mb-3 text-xs font-semibold">布局密度</legend><div className="grid grid-cols-3 gap-2">{([{ id: 'compact', label: '紧凑', gap: 3 }, { id: 'default', label: '默认', gap: 6 }, { id: 'comfortable', label: '宽松', gap: 9 }] as const).map(item => <button key={item.id} type="button" aria-pressed={appearance.density === item.id} onClick={() => update({ density: item.id })} className={`${choice} px-1 text-center`}><span aria-hidden="true" className="mx-auto mb-2 flex h-8 w-8 flex-col justify-center" style={{ gap: item.gap }}>{[0, 1, 2].map(n => <span key={n} className="h-px w-full bg-current" />)}</span>{item.label}</button>)}</div></fieldset>
    </div>
    <p className="text-[11px] leading-6 text-muted-foreground">玻璃效果只用于导航、主面板和浮层；素材缩略图保持清晰。系统开启“减少透明度”时自动使用实心表面。</p>
    </div>
  </SettingsDisclosure>
}
