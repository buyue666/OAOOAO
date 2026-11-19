'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { request } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { SettingsDisclosure } from './settings-disclosure'
import { ModelIcon } from './model-icon'
import { ModelSubscriptionBadge, ModelNote, Notice, SectionHeading } from './ui'
import { cn } from '@/lib/utils'

const groups=[{capability:'image',label:'默认生图模型'},{capability:'video',label:'默认视频模型'},{capability:'text',label:'默认文本模型'},{capability:'audio',label:'默认音频模型'}] as const
export function AccountModelDefaults() {
  const {state,refreshSession}=useStudio(),[saving,setSaving]=useState(''),[notice,setNotice]=useState(''),pending=useRef(false)
  const account=useRef(state.user.id);account.current=state.user.id
  useEffect(()=>{setSaving('');setNotice('')},[state.user.id])
  async function choose(key:string,id:string) {
    if(pending.current)return
    const owner=state.user.id;pending.current=true;setSaving(id);setNotice('')
    try {await request('/api/account/model-defaults',{method:'PATCH',body:JSON.stringify({[key]:id})});if(account.current!==owner)return;await refreshSession();if(account.current===owner)setNotice('默认模型已保存，将用于后续新建的创作任务。')}
    catch(e){if(account.current===owner)setNotice(e instanceof Error?e.message:'默认模型保存失败')}
    finally {pending.current=false;if(account.current===owner)setSaving('')}
  }
  return <SettingsDisclosure id="models" title="模型选择" summary="按图片、视频、文本和音频选择默认模型，后续新建任务自动使用。">
    {state.backendStatus!=='connected'?<p className="mt-4 text-sm text-muted-foreground">登录后可设置默认模型。</p>:<div className="mt-5 flex flex-col gap-6">{groups.map(group=>{
      const models=state.liveModels.filter(model=>model.capability===group.capability),key=`${group.capability}Model` as 'imageModel'|'videoModel'|'textModel'|'audioModel',saved=state.sessionSettings?.userDefaultModels?.[key]||state.sessionSettings?.defaultModels?.[key]
      const logical=state.sessionSettings?.logicalModels?.find(model=>model.id===saved&&model.capability===group.capability)
      const chosen=models.some(model=>model.id===saved)?saved:logical?.bindings.find(binding=>binding.enabled)?.requestAlias||saved
      return <fieldset key={key} disabled={Boolean(saving)}><legend className="mb-3 text-sm font-medium">{group.label}<span className="ml-2 text-xs font-normal text-muted-foreground">{models.length} 个可用</span></legend>
        {models.length?<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{models.map(model=><label key={model.id} className={cn('relative flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring',chosen===model.id?'border-studio-accent bg-studio-accent/5':'border-border hover:bg-muted/50',model.subscriptionLocked&&'cursor-not-allowed text-muted-foreground')}>
          <input type="radio" name={key} value={model.id} disabled={model.subscriptionLocked} title={model.subscriptionLocked?'需要订阅套餐才可使用':undefined} checked={chosen===model.id} onChange={()=>{if(!model.subscriptionLocked)void choose(key,model.id)}} className="peer sr-only" />
          <span className="size-8 shrink-0 rounded-lg bg-muted p-1.5"><ModelIcon model={model}/></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={model.name}>{model.name}<ModelSubscriptionBadge required={model.requiresSubscription} locked={model.subscriptionLocked}/></span><span className="mt-1 block truncate text-[11px] text-muted-foreground" title={model.id}>{model.id}</span>{model.subscriptionLocked&&<span className="mt-1 block text-xs font-medium text-foreground">需要订阅套餐才可使用</span>}</span>
          <ModelNote note={model.note}/>{saving===model.id?<LoaderCircle className="size-4 animate-spin" aria-label="保存中"/>:<span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border',chosen===model.id?'border-studio-accent bg-studio-accent text-studio-accent-foreground':'border-border')}>{chosen===model.id&&<Check className="size-3" aria-hidden="true"/>}</span>}
        </label>)}</div>:<p className="text-xs text-muted-foreground">暂无可用模型</p>}
        {chosen&&!models.some(model=>model.id===chosen)&&<p className="mt-2 text-xs text-amber-700">原默认模型暂不可用，请重新选择。</p>}
      </fieldset>
    })}</div>}
    {notice&&<div className="mt-4" role="status"><Notice tone="neutral">{notice}</Notice></div>}
  </SettingsDisclosure>
}
