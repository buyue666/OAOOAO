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

test('saved conditional output prices quote verified video presence without charging input duration or creating jobs',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});
  t.after(async()=>{await app.close();await fixture.cleanup();});
  const token=randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES('output-admin','output-admin','synthetic-unused','admin',$1)",[JSON.stringify(['upstream.manage'])]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,'output-admin',now()+interval '1 hour')",[hashToken(token)]);
  const headers={cookie:`oaooao_session=${token}`,origin:fixture.config.origin};
  const profile={videoBillingUnit:'second',videoPricingTemplate:'reference-video-output',supportsVideoReference:true,videoReferenceFieldMap:{video:'video_reference'},maxReferenceVideos:3,maxReferences:3,durationSeconds:[10],videoQualities:['480p'],videoReferenceRules:{video:{freeCount:3,maxItemSeconds:15}},videoPricing:{resolutionPricing:{'480p':{generationRate:2,referenceVideoGenerationRate:3,referencePrices:{extraVideo:99,referenceVideoPerSecond:99}}}}};
  const model={id:'output-video',name:'Synthetic video',capability:'video',enabled:true,bindings:[{id:'output-route',channelId:'output-provider',upstreamModel:'video-upstream',enabled:true,priority:1,capabilityProfile:profile}]};
  const saved=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{systemChannels:[{id:'output-provider',name:'合成渠道',baseUrl:'https://video.example.invalid/v1',apiFormat:'openai-video',enabled:true,apiKey:'synthetic-key',models:['video-upstream']}],logicalModels:[model]}});
  assert.equal(saved.statusCode,200,saved.body);
  const quote=(references:any[])=>app.inject({method:'POST',url:'/api/video-generation-tasks/quote',headers,payload:{prompt:'Synthetic quote',config:{model:'output-video',vquality:'480p',videoSeconds:10,size:'16:9'},references}});
  assert.equal((await quote([])).json().points,20);
  const videos=[];
  for(const seconds of [1,5]){
    const path=join(fixture.config.mediaRoot,`synthetic-${seconds}.mp4`);
    await promisify(execFile)(process.env.FFMPEG_PATH||'ffmpeg',['-nostdin','-y','-f','lavfi','-i',`color=c=black:s=16x16:r=1:d=${seconds}`,'-c:v','libx264','-pix_fmt','yuv420p','-threads','1',path],{windowsHide:true,timeout:30000});
    videos.push({type:'video',dataUrl:`data:video/mp4;base64,${(await readFile(path)).toString('base64')}`});
  }
  for(const references of [[videos[0]],[videos[1]],videos]){const result=await quote(references);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().points,30);}
  const cleared={...model,bindings:[{...model.bindings[0],capabilityProfile:{...profile,videoPricing:{resolutionPricing:{'480p':{generationRate:2,referenceVideoGenerationRate:null}}}}}]};
  assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{logicalModels:[cleared]}})).statusCode,200);
  assert.equal((await quote([videos[0]])).statusCode,503);
  assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count,'0');
  assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_wallet_operations')).rows[0].count,'0');
});
