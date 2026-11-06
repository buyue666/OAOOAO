import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {buildApp} from '../src/app.js';
import {ADMIN_PERMISSIONS,hashToken} from '../src/core.js';
import {createJob} from '../src/creative.js';
import {resolveProvider,invokeProvider} from '../src/providers.js';
import {publicMediaUrl,readExternalResult} from '../src/generated-media.js';
import {saveMedia,ownedMedia} from '../src/media.js';
import {storageUsage} from '../src/storage-quota.js';
import {adjustWallet} from '../src/wallet.js';
import {registerWatermark,WATERMARK_POLICY_VERSION} from '../src/watermark.js';
import {createTestDatabase} from './core-helpers.js';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64');
const cdn='https://8.8.8.8/synthetic/image.png?signature=synthetic';
async function fixture(t:any){
  const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config});await app.ready();
  t.after(async()=>{await app.close();await f.cleanup();});
  const users:Array<{id:string;headers:Record<string,string>}>=[];
  for(let n=0;n<2;n++){
    const id=randomUUID(),token=randomBytes(32).toString('base64url');
    await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'unused-synthetic','admin',$2)",[id,JSON.stringify(ADMIN_PERMISSIONS)]);
    await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    await adjustWallet(app.ctx,id,`synthetic:${id}`,100);
    users.push({id,headers:{origin:f.config.origin,cookie:`${f.config.sessionCookieName}=${token}`}});
  }
  const channel={id:'synthetic',name:'Synthetic',enabled:true,baseUrl:'https://provider.example/v1',apiFormat:'openai',apiKey:app.ctx.encrypt('synthetic-unused'),models:['image','video'],storeGeneratedMedia:false};
  const models=['image','video'].map(kind=>({id:kind,name:kind,capability:kind,enabled:true,bindings:[{id:kind,channelId:channel.id,upstreamModel:kind,enabled:true,priority:1}]}));
  await f.db.query("UPDATE oaooao_settings SET value=value||$1 WHERE id='global'",[{systemChannels:[channel],logicalModels:models,defaultModels:{imageModel:'image',videoModel:'video'},modelPointCosts:{image:1,video:1}}]);
  const change=(value:boolean)=>f.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{systemChannels,0,storeGeneratedMedia}',$1) WHERE id='global'",[JSON.stringify(value)]);
  const job=async(kind:'image'|'video',config:any={})=>{const selected=await resolveProvider(app.ctx,kind,{prompt:'Synthetic',config},undefined,users[0].id);return {id:randomUUID(),kind,user_id:users[0].id,channel_id:channel.id,upstream_model:kind,input:{prompt:'Synthetic',config},provider_config:selected.config};};
  return {...f,app,ctx:app.ctx,users,channel,job,change};
}

test('channel storage setting saves, preserves omitted legacy fields, validates booleans and stays administrator-only',async t=>{
  const f=await fixture(t),headers=f.users[0].headers;
  const save=(channel:any)=>f.app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{systemChannels:[channel]}});
  const updated=await save({...f.channel,apiKey:'',storeGeneratedMedia:true});assert.equal(updated.statusCode,200,updated.body);
  assert.equal((await f.app.inject({url:'/api/admin/settings',headers})).json().settings.systemChannels[0].storeGeneratedMedia,true);
  await save({...f.channel,apiKey:'',storeGeneratedMedia:undefined});assert.equal((await f.app.inject({url:'/api/admin/settings',headers})).json().settings.systemChannels[0].storeGeneratedMedia,true);
  assert.equal((await save({...f.channel,storeGeneratedMedia:'false'})).statusCode,400);
  const session=await f.app.inject({url:'/api/auth/session',headers});assert.ok(!session.body.includes('storeGeneratedMedia'));
});

