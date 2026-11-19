import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {createTestDatabase} from './core-helpers.js';
import {createJob} from '../src/creative.js';
import {validateVideoPolicySettings,videoBaseCost,videoReferenceCost} from '../src/video-policy.js';

test('Doubao per-resolution reference rates replace normal rates and ignore separate video input charges',()=>{
  const profile={videoPricingTemplate:'doubao-video',videoBillingUnit:'second',videoPricing:{resolutionPricing:{'720p':{generationRate:1,referenceVideoGenerationRate:3,referencePrices:{extraVideo:99,referenceVideoPerSecond:99}},'1080p':{generationRate:2,referenceVideoGenerationRate:4}}}};
  validateVideoPolicySettings(profile);
  assert.equal(videoBaseCost(undefined,profile,'720p',15),150000n);
  assert.equal(videoBaseCost(undefined,profile,'720p',15,{hasReferenceVideo:true,billableSeconds:25}),750000n);
  assert.equal(videoBaseCost(undefined,profile,'1080p',15,{hasReferenceVideo:true,billableSeconds:25}),1000000n);
  assert.equal(videoReferenceCost([{type:'video',duration:10}],profile,{quality:'720p',seconds:15}),0n);
  for(const videoBillingUnit of ['request','duration',undefined])assert.throws(()=>validateVideoPolicySettings({...profile,videoBillingUnit}),/豆包视频模板仅支持按秒/);
  const missing={...profile,videoPricing:{resolutionPricing:{'720p':{generationRate:1,referencePrices:{referenceVideoPerSecond:99}}}}};
  assert.throws(()=>videoBaseCost(undefined,missing,'720p',10,{hasReferenceVideo:true,billableSeconds:15}),/参考视频生成/);
});

test('saved Doubao settings quote verified combined duration and reserve the identical cost without upstream calls',async t=>{
  const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config});t.after(async()=>{await app.close();await f.cleanup();});
  const token=randomBytes(32).toString('base64url'),id='doubao-fixture-admin';
  await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)",[id,JSON.stringify(['upstream.manage'])]);
  await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
  const headers={cookie:`oaooao_session=${token}`,origin:f.config.origin};
  const profile={videoBillingUnit:'second',videoPricingTemplate:'doubao-video',supportsVideoReference:true,videoReferenceFieldMap:{video:'video_reference'},maxReferenceVideos:3,maxReferences:3,durationSeconds:[10,15,20],aspectRatios:['16:9','9:16'],videoQualities:['720p','1080p'],videoReferenceRules:{video:{freeCount:3,maxItemSeconds:20}},videoPricing:{resolutionPricing:{'720p':{generationRate:1,referenceVideoGenerationRate:3,referencePrices:{extraVideo:99,referenceVideoPerSecond:99},additionalPrices:{longVideoMultiplier:99}},'1080p':{generationRate:2,referenceVideoGenerationRate:4}}}};
  const model={id:'doubao-fixture-video',name:'Synthetic video',capability:'video',enabled:true,bindings:[{id:'doubao-route',channelId:'doubao-fixture-channel',upstreamModel:'fixture-video',enabled:true,priority:1,capabilityProfile:profile}]};
  const save=(logicalModels:any[])=>app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{logicalModels}});
  const saved=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{systemChannels:[{id:'doubao-fixture-channel',name:'Synthetic provider',baseUrl:'https://video.example.invalid/v1',apiFormat:'openai-video',enabled:true,apiKey:'synthetic-key',storeGeneratedMedia:false,models:['fixture-video']}],logicalModels:[model]}});
  assert.equal(saved.statusCode,200,saved.body);
  const videos=[];
  for(const seconds of [5,2.2]){
    const path=join(f.config.mediaRoot,`synthetic-${seconds}.mp4`);
    await promisify(execFile)(process.env.FFMPEG_PATH||'ffmpeg',['-nostdin','-y','-f','lavfi','-i',`color=c=black:s=16x16:r=10:d=${seconds}`,'-c:v','libx264','-pix_fmt','yuv420p','-threads','1',path],{windowsHide:true,timeout:30000});
    videos.push({type:'video',dataUrl:`data:video/mp4;base64,${(await readFile(path)).toString('base64')}`,duration:999});
  }
  const input=(references:any[],seconds=10,quality='720p',ratio='16:9')=>({prompt:'Synthetic quote',config:{model:model.id,vquality:quality,videoSeconds:seconds,size:ratio},references});
  const quote=async(references:any[],seconds=10,quality='720p',ratio='16:9')=>{const r=await app.inject({method:'POST',url:'/api/video-generation-tasks/quote',headers,payload:input(references,seconds,quality,ratio)});assert.equal(r.statusCode,200,r.body);return r.json().points;};
  assert.equal(await quote([]),10);
  assert.equal(await quote([],20),20);
  assert.equal(await quote([videos[0]]),45);
  assert.equal(await quote([videos[0]],20),75,'long output uses the configured rate exactly once');
  assert.equal(await quote(videos),54,'5 + ceil(2.2) + 10 seconds billed even when video freeCount is three');
  assert.equal(await quote(videos,10,'1080p','9:16'),72);
  assert.equal((await f.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count,'0');
  assert.equal((await f.db.query('SELECT count(*) FROM oaooao_wallet_operations')).rows[0].count,'0');
  await f.db.query('INSERT INTO oaooao_wallets(user_id,permanent_balance) VALUES($1,1000)',[id]);
  const job=await createJob(app.ctx,id,'video',input(videos),'doubao-fixture-request');assert.equal(Number(job.cost),54);assert.equal(job.provider_config.videoBilling.billableSeconds,18);
  assert.equal(Number((await f.db.query('SELECT permanent_balance FROM oaooao_wallets WHERE user_id=$1',[id])).rows[0].permanent_balance),946);
  const cleared={...model,bindings:[{...model.bindings[0],capabilityProfile:{...profile,videoPricing:{resolutionPricing:{'720p':{generationRate:1,referenceVideoGenerationRate:null}}}}}]};
  assert.equal((await save([cleared])).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/video-generation-tasks/quote',headers,payload:input([videos[0]])})).statusCode,503);
});
