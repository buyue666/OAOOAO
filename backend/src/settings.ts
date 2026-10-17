import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import nodemailer from 'nodemailer';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { type Context, hasPermission, httpError, object, pagination, publicAddress, safeFetch, string, transaction, iso } from './core.js';
import {creditUnits} from './wallet.js';
import {hasSiteCommercePolicy,resolveCommercePolicy} from './commerce-policy.js';
import {publicSite,validateSiteFooter} from './site-footer.js';
import {DEFAULT_CHECK_IN_SETTINGS,normalizeCheckInSettings,validateCheckInSettings} from './check-in.js';
import {DEFAULT_WECHAT,wechatConfig,wechatConfigured,publicWechatConfig,validateWechatConfig} from './wechat-config.js';
import {validatePlanGenerationKinds} from './entitlements.js';

export type Settings = Record<string, any>;
const bannerTones=new Set(['promo','info','warning','violet','rose','slate']);
const bannerEffects=new Set(['none','glow','shimmer']);
function validBannerStyle(value:unknown,allowed:Set<string>,name:string){if(typeof value!=='string'||!allowed.has(value))throw httpError(400,`Invalid announcement ${name}`);}
function announcementActionUrl(value:unknown):string|null {
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||/[\\\u0000-\u001f\u007f-\u009f]/u.test(value))throw httpError(400,'Invalid announcement action URL');
  const target=value.trim();
  if(!target)return null;
  if(target.length>2048)throw httpError(400,'Announcement action URL is too long');
  if(target.startsWith('/')&&!target.startsWith('//'))return target;
  if(!/^https?:\/\//i.test(target))throw httpError(400,'Invalid announcement action URL');
  let url:URL;
  try{url=new URL(target);}catch{throw httpError(400,'Invalid announcement action URL');}
  const authority=target.slice(target.indexOf('://')+3).split(/[/?#]/,1)[0];
  if(!['http:','https:'].includes(url.protocol)||!authority||!url.hostname||url.username||url.password||authority.includes('@')||url.href.length>2048)throw httpError(400,'Invalid announcement action URL');
  return target;
}
export const DEFAULT_SETTINGS: Settings = {
  site: { title: 'OAOOAO' }, operationMode:'self_use', registrationEnabled:false, emailRegistrationEnabled:false,
  checkIn:DEFAULT_CHECK_IN_SETTINGS,
  wechatOfficial:DEFAULT_WECHAT,
  freeDailyPointsEnabled:false, freeDailyPoints:0, allowUserApiConfig:false,
  mail:{provider:'smtp',port:587,secure:false}, modelPointCosts:{}, generationPointMultipliers:{imageQuality:{},videoQuality:{},videoSeconds:{}},
  generationCostControl:{maxPointsPerTask:10000,dailyUserPointSpend:0,dailyTotalPointSpend:0},
  dataLifecycle:{cleanupExpiredSessions:true,cleanupExpiredEmailCodes:true,cleanupExpiredGenerationTasks:false,cleanupExpiredTemporaryMedia:false,maintenanceBatchSize:100},
  entitlements:{enabled:false,defaultPlanId:'',plans:[]},
  generationConcurrency:{agent:1,image:2,video:1,audio:1,text:2,render:1},
  generationDefaults:{canvasImageCount:1,imageSize:'1024x1024',imageQuality:'standard',imageCount:1,videoQuality:'standard',videoSeconds:5,audioVoice:'alloy',audioFormat:'mp3'},
  systemChannels:[],logicalModels:[],defaultModels:{textModel:'',imageModel:'',videoModel:'',audioModel:''},
};
function merge(base: Record<string, any>, patch: Record<string, any>): Record<string,any> {
  const result = {...base};
  for(const [key,value] of Object.entries(patch)) {
    if(['__proto__','prototype','constructor'].includes(key)) throw httpError(400,'Invalid settings key');
    result[key] = value && typeof value==='object' && !Array.isArray(value) && base[key] && typeof base[key]==='object' && !Array.isArray(base[key]) ? merge(base[key],value) : value;
  }
  return result;
}
export async function getSettings(ctx: Context, client?: PoolClient): Promise<Settings> {
  const {rows}=await (client || ctx.db).query('SELECT value FROM oaooao_settings WHERE id=$1',['global']);
  const settings=merge(structuredClone(DEFAULT_SETTINGS),rows[0]?.value || {});settings.site=publicSite(settings.site);settings.checkIn=normalizeCheckInSettings(settings.checkIn);return settings;
}
export function sanitizedSettings(settings: Settings,origin=''): Settings {
  return {...settings,wechatOfficial:publicWechatConfig(settings.wechatOfficial,origin),site:publicSite(settings.site),checkIn:normalizeCheckInSettings(settings.checkIn),commercePolicy:resolveCommercePolicy(settings),mail:{...settings.mail,password:'',hasPassword:Boolean(settings.mail?.password)},
    systemChannels:(settings.systemChannels || []).map((channel: any) => ({...channel,apiKey:'',webhookSecret:'',hasApiKey:Boolean(channel.apiKey),hasWebhookSecret:Boolean(channel.webhookSecret)}))};
}
export function publicSettings(settings: Settings): Settings {
  const allowed=['site','operationMode','registrationEnabled','emailRegistrationEnabled','freeDailyPointsEnabled','freeDailyPoints','modelPointCosts','generationPointMultipliers','generationConcurrency','generationDefaults','defaultModels'];
  const result=Object.fromEntries(allowed.map(key=>[key,settings[key]]));
  result.site=publicSite(settings.site);
  result.checkIn=normalizeCheckInSettings(settings.checkIn);
  result.wechatLoginEnabled=wechatConfig(settings.wechatOfficial).enabled&&wechatConfigured(settings.wechatOfficial);
  result.wechatRegistrationEnabled=result.wechatLoginEnabled&&wechatConfig(settings.wechatOfficial).autoRegister&&settings.registrationEnabled===true&&!settings.emailRegistrationEnabled;
  result.logicalModels=(settings.logicalModels || []).filter((m:any)=>m.enabled).map((m:any)=>({id:m.id,name:m.name,capability:m.capability,enabled:m.enabled,iconUrl:m.iconUrl,aliases:m.aliases,bindings:(m.bindings || []).filter((b:any)=>b.enabled).map((b:any)=>({id:b.id,channelId:b.channelId,upstreamModel:b.upstreamModel,enabled:b.enabled,priority:b.priority,capabilityProfile:b.capabilityProfile,requestAlias:b.requestAlias,iconUrl:b.iconUrl}))}));
  result.systemChannels=(settings.systemChannels || []).filter((c:any)=>c.enabled).map((c:any)=>{let baseUrl='';try{const url=new URL(c.baseUrl);baseUrl=`${url.origin}${url.pathname}`;}catch{}return {id:c.id,name:c.name,baseUrl,apiFormat:c.apiFormat,models:c.models,enabled:c.enabled,hasApiKey:Boolean(c.apiKey)};});
  return result;
}
const upstreamKeys=new Set(['systemChannels','logicalModels','defaultModels','modelPointCosts','generationPointMultipliers','generationConcurrency','generationDefaults','generationCostControl','allowUserApiConfig']);
const commerceKeys=new Set(['entitlements','freeDailyPointsEnabled','freeDailyPoints','commercePolicy','checkIn']);
const systemKeys=new Set(['site','operationMode','registrationEnabled','emailRegistrationEnabled','mail','dataLifecycle','wechatOfficial']);
export function settingsPermission(key:string) {
  if(upstreamKeys.has(key))return 'upstream.manage';if(commerceKeys.has(key))return 'commerce.manage';if(systemKeys.has(key))return 'system.manage';
  throw httpError(400,`Unknown setting: ${key}`);
}
function validNumber(value:any,name:string,min=0,max=1000000000) {if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw httpError(400,`Invalid ${name}`);}
function validCapabilityList(value:unknown,name:string,max=32) {
  if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=='string'||!item.trim()||item.length>100))throw httpError(400,`Invalid ${name}`);
}
function validCapabilitySizeMap(value:unknown,name:string) {
  const map=object(value);const entries=Object.entries(map);
  if(entries.length>128)throw httpError(400,`Invalid ${name}`);
  for(const [key,nested] of entries){
    if(!key.trim()||key.length>100)throw httpError(400,`Invalid ${name}`);
    if(typeof nested==='string'){
      if(!/^(?:auto|\d+x\d+)$/i.test(nested.trim()))throw httpError(400,`Invalid ${name}`);
      continue;
    }
    const row=object(nested);
    if(Object.keys(row).length>64)throw httpError(400,`Invalid ${name}`);
    for(const [child,value] of Object.entries(row)){
      if(!child.trim()||child.length>100||typeof value!=='string'||!/^(?:auto|\d+x\d+)$/i.test(value.trim()))throw httpError(400,`Invalid ${name}`);
    }
  }
}
function validUrl(value:unknown,name:string,allowRelative=false) {if(value===undefined||value==='')return;if(typeof value!=='string')throw httpError(400,`Invalid ${name}`);if(allowRelative&&value.startsWith('/')&&!value.startsWith('//'))return;let url:URL;try{url=new URL(value);}catch{throw httpError(400,`Invalid ${name}`);}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw httpError(400,`Invalid ${name}`);}
function preserveSecret(ctx:Context,next:any,old:any,field:string,clear:string) { if(next[clear]===true)return '';if(next[field]===undefined||next[field]==='')return old?.[field] || '';if(typeof next[field]!=='string'||next[field].length>16384||next[field].startsWith('enc:'))throw httpError(400,`Invalid ${field}`);return ctx.encrypt(next[field]); }
export function validateSettingsPatch(ctx:Context,current:Settings,patch:Settings):Settings {
  for(const key of Object.keys(patch))settingsPermission(key);
  if(patch.site&&Object.hasOwn(object(patch.site),'announcementBar'))throw httpError(400,'The backup announcement bar has been retired; use announcements');
  if(JSON.stringify(patch).length>512000)throw httpError(413,'Settings payload too large');
  const flatPolicy=Object.hasOwn(patch,'commercePolicy'),sitePolicy=hasSiteCommercePolicy(patch);
  if(flatPolicy&&sitePolicy)throw httpError(400,'Send commercePolicy in only one location');
  const next=merge(current,patch);
  if(patch.wechatOfficial!==undefined)next.wechatOfficial=validateWechatConfig(ctx,current.wechatOfficial,patch.wechatOfficial);
  if(flatPolicy||sitePolicy){
    const policy=flatPolicy?patch.commercePolicy:patch.site.commercePolicy;
    next.site={...object(next.site),commercePolicy:policy===null?null:merge(resolveCommercePolicy(current)||{},object(policy))};
    delete next.commercePolicy;
  }
  for(const key of ['registrationEnabled','emailRegistrationEnabled','freeDailyPointsEnabled','allowUserApiConfig'])if(typeof next[key]!=='boolean')throw httpError(400,`Invalid ${key}`);
  if(!['self_use','commercial'].includes(next.operationMode))throw httpError(400,'Invalid operation mode');
  validNumber(next.freeDailyPoints,'daily points');creditUnits(next.freeDailyPoints);
  for(const [key,value] of Object.entries(object(next.modelPointCosts))){validNumber(value,`model cost ${key}`);creditUnits(value as number);}
  for(const [key,value] of Object.entries(object(next.generationConcurrency))){validNumber(value,key,1,100);if(!Number.isInteger(value))throw httpError(400,'Concurrency must be an integer');}
  for(const category of Object.values(object(next.generationPointMultipliers)))for(const value of Object.values(object(category))){validNumber(value,'point multiplier',0,10000);creditUnits(value as number);}
  for(const value of Object.values(object(next.generationCostControl))){validNumber(value,'cost control');creditUnits(value as number);}
  for(const key of ['logoUrl','iconUrl','heroVideoUrl','heroVideoPosterUrl','termsUrl','privacyUrl'])validUrl(next.site[key],key,true);
  delete next.site.announcementBar;
  if(patch.site&&Object.hasOwn(object(patch.site),'footer'))next.site.footer=validateSiteFooter(next.site.footer);
  for(const entry of next.site.friendLinks || [])validUrl(entry.url,'friend link');
  for(const entry of Object.values(next.site.socials || {}) as any[])validUrl(entry.url,'social link');
  if(patch.mail){
    if(current.mail.password&&String(next.mail.host||'').trim().toLowerCase()!==String(current.mail.host||'').trim().toLowerCase()&&!patch.mail.password&&patch.mail.clearPassword!==true)throw httpError(400,'Changing the SMTP host requires a new password or clearing the saved password');
    next.mail.password=preserveSecret(ctx,patch.mail,current.mail,'password','clearPassword');delete next.mail.clearPassword;delete next.mail.hasPassword;
  }
  if(next.mail.port!==undefined)validNumber(next.mail.port,'SMTP port',1,65535);
  if(patch.systemChannels){
    if(!Array.isArray(patch.systemChannels)||patch.systemChannels.length>200)throw httpError(400,'Invalid system channels');
    const ids=new Set<string>();next.systemChannels=patch.systemChannels.map((raw:any)=>{
      const channel=object(raw);string(channel.id,'channel ID',100);string(channel.name,'channel name',200);validUrl(channel.baseUrl,'channel URL');
      if(ids.has(channel.id))throw httpError(400,'Duplicate channel ID');ids.add(channel.id);
      if(!Array.isArray(channel.models)||channel.models.length>2000||channel.models.some((m:any)=>typeof m!=='string'||m.length>200))throw httpError(400,'Invalid channel models');
      if(typeof channel.enabled!=='boolean')throw httpError(400,'Invalid channel enabled state');
      const old=current.systemChannels.find((c:any)=>c.id===channel.id);
      if(old?.apiKey&&new URL(old.baseUrl).origin!==new URL(channel.baseUrl).origin&&!channel.apiKey&&channel.clearApiKey!==true)throw httpError(400,'Changing a channel origin requires a new API key or clearing the saved key');
      if(old?.webhookSecret&&new URL(old.baseUrl).origin!==new URL(channel.baseUrl).origin&&!channel.webhookSecret&&channel.clearWebhookSecret!==true)throw httpError(400,'Changing a channel origin requires a new webhook secret or clearing the saved secret');
      const advanced=channel.advancedConfig || {};
      if(/password|api.?key|secret|authorization/i.test(JSON.stringify(Object.keys(advanced))))throw httpError(400,'Credentials must use designated secret fields');
      return {id:channel.id,name:channel.name,baseUrl:channel.baseUrl,models:channel.models,enabled:channel.enabled,apiFormat:channel.apiFormat||'openai',advancedConfig:advanced,
        apiKey:preserveSecret(ctx,channel,old,'apiKey','clearApiKey'),webhookSecret:preserveSecret(ctx,channel,old,'webhookSecret','clearWebhookSecret')};
    });
  }
  if(!Array.isArray(next.logicalModels)||next.logicalModels.length>2000)throw httpError(400,'Invalid logical models');
  const modelNames=new Set<string>();
  for(const model of next.logicalModels){
    string(model.id,'model ID',200);string(model.name,'model name',200);
    if(!['text','image','video','audio'].includes(model.capability)||typeof model.enabled!=='boolean'||!Array.isArray(model.bindings))throw httpError(400,'Invalid logical model');
    for(const name of [model.id,...(model.aliases||[])]){string(name,'model alias',200);if(modelNames.has(name))throw httpError(400,'Duplicate model name or alias');modelNames.add(name);}
    const bindingIds=new Set<string>();
    for(const binding of model.bindings){string(binding.id,'binding ID');string(binding.upstreamModel,'upstream model');if(bindingIds.has(binding.id))throw httpError(400,'Duplicate binding ID');bindingIds.add(binding.id);if(!next.systemChannels.some((c:any)=>c.id===binding.channelId))throw httpError(400,'Binding channel does not exist');if(typeof binding.enabled!=='boolean')throw httpError(400,'Invalid binding enabled');validNumber(binding.priority,'binding priority',0,100000);
      if(binding.capabilityProfile!==undefined&&binding.capabilityProfile!==null){
        const profile=object(binding.capabilityProfile);
        if(profile.aspectRatios!==undefined)validCapabilityList(profile.aspectRatios,'aspect ratios');
        if(profile.outputResolutions!==undefined)validCapabilityList(profile.outputResolutions,'output resolutions');
        if(profile.imageQualities!==undefined)validCapabilityList(profile.imageQualities,'image qualities');
        if(profile.qualities!==undefined)validCapabilityList(profile.qualities,'image qualities');
        if(profile.sizeMap!==undefined)validCapabilitySizeMap(profile.sizeMap,'capability size map');
        if(profile.outputDimensions!==undefined)validCapabilitySizeMap(profile.outputDimensions,'capability output dimensions');
      }
    }
  }
  for(const capability of ['text','image','video','audio']){const id=next.defaultModels[`${capability}Model`];if(id&&!next.logicalModels.some((m:any)=>m.id===id&&m.capability===capability&&m.enabled))throw httpError(400,'Default model must be an enabled model of matching capability');}
  if(typeof next.entitlements.enabled!=='boolean'||!Array.isArray(next.entitlements.plans))throw httpError(400,'Invalid entitlement plans');
  const planIds=new Set<string>();
  for(const plan of next.entitlements.plans){validatePlanGenerationKinds(plan);string(plan.id,'plan ID');string(plan.name,'plan name');if(planIds.has(plan.id)||typeof plan.enabled!=='boolean')throw httpError(400,'Plan IDs must be unique and enabled must be boolean');planIds.add(plan.id);validNumber(plan.dailyPoints,'plan daily points');creditUnits(plan.dailyPoints);for(const [key,value]of Object.entries(object(plan.limits))){validNumber(value,'plan limit');if(key==='dailyPointSpend')creditUnits(value as number);else if(!Number.isInteger(value))throw httpError(400,'Daily plan count limits must be integers');}}
  if(next.entitlements.enabled&&!next.entitlements.plans.some((plan:any)=>plan.id===next.entitlements.defaultPlanId&&plan.enabled))throw httpError(400,'An enabled default entitlement plan is required');
  if(Object.hasOwn(patch,'checkIn')||Object.hasOwn(patch,'entitlements'))next.checkIn=validateCheckInSettings(next.checkIn,planIds);
  return next;
}
export async function sendMail(ctx:Context,mail:Settings,to:string,subject:string,text:string) {
  if(!mail.host||!mail.fromEmail)throw httpError(503,'Email delivery is not configured');
  const host=string(mail.host,'mail host',253);const from=string(mail.fromEmail,'mail sender',320);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from))throw httpError(400,'Invalid email address');
  if(mail.provider && mail.provider!=='smtp')throw httpError(503,'Configured mail provider is not supported');
  const address=await publicAddress(host);
  const transport=nodemailer.createTransport({host:address.address,port:mail.port||587,secure:mail.secure===true,requireTLS:mail.secure!==true,
    auth:mail.username?{user:mail.username,pass:ctx.decrypt(mail.password||'')}:undefined,
    tls:{servername:host,rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
  try {const result=await transport.sendMail({from:{address:from,name:mail.fromName||'OAOOAO'},to,subject,text});if(!result.accepted?.length)throw new Error('Recipient rejected');}
  catch {throw httpError(502,'Mail delivery was not accepted by the configured server');}
  finally {transport.close();}
}
export async function getObjectStorageSettings(ctx:Context) {
  const {rows}=await ctx.db.query('SELECT value,updated_at FROM oaooao_settings WHERE id=$1',['object-storage']);
  return {...{enabled:false,endpoint:'',region:'us-east-1',bucket:'',prefix:'oaooao',forcePathStyle:true},...rows[0]?.value,updatedAt:iso(rows[0]?.updated_at)} as Settings;
}
function storagePublic(value:Settings) {const {accessKeyId,secretAccessKey,...rest}=value;return {...rest,hasAccessKeyId:Boolean(accessKeyId),hasSecretAccessKey:Boolean(secretAccessKey)};}

export async function registerSettings(app:FastifyInstance,ctx:Context) {
  app.get('/api/admin/settings',async request=>{const user=await ctx.requireUser(request);if(!['system.manage','upstream.manage','commerce.manage','billing.manage'].some(p=>hasPermission(user,p)))throw httpError(403,'Permission denied');return {settings:sanitizedSettings(await getSettings(ctx),ctx.config.origin)};});
  app.patch('/api/admin/settings',async request=>{
    const user=await ctx.requireUser(request);const patch=object(request.body);
    for(const key of Object.keys(patch))if(!hasPermission(user,settingsPermission(key)))throw httpError(403,`Permission required: ${settingsPermission(key)}`);
    if(hasSiteCommercePolicy(patch)&&!hasPermission(user,'commerce.manage'))throw httpError(403,'Permission required: commerce.manage');
    const settings=await transaction(ctx.db,async client=>{await client.query('SELECT id FROM oaooao_settings WHERE id=$1 FOR UPDATE',['global']);const current=await getSettings(ctx,client),next=validateSettingsPatch(ctx,current,patch);
      if(patch.wechatOfficial&&wechatConfig(current.wechatOfficial).appId!==wechatConfig(next.wechatOfficial).appId&&(await client.query('SELECT 1 FROM oaooao_wechat_identities LIMIT 1')).rowCount)throw httpError(409,'已有微信绑定，不能直接更换AppID；请先完成受控身份迁移');
      await client.query('UPDATE oaooao_settings SET value=$2::jsonb,updated_at=now() WHERE id=$1',['global',JSON.stringify(next)]);await ctx.audit({actorId:user.id,action:'settings.update',targetType:'settings',targetId:'global',metadata:{fields:Object.keys(patch)}},client);return next;});
    return {settings:sanitizedSettings(settings,ctx.config.origin)};
  });
  app.post('/api/admin/mail/test',async request=>{const user=await ctx.requireUser(request,'system.manage');const body=object(request.body);const saved=await getSettings(ctx);const mail=body.mail?validateSettingsPatch(ctx,saved,{mail:object(body.mail)}).mail:saved.mail;await sendMail(ctx,mail,string(body.to,'recipient',320),'OAOOAO mail delivery test','This is a requested OAOOAO mail configuration test.');await ctx.audit({actorId:user.id,action:'mail.test',targetType:'mail'});return {ok:true};});
  app.get('/api/admin/object-storage',async request=>{await ctx.requireUser(request,'system.manage');return {code:0,data:storagePublic(await getObjectStorageSettings(ctx))};});
  app.patch('/api/admin/object-storage',async request=>{
    const user=await ctx.requireUser(request,'system.manage'),body=object(request.body);
    validUrl(body.endpoint,'storage endpoint');if(typeof body.enabled!=='boolean'||typeof body.forcePathStyle!=='boolean')throw httpError(400,'Invalid storage settings');
    if(body.enabled&&(!body.endpoint||!body.bucket))throw httpError(400,'Storage endpoint and bucket required');
    if(typeof body.prefix!=='string'||body.prefix.includes('..')||body.prefix.includes('\\'))throw httpError(400,'Invalid storage prefix');
    const value=await transaction(ctx.db,async client=>{
      const {rows}=await client.query('SELECT value FROM oaooao_settings WHERE id=$1 FOR UPDATE',['object-storage']);const old=rows[0]?.value||{};
      if((old.endpoint?new URL(old.endpoint).origin:'')!==(body.endpoint?new URL(body.endpoint).origin:'')){
        if(old.accessKeyId&&!body.accessKeyId&&body.clearAccessKeyId!==true)throw httpError(400,'Changing the storage origin requires a new access key ID or clearing the saved key');
        if(old.secretAccessKey&&!body.secretAccessKey&&body.clearSecretAccessKey!==true)throw httpError(400,'Changing the storage origin requires a new secret access key or clearing the saved key');
      }
      const next={enabled:body.enabled,endpoint:body.endpoint,region:string(body.region,'region',100),bucket:string(body.bucket,'bucket',200,true),prefix:body.prefix,forcePathStyle:body.forcePathStyle,accessKeyId:preserveSecret(ctx,body,old,'accessKeyId','clearAccessKeyId'),secretAccessKey:preserveSecret(ctx,body,old,'secretAccessKey','clearSecretAccessKey')};await client.query('UPDATE oaooao_settings SET value=$2::jsonb,updated_at=now() WHERE id=$1',['object-storage',JSON.stringify(next)]);await ctx.audit({actorId:user.id,action:'storage.update',targetType:'settings',targetId:'object-storage'},client);return next;
    });return {code:0,data:storagePublic(value)};
  });
  app.post('/api/admin/object-storage',async request=>{
    const user=await ctx.requireUser(request,'system.manage'),stored=await getObjectStorageSettings(ctx);
    if(!stored.enabled||!stored.endpoint||!stored.bucket||!stored.accessKeyId||!stored.secretAccessKey)throw httpError(503,'Object storage is not fully configured');
    const client=new S3Client({endpoint:stored.endpoint,region:stored.region,forcePathStyle:stored.forcePathStyle,credentials:{accessKeyId:ctx.decrypt(stored.accessKeyId),secretAccessKey:ctx.decrypt(stored.secretAccessKey)},maxAttempts:1,
      requestHandler:{async handle(req:any){const url=new URL(`${req.protocol}//${req.hostname}${req.port?`:${req.port}`:''}${req.path}`);for(const [key,value]of Object.entries(req.query||{}))url.searchParams.set(key,String(value));const response=await safeFetch(url,{method:req.method,headers:req.headers,maxBytes:1024*1024});return {response:{statusCode:response.status,headers:Object.fromEntries(response.headers),body:new Uint8Array(await response.arrayBuffer())}};}}});
    try{await client.send(new HeadBucketCommand({Bucket:stored.bucket}));}catch{throw httpError(502,'Object storage connectivity or bucket access could not be verified');}finally{client.destroy();}
    await ctx.audit({actorId:user.id,action:'storage.test',targetType:'settings',targetId:'object-storage'});return {code:0,data:{ok:true,bucketAccessible:true,writeVerified:false}};
  });
  app.post('/api/admin/models',async request=>{
    await ctx.requireUser(request,'upstream.manage');const body=object(request.body),settings=await getSettings(ctx);const saved=settings.systemChannels.find((c:any)=>c.id===body.channelId);
    const baseUrl=string(body.baseUrl||saved?.baseUrl,'base URL',2000);validUrl(baseUrl,'base URL');
    if(saved?.apiKey&&!body.apiKey&&new URL(baseUrl).origin!==new URL(saved.baseUrl).origin)throw httpError(400,'A saved API key cannot be used with a different provider origin');
    const key=body.apiKey?string(body.apiKey,'API key',16384):ctx.decrypt(saved?.apiKey||'');
    const format=body.apiFormat||saved?.apiFormat||'openai';if(!['openai','openai-compatible'].includes(format))throw httpError(501,'Model catalog discovery is unavailable for this protocol');
    const base=new URL(baseUrl);base.pathname=`${base.pathname.replace(/\/$/,'')}/models`;
    const response=await safeFetch(base,{headers:key?{authorization:`Bearer ${key}`}:{},maxBytes:2*1024*1024});
    if(!response.ok)throw httpError(502,`Upstream model catalog returned HTTP ${response.status}`);
    const payload=await response.json() as any;if(!Array.isArray(payload.data))throw httpError(502,'Upstream model catalog has invalid format');
    const models=[...new Set<string>(payload.data.filter((m:any)=>typeof m.id==='string').map((m:any)=>m.id))].slice(0,2000);
    return {models,discoveredCount:models.length,totalCount:models.length,catalogSupported:true,provider:format};
  });
  app.get('/api/admin/launch-readiness',async request=>{
    await ctx.requireUser(request,'system.manage');const settings=await getSettings(ctx),profile=(request.query as any)?.profile||'self_use';
    if(!['self_use','paid_beta','production'].includes(profile))throw httpError(400,'Invalid launch profile');
    const transfer=(await ctx.db.query('SELECT imported_at FROM oaooao_transfer_runs ORDER BY imported_at DESC LIMIT 1')).rows[0];
    const configured=settings.logicalModels.some((m:any)=>m.enabled&&m.bindings.some((b:any)=>b.enabled&&settings.systemChannels.some((c:any)=>c.id===b.channelId&&c.enabled&&(c.apiKey||c.advancedConfig?.authMode==='none'))));
    const items=[{id:'database',title:'数据库连接',level:'ok',detail:'已成功读取 PostgreSQL 中的系统设置。'},
      {id:'origin',title:'登录安全域名',level:ctx.config.origin.startsWith('https:')?'ok':profile==='self_use'?'warning':'error',detail:ctx.config.origin.startsWith('https:')?'已配置 HTTPS 访问域名。':'对外开放前需配置 HTTPS 访问域名。'},
      {id:'models',title:'生成服务',level:configured?'warning':'error',detail:configured?'已配置模型与渠道，仍需实际生成验证可用性。':'没有已启用且具备渠道凭证的模型。'},
      {id:'mail',title:'邮件服务',level:settings.mail.host&&settings.mail.fromEmail?'warning':settings.emailRegistrationEnabled?'error':'warning',detail:settings.mail.host?'已配置邮件服务器，请发送测试邮件核对投递结果。':'尚未配置邮件发送服务。'},
      {id:'migration',title:'数据迁移核对',level:transfer?'ok':profile==='self_use'?'warning':'error',detail:transfer?`初次数据迁移已在导入事务中核对，时间：${iso(transfer.imported_at)}。`:'未发现已核对的初次导入记录。切换前需核对账户、积分、项目和历史记录。'},
      {id:'payments',title:'收款与退款验收',level:profile==='self_use'?'warning':'error',detail:'保存配置不代表收款已验证。正式收费前需完成支付平台到账、通知和退款对账的实际验收。'}];
    const planProducts=(await ctx.db.query("SELECT plan_id FROM oaooao_products WHERE enabled=true AND product_kind='plan'")).rows;
    const invalidPlans=planProducts.filter(product=>!settings.entitlements.enabled||!settings.entitlements.plans.some((plan:any)=>plan.id===product.plan_id&&plan.enabled));
    items.push({id:'plan-products',title:'套餐与权益关联',level:invalidPlans.length?'error':'ok',detail:invalidPlans.length?`${invalidPlans.length} 个已上架套餐缺少已启用的权益方案，系统已阻止购买。`:'已上架套餐均有关联的权益方案。'});
    const storage=await getObjectStorageSettings(ctx);
    items.push({id:'creative-storage',title:'生成素材存储',level:storage.enabled?'error':'warning',detail:storage.enabled?'外部存储已设为启用，但生成素材的对象存储写入尚未接通，当前会阻止相关生成。请在对象存储设置中检查。':'当前生成素材使用服务器持久化目录；对象存储连接检测不等于已支持外部存储写入。'});
    items.push({id:'wechat-login',title:'微信扫码登录',level:'warning',detail:settings.wechatOfficial?.enabled&&wechatConfigured(settings.wechatOfficial)?'凭证已配置。请在微信公众平台设置回调与服务器白名单，并用真实微信完成扫码、绑定和登录验收。':'微信扫码登录尚未开启或凭证不完整，可在系统设置的“微信登录”中配置。'});
    items.push({id:'remaining-capabilities',title:'尚未接通的能力',level:'warning',detail:'当前不支持剪映官方草稿格式导出、自动邀请风控、可执行代码型技能及多因素认证。支付宝、微信支付和 Stripe 的直接支付协议也尚未接通；可配置易支付聚合收款。'});
    const errors=items.filter(i=>i.level==='error').length,warnings=items.filter(i=>i.level==='warning').length;return {code:0,data:{passed:errors===0,errors,warnings,checkedAt:new Date().toISOString(),items}};
  });
  app.get('/api/admin/audit-logs',async request=>{
    await ctx.requireUser(request,'audit.read');const q=(request.query||{}) as any,{page,pageSize,offset}=pagination(q),where:string[]=[],params:any[]=[];
    for(const [key,column]of [['action','action'],['status','status'],['actorId','actor_id'],['targetType','target_type']])if(q[key]){params.push(string(q[key],key,200));where.push(`a.${column}=$${params.length}`);}
    if(q.keyword){params.push(`%${string(q.keyword,'keyword',200)}%`);where.push(`(a.action ILIKE $${params.length} OR a.target_id ILIKE $${params.length})`);}
    for(const [key,operator]of [['start','>='],['end','<=']])if(q[key]){const d=new Date(q[key]);if(!Number.isFinite(d.getTime()))throw httpError(400,'Invalid audit date');params.push(d.toISOString());where.push(`a.created_at${operator}$${params.length}::timestamptz`);}
    const clause=where.length?`WHERE ${where.join(' AND ')}`:'';const count=await ctx.db.query(`SELECT count(*) FROM oaooao_audit_logs a ${clause}`,params);params.push(pageSize,offset);
    const {rows}=await ctx.db.query(`SELECT a.*,u.username,u.role FROM oaooao_audit_logs a LEFT JOIN oaooao_users u ON u.id=a.actor_id ${clause} ORDER BY a.created_at DESC,a.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    return {logs:rows.map(r=>({id:r.id,action:r.action,status:r.status,actor:{id:r.actor_id,username:r.username,role:r.role},target:{type:r.target_type,id:r.target_id},metadata:r.metadata,createdAt:iso(r.created_at)})),total:Number(count.rows[0].count),page,pageSize};
  });
  const announcement=(r:any)=>({id:r.id,title:r.title,content:r.content,enabled:r.enabled,popupHome:r.popup_home,popupAfterLogin:r.popup_after_login,bannerTone:r.banner_tone??'promo',bannerEffect:r.banner_effect??'glow',actionUrl:r.action_url??undefined,startsAt:iso(r.starts_at),endsAt:iso(r.ends_at),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)});
  app.get('/api/announcements',async()=>{const {rows}=await ctx.db.query('SELECT * FROM oaooao_announcements WHERE enabled=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now()) ORDER BY created_at DESC LIMIT 100');return {announcements:rows.map(announcement)};});
  app.get('/api/admin/announcements',async request=>{await ctx.requireUser(request,'content.manage');const {page,pageSize,offset}=pagination(request.query);const {rows}=await ctx.db.query('SELECT *,count(*) OVER() AS total FROM oaooao_announcements ORDER BY created_at DESC LIMIT $1 OFFSET $2',[pageSize,offset]);return {announcements:rows.map(announcement),total:Number(rows[0]?.total||0),page,pageSize};});
  async function writeAnnouncement(request:any,isNew:boolean){
    const user=await ctx.requireUser(request,'content.manage'),body=object(request.body),id=isNew?randomUUID():request.params.id;
    return transaction(ctx.db,async client=>{
      const current=isNew?{}:(await client.query('SELECT * FROM oaooao_announcements WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!current)throw httpError(404,'Announcement not found');
      const next:Record<string,any>={...announcement(current),...body};
      string(next.title,'title',300);string(next.content,'content',100000);
      for(const key of ['enabled','popupHome','popupAfterLogin'])if(next[key]!==undefined&&typeof next[key]!=='boolean')throw httpError(400,'Invalid announcement flag');
      validBannerStyle(next.bannerTone,bannerTones,'tone');validBannerStyle(next.bannerEffect,bannerEffects,'effect');
      const actionUrl=announcementActionUrl(next.actionUrl);
      for(const key of ['startsAt','endsAt'])if(next[key]&&!Number.isFinite(new Date(next[key]).getTime()))throw httpError(400,'Invalid announcement date');
      if(next.startsAt&&next.endsAt&&new Date(next.startsAt)>=new Date(next.endsAt))throw httpError(400,'Invalid announcement period');
      const {rows}=await client.query(`INSERT INTO oaooao_announcements(id,title,content,enabled,popup_home,popup_after_login,starts_at,ends_at,banner_tone,banner_effect,action_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET title=$2,content=$3,enabled=$4,popup_home=$5,popup_after_login=$6,starts_at=$7,ends_at=$8,banner_tone=$9,banner_effect=$10,action_url=$11,updated_at=now() RETURNING *`,[id,next.title,next.content,next.enabled||false,next.popupHome||false,next.popupAfterLogin||false,next.startsAt||null,next.endsAt||null,next.bannerTone,next.bannerEffect,actionUrl]);
      await ctx.audit({actorId:user.id,action:isNew?'announcement.create':'announcement.update',targetType:'announcement',targetId:id},client);
      return {announcement:announcement(rows[0])};
    });
  }
  app.post('/api/admin/announcements',request=>writeAnnouncement(request,true));app.patch('/api/admin/announcements/:id',request=>writeAnnouncement(request,false));
  app.delete('/api/admin/announcements/:id',async request=>{const user=await ctx.requireUser(request,'content.manage'),id=(request.params as any).id;await transaction(ctx.db,async client=>{const result=await client.query('DELETE FROM oaooao_announcements WHERE id=$1',[id]);if(!result.rowCount)throw httpError(404,'Announcement not found');await ctx.audit({actorId:user.id,action:'announcement.delete',targetType:'announcement',targetId:id},client);});return {ok:true};});
}

