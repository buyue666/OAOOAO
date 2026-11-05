import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeModelCatalog} from '../src/model-catalog.js';
import {videoBaseCost,videoReferenceCost,videoDurations,validateVideoInput,validateVideoPolicySettings,validateReferenceDurations} from '../src/video-policy.js';
import {DEFAULT_SETTINGS,publicSettings,validateSettingsPatch} from '../src/settings.js';
import {resolveProvider} from '../src/providers.js';

const profile={videoBillingUnit:'second',videoQualities:['720p','1080p'],durationSeconds:[4,6,8,10],supportsReferenceImage:true,supportsFirstFrame:true,supportsLastFrame:true,maxReferenceImages:9};
const fixture=()=>({...structuredClone(DEFAULT_SETTINGS),systemChannels:[{id:'provider',name:'Synthetic',enabled:true,apiKey:'synthetic-encrypted',baseUrl:'https://provider.example.invalid/v1',apiFormat:'openai-video',models:['video-upstream']}],logicalModels:[{id:'video',name:'Video',capability:'video',enabled:true,bindings:[{id:'route',channelId:'provider',upstreamModel:'video-upstream',enabled:true,priority:1,capabilityProfile:{...profile}}]}]});
const context=(settings:any)=>({config:{},db:{query:async(sql:string)=>({rows:sql.includes("id='object-storage'")?[]:[{value:settings}]})}} as any);

test('unavailable models are disabled and hidden without mutating settings or deleting definitions',()=>{
  const input=fixture(),before=structuredClone(input);
  const orphaned=normalizeModelCatalog({...input,systemChannels:[]});
  assert.equal(orphaned.logicalModels.length,1);
  assert.equal(orphaned.logicalModels[0].enabled,false);
  assert.deepEqual(publicSettings(orphaned).logicalModels,[]);
  const restored=normalizeModelCatalog({...orphaned,systemChannels:input.systemChannels});
  assert.equal(restored.logicalModels[0].enabled,true);
  assert.deepEqual(input,before);
  assert.equal(normalizeModelCatalog({...input,logicalModels:[{...input.logicalModels[0],enabled:false}]}).logicalModels[0].enabled,false);
});

test('eight references with five free and one point per extra reference cost three points',()=>{
  const rules={...profile,videoReferenceRules:{image:{maxCount:8,freeCount:5}},videoPricing:{extraImage:1}};
  const refs=Array.from({length:8},()=>({type:'image',duration:0}));
  validateVideoInput({config:{videoSeconds:6,vquality:'720p'},references:refs},rules);
  assert.equal(videoReferenceCost(refs,rules),30000n);
  assert.throws(()=>validateVideoInput({config:{videoSeconds:6,vquality:'720p'},references:[...refs,refs[0]]},rules),/最多 8/);
  assert.throws(()=>validateVideoInput({config:{videoSeconds:6,vquality:'720p'},references:Array(10).fill(refs[0])},{...rules,videoReferenceRules:{image:{maxCount:0}}}),/最多 9/);
  const unlimited={videoReferenceRules:{image:{maxCount:0,freeCount:0}},videoPricing:{extraImage:0}};
  validateVideoInput({references:Array(12).fill(refs[0])},unlimited);
  assert.equal(videoReferenceCost(refs,unlimited),0n);
  assert.throws(()=>videoReferenceCost(refs,{videoReferenceRules:{image:{freeCount:0}}}),/配置/);
});

test('mixed reference total is shared and configured limits cannot exceed the native ceiling',()=>{
  const refs=[...Array(9).fill({type:'image'}),...Array(3).fill({type:'video'}),...Array(3).fill({type:'audio'})];
  const rules={supportsReferenceImage:true,supportsVideoReference:true,supportsAudioReference:true,maxReferenceImages:9,maxReferenceVideos:3,maxReferenceAudios:3,maxReferences:15};
  assert.doesNotThrow(()=>validateVideoInput({references:refs},rules));
  assert.throws(()=>validateVideoInput({references:refs},{...rules,videoReferenceTotalLimit:14}),/合计最多 14/);
  assert.throws(()=>validateVideoInput({references:[...refs,{type:'audio'}]},{...rules,videoReferenceTotalLimit:100}),/合计最多 15/);
  assert.doesNotThrow(()=>validateVideoInput({references:refs},{...rules,videoReferenceTotalLimit:0}));
  for(const value of [-1,1.5,1001,'15'])assert.throws(()=>validateVideoPolicySettings({videoReferenceTotalLimit:value}));
});

test('video and audio references apply free allowances and actual duration limits',()=>{
  const metadata=[{type:'video',duration:5},{type:'video',duration:8},{type:'audio',duration:2}];
  const rules={videoReferenceRules:{video:{freeCount:1,maxItemSeconds:10,maxTotalSeconds:14},audio:{freeCount:0}},videoPricing:{extraVideo:2,referenceVideoPerSecond:0.5,extraAudio:1,referenceAudioPerSecond:0.25}};
  assert.equal(videoReferenceCost(metadata,rules),75000n);
  validateReferenceDurations(metadata,rules);
  assert.throws(()=>validateReferenceDurations(metadata,{videoReferenceRules:{video:{maxItemSeconds:6}}}),/单个/);
  assert.throws(()=>validateReferenceDurations(metadata,{videoReferenceRules:{video:{maxTotalSeconds:10}}}),/总时长/);
  assert.equal(videoReferenceCost([{type:'audio',duration:1.001}],{videoPricing:{referenceAudioPerSecond:0.0001}}),2n,'fractional seconds round upward at wallet precision');
});

