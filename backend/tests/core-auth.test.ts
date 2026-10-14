import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,pbkdf2Sync} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {buildApp} from '../src/app.js';
import {ADMIN_PERMISSIONS,codeHash} from '../src/core.js';
import {createTestDatabase,testDatabaseUrl} from './core-helpers.js';

const available=Boolean(await testDatabaseUrl());
test('real PostgreSQL: auth, opaque sessions, CSRF, granular settings, last administrator and password revocation',{skip:!available},async()=>{
  const fixture=await createTestDatabase();const app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    const adminId=randomUUID(),limitedId=randomUUID(),passwordHash=await bcrypt.hash('synthetic-password-123',12);
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,'fixture_admin',$3,'admin',$4::jsonb),($2,'fixture_limited',$3,'admin','[\"users.read\",\"users.manage\",\"upstream.manage\"]')",[adminId,limitedId,passwordHash,JSON.stringify(ADMIN_PERMISSIONS)]);
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:fixture.config.origin},payload:{username:'fixture_admin',password:'synthetic-password-123'}});assert.equal(login.statusCode,200,login.body);
    const cookie=login.cookies[0].name+'='+login.cookies[0].value;assert.equal(login.cookies[0].httpOnly,true);
    const stored=await fixture.db.query('SELECT token_hash FROM oaooao_sessions');assert.notEqual(stored.rows[0].token_hash,login.cookies[0].value);assert.equal(stored.rows[0].token_hash.length,64);
    const crossSite=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:{cookie,origin:'https://attacker.example'},payload:{registrationEnabled:true}});assert.equal(crossSite.statusCode,403);
    const noOrigin=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:{cookie},payload:{registrationEnabled:true}});assert.equal(noOrigin.statusCode,403);
    const headers={cookie,origin:fixture.config.origin};
    const saved=await app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{registrationEnabled:true,systemChannels:[{id:'test-channel',name:'Synthetic',baseUrl:'https://api.example.com/v1',models:['test-model'],enabled:true,apiKey:'synthetic-provider-secret'}],mail:{password:'synthetic-mail-secret'}}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().settings.systemChannels[0].apiKey,'');
    const movedCatalog=await app.inject({method:'POST',url:'/api/admin/models',headers,payload:{channelId:'test-channel',baseUrl:'https://different.example.invalid/v1'}});assert.equal(movedCatalog.statusCode,400);assert.match(movedCatalog.json().msg,/different provider origin/);
    const storage={enabled:true,endpoint:'https://storage.original.example.invalid',region:'us-east-1',bucket:'fixture-bucket',prefix:'fixture',forcePathStyle:true,accessKeyId:'synthetic-id',secretAccessKey:'synthetic-secret'};
    const savedStorage=await app.inject({method:'PATCH',url:'/api/admin/object-storage',headers,payload:storage});assert.equal(savedStorage.statusCode,200,savedStorage.body);assert.ok(!savedStorage.body.includes('synthetic-secret'));
    const movedStorage=await app.inject({method:'PATCH',url:'/api/admin/object-storage',headers,payload:{...storage,endpoint:'https://storage.changed.example.invalid',accessKeyId:'',secretAccessKey:''}});assert.equal(movedStorage.statusCode,400);assert.match(movedStorage.json().msg,/new access key/);
    const removedStorageOrigin=await app.inject({method:'PATCH',url:'/api/admin/object-storage',headers,payload:{...storage,enabled:false,endpoint:'',accessKeyId:'',secretAccessKey:''}});assert.equal(removedStorageOrigin.statusCode,400);
    const session=await app.inject({url:'/api/auth/session',headers:{cookie}});assert.equal(session.statusCode,200);assert.equal(session.json().user.id,adminId);assert.ok(!session.body.includes('synthetic-provider-secret'));assert.ok(!session.body.includes('enc:v1:'));assert.ok(!session.body.includes('password_hash'));
    const limited=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:fixture.config.origin},payload:{username:'fixture_limited',password:'synthetic-password-123'}});const limitedCookie=limited.cookies[0].name+'='+limited.cookies[0].value;
    const forbidden=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:{cookie:limitedCookie,origin:fixture.config.origin},payload:{registrationEnabled:false}});assert.equal(forbidden.statusCode,403);
    const escalation=await app.inject({method:'PATCH',url:`/api/admin/users/${limitedId}`,headers:{cookie:limitedCookie,origin:fixture.config.origin},payload:{adminPermissions:ADMIN_PERMISSIONS}});assert.equal(escalation.statusCode,403);
    const createdByLimited=await app.inject({method:'POST',url:'/api/admin/users',headers:{cookie:limitedCookie,origin:fixture.config.origin},payload:{username:'managed_fixture_user',password:'synthetic-password-123',role:'user',adminPermissions:[]}});assert.equal(createdByLimited.statusCode,200,createdByLimited.body);assert.equal(createdByLimited.json().user.role,'user');
    const lastAdmin=await app.inject({method:'PATCH',url:`/api/admin/users/${adminId}`,headers,payload:{status:'disabled'}});assert.equal(lastAdmin.statusCode,409);
    const register=await app.inject({method:'POST',url:'/api/auth/register',headers:{origin:fixture.config.origin},payload:{username:'new_fixture_user',password:'synthetic-password-456',policyAccepted:true}});assert.equal(register.statusCode,200,register.body);assert.equal(register.json().user.role,'user');const userCookie=register.cookies[0].name+'='+register.cookies[0].value;
    const forbiddenUsers=await app.inject({url:'/api/admin/users',headers:{cookie:userCookie}});assert.equal(forbiddenUsers.statusCode,403);
    const profileUpdates=await Promise.all([app.inject({method:'PATCH',url:'/api/auth/profile',headers:{cookie:userCookie,origin:fixture.config.origin},payload:{displayName:'Updated fixture'}}),app.inject({method:'PATCH',url:'/api/auth/profile',headers:{cookie:userCookie,origin:fixture.config.origin},payload:{bio:'Synthetic fixture biography'}})]);assert.ok(profileUpdates.every(result=>result.statusCode===200));
    const profile=await app.inject({url:'/api/auth/session',headers:{cookie:userCookie}});assert.equal(profile.json().user.displayName,'Updated fixture');assert.equal(profile.json().user.bio,'Synthetic fixture biography');
    const changed=await app.inject({method:'PATCH',url:'/api/auth/password',headers:{cookie:userCookie,origin:fixture.config.origin},payload:{currentPassword:'synthetic-password-456',newPassword:'synthetic-password-789'}});assert.equal(changed.statusCode,200,changed.body);
    const expired=await app.inject({url:'/api/auth/session',headers:{cookie:userCookie}});assert.equal(expired.json().user,null);
    const logs=await fixture.db.query("SELECT count(*) FROM oaooao_audit_logs WHERE action='settings.update'");assert.equal(Number(logs.rows[0].count),1);
    const beforeTransfer=await app.inject({url:'/api/admin/launch-readiness?profile=production',headers:{cookie}});assert.equal(beforeTransfer.statusCode,200,beforeTransfer.body);assert.equal(beforeTransfer.json().data.items.find((item:any)=>item.id==='migration').level,'error');
    await fixture.db.query("INSERT INTO oaooao_transfer_runs(id,source_digest,payload_digest,captured_at,summary) VALUES($1,$2,$2,now(),'{}')",['synthetic-attestation', 'a'.repeat(64)]);
    const afterTransfer=await app.inject({url:'/api/admin/launch-readiness?profile=production',headers:{cookie}});assert.equal(afterTransfer.statusCode,200,afterTransfer.body);assert.equal(afterTransfer.json().data.items.find((item:any)=>item.id==='migration').level,'ok');assert.equal(afterTransfer.json().data.items.find((item:any)=>item.id==='payments').level,'error');
  }finally{await app.close();await fixture.cleanup();}
});
test('real PostgreSQL: email code verification is one use, scoped to purpose and current user',{skip:!available},async()=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    await fixture.db.query("UPDATE oaooao_settings SET value='{\"registrationEnabled\":true,\"emailRegistrationEnabled\":true}' WHERE id='global'");
    const email='synthetic@example.invalid',code='123456';await fixture.db.query("INSERT INTO oaooao_email_codes(id,email,purpose,code_hash,sent_at,expires_at) VALUES($1,$2,'register',$3,now(),now()+interval '10 minutes')",[randomUUID(),email,codeHash(app.ctx,`${email}:register:${code}`)]);
    const request={method:'POST' as const,url:'/api/auth/register',headers:{origin:fixture.config.origin},payload:{username:'verified_fixture',email,emailCode:code,password:'synthetic-password-123',policyAccepted:true}};
    const responses=await Promise.all([app.inject(request),app.inject({...request,payload:{...request.payload,username:'other_fixture'}})]);assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,400]);
    const rows=await fixture.db.query('SELECT email_verified FROM oaooao_users');assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].email_verified,true);
  }finally{await app.close();await fixture.cleanup();}
});
test('real PostgreSQL: imported PBKDF2 accounts sign in without hash rewriting',{skip:!available},async()=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    const password='界'.repeat(30),salt='syntheticSalt22chars12',id=randomUUID();assert.equal(salt.length,22);
    const hash=`pbkdf2_sha256$210000$${salt}$${pbkdf2Sync(password,salt,210000,32,'sha256').toString('base64url')}`;
    await fixture.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$2,$3)',[id,'pbkdf2_fixture',hash]);
    const reply=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:fixture.config.origin},payload:{username:'pbkdf2_fixture',password}});
    assert.equal(reply.statusCode,200,reply.body);assert.equal(reply.json().user.id,id);
    const saved=await fixture.db.query('SELECT password_hash FROM oaooao_users WHERE id=$1',[id]);assert.equal(saved.rows[0].password_hash,hash);
    const wrong=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:fixture.config.origin},payload:{username:'pbkdf2_fixture',password:'wrong-password'}});assert.equal(wrong.statusCode,401);
  }finally{await app.close();await fixture.cleanup();}
});

