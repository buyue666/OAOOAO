import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { ADMIN_PERMISSIONS, hashToken } from '../src/core.js';
import { createJob } from '../src/creative.js';
import { assertPlanModelAllowed, validatePlanModels } from '../src/entitlements.js';
import { adjustWallet, assignAdminPlan, getWallet } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

test('model scopes preserve legacy plans, distinguish empty scopes and reject malformed permissions', () => {
  assert.doesNotThrow(() => assertPlanModelAllowed({}, 'image'));
  assert.doesNotThrow(() => assertPlanModelAllowed({ allowedModelIds: ['image'] }, 'image'));
  assert.throws(() => assertPlanModelAllowed({ allowedModelIds: [] }, 'image'), { statusCode: 403 });
  assert.throws(() => assertPlanModelAllowed({ allowedModelIds: ['video'] }, 'image'), { statusCode: 403 });
  for (const value of [null, 'image', [''], [' image'], ['image','image'], [false], new Array(2001).fill('a')]) assert.throws(() => validatePlanModels({ allowedModelIds: value }), { statusCode: 400 });
});

test('personal plan model restrictions cover aliases, quotes, defaults and Agent calls before charging while team scope remains independent', async t => {
  const f = await createTestDatabase(), app = await buildApp({ db: f.db, config: f.config });
  await app.ready(); t.after(async () => { await app.close(); await f.cleanup() });
  const userId = randomUUID(), token = randomBytes(32).toString('base64url');
  await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)", [userId, JSON.stringify(ADMIN_PERMISSIONS)]);
  await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hashToken(token),userId]);
  const headers = { origin: f.config.origin, cookie: `${f.config.sessionCookieName}=${token}` };
  const req = (method: InjectOptions['method'], url: string, payload?: InjectOptions['payload']) => app.inject({ method,url,headers,...(payload === undefined ? {} : {payload}) });
  const models = ['image-a','image-b','text-a','video-a'].map(id => ({ id,name:id,capability:id.split('-')[0],enabled:true,aliases:[id+'-alias'],bindings:[{id,channelId:'synthetic',upstreamModel:id,requestAlias:id+'-route',enabled:true,priority:0}] }));
  const initial = await req('PATCH','/api/admin/settings',{
    systemChannels:[{id:'synthetic',name:'Synthetic',baseUrl:'https://provider.example/v1',enabled:true,apiFormat:'openai',apiKey:'synthetic-unused',models:models.map(m=>m.id)}],
    logicalModels:models,generationConcurrency:{image:10},defaultModels:{imageModel:'image-b',videoModel:'video-a',textModel:'text-a',audioModel:''},modelPointCosts:Object.fromEntries(models.map(m=>[m.id,1])),
  });
  assert.equal(initial.statusCode,200,initial.body);
  await adjustWallet(app.ctx,userId,'synthetic-credit',100);
  const basic = {id:'basic',name:'Basic',enabled:true,dailyPoints:0,limits:{},features:[],allowedModelIds:['image-a']};
  const pro = {...basic,id:'pro',name:'Pro',allowedModelIds:['image-b','video-a']};
  const save = (plans: object[], enabled = true) => req('PATCH','/api/admin/settings',{entitlements:{enabled,defaultPlanId:'basic',plans}});
  assert.equal((await save([basic,pro])).statusCode,200);
  assert.equal((await save([{...basic,allowedModelIds:['image-a','image-a']},pro])).statusCode,400);
  const session = (await req('GET','/api/auth/session')).json().settings;
  assert.deepEqual(session.personalModelIds,['image-a']);
  assert.equal(session.defaultModels.imageModel,'image-a');
  assert.equal(session.logicalModels.length,4,'Raw enabled catalog remains available for independent team model scope');
  assert.equal((await req('PATCH','/api/account/model-defaults',{imageModel:'image-b-route'})).statusCode,403);
  const input = {prompt:'Synthetic',config:{model:'image-b'},context:{},source:'canvas'};
  for (const model of ['image-b','image-b-alias','image-b-route']) {
    const response = await req('POST','/api/image-tasks',{...input,config:{model}});
    assert.equal(response.statusCode,403,response.body);
  }
  assert.equal((await req('POST','/api/video-generation-tasks/quote',{prompt:'Synthetic',config:{model:'video-a'}})).statusCode,403);
  assert.equal((await req('POST','/api/agent/runs',{clientRequestId:'blocked-model-agent',prompt:'Synthetic',surface:'chat',modelIds:['text-a']})).statusCode,403);
  assert.equal((await getWallet(app.ctx,userId)).pointsBalance,100);
  const allowed = await createJob(app.ctx,userId,'image',{...input,config:{model:'image-a-route'}},'allowed-model-once');
  assert.equal(allowed.model,'image-a');
  assert.equal((await getWallet(app.ctx,userId)).pointsBalance,99);
  assert.equal((await save([{...basic,allowedModelIds:[]},pro])).statusCode,200);
  assert.equal((await createJob(app.ctx,userId,'image',{...input,config:{model:'image-a-route'}},'allowed-model-once')).id,allowed.id);
  await assert.rejects(createJob(app.ctx,userId,'image',{...input,config:{model:'image-a-route'}},'forbidden-new-request'),{statusCode:403});
  const noModels = (await req('GET','/api/auth/session')).json().settings;
  assert.deepEqual(noModels.personalModelIds,[]);assert.equal(noModels.defaultModels.imageModel,'');
  await assignAdminPlan(app.ctx,userId,'synthetic-pro-assignment','pro');
  assert.deepEqual((await req('GET','/api/auth/session')).json().settings.personalModelIds,['image-b','video-a']);
  const upgraded = await createJob(app.ctx,userId,'image',input,'allowed-upgraded');assert.equal(upgraded.model,'image-b');
  await assignAdminPlan(app.ctx,userId,'synthetic-revoke','');
  assert.deepEqual((await req('GET','/api/auth/session')).json().settings.personalModelIds,[]);
  assert.equal((await save([basic,pro],false)).statusCode,200);
  await createJob(app.ctx,userId,'image',input,'allowed-global-disabled');
  assert.equal((await req('GET','/api/auth/session')).json().settings.personalModelIds,undefined);

  const display = {tone:'aurora',badge:'Studio',benefits:['Synthetic display only']};
  let plan = await req('PATCH','/api/admin/team-plans/team-standard',{display,priceCents:100,enabled:true,modelIds:['image-b']});
  assert.equal(plan.statusCode,200,plan.body);assert.deepEqual(plan.json().plan.display,display);
  assert.deepEqual((await req('GET','/api/team-plans')).json().plans.find((p: any)=>p.id==='team-standard').display,display);
  assert.equal((await req('PATCH','/api/admin/team-plans/team-standard',{display:{tone:'unknown'}})).statusCode,400);
  assert.equal((await req('PATCH','/api/admin/team-plans/team-standard',{display:{benefits:['']}})).statusCode,400);
  const team = (await req('POST','/api/teams',{name:'Independent team'})).json().team;
  assert.equal((await req('POST',`/api/admin/teams/${team.id}/subscription`,{operationId:'synthetic-team-subscription',planId:'team-standard',seats:2,reason:'Synthetic isolated grant',confirmManualGrant:true})).statusCode,200);
  const project = (await req('POST',`/api/teams/${team.id}/projects`,{title:'Synthetic',visibility:'team'})).json().project;
  assert.equal((await save([{...basic,allowedModelIds:[]},pro])).statusCode,200);
  const quote = await req('POST',`/api/teams/${team.id}/projects/${project.id}/generations/quote`,{kind:'image',prompt:'Synthetic team quote',config:{model:'image-b'},references:[]});
  assert.equal(quote.statusCode,200,quote.body);assert.equal(quote.json().points,1);
});