test('billing supports seconds, requests and exact resolution-duration prices',()=>{
  assert.equal(videoBaseCost(10000n,{videoBillingUnit:'second',videoPricing:{resolutionRates:{'720p':2}}},'720p',6),120000n);
  assert.equal(videoBaseCost(10000n,{videoBillingUnit:'request',videoPricing:{resolutionRates:{'720p':2}}},'720p',6),20000n);
  const exact={videoBillingUnit:'duration',videoPricing:{durationRates:{'720p':{'6':7}}}};
  assert.equal(videoBaseCost(10000n,exact,'720p',6),70000n);
  assert.throws(()=>videoBaseCost(10000n,exact,'720p',8),/配置/);
});

test('resolution rules intersect duration and mode restrictions',()=>{
  const rules={...profile,durationsByMode:{ends:[4,6],references:[8]},videoDurationRules:{'720p':{mode:'range',min:4,max:8,step:2},'1080p':{mode:'list',values:[6,10]}},maxDurationByResolution:{'1080p':8}};
  assert.deepEqual(videoDurations(rules,'720p'),[4,6,8]);
  assert.deepEqual(videoDurations(rules,'720p','ends'),[4,6]);
  assert.deepEqual(videoDurations(rules,'720p','references'),[8]);
  assert.deepEqual(videoDurations(rules,'1080p'),[6]);
  assert.throws(()=>validateVideoInput({config:{videoSeconds:8,vquality:'1080p'}},rules),/时长/);
});

test('frame switches, frame types and pairing are enforced on direct requests',()=>{
  const first={type:'image',role:'first_frame'},last={type:'image',role:'last_frame'},config={videoSeconds:4,vquality:'720p'};
  validateVideoInput({config,references:[first,last]},profile);
  assert.throws(()=>validateVideoInput({config,references:[first]},{...profile,supportsFirstFrame:false}),/首帧/);
  assert.throws(()=>validateVideoInput({config,references:[first,last]},{...profile,supportsLastFrame:false}),/尾帧/);
  assert.throws(()=>validateVideoInput({config,references:[last]},profile),/同时提供首帧/);
  assert.throws(()=>validateVideoInput({config,references:[first,first]},profile),/各限一张/);
  assert.throws(()=>validateVideoInput({config,references:[{...first,type:'video'}]},profile),/各限一张/);
});

test('settings reject invalid prices, ranges, mappings and inconsistent frame switches',()=>{
  for(const rules of [{videoBillingUnit:'wrong'},{supportsFirstFrame:false,supportsLastFrame:true},{videoPricing:{extraImage:-1}},{videoReferenceRules:{video:{freeCount:1.5}}},{videoDurationRules:{'720p':{mode:'range',min:8,max:4}}}])assert.throws(()=>validateVideoPolicySettings(rules));
  assert.doesNotThrow(()=>validateVideoPolicySettings({videoReferenceRules:{image:{maxCount:0,freeCount:0}},videoPricing:{extraImage:0}}));
  assert.doesNotThrow(()=>validateVideoPolicySettings({videoReferenceFieldMap:{last_frame:'end_image'}}));
  assert.throws(()=>validateVideoPolicySettings({videoReferenceFieldMap:{last_frame:'model'}}));
});

test('request aliases pin a binding and charge its own configured rate',async()=>{
  const settings={...fixture(),modelPointCosts:{video:1,'video-priority':2}};
  Object.assign(settings.logicalModels[0].bindings[0],{requestAlias:'video-priority'});
  settings.logicalModels[0].bindings.unshift(Object.assign({...settings.logicalModels[0].bindings[0],id:'default-route',upstreamModel:'video-default',priority:0},{requestAlias:'video-default'}));
  const result=await resolveProvider(context(settings),'video',{config:{model:'video-priority',videoSeconds:6,vquality:'720p'},references:[]});
  assert.equal(result.upstreamModel,'video-upstream');
  assert.equal(result.cost,'12.0000');
});

test('resolution-only and matrix-only pricing do not require an unused fallback price',async()=>{
  const settings=fixture();
  Object.assign(settings.logicalModels[0].bindings[0].capabilityProfile,{videoPricing:{resolutionRates:{'720p':2}}});
  assert.equal((await resolveProvider(context(settings),'video',{config:{model:'video',videoSeconds:6,vquality:'720p'}})).cost,'12.0000');
  Object.assign(settings.logicalModels[0].bindings[0].capabilityProfile,{videoBillingUnit:'duration',videoPricing:{durationRates:{'720p':{'6':7}}}});
  assert.equal((await resolveProvider(context(settings),'video',{config:{model:'video',videoSeconds:6,vquality:'720p'}})).cost,'7.0000');
});

test('route request names cannot collide with another model or route',()=>{
  const current=fixture(),first={...current.logicalModels[0],bindings:[{...current.logicalModels[0].bindings[0],requestAlias:'second'}]},second={...current.logicalModels[0],id:'second',bindings:[]};
  assert.throws(()=>validateSettingsPatch({} as any,current,{logicalModels:[first,second]}),/重名/);
  first.bindings[0].requestAlias='video';
  assert.doesNotThrow(()=>validateSettingsPatch({} as any,current,{logicalModels:[first,second]}));
});
