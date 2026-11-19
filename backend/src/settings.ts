import {normalizeModelCatalog,modelReady} from './model-catalog.js';
import {effectiveChannelProtocol} from './channel-protocol.js';
import {validateUpstreamPricing} from './upstream-pricing.js';
import {sameSetting,settingChanged} from './settings-diff.js';
import {validateVideoPolicySettings,videoDurations} from './video-policy.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import nodemailer from 'nodemailer';
import { verifyStorage } from './object-storage.js';
import { validStorageQuota } from './storage-quota.js';
import { type Context, hasPermission, httpError, object, pagination, publicAddress, safeFetch, string, transaction, iso } from './core.js';
import {creditUnits} from './wallet.js';
import {hasSiteCommercePolicy,resolveCommercePolicy} from './commerce-policy.js';
import {publicSite,validateSiteFooter} from './site-footer.js';
import {uploadedWechatPng,validateWechatContact,visibleWechatContact,wechatQrVersion} from './wechat-contact.js';
import {DEFAULT_CHECK_IN_SETTINGS,normalizeCheckInSettings,validateCheckInSettings} from './check-in.js';
import {DEFAULT_WECHAT,wechatConfig,wechatConfigured,publicWechatConfig,validateWechatConfig} from './wechat-config.js';
import {validatePlanConcurrency,validatePlanGenerationKinds,validatePlanModels} from './entitlements.js';

