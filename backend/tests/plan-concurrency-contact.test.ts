import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { verifyPassword } from '../src/auth.js';
import { ADMIN_PERMISSIONS, hashToken } from '../src/core.js';
import { createJob } from '../src/creative.js';
import { assignAdminPlan } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

function makeActor(fixture:Awaited<ReturnType<typeof createTestDatabase>>){
  return async (permissions:readonly string[]=[])=>{
    const id=randomUUID(),token=randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused',$2,$3)",[id,permissions.length?'admin':'user',JSON.stringify(permissions)]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    return {id,headers:{origin:fixture.config.origin,cookie:`${fixture.config.sessionCookieName}=${token}`}};
  };
}

test('plan concurrency is enforced independently of global defaults, by task type and for the Agent',async t=>{
  const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config});
  t.after(async()=>{await app.close();await f.cleanup();});
  const actor=makeActor(f),admin=await actor(ADMIN_PERMISSIONS),basic=await actor(),paid=await actor(),basicAgent=await actor();
  const save=(payload:object)=>app.inject({method:'PATCH',url:'/api/admin/settings',headers:admin.headers,payload});
  const plan=(id:string,generationConcurrency:object)=>({id,name:id,enabled:true,dailyPoints:0,limits:{},generationConcurrency});
  const entitlements={enabled:true,defaultPlanId:'free',plans:[plan('free',{text:1}),plan('pro',{text:3,agent:2})]};
  const models=['text','image'].map(kind=>({id:`fixture-${kind}`,name:kind,enabled:true,capability:kind,bindings:[{id:kind,channelId:'fixture',upstreamModel:kind,enabled:true,priority:1}]}));
  const setup=await save({entitlements,systemChannels:[{id:'fixture',name:'Fixture',baseUrl:'https://provider.example.invalid/v1',apiFormat:'openai',enabled:true,apiKey:'synthetic-only',models:models.map(m=>m.id)}],logicalModels:models,defaultModels:{textModel:'fixture-text',imageModel:'fixture-image'},modelPointCosts:{'fixture-text':0,'fixture-image':0},generationConcurrency:{agent:1,text:2,image:2}});
  assert.equal(setup.statusCode,200,setup.body);
  assert.deepEqual(setup.json().settings.entitlements.plans[1].generationConcurrency,{agent:2,text:3});
  for(const value of [{image:0},{image:1.5},{video:101},{text:'2'},{unknown:2},[],null]){
    const result=await save({entitlements:{...entitlements,plans:[{...entitlements.plans[0],generationConcurrency:value},entitlements.plans[1]]}});
    assert.equal(result.statusCode,400,result.body);
  }
  await assignAdminPlan(app.ctx,paid.id,'concurrency-assignment','pro');
  const input=(kind:string)=>({prompt:'Synthetic fixture',config:{model:`fixture-${kind}`},context:{},source:'test'});
  const text=await createJob(app.ctx,basic.id,'text',input('text'),'basic-first');
  assert.equal((await createJob(app.ctx,basic.id,'text',input('text'),'basic-first')).id,text.id);
  await assert.rejects(createJob(app.ctx,basic.id,'text',input('text'),'basic-second'),{statusCode:429,message:/最多 1 项/});
  const run=(user:typeof basic,key:string)=>app.inject({method:'POST',url:'/api/agent/runs',headers:user.headers,payload:{clientRequestId:key,prompt:'Synthetic plan',surface:'chat',modelIds:['fixture-text']}});
  const accepted=await run(basicAgent,'basic-agent-one');assert.equal(accepted.statusCode,202,accepted.body);
  const limited=await run(basicAgent,'basic-agent-two');assert.equal(limited.statusCode,429,limited.body);assert.match(limited.json().error,/创作助手.*最多 1 项/);
  const pro1=await run(paid,'pro-agent-one'),pro2=await run(paid,'pro-agent-two');
  assert.deepEqual([pro1.statusCode,pro2.statusCode],[202,202],pro1.body+pro2.body);
  const pro3=await run(paid,'pro-agent-three');assert.equal(pro3.statusCode,429,pro3.body);assert.match(pro3.json().error,/创作助手.*最多 2 项/);
  await createJob(app.ctx,paid.id,'text',input('text'),'pro-third-text');
  await assert.rejects(createJob(app.ctx,paid.id,'text',input('text'),'pro-fourth-text'),{statusCode:429,message:/最多 3 项/});
  const first=await createJob(app.ctx,paid.id,'image',input('image'),'pro-first-image');
  await createJob(app.ctx,paid.id,'image',input('image'),'pro-second-image');
  await assert.rejects(createJob(app.ctx,paid.id,'image',input('image'),'pro-third-image'),{statusCode:429,message:/最多 2 项/});
  await f.db.query("UPDATE oaooao_generation_jobs SET status='success' WHERE id=$1",[first.id]);
  await createJob(app.ctx,paid.id,'image',input('image'),'pro-next-image');
});

