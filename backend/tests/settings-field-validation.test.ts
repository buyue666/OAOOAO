import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {buildApp} from '../src/app.js';
import {createContext,hashToken,type AppConfig} from '../src/core.js';
import {DEFAULT_SETTINGS,sanitizedSettings,validateSettingsPatch} from '../src/settings.js';
import {normalizeModelCatalog} from '../src/model-catalog.js';
import {validateUpstreamPricing} from '../src/upstream-pricing.js';
import {validateVideoInput} from '../src/video-policy.js';
import {sameSetting} from '../src/settings-diff.js';
import {createTestDatabase} from './core-helpers.js';

const ctx=createContext({} as Pool,{encryptionKey:randomBytes(32).toString('base64')} as AppConfig);
function fixture(){
 const settings=structuredClone(DEFAULT_SETTINGS);
 settings.systemChannels=[{id:'flow',name:'Synthetic flow',baseUrl:'https://flow.example.invalid',enabled:true,models:['fixture-video'],apiFormat:'openai',advancedConfig:{protocol:'openai-video',authMode:'none'}},{id:'other',name:'Synthetic image',baseUrl:'https://image.example.invalid/v1',enabled:true,models:['image','text'],apiFormat:'openai',advancedConfig:{authMode:'none'}}];
 settings.logicalModels=[{id:'video',name:'Synthetic video',capability:'video',enabled:true,bindings:[{id:'flow:fixture-video',channelId:'flow',upstreamModel:'fixture-video',priority:1,enabled:true,capabilityProfile:{videoReferenceRules:{image:{maxCount:3}},videoPricing:{resolutionPricing:{'720p':{generationRate:2}}}}}]},{id:'image',name:'Synthetic image',capability:'image',enabled:true,bindings:[{id:'image-route',channelId:'other',upstreamModel:'image',priority:1,enabled:true,capabilityProfile:{outputResolutions:['1K'],imageQualities:['high'],maxBatchSize:1}}]},{id:'text',name:'Synthetic text',capability:'text',enabled:true,bindings:[{id:'text-route',channelId:'other',upstreamModel:'text',priority:1,enabled:true}]}];
 settings.modelPointCosts={video:2,image:1,text:1};settings.defaultModels.videoModel='video';
 return normalizeModelCatalog(settings);
}

test('unchanged catalogs and model metadata save independently of old video and image constraints',async t=>{
 const current=fixture(),before=structuredClone(current);
 for(const [label,modelIndex,edit]of [
  ['subscription',0,{requiresSubscription:true}],['other model subscription',2,{requiresSubscription:true}],
  ['description',0,{description:'Updated description'}],['note',0,{note:' New note '}],['adult flag',0,{allowAdultContent:true}],
  ['timeout',0,{asyncTaskTimeoutMinutes:3,statusQueryRetries:2}],['disabled',0,{enabled:false}],['image batch',1,{}],
 ] as const)await t.test(label,()=>{
  const models=structuredClone(current.logicalModels);Object.assign(models[modelIndex],edit);
  if(label==='image batch')models[1].bindings[0].capabilityProfile.maxBatchSize=2;
  const next=validateSettingsPatch(ctx,current,{logicalModels:models,defaultModels:label==='disabled'?{...current.defaultModels,videoModel:''}:current.defaultModels,modelPointCosts:current.modelPointCosts});
  for(const [key,value]of Object.entries(edit))assert.equal(next.logicalModels[modelIndex][key],typeof value==='string'?value.trim():value);
  assert.equal(next.logicalModels[0].bindings[0].capabilityProfile.videoReferenceRules.image.maxCount,3);
 });
 assert.doesNotThrow(()=>validateSettingsPatch(ctx,current,{logicalModels:current.logicalModels}));
 assert.deepEqual(current,before,'validation never mutates the locked baseline');
});