import { DEFAULT_WATERMARK_POLICY } from './watermark-policy.js';
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
  registrationRateLimit:{enabled:false,maxAttempts:5,windowSeconds:3600},
  watermarkPolicy:DEFAULT_WATERMARK_POLICY,
  accountMenu:{adultContentSettingsVisible:true},
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
function settingsFromStorage(stored:Settings):Settings {
  const settings=merge(structuredClone(DEFAULT_SETTINGS),stored);settings.site=publicSite(settings.site);settings.checkIn=normalizeCheckInSettings(settings.checkIn);
  return normalizeModelCatalog(settings);
}
export async function getSettings(ctx: Context, client?: PoolClient): Promise<Settings> {
  const {rows}=await (client || ctx.db).query('SELECT value FROM oaooao_settings WHERE id=$1',['global']);
  return settingsFromStorage(rows[0]?.value || {});
}
export function sanitizedSettings(settings: Settings,origin=''): Settings {
  return {...settings,wechatOfficial:publicWechatConfig(settings.wechatOfficial,origin),site:{...publicSite(settings.site),wechatContact:visibleWechatContact(settings.site?.wechatContact,true)},checkIn:normalizeCheckInSettings(settings.checkIn),commercePolicy:resolveCommercePolicy(settings),mail:{...settings.mail,password:'',hasPassword:Boolean(settings.mail?.password)},
    systemChannels:(settings.systemChannels || []).map((channel: any) => ({...channel,apiKey:'',webhookSecret:'',hasApiKey:Boolean(channel.apiKey),hasWebhookSecret:Boolean(channel.webhookSecret)}))};
}
export function publicSettings(settings: Settings): Settings {
  const allowed=['site','operationMode','registrationEnabled','emailRegistrationEnabled','freeDailyPointsEnabled','freeDailyPoints','modelPointCosts','generationPointMultipliers','generationConcurrency','generationDefaults','defaultModels'];
  const result=Object.fromEntries(allowed.map(key=>[key,settings[key]]));
  result.site={...publicSite(settings.site),wechatContact:visibleWechatContact(settings.site?.wechatContact)};
  result.checkIn=normalizeCheckInSettings(settings.checkIn);
  result.wechatLoginEnabled=wechatConfig(settings.wechatOfficial).enabled&&wechatConfigured(settings.wechatOfficial);
  result.wechatRegistrationEnabled=result.wechatLoginEnabled&&wechatConfig(settings.wechatOfficial).autoRegister&&settings.registrationEnabled===true&&!settings.emailRegistrationEnabled;
  result.logicalModels=(settings.logicalModels || []).filter((m:any)=>m.enabled&&modelReady(m,settings.systemChannels||[])).map((m:any)=>({id:m.id,name:m.name,capability:m.capability,enabled:m.enabled,requiresSubscription:m.requiresSubscription===true,description:typeof m.description==='string'?m.description.trim()||undefined:undefined,allowAdultContent:m.allowAdultContent===true,iconUrl:m.iconUrl,note:typeof m.note==='string'?m.note.trim()||undefined:undefined,aliases:m.aliases,bindings:(m.bindings || []).filter((b:any)=>b.enabled&&(settings.systemChannels||[]).some((c:any)=>c.id===b.channelId&&c.enabled&&(c.apiKey||c.advancedConfig?.authMode==='none'))).map((b:any)=>({id:b.id,channelId:b.channelId,upstreamModel:b.upstreamModel,enabled:b.enabled,priority:b.priority,capabilityProfile:b.capabilityProfile,requestAlias:b.requestAlias,iconUrl:b.iconUrl}))}));
  result.systemChannels=(settings.systemChannels || []).filter((c:any)=>c.enabled).map((c:any)=>{let baseUrl='';try{const url=new URL(c.baseUrl);baseUrl=`${url.origin}${url.pathname}`;}catch{}return {id:c.id,name:c.name,baseUrl,apiFormat:c.apiFormat,models:c.models,enabled:c.enabled,hasApiKey:Boolean(c.apiKey)};});
  return result;
}
const upstreamKeys=new Set(['systemChannels','logicalModels','defaultModels','modelPointCosts','generationPointMultipliers','generationConcurrency','generationDefaults','generationCostControl','allowUserApiConfig']);
const commerceKeys=new Set(['entitlements','entitlementPlanRenames','entitlementPlanRemovals','freeDailyPointsEnabled','freeDailyPoints','commercePolicy','checkIn']);
const systemKeys=new Set(['site','operationMode','registrationEnabled','emailRegistrationEnabled','registrationRateLimit','mail','dataLifecycle','wechatOfficial','watermarkPolicy','accountMenu']);
export function settingsPermission(key:string) {
  if(upstreamKeys.has(key))return 'upstream.manage';if(commerceKeys.has(key))return 'commerce.manage';if(systemKeys.has(key))return 'system.manage';
  throw httpError(400,`Unknown setting: ${key}`);
}
function validNumber(value:any,name:string,min=0,max=1000000000) {if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw httpError(400,`Invalid ${name}`);}
function validCapabilityList(value:unknown,name:string,max=32) {
  if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=='string'||!item.trim()||item.length>100))throw httpError(400,`Invalid ${name}`);
}
function validCapabilityOptions(value:unknown,name:string,max=32) {
  if(!Array.isArray(value)||value.length>max)throw httpError(400,`Invalid ${name}`);
  const values=new Set<string>();
  for(const item of value){
    const option=object(item);const parameter=option.value,label=option.label;
    if(typeof parameter!=='string'||!parameter.trim()||parameter.length>100||typeof label!=='string'||!label.trim()||label.length>100||values.has(parameter.trim()))throw httpError(400,`Invalid ${name}`);
    values.add(parameter.trim());
  }
  return values;
}
function validCapabilityRatioOptions(value:unknown,name:string,max=32) {
  if(!Array.isArray(value)||value.length>max)throw httpError(400,`Invalid ${name}`);
  const values=new Set<string>();
  for(const item of value){
    const option=object(item);const ratio=option.value,dimension=option.dimension;
    if(typeof ratio!=='string'||!ratio.trim()||ratio.length>100||values.has(ratio.trim())||typeof dimension!=='string'||!dimension.trim()||dimension.length>100||!/^(?:auto|\d+x\d+)$/i.test(dimension.trim()))throw httpError(400,`Invalid ${name}`);
    values.add(ratio.trim());
  }
  return values;
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
function updatesCatalog(patch:Settings) {
  return Object.hasOwn(patch,'systemChannels')||Object.hasOwn(patch,'logicalModels');
}
function settingsForStorage(stored:Settings,next:Settings,patch:Settings):Settings {
  // Reads fill defaults and derive the catalog. Persist submitted fields and their
  // documented dependencies so a signup/check-in edit cannot rewrite that catalog.
  const value={...stored};
  for(const key of Object.keys(patch)){
    if(!['entitlementPlanRenames','entitlementPlanRemovals','commercePolicy'].includes(key))value[key]=next[key];
  }
  if(updatesCatalog(patch))for(const key of ['logicalModels','defaultModels','modelPointCosts'])value[key]=next[key];
  if(Object.hasOwn(patch,'entitlements'))value.checkIn=next.checkIn;
  if(Object.hasOwn(patch,'commercePolicy')||hasSiteCommercePolicy(patch)){
    value.site=next.site;
    delete value.commercePolicy;
  }
  return value;
}
export function validateSettingsPatch(ctx:Context,current:Settings,patch:Settings):Settings {
  for(const key of Object.keys(patch))settingsPermission(key);
  if(patch.site&&Object.hasOwn(object(patch.site),'announcementBar'))throw httpError(400,'The backup announcement bar has been retired; use announcements');
  if(JSON.stringify(patch).length>512000)throw httpError(413,'Settings payload too large');
  const flatPolicy=Object.hasOwn(patch,'commercePolicy'),sitePolicy=hasSiteCommercePolicy(patch);
  if(flatPolicy&&sitePolicy)throw httpError(400,'Send commercePolicy in only one location');
  const {entitlementPlanRenames,entitlementPlanRemovals,...storedPatch}=patch;
  let next=merge(structuredClone(current),structuredClone(storedPatch));
  if(entitlementPlanRenames!==undefined){
    if(!Array.isArray(entitlementPlanRenames)||entitlementPlanRenames.length>200||!patch.entitlements)throw httpError(400,'请随权益方案一起提交标识修改');
    const sources=new Set<string>(),targets=new Set<string>();
    for(const entry of entitlementPlanRenames){
      const {from,to}=object(entry);
      if(typeof from!=='string'||typeof to!=='string'||!to.trim()||to!==to.trim()||to.length>120||from===to||sources.has(from)||targets.has(to))throw httpError(400,'方案标识不能为空或重复');
      if(!current.entitlements.plans.some((plan:any)=>plan.id===from))throw httpError(409,'原方案已变化，请刷新后重新修改');
      if(current.entitlements.plans.some((plan:any)=>plan.id===to)||!next.entitlements.plans.some((plan:any)=>plan.id===to)||next.entitlements.plans.some((plan:any)=>plan.id===from))throw httpError(409,'新方案标识已被使用，或修改前后方案不对应');
      sources.add(from);targets.add(to);
    }
    const renamed=(id:string)=>entitlementPlanRenames.find((item:any)=>item.from===id)?.to ?? id;
    next.entitlements.defaultPlanId=renamed(next.entitlements.defaultPlanId);
    if(next.checkIn?.planRewards)next.checkIn={...next.checkIn,planRewards:next.checkIn.planRewards.map((rule:any)=>({...rule,planId:renamed(rule.planId)}))};
  }
  if(patch.wechatOfficial!==undefined)next.wechatOfficial=validateWechatConfig(ctx,current.wechatOfficial,patch.wechatOfficial);
  if(flatPolicy||sitePolicy){
    const policy=flatPolicy?patch.commercePolicy:patch.site.commercePolicy;
    next.site={...object(next.site),commercePolicy:policy===null?null:merge(resolveCommercePolicy(current)||{},object(policy))};
    delete next.commercePolicy;
  }
  for(const key of ['registrationEnabled','emailRegistrationEnabled','freeDailyPointsEnabled','allowUserApiConfig'])if(Object.hasOwn(patch,key)&&typeof next[key]!=='boolean')throw httpError(400,`Invalid ${key}`);
  if(patch.watermarkPolicy!==undefined){
    const policy=object(next.watermarkPolicy);
    if(Object.keys(policy).some(key=>!['enabled','confirmationRequired'].includes(key))||typeof policy.enabled!=='boolean'||typeof policy.confirmationRequired!=='boolean')throw httpError(400,'AI 水印开关与确认设置必须为开启或关闭');
  }
  if(patch.accountMenu!==undefined){
    const menu=object(next.accountMenu);
    if(Object.keys(menu).some(key=>key!=='adultContentSettingsVisible')||typeof menu.adultContentSettingsVisible!=='boolean')throw httpError(400,'成人内容设置入口开关必须为开启或关闭');
  }
  if(patch.registrationRateLimit!==undefined){
    const rule=object(next.registrationRateLimit);
    if(Object.keys(rule).some(key=>!['enabled','maxAttempts','windowSeconds'].includes(key))||typeof rule.enabled!=='boolean')throw httpError(400,'注册频率限制开关无效');
    if(!Number.isInteger(rule.maxAttempts)||rule.maxAttempts<1||rule.maxAttempts>1000)throw httpError(400,'注册允许次数应为 1–1000 的整数');
    if(!Number.isInteger(rule.windowSeconds)||rule.windowSeconds<60||rule.windowSeconds>86400||rule.windowSeconds%60!==0)throw httpError(400,'注册限制时间应为 1–1440 分钟的整数');
  }
  if(Object.hasOwn(patch,'operationMode')&&!['self_use','commercial'].includes(next.operationMode))throw httpError(400,'Invalid operation mode');
  if(Object.hasOwn(patch,'freeDailyPoints')){validNumber(next.freeDailyPoints,'daily points');creditUnits(next.freeDailyPoints);}
  if(Object.hasOwn(patch,'modelPointCosts'))for(const [key,value] of Object.entries(object(next.modelPointCosts)))if(settingChanged(current.modelPointCosts,next.modelPointCosts,key)){validNumber(value,`model cost ${key}`);creditUnits(value as number);}
  if(Object.hasOwn(patch,'generationConcurrency'))for(const [key,value] of Object.entries(object(next.generationConcurrency)))if(settingChanged(current.generationConcurrency,next.generationConcurrency,key)){validNumber(value,key,1,100);if(!Number.isInteger(value))throw httpError(400,'Concurrency must be an integer');}
  if(Object.hasOwn(patch,'generationPointMultipliers'))for(const [key,category] of Object.entries(object(next.generationPointMultipliers)))for(const [field,value] of Object.entries(object(category)))if(settingChanged(current.generationPointMultipliers?.[key],category as Settings,field)){validNumber(value,'point multiplier',0,10000);creditUnits(value as number);}
  if(Object.hasOwn(patch,'generationCostControl'))for(const [key,value] of Object.entries(object(next.generationCostControl)))if(settingChanged(current.generationCostControl,next.generationCostControl,key)){validNumber(value,'cost control');creditUnits(value as number);}
  if(Object.hasOwn(patch,'site')){
    const site=object(next.site);
    for(const key of ['logoUrl','iconUrl','heroVideoUrl','heroVideoPosterUrl','termsUrl','privacyUrl'])if(settingChanged(current.site,site,key))validUrl(site[key],key,true);
    delete site.announcementBar;
    if(settingChanged(current.site,site,'footer'))site.footer=validateSiteFooter(site.footer);
    if(settingChanged(current.site,site,'wechatContact'))site.wechatContact=validateWechatContact(site.wechatContact);
    if(settingChanged(current.site,site,'friendLinks'))for(const entry of site.friendLinks || [])validUrl(entry.url,'friend link');
    if(settingChanged(current.site,site,'socials'))for(const entry of Object.values(site.socials || {}) as any[])validUrl(entry.url,'social link');
  }
  if(Object.hasOwn(patch,'mail')){
    const mail=object(patch.mail);
    if(current.mail.password&&String(next.mail.host||'').trim().toLowerCase()!==String(current.mail.host||'').trim().toLowerCase()&&!mail.password&&mail.clearPassword!==true)throw httpError(400,'Changing the SMTP host requires a new password or clearing the saved password');
    next.mail.password=preserveSecret(ctx,mail,current.mail,'password','clearPassword');delete next.mail.clearPassword;delete next.mail.hasPassword;
    if(settingChanged(current.mail,next.mail,'port')&&next.mail.port!==undefined)validNumber(next.mail.port,'SMTP port',1,65535);
  }
  const catalogChanged=updatesCatalog(patch),defaultsChanged=Object.hasOwn(patch,'defaultModels');
  if(catalogChanged)next=validateCatalogPatch(ctx,current,next,patch);
  else {
    if(defaultsChanged)next.defaultModels=normalizeModelCatalog(next).defaultModels;
    if(Object.hasOwn(patch,'modelPointCosts'))validateUpstreamPricing(next,current);
  }
  if(catalogChanged||defaultsChanged){
    for(const capability of ['text','image','video','audio']){
      const key=`${capability}Model`,id=next.defaultModels[key];
      const model=next.logicalModels.find((m:any)=>m.id===id),old=current.logicalModels.find((m:any)=>m.id===current.defaultModels[key]);
      const status=(value:any)=>value?{capability:value.capability,enabled:value.enabled}:undefined;
      if((settingChanged(current.defaultModels,next.defaultModels,key)||!sameSetting(status(old),status(model)))&&id&&(!model||model.capability!==capability||!model.enabled))throw httpError(400,'Default model must be an enabled model of matching capability');
    }
  }
  const entitlementsChanged=Object.hasOwn(patch,'entitlements'),checkInChanged=Object.hasOwn(patch,'checkIn');
  if(entitlementPlanRemovals!==undefined&&!entitlementsChanged)throw httpError(400,'请随权益方案一起提交删除记录');
  const planIds=new Set<string>();
  if(entitlementsChanged){
    if(typeof next.entitlements?.enabled!=='boolean'||!Array.isArray(next.entitlements.plans))throw httpError(400,'Invalid entitlement plans');
    if(settingChanged(current.entitlements,next.entitlements,'defaultStorageQuotaBytes')&&next.entitlements.defaultStorageQuotaBytes!==undefined&&!validStorageQuota(next.entitlements.defaultStorageQuotaBytes))throw httpError(400,'默认存储容量必须是有效的字节数');
    for(const plan of next.entitlements.plans){
      const old=current.entitlements.plans.find((item:any)=>item.id===plan.id),changed=(...keys:string[])=>settingChanged(old,plan,...keys);
      if(changed('allowedGenerationKinds'))validatePlanGenerationKinds(plan);
      if(changed('allowedModelIds'))validatePlanModels(plan);
      if(changed('generationConcurrency'))validatePlanConcurrency(plan);
      if(changed('storageQuotaBytes')&&plan.storageQuotaBytes!==undefined&&!validStorageQuota(plan.storageQuotaBytes))throw httpError(400,'会员存储容量必须是有效的字节数');
      string(plan.id,'plan ID');if(changed('name'))string(plan.name,'plan name');
      if(planIds.has(plan.id)||typeof plan.enabled!=='boolean')throw httpError(400,'Plan IDs must be unique and enabled must be boolean');planIds.add(plan.id);
      if(changed('dailyPoints')){validNumber(plan.dailyPoints,'plan daily points');creditUnits(plan.dailyPoints);}
      for(const [key,value]of Object.entries(object(plan.limits)))if(settingChanged(old?.limits,plan.limits,key)){validNumber(value,'plan limit');if(key==='dailyPointSpend')creditUnits(value as number);else if(!Number.isInteger(value))throw httpError(400,'Daily plan count limits must be integers');}
    }
    if(next.entitlements.enabled&&!next.entitlements.plans.some((plan:any)=>plan.id===next.entitlements.defaultPlanId&&plan.enabled))throw httpError(400,'An enabled default entitlement plan is required');
    const removed=removedEntitlementPlans(current,next,entitlementPlanRenames);
    if((removed.length||entitlementPlanRemovals!==undefined)&&(!Array.isArray(entitlementPlanRemovals)||entitlementPlanRemovals.length!==removed.length||new Set(entitlementPlanRemovals).size!==removed.length||removed.some(plan=>!entitlementPlanRemovals.includes(plan.id))))throw httpError(409,'权益方案已变化，请刷新后再删除');
    if(removed.some(plan=>plan.id===next.entitlements.defaultPlanId))throw httpError(409,'请先更换默认方案');
    if(removed.length&&Array.isArray(next.checkIn?.planRewards))next.checkIn={...next.checkIn,planRewards:next.checkIn.planRewards.filter((rule:any)=>!removed.some(plan=>plan.id===rule.planId))};
  }
  else if(checkInChanged&&Array.isArray(next.entitlements?.plans)){
    for(const plan of next.entitlements.plans)if(typeof plan?.id==='string')planIds.add(plan.id);
  }
  if(checkInChanged||entitlementsChanged)next.checkIn=validateCheckInSettings(next.checkIn,planIds);
  return next;
}
function validateCatalogPatch(ctx:Context,current:Settings,next:Settings,patch:Settings):Settings {
  if(Object.hasOwn(patch,'systemChannels')){
    if(!Array.isArray(patch.systemChannels)||patch.systemChannels.length>200)throw httpError(400,'Invalid system channels');
    const ids=new Set<string>();next.systemChannels=patch.systemChannels.map((raw:any)=>{
      const channel=object(raw);string(channel.id,'channel ID',100);
      const old=current.systemChannels.find((c:any)=>c.id===channel.id),changed=(...keys:string[])=>settingChanged(old,channel,...keys);
      if(changed('name'))string(channel.name,'channel name',200);
      if(changed('baseUrl'))validUrl(channel.baseUrl,'channel URL');
      if(ids.has(channel.id))throw httpError(400,'Duplicate channel ID');ids.add(channel.id);
      if(changed('models')&&(!Array.isArray(channel.models)||channel.models.length>2000||channel.models.some((m:any)=>typeof m!=='string'||m.length>200)))throw httpError(400,'Invalid channel models');
      if(changed('enabled')&&typeof channel.enabled!=='boolean')throw httpError(400,'Invalid channel enabled state');
      if(changed('storeGeneratedMedia')&&channel.storeGeneratedMedia!==undefined&&typeof channel.storeGeneratedMedia!=='boolean')throw httpError(400,'生成结果转存开关必须为开启或关闭');
      if(old&&changed('baseUrl')&&new URL(channel.baseUrl).origin!==new URL(old.baseUrl).origin){
        if(old.apiKey&&!channel.apiKey&&channel.clearApiKey!==true)throw httpError(400,'切换渠道域名需要填写新的 API Key，或勾选清空旧密钥。');
        if(old.webhookSecret&&!channel.webhookSecret&&channel.clearWebhookSecret!==true)throw httpError(400,'切换渠道域名需要填写新的 Webhook 密钥，或清空旧密钥。');
      }
      const advanced=channel.advancedConfig || {};
      if(changed('advancedConfig')&&/password|api.?key|secret|authorization/i.test(JSON.stringify(Object.keys(advanced))))throw httpError(400,'Credentials must use designated secret fields');
      return {id:channel.id,name:channel.name,baseUrl:channel.baseUrl,models:channel.models,enabled:channel.enabled,storeGeneratedMedia:channel.storeGeneratedMedia??old?.storeGeneratedMedia??true,apiFormat:channel.apiFormat||'openai',advancedConfig:advanced,
        apiKey:preserveSecret(ctx,channel,old,'apiKey','clearApiKey'),webhookSecret:preserveSecret(ctx,channel,old,'webhookSecret','clearWebhookSecret')};
    });
  }
  if(!Array.isArray(next.logicalModels)||next.logicalModels.length>2000)throw httpError(400,'Invalid logical models');
  // Channel-only saves inherit routing from the locked current settings. Remove
  // bindings to channels deleted in this write, without mutating the old snapshot.
  // Explicit routing writes still have to supply valid channel references.
  if(Array.isArray(patch.systemChannels)&&!Object.hasOwn(patch,'logicalModels')){
    const remainingIds=new Set(next.systemChannels.map((channel:any)=>channel.id));
    const removedIds=new Set(current.systemChannels.filter((channel:any)=>!remainingIds.has(channel.id)).map((channel:any)=>channel.id));
    if(removedIds.size)next.logicalModels=next.logicalModels.map((model:any)=>({...model,bindings:Array.isArray(model.bindings)?model.bindings.filter((binding:any)=>!removedIds.has(binding.channelId)):model.bindings}));
  }
  const modelNames=new Set<string>();
  for(const model of next.logicalModels){
    const oldModel=current.logicalModels.find((item:any)=>item.id===model.id);
    const changed=(...keys:string[])=>settingChanged(oldModel,model,...keys);
    string(model.id,'model ID',200);string(model.name,'model name',200);
    if(changed('allowAdultContent')&&model.allowAdultContent!==undefined&&typeof model.allowAdultContent!=='boolean')throw httpError(400,'允许成人内容必须为开启或关闭');
    if(changed('requiresSubscription')&&model.requiresSubscription!==undefined&&typeof model.requiresSubscription!=='boolean')throw httpError(400,'仅订阅套餐可用须为开启或关闭');
    if(changed('description')&&model.description!==undefined){if(typeof model.description!=='string'||model.description.length>240)throw httpError(400,'模型简介不能超过 240 字');model.description=model.description.trim();}
    if(changed('note')&&model.note!==undefined){if(typeof model.note!=='string'||model.note.length>2000)throw httpError(400,'模型备注须为不超过 2000 字的文本');model.note=model.note.trim();if(!model.note)delete model.note;}
    if(!['text','image','video','audio'].includes(model.capability)||typeof model.enabled!=='boolean'||!Array.isArray(model.bindings))throw httpError(400,'Invalid logical model');
    if(changed('asyncTaskTimeoutMinutes')&&model.asyncTaskTimeoutMinutes!==undefined)validNumber(model.asyncTaskTimeoutMinutes,'异步任务超时时间',1,1440);
    if(changed('statusQueryRetries')&&model.statusQueryRetries!==undefined)validNumber(model.statusQueryRetries,'状态查询重试次数',0,10);
    for(const name of [model.id,...(model.aliases||[])]){string(name,'model alias',200);if(modelNames.has(name))throw httpError(400,'Duplicate model name or alias');modelNames.add(name);}
    const bindingIds=new Set<string>();
    for(const binding of model.bindings){string(binding.id,'binding ID');string(binding.upstreamModel,'upstream model');if(bindingIds.has(binding.id))throw httpError(400,'Duplicate binding ID');bindingIds.add(binding.id);if(!next.systemChannels.some((c:any)=>c.id===binding.channelId))throw httpError(400,'模型绑定引用的渠道不存在，请刷新渠道配置后重试。');if(typeof binding.enabled!=='boolean')throw httpError(400,'Invalid binding enabled');validNumber(binding.priority,'binding priority',0,100000);
      if(binding.capabilityProfile!==undefined&&binding.capabilityProfile!==null){
        const profile=object(binding.capabilityProfile);
        const oldBinding=oldModel?.bindings?.find((item:any)=>item.id===binding.id);
        const channel=next.systemChannels.find((c:any)=>c.id===binding.channelId),oldChannel=current.systemChannels.find((c:any)=>c.id===oldBinding?.channelId);
        const protocol=channel?.advancedConfig?.protocol||channel?.apiFormat||'openai';
        const oldProtocol=oldChannel?.advancedConfig?.protocol||oldChannel?.apiFormat||'openai';
        const identityChanged=!oldBinding||oldModel.capability!==model.capability||oldBinding.channelId!==binding.channelId||oldBinding.upstreamModel!==binding.upstreamModel||protocol!==oldProtocol||channel?.baseUrl!==oldChannel?.baseUrl;
        const previous=identityChanged?undefined:(oldBinding.capabilityProfile||{});
        const profileChanged=(...keys:string[])=>settingChanged(previous,profile,...keys);
        try{
        if(model.capability==='video'){
          validateVideoPolicySettings(profile,previous);
          if(profileChanged('fastModeEnabled')&&profile.fastModeEnabled!==undefined&&typeof profile.fastModeEnabled!=='boolean')throw httpError(400,'快速通道开关必须为布尔值');
        }
        if(profileChanged('maxBatchSize')&&profile.maxBatchSize!==undefined&&(!Number.isInteger(profile.maxBatchSize)||profile.maxBatchSize<1||profile.maxBatchSize>20))throw httpError(400,'Invalid max batch size');
        if(profileChanged('aspectRatios')&&profile.aspectRatios!==undefined)validCapabilityList(profile.aspectRatios,'aspect ratios');
        if(profileChanged('aspectRatioOptions','aspectRatios')&&profile.aspectRatioOptions!==undefined){
          const options=validCapabilityRatioOptions(profile.aspectRatioOptions,'aspect ratio options');
          if(Array.isArray(profile.aspectRatios)&&profile.aspectRatios.some((value:any)=>!options.has(String(value).trim())))throw httpError(400,'Aspect ratio must use a configured parameter');
        }
        if(profileChanged('outputResolutions')&&profile.outputResolutions!==undefined)validCapabilityList(profile.outputResolutions,'output resolutions');
        if(profileChanged('imageQualities')&&profile.imageQualities!==undefined)validCapabilityList(profile.imageQualities,'image qualities');
        if(profileChanged('qualities')&&profile.qualities!==undefined)validCapabilityList(profile.qualities,'image qualities');
        if(profileChanged('imageQualityOptions','imageQualities','qualities','outputResolutions','resolutions')){
        if(profile.imageQualityOptions!==undefined){
          const options=validCapabilityOptions(profile.imageQualityOptions,'image quality options');
          const selected=profile.imageQualities ?? profile.qualities;
          if(Array.isArray(selected)&&selected.some((value:any)=>!options.has(String(value).trim())))throw httpError(400,'Image quality must use a configured parameter');
          const configuredResolutions=profile.outputResolutions ?? profile.resolutions;
          const resolutions=Array.isArray(configuredResolutions)&&configuredResolutions.length ? configuredResolutions : (model.capability==='image' ? ['1K'] : undefined);
          if(Array.isArray(resolutions)&&resolutions.includes('1K')&&!options.has('auto'))throw httpError(400,'1K 图片质量必须绑定 auto（自动）');
          if(Array.isArray(resolutions)&&resolutions.includes('1K')&&Array.isArray(selected)&&!selected.some((value:any)=>String(value).trim()==='auto'))throw httpError(400,'启用 1K 时必须勾选 auto（自动）图片质量');
        } else {
          const configuredResolutions=profile.outputResolutions ?? profile.resolutions;
          const resolutions=Array.isArray(configuredResolutions)&&configuredResolutions.length ? configuredResolutions : (model.capability==='image' ? ['1K'] : undefined);
          const selected=profile.imageQualities ?? profile.qualities;
          if(Array.isArray(resolutions)&&resolutions.includes('1K')&&Array.isArray(selected)&&!selected.some((value:any)=>String(value).trim()==='auto'))throw httpError(400,'启用 1K 时必须勾选 auto（自动）图片质量');
        }
        }
        if(profileChanged('sizeMap')&&profile.sizeMap!==undefined)validCapabilitySizeMap(profile.sizeMap,'capability size map');
        if(profileChanged('outputDimensions')&&profile.outputDimensions!==undefined)validCapabilitySizeMap(profile.outputDimensions,'capability output dimensions');
        }catch(error){
          if((error as any)?.statusCode===400)throw httpError(400,`「${model.name||model.id}」/「${channel.name||channel.id}」：${(error as Error).message}`);
          throw error;
        }
      }
    }
  }
  next=normalizeModelCatalog(next);
  validateUpstreamPricing(next,current);
  const requestOwners=new Map<string,string>();
  for(const model of next.logicalModels)for(const name of [model.id,...(model.aliases||[])])requestOwners.set(String(name).trim().toLowerCase(),model.id);
  const routeNames=new Set<string>();
  for(const model of next.logicalModels)for(const binding of model.bindings){
    if(binding.requestAlias===undefined||binding.requestAlias==='')continue;
    const alias=string(binding.requestAlias,'渠道入口请求名',200).trim(),key=alias.toLowerCase();
    if(!alias||(requestOwners.has(key)&&requestOwners.get(key)!==model.id)||routeNames.has(key))throw httpError(400,'渠道入口请求名与其他模型或渠道入口重名，请使用唯一名称');
    routeNames.add(key);binding.requestAlias=alias;
  }
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
  return {...{enabled:false,provider:'s3',endpoint:'',region:'us-east-1',bucket:'',prefix:'oaooao',forcePathStyle:true},...rows[0]?.value,updatedAt:iso(rows[0]?.updated_at)} as Settings;
}
function storagePublic(value:Settings) {const {accessKeyId,secretAccessKey,...rest}=value;return {...rest,hasAccessKeyId:Boolean(accessKeyId),hasSecretAccessKey:Boolean(secretAccessKey)};}

function removedEntitlementPlans(current:Settings,next:Settings,renames?: {from:string;to:string}[]): {id:string;name?:string}[] {
  const ids=new Set(next.entitlements.plans.map((plan: {id:string})=>plan.id));
  const renamed=new Set((renames??[]).map(item=>item.from));
  return current.entitlements.plans.filter((plan: {id:string})=>!ids.has(plan.id)&&!renamed.has(plan.id));
}

export async function registerSettings(app:FastifyInstance,ctx:Context) {
  app.get('/api/site/wechat-qr',async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const row=(await ctx.db.query("SELECT value->'site'->'wechatContact' AS contact FROM oaooao_settings WHERE id='global'")).rows[0];
    const png=uploadedWechatPng(row?.contact?.imageUrl);
    if(!png||(request.query as {v?:string}).v!==wechatQrVersion(png))throw httpError(404,'未找到微信二维码');
    if(row.contact.enabled!==true){
      try{await ctx.requireUser(request,'system.manage');}catch{throw httpError(404,'未找到微信二维码');}
    }
    return reply.type('image/png').header('X-Content-Type-Options','nosniff').send(png);
  });
  app.get('/api/account/settings-visibility',async(request,reply)=>{
    await ctx.requireUser(request);
    const value=(await ctx.db.query("SELECT value FROM oaooao_settings WHERE id=$1",['global'])).rows[0]?.value;
    reply.header('Cache-Control','private, no-store');
    return {visibility:{watermark:value?.watermarkPolicy?.enabled!==false,adultContent:value?.accountMenu?.adultContentSettingsVisible!==false}};
  });
  app.get('/api/admin/settings',async request=>{const user=await ctx.requireUser(request);if(!['system.manage','upstream.manage','commerce.manage','billing.manage'].some(p=>hasPermission(user,p)))throw httpError(403,'Permission denied');return {settings:sanitizedSettings(await getSettings(ctx),ctx.config.origin)};});
  app.patch('/api/admin/settings',async request=>{
    const user=await ctx.requireUser(request);const patch=object(request.body);
    for(const key of Object.keys(patch))if(!hasPermission(user,settingsPermission(key)))throw httpError(403,`Permission required: ${settingsPermission(key)}`);
    if(hasSiteCommercePolicy(patch)&&!hasPermission(user,'commerce.manage'))throw httpError(403,'Permission required: commerce.manage');
    const settings=await transaction(ctx.db,async client=>{
      // Block concurrent plan writes before taking the configuration lock. All
      // references change in one commit; a failed rename leaves every row intact.
      if(patch.entitlementPlanRenames?.length)await client.query('LOCK TABLE oaooao_users,oaooao_products,oaooao_orders,oaooao_plan_grants,oaooao_admin_plan_assignments IN EXCLUSIVE MODE');
      const {rows}=await client.query('SELECT value FROM oaooao_settings WHERE id=$1 FOR UPDATE',['global']);
      const stored=rows[0]?.value || {},current=settingsFromStorage(stored),next=validateSettingsPatch(ctx,current,patch);
      const removed=patch.entitlements ? removedEntitlementPlans(current,next,patch.entitlementPlanRenames) : [];
      for (const plan of removed) {
        const {products,assignments,grants,orders}=(await client.query(`SELECT
          (SELECT count(*)::int FROM oaooao_products WHERE plan_id=$1) products,
          (SELECT count(*)::int FROM oaooao_admin_plan_assignments WHERE plan_id=$1) assignments,
          (SELECT count(*)::int FROM oaooao_plan_grants WHERE plan_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()) grants,
          (SELECT count(*)::int FROM oaooao_orders WHERE plan_id=$1 AND (status='refunding' OR (status='pending' AND expires_at>clock_timestamp()))) orders`,[plan.id])).rows[0];
        const reasons=[products&&`${products} 个关联商品`,(assignments+grants)&&`${assignments+grants} 条待生效或有效的会员权益`,orders&&`${orders} 笔未完成订单`].filter(Boolean);
        if(reasons.length)throw httpError(409,`「${plan.name||plan.id}」仍有${reasons.join('、')}，请先解除关联`);
      }
      for(const {from,to} of patch.entitlementPlanRenames ?? []){
        for(const table of ['oaooao_users','oaooao_products','oaooao_orders','oaooao_plan_grants','oaooao_admin_plan_assignments']){
          if((await client.query(`SELECT 1 FROM ${table} WHERE plan_id=$1 LIMIT 1`,[to])).rowCount)throw httpError(409,'新方案标识已有关联记录，请使用其他标识');
          await client.query(`UPDATE ${table} SET plan_id=$2${['oaooao_users','oaooao_products','oaooao_orders'].includes(table)?',updated_at=now()':''} WHERE plan_id=$1`,[from,to]);
        }
      }
      if(patch.wechatOfficial&&wechatConfig(current.wechatOfficial).appId!==wechatConfig(next.wechatOfficial).appId&&(await client.query('SELECT 1 FROM oaooao_wechat_identities LIMIT 1')).rowCount)throw httpError(409,'已有微信绑定，不能直接更换AppID；请先完成受控身份迁移');
      await client.query('UPDATE oaooao_settings SET value=$2::jsonb,updated_at=now() WHERE id=$1',['global',JSON.stringify(settingsForStorage(stored,next,patch))]);await ctx.audit({actorId:user.id,action:'settings.update',targetType:'settings',targetId:'global',metadata:{fields:Object.keys(patch),...(patch.entitlementPlanRenames?{entitlementPlanRenames:patch.entitlementPlanRenames}:{}),...(removed.length?{entitlementPlanRemovals:removed.map(plan=>plan.id)}:{})}},client);return next;});
    return {settings:sanitizedSettings(settings,ctx.config.origin)};
  });
  app.post('/api/admin/mail/test',async request=>{const user=await ctx.requireUser(request,'system.manage');const body=object(request.body);const saved=await getSettings(ctx);const mail=body.mail?validateSettingsPatch(ctx,saved,{mail:object(body.mail)}).mail:saved.mail;await sendMail(ctx,mail,string(body.to,'recipient',320),'OAOOAO mail delivery test','This is a requested OAOOAO mail configuration test.');await ctx.audit({actorId:user.id,action:'mail.test',targetType:'mail'});return {ok:true};});
  app.get('/api/admin/object-storage',async request=>{await ctx.requireUser(request,'system.manage');return {code:0,data:storagePublic(await getObjectStorageSettings(ctx))};});
  app.patch('/api/admin/object-storage',async request=>{
    const user=await ctx.requireUser(request,'system.manage'),body=object(request.body);
    validUrl(body.endpoint,'storage endpoint');if(typeof body.enabled!=='boolean'||typeof body.forcePathStyle!=='boolean')throw httpError(400,'Invalid storage settings');
    if(body.provider!==undefined&&!['s3','r2'].includes(body.provider))throw httpError(400,'存储类型无效');
    if(body.provider==='r2'&&body.endpoint&&!/^https:\/\/[a-f0-9]{32}(?:\.[a-z]+)?\.r2\.cloudflarestorage\.com\/?$/.test(body.endpoint))throw httpError(400,'请填写 Cloudflare R2 的 S3 API 服务地址');
    if(body.enabled&&(!body.endpoint||!body.bucket))throw httpError(400,'Storage endpoint and bucket required');
    if(typeof body.prefix!=='string'||body.prefix.includes('..')||body.prefix.includes('\\'))throw httpError(400,'Invalid storage prefix');
    const value=await transaction(ctx.db,async client=>{
      const {rows}=await client.query('SELECT value FROM oaooao_settings WHERE id=$1 FOR UPDATE',['object-storage']);const old=rows[0]?.value||{};
      if((old.endpoint!==body.endpoint||old.bucket!==body.bucket||body.clearAccessKeyId||body.clearSecretAccessKey)&&(await client.query("SELECT 1 FROM oaooao_media WHERE storage_backend='s3' LIMIT 1")).rowCount)throw httpError(409,'现有素材仍使用此存储桶，请先迁移或清理素材后再更换连接；可直接轮换同一桶的密钥');
      if((old.endpoint?new URL(old.endpoint).origin:'')!==(body.endpoint?new URL(body.endpoint).origin:'')){
        if(old.accessKeyId&&!body.accessKeyId&&body.clearAccessKeyId!==true)throw httpError(400,'Changing the storage origin requires a new access key ID or clearing the saved key');
        if(old.secretAccessKey&&!body.secretAccessKey&&body.clearSecretAccessKey!==true)throw httpError(400,'Changing the storage origin requires a new secret access key or clearing the saved key');
      }
      const next={enabled:body.enabled,provider:body.provider||old.provider||'s3',endpoint:body.endpoint,region:string(body.region,'region',100),bucket:string(body.bucket,'bucket',200,true),prefix:body.prefix,forcePathStyle:body.forcePathStyle,accessKeyId:preserveSecret(ctx,body,old,'accessKeyId','clearAccessKeyId'),secretAccessKey:preserveSecret(ctx,body,old,'secretAccessKey','clearSecretAccessKey')};if(next.enabled&&(!next.accessKeyId||!next.secretAccessKey))throw httpError(400,'启用对象存储前请配置访问密钥');await client.query('UPDATE oaooao_settings SET value=$2::jsonb,updated_at=now() WHERE id=$1',['object-storage',JSON.stringify(next)]);await ctx.audit({actorId:user.id,action:'storage.update',targetType:'settings',targetId:'object-storage'},client);return next;
    });return {code:0,data:storagePublic(value)};
  });
  app.post('/api/admin/object-storage',async request=>{
    const user=await ctx.requireUser(request,'system.manage'),stored=await getObjectStorageSettings(ctx);
    if(stored.provider!=='vercel-blob'&&(!stored.endpoint||!stored.bucket||!stored.accessKeyId||!stored.secretAccessKey))throw httpError(503,'Object storage is not fully configured');
    const result=await verifyStorage(ctx,stored as any);
    await ctx.audit({actorId:user.id,action:'storage.test',targetType:'settings',targetId:'object-storage'});return {code:0,data:result};
  });
  app.post('/api/admin/models',async request=>{
    await ctx.requireUser(request,'upstream.manage');const body=object(request.body),settings=await getSettings(ctx);const saved=settings.systemChannels.find((c:any)=>c.id===body.channelId);
    const baseUrl=string(body.baseUrl||saved?.baseUrl,'base URL',2000);validUrl(baseUrl,'base URL');
    const key=body.apiKey?string(body.apiKey,'API key',16384):ctx.decrypt(saved?.apiKey||'');
    const format=effectiveChannelProtocol(body.protocol ?? saved?.advancedConfig?.protocol,body.apiFormat ?? saved?.apiFormat);
    if(!body.apiKey&&saved?.apiKey&&new URL(baseUrl).origin!==new URL(saved.baseUrl).origin)throw httpError(400,'A saved API key cannot be used with a different provider origin');
    if(!['openai','openai-compatible','openai-chat','openai-images','openai-audio','openai-video','ciyuan-async'].includes(format))throw httpError(501,'Model catalog discovery is unavailable for this protocol');
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
    items.push({id:'creative-storage',title:'生成素材存储',level:'warning',detail:storage.enabled?'新素材使用已配置的对象存储；请在对象存储设置中完成读写删除检测，并核对实际上传。':'新素材使用服务器持久化目录，可在对象存储设置中接入 Cloudflare R2。'});
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

