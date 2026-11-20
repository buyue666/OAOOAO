import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {createTestDatabase} from './core-helpers.js';
import {DEFAULT_SETTINGS,validateSettingsPatch,settingsPermission} from '../src/settings.js';
import {validateToolSettings,toolEnabled,assertToolEnabled,generationTools} from '../src/creative-tool-settings.js';
import {requestTools} from '../src/creative-tool-access.js';

test('showcase settings validate bounded media, schemes, effects and dependencies',()=>{
  assert.equal(settingsPermission('creativeTools'),'system.manage');
  assert.equal(toolEnabled({},'director'),true);
  assert.equal(toolEnabled({creativeTools:{canvas:{enabled:false}}},'director'),false);
  assert.throws(()=>assertToolEnabled({creativeTools:{tryon:{enabled:false}}},'tryon'),/暂未开放/);
  validateToolSettings({tryon:{enabled:true,title:'AI 换装',description:'同一人物，不同服装',order:10,effect:'carousel',intervalMs:3500,fit:'contain',media:[{type:'image',url:'https://example.com/a.webp',label:'造型 A'},{type:'image',url:'/media/tool-previews/tryon.webp'}]}});
  for(const row of [
    {enabled:'true'},{title:'a'.repeat(41)},{description:'b'.repeat(241)},{order:1.5},{intervalMs:100},{effect:'unsupported'},{fit:'stretch'},
    {media:Array(9).fill({type:'image',url:'https://example.com/a.webp'})},
    ...['javascript:alert(1)','data:image/png;base64,abc','http://example.com/a','https://a:b@example.com/x','//example.com/x','/api/reference-assets/own-secret','/media/../api/private','/media/%2e%2e/a'].map(url=>({media:[{type:'image',url}]})),
    {effect:'compare',media:[{type:'image',url:'https://example.com/a'}]},
    {effect:'video',media:[{type:'image',url:'https://example.com/a'}]},
  ])assert.throws(()=>validateToolSettings({tryon:row}));
  assert.throws(()=>validateToolSettings({unknown:{}}));
  const current={...structuredClone(DEFAULT_SETTINGS),systemChannels:[{id:'private',apiKey:'preserved',advancedConfig:{custom:'preserved'}}],logicalModels:[{id:'legacy',custom:'preserved'}]};
  const next=validateSettingsPatch({} as any,current,{creativeTools:{tryon:{enabled:false}}});
  assert.deepEqual(next.systemChannels,current.systemChannels);assert.deepEqual(next.logicalModels,current.logicalModels);
  assert.equal(next.creativeTools.tryon.enabled,false);
});

test('request and generation mapping closes new work without blocking existing reads or saves',()=>{
  assert.deepEqual(requestTools('/api/agent/runs','POST',{surface:'canvas'}),['agent','canvas']);
  assert.deepEqual(requestTools('/api/image-tasks','POST',{context:{tool:'ai-tryon'}}),['tryon']);
  assert.deepEqual(requestTools('/api/teams/:teamId/projects/:projectId/generations','POST',{source:'canvas'}),['canvas']);
  assert.deepEqual(requestTools('/api/drama/projects/:id/production','POST',{}),['drama']);
  for(const route of ['/api/image-tasks/:id','/api/canvas/projects/:projectId/director/:nodeId','/api/agent/runs/:id/cancel']){
    assert.deepEqual(requestTools(route,'GET',{}),[]);assert.deepEqual(requestTools(route,'PUT',{}),[]);
  }
  assert.deepEqual(generationTools({source:'canvas',context:{tool:'director'}}),['canvas','director']);
});

