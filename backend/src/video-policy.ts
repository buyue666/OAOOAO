/** Video capabilities and fixed-precision pricing shared by quotes and submission. */
import {httpError} from './core.js';
import {creditDecimal,creditUnits} from './wallet.js';
import {readReference,probeReference,MAX_MEDIA_BYTES} from './media.js';
import type {Context} from './core.js';
type Json=Record<string,any>;
const fail=(message:string):never=>{throw httpError(400,message);};
export function videoDurations(profile:Json,quality:string,mode='text'):number[]{
  let values:number[]=profile.durationSeconds||[];
  if(profile.durationsByMode?.[mode])values=values.filter(value=>profile.durationsByMode[mode].includes(value));
  const rule=profile.videoDurationRules?.[quality];
  if(rule?.mode==='list')values=values.filter(value=>rule.values.includes(value));
  if(rule?.mode==='range')values=values.filter(value=>value>=rule.min&&value<=rule.max&&(value-rule.min)%(rule.step||1)===0);
  const max=profile.maxDurationByResolution?.[quality];
  return max?values.filter(value=>value<=max):values;
}
export function videoInputMode(input:Json):string{
  const config=input.config||{},refs=input.references||[];
  if(config.sourceJobId||config.videoOperation==='extend')return 'extend';
  if(refs.some((ref:Json)=>ref.role==='last_frame'))return 'ends';
  if(refs.some((ref:Json)=>ref.role==='first_frame'))return 'first';
  return refs.length?'references':'text';
}
export function validateVideoPolicySettings(profile:Json){
  const integer=(value:any,min:number,max:number)=>Number.isInteger(value)&&value>=min&&value<=max;
  if(profile.videoBillingUnit!==undefined&&!['second','request','duration'].includes(profile.videoBillingUnit))fail('视频计费方式无效');
  for(const flag of ['supportsFirstFrame','supportsLastFrame','supportsReferenceImage','supportsVideoReference','supportsAudioReference'])if(profile[flag]!==undefined&&typeof profile[flag]!=='boolean')fail('视频能力开关必须是布尔值');
  if(profile.supportsLastFrame===true&&profile.supportsFirstFrame===false)fail('开启尾帧前需要开启首帧');
  if(profile.videoReferenceFieldMap!==undefined){
    if(!profile.videoReferenceFieldMap||typeof profile.videoReferenceFieldMap!=='object'||Array.isArray(profile.videoReferenceFieldMap))fail('参考素材 API 字段映射无效');
    for(const [key,value] of Object.entries(profile.videoReferenceFieldMap))if(!['first_frame','last_frame','image','video','audio'].includes(key)||typeof value!=='string'||!/^[A-Za-z_][A-Za-z0-9_.\[\]-]{0,79}$/.test(value)||['model','prompt','size','seconds'].includes(value))fail('参考素材 API 字段名无效');
  }
  if(profile.videoQualities!==undefined&&(!Array.isArray(profile.videoQualities)||!profile.videoQualities.length||profile.videoQualities.length>16||profile.videoQualities.some((v:any)=>typeof v!=='string'||!v.trim()||v.length>32)))fail('至少选择一种视频清晰度');
  if(profile.videoReferenceRules!==undefined){
    if(!profile.videoReferenceRules||typeof profile.videoReferenceRules!=='object'||Array.isArray(profile.videoReferenceRules))fail('参考素材规则无效');
    for(const [type,rule] of Object.entries(profile.videoReferenceRules) as [string,Json][]){
      if(!['image','video','audio'].includes(type)||!rule||typeof rule!=='object'||Array.isArray(rule))fail('参考素材规则无效');
      for(const key of ['maxCount','freeCount']){const value=(rule as Json)[key];if(value!==undefined&&!integer(value,0,1000))fail('参考数量须为 0–1000 的整数');}
      for(const key of ['maxItemSeconds','maxTotalSeconds']){const value=(rule as Json)[key];if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3600))fail('参考素材时长须为 0–3600 秒');}
    }
  }
  if(profile.videoDurationRules!==undefined){
    if(!profile.videoDurationRules||typeof profile.videoDurationRules!=='object'||Array.isArray(profile.videoDurationRules)||Object.keys(profile.videoDurationRules).length>16)fail('生成时长配置无效');
    for(const [quality,rule] of Object.entries(profile.videoDurationRules) as [string,Json][]){
      if(!quality||!rule||typeof rule!=='object')fail('生成时长配置无效');
      if(rule.mode==='range'){
        if(!integer(rule.min,1,3600)||!integer(rule.max,rule.min,3600)||!integer(rule.step??1,1,3600))fail('生成时长范围和步长须为正整数，结束时长不能小于起始时长');
      }else if(rule.mode==='list'){
        if(!Array.isArray(rule.values)||!rule.values.length||rule.values.length>120||rule.values.some((v:any)=>!integer(v,1,3600)))fail('指定生成时长须为 1–3600 秒的整数列表');
      }else fail('请选择生成时长范围或指定时长');
    }
  }
  const pricing=profile.videoPricing;
  if(pricing!==undefined){
    const validate=(value:any,depth=0)=>{
      if(depth>3)fail('视频价格配置层级无效');
      if(typeof value==='number'){if(!Number.isFinite(value)||value<0||value>1000000000)fail('视频价格必须为非负数');creditUnits(value);return;}
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>120)fail('视频价格配置无效');
      for(const entry of Object.values(value))validate(entry,depth+1);
    };
    validate(pricing);
  }
}
export function validateVideoInput(input:Json,profile:Json){
  const config=input.config||{},refs:Json[]=input.references||[],quality=String(config.vquality||profile.videoQualities?.[0]||''),seconds=Number(config.videoSeconds||profile.defaultVideoSeconds||profile.durationSeconds?.[0]||4);
  const mode=videoInputMode(input);
  if(profile.videoQualities?.length&&!profile.videoQualities.includes(quality))fail('当前渠道未开启此视频清晰度');
  if(profile.durationSeconds?.length&&!videoDurations(profile,quality,mode).includes(seconds))fail('此清晰度或生成模式不支持所选时长');
  if(refs.some(ref=>ref.role==='first_frame')&&profile.supportsFirstFrame===false)fail('当前渠道未开启首帧功能');
  if(refs.some(ref=>ref.role==='last_frame')&&profile.supportsLastFrame===false)fail('当前渠道未开启尾帧功能');
  if(refs.some(ref=>ref.role==='last_frame')&&!refs.some(ref=>ref.role==='first_frame'))fail('尾帧必须同时提供首帧');
  for(const role of ['first_frame','last_frame'])if(refs.filter(ref=>ref.role===role).length>1||refs.some(ref=>ref.role===role&&(ref.type||'image')!=='image'))fail('首帧和尾帧各限一张图片');
  for(const type of ['image','video','audio']){
    const count=refs.filter(ref=>(ref.type||'image')===type).length;
    const rule=profile.videoReferenceRules?.[type];
    const hard=profile[type==='image'?'maxReferenceImages':type==='video'?'maxReferenceVideos':'maxReferenceAudios'];
    const configured=Number(rule?.maxCount)||0,native=Number(hard)||0;
    const limit=configured>0?(native>0?Math.min(configured,native):configured):native;
    if(count&&((type==='image'&&profile.supportsReferenceImage===false)||(type==='video'&&!profile.supportsVideoReference)||(type==='audio'&&!profile.supportsAudioReference)))fail('当前渠道未开启此类参考素材');
    if(limit>0&&count>limit)fail(`参考${type==='image'?'图片':type==='video'?'视频':'音频'}最多 ${limit} 个`);
  }
}
export function validateReferenceDurations(metadata:Json[],profile:Json,hardMax=0){
  for(const type of ['video','audio']){
    const rule=profile.videoReferenceRules?.[type]||{},items=metadata.filter(item=>item.type===type);
    if(rule.maxItemSeconds>0&&items.some(item=>item.duration>rule.maxItemSeconds+0.001))fail(`单个参考${type==='video'?'视频':'音频'}超过 ${rule.maxItemSeconds} 秒`);
    const total=items.reduce((sum,item)=>sum+Number(item.duration||0),0);
    const configured=Number(rule.maxTotalSeconds)||0,max=hardMax>0?(configured>0?Math.min(configured,hardMax):hardMax):configured;
    if(max>0&&total>max+0.001)fail(`参考${type==='video'?'视频':'音频'}总时长不得超过 ${max} 秒`);
  }
}
export function videoBaseCost(base:bigint,profile:Json,quality:string,seconds:number):bigint{
  const prices=profile.videoPricing||{},mode=profile.videoBillingUnit||'second';
  const price=mode==='duration'?prices.durationRates?.[quality]?.[String(seconds)]:prices.resolutionRates?.[quality];
  if(mode==='duration'&&price===undefined)throw httpError(503,'请先配置此清晰度和时长的视频积分价格');
  const rate=price===undefined?base:creditUnits(price);
  return mode==='second'?rate*BigInt(seconds):rate;
}
export function videoReferenceCost(metadata:Json[],profile:Json):bigint{
  const prices=profile.videoPricing||{};let total=0n;
  for(const type of ['image','video','audio']){
    const items=metadata.filter(item=>item.type===type),rule=profile.videoReferenceRules?.[type]||{};
    const free=rule.freeCount??0;
    const billed=items.slice(free);if(!billed.length)continue;
    const key=type==='image'?'extraImage':type==='video'?'extraVideo':'extraAudio';
    const secondKey=type==='video'?'referenceVideoPerSecond':'referenceAudioPerSecond';
    if(prices[key]===undefined&&(type==='image'||prices[secondKey]===undefined))throw httpError(503,'请先配置超额参考素材的积分价格，可明确填写 0');
    if(prices[key]!==undefined)total+=creditUnits(prices[key])*BigInt(billed.length);
    if(type!=='image'&&prices[secondKey]!==undefined)total+=(creditUnits(prices[secondKey])*BigInt(Math.ceil(billed.reduce((sum,item)=>sum+Number(item.duration||0),0)*1000))+999n)/1000n;
  }
  return total;
}

