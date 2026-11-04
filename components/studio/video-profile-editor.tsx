'use client'
import {useState} from 'react'
import {AdminField,AdminInput,AdminSelect} from './admin-kit'
import {ControlButton} from './ui'
import {formatVideoDurations,parseVideoDurationInput} from '@/lib/studio/video-duration'
type Profile=Record<string,unknown>
type RefRule={maxCount?:number;freeCount?:number;maxItemSeconds?:number;maxTotalSeconds?:number}
type DurationRule={mode:'range'|'list';min?:number;max?:number;step?:number;values?:number[]}
export function VideoProfileEditor({profile={},onChange}:{profile?:Profile;onChange:(patch:Profile)=>void}){
  const [custom,setCustom]=useState('')
  const [durationError,setDurationError]=useState('')
  const pricing=(profile.videoPricing||{}) as Record<string,unknown>,unit=String(profile.videoBillingUnit||'request')
  const qualities=(profile.videoQualities||[]) as string[],native=(profile.nativeVideoQualities||[]) as string[]
  const choices=Array.from(new Set([...native,...qualities,...(native.length?[]:['standard','hd','720p','1080p'])]))
  const durations=(profile.durationSeconds||[4,8,12]) as number[],rules=(profile.videoDurationRules||{}) as Record<string,DurationRule>
  const references=(profile.videoReferenceRules||{}) as Record<string,RefRule>,rates=(pricing.resolutionRates||{}) as Record<string,number>
  const durationRates=(pricing.durationRates||{}) as Record<string,Record<string,number>>
  const update=(patch:Profile)=>onChange({videoBillingUnit:unit,videoQualities:qualities.length?qualities:['standard'],durationSeconds:durations,...patch})
  const price=(key:string,value:string)=>{const next={...pricing};if(value.trim())next[key]=Number(value);else delete next[key];update({videoPricing:next})}
  const durationRule=(quality:string,rule:DurationRule)=>{
    const next={...rules,[quality]:rule}
    const values=Object.values(next).flatMap(r=>r.mode==='list'?r.values||[]:Array.from({length:Math.min(120,Math.max(0,Math.floor(((r.max||1)-(r.min||1))/(r.step||1))+1))},(_,i)=>(r.min||1)+i*(r.step||1)))
    update({videoDurationRules:next,...(!native.length?{durationSeconds:Array.from(new Set(values)).sort((a,b)=>a-b)}:{})})
  }
  const numberField=(label:string,value:number|string,change:(text:string)=>void,hint?:string)=><AdminField label={label} hint={hint}><AdminInput aria-label={label} type="number" min="0" step="0.0001" value={value} onChange={event=>change(event.target.value)}/></AdminField>
  return <section className="w-full space-y-5 rounded-xl border border-border bg-muted/15 p-4" data-testid="video-capability-editor">
    <div><p className="text-sm font-semibold">视频能力与计费</p><p className="mt-1 text-xs leading-5 text-muted-foreground">前台选项、预计积分与实际扣费使用同一配置。参考素材超额费用另计，价格 0 表示免费。</p></div>
    <AdminField label="视频计费方式"><AdminSelect value={unit} onChange={event=>update({videoBillingUnit:event.target.value})}><option value="second">按生成秒数</option><option value="request">按次生成</option><option value="duration">按清晰度与指定时长定价</option></AdminSelect></AdminField>
    <fieldset className="space-y-2 border-t border-border pt-4"><legend className="text-xs font-semibold">首尾帧功能</legend><div className="flex flex-wrap gap-5 text-xs">
      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={Boolean(profile.supportsFirstFrame)} disabled={profile.nativeFirstFrame===false} onChange={event=>update({supportsFirstFrame:event.target.checked,...(event.target.checked?{supportsReferenceImage:true}:{supportsLastFrame:false})})}/>开启首帧</label>
      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={Boolean(profile.supportsLastFrame)} disabled={!profile.supportsFirstFrame||profile.nativeLastFrame===false} onChange={event=>update({supportsLastFrame:event.target.checked})}/>开启尾帧</label>
    </div><p className="text-xs leading-5 text-muted-foreground">已确认支持的渠道默认开启；未知渠道手动选择。尾帧需配合首帧，上游明确不支持的功能不能开启。</p>
      {<details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-medium">未知协议的参考素材 API 字段映射</summary><p className="my-2 text-xs leading-5 text-muted-foreground">按上游文档填写 multipart 文件字段名。首帧默认 input_reference；尾帧、视频、音频没有通用字段，使用前必须配置。</p><div className="grid gap-3 sm:grid-cols-2">{[['first_frame','首帧字段'],['last_frame','尾帧字段'],['image','参考图字段'],['video','参考视频字段'],['audio','参考音频字段']].map(([key,label])=><AdminField key={key} label={label}><AdminInput value={((profile.videoReferenceFieldMap||{}) as Record<string,string>)[key]||''} placeholder={key==='first_frame'||key==='image'?'input_reference':'按上游文档填写'} onChange={event=>{const map={...((profile.videoReferenceFieldMap||{}) as Record<string,string>)};if(event.target.value.trim())map[key]=event.target.value.trim();else delete map[key];update({videoReferenceFieldMap:map})}}/></AdminField>)}</div></details>}
    </fieldset>
    <div className="space-y-3 border-t border-border pt-4"><p className="text-xs font-semibold">清晰度与生成时长</p>
      <div className="flex flex-wrap gap-2">{choices.map(quality=><label key={quality} className="flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs"><input type="checkbox" checked={qualities.includes(quality)} onChange={event=>update({videoQualities:event.target.checked?[...qualities,quality]:qualities.filter(q=>q!==quality)})}/>{quality}</label>)}</div>
      {!native.length&&<div className="flex gap-2"><AdminInput className="max-w-48" aria-label="自定义视频清晰度" placeholder="添加上游支持的清晰度" value={custom} onChange={event=>setCustom(event.target.value)}/><ControlButton size="sm" variant="secondary" onClick={()=>{const q=custom.trim();if(q&&!qualities.includes(q))update({videoQualities:[...qualities,q]});setCustom('')}}>添加</ControlButton></div>}
      {!qualities.length&&<p className="text-xs text-destructive" role="alert">请至少开启一种清晰度。</p>}
      {qualities.map(quality=>{
        const max=(profile.maxDurationByResolution as Record<string,number>|undefined)?.[quality]||(native.length?Math.max(...durations):3600)
        const rule=rules[quality]||{mode:'list',values:durations.filter(s=>s<=max)}
        const candidates=native.length?durations:rule.mode==='list'?rule.values||[]:Array.from({length:Math.min(120,Math.max(0,Math.floor(((rule.max||1)-(rule.min||1))/(rule.step||1))+1))},(_,i)=>(rule.min||1)+i*(rule.step||1))
        const allowed=candidates.filter(s=>s<=max&&(rule.mode==='list'?(rule.values||[]).includes(s):s>=(rule.min||1)&&s<=(rule.max||max)&&(s-(rule.min||1))%(rule.step||1)===0))
        return <div key={quality} className="space-y-3 rounded-lg border border-border bg-background p-3"><p className="text-xs font-semibold">{quality}<span className="ml-2 font-normal text-muted-foreground">{formatVideoDurations(allowed)||'无可用时长'} 秒</span></p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminField label="时长选择方式"><AdminSelect value={rule.mode} onChange={event=>durationRule(quality,event.target.value==='range'?{mode:'range',min:Math.min(...durations),max:native.length?max:Math.max(...durations),step:1}:{mode:'list',values:durations.filter(s=>s<=max)})}><option value="list">指定时长</option><option value="range">起始–结束范围</option></AdminSelect></AdminField>
          {rule.mode==='list'?<AdminField className="sm:col-span-2" label="可选时长（秒）" hint="连续时长可填 4-30；固定档位填 4,6,8。仍受上游和生成模式限制。"><AdminInput key={`${quality}:${rule.mode}`} aria-label={`${quality} 可选时长`} defaultValue={formatVideoDurations(rule.values||[],',')} placeholder="4-30 或 4,6,8" onBlur={event=>{const parsed=parseVideoDurationInput(event.target.value);if(parsed){setDurationError('');durationRule(quality,parsed)}else{setDurationError('请填写有效时长，例如 4-30 或 4,6,8');event.target.value=formatVideoDurations(rule.values||[],',')}}}/></AdminField>:<><AdminField className="sm:col-span-2" label="时长范围（秒）" hint="例如 4-30，包含起始和结束时长。"><AdminInput key={`${quality}:${rule.mode}`} aria-label={`${quality} 时长范围`} defaultValue={`${rule.min||1}-${rule.max||max}`} placeholder="4-30" onBlur={event=>{const parsed=parseVideoDurationInput(event.target.value);if(parsed?.mode==='range'){setDurationError('');durationRule(quality,{...parsed,step:rule.step||1})}else{setDurationError('请填写有效范围，例如 4-30');event.target.value=`${rule.min||1}-${rule.max||max}`}}}/></AdminField><AdminField label="步长（秒）"><AdminInput type="number" min="1" value={rule.step??1} onChange={event=>durationRule(quality,{...rule,step:Number(event.target.value)})}/></AdminField></>}
          {unit!=='duration'&&numberField(unit==='second'?'积分/秒':'积分/次',rates[quality]??'',text=>{const next={...rates};if(text.trim())next[quality]=Number(text);else delete next[quality];update({videoPricing:{...pricing,resolutionRates:next}})},'留空沿用渠道入口单价')}
        </div>{unit==='duration'&&<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{allowed.map(seconds=><div key={seconds}>{numberField(`${seconds} 秒 · 积分/次`,durationRates[quality]?.[seconds]??'',text=>{const next={...(durationRates[quality]||{})};if(text.trim())next[seconds]=Number(text);else delete next[seconds];update({videoPricing:{...pricing,durationRates:{...durationRates,[quality]:next}}})},'必须配置，可填 0')}</div>)}</div>}</div>
      })}
    </div>
    {durationError&&<p className="text-xs text-destructive" role="alert">{durationError}</p>}
    <div className="space-y-3 border-t border-border pt-4"><p className="text-xs font-semibold">参考素材规则</p><p className="text-xs leading-5 text-muted-foreground">数量、时长上限为 0 时不加额外限制，仍遵守上游限制。免费数量为 0 表示没有免费额度。</p>
      {(['image','video','audio'] as const).map(type=>{
        const label=type==='image'?'参考图片':type==='video'?'参考视频':'参考音频',flag=type==='image'?'supportsReferenceImage':type==='video'?'supportsVideoReference':'supportsAudioReference'
        const nativeMax=Number(profile[type==='image'?'maxReferenceImages':type==='video'?'maxReferenceVideos':'maxReferenceAudios'])||0,rule=references[type]||{}
        const free=rule.freeCount??0
        const setRule=(key:keyof RefRule,value:number)=>update({videoReferenceRules:{...references,[type]:{...rule,freeCount:free,[key]:value}}})
        const extra=type==='image'?'extraImage':type==='video'?'extraVideo':'extraAudio'
        return <div key={type} className="space-y-3 rounded-lg border border-border bg-background p-3"><label className="flex min-h-9 items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={Boolean(profile[flag])} onChange={event=>update({[flag]:event.target.checked,...(type==='image'&&!event.target.checked?{supportsFirstFrame:false,supportsLastFrame:false}:{})})}/>{label}</label>
          {Boolean(profile[flag])&&<div className="grid gap-3 sm:grid-cols-3">
            {numberField('数量上限（个）',rule.maxCount??0,text=>setRule('maxCount',Number(text)),nativeMax?`上游上限 ${nativeMax} 个`:'以渠道能力为准')}
            {numberField('免费数量（个）',free,text=>setRule('freeCount',Number(text)))}
            {numberField('超额积分/个',pricing[extra] as number??'',text=>price(extra,text),'留空需配置价格；0 为免费')}
            {type!=='image'&&<>
              {numberField('单个最长时长（秒）',rule.maxItemSeconds??0,text=>setRule('maxItemSeconds',Number(text)))}
              {numberField('合计最长时长（秒）',rule.maxTotalSeconds??0,text=>setRule('maxTotalSeconds',Number(text)))}
              {numberField('超额素材时长积分/秒',pricing[type==='video'?'referenceVideoPerSecond':'referenceAudioPerSecond'] as number??'',text=>price(type==='video'?'referenceVideoPerSecond':'referenceAudioPerSecond',text),'可选，与超额积分/个相加')}
            </>}
          </div>}</div>
      })}
    </div>
  </section>
}
