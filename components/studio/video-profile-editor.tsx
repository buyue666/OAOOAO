'use client'

import {useState} from 'react'
import {AdminField, AdminInput, AdminSelect} from './admin-kit'
import {ControlButton} from './ui'
import {formatVideoDurations, parseVideoDurationInput, type VideoDurationRule} from '@/lib/studio/video-duration'
import {copyVideoResolutionParameters, durationRulesPatch, resolutionPricing, validVideoQuality, videoDurationRule, videoDurationValues, type ReferencePrices, type ResolutionPricing, type VideoPricing, type VideoProfile} from '@/lib/studio/video-profile'
import {qualityLabel} from '@/lib/studio/studio-models'

type RefRule = {maxCount?: number; freeCount?: number; maxItemSeconds?: number; maxTotalSeconds?: number}
export type ExtraVideoPriceField = {key: string; label: string; hint?: string; defaultValue?: number}
type Props = {
  profile?: VideoProfile
  onChange: (patch: VideoProfile) => void
  fallbackGenerationRate?: number
  defaultFreeCounts?: Record<string, number>
  longDurationMultiplier?: number
  extraPriceFields?: ExtraVideoPriceField[]
  showReferenceFieldMap?: boolean
}

export function VideoProfileEditor({profile = {}, onChange, fallbackGenerationRate, defaultFreeCounts = {}, longDurationMultiplier = 1, extraPriceFields = [], showReferenceFieldMap = true}: Props) {
  const [custom, setCustom] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sourceId, setSourceId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pricing = (profile.videoPricing || {}) as VideoPricing
  const unit = String(profile.videoBillingUnit || 'request')
  const qualities = (profile.videoQualities || []) as string[]
  const native = (profile.nativeVideoQualities || []) as string[]
  const choices = [...new Set([...qualities, ...native])]
  const selected = selectedIds.filter(quality => qualities.includes(quality))
  const source = selected.includes(sourceId) ? sourceId : selected[0] || ''
  const references = (profile.videoReferenceRules || {}) as Record<string, RefRule>
  const durationRules = (profile.videoDurationRules || {}) as Record<string, VideoDurationRule>
  const update = (patch: VideoProfile) => onChange({videoBillingUnit: unit, ...patch})
  const setRow = (quality: string, patch: Partial<ResolutionPricing>) => {
    const row = resolutionPricing(profile, quality, fallbackGenerationRate)
    update({videoPricing: {...pricing, resolutionPricing: {...pricing.resolutionPricing, [quality]: {...row, ...patch}}}})
  }
  const setDuration = (quality: string, rule: VideoDurationRule) => {
    if (!videoDurationValues(profile, quality, rule).length) {setError(`${quality} 没有可用的时长，请检查范围`); return}
    setError('')
    update(durationRulesPatch(profile, {...durationRules, [quality]: rule}))
  }
  const addQuality = () => {
    try {
      const quality = validVideoQuality(custom, choices)
      const next = {...profile, videoQualities: [...qualities, quality]}
      const rule = videoDurationRule(profile, qualities[0] || quality)
      update({...durationRulesPatch(next, {...durationRules, [quality]: rule}), videoQualities: next.videoQualities})
      setCustom(''); setError(''); setNotice(`已添加 ${quality}，请配置其生成和输入素材价格`)
    } catch (reason) {setError(reason instanceof Error ? reason.message : '添加清晰度失败')}
  }
  const priceField = (label: string, value: number | undefined, change: (text: string) => void, hint?: string) => <AdminField label={label} hint={hint}><AdminInput aria-label={label} type="number" min="0" step="0.0001" value={value ?? ''} placeholder="未配置" onChange={event => change(event.target.value)} /></AdminField>
  const inputPriceFields: Array<{key: keyof ReferencePrices; label: string}> = [
    ...(profile.supportsReferenceImage ? [{key: 'extraImage' as const, label: '超额图片 · 积分/张'}] : []),
    ...(profile.supportsVideoReference ? [{key: 'referenceVideoPerSecond' as const, label: '参考视频 · 积分/秒'}, {key: 'extraVideo' as const, label: '超额视频 · 积分/个'}] : []),
    ...(profile.supportsAudioReference ? [{key: 'referenceAudioPerSecond' as const, label: '参考音频 · 积分/秒'}, {key: 'extraAudio' as const, label: '超额音频 · 积分/个'}] : []),
  ]
  const referenceFields = (quality: string, prices: ReferencePrices, change: (value: ReferencePrices) => void, segment = '') => <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {inputPriceFields.map(({key, label}) => <div key={key}>{priceField(`${quality}${segment} ${label}`, prices[key], text => {
      const next = {...prices}; if (text.trim()) next[key] = Number(text); else delete next[key]; change(next)
    }, key === 'extraImage' ? '仅超出免费张数的部分计费；0 为免费' : key.startsWith('reference') ? '按实际参考时长计费；可填 0' : '可选附加单价，与按秒费用相加')}</div>)}
  </div>

  return <section className="w-full min-w-0 space-y-5 rounded-xl border border-border bg-muted/15 p-4" data-testid="video-capability-editor">
    <div><p className="text-sm font-semibold">视频能力与计费</p><p className="mt-1 text-xs leading-5 text-muted-foreground">按输出清晰度分别设置生成价格和输入素材价格，总价随生成时长与素材用量计算。</p></div>
    <AdminField label="视频计费方式"><AdminSelect value={unit} onChange={event => update({videoBillingUnit: event.target.value})}><option value="second">按生成秒数</option><option value="request">按次生成</option><option value="duration">按清晰度与指定时长定价</option></AdminSelect></AdminField>
    <fieldset className="space-y-2 border-t border-border pt-4"><legend className="text-xs font-semibold">首尾帧功能</legend>
      <div className="flex flex-wrap gap-5 text-xs">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(profile.supportsFirstFrame)} disabled={profile.nativeFirstFrame === false} onChange={event => update({supportsFirstFrame: event.target.checked, ...(event.target.checked ? {supportsReferenceImage: true} : {supportsLastFrame: false})})} />开启首帧</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(profile.supportsLastFrame)} disabled={!profile.supportsFirstFrame || profile.nativeLastFrame === false} onChange={event => update({supportsLastFrame: event.target.checked})} />开启尾帧</label>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">已确认支持的渠道默认开启；未知渠道手动选择。尾帧需配合首帧。</p>
      {showReferenceFieldMap && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-medium">参考素材接口字段映射</summary><p className="my-2 text-xs leading-5 text-muted-foreground">按上游文档填写文件字段名。首帧默认 input_reference；尾帧、视频、音频需单独配置。</p><div className="grid gap-3 sm:grid-cols-2">{[['first_frame','首帧字段'],['last_frame','尾帧字段'],['image','参考图字段'],['video','参考视频字段'],['audio','参考音频字段']].map(([key,label]) => <AdminField key={key} label={label}><AdminInput value={((profile.videoReferenceFieldMap || {}) as Record<string,string>)[key] || ''} placeholder={key === 'first_frame' || key === 'image' ? 'input_reference' : '按上游文档填写'} onChange={event => {const map = {...((profile.videoReferenceFieldMap || {}) as Record<string,string>)}; if (event.target.value.trim()) map[key] = event.target.value.trim(); else delete map[key]; update({videoReferenceFieldMap: map})}} /></AdminField>)}</div></details>}
    </fieldset>

    <div className="space-y-4 border-t border-border pt-4">
      <div className="space-y-3">
        <div><p className="text-sm font-semibold">清晰度与价格</p><p className="mt-1 text-xs leading-5 text-muted-foreground">填写上游接受的清晰度参数。勾选下方卡片后，可将来源清晰度的时长和价格复制到所选项。</p></div>
        <div className="flex flex-wrap items-end gap-2"><AdminField className="min-w-0 flex-1" label="新增清晰度"><AdminInput aria-label="新增清晰度" placeholder="例如 720p、1080p、2K" value={custom} onChange={event => setCustom(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); addQuality()}}} /></AdminField><ControlButton className="min-h-11" onClick={addQuality}>添加清晰度</ControlButton></div>
        <div className="flex flex-wrap gap-2">{choices.map(quality => <label key={quality} className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs"><input type="checkbox" aria-label={`启用清晰度 ${quality}`} checked={qualities.includes(quality)} onChange={event => update({videoQualities: event.target.checked ? [...qualities, quality] : qualities.filter(value => value !== quality)})} />{qualityLabel(quality)}</label>)}</div>
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background p-3"><p className="py-3 text-xs text-muted-foreground">已选 {selected.length} 个清晰度</p><AdminField className="min-w-32 flex-1" label="参数来源"><AdminSelect aria-label="清晰度参数来源" disabled={!selected.length} value={source} onChange={event => setSourceId(event.target.value)}>{!selected.length && <option value="">先勾选清晰度</option>}{selected.map(quality => <option key={quality} value={quality}>{qualityLabel(quality)}</option>)}</AdminSelect></AdminField><ControlButton className="min-h-11" disabled={selected.length < 2} onClick={() => {
          try {update(copyVideoResolutionParameters(profile, source, selected, fallbackGenerationRate)); setError(''); setNotice(`已将 ${source} 的时长和价格复制到其他所选清晰度，时长按各自上限调整。保存路由配置后生效。`)} catch (reason) {setError(reason instanceof Error ? reason.message : '批量修改失败')}
        }}>批量更改所选清晰度参数</ControlButton></div>
      </div>
      {!qualities.length && <p className="text-xs text-destructive" role="alert">请至少开启一种清晰度。</p>}
      {qualities.map(quality => {
        const rule = videoDurationRule(profile, quality), allowed = videoDurationValues(profile, quality), max = Math.max(...allowed, 1)
        const row = resolutionPricing(profile, quality, fallbackGenerationRate), tiers = row.referenceDurationTiers, localPrices = row.referencePrices || {}
        return <section key={quality} aria-label={`${quality} 参数与价格`} className={`min-w-0 space-y-4 rounded-xl border bg-background p-4 ${selected.includes(quality) ? 'border-studio-accent ring-1 ring-studio-accent/25' : 'border-border'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"><label className="flex min-h-11 items-center gap-3"><input type="checkbox" aria-label={`选择清晰度 ${quality}`} checked={selected.includes(quality)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, quality] : current.filter(value => value !== quality))} /><span className="text-sm font-semibold">{qualityLabel(quality)}</span><span className="text-xs text-muted-foreground">{formatVideoDurations(allowed) || '无可用时长'} 秒</span>{selected.includes(quality) && <span className="text-xs font-medium text-studio-accent">{source === quality ? '参数来源' : '已选择'}</span>}</label><ControlButton className="min-h-11" variant="ghost" aria-label={`移除清晰度 ${quality}`} onClick={() => update({videoQualities: qualities.filter(value => value !== quality)})}>移除</ControlButton></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AdminField label="时长选择方式"><AdminSelect aria-label={`${quality} 时长选择方式`} value={rule.mode} onChange={event => setDuration(quality, event.target.value === 'range' ? {mode: 'range', min: Math.min(...allowed, 4), max, step: 1} : {mode: 'list', values: allowed})}><option value="list">指定时长</option><option value="range">起始–结束范围</option></AdminSelect></AdminField>
            <AdminField className="sm:col-span-2" label={rule.mode === 'range' ? '时长范围（秒）' : '可选时长（秒）'} hint={rule.mode === 'range' ? '例如 4-30，包含起始和结束时长' : '连续时长填 4-30；固定档位填 4,6,8'}><AdminInput key={`${quality}:${JSON.stringify(rule)}`} aria-label={`${quality} ${rule.mode === 'range' ? '时长范围' : '可选时长'}`} defaultValue={rule.mode === 'range' ? `${rule.min}-${rule.max}` : formatVideoDurations(rule.values || [], ',')} placeholder="4-30 或 4,6,8" onBlur={event => {
              const parsed = parseVideoDurationInput(event.target.value)
              if (parsed) setDuration(quality, parsed.mode === 'range' ? {...parsed, step: rule.step || 1} : parsed)
              else {setError('请填写有效时长，例如 4-30 或 4,6,8'); event.target.value = rule.mode === 'range' ? `${rule.min}-${rule.max}` : formatVideoDurations(rule.values || [], ',')}
            }} /></AdminField>
            {rule.mode === 'range' && <AdminField label="步长（秒）"><AdminInput aria-label={`${quality} 时长步长`} type="number" min="1" value={rule.step || 1} onChange={event => setDuration(quality, {...rule, step: Number(event.target.value)})} /></AdminField>}
          </div>
          <div className="space-y-3 border-t border-border pt-3"><p className="text-xs font-semibold">生成视频价格</p>{unit !== 'duration' ? <div className="max-w-sm">{priceField(`${quality} 生成价格 · 积分/${unit === 'second' ? '秒' : '次'}`, row.generationRate ?? undefined, text => setRow(quality, {generationRate: text.trim() ? Number(text) : null}), '0 为免费；留空表示未配置，生成前必须填写')}</div> : <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">{allowed.map(seconds => <div key={seconds}>{priceField(`${quality} ${seconds} 秒 · 积分/次`, row.generationDurationRates?.[seconds], text => {const next = {...row.generationDurationRates}; if (text.trim()) next[seconds] = Number(text); else delete next[seconds]; setRow(quality, {generationDurationRates: next})}, '此时长的完整生成价格')}</div>)}</div>}</div>
          {inputPriceFields.length > 0 && <div className="space-y-3 border-t border-border pt-3"><div><p className="text-xs font-semibold">输入素材价格 · {qualityLabel(quality)} 输出</p><p className="mt-1 text-xs leading-5 text-muted-foreground">按生成结果的清晰度计价。免费数量与素材上限在下方统一设置。</p></div>
            <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" aria-label={`${quality} 按生成时长分段设置输入素材价格`} checked={Boolean(tiers)} onChange={event => {
              if (!event.target.checked) {setRow(quality, {referenceDurationTiers: undefined}); return}
              const multiplier = row.additionalPrices?.longVideoMultiplier ?? (pricing.longVideoMultiplier as number | undefined) ?? longDurationMultiplier
              const longPrices = Object.fromEntries(Object.entries(localPrices).map(([key, value]) => [key, Math.round(value * multiplier * 10000) / 10000]))
              setRow(quality, {referenceDurationTiers: max > 15 ? [{maxSeconds: 15, prices: {...localPrices}}, {maxSeconds: max, prices: longPrices}] : [{maxSeconds: max, prices: {...localPrices}}]})
            }} />按生成时长分段设置输入素材价格</label>
            {tiers ? <div className="space-y-3">{tiers.map((tier, index) => <div key={index} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"><div className="flex flex-wrap items-end gap-3"><p className="min-w-24 py-3 text-xs font-semibold">{index === 0 ? `${Math.min(...allowed)}-${tier.maxSeconds}` : `${tiers[index - 1].maxSeconds + 1}-${tier.maxSeconds}`} 秒生成视频</p><AdminField className="max-w-40" label="分段结束时长（秒）"><AdminInput aria-label={`${quality} 第${index + 1}段结束秒数`} type="number" min={index ? tiers[index - 1].maxSeconds + 1 : 1} max="3600" value={tier.maxSeconds} onChange={event => setRow(quality, {referenceDurationTiers: tiers.map((item, position) => position === index ? {...item, maxSeconds: Number(event.target.value)} : item)})} /></AdminField><ControlButton className="min-h-11" variant="ghost" disabled={tiers.length === 1} aria-label={`${quality} 移除第${index + 1}个价格分段`} onClick={() => setRow(quality, {referenceDurationTiers: tiers.filter((_, position) => position !== index)})}>移除分段</ControlButton></div>{referenceFields(quality, tier.prices, value => setRow(quality, {referenceDurationTiers: tiers.map((item, position) => position === index ? {...item, prices: value} : item)}), ` 第${index + 1}段`)}</div>)}<ControlButton className="min-h-11" disabled={tiers.length >= 16 || tiers.at(-1)!.maxSeconds >= max} onClick={() => setRow(quality, {referenceDurationTiers: [...tiers, {maxSeconds: max, prices: {...tiers.at(-1)!.prices}}]})}>添加价格分段</ControlButton></div> : <>{referenceFields(quality, localPrices, value => setRow(quality, {referencePrices: value}))}{longDurationMultiplier > 1 && <p className="text-xs text-muted-foreground">未设置分段时，16 秒起沿用原长视频倍率；分段价格按填写值计算。</p>}</>}
          </div>}
          {extraPriceFields.length > 0 && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-medium">附加价格与倍率 · {qualityLabel(quality)}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{extraPriceFields.map(field => <div key={field.key}>{priceField(`${quality} ${field.label}`, row.additionalPrices?.[field.key] ?? (pricing[field.key] as number | undefined) ?? field.defaultValue, text => {const next = {...row.additionalPrices}; if (text.trim()) next[field.key] = Number(text); else delete next[field.key]; setRow(quality, {additionalPrices: next})}, field.hint)}</div>)}</div></details>}
        </section>
      })}
    </div>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    {notice && <p className="text-xs leading-5 text-muted-foreground" role="status">{notice}</p>}
    <div className="space-y-3 border-t border-border pt-4"><p className="text-sm font-semibold">输入素材数量与时长限制</p><p className="text-xs leading-5 text-muted-foreground">各清晰度共用。数量、时长上限为 0 时不加额外限制；免费数量为 0 表示没有免费额度。</p>
      {(['image','video','audio'] as const).map(type => {
        const label = type === 'image' ? '参考图片' : type === 'video' ? '参考视频' : '参考音频', flag = type === 'image' ? 'supportsReferenceImage' : type === 'video' ? 'supportsVideoReference' : 'supportsAudioReference'
        const nativeMax = Number(profile[type === 'image' ? 'maxReferenceImages' : type === 'video' ? 'maxReferenceVideos' : 'maxReferenceAudios']) || 0, rule = references[type] || {}, free = rule.freeCount ?? defaultFreeCounts[type] ?? 0
        const setRule = (key: keyof RefRule, value: number) => update({videoReferenceRules: {...references, [type]: {...rule, freeCount: free, [key]: value}}})
        const limit = (field: keyof RefRule, title: string, hint?: string) => <AdminField label={title} hint={hint}><AdminInput aria-label={`${label} ${title}`} type="number" min="0" step={field.endsWith('Seconds') ? '0.001' : '1'} value={field === 'freeCount' ? free : rule[field] ?? 0} onChange={event => setRule(field, Number(event.target.value))} /></AdminField>
        return <fieldset key={type} className="space-y-3 rounded-lg border border-border bg-background p-3"><label className="flex min-h-11 items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={Boolean(profile[flag])} onChange={event => update({[flag]: event.target.checked, ...(type === 'image' && !event.target.checked ? {supportsFirstFrame: false, supportsLastFrame: false} : {})})} />{label}</label>{Boolean(profile[flag]) && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{limit('maxCount', '数量上限（个）', nativeMax ? `上游上限 ${nativeMax} 个` : '0 表示不额外限制')}{limit('freeCount', '免费数量（个）')}{type !== 'image' && <>{limit('maxItemSeconds', '单个最长时长（秒）')}{limit('maxTotalSeconds', '合计最长时长（秒）')}</>}</div>}</fieldset>
      })}
    </div>
  </section>
}
