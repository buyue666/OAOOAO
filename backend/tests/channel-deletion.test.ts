import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {buildApp} from '../src/app.js';
import {createContext,hashToken,type AppConfig} from '../src/core.js';
import {DEFAULT_SETTINGS,sanitizedSettings,validateSettingsPatch} from '../src/settings.js';
import {createTestDatabase} from './core-helpers.js';

const ctx=createContext({} as Pool,{encryptionKey:randomBytes(32).toString('base64')} as AppConfig);
const channels=[
  {id:'remove',name:'待删除渠道',baseUrl:'https://remove.example.invalid/v1',models:['image'],enabled:true,apiKey:'synthetic-remove-key'},
  {id:'keep',name:'保留渠道',baseUrl:'https://keep.example.invalid/v1',models:['image','text'],enabled:true,apiKey:'synthetic-keep-key',webhookSecret:'synthetic-hook',advancedConfig:{protocol:'openai'}},
];
const binding=(id:string,channelId:string)=>({id,channelId,upstreamModel:'image',enabled:true,priority:1});
function fixtureSettings(){
  return validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{
    systemChannels:channels,
    logicalModels:[
      {id:'shared',name:'多渠道模型',capability:'image',enabled:true,aliases:['image-alias'],bindings:[binding('primary','remove'),{...binding('fallback','keep'),priority:2,capabilityProfile:{outputResolutions:['2K'],imageQualities:['high']}}]},
      {id:'single',name:'单渠道模型',capability:'image',enabled:true,bindings:[binding('single-binding','remove')]},
      {id:'unrelated',name:'其他模型',capability:'text',enabled:true,bindings:[binding('text-binding','keep')]},
    ],
    defaultModels:{imageModel:'shared',textModel:'unrelated'},
    modelPointCosts:{shared:2,single:3,unrelated:1},
  });
}

test('channel-only deletion removes its bindings and preserves other channels, secrets and model settings',()=>{
  const current=fixtureSettings(),before=structuredClone(current);
  const next=validateSettingsPatch(ctx,current,{systemChannels:sanitizedSettings(current).systemChannels.filter((c:any)=>c.id!=='remove')});
  assert.deepEqual(next.systemChannels,[current.systemChannels[1]]);
  assert.deepEqual(next.logicalModels[0],{...current.logicalModels[0],bindings:[current.logicalModels[0].bindings[1]]});
  assert.deepEqual(next.logicalModels[1],{...current.logicalModels[1],bindings:[],enabled:false,availabilityDisabled:true});
  assert.deepEqual(next.logicalModels[2],current.logicalModels[2]);
  assert.deepEqual(next.defaultModels,current.defaultModels);
  assert.deepEqual(next.modelPointCosts,current.modelPointCosts);
  assert.equal(ctx.decrypt(next.systemChannels[0].apiKey),'synthetic-keep-key');
  assert.equal(ctx.decrypt(next.systemChannels[0].webhookSecret),'synthetic-hook');
  assert.deepEqual(current,before,'validation must not mutate the current settings');
});

test('deleting the last channel disables models and clears unavailable defaults without deleting definitions',()=>{
  const current=fixtureSettings();
  const next=validateSettingsPatch(ctx,current,{systemChannels:[]});
  assert.deepEqual(next.systemChannels,[]);
  assert.equal(next.logicalModels.length,current.logicalModels.length);
  assert.ok(next.logicalModels.every((m:any)=>m.bindings.length===0));
  assert.ok(next.logicalModels.every((m:any)=>!m.enabled));
  assert.equal(next.defaultModels.imageModel,'');assert.equal(next.defaultModels.textModel,'');
  assert.deepEqual(validateSettingsPatch(ctx,next,{systemChannels:[]}),next);
});

test('disabling and editing a channel preserve its model bindings',()=>{
  const current=fixtureSettings();
  const next=validateSettingsPatch(ctx,current,{systemChannels:sanitizedSettings(current).systemChannels.map((c:any)=>({...c,enabled:false,name:c.name+'修改'}))});
  assert.deepEqual(next.logicalModels.map((m:any)=>m.bindings),current.logicalModels.map((m:any)=>m.bindings));
  assert.ok(next.logicalModels.every((m:any)=>!m.enabled));
});

test('explicit routing writes still reject missing channels with a Chinese error',()=>{
  const current=fixtureSettings(),before=structuredClone(current);
  for(const patch of [
    {logicalModels:[{...current.logicalModels[0],bindings:[binding('missing','unknown')]}]},
    {systemChannels:[],logicalModels:current.logicalModels},
  ])assert.throws(()=>validateSettingsPatch(ctx,current,patch),/模型绑定引用的渠道不存在/);
  assert.deepEqual(current,before);
  assert.doesNotThrow(()=>validateSettingsPatch(ctx,current,{systemChannels:[],logicalModels:current.logicalModels.map((m:any)=>({...m,bindings:[]}))}));
});

