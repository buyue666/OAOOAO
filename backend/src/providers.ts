import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { httpError, safeFetch, type Context } from './core.js';
import { getSettings } from './settings.js';
import { creditDecimal, creditUnits } from './wallet.js';
import { readReference, saveMedia, MAX_MEDIA_BYTES, renderShots } from './media.js';

export type GenerationKind='text'|'image'|'video'|'audio'|'render';
export type Json=Record<string,any>;
export class ProviderFailure extends Error {
  constructor(message:string,readonly definitive=false){super(message);this.name='ProviderFailure';}
}
export type ProviderSelection={model:string;channelId:string;upstreamModel:string;config:Json;cost:string};
const protocols=new Set(['openai','openai-compatible','openai-chat','openai-images','openai-audio','openai-video']);
function moneyProduct(a:bigint,b:unknown){return a*creditUnits(typeof b==='number'||typeof b==='string'?b:1)/10000n;}
export async function resolveProvider(ctx:Context,kind:GenerationKind,input:Json,client?:PoolClient):Promise<ProviderSelection>{
  if(kind!=='text'){
    const storage=(await (client||ctx.db).query("SELECT value FROM oaooao_settings WHERE id='object-storage'")).rows[0]?.value;
    if(storage?.enabled)throw httpError(503,'Configured object storage is not supported by the creative media adapter');
  }
  if(kind==='render')return {model:'ffmpeg',channelId:'local',upstreamModel:'ffmpeg',config:{protocol:'ffmpeg'},cost:'0.0000'};
  const settings=await getSettings(ctx,client);const wanted=String(input.config?.model||settings.defaultModels?.[kind+'Model']||'');
  const model=(settings.logicalModels||[]).find((m:Json)=>m.enabled&&m.capability===kind&&(m.id===wanted||(m.aliases||[]).includes(wanted)));
  if(!model)throw httpError(503,`No enabled ${kind} model is configured`);
  const binding=[...(model.bindings||[])].filter((b:Json)=>b.enabled).sort((a:Json,b:Json)=>a.priority-b.priority).find((b:Json)=>settings.systemChannels?.some((c:Json)=>c.id===b.channelId&&c.enabled&&c.apiKey));
  if(!binding)throw httpError(503,'No authenticated provider channel is available');
  const channel=settings.systemChannels.find((c:Json)=>c.id===binding.channelId);
  const protocol=channel.advancedConfig?.protocol||channel.apiFormat||'openai';
  if(!protocols.has(protocol))throw httpError(503,`Configured protocol ${protocol} is not supported by this backend`);
  const base=new URL(channel.baseUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw httpError(503,'Provider requires a valid HTTPS base URL');
  const price=settings.modelPointCosts?.[model.id];
  if(price===undefined)throw httpError(503,'Model price must be configured before generation');
  let cost=creditUnits(price);const multipliers=settings.generationPointMultipliers||{};
  const defaults=settings.generationDefaults||{};const profile=binding.capabilityProfile||{};
  const pricedOption=(value:unknown,baseline:unknown,prices:Json|undefined,label:string)=>{if(value!==undefined&&String(value)!==String(baseline)&&prices?.[String(value)]===undefined)throw httpError(400,`${label} is not configured with a price`);};
  if(kind==='image'){
    /**
     * `quality` is the provider's image-quality/reasoning option (auto/low/medium/high).
     * Resolution tiers such as 1K/2K/4K are carried separately in `config.resolution`.
     * A declared profile is authoritative: this prevents a UI from offering a value
     * the binding cannot actually submit. Declared options default to a 1x multiplier
     * when no per-option price multiplier is configured, which is useful for fixed-
     * price model aliases such as the 1K endpoint.
     */
    // `qualities` is accepted as the legacy/editor spelling; new configs use
    // `imageQualities` to make the distinction from output resolution explicit.
    const qualityList=Array.isArray(profile.imageQualities)?profile.imageQualities:profile.qualities;
    const declaredQualities=Array.isArray(qualityList)?qualityList.map((value:any)=>String(value)):[];
    if(input.config?.quality!==undefined&&declaredQualities.length&&!declaredQualities.includes(String(input.config.quality)))throw httpError(400,'Image quality is not supported by this model');
    const qualityIsDeclared=declaredQualities.includes(String(input.config?.quality));
    if(qualityIsDeclared) {
      // Skip the legacy "every non-default option must have a multiplier" rule:
      // model capability declarations are also valid fixed-price options.
    } else {
      pricedOption(input.config?.quality,defaults.imageQuality,multipliers.imageQuality,'Image quality');
    }
    // Older profiles used `resolutions` for this list. Keep accepting it while
    // preferring the explicit outputResolutions field for new configurations.
    const resolutionList=Array.isArray(profile.outputResolutions)?profile.outputResolutions:profile.resolutions;
    const declaredResolutions=Array.isArray(resolutionList)?resolutionList.map((value:any)=>String(value)):[];
    if(input.config?.resolution!==undefined&&declaredResolutions.length&&!declaredResolutions.includes(String(input.config.resolution)))throw httpError(400,'Image resolution is not supported by this model');
    if(input.config?.size&&profile.aspectRatios?.length&&!profile.aspectRatios.includes(input.config.size)&&!profile.resolutions?.includes(input.config.size))throw httpError(400,'Image size is not supported by this model');
  }
  if(kind==='video'){
    pricedOption(input.config?.vquality,defaults.videoQuality,multipliers.videoQuality,'Video quality');
    pricedOption(input.config?.videoSeconds,defaults.videoSeconds,multipliers.videoSeconds,'Video duration');
    if(input.config?.videoSeconds&&!['4','8','12'].includes(String(input.config.videoSeconds)))throw httpError(400,'OpenAI video duration must be 4, 8 or 12 seconds');
    if(input.config?.videoSeconds&&profile.durationSeconds?.length&&!profile.durationSeconds.includes(Number(input.config.videoSeconds)))throw httpError(400,'Video duration is not supported by this model');
    if(input.config?.size&&profile.aspectRatios?.length&&!profile.aspectRatios.includes(input.config.size)&&!profile.resolutions?.includes(input.config.size))throw httpError(400,'Video size is not supported by this model');
  }
  if(kind==='image')cost=moneyProduct(cost,multipliers.imageQuality?.[input.config?.quality]);
  if(kind==='video'){cost=moneyProduct(cost,multipliers.videoQuality?.[input.config?.vquality]);cost=moneyProduct(cost,multipliers.videoSeconds?.[String(input.config?.videoSeconds)]);}
  const max=settings.generationCostControl?.maxPointsPerTask;
  if(cost<0n||(Number(max)>0&&cost>creditUnits(max)))throw httpError(400,'Generation cost exceeds the configured limit');
  if((input.references||[]).length>(kind==='video'?1:16))throw httpError(400,'Too many reference images for this protocol');
  if(kind==='image' && input.kind==='edit' && !(input.references||[]).length)throw httpError(400,'Image editing requires a reference image');
  if(kind==='image' && input.edit?.mask && !(input.references||[]).length)throw httpError(400,'An edit mask requires a reference image');
  if(kind==='image' && input.edit?.operation && !['inpaint','remove-background','erase','outpaint','enhance','layers'].includes(String(input.edit.operation)))throw httpError(400,'Unsupported image edit operation');
  if(kind==='image' && input.edit?.mask && profile.supportsMask===false)throw httpError(400,'Selected image model does not support edit masks');
  if(kind==='audio'&&!['mp3','wav','opus','flac','aac'].includes(input.config?.format||'mp3'))throw httpError(400,'Unsupported audio output format');
  // Persist the selected capability snapshot with the job.  Queued jobs must
  // keep using the exact size map that was validated at submission time even
  // if an administrator edits the model binding before the worker runs.
  return {model:model.id,channelId:channel.id,upstreamModel:binding.upstreamModel,config:{protocol,baseUrl:base.toString(),apiKey:channel.apiKey,capabilityProfile:profile},cost:creditDecimal(cost)};
}
function multipart(fields:Record<string,string>,files:Array<{name:string;data:Buffer;mime:string}>){
  const boundary='oaooao'+randomUUID().replaceAll('-','');const chunks:Buffer[]=[];
  for(const [name,value]of Object.entries(fields))chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for(const file of files){chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="reference.bin"\r\nContent-Type: ${file.mime}\r\n\r\n`),file.data,Buffer.from('\r\n'));}
  chunks.push(Buffer.from(`--${boundary}--\r\n`));return{body:Buffer.concat(chunks),contentType:`multipart/form-data; boundary=${boundary}`};
}
/**
 * Resolve a UI ratio plus an optional resolution tier to the provider's concrete
 * `size` value.  New model bindings can declare either `sizeMap` or
 * `outputDimensions`; both accept `{ resolution: { ratio: "WIDTHxHEIGHT" } }`.
 * The inverse `{ ratio: { resolution: "WIDTHxHEIGHT" } }` and a flat
 * `"resolution:ratio"` key are accepted as a migration convenience.  Without
 * a map we preserve the legacy GPT-image ratio mapping.
 */
export function imageSize(value:unknown,resolution:unknown,profile:Json){
  const ratio=String(value||'auto');
  const tier=String(resolution||profile?.outputResolutions?.[0]||profile?.resolutions?.[0]||'');
  const maps=[profile?.sizeMap,profile?.outputDimensions].filter((item:any)=>item&&typeof item==='object');
  for(const map of maps){
    const nestedByTier=map?.[tier]?.[ratio];
    const nestedByRatio=map?.[ratio]?.[tier];
    const flat=map?.[`${tier}:${ratio}`]??map?.[`${ratio}:${tier}`]??map?.[ratio];
    const candidate=nestedByTier??nestedByRatio??flat;
    if(typeof candidate==='string'&&/^(?:auto|\d+x\d+)$/i.test(candidate.trim()))return candidate.trim();
  }
  // The ciyuan image endpoint returns these concrete dimensions for the
  // supported GPT image ratios. Keep this fallback in sync with the UI table
  // for bindings that do not yet have an explicit sizeMap configured.
  return ({
    '1:1':'1254x1254', '3:2':'1536x1024', '2:3':'1024x1536',
    '16:9':'1672x941', '9:16':'941x1672', '4:3':'1448x1086',
    '3:4':'1086x1448', '21:9':'1923x817',
  } as Record<string,string>)[ratio]||ratio;
}
function videoSize(value:unknown){const v=String(value||'720x1280');return ({'1:1':'720x1280','16:9':'1280x720','9:16':'720x1280'} as Record<string,string>)[v]||v;}
export type ProviderResult={type:'complete';result:Json}|{type:'pending';upstreamId:string};
async function providerTextMessages(ctx:Context,userId:string,input:Json){
  const messages=Array.isArray(input.messages)?input.messages:[{role:'user',content:input.prompt}];
  return Promise.all(messages.map(async (message:Json)=>{
    if(typeof message.content==='string')return message;
    const content=await Promise.all(message.content.map(async (part:Json)=>{
      if(part.type!=='image_url')return part;
      const ref=await readReference(ctx,userId,{url:part.image_url?.url});
      return {type:'image_url',image_url:{url:`data:${ref.mimeType};base64,${ref.bytes.toString('base64')}`}};
    }));
    return {...message,content};
  }));
}
export async function invokeProvider(ctx:Context,job:Json,poll=false,transport:typeof safeFetch=safeFetch):Promise<ProviderResult>{
  let submitted=false;
  try{return await invokeProviderInternal(ctx,job,poll,transport,()=>{submitted=true;});}
  catch(error){if(error instanceof ProviderFailure)throw error;if(!submitted&&!poll)throw new ProviderFailure('Task could not be submitted because its media or provider configuration is unavailable',true);throw error;}
}
async function invokeProviderInternal(ctx:Context,job:Json,poll:boolean,transport:typeof safeFetch,onSubmit:()=>void):Promise<ProviderResult>{
  if(job.kind==='render'){const result=await renderShots(ctx,job.user_id,job.input.shots,job.input.ratio);return{type:'complete',result:{url:result.url}};}
  const settings=await getSettings(ctx);const channel=settings.systemChannels?.find((c:Json)=>c.id===job.channel_id&&c.enabled&&c.apiKey);
  if(!channel&&!poll)throw new ProviderFailure('Provider channel is no longer available',true);
  const key=ctx.decrypt(job.provider_config.apiKey);const base=String(job.provider_config.baseUrl).replace(/\/$/,'');const profile=job.provider_config.capabilityProfile||{};
  const request=async(path:string,body?:string|Buffer,contentType='application/json',method=body===undefined?'GET':'POST')=>{
    let response:Response;
    try{if(method==='POST')onSubmit();response=await transport(base+path,{method,headers:{authorization:`Bearer ${key}`,...(body===undefined?{}:{'content-type':contentType})},body,timeoutMs:120000,maxBytes:MAX_MEDIA_BYTES*2});}
    catch(error){
      if(!poll&&((error as any)?.statusCode===400||['ENOTFOUND','EAI_AGAIN'].includes((error as any)?.code)))throw new ProviderFailure('Provider destination was rejected before submission',true);
      throw new ProviderFailure('Provider connection result is unknown; manual verification may be required');
    }
    if(!response.ok)throw new ProviderFailure(`Provider rejected request (HTTP ${response.status})`,!poll&&response.status>=400&&response.status<500&&![408,409].includes(response.status));
    return response;
  };
  const model=job.upstream_model,input=job.input,config=input.config||{};
  if(job.kind==='text'){
    const response=await request('/chat/completions',JSON.stringify({model,messages:await providerTextMessages(ctx,job.user_id,input),stream:false}));
    const data=await response.json() as Json;const content=data.choices?.[0]?.message?.content;
    if(typeof content!=='string')throw new ProviderFailure('Provider returned no usable text output');
    return{type:'complete',result:{content}};
  }
  if(job.kind==='audio'){
    const response=await request('/audio/speech',JSON.stringify({model,input:input.prompt,voice:config.voice||'alloy',response_format:config.format||'mp3'}));
    const media=await saveMedia(ctx,job.user_id,Buffer.from(await response.arrayBuffer()));
    return{type:'complete',result:{url:media.url,mimeType:media.mimeType}};
  }
  if(job.kind==='image'){
    let response:Response;
    const outputSize=imageSize(config.size,config.resolution,profile);
    if(input.references?.length){
      const files=[];
      for(const reference of input.references){const data=await readReference(ctx,job.user_id,reference);if(!data.mimeType.startsWith('image/'))throw new ProviderFailure('Image references must be images',true);files.push({name:'image[]',data:data.bytes,mime:data.mimeType});}
      if(input.edit?.mask){const mask=await readReference(ctx,job.user_id,input.edit.mask);if(!mask.mimeType.startsWith('image/'))throw new ProviderFailure('Image edit masks must be images',true);files.push({name:'mask',data:mask.bytes,mime:mask.mimeType});}
      const multi=multipart({model,prompt:input.prompt,size:outputSize,n:'1',...(config.quality?{quality:config.quality}:{})},files);
      response=await request('/images/edits',multi.body,multi.contentType);
    }else response=await request('/images/generations',JSON.stringify({model,prompt:input.prompt,size:outputSize,n:1,...(config.quality?{quality:config.quality}:{})}));
    const data=await response.json() as Json;const results=[];
    if(!Array.isArray(data.data)||!data.data.length)throw new ProviderFailure('Provider returned no usable image output');
    for(const item of data.data){
      let bytes:Buffer;
      if(typeof item.b64_json==='string')bytes=Buffer.from(item.b64_json,'base64');
      else if(typeof item.url==='string'){const image=await transport(item.url,{maxBytes:MAX_MEDIA_BYTES,timeoutMs:30000});if(!image.ok)throw new ProviderFailure('Generated image could not be persisted');bytes=Buffer.from(await image.arrayBuffer());}
      else throw new ProviderFailure('Provider returned an invalid image output');
      const media=await saveMedia(ctx,job.user_id,bytes);results.push({url:media.url,mimeType:media.mimeType});
    }
    return{type:'complete',result:{results,remoteUrl:results[0].url}};
  }
  if(job.kind==='video'){
    let data:Json;
    if(poll){const response=await request(`/videos/${encodeURIComponent(job.upstream_id)}`);data=await response.json() as Json;}
    else{
      const files=[];
      if(input.references?.length){const ref=await readReference(ctx,job.user_id,input.references[0]);if(!ref.mimeType.startsWith('image/'))throw new ProviderFailure('Video reference must be an image',true);files.push({name:'input_reference',data:ref.bytes,mime:ref.mimeType});}
      const multi=multipart({model,prompt:input.prompt,size:videoSize(config.size),seconds:String(config.videoSeconds||'4')},files);
      const response=await request('/videos',multi.body,multi.contentType);data=await response.json() as Json;
    }
    if(data.status==='failed')throw new ProviderFailure('Video provider confirmed generation failure',true);
    const upstreamId=String(data.id||job.upstream_id||'');if(!upstreamId)throw new ProviderFailure('Provider did not return a video identifier');
    if(data.status==='completed'){
      const response=await request(`/videos/${encodeURIComponent(upstreamId)}/content`);const media=await saveMedia(ctx,job.user_id,Buffer.from(await response.arrayBuffer()));
      return{type:'complete',result:{url:media.url}};
    }
    if(!['queued','in_progress'].includes(data.status))throw new ProviderFailure('Provider returned an unknown video status');
    return{type:'pending',upstreamId};
  }
  throw new ProviderFailure('Unsupported generation type',true);
}

