'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bot, Check, Eye, Film, ImagePlus, Loader2, RotateCcw, Square, X } from 'lucide-react'
import { PromptReferenceInput } from '@/components/studio/prompt-reference-input'
import { request, StudioApiError } from '@/lib/studio/api'
import { cancelGenerationTask, getGenerationTask, newClientRequestId } from '@/lib/studio/generation-api'
import { useGeneration } from '@/lib/studio/generation-store'
import type { GenerationTask } from '@/lib/studio/generation-types'
import { availableTeamModels } from '@/lib/studio/team-generation'
import { defaultModelFor, estimatePoints, filterModelsByCapability } from '@/lib/studio/studio-models'
import { useStudio } from '@/lib/studio/store'
import { flushCanvasSave } from '../canvas-persistence'
import { useCanvasStore } from '../canvas-store'
import { teamCanvasRoot } from '../canvas-workspace'
import type { DirectorAssistantData, DirectorSceneData } from '../types'
import { DIRECTOR_AGENT_SYSTEM, directorSceneKey, parseDirectorAgentPlan, type DirectorAgentPlan } from './agent-plan'

type Job = NonNullable<DirectorAssistantData['job']>
const button = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const message = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请重试'

export function DirectorAgentPanel({ nodeId, scene, time, selectedId, previewing, onPreview, onApply, onDraft, onClose }: {
  nodeId:string; scene:DirectorSceneData; time:number; selectedId:string|null; previewing:boolean
  onPreview:(scene:DirectorSceneData|null)=>void; onApply:(scene:DirectorSceneData,assistant:DirectorAssistantData)=>void
  onDraft:(kind:'image'|'video',prompt:string,model:string)=>Promise<void>; onClose:()=>void
}) {
  const { state } = useStudio(), generation = useGeneration()
  const node = useCanvasStore(store => store.nodes.find(item => item.id === nodeId && item.type === 'director'))
  const workspace = useCanvasStore(store => store.workspace), projectId = useCanvasStore(store => store.projectId)
  const data = node?.type === 'director' ? node.data.assistant ?? {prompt:'',model:''} : {prompt:'',model:''}
  const job = data.job
  const models = workspace ? availableTeamModels(state.models,workspace.modelIds,state.sessionSettings) : state.models
  const textModels = filterModelsByCapability(models,'text')
  const model = textModels.some(item => item.id === data.model) ? data.model : defaultModelFor('text',state.sessionSettings,textModels)
  const planningPoints=estimatePoints(model,state.sessionSettings,models)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [refresh,setRefresh] = useState(0), [outputKind,setOutputKind] = useState<'image'|'video'>('image'), [outputModel,setOutputModel] = useState('')
  const lock = useRef(false), alive = useRef(true), account = useRef(state.user.id)
  account.current = state.user.id
  useEffect(() => { alive.current = true; return () => {alive.current=false} },[])
  const editingLocked = busy || job?.phase === 'submitting' || job?.phase === 'pending' || job?.phase === 'unconfirmed'
  const update = (next:DirectorAssistantData) => useCanvasStore.getState().updateNodeData(nodeId,{assistant:next})
  const scope = () => {
    const store = useCanvasStore.getState(), owner = account.current
    return () => alive.current && owner === account.current && useCanvasStore.getState().hydrated && useCanvasStore.getState().projectId === store.projectId && useCanvasStore.getState().projectMeta === store.projectMeta && useCanvasStore.getState().workspace?.teamId === store.workspace?.teamId
  }
  const patchJob = (next:Partial<Job>, requestId:string) => {
    const target = useCanvasStore.getState().nodes.find(item => item.id === nodeId)
    if (target?.type === 'director' && target.data.assistant?.job?.requestId === requestId) update({...target.data.assistant,job:{...target.data.assistant.job,...next}})
  }
  useEffect(() => {
    if (job?.phase === 'submitting' && !lock.current) patchJob({phase:job.taskId?'pending':'unconfirmed'},job.requestId)
  },[])
  const result = useMemo(() => {
    if (job?.phase !== 'ready' || !job.content) return null
    try {return {plan:parseDirectorAgentPlan(job.content,job.baseScene)}} catch(reason) {return {error:message(reason)}}
  },[job?.phase,job?.content,job?.baseScene])
  const plan = result?.plan
  const stale = Boolean(job && directorSceneKey(scene) !== directorSceneKey(job.applied && plan ? plan.scene : job.baseScene))
  const desiredKind = plan?.generation?.kind ?? outputKind
  const outputModels = filterModelsByCapability(models,desiredKind).filter(item => item.capabilities.maxReferences > 0)
  const selectedOutput = outputModels.some(item=>item.id===outputModel) ? outputModel : defaultModelFor(desiredKind,state.sessionSettings,outputModels)
  const references = [...scene.actors,...scene.cameras].map(item=>({id:item.id,name:item.name,type:'text' as const,mention:`@「${item.name.replace(/[「」\r\n]/g,' ').slice(0,50)} · ${item.id}」`}))

  const consume = (task:GenerationTask, snapshot:Job) => {
    if (task.status === 'success') {
      const content = task.result && typeof task.result === 'object' && 'content' in task.result ? String(task.result.content ?? '') : ''
      try {parseDirectorAgentPlan(content,snapshot.baseScene); patchJob({phase:'ready',content,error:undefined},snapshot.requestId)}
      catch(reason) {patchJob({phase:'error',error:message(reason)},snapshot.requestId)}
    } else if (task.status === 'error' || task.status === 'cancelled') patchJob({phase:'error',error:task.error || (task.status === 'cancelled' ? '方案生成已取消' : '方案生成失败')},snapshot.requestId)
    else patchJob({phase:'pending',taskId:task.id},snapshot.requestId)
  }
  useEffect(() => {
    if (!job?.taskId || job.phase !== 'pending') return
    const current = scope(), snapshot = job
    let stopped = false, timer:ReturnType<typeof setTimeout>|undefined, failures=0
    const poll = async () => {
      try {
        const task = workspace ? (await request<{task:GenerationTask}>(`${teamCanvasRoot(workspace)}/generations/${encodeURIComponent(snapshot.taskId!)}`)).task : (await getGenerationTask('text',snapshot.taskId!)).data.task
        if (stopped || !current()) return
        failures=0; setError(''); consume(task,snapshot)
        if (!['success','error','cancelled'].includes(task.status)) timer=setTimeout(poll,2500)
      } catch(reason) {
        if (stopped || !current()) return
        setError(`读取规划状态失败，任务仍保留。${message(reason)}`)
        if (++failures < 4) timer=setTimeout(poll,4000)
      }
    }
    void poll()
    return () => {stopped=true; if(timer)clearTimeout(timer)}
  },[job?.taskId,job?.phase,job?.requestId,nodeId,projectId,refresh,workspace?.teamId])

  const start = async () => {
    if (lock.current || workspace?.readOnly || !model) return
    lock.current=true;setBusy(true);setError('')
    const current=scope()
    let snapshot:Job|undefined
    let submitted=false
    try {
      if (job?.phase === 'unconfirmed') snapshot=job
      else {
        if (!data.prompt.trim()) return
        const user=JSON.stringify({instruction:data.prompt.trim(),scene,selectedObjectId:selectedId,currentTime:time})
        if(user.length>55000) throw new Error('场景关键帧较多，请先简化时间轴后再规划')
        snapshot={requestId:newClientRequestId('director'),model,system:DIRECTOR_AGENT_SYSTEM,user,baseScene:JSON.parse(JSON.stringify(scene)),phase:'submitting'}
        const points=planningPoints
        if (!Number.isFinite(points) || points<0) throw new Error('未能确认文字规划积分')
        if (workspace) {
          const quote=await request<{points:number}>(`${teamCanvasRoot(workspace)}/generations/quote`,{method:'POST',body:JSON.stringify({kind:'text',prompt:data.prompt,config:{model},messages:[{role:'system',content:snapshot.system},{role:'user',content:snapshot.user}]})})
          if(!current())return
          if(!Number.isFinite(quote.points)||quote.points<0)throw new Error('未能确认团队规划费用')
          if(quote.points>points)throw new Error(`当前团队规划报价为 ${quote.points} 积分，高于预估。请刷新模型配置后重试`)
          snapshot.approvedCost=quote.points
        }
        if(!current())return
        onPreview(null)
        update({...data,model,job:snapshot})
      }
      await flushCanvasSave()
      if(!current())return
      const saved=useCanvasStore.getState()
      if(saved.revision!==saved.savedRevision)throw new Error('画布尚未保存，规划请求未发送，请先处理保存冲突')
      submitted=true
      const task=workspace ? (await request<{task:GenerationTask}>(`${teamCanvasRoot(workspace)}/generations`,{method:'POST',headers:{'idempotency-key':snapshot.requestId},body:JSON.stringify({kind:'text',prompt:data.prompt,config:{model:snapshot.model},messages:[{role:'system',content:snapshot.system},{role:'user',content:snapshot.user}],approvedCost:snapshot.approvedCost})})).task
        : await generation.createText({prompt:data.prompt || '3D 导演台规划',model:snapshot.model,clientRequestId:snapshot.requestId,messages:[{role:'system',content:snapshot.system},{role:'user',content:snapshot.user}]})
      if(!current())return
      patchJob({taskId:task.id,phase:'pending'},snapshot.requestId)
      consume(task,snapshot)
    } catch(reason) {
      if(!current())return
      const definite=reason instanceof StudioApiError && reason.status>=400 && reason.status<500 && ![408,429].includes(reason.status) || Boolean(reason&&typeof reason==='object'&&'indeterminate' in reason&&reason.indeterminate===false)
      if(snapshot)patchJob({phase:submitted&&!definite?'unconfirmed':'error',error:message(reason)},snapshot.requestId)
      setError(message(reason))
    } finally {lock.current=false;if(alive.current)setBusy(false)}
  }
  const apply = () => {
    if(!job||!plan||stale||workspace?.readOnly)return
    onApply(plan.scene,{...data,job:{...job,applied:true}});onPreview(null)
  }
  const undo = () => {
    if(!job?.applied||!plan||stale||workspace?.readOnly)return
    onApply(job.baseScene,{...data,job:{...job,applied:false}});onPreview(null)
  }
  const draft = async () => {
    if(lock.current||!selectedOutput||!plan||!job?.applied||stale)return
    lock.current=true;setBusy(true);setError('')
    try {await onDraft(desiredKind,plan.generation?.prompt || `按照当前镜头构图制作${desiredKind==='image'?'图片':'视频'}。${plan.summary}`,selectedOutput)} catch(reason){setError(message(reason))} finally {lock.current=false;if(alive.current)setBusy(false)}
  }
  return <section data-director-agent aria-label="3D 导演助手" className="flex h-full min-h-0 flex-col [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-ring">
    <header className="flex shrink-0 items-center gap-2 border-b border-border pb-3"><span className="grid size-9 place-items-center rounded-xl bg-studio-accent/10 text-studio-accent"><Bot className="size-4"/></span><div className="flex-1"><h3 className="text-sm font-semibold">导演助手</h3><p className="text-[10px] text-muted-foreground">人物、姿势、走位与运镜</p></div><button type="button" aria-label="收起导演助手" className="grid size-11 place-items-center rounded-xl hover:bg-muted" onClick={()=>{onPreview(null);onClose()}}><X className="size-4"/></button></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
      <p className="text-xs leading-5 text-muted-foreground">描述镜头，先查看方案，再预览或应用。输入 @ 可指定人物和机位。</p>
      <label className="block text-xs font-medium">规划模型<select aria-label="导演助手规划模型" value={model} disabled={editingLocked||workspace?.readOnly} onChange={event=>update({...data,model:event.target.value})} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-xs">{!textModels.length&&<option value="">暂无可用文字模型</option>}{textModels.map(item=><option key={item.id} value={item.id}>{item.shortName}</option>)}</select></label>
      <div className="space-y-2"><label htmlFor={`director-agent-${nodeId}`} className="text-xs font-medium">镜头指令</label><PromptReferenceInput id={`director-agent-${nodeId}`} value={data.prompt} onChange={prompt=>update({...data,prompt:prompt.slice(0,6000)})} references={references} ariaLabel="镜头指令" referenceContext="objects" compact disabled={editingLocked||workspace?.readOnly} appearance="composer" placeholder="例如：男生站在左侧挥手，女生向右走，镜头用 5 秒缓慢推进。" onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(!editingLocked)void start()}}}/></div>
      {!job&&<div className="flex flex-wrap gap-2">{['两人面对面交谈，镜头缓慢推进 5 秒','选中人物抬起右手，切换竖屏全身构图','为当前镜头安排环绕运镜，并准备视频提示词'].map(prompt=><button type="button" key={prompt} className="rounded-lg border border-border px-2.5 py-2 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" disabled={editingLocked||workspace?.readOnly} onClick={()=>update({...data,prompt})}>{prompt}</button>)}</div>}
      {(error||job?.error||result?.error)&&<p role="alert" className="break-words rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">{error||job?.error||result?.error}</p>}
      {job?.phase==='pending'&&<div role="status" className="rounded-xl border border-border p-3 text-xs"><p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin"/>正在生成镜头方案</p><p className="mt-2 text-muted-foreground">可以收起助手，重新打开后继续查看。</p><div className="mt-3 flex gap-2"><button className={button} type="button" onClick={()=>setRefresh(value=>value+1)}>重新检查</button><button className={button} type="button" disabled={busy||workspace?.readOnly} onClick={async()=>{const current=scope();try{const task=workspace?(await request<{task:GenerationTask}>(`${teamCanvasRoot(workspace)}/generations/${job.taskId}/cancel`,{method:'POST'})).task:(await cancelGenerationTask('text',job.taskId!)).data.task;if(current())consume(task,job)}catch(reason){if(current())setError(message(reason))}}}><Square className="size-3"/>取消规划</button></div></div>}
      {plan&&<div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3"><div className="flex items-center justify-between gap-2"><h4 className="text-xs font-semibold">镜头方案</h4><span className="text-[10px] text-muted-foreground">{job?.applied?'已应用':previewing?'预览中':'待应用'}</span></div><p className="whitespace-pre-wrap text-xs leading-6">{plan.summary}</p><ol className="space-y-2 text-[11px] text-muted-foreground">{plan.changes.map((change,i)=><li key={i}>{i+1}. {change}</li>)}</ol>{stale&&<p className="text-xs leading-5 text-studio-warn">场景已更改，请重新规划，避免覆盖手动调整。</p>}<div className="grid grid-cols-2 gap-2"><button type="button" className={button} disabled={stale||busy} onClick={()=>onPreview(previewing?null:plan.scene)}><Eye className="size-3.5"/>{previewing?'退出预览':'预览方案'}</button>{job?.applied?<button type="button" className={button} disabled={stale||busy||workspace?.readOnly} onClick={undo}><RotateCcw className="size-3.5"/>撤销应用</button>:<button type="button" className={`${button} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={stale||busy||workspace?.readOnly} onClick={apply}><Check className="size-3.5"/>应用到场景</button>}</div></div>}
      {plan&&<div className="space-y-3 border-t border-border pt-4"><h4 className="text-xs font-semibold">用镜头继续创作</h4><p className="text-[11px] leading-5 text-muted-foreground">将当前时刻的机位画面保存为参考图，创建生成草稿。可在节点中调整参数、查看积分并提交。</p>{!plan.generation&&<select aria-label="导演助手生成类型" value={outputKind} onChange={event=>{setOutputKind(event.target.value as 'image'|'video');setOutputModel('')}} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs"><option value="image">图片生成</option><option value="video">视频生成</option></select>}<select aria-label="导演助手生成模型" value={selectedOutput} disabled={busy} onChange={event=>setOutputModel(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs">{!outputModels.length&&<option value="">暂无支持图片参考的模型</option>}{outputModels.map(item=><option key={item.id} value={item.id}>{item.shortName}</option>)}</select><button type="button" className={`${button} w-full`} disabled={!job?.applied||stale||busy||!selectedOutput||workspace?.readOnly} onClick={()=>void draft()}>{busy?<Loader2 className="size-4 animate-spin"/>:desiredKind==='image'?<ImagePlus className="size-4"/>:<Film className="size-4"/>}创建{desiredKind==='image'?'图片':'视频'}生成草稿</button>{!job?.applied&&<p className="text-[10px] text-muted-foreground">先应用镜头方案，再创建草稿。</p>}</div>}
    </div>
    <footer className="shrink-0 space-y-2 border-t border-border pt-3"><p className="text-[10px] leading-5 text-muted-foreground">{workspace?'使用团队积分。':'使用个人积分。'}文字规划预计 {planningPoints} 积分／次，场景预览和应用不额外计费。</p><button type="button" className={`${button} w-full border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy||job?.phase==='pending'||job?.phase==='submitting'||!model||(!data.prompt.trim()&&job?.phase!=='unconfirmed')||workspace?.readOnly} onClick={()=>void start()}>{busy?<Loader2 className="size-4 animate-spin"/>:<ArrowUp className="size-4"/>}{job?.phase==='unconfirmed'?'核对上次提交':job?'重新生成方案':'生成镜头方案'}</button></footer>
  </section>
}