test('deletion does not silently repair unrelated dangling bindings',()=>{
  const current=fixtureSettings();
  current.logicalModels[0].bindings.push(binding('bad-legacy-binding','unknown'));
  assert.throws(()=>validateSettingsPatch(ctx,current,{systemChannels:sanitizedSettings(current).systemChannels.filter((c:any)=>c.id!=='remove')}),/模型绑定引用的渠道不存在/);
});

test('a failed deletion leaves original channels and bindings intact',()=>{
  const current=fixtureSettings(),before=structuredClone(current);
  assert.throws(()=>validateSettingsPatch(ctx,current,{systemChannels:[],defaultModels:{imageModel:'unknown'}}),/Default model/);
  assert.deepEqual(current,before);
});

test('channel deletion persists atomically through the admin API with upstream permission and leaves history untouched',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  t.after(async()=>{await app.close();await fixture.cleanup();});
  const token=randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES('channel-admin','channel-admin','synthetic-unused','admin',$1)",[JSON.stringify(['upstream.manage'])]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,'channel-admin',now()+interval '1 hour')",[hashToken(token)]);
  const headers={cookie:`oaooao_session=${token}`,origin:fixture.config.origin};
  const api=(payload:any)=>app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload});
  const config=fixtureSettings();
  const seed=await api({...config,systemChannels:channels});
  // An upstream-only admin must not have to write unrelated system settings.
  assert.equal(seed.statusCode,403);
  const saved=await api({systemChannels:channels,logicalModels:config.logicalModels,defaultModels:config.defaultModels,modelPointCosts:config.modelPointCosts});
  assert.equal(saved.statusCode,200,saved.body);
  await fixture.db.query("INSERT INTO oaooao_generation_history(id,user_id,document,created_at) VALUES('history','channel-admin',$1,now())",[{channelId:'remove',model:'single',prompt:'Synthetic historical generation'}]);
  await fixture.db.query("INSERT INTO oaooao_generation_jobs(id,user_id,kind,client_request_id,input_hash,input,model,channel_id,cost,status,phase) VALUES('job','channel-admin','image','synthetic-request','synthetic-hash','{}','single','remove',0,'success','complete')");
  const baseline=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
  const history=(await fixture.db.query('SELECT * FROM oaooao_generation_history')).rows;
  const jobs=(await fixture.db.query('SELECT * FROM oaooao_generation_jobs')).rows;
  const patch={systemChannels:saved.json().settings.systemChannels.filter((c:any)=>c.id!=='remove')};
  assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers:{origin:fixture.config.origin},payload:patch})).statusCode,401);
  const removed=await api(patch);
  assert.equal(removed.statusCode,200,removed.body);
  const persisted=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
  assert.deepEqual(persisted.systemChannels,[baseline.systemChannels[1]]);
  assert.deepEqual(persisted.logicalModels[0],{...baseline.logicalModels[0],bindings:[baseline.logicalModels[0].bindings[1]]});
  assert.deepEqual(persisted.logicalModels[1],{...baseline.logicalModels[1],bindings:[],enabled:false,availabilityDisabled:true});
  assert.deepEqual(persisted.logicalModels[2],baseline.logicalModels[2]);
  assert.deepEqual(persisted.defaultModels,baseline.defaultModels);
  assert.deepEqual(persisted.modelPointCosts,baseline.modelPointCosts);
  assert.deepEqual((await fixture.db.query('SELECT * FROM oaooao_generation_history')).rows,history);
  assert.deepEqual((await fixture.db.query('SELECT * FROM oaooao_generation_jobs')).rows,jobs);
  assert.equal(removed.json().settings.systemChannels[0].apiKey,'');
  assert.equal(removed.json().settings.systemChannels[0].hasApiKey,true);
  const invalid=await api({logicalModels:[{...persisted.logicalModels[0],bindings:[binding('invalid','remove')]}]});
  assert.equal(invalid.statusCode,400,invalid.body);
  assert.match(invalid.body,/模型绑定引用的渠道不存在/);
  assert.deepEqual((await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value,persisted);
  assert.equal((await api(patch)).statusCode,200);
  const read=await app.inject({url:'/api/admin/settings',headers});
  assert.deepEqual(read.json().settings.logicalModels,persisted.logicalModels);
});
