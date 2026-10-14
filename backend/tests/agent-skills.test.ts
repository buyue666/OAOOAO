import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { adjustWallet, getWallet } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

async function fixture(){
  const database=await createTestDatabase();
  const app=await buildApp({db:database.db,config:database.config});await app.ready();
  const ctx=app.ctx;
  const users:{id:string;headers:{cookie:string;origin:string}}[]=[];
  for(let index=0;index<2;index++){
    const id=randomUUID(),token=randomBytes(32).toString('base64url');
    await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$2,$3)',[id,`skills-fixture-${id}`,'synthetic-unused-hash']);
    await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    await adjustWallet(ctx,id,`skills-fixture:${id}`,100);
    users.push({id,headers:{cookie:`oaooao_session=${token}`,origin:database.config.origin}});
  }
  await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{
    systemChannels:[{id:'skills-fixture',name:'Synthetic skills protocol fixture',baseUrl:'https://provider.example/v1',apiFormat:'openai',apiKey:ctx.encrypt('synthetic-key-never-transmitted'),enabled:true,models:['synthetic-planner']}],
    logicalModels:[{id:'skills-text',name:'Synthetic text',capability:'text',enabled:true,bindings:[{id:'skills-binding',channelId:'skills-fixture',upstreamModel:'synthetic-planner',enabled:true,priority:1}]}],
    defaultModels:{textModel:'skills-text'},modelPointCosts:{'skills-text':10},generationConcurrency:{agent:20,text:20},
  }]);
  const asset=async(owner=users[0],overrides:Record<string,unknown>={})=>{
    const response=await app.inject({method:'POST',url:'/api/library-assets',headers:owner.headers,payload:{kind:'text',title:'Synthetic owned skill',source:'canvas-skill',tags:['技能'],data:{skillVersion:1,prompt:'Use three concise numbered steps.'},...overrides}});
    assert.equal(response.statusCode,200,response.body);return response.json().data.asset;
  };
  const submit=(skillIds:unknown,extra:Record<string,unknown>={},owner=users[0])=>app.inject({method:'POST',url:'/api/agent/runs',headers:owner.headers,payload:{prompt:'Synthetic storyboard task',surface:'chat',clientRequestId:randomUUID(),skillIds,...extra}});
  const ledger=async()=>Number((await ctx.db.query('SELECT count(*) count FROM oaooao_wallet_operations')).rows[0].count);
  return{app,ctx,users,asset,submit,ledger,cleanup:async()=>{await app.close();await database.cleanup();}};
}

test('Agent skill validation rejects foreign, missing and invalid assets before any debit or planner creation',async t=>{
  const f=await fixture();try{
    const foreign=await f.asset(f.users[1]);
    const ordinary=await f.asset(f.users[0],{source:'text-result',tags:[],data:{prompt:'Ordinary generated prose'}});
    const blank=await f.asset(f.users[0],{data:{skillVersion:1,prompt:'   '}});
    const long=await f.asset(f.users[0],{data:{skillVersion:1,prompt:'x'.repeat(4001)}});
    const imageId=randomUUID();await f.ctx.db.query('INSERT INTO oaooao_library_assets(id,user_id,kind,document) VALUES($1,$2,$3,$4)',[imageId,f.users[0].id,'image',{title:'Synthetic invalid-kind fixture',source:'canvas-skill',data:{skillVersion:1,prompt:'This is an image, not a text skill'}}]);
    const count=await f.ledger();
    const cases:[string,unknown,number][]=[['foreign owner',[foreign.id],404],['missing asset',[randomUUID()],404],['ordinary text',[ordinary.id],422],['blank instructions',[blank.id],422],['oversized instructions',[long.id],422],['wrong asset kind',[imageId],422],['too many IDs',Array.from({length:9},()=>randomUUID()),400],['invalid shape','skill-id',400],['null shape',null,400],['empty ID',[''],400],['oversized ID',['x'.repeat(201)],400]];
    for(const[label,ids,status]of cases)await t.test(label,async()=>{
      const response=await f.submit(ids);assert.equal(response.statusCode,status,response.body);
      assert.equal((await getWallet(f.ctx,f.users[0].id)).pointsBalance,100);
      assert.equal(await f.ledger(),count);
      assert.equal(Number((await f.ctx.db.query('SELECT count(*) count FROM oaooao_generation_jobs')).rows[0].count),0);
      assert.equal(Number((await f.ctx.db.query('SELECT count(*) count FROM oaooao_agent_runs')).rows[0].count),0);
      assert.doesNotMatch(response.body,/Synthetic owned skill|three concise/);
    });
  }finally{await f.cleanup();}
});

