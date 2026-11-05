import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {createTestDatabase} from './core-helpers.js';

test('public model notes save, reload, reject invalid data atomically and can be cleared',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});
  t.after(async()=>{await app.close();await fixture.cleanup();});
  const token=randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES('note-admin','note-admin','synthetic-unused','admin',$1)",[JSON.stringify(['upstream.manage'])]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,'note-admin',now()+interval '1 hour')",[hashToken(token)]);
  const headers={cookie:`oaooao_session=${token}`,origin:fixture.config.origin};
  const note='<b>普通模型</b>\n参考图片';
  const model={id:'noted-model',name:'Synthetic noted model',capability:'image',enabled:true,note:'  '+note+'  ',bindings:[{id:'note-route',channelId:'note-channel',upstreamModel:'synthetic-image',requestAlias:'note-entry',enabled:true,priority:1}]};
  const saved=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{systemChannels:[{id:'note-channel',name:'Synthetic',baseUrl:'https://notes.example.invalid/v1',apiFormat:'openai',enabled:true,apiKey:'synthetic-key',models:['synthetic-image']}],logicalModels:[model],modelPointCosts:{'synthetic-image':3}}});
  assert.equal(saved.statusCode,200,saved.body);
  const session=async()=> (await app.inject({method:'GET',url:'/api/auth/session'})).json().settings;
  let catalog=await session();assert.equal(catalog.logicalModels[0].note,note);assert.equal(catalog.logicalModels[0].bindings[0].requestAlias,'note-entry');
  const admin=await app.inject({method:'GET',url:'/api/admin/settings',headers});assert.equal(admin.statusCode,200);assert.equal(admin.json().settings.logicalModels[0].note,note);
  const before=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
  for(const invalid of [123,{},'x'.repeat(2001)]){
    const response=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{logicalModels:[{...model,note:invalid}]}});
    assert.equal(response.statusCode,400,response.body);assert.match(response.body,/模型备注/);
    assert.deepEqual((await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value,before);
  }
  const cleared=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{logicalModels:[{...model,note:' \n '}]}});assert.equal(cleared.statusCode,200,cleared.body);
  catalog=await session();assert.equal(catalog.logicalModels[0].note,undefined);assert.equal(catalog.logicalModels[0].enabled,true);
  assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count,'0');
});
