'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, CircleAlert, History, ImagePlus, Images, Loader2, ScanLine, Shirt, SlidersHorizontal, Sparkles, UserRound, WandSparkles, X } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { filterModelsByCapability, imageQualityOptions, qualityLabel } from '@/lib/studio/studio-models'
import { createLibraryAsset, uploadPersistentAsset } from '@/lib/studio/account-api'
import { quoteTryOn } from '@/lib/studio/creative-references-api'
import { defaultTryOnPreset, emptyTryOnSelections, tryOnInput, tryOnReferenceError, tryOnReferences, tryOnRoleLabels, type TryOnReference, type TryOnRole } from '@/lib/studio/tryon'
import { cn } from '@/lib/utils'
import { ModelNote } from '../ui'
import { TryOnGallery } from './tryon-gallery'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

const roles = ['person','garment','pose'] as const
const icons = { person: UserRound, garment: Shirt, pose: ScanLine }
const field = 'h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60'
const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/60 disabled:opacity-50'

export default function AiTryOnTool() {
  const { state } = useStudio(), generation = useGeneration()
  const [selections,setSelections] = useState(emptyTryOnSelections)
  const [activeRole,setActiveRole] = useState<TryOnRole>('garment')
  const [tab,setTab] = useState<'references'|'results'>('references')
  const [imageModel,setImageModel] = useState('')
  const [ratio,setRatio] = useState('2:3'), [resolution,setResolution] = useState('1K'), [quality,setQuality] = useState('auto'), [count,setCount] = useState(1)
  const [prompt,setPrompt] = useState(''), [preset,setPreset] = useState(defaultTryOnPreset)
  const [background,setBackground] = useState<'preserve'|'studio'|'outdoor'>('preserve'), [style,setStyle] = useState<'photo'|'anime'>('photo')
  const [busy,setBusy] = useState(''), [notice,setNotice] = useState('')
  const [modelPrompt,setModelPrompt] = useState('成年亚洲模特，全身自然站立，普通身材，面部清晰，简洁服装与摄影棚背景，适合用于虚拟试穿。')
  const [modelTaskId,setModelTaskId] = useState(''), [quoteRevision,setQuoteRevision] = useState(0)
  const [quote,setQuote] = useState<{key:string;status:'loading'|'ready'|'error';points?:number;error?:string}>({key:'',status:'loading'})
  const [modelPrice,setModelPrice] = useState<{key:string;points?:number;error?:string}>({key:''})
  const [preview,setPreview] = useState<TryOnReference|null>(null)
  const account = state.user.id, accountRef=useRef(account), selectionEpoch=useRef(0), savedModel=useRef(''), modelEpoch=useRef(0)
  accountRef.current=account
  useEffect(()=>{setSelections(emptyTryOnSelections());setImageModel('');setPrompt('');setNotice('');setBusy('');setModelTaskId('');setPreview(null);savedModel.current='';selectionEpoch.current++},[account])
  const imageModels=useMemo(()=>filterModelsByCapability(state.liveModels,'image').filter(model=>model.capabilities.maxReferences>0),[state.liveModels])
  useEffect(()=>{if(!imageModels.some(model=>model.id===imageModel))setImageModel(imageModels.find(model=>model.id===state.sessionSettings?.defaultModels?.imageModel)?.id||imageModels[0]?.id||'')},[imageModels,imageModel,state.sessionSettings?.defaultModels?.imageModel])
  const model=imageModels.find(item=>item.id===imageModel)
  const ratios=useMemo(()=>model?.capabilities.ratios?.length?model.capabilities.ratios:['2:3'],[model])
  const resolutions=useMemo(()=>model?.capabilities.resolutions?.length?model.capabilities.resolutions:['1K'],[model])
  const qualities=useMemo(()=>imageQualityOptions(model,resolution),[model,resolution])
  const maxCount=Math.min(8,Math.max(1,model?.capabilities.maxBatchSize||1))
  useEffect(()=>{if(!ratios.includes(ratio))setRatio(ratios[0])},[ratios,ratio])
  useEffect(()=>{if(!resolutions.includes(resolution))setResolution(resolutions[0])},[resolutions,resolution])
  useEffect(()=>{if(!qualities.includes(quality))setQuality(qualities[0]||'auto')},[qualities,quality])
  useEffect(()=>{if(count>maxCount)setCount(maxCount)},[count,maxCount])
  const input=useMemo(()=>tryOnInput(selections,{model:imageModel,ratio,resolution,quality,count,prompt,preset,background,style}),[selections,imageModel,ratio,resolution,quality,count,prompt,preset,background,style])
  const quoteKey=JSON.stringify(input), referenceCount=tryOnReferences(selections).length
  const referenceError=tryOnReferenceError(selections,model?.capabilities.maxReferences||0)
  const configured=Boolean(imageModel&&(referenceCount||prompt.trim())&&!referenceError)
  useEffect(()=>{
    if(!configured)return
    const controller=new AbortController();setQuote({key:quoteKey,status:'loading'})
    const timer=setTimeout(()=>{quoteTryOn(input,controller.signal).then(value=>{if(!controller.signal.aborted)setQuote({key:quoteKey,status:'ready',points:value.points})}).catch(error=>{if(!controller.signal.aborted)setQuote({key:quoteKey,status:'error',error:error instanceof Error?error.message:'费用预估失败'})})},350)
    return()=>{clearTimeout(timer);controller.abort()}
  },[configured,quoteKey,input,account,quoteRevision])
  const quoted=configured&&quote.key===quoteKey&&quote.status==='ready'
  const modelInput=useMemo(()=>({prompt:modelPrompt.trim(),model:imageModel,ratio,resolution,quality,count:1,title:'AI 模特',surface:'chat' as const}),[modelPrompt,imageModel,ratio,resolution,quality])
  const modelKey=JSON.stringify(modelInput)
  useEffect(()=>{
    if(activeRole!=='person'||!imageModel||!modelPrompt.trim())return
    const controller=new AbortController();setModelPrice({key:modelKey})
    const timer=setTimeout(()=>{quoteTryOn(modelInput,controller.signal).then(value=>{if(!controller.signal.aborted)setModelPrice({key:modelKey,points:value.points})}).catch(error=>{if(!controller.signal.aborted)setModelPrice({key:modelKey,error:error instanceof Error?error.message:'费用预估失败'})})},350)
    return()=>{clearTimeout(timer);controller.abort()}
  },[activeRole,imageModel,modelPrompt,modelKey,modelInput,account])
  const tasks=generation.tasks.filter(task=>task.kind==='image'&&task.title==='AI换装')
  const modelTask=generation.tasks.find(task=>task.id===modelTaskId)
  useEffect(()=>{
    if(!modelTaskId||!modelTask||savedModel.current===modelTaskId)return
    if(modelTask.status==='error'||modelTask.status==='cancelled'){setBusy('');setNotice(modelTask.error||'模特生成未完成，可在生成记录查看。');setModelTaskId('');return}
    if(modelTask.status!=='success'||!modelTask.media?.[0]?.url)return
    savedModel.current=modelTaskId
    const owner=account
    createLibraryAsset({kind:'image',title:'AI 模特',tags:['AI换装','模特'],source:'ai-try-on',data:{serverUrl:modelTask.media[0].url,assetRole:'character'}}).then(asset=>{
      if(accountRef.current!==owner)return
      if(selectionEpoch.current===modelEpoch.current)setSelections(current=>({...current,person:{id:asset.id,title:asset.title,url:modelTask.media![0].url,source:'asset'}}))
      setNotice('模特已生成并保存到创作资产。')
    }).catch(error=>{if(accountRef.current===owner)setNotice(`模特已生成，保存素材时出错：${error instanceof Error?error.message:'请稍后重试'}`)}).finally(()=>{if(accountRef.current===owner){setBusy('');setModelTaskId('')}})
  },[modelTaskId,modelTask,account])
  const select=(role:TryOnRole,item:TryOnReference|null)=>{selectionEpoch.current++;setSelections(current=>({...current,[role]:item}));setNotice('')}
  const upload=async(file:File,role:TryOnRole)=>{
    if(busy)return
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>24*1024*1024){setNotice('请上传不超过 24 MB 的 JPG、PNG 或 WEBP 图片。');return}
    const owner=account,epoch=++selectionEpoch.current;setBusy('upload');setNotice('正在上传并保存素材…')
    try{
      const stored=await uploadPersistentAsset(file,'image')
      if(accountRef.current!==owner)return
      const saved=await createLibraryAsset({kind:'image',title:file.name.replace(/\.[^.]+$/,'')||`${tryOnRoleLabels[role]}参考`,tags:['AI换装',tryOnRoleLabels[role]],source:'ai-try-on',data:{storageKey:stored.key,serverUrl:stored.url,assetRole:role==='person'?'character':role==='garment'?'garment':'general',tryOnRole:role}})
      if(accountRef.current!==owner)return
      if(selectionEpoch.current===epoch)setSelections(current=>({...current,[role]:{id:saved.id,title:saved.title,url:stored.url,source:'upload'}}))
      setNotice('素材已保存到创作资产。')
    }catch(error){if(accountRef.current===owner)setNotice(error instanceof Error?error.message:'上传失败，请重试。')}
    finally{if(accountRef.current===owner)setBusy('')}
  }
  const submit=async()=>{
    if(!quoted||busy)return
    const owner=account;setBusy('submit');setNotice('正在提交生成任务…')
    try{await generation.createImage({...input,approvedCost:quote.points});if(accountRef.current===owner){setTab('results');setNotice('任务已提交。结果会显示在这里，也会保存在生成记录中。')}}
    catch(error){if(accountRef.current===owner)setNotice(error instanceof Error?error.message:'生成提交失败，请重试。')}
    finally{if(accountRef.current===owner)setBusy('')}
  }
  const generateModel=async()=>{
    if(!imageModel||busy||!modelPrompt.trim()||modelPrice.key!==modelKey||modelPrice.points===undefined)return
    const owner=account;modelEpoch.current=selectionEpoch.current;setBusy('model');setNotice('正在提交模特生成任务…')
    try{
      const task=await generation.createImage({...modelInput,approvedCost:modelPrice.points})
      if(accountRef.current===owner){setModelTaskId(task.id);setNotice('模特生成中，完成后会自动保存并选中。')}
    }catch(error){if(accountRef.current===owner){setBusy('');setNotice(error instanceof Error?error.message:'模特生成提交失败。')}}
  }

  return <div data-testid="ai-tryon-tool" className="space-y-5 pb-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[10px] font-medium tracking-[0.2em] text-muted-foreground"><Shirt className="size-3.5 text-studio-accent"/>OAO FASHION STUDIO</div><h1 className="text-2xl font-semibold tracking-tight">AI 换装工作台</h1><p className="mt-2 text-sm text-muted-foreground">锁定人物，搭配服装，用姿势与视角完成你的下一张成片。</p></div><Link href="/works" className={secondary}><History className="size-4"/>生成记录<ArrowUpRight className="size-3.5 text-muted-foreground"/></Link></header>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)]">
      <aside className="order-2 min-w-0 space-y-4 lg:order-none">
        <section className="rounded-2xl border border-border bg-card p-4"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">01 · 组合参考</h2><span className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">{referenceCount} 张已选</span></div><div className="space-y-2">{roles.map((role,index)=>{const Icon=icons[role],item=selections[role];return <div key={role} className={cn('relative rounded-xl border transition-colors',activeRole===role&&tab==='references'?'border-studio-accent/65 bg-studio-accent/5':'border-border bg-background')}><button type="button" data-testid={`tryon-role-${role}`} onClick={()=>{setActiveRole(role);setTab('references')}} className="flex min-h-20 w-full items-center gap-3 rounded-xl p-3 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent">{item?<img src={item.thumbnailUrl||item.url} alt="" className={cn('size-14 rounded-lg object-contain',role==='pose'?'bg-white':'bg-muted')}/>:<span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/25 text-muted-foreground"><Icon className="size-5"/></span>}<span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-xs font-semibold"><span className="text-[10px] text-muted-foreground">0{index+1}</span>{tryOnRoleLabels[role]}{item&&<Check className="size-3 text-studio-accent"/>}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground" title={item?.title}>{item?.title||{person:'可选 · 自动设计成年模特',garment:'可选 · 保留原衣或自动搭配',pose:'可选 · 保留原姿势或自动设计'}[role]}</span>{item?.angle&&<span className="mt-1 block text-[10px] text-muted-foreground">{item.angle}</span>}</span></button>{item&&<button type="button" aria-label={`移除${tryOnRoleLabels[role]}参考`} onClick={()=>select(role,null)} className="absolute right-1 top-1 flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"><X className="size-3.5"/></button>}</div>})}</div><p className="mt-3 text-[11px] leading-5 text-muted-foreground">三类参考独立使用。选定姿势后，优先遵循其动作与相机视角。</p></section>
        <section className="rounded-2xl border border-border bg-card p-4"><h2 className="mb-4 text-sm font-semibold">02 · 画面设定</h2><div className="grid grid-cols-2 gap-3"><label className="space-y-1.5 text-xs"><span className="text-muted-foreground">画面风格</span><select className={field} value={style} onChange={event=>setStyle(event.target.value as typeof style)}><option value="photo">商业写实</option><option value="anime">动漫插画</option></select></label><label className="space-y-1.5 text-xs"><span className="text-muted-foreground">背景</span><select className={field} value={background} onChange={event=>setBackground(event.target.value as typeof background)}><option value="preserve">沿用人物背景</option><option value="studio">简洁摄影棚</option><option value="outdoor">自然户外</option></select></label></div><label className="mt-4 block text-xs"><span className="font-medium">补充要求</span><textarea data-testid="ai-tryon-requirements" aria-label="换装补充要求" rows={3} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="例如：保持衣物刺绣，采用全身构图与柔和侧光…" className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-xs leading-6 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-studio-accent/60"/></label><details data-testid="ai-tryon-preset" className="group mt-3"><summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent [&::-webkit-details-marker]:hidden">预置提示词<ChevronDown className="size-3.5 transition-transform group-open:rotate-180"/></summary><textarea aria-label="编辑预置提示词" data-testid="ai-tryon-preset-prompt" value={preset} onChange={event=>setPreset(event.target.value)} rows={4} className="w-full rounded-lg border border-border bg-background p-3 text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"/><p className="mt-2 text-[10px] leading-5 text-muted-foreground">人物身份、服装细节、姿势与背景规则随已选参考自动组合。</p></details></section>
        <section className="rounded-2xl border border-border bg-card p-4"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">03 · 生成设置</h2><SlidersHorizontal className="size-4 text-muted-foreground"/></div><label className="block text-xs"><span className="text-muted-foreground">图片模型</span><span className="mt-2 flex items-center gap-1"><select aria-label="图片模型" className={field} value={imageModel} onChange={event=>setImageModel(event.target.value)} disabled={!imageModels.length}><option value="">{imageModels.length?'选择模型':'暂无支持图生图的模型'}</option>{imageModels.map(item=><option key={item.id} value={item.id}>{item.shortName}</option>)}</select><ModelNote note={model?.note}/></span></label><div className="mt-3 grid grid-cols-2 gap-3">{([['画幅',ratio,ratios,setRatio],['清晰度',resolution,resolutions,setResolution],['图片质量',quality,qualities,setQuality]] as const).map(([label,value,options,setValue])=><label key={label} className="space-y-1.5 text-xs"><span className="text-muted-foreground">{label}</span><select aria-label={label} className={field} value={value} onChange={event=>setValue(event.target.value)}>{options.map(option=><option key={option} value={option}>{label==='图片质量'?qualityLabel(option,model?.capabilities.qualityLabels):option}</option>)}</select></label>)}<label className="space-y-1.5 text-xs"><span className="text-muted-foreground">生成数量</span><select aria-label="生成数量" value={count} onChange={event=>setCount(Number(event.target.value))} className={field}>{Array.from({length:maxCount},(_,index)=><option key={index} value={index+1}>{index+1} 张</option>)}</select></label></div>
          {referenceError&&<p role="alert" className="mt-3 flex gap-2 text-xs leading-5 text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0"/>{referenceError}</p>}
</section>
      </aside>
      <div className="order-1 min-w-0 space-y-4 lg:order-none"><div className="flex items-center justify-between gap-3"><div className="flex gap-1 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="工作台视图">{([['references','素材工作台'],['results','生成结果']] as const).map(([id,label])=><button type="button" key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)} className={cn('min-h-10 rounded-lg px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent',tab===id?'bg-foreground text-background':'text-muted-foreground hover:bg-muted')}>{label}{id==='results'&&tasks.length>0&&<span className="ml-2 opacity-70">{tasks.length}</span>}</button>)}</div><span className="hidden text-[11px] text-muted-foreground sm:block">参考素材 → 画面设定 → 生成成片</span></div>
        {notice&&<div role="status" className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-xs leading-5"><CircleAlert className="mt-0.5 size-4 shrink-0 text-studio-accent"/><span className="flex-1">{notice}</span><button type="button" onClick={()=>setNotice('')} aria-label="关闭提示" className="flex size-6 items-center justify-center rounded hover:bg-muted"><X className="size-3.5"/></button></div>}
        {tab==='references'?<><div className="flex gap-2" role="tablist" aria-label="参考类型">{roles.map(role=>{const Icon=icons[role];return <button key={role} type="button" role="tab" aria-selected={activeRole===role} onClick={()=>setActiveRole(role)} className={cn(secondary,'flex-1',activeRole===role&&'border-studio-accent/60 bg-studio-accent/10')}><Icon className="size-4"/>{tryOnRoleLabels[role]}{selections[role]&&<Check className="size-3 text-studio-accent"/>}</button>})}</div><TryOnGallery key={`${account}-${activeRole}`} role={activeRole} selected={selections[activeRole]} onSelect={item=>select(activeRole,item)} onUpload={file=>void upload(file,activeRole)} uploading={busy==='upload'} accountId={account}/>
          {activeRole==='person'&&<details className="group rounded-2xl border border-border bg-card"><summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent [&::-webkit-details-marker]:hidden"><Sparkles className="size-4 text-studio-accent"/>没有合适的人物？生成模特<ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180"/></summary><div className="space-y-3 border-t border-border p-4"><textarea aria-label="模特生成要求" value={modelPrompt} onChange={event=>setModelPrompt(event.target.value)} rows={2} className="w-full rounded-xl border border-border bg-background p-3 text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"/><p className="text-[11px] text-muted-foreground">使用所选模型生成 1 张人物图，单独计费，完成后保存到创作资产。</p><button type="button" className={secondary} disabled={Boolean(busy)||!imageModel||!modelPrompt.trim()||modelPrice.key!==modelKey||modelPrice.points===undefined} onClick={()=>void generateModel()}>{busy==='model'?<Loader2 className="size-4 animate-spin"/>:<Sparkles className="size-4"/>}生成模特{modelPrice.key===modelKey&&modelPrice.points!==undefined?` · ${modelPrice.points} 积分`:''}</button>{modelPrice.error&&<p role="alert" className="text-xs text-destructive">{modelPrice.error}</p>}</div></details>}
        </>:<section className="min-h-[600px] rounded-2xl border border-border bg-card p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-sm font-semibold">换装成片</h2><p className="mt-1 text-xs text-muted-foreground">保留参考组合，随时调整服装或姿势继续创作。</p></div><button type="button" onClick={()=>setTab('references')} className={secondary}><Images className="size-4"/>继续选片</button></div>{!tasks.length?<div className="flex min-h-96 flex-col items-center justify-center gap-3 text-center"><ImagePlus className="size-10 text-muted-foreground"/><p className="text-sm font-medium">你的下一张成片，从一组参考开始</p><p className="text-xs text-muted-foreground">选择人物、服装或姿势，然后提交生成。</p></div>:<div className="space-y-5">{tasks.map(task=><article key={task.id} className="rounded-xl border border-border p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{task.title} · {new Date(task.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span><span className="text-muted-foreground">{task.status==='success'?'已完成':task.status==='error'?'生成失败':task.status==='cancelled'?'已取消':'生成中'}</span></div>{task.media?.length?<div className="grid gap-3 sm:grid-cols-2">{task.media.map((media,index)=><div key={media.url} className="overflow-hidden rounded-xl border border-border bg-background"><button type="button" aria-label={`预览结果 ${index+1}`} onClick={()=>setPreview({id:`${task.id}-${index}`,title:'换装成片',url:media.url})} className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"><img loading="lazy" decoding="async" src={media.url} alt={`换装成片 ${index+1}`} className="max-h-[560px] w-full object-contain"/></button><div className="flex flex-wrap gap-2 border-t border-border p-2"><button type="button" className={secondary} onClick={()=>{select('person',{id:`${task.id}-${index}`,title:'上次换装成片',url:media.url,source:'asset'});setTab('references');setActiveRole('garment')}}><UserRound className="size-3.5"/>用作人物参考</button><a href={media.url} target="_blank" rel="noreferrer" className={secondary}>查看原图<ArrowUpRight className="size-3.5"/></a></div></div>)}</div>:<div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{task.status==='error'?<CircleAlert className="size-6 text-destructive"/>:<Loader2 className="size-6 animate-spin"/>}<p>{task.error||'生成中，结果会自动显示；你也可以继续选择素材。'}</p></div>}</article>)}</div>}</section>}
        {referenceCount>0&&<section className="rounded-2xl border border-border bg-card p-4"><div className="mb-3 flex items-center gap-2 text-xs font-medium"><Images className="size-4 text-muted-foreground"/>当前参考组合</div><div className="grid grid-cols-3 gap-3">{roles.map(role=>{const item=selections[role];return <button type="button" key={role} disabled={!item} onClick={()=>item&&setPreview(item)} className="overflow-hidden rounded-xl border border-border bg-background text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"><div className={cn('flex aspect-[4/3] items-center justify-center',item&&role==='pose'?'bg-white':'bg-muted/30')}>{item?<img loading="lazy" decoding="async" src={item.thumbnailUrl||item.url} alt={item.title} className="size-full object-contain"/>:<span className="text-[10px] text-muted-foreground">自动设计</span>}</div><span className="block truncate px-2.5 py-2 text-[11px] font-medium">{tryOnRoleLabels[role]}{item?.angle?` · ${item.angle}`:''}</span></button>})}</div></section>}
      </div>
    </div>
          <div className="sticky bottom-3 z-30 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-border bg-card p-3 shadow-lg sm:px-5"><div className="flex min-w-28 flex-col gap-1 text-xs"><span className="text-muted-foreground">预计消耗</span><span data-testid="tryon-quote" className="font-semibold tabular-nums">{quoted?`${quote.points} 积分`:configured&&(quote.key!==quoteKey||quote.status==='loading')?'计算中…':'—'}</span></div>{configured&&quote.key===quoteKey&&quote.status==='error'&&<div className="mb-3 text-xs leading-5 text-destructive"><p>{quote.error}</p><button type="button" onClick={()=>setQuoteRevision(v=>v+1)} className="mt-1 underline">重新预估</button></div>}<button type="button" data-testid="ai-tryon-submit" disabled={Boolean(busy)||!quoted} onClick={()=>void submit()} className="ml-auto flex min-h-12 min-w-44 flex-1 items-center sm:max-w-64 justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent focus-visible:ring-offset-2 disabled:opacity-45">{busy==='submit'?<Loader2 className="size-4 animate-spin"/>:<WandSparkles className="size-4"/>}生成换装成片</button><p className="hidden text-[10px] leading-5 text-muted-foreground lg:block">{!referenceCount&&!prompt.trim()?'选择参考素材，或输入你的创作要求':'按当前模型、清晰度、质量、数量与参考计费'}</p></div>
    <Dialog open={Boolean(preview)} onOpenChange={open=>{if(!open)setPreview(null)}}><DialogContent showCloseButton={false} aria-describedby={undefined} className="max-h-[94vh] w-[min(1100px,calc(100%-2rem))] bg-card p-4 text-foreground sm:max-w-[1100px]"><DialogTitle className="sr-only">参考图片预览</DialogTitle><button type="button" aria-label="关闭预览" className={cn(secondary,'absolute right-3 top-3 z-10')} onClick={()=>setPreview(null)}><X className="size-4"/></button>{preview&&<><img src={preview.url} alt={preview.title} className="mx-auto max-h-[80vh] max-w-full object-contain"/><p className="text-center text-xs text-muted-foreground">{preview.title}</p></>}</DialogContent></Dialog>
  </div>
}