test('Agent snapshots owned skills as user context, deduplicates IDs, and concurrent retries debit only once',async()=>{
  const f=await fixture();try{
    const skill=await f.asset();const clientRequestId=randomUUID();
    const before=await f.ledger();
    const responses=await Promise.all(Array.from({length:6},()=>f.submit([skill.id,skill.id],{clientRequestId})));
    for(const response of responses){assert.equal(response.statusCode,202,response.body);assert.deepEqual(response.json().run.selectedSkillIds,[skill.id]);}
    const runIds=new Set(responses.map(response=>response.json().run.id));assert.equal(runIds.size,1);
    assert.equal(await f.ledger(),before+1);assert.equal((await getWallet(f.ctx,f.users[0].id)).pointsBalance,90);
    const planner=(await f.ctx.db.query('SELECT input FROM oaooao_generation_jobs WHERE user_id=$1',[f.users[0].id])).rows[0].input;
    const messages=planner.messages as {role:string;content:string}[];
    assert.deepEqual(messages.map(item=>item.role),['system','user']);
    assert.doesNotMatch(messages[0].content,/Use three concise numbered steps/);
    assert.deepEqual(JSON.parse(messages[1].content).skills,[{id:skill.id,title:skill.title,prompt:'Use three concise numbered steps.'}]);
    await f.ctx.db.query('DELETE FROM oaooao_library_assets WHERE id=$1',[skill.id]);
    const retried=await f.submit([skill.id,skill.id],{clientRequestId});assert.equal(retried.statusCode,202,retried.body);assert.equal(retried.json().run.id,[...runIds][0]);
    assert.equal(await f.ledger(),before+1);assert.equal((await getWallet(f.ctx,f.users[0].id)).pointsBalance,90);
    const changed=await f.submit([],{clientRequestId});assert.equal(changed.statusCode,409);assert.equal(await f.ledger(),before+1);
  }finally{await f.cleanup();}
});

test('Agent accepts explicit version, legacy source/text and legacy skill tags with exact prompt bounds',async()=>{
  const f=await fixture();try{
    const version=await f.asset(f.users[0],{source:'user-instructions',tags:[],data:{skillVersion:1,prompt:'v'.repeat(4000)}});
    const source=await f.asset(f.users[0],{tags:[],data:{text:' Legacy text fallback '}});
    const tags=await f.asset(f.users[0],{source:'legacy-import',data:{prompt:' Legacy tagged skill '}});
    const response=await f.submit([version.id,source.id,tags.id]);assert.equal(response.statusCode,202,response.body);
    const planner=(await f.ctx.db.query('SELECT input FROM oaooao_generation_jobs WHERE user_id=$1',[f.users[0].id])).rows[0].input;
    const skills=JSON.parse(planner.messages[1].content).skills;
    assert.equal(skills.length,3);assert.equal(skills[0].prompt.length,4000);assert.equal(skills[1].prompt,'Legacy text fallback');assert.equal(skills[2].prompt,'Legacy tagged skill');
  }finally{await f.cleanup();}
});

test('canvas Agent reads only an owned saved project and cannot replace its context with a forged snapshot',async()=>{
  const f=await fixture();try{
    const create=async(owner:typeof f.users[number],title:string)=>{
      const response=await f.app.inject({method:'POST',url:'/api/canvas/projects',headers:owner.headers,payload:{title,project:{nodes:[{id:'synthetic-node',type:'text',position:{x:1,y:2},data:{kind:'text',title:'Saved node',prompt:'Owned saved scene context'}}],connections:[]}}});
      assert.equal(response.statusCode,200,response.body);return response.json().data.project;
    };
    const own=await create(f.users[0],'Owned board');const other=await create(f.users[1],'Foreign private board');
    const count=await f.ledger();
    const rejected=await f.submit([],{surface:'canvas',projectId:other.id});assert.equal(rejected.statusCode,404);assert.equal(await f.ledger(),count);
    const created=await f.submit([],{surface:'canvas',projectId:own.id,snapshot:{nodes:[{id:'forged',data:{prompt:'FORGED_UNTRUSTED_CLIENT_CONTEXT'}}]}});assert.equal(created.statusCode,202,created.body);
    const planner=(await f.ctx.db.query('SELECT input FROM oaooao_generation_jobs WHERE user_id=$1',[f.users[0].id])).rows[0].input;
    const userMessage=planner.messages.find((message:{role:string})=>message.role==='user').content;
    assert.match(userMessage,/Owned saved scene context/);assert.doesNotMatch(userMessage,/FORGED_UNTRUSTED_CLIENT_CONTEXT|Foreign private board/);
    assert.equal((await getWallet(f.ctx,f.users[0].id)).pointsBalance,90);
  }finally{await f.cleanup();}
});