/** Inspect owned/public reference bytes before charging; never trust client durations. */
export async function prepareVideoPolicy(ctx:Context,input:Json,profile:Json,base:bigint,userId?:string){
  const config=input.config||{},metadata:Json[]=[];
  for(const reference of input.references||[]){
    if(!userId)throw httpError(401,'参考素材校验需要登录账号');
    const media=await readReference(ctx,userId,reference),type=media.mimeType.split('/')[0];
    if(type!==(reference.type||'image'))fail('参考素材类型与实际文件不一致');
    if(media.bytes.length>MAX_MEDIA_BYTES)fail('单个参考素材不得超过 24 MiB');
    let duration=0;
    if(type!=='image'){
      const info=await probeReference(media.bytes);
      if(!info.streams.some((stream:Json)=>stream.codec_type===type))fail('参考素材没有可用的媒体流');
      duration=info.duration;
    }
    metadata.push({type,duration,bytes:media.bytes.length,role:reference.role});
  }
  validateReferenceDurations(metadata,profile);
  validateVideoInput({...input,references:metadata},profile);
  const quality=String(config.vquality||profile.videoQualities?.[0]||''),seconds=Number(config.videoSeconds||profile.defaultVideoSeconds||profile.durationSeconds?.[0]||4);
  const subtotal=videoBaseCost(base,profile,quality,seconds)+videoReferenceCost(metadata,profile);
  return {cost:creditDecimal(subtotal),snapshot:{referenceMetadata:metadata}};
}
