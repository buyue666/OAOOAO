import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {createJob} from '../src/creative.js';
import {resolveProvider,invokeProvider,ProviderFailure} from '../src/providers.js';
import {readReference,saveMedia} from '../src/media.js';
import {processNextJob} from '../src/worker.js';
import {adjustWallet,getWallet} from '../src/wallet.js';
import {createTestDatabase} from './core-helpers.js';

const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64');
test('independent creative security review: storage, price controls, references and credential snapshots',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});const ctx=app.ctx;
  try{
    const users:Array<{id:string;headers:{cookie:string;origin:string}}>=[];
    for(let i=0;i<2;i++){
      const id=randomUUID(),token=randomBytes(32).toString('base64url');
      await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$2,$3)',[id,`security-${i}-${id}`,'synthetic-unused-password']);
      await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
      await adjustWallet(ctx,id,`security:${id}`,100);
      users.push({id,headers:{cookie:`${ctx.config.sessionCookieName}=${token}`,origin:ctx.config.origin}});
    }
    const originalSecret='synthetic-original-provider-key';
    const settings={systemChannels:[{id:'security-channel',name:'Synthetic provider',baseUrl:'https://old-provider.example.invalid/v1',enabled:true,apiKey:ctx.encrypt(originalSecret),models:['synthetic-text','synthetic-image','synthetic-video']}],
      logicalModels:['text','image','video'].map(kind=>({id:`security-${kind}`,name:`Synthetic ${kind}`,capability:kind,enabled:true,bindings:[{id:`security-${kind}-binding`,channelId:'security-channel',upstreamModel:`synthetic-${kind}`,enabled:true,priority:0,capabilityProfile:{aspectRatios:['1:1'],durationSeconds:[4,8]}}]})),
      modelPointCosts:{'security-text':10,'security-image':10,'security-video':10},generationDefaults:{imageQuality:'standard',videoQuality:'standard',videoSeconds:4},generationPointMultipliers:{imageQuality:{standard:1,high:2},videoQuality:{standard:1},videoSeconds:{'4':1,'8':2}}};
    await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[settings]);
    const imageInput={prompt:'Synthetic image request',config:{model:'security-image',quality:'standard'},context:{},source:'test'};
    await t.test('configured unsupported storage cannot silently fall back or debit',async()=>{
      await ctx.db.query("UPDATE oaooao_settings SET value='{\"enabled\":true}' WHERE id='object-storage'");
      await assert.rejects(saveMedia(ctx,users[0].id,pixel),{statusCode:503});
      await assert.rejects(createJob(ctx,users[0].id,'image',imageInput,'storage-unavailable'),{statusCode:503});
      assert.equal((await getWallet(ctx,users[0].id)).pointsBalance,100);
      const upload=await app.inject({method:'POST',url:'/api/reference-assets',headers:users[0].headers,payload:{dataUrl:'data:image/png;base64,'+pixel.toString('base64'),persistent:true,type:'image'}});
      assert.equal(upload.statusCode,503);assert.match(upload.json().msg,/object storage/i);
      assert.equal(Number((await ctx.db.query('SELECT count(*) FROM oaooao_media')).rows[0].count),0);
      await ctx.db.query("UPDATE oaooao_settings SET value='{}' WHERE id='object-storage'");
    });
    await t.test('unpriced quality and duration, unsupported dimensions fail before debit',async()=>{
      await assert.rejects(resolveProvider(ctx,'image',{...imageInput,config:{model:'security-image',quality:'unpriced-premium'}}),{statusCode:400});
      await assert.rejects(resolveProvider(ctx,'image',{...imageInput,config:{model:'security-image',size:'16:9'}}),{statusCode:400});
      await assert.rejects(resolveProvider(ctx,'video',{prompt:'Synthetic',config:{model:'security-video',videoSeconds:12}}),{statusCode:400});
      assert.equal((await resolveProvider(ctx,'image',{...imageInput,config:{model:'security-image',quality:'high'}})).cost,'20.0000');
      assert.equal((await resolveProvider(ctx,'video',{prompt:'Synthetic',config:{model:'security-video',videoSeconds:8}})).cost,'20.0000');
    });
    await t.test('private URL references and other users local assets are rejected',async()=>{
      const media=await saveMedia(ctx,users[0].id,pixel,true);
      await assert.rejects(readReference(ctx,users[0].id,{url:'http://127.0.0.1/private'}),{statusCode:400});
      await assert.rejects(readReference(ctx,users[1].id,{url:media.url}),{statusCode:404});
      await assert.rejects(createJob(ctx,users[1].id,'image',{...imageInput,references:[{url:media.url}]},'foreign-reference'),{statusCode:404});
      assert.equal((await getWallet(ctx,users[1].id)).pointsBalance,100);
    });
    await t.test('invalid local reference is a confirmed pre-submission failure with one refund',async()=>{
      const job=await createJob(ctx,users[0].id,'image',{...imageInput,references:[{dataUrl:'invalid-synthetic-data-url'}]},'invalid-reference');
      assert.equal((await getWallet(ctx,users[0].id)).pointsBalance,90);let calls=0;
      await processNextJob(ctx,(context,row,poll)=>invokeProvider(context,row,poll,async()=>{calls++;throw new Error('Unexpected external call');}));
      assert.equal(calls,0);const row=(await ctx.db.query('SELECT status,needs_review FROM oaooao_generation_jobs WHERE id=$1',[job.id])).rows[0];
      assert.equal(row.status,'error');assert.equal(row.needs_review,false);assert.equal((await getWallet(ctx,users[0].id)).pointsBalance,100);
      assert.equal(Number((await ctx.db.query('SELECT count(*) FROM oaooao_wallet_operations WHERE refund_of=$1',[`generation:${job.id}:debit`])).rows[0].count),1);
      await assert.rejects(invokeProvider(ctx,{...job,provider_config:{...job.provider_config,apiKey:'invalid-secret'}},false,async()=>{calls++;throw new Error('Unexpected call');}),error=>error instanceof ProviderFailure&&error.definitive===true);assert.equal(calls,0);
    });
    await t.test('queued requests retain matching original endpoint and encrypted credential',async()=>{
      const job=await createJob(ctx,users[0].id,'text',{prompt:'Synthetic text',config:{model:'security-text'},context:{},source:'test'},'credential-snapshot');
      const revised=structuredClone(settings);revised.systemChannels[0].baseUrl='https://new-provider.example.invalid/v1';revised.systemChannels[0].apiKey=ctx.encrypt('synthetic-new-provider-key');
      await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[revised]);let calls=0;
      await processNextJob(ctx,(context,row,poll)=>invokeProvider(context,row,poll,async(url,options)=>{
        calls++;assert.ok(String(url).startsWith('https://old-provider.example.invalid/v1/'));assert.equal(options?.headers?.authorization,`Bearer ${originalSecret}`);
        return new Response(JSON.stringify({choices:[{message:{content:'Synthetic fixture response'}}]}),{headers:{'content-type':'application/json'}});
      }));
      assert.equal(calls,1);assert.equal((await ctx.db.query('SELECT status FROM oaooao_generation_jobs WHERE id=$1',[job.id])).rows[0].status,'success');
      const response=await app.inject({url:`/api/text-tasks/${job.id}`,headers:users[0].headers});
      assert.equal(response.statusCode,200,response.body);
      assert.ok(!response.body.includes(originalSecret));assert.ok(!response.body.includes('synthetic-new-provider-key'));assert.ok(!response.body.includes('enc:v1:'));
    });
    await t.test('concurrent users cannot exceed the global spending cap',async()=>{
      await ctx.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({generationCostControl:{dailyTotalPointSpend:20}})]);
      const results=await Promise.allSettled(users.map((user,index)=>createJob(ctx,user.id,'text',{prompt:'Synthetic budget test',config:{model:'security-text'},context:{},source:'test'},`global-cap-${index}`)));
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      const rejected=results.find(result=>result.status==='rejected');assert.equal(rejected?.status==='rejected'&&rejected.reason.statusCode,429);
      const spent=(await ctx.db.query("SELECT sum(cost)::text total FROM oaooao_generation_jobs WHERE status NOT IN ('error','cancelled')")).rows[0].total;assert.equal(Number(spent),20);
      const balances=await Promise.all(users.map(user=>getWallet(ctx,user.id)));assert.equal(balances.reduce((sum,w)=>sum+w.pointsBalance,0),180);
    });
    await t.test('different concurrent Agent request IDs cannot exceed a shared user limit',async()=>{
      await ctx.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({generationCostControl:{dailyTotalPointSpend:0},generationConcurrency:{agent:1,text:10},defaultModels:{textModel:'security-text'}})]);
      const requests=await Promise.all([0,1].map(index=>app.inject({method:'POST',url:'/api/agent/runs',headers:users[0].headers,payload:{clientRequestId:`concurrent-agent-${index}`,surface:'canvas',prompt:'Synthetic bounded workflow',modelIds:['security-text']}})));
      assert.deepEqual(requests.map(reply=>reply.statusCode).sort(),[202,429]);
      assert.match(requests.find(reply=>reply.statusCode===429)!.json().msg,/Agent concurrency/);
      assert.equal(Number((await ctx.db.query('SELECT count(*) FROM oaooao_agent_runs WHERE user_id=$1',[users[0].id])).rows[0].count),1);
      const agentDebitCount=(await ctx.db.query("SELECT count(*) FROM oaooao_generation_jobs WHERE input->'context'->>'agentRole'='planner' AND user_id=$1",[users[0].id])).rows[0].count;assert.equal(Number(agentDebitCount),1);
    });
  }finally{await app.close();await fixture.cleanup();}
});