test('changed profile fields validate their dependencies without requiring unrelated old limits to be fixed',()=>{
 const current=fixture(),models=structuredClone(current.logicalModels),profile=models[0].bindings[0].capabilityProfile;
 profile.videoPricing.resolutionPricing['720p'].generationRate=3;
 profile.fastModeEnabled=true;profile.videoReferenceRules.image.freeCount=1;
 assert.doesNotThrow(()=>validateSettingsPatch(ctx,current,{logicalModels:models}));
 for(const [key,value,pattern]of [['maxCount',-1,/参考数量/],['maxFileBytes',300_000_000,/参考文件大小/]] as const){
  const bad=structuredClone(models);bad[0].bindings[0].capabilityProfile.videoReferenceRules.image[key]=value;
  assert.throws(()=>validateSettingsPatch(ctx,current,{logicalModels:bad}),pattern);
 }
 const image=structuredClone(models);image[1].bindings[0].capabilityProfile.imageQualities=['standard'];
 assert.throws(()=>validateSettingsPatch(ctx,current,{logicalModels:image}),/auto/);
 profile.videoReferenceRules.image.maxCount=2;
 assert.equal(validateSettingsPatch(ctx,current,{logicalModels:models}).logicalModels[0].bindings[0].capabilityProfile.videoReferenceRules.image.maxCount,2);
});

test('new routes validate configured limits and aliases without private provider presets',()=>{
 const current=fixture(),models=structuredClone(current.logicalModels);
 models[0].bindings.push({...models[0].bindings[0],id:'new-invalid-route',capabilityProfile:{videoReferenceRules:{image:{maxCount:-1}}}});
 assert.throws(()=>validateSettingsPatch(ctx,current,{logicalModels:models}),/参考数量/);
 assert.throws(()=>validateVideoInput({config:{videoSeconds:8,vquality:'720p'},references:Array.from({length:4},()=>({type:'image'}))},current.logicalModels[0].bindings[0].capabilityProfile),/参考图片最多 3/);
 const alias=structuredClone(current.logicalModels);alias[1].aliases=['text'];
 assert.throws(()=>validateSettingsPatch(ctx,current,{logicalModels:alias}),/Duplicate model/);
});

test('channel names, availability, keys and storage toggles do not revalidate unedited model limits',()=>{
 const current=fixture(),channels=sanitizedSettings(current).systemChannels;
 channels[0]={...channels[0],name:'Renamed',storeGeneratedMedia:false,apiKey:'synthetic-rotation'};
 const next=validateSettingsPatch(ctx,current,{systemChannels:channels});
 assert.equal(next.systemChannels[0].storeGeneratedMedia,false);assert.equal(ctx.decrypt(next.systemChannels[0].apiKey),'synthetic-rotation');
 channels[0].enabled=false;assert.doesNotThrow(()=>validateSettingsPatch(ctx,current,{systemChannels:channels}));
});

test('old pricing conflicts are isolated but changed conflicting prices or regrouped endpoints still fail',()=>{
 const current=fixture(),channel={...current.systemChannels[1],id:'peer'};current.systemChannels.push(channel);
 const model=current.logicalModels[2];model.bindings[0].requestAlias='first';model.bindings.push({...model.bindings[0],id:'peer-text',channelId:'peer',requestAlias:'second'});
 current.modelPointCosts={...current.modelPointCosts,first:1,second:2};
 assert.throws(()=>validateUpstreamPricing(current),/同上游渠道价格不一致/);
 const models=structuredClone(current.logicalModels);models[2].requiresSubscription=true;
 assert.doesNotThrow(()=>validateSettingsPatch(ctx,current,{logicalModels:models}));
 assert.doesNotThrow(()=>validateSettingsPatch(ctx,current,{modelPointCosts:{image:3}}));
 assert.throws(()=>validateSettingsPatch(ctx,current,{modelPointCosts:{first:4}}),/同上游渠道价格不一致/);
 current.systemChannels[2].baseUrl='https://separate.example.invalid/v1';
 const channels=sanitizedSettings(current).systemChannels;channels[2].baseUrl=current.systemChannels[1].baseUrl;
 assert.throws(()=>validateSettingsPatch(ctx,current,{systemChannels:channels}),/同上游渠道价格不一致/);
});