test('URL results honor each submitted channel snapshot without downloading or consuming quota',async t=>{
  const f=await fixture(t),direct=await f.job('image',{n:1});await f.change(true);
  const calls:string[]=[];
  const result=await invokeProvider(f.ctx,direct,false,async url=>{calls.push(String(url));return Response.json({data:[{url:cdn,b64_json:image.toString('base64')},{url:'https://8.8.8.8/extra.png'}]});});
  assert.equal(result.type,'complete');if(result.type!=='complete')return;
  assert.deepEqual(result.result.results,[{url:cdn}]);assert.equal(calls.length,1);assert.equal((await storageUsage(f.ctx,f.users[0].id)).usedBytes,0);
  const copied=await f.job('image');await f.change(false);let downloads=0;
  const stored=await invokeProvider(f.ctx,copied,false,async url=>{if(String(url).endsWith('/images/generations'))return Response.json({data:[{url:cdn}]});downloads++;return new Response(image);});
  assert.equal(downloads,1);assert.equal(stored.type,'complete');if(stored.type==='complete')assert.match(stored.result.remoteUrl,/^\/api\/reference-assets\//);
  assert.equal((await storageUsage(f.ctx,f.users[0].id)).usedBytes,image.length);
  delete copied.provider_config.storeGeneratedMedia;
  await invokeProvider(f.ctx,copied,false,async()=>Response.json({data:[{b64_json:image.toString('base64')}]}));
  assert.equal((await storageUsage(f.ctx,f.users[0].id)).usedBytes,image.length*2,'Legacy queued jobs continue saving their output');
});

test('direct channels still work at full quota or with incomplete R2; binary-only results enforce exact-byte capacity',async t=>{
  const f=await fixture(t),owner=f.users[0];await saveMedia(f.ctx,owner.id,image);
  await f.db.query('UPDATE oaooao_users SET storage_quota_bytes=$2 WHERE id=$1',[owner.id,image.length]);
  const direct=await f.job('image');
  await f.db.query("UPDATE oaooao_settings SET value=value||'{\"enabled\":true}'::jsonb WHERE id='object-storage'");
  await f.job('image');
  const output=await invokeProvider(f.ctx,direct,false,async()=>Response.json({data:[{url:cdn}]}));assert.equal(output.type,'complete');
  await assert.rejects(invokeProvider(f.ctx,direct,false,async()=>Response.json({data:[{b64_json:image.toString('base64')}]})),{statusCode:503});
  await f.db.query("UPDATE oaooao_settings SET value=value||'{\"enabled\":false}'::jsonb WHERE id='object-storage'");
  await assert.rejects(invokeProvider(f.ctx,direct,false,async()=>Response.json({data:[{b64_json:image.toString('base64')}]})),{statusCode:413});
  await f.change(true);await assert.rejects(f.job('image'),{statusCode:413});
  assert.equal((await storageUsage(f.ctx,owner.id)).usedBytes,image.length);
});

test('completed videos use their CDN URL; unsafe direct image links are rejected',async t=>{
  const f=await fixture(t),video=await f.job('video'),url='https://8.8.8.8/synthetic/video.mp4';let calls=0;
  const result=await invokeProvider(f.ctx,video,false,async()=>{calls++;return Response.json({id:'synthetic',status:'completed',video_url:url});});
  assert.equal(calls,1);assert.equal(result.type,'complete');if(result.type==='complete')assert.equal(result.result.url,url);
  for(const url of ['javascript:alert(1)','http://8.8.8.8/a.png','https://127.0.0.1/a.png','https://192.168.1.1/a.png','https://user:pass@8.8.8.8/a.png','file:///private'])await assert.rejects(publicMediaUrl(url));
  assert.equal((await storageUsage(f.ctx,f.users[0].id)).files,0);
});

test('verified CDN results support collection, deletion and authenticated labelled-export policy without persistent copies',async t=>{
  const f=await fixture(t),[a,b]=f.users,other='https://8.8.8.8/synthetic/keep.png';
  const job=await createJob(f.ctx,a.id,'image',{prompt:'Synthetic',config:{model:'image'}},'synthetic-cdn');
  await f.db.query("UPDATE oaooao_generation_jobs SET status='success',result=$2 WHERE id=$1",[job.id,{results:[{url:cdn},{url:other}],remoteUrl:cdn}]);
  const payload={kind:'image',title:'Synthetic CDN',coverUrl:cdn,data:{url:cdn}};
  const saved=await f.app.inject({method:'POST',url:'/api/library-assets',headers:a.headers,payload});assert.equal(saved.statusCode,200,saved.body);
  assert.equal((await f.app.inject({method:'POST',url:'/api/library-assets',headers:b.headers,payload})).statusCode,404);
  let fetched=0;const transport=async()=>{fetched++;return new Response(image);};
  await assert.rejects(readExternalResult(f.ctx,b.id,cdn,transport),{statusCode:404});assert.equal(fetched,0);
  const exporting=Fastify();await exporting.register(cookie);await registerWatermark(exporting,f.ctx,transport);await exporting.ready();t.after(()=>exporting.close());
  const request={method:'POST' as const,url:'/api/account/media/export',headers:a.headers,payload:{url:cdn}};
  assert.equal((await exporting.inject({...request,headers:b.headers})).statusCode,404);assert.equal(fetched,0);
  const labelled=await exporting.inject(request);assert.equal(labelled.statusCode,422,'A tiny image cannot silently bypass mandatory labelling');
  await f.app.inject({method:'PATCH',url:'/api/account/watermark-preference',headers:a.headers,payload:{enabled:false,acknowledgedPolicyVersion:WATERMARK_POLICY_VERSION}});
  const raw=await exporting.inject(request);assert.equal(raw.statusCode,200,raw.body);assert.deepEqual(raw.rawPayload,image);assert.equal(raw.headers['x-oao-watermark-applied'],'false');
  const drop=(urls:string[])=>f.app.inject({method:'POST',url:'/api/account/assets/batch-delete',headers:a.headers,payload:{externalUrls:urls}});
  assert.equal((await drop([cdn,'https://8.8.8.8/foreign.png'])).statusCode,404);
  assert.equal((await f.db.query('SELECT result FROM oaooao_generation_jobs WHERE id=$1',[job.id])).rows[0].result.results.length,2,'Whole batches roll back on a foreign selection');
  const removed=await drop([cdn]);assert.equal(removed.statusCode,200,removed.body);assert.equal(removed.json().freedBytes,0);
  const remaining=(await f.db.query('SELECT result FROM oaooao_generation_jobs WHERE id=$1',[job.id])).rows[0].result;
  assert.deepEqual(remaining.results,[{url:other}]);assert.equal(remaining.remoteUrl,other);
  assert.equal((await storageUsage(f.ctx,a.id)).files,0);
});
