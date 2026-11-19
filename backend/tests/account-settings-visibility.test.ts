import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken, ADMIN_PERMISSIONS } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';

test('menu flags are authenticated, independent, default compatible and writable only by system managers', async t => {
  const f=await createTestDatabase(), app=await buildApp({db:f.db,config:f.config});
  t.after(async()=>{await app.close();await f.cleanup();});
  const users=[];
  for(const permissions of [ADMIN_PERMISSIONS,['commerce.manage'],[]]){
    const id=randomUUID(),token=randomBytes(32).toString('base64url');
    await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused',$2,$3)",[id,permissions.length?'admin':'user',JSON.stringify(permissions)]);
    await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    users.push({id,headers:{origin:f.config.origin,cookie:`${f.config.sessionCookieName}=${token}`}});
  }
  const [admin,commerce,user]=users, url='/api/account/settings-visibility';
  assert.equal((await app.inject({url})).statusCode,401);
  const read=async()=>{const r=await app.inject({url,headers:user.headers});assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'private, no-store');return r.json();};
  assert.deepEqual(await read(),{visibility:{watermark:true,adultContent:true}});
  const save=(payload:Record<string,unknown>,headers=admin.headers)=>app.inject({url:'/api/admin/settings',method:'PATCH',headers,payload});
  const hidden={accountMenu:{adultContentSettingsVisible:false}};
  assert.equal((await save(hidden,user.headers)).statusCode,403);
  assert.equal((await save(hidden,commerce.headers)).statusCode,403);
  for(const accountMenu of [{adultContentSettingsVisible:'false'},{adultContentSettingsVisible:0},{adultContentSettingsVisible:false,unknown:true}])assert.equal((await save({accountMenu})).statusCode,400);
  assert.equal((await save(hidden)).statusCode,200);
  assert.deepEqual(await read(),{visibility:{watermark:true,adultContent:false}});
  const preference=await app.inject({url:'/api/account/content-preference',headers:user.headers});assert.equal(preference.statusCode,200);assert.equal(preference.json().adultContent.enabled,false);
  assert.equal((await save({watermarkPolicy:{enabled:false}})).statusCode,200);
  assert.deepEqual(await read(),{visibility:{watermark:false,adultContent:false}});
  assert.equal((await save({accountMenu:{adultContentSettingsVisible:true}})).statusCode,200);
  assert.deepEqual(await read(),{visibility:{watermark:false,adultContent:true}});
  const settings=(await app.inject({url:'/api/admin/settings',headers:admin.headers})).json().settings;
  assert.equal(settings.watermarkPolicy.enabled,false);assert.equal(settings.watermarkPolicy.confirmationRequired,true);assert.equal(settings.accountMenu.adultContentSettingsVisible,true);
  assert.equal((await f.db.query("SELECT count(*) FROM oaooao_audit_logs WHERE action='settings.update'")).rows[0].count,'3');
});