test('other admin sections validate edited fields and retain dependency checks',()=>{
 const current=fixture();current.site={title:'Old',heroVideoUrl:'legacy invalid link',friendLinks:[{url:'legacy invalid link'}]};
 current.entitlements={enabled:true,defaultPlanId:'plan',plans:[{id:'plan',name:'Plan',enabled:true,dailyPoints:10,limits:{image:1},generationConcurrency:{image:0}}]};
 current.generationConcurrency={image:0,video:1};
 assert.equal(validateSettingsPatch(ctx,current,{site:{title:'New'}}).site.title,'New');
 assert.throws(()=>validateSettingsPatch(ctx,current,{site:{heroVideoUrl:'new invalid link'}}),/Invalid heroVideoUrl/);
 const entitlements=structuredClone(current.entitlements);entitlements.plans[0].dailyPoints=20;
 assert.equal(validateSettingsPatch(ctx,current,{entitlements}).entitlements.plans[0].dailyPoints,20);
 entitlements.plans[0].generationConcurrency.image=-1;
 assert.throws(()=>validateSettingsPatch(ctx,current,{entitlements}),/套餐生成并发/);
 assert.equal(validateSettingsPatch(ctx,current,{generationConcurrency:{video:2}}).generationConcurrency.video,2);
 assert.throws(()=>validateSettingsPatch(ctx,current,{generationConcurrency:{image:-1}}),/Invalid image/);
 assert.ok(sameSetting({a:1,b:undefined},{a:1}));assert.ok(sameSetting({a:1,b:2},{b:2,a:1}));
 current.defaultModels.textModel='removed-legacy-model';
 const models=structuredClone(current.logicalModels);models[2].requiresSubscription=true;
 assert.doesNotThrow(()=>validateSettingsPatch(ctx,current,{logicalModels:models}));
 assert.throws(()=>validateSettingsPatch(ctx,current,{defaultModels:{textModel:'new-missing-model'}}),/Default model/);
});

test('admin API persists subscription and other scoped edits, reads them back and atomically rejects new invalid limits',async t=>{
 const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config,coreOnly:true});
 t.after(async()=>{await app.close();await f.cleanup();});
 const id=randomUUID(),token=randomBytes(32).toString('base64url');
 await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)",[id,JSON.stringify(['upstream.manage'])]);
 await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
 const headers={origin:f.config.origin,cookie:`${f.config.sessionCookieName}=${token}`};
 const seed=fixture();await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[seed]);
 const read=async()=>(await app.inject({url:'/api/admin/settings',headers})).json().settings;
 const models=(await read()).logicalModels;models[0].requiresSubscription=true;
 const payload={logicalModels:models,defaultModels:seed.defaultModels,modelPointCosts:seed.modelPointCosts};
 const res=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload});assert.equal(res.statusCode,200,res.body);
 const saved=await read();assert.equal(saved.logicalModels[0].requiresSubscription,true);assert.deepEqual(saved.modelPointCosts,seed.modelPointCosts);
 assert.equal(saved.logicalModels[0].bindings[0].capabilityProfile.videoReferenceRules.image.maxCount,3);
 const snapshot=(await f.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
 models[0].bindings[0].capabilityProfile.videoReferenceRules.image.maxCount=-1;
 const bad=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{logicalModels:models}});assert.equal(bad.statusCode,400,bad.body);assert.match(bad.body,/Synthetic video/);
 assert.deepEqual((await f.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value,snapshot);
 assert.equal((await f.db.query("SELECT count(*)::int AS total FROM oaooao_audit_logs WHERE action='settings.update'")).rows[0].total,1);
 assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers:{origin:f.config.origin},payload})).statusCode,401);
});
