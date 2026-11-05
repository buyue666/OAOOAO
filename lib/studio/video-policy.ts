import type {ModelConfig} from './types'
/** Mirror the server's selectable constraints; server validation remains authoritative. */
export function selectableVideoDurations(model:ModelConfig|undefined,quality:string,mode:string):string[]{
  if(!model)return []
  const feature=model.capabilities.videoPolicy,rule=feature?.durationRules?.[quality]
  const byMode=feature?.durationsByMode?.[mode],max=feature?.maxDurationByResolution?.[quality]
  return model.capabilities.durations.filter(value=>{
    const seconds=Number.parseInt(value,10)
    return (!max||seconds<=max)&&(!byMode||byMode.includes(seconds))&&(!rule||(rule.mode==='list'?(rule.values||[]).includes(seconds):seconds>=(rule.min||1)&&seconds<=(rule.max||3600)&&(seconds-(rule.min||1))%(rule.step||1)===0))
  })
}
export function videoReferenceLimit(model:ModelConfig|undefined,type:'image'|'video'|'audio'):number{
  const feature=model?.capabilities.videoPolicy,native=feature?.referenceLimits?.[type]||(type==='image'||(type==='video'&&feature?.supportsVideoReference)||(type==='audio'&&feature?.supportsAudioReference)?model?.capabilities.maxReferences||0:0),configured=feature?.referenceRules?.[type]?.maxCount||0
  return configured>0?(native>0?Math.min(configured,native):configured):native
}

/** maxFiles includes existing uploads; library selections consume the same limits. */
export function videoReferenceUploadLimit(model:ModelConfig|undefined,type:'image'|'video'|'audio',selected:readonly {kind:string}[],uploads:Record<'image'|'video'|'audio',number>):number{
  const selectedOfType=selected.filter(item=>(item.kind==='scene'?'image':item.kind)===type).length
  const otherUploads=Object.entries(uploads).reduce((total,[kind,count])=>total+(kind===type?0:count),0)
  return Math.max(0,Math.min(videoReferenceLimit(model,type)-selectedOfType,(model?.capabilities.maxReferences||0)-selected.length-otherUploads))
}
