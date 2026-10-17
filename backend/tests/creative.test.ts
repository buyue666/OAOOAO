import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken, transaction, type Context } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';
import { createJob } from '../src/creative.js';
import { adjustWallet, getWallet } from '../src/wallet.js';
import { cancelJob, processNextJob } from '../src/worker.js';
import { ProviderFailure, invokeProvider } from '../src/providers.js';
import { decodeDataUrl, mediaPath, saveMedia } from '../src/media.js';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64');
const input={prompt:'Synthetic creative fixture',config:{model:'synthetic-text'},context:{},source:'chat'};
async function fixture(){
  const database=await createTestDatabase();const app=await buildApp({db:database.db,config:database.config});await app.ready();const ctx=app.ctx;
  const users=[];
  for(let i=0;i<3;i++){const id=randomUUID(),token=randomBytes(32).toString('base64url');await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$2,$3,$4,$5)',[id,`fixture-${i}-${id}`,'unused-synthetic-hash',i===2?'admin':'user',JSON.stringify(i===2?['generation.read','generation.manage','analytics.read']:[])]);await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);await adjustWallet(ctx,id,`fixture:${id}`,100);users.push({id,headers:{cookie:`oaooao_session=${token}`,origin:database.config.origin}});}
  const channels=[{id:'synthetic',name:'Synthetic adapter test',baseUrl:'https://provider.example/v1',apiFormat:'openai',apiKey:ctx.encrypt('synthetic-not-a-real-key'),enabled:true,models:['fixture-model']}];
  const models=['text','image','video','audio'].map(kind=>({id:`synthetic-${kind}`,name:kind,capability:kind,enabled:true,bindings:[{id:`binding-${kind}`,channelId:'synthetic',upstreamModel:'fixture-model',enabled:true,priority:1}]}));
  await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{systemChannels:channels,logicalModels:models,defaultModels:Object.fromEntries(models.map(m=>[m.capability+'Model',m.id])),modelPointCosts:Object.fromEntries(models.map(m=>[m.id,10])),generationDefaults:{videoSeconds:4},generationConcurrency:{agent:10,text:10,image:10,video:10,audio:10,render:10}}]);
  return{app,ctx,users,cleanup:async()=>{await app.close();await database.cleanup();}};
}
test('generation submissions debit once across simultaneous HTTP retries and reject identity mutation',async()=>{
  const f=await fixture();try{
    const [owner]=f.users;const requestId=randomUUID();
    const responses=await Promise.all(Array.from({length:12},()=>f.app.inject({method:'POST',url:'/api/text-tasks',headers:{...owner.headers,'x-vozeb-pro-client-request-id':requestId},payload:{config:{model:'synthetic-text'},messages:[{role:'user',content:'fixture'}]}})));
    for(const response of responses)assert.equal(response.statusCode,202,response.body);
    assert.equal(new Set(responses.map(r=>r.json().task.id)).size,1);assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,90);
    const row=(await f.ctx.db.query('SELECT * FROM oaooao_generation_jobs WHERE user_id=$1',[owner.id])).rows[0];
    await assert.rejects(createJob(f.ctx,owner.id,'text',{...row.input,prompt:'changed'},requestId),{statusCode:409});
    await f.ctx.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{systemChannels}','[]') WHERE id='global'");
    const retry=await createJob(f.ctx,owner.id,'text',row.input,requestId);assert.equal(retry.id,row.id);
    assert.equal(Number((await f.ctx.db.query("SELECT count(*) FROM oaooao_wallet_operations WHERE metadata->>'kind'='generation'")).rows[0].count),1);
  }finally{await f.cleanup();}
});
test('queued cancellation and confirmed worker failure refund once; worker success never refunds cancellation intent',async()=>{
  const f=await fixture();try{
    const owner=f.users[0];const queued=await createJob(f.ctx,owner.id,'text',input,'cancel-once');
    await Promise.all(Array.from({length:8},()=>transaction(f.ctx.db,c=>cancelJob(f.ctx,c,queued.id,owner.id))));assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,100);
    const failed=await createJob(f.ctx,owner.id,'text',input,'fails');await processNextJob(f.ctx,async()=>{throw new ProviderFailure('Synthetic confirmed rejection',true);});assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,100);
    assert.equal((await f.ctx.db.query('SELECT status FROM oaooao_generation_jobs WHERE id=$1',[failed.id])).rows[0].status,'error');
    const running=await createJob(f.ctx,owner.id,'text',input,'completes');let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);let calls=0;
    const work=processNextJob(f.ctx,async()=>{calls++;entered();await wait;return{type:'complete',result:{content:'synthetic generated text'}};});await started;
    assert.equal(await processNextJob(f.ctx,async()=>{throw Error('Duplicate worker executed');}),false);
    const cancelling=await transaction(f.ctx.db,c=>cancelJob(f.ctx,c,running.id,owner.id));assert.equal(cancelling.status,'running');assert.equal(cancelling.cancel_requested,true);assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,90);
    release();await work;assert.equal(calls,1);assert.equal((await f.ctx.db.query('SELECT status FROM oaooao_generation_jobs WHERE id=$1',[running.id])).rows[0].status,'success');assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,90);
  }finally{await f.cleanup();}
});
test('ambiguous provider results and expired submit leases retain debit until audited confirmation',async()=>{
  const f=await fixture();try{
    const owner=f.users[0],admin=f.users[2];const job=await createJob(f.ctx,owner.id,'text',input,'ambiguous');let calls=0;
    await processNextJob(f.ctx,async()=>{calls++;throw new ProviderFailure('Network outcome unknown');});assert.equal(await processNextJob(f.ctx,async()=>{calls++;throw Error('Must not retry POST');}),false);assert.equal(calls,1);assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,90);
    const review=await f.app.inject({method:'POST',url:`/api/admin/generation-operations/text/${job.id}/review`,headers:admin.headers,payload:{action:'confirm_failed',reason:'Synthetic provider ledger confirms no output'}});assert.equal(review.statusCode,200,review.body);assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,100);
    const again=await f.app.inject({method:'POST',url:`/api/admin/generation-operations/text/${job.id}/review`,headers:admin.headers,payload:{action:'confirm_failed',reason:'duplicate'}});assert.equal(again.statusCode,409);
    const crashed=await createJob(f.ctx,owner.id,'text',input,'crash');await f.ctx.db.query("UPDATE oaooao_generation_jobs SET status='running',phase='submitting',lease_owner='dead-worker',lease_until=now()-interval '1 second' WHERE id=$1",[crashed.id]);
    await processNextJob(f.ctx,async()=>{throw Error('Must not replay crashed submission');});const row=(await f.ctx.db.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1',[crashed.id])).rows[0];assert.equal(row.needs_review,true);assert.equal(row.phase,'review');assert.equal((await getWallet(f.ctx,owner.id)).pointsBalance,90);
    assert.equal(Number((await f.ctx.db.query("SELECT count(*) FROM oaooao_audit_logs WHERE action='generation.review.confirm_failed'")).rows[0].count),1);
  }finally{await f.cleanup();}
});
test('project handoff retries, concurrent saves and library media enforce owner boundaries',async()=>{
  const f=await fixture();try{
    const[a,b]=f.users;const create=()=>f.app.inject({method:'POST',url:'/api/canvas/projects',headers:a.headers,payload:{title:'Synthetic board',sourceHandoffId:'handoff-fixture',project:{nodes:[],connections:[]}}});
    const created=await Promise.all([create(),create()]);assert.equal(created[0].json().data.project.id,created[1].json().data.project.id);const p=created[0].json().data.project;
    const saves=await Promise.all(['one','two'].map(title=>f.app.inject({method:'PATCH',url:`/api/canvas/projects/${p.id}`,headers:a.headers,payload:{expectedUpdatedAt:p.updatedAt,project:{...p,title}}})));assert.deepEqual(saves.map(s=>s.statusCode).sort(),[200,409]);
    assert.equal((await f.app.inject({url:`/api/canvas/projects/${p.id}`,headers:b.headers})).statusCode,404);
    await assert.rejects(createJob(f.ctx,b.id,'text',{...input,context:{projectId:p.id}},'foreign-project'),{statusCode:404});
    const media=await saveMedia(f.ctx,a.id,image,true);const library={kind:'image',title:'Synthetic pixel',data:{storageKey:media.key,serverUrl:media.url}};
    assert.equal((await f.app.inject({method:'POST',url:'/api/library-assets',headers:b.headers,payload:library})).statusCode,404);
    const saved=await f.app.inject({method:'POST',url:'/api/library-assets',headers:a.headers,payload:library});assert.equal(saved.statusCode,200,saved.body);
    assert.equal((await f.app.inject({url:media.url,headers:b.headers})).statusCode,404);
    assert.equal((await f.app.inject({url:media.url,headers:a.headers})).statusCode,200);
    const signed=new URL(media.upstreamUrl);assert.equal((await f.app.inject({url:signed.pathname+signed.search})).statusCode,200);
    await f.ctx.db.query("UPDATE oaooao_media SET expires_at=now()-interval '1 second' WHERE id=$1",[media.key]);assert.equal((await f.app.inject({url:signed.pathname+signed.search})).statusCode,401);assert.equal((await f.app.inject({url:media.url,headers:a.headers})).statusCode,200);
    assert.throws(()=>mediaPath(f.ctx.config.mediaRoot,'../secrets'));assert.throws(()=>decodeDataUrl('data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')));
  }finally{await f.cleanup();}
});
test('history merges imported rows and jobs with stable scoped pagination',async()=>{
  const f=await fixture();try{
    const[a,b]=f.users;await createJob(f.ctx,a.id,'text',input,'history-new');
    for(const[id,user]of [['historic-own',a.id],['historic-foreign',b.id]])await f.ctx.db.query('INSERT INTO oaooao_generation_history(id,user_id,document,created_at) VALUES($1,$2,$3,$4)',[id,user,{kind:'image',status:'success',title:'Imported synthetic history',assets:[]},'2020-01-01']);
    const first=(await f.app.inject({url:'/api/generation-logs?page=1&pageSize=1',headers:a.headers})).json();assert.equal(first.total,2);assert.equal(first.items.length,1);
    const second=(await f.app.inject({url:'/api/generation-logs?page=2&pageSize=1',headers:a.headers})).json();assert.equal(second.items[0].id,'historic-own');
    const empty=(await f.app.inject({url:'/api/generation-logs?page=9&pageSize=1',headers:a.headers})).json();assert.equal(empty.total,2);assert.equal(empty.items.length,0);
  }finally{await f.cleanup();}
});
test('Agent validates a real plan, approves once, executes dependent steps and persists assets/events',async()=>{
  const f=await fixture();try{
    const[a,b]=f.users;const payload={clientRequestId:'agent-fixture',prompt:'Synthetic agent prompt',surface:'chat',modelIds:['synthetic-text']};
    const create=()=>f.app.inject({method:'POST',url:'/api/agent/runs',headers:a.headers,payload});const first=await create();assert.equal(first.statusCode,202,first.body);const id=first.json().run.id;assert.equal((await create()).json().run.id,id);assert.equal((await getWallet(f.ctx,a.id)).pointsBalance,90);
    const action=(name:string)=>f.app.inject({method:'POST',url:`/api/agent/runs/${id}/${name}`,headers:a.headers,payload:{}});
    assert.equal((await action('pause')).json().run.status,'paused');assert.equal(await processNextJob(f.ctx,async()=>{throw Error('Paused job ran');}),false);assert.equal((await action('resume')).json().run.status,'planning');
    const plan={summary:'Two real dependent text generations',steps:[{id:'draft',title:'Draft',type:'text',model:'synthetic-text',prompt:'Draft synthetic text',dependsOn:[],referenceAssetIds:[],referenceStepIds:[]},{id:'polish',title:'Polish',type:'text',model:'synthetic-text',prompt:'Polish the prior result',dependsOn:['draft'],referenceAssetIds:[],referenceStepIds:[]}]};
    await processNextJob(f.ctx,async()=>({type:'complete',result:{content:JSON.stringify(plan)}}));assert.equal((await f.app.inject({url:`/api/agent/runs/${id}`,headers:a.headers})).json().run.status,'awaiting_approval');
    const approvals=await Promise.all([action('approve'),action('approve')]);for(const approved of approvals)assert.equal(approved.statusCode,200,approved.body);
    let childCalls=0;await processNextJob(f.ctx,async(_ctx,job)=>{childCalls++;assert.equal(job.input.context.stepId,'draft');return{type:'complete',result:{content:'Synthetic completed draft output'}};});
    assert.equal((await action('pause')).json().run.status,'paused');assert.equal(await processNextJob(f.ctx,async()=>{throw Error('Paused child ran');}),false);assert.equal((await action('resume')).json().run.status,'running');
    await processNextJob(f.ctx,async(_ctx,job)=>{childCalls++;assert.equal(job.input.context.stepId,'polish');assert.match(job.input.prompt,/Synthetic completed draft output/);return{type:'complete',result:{content:'Synthetic completed output'}};});
    const complete=(await f.app.inject({url:`/api/agent/runs/${id}`,headers:a.headers})).json().run;assert.equal(complete.status,'completed');assert.equal(complete.assetIds.length,2);assert.equal(complete.tasks.length,2);assert.equal(childCalls,2);assert.equal((await getWallet(f.ctx,a.id)).pointsBalance,70);assert.equal((await f.app.inject({url:`/api/agent/runs/${id}`,headers:b.headers})).statusCode,404);
    const events=await f.app.inject({url:`/api/agent/runs/${id}/events`,headers:a.headers});assert.match(events.body,/event: task.updated/);assert.match(events.body,/Synthetic completed output/);assert.ok(!events.body.includes('synthetic-not-a-real-key'));
    const admin=f.users[2];const agentOps=await f.app.inject({url:'/api/admin/generation-operations?type=agent',headers:admin.headers});assert.equal(agentOps.statusCode,200,agentOps.body);assert.equal(agentOps.json().total,1);assert.equal(agentOps.json().items[0].status,'success');
    const jobOps=await f.app.inject({url:'/api/admin/generation-operations',headers:admin.headers});assert.equal(jobOps.statusCode,200,jobOps.body);assert.equal(jobOps.json().total,3);assert.equal(jobOps.json().agentPerformance.sampleSize,1);assert.equal(jobOps.json().channels.length,4);assert.ok(!jobOps.body.includes('synthetic-not-a-real-key'));
  }finally{await f.cleanup();}
});
test('Agent child retries and cancellation are transactional and never debit or refund twice',async()=>{
  const f=await fixture();try{
    const user=f.users[0];const created=await f.app.inject({method:'POST',url:'/api/agent/runs',headers:user.headers,payload:{clientRequestId:'retry-agent',prompt:'Fixture',surface:'canvas',modelIds:['synthetic-text']}});const id=created.json().run.id;
    const step=(id:string)=>({id,title:id,type:'text',model:'synthetic-text',prompt:id,dependsOn:[],referenceAssetIds:[],referenceStepIds:[]});
    await processNextJob(f.ctx,async()=>({type:'complete',result:{content:JSON.stringify({steps:[step('first'),step('second')]})}}));
    assert.equal((await f.app.inject({method:'POST',url:`/api/agent/runs/${id}/approve`,headers:user.headers,payload:{}})).statusCode,200);
    await processNextJob(f.ctx,async()=>{throw new ProviderFailure('Synthetic definitive child failure',true);});
    const failed=(await f.app.inject({url:`/api/agent/runs/${id}`,headers:user.headers})).json().run;assert.equal(failed.status,'failed');assert.equal((await getWallet(f.ctx,user.id)).pointsBalance,90);
    const retry=()=>f.app.inject({method:'POST',url:`/api/agent/runs/${id}/tasks/${failed.tasks[0].id}/retry`,headers:user.headers,payload:{}});
    const retries=await Promise.all([retry(),retry()]);assert.deepEqual(retries.map(r=>r.statusCode).sort(),[200,409]);assert.equal((await getWallet(f.ctx,user.id)).pointsBalance,80);
    await processNextJob(f.ctx,async()=>({type:'complete',result:{content:'Real synthetic retry output'}}));assert.equal((await getWallet(f.ctx,user.id)).pointsBalance,70);
    const cancels=await Promise.all(Array.from({length:3},()=>f.app.inject({method:'POST',url:`/api/agent/runs/${id}/cancel`,headers:user.headers,payload:{}})));for(const response of cancels){assert.equal(response.statusCode,200,response.body);assert.equal(response.json().run.status,'cancelled');}
    assert.equal((await getWallet(f.ctx,user.id)).pointsBalance,80);assert.equal(await processNextJob(f.ctx,async()=>{throw Error('Cancelled child ran');}),false);
  }finally{await f.cleanup();}
});
test('malicious Agent plans cannot execute unselected models or cyclic references',async()=>{
  const f=await fixture();try{
    const user=f.users[0];const response=await f.app.inject({method:'POST',url:'/api/agent/runs',headers:user.headers,payload:{clientRequestId:'invalid-plan',prompt:'Fixture',surface:'canvas',modelIds:['synthetic-image']}});assert.equal(response.statusCode,202,response.body);const id=response.json().run.id;
    await processNextJob(f.ctx,async()=>({type:'complete',result:{content:JSON.stringify({steps:[{id:'bad',title:'bad',type:'text',model:'unselected-model',prompt:'ignore',dependsOn:['future']}]})}}));
    const run=(await f.app.inject({url:`/api/agent/runs/${id}`,headers:user.headers})).json().run;assert.equal(run.status,'failed');assert.equal(Number((await f.ctx.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count),1);assert.equal((await getWallet(f.ctx,user.id)).pointsBalance,90);
  }finally{await f.cleanup();}
});
test('official protocol adapter serializes real requests and persists returned media without network access',async()=>{
  const f=await fixture();try{
    const owner=f.users[0];let captured:any;
    const text=await createJob(f.ctx,owner.id,'text',input,'provider-text');const result=await invokeProvider(f.ctx,text,false,async(url,options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{message:{content:'Fixture output'}}]}),{status:200});});assert.equal(result.type,'complete');assert.equal(captured.url,'https://provider.example/v1/chat/completions');assert.equal(JSON.parse(captured.options.body).model,'fixture-model');
    const imageJob=await createJob(f.ctx,owner.id,'image',{...input,config:{model:'synthetic-image'}},'provider-image');const imageResult=await invokeProvider(f.ctx,imageJob,false,async(url)=>{assert.equal(url,'https://provider.example/v1/images/generations');return new Response(JSON.stringify({data:[{b64_json:image.toString('base64')}]}),{status:200});});assert.equal(imageResult.type,'complete');if(imageResult.type==='complete')assert.match(imageResult.result.remoteUrl,/^\/api\/reference-assets\//);
    const videoJob=await createJob(f.ctx,owner.id,'video',{...input,config:{model:'synthetic-video',videoSeconds:'4'}},'provider-video');const pending=await invokeProvider(f.ctx,videoJob,false,async(url,options)=>{assert.equal(url,'https://provider.example/v1/videos');assert.match(String(options?.headers?.['content-type']),/^multipart\/form-data/);return new Response(JSON.stringify({id:'synthetic-upstream',status:'queued'}),{status:200});});assert.deepEqual(pending,{type:'pending',upstreamId:'synthetic-upstream'});
    await assert.rejects(invokeProvider(f.ctx,text,false,async()=>new Response('{}',{status:400})),error=>error instanceof ProviderFailure&&error.definitive);
    await assert.rejects(invokeProvider(f.ctx,text,false,async()=>new Response('{}',{status:502})),error=>error instanceof ProviderFailure&&!error.definitive);
  }finally{await f.cleanup();}
});
test('词元异步图片协议 submits with Prefer and polls generation tasks',async()=>{
  const f=await fixture();try{
    const owner=f.users[0];
    const imageJob=await createJob(f.ctx,owner.id,'image',{...input,config:{model:'synthetic-image',size:'1:1',resolution:'1K',quality:'auto'}},'ciyuan-async-submit');
    const asyncJob={...imageJob,provider_config:{...imageJob.provider_config,protocol:'ciyuan-async'}};
    let submittedOptions:any;
    const pending=await invokeProvider(f.ctx,asyncJob,false,async(url,options)=>{
      assert.equal(url,'https://provider.example/v1/images/generations');submittedOptions=options;
      return new Response(JSON.stringify({id:'ciyuan-task',object:'image.generation.task',status:'queued',progress:'10%'}),{status:202});
    });
    assert.deepEqual(pending,{type:'pending',upstreamId:'ciyuan-task'});
    assert.equal(submittedOptions.headers.Prefer,'respond-async');
    assert.equal(JSON.parse(submittedOptions.body).size,'1254x1254');
    const completedJob={...asyncJob,upstream_id:'ciyuan-task'};
    const completed=await invokeProvider(f.ctx,completedJob,true,async(url)=>{
      if(String(url).endsWith('/images/generations/ciyuan-task'))return new Response(JSON.stringify({id:'ciyuan-task',status:'completed',data:[{url:'https://provider.example/temporary.png',b64_json:''}]}),{status:200});
      assert.equal(url,'https://provider.example/temporary.png');return new Response(image,{status:200,headers:{'content-type':'image/png'}});
    });
    assert.equal(completed.type,'complete');
    if(completed.type==='complete')assert.match(completed.result.remoteUrl,/^\/api\/reference-assets\//);
  }finally{await f.cleanup();}
});