test('showcase settings require admin permissions, preserve unrelated values and reject closed submissions',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});await app.ready();
  t.after(async()=>{await app.close();await fixture.cleanup();});
  const headers:Record<string,Record<string,string>>={};
  for(const [name,role,permissions]of [['owner','admin',['system.manage']],['viewer','admin',['upstream.manage']],['member','user',[]]] as const){
    const id=randomUUID(),token=randomBytes(32).toString('base64url');
    await fixture.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$2,$3,$4,$5::jsonb)',[id,name,'synthetic-unused',role,JSON.stringify(permissions)]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    headers[name]={origin:fixture.config.origin,cookie:`${fixture.config.sessionCookieName}=${token}`};
  }
  const patch={creativeTools:{tryon:{enabled:false,title:'商业换装',effect:'zoom',media:[{type:'image',url:'https://example.com/real.webp'}]},agent:{enabled:false},canvas:{enabled:false},drama:{enabled:false},remix:{enabled:false}}};
  assert.equal((await app.inject({method:'GET',url:'/api/creative-tools'})).statusCode,401);
  for(const name of ['viewer','member'])assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers[name],payload:patch})).statusCode,403);
  const before=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
  const save=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers.owner,payload:patch});assert.equal(save.statusCode,200,save.body);
  const after=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
  const {creativeTools:_,...unchanged}=after;assert.deepEqual(unchanged,before);
  const directory=await app.inject({method:'GET',url:'/api/creative-tools',headers:headers.member});assert.equal(directory.statusCode,200);assert.equal(directory.json().creativeTools.tryon.title,'商业换装');assert.match(directory.headers['cache-control'] as string,/no-store/);
  const session=await app.inject({method:'GET',url:'/api/auth/session',headers:headers.member});assert.equal(session.json().settings.creativeTools.tryon.enabled,false);
  for(const [url,payload]of [
    ['/api/image-tasks',{prompt:'synthetic',context:{tool:'ai-tryon'}}],
    ['/api/image-tasks/quote',{prompt:'synthetic',context:{tool:'ai-tryon'}}],
    ['/api/text-tasks',{messages:[{role:'user',content:'synthetic'}],context:{tool:'image-remix'}}],
    ['/api/agent/runs',{surface:'chat',prompt:'synthetic',clientRequestId:'synthetic'}],
    ['/api/canvas/projects',{title:'synthetic'}],['/api/drama/projects',{title:'synthetic'}],
  ] as const){const response=await app.inject({method:'POST',url,headers:headers.member,payload});assert.equal(response.statusCode,403,response.body);assert.match(response.json().msg,/暂未开放/);}
  assert.equal((await app.inject({method:'GET',url:'/api/canvas/projects',headers:headers.member})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/api/generation-logs',headers:headers.member})).statusCode,200);
  assert.equal(Number((await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count),0);
  const audit=(await fixture.db.query("SELECT metadata FROM oaooao_audit_logs WHERE action='settings.update'")).rows;
  assert.ok(audit.length>=1);
  assert.equal((await app.inject({method:'POST',url:'/api/admin/creative-tools/media',headers:headers.member})).statusCode,403);
  const multipart=(type:string,bytes:Buffer)=>Buffer.concat([Buffer.from(`--synthetic-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture"\r\nContent-Type: ${type}\r\n\r\n`),bytes,Buffer.from('\r\n--synthetic-boundary--\r\n')]);
  for(const [type,bytes,status]of [['image/svg+xml',Buffer.from('<svg/>'),415],['image/png',Buffer.from([137,80,78,71,13,10,26,10]),503]] as const){
    const response=await app.inject({method:'POST',url:'/api/admin/creative-tools/media',headers:{...headers.owner,'content-type':'multipart/form-data; boundary=synthetic-boundary'},payload:multipart(type,bytes)});assert.equal(response.statusCode,status,response.body);
  }
  assert.equal(Number((await fixture.db.query("SELECT count(*) FROM oaooao_settings WHERE id LIKE 'tool-showcase-media:%'")).rows[0].count),0);
  assert.equal((await app.inject({method:'GET',url:`/api/creative-tools/media/${randomUUID()}`,headers:headers.member})).statusCode,403);
});