test('admin-managed WeChat upload exposes only the current enabled PNG, with no inline data in public settings',async t=>{
  const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config,coreOnly:true});
  t.after(async()=>{await app.close();await f.cleanup();});
  const actor=makeActor(f),admin=await actor(['system.manage']),member=await actor();
  const encoded='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ukAAAAASUVORK5CYII=';
  const imageUrl=`data:image/png;base64,${encoded}`;
  const save=(value:object,headers=admin.headers)=>app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{site:{wechatContact:value}}});
  const read=async()=>(await app.inject({url:'/api/auth/session'})).json().settings.site.wechatContact;
  assert.equal((await read()).enabled,false);
  assert.equal((await save({enabled:true,imageUrl},member.headers)).statusCode,403);
  assert.equal((await save({enabled:true,imageUrl:'data:image/svg+xml;base64,abc'})).statusCode,400);
  assert.equal((await save({enabled:true})).statusCode,400);
  const uploaded=await save({enabled:true,imageUrl,caption:'扫码联系'});assert.equal(uploaded.statusCode,200,uploaded.body);
  const settings=uploaded.json().settings.site.wechatContact;
  assert.match(settings.imageUrl,/^\/api\/site\/wechat-qr\?v=[a-f0-9]{24}$/);assert.equal(settings.uploaded,true);
  assert.deepEqual(await read(),{enabled:true,imageUrl:settings.imageUrl,caption:'扫码联系'});
  const file=await app.inject({url:settings.imageUrl});assert.equal(file.statusCode,200,file.body);assert.equal(file.headers['content-type'],'image/png');assert.equal(file.rawPayload.toString('base64'),encoded);
  assert.equal((await save({enabled:false})).statusCode,200);assert.equal((await read()).imageUrl,'');
  assert.equal((await app.inject({url:settings.imageUrl})).statusCode,404);
  assert.equal((await app.inject({url:settings.imageUrl,headers:admin.headers})).statusCode,200);
  assert.equal((await save({enabled:true,caption:'新说明'})).statusCode,200);
  assert.equal((await read()).imageUrl,settings.imageUrl);
  assert.equal((await save({enabled:false,imageUrl:''})).statusCode,200);
  assert.equal((await app.inject({url:settings.imageUrl,headers:admin.headers})).statusCode,404);
});

test('Lunapi Argon2id login accepts its bounded encoded hash and rejects incorrect or excessive parameters',async()=>{
  const valid='$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$N0Iiu8TbmiiTlMf76UVkveMhf+XSbzwT4IT6v4TBqs0';
  assert.equal(await verifyPassword('Lunapi synthetic transfer only!',valid),true);
  assert.equal(await verifyPassword('Incorrect test password',valid),false);
  assert.equal(await verifyPassword('Lunapi synthetic transfer only!',valid.replace('m=19456','m=1048576')),false);
  assert.equal(await verifyPassword('a'.repeat(513),valid),false);
});
