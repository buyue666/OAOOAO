import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {HTTPMethods} from 'fastify';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {migrate} from '../src/migrate.js';
import {createTestDatabase} from './core-helpers.js';

const migration='008-announcement-action-url.sql';
const input={title:'合成跳转公告',content:'仅用于隔离数据库验收。',enabled:true,popupHome:true,popupAfterLogin:false};

test('action URL migration preserves historical rows, prior migration checksums and old SQL inserts',async t=>{
  const fixture=await createTestDatabase();
  t.after(()=>fixture.cleanup());
  assert.match(fixture.schema,/^test_[a-f0-9]{32}$/);
  await fixture.db.query('ALTER TABLE oaooao_announcements DROP COLUMN action_url');
  await fixture.db.query('DELETE FROM oaooao_migrations WHERE name=$1',[migration]);
  const oldMigrations=(await fixture.db.query('SELECT name,checksum FROM oaooao_migrations ORDER BY name')).rows;
  assert.equal(oldMigrations.filter(row=>row.name<'008-').length,7);
  await fixture.db.query(`INSERT INTO oaooao_announcements(id,title,content,enabled,popup_home,popup_after_login,starts_at,ends_at,banner_tone,banner_effect,created_at,updated_at)
    VALUES('historic-action-active','历史有效公告','保留原文',true,true,false,NULL,NULL,'rose','shimmer','2020-01-01T00:00:00Z','2020-01-02T00:00:00Z'),
    ('historic-action-expired','历史过期公告','不得恢复',true,true,true,NULL,'2000-01-01T00:00:00Z','promo','glow','1999-01-01T00:00:00Z','2000-01-01T00:00:00Z')`);
  const before=(await fixture.db.query('SELECT to_jsonb(a) AS row FROM oaooao_announcements a ORDER BY id')).rows;
  await migrate(fixture.db);
  await migrate(fixture.db);
  assert.deepEqual((await fixture.db.query("SELECT to_jsonb(a)-'action_url' AS row FROM oaooao_announcements a ORDER BY id")).rows,before);
  assert.ok((await fixture.db.query('SELECT action_url FROM oaooao_announcements')).rows.every(row=>row.action_url===null));
  assert.deepEqual((await fixture.db.query('SELECT name,checksum FROM oaooao_migrations WHERE name<>$1 ORDER BY name',[migration])).rows,oldMigrations);
  const oldInsert=await fixture.db.query("INSERT INTO oaooao_announcements(id,title,content,banner_tone,banner_effect) VALUES('old-action-client','旧客户端','省略新列','info','none') RETURNING action_url");
  assert.equal(oldInsert.rows[0].action_url,null);
  for(const invalid of ['', 'x'.repeat(2049)])await assert.rejects(fixture.db.query("UPDATE oaooao_announcements SET action_url=$1 WHERE id='old-action-client'",[invalid]),{code:'23514'});
  const app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    const response=await app.inject({url:'/api/announcements'});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(response.json().announcements.map((item:{id:string})=>item.id),['historic-action-active']);
    assert.equal(response.json().announcements[0].actionUrl,undefined);
  }finally{await app.close();}
});

test('announcement action URLs validate and persist through authorized API updates',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  t.after(async()=>{await app.close();await fixture.cleanup();});
  let sequence=0;
  async function actor(role:string,permissions:string[]){
    const id=`synthetic-action-${++sequence}`,token=randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused',$2,$3)",[id,role,JSON.stringify(permissions)]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    return token;
  }
  const content=await actor('admin',['content.manage']),system=await actor('admin',['system.manage']),ordinary=await actor('user',[]);
  async function api(method:HTTPMethods,url:string,payload?:object,token=content){
    const response=await app.inject({method,url,payload,headers:{origin:fixture.config.origin,...(token?{cookie:`${fixture.config.sessionCookieName}=${token}`}:{})}});
    return {status:response.statusCode,body:response.json()};
  }
  let id='';
  const current=async()=>(await fixture.db.query('SELECT * FROM oaooao_announcements WHERE id=$1',[id])).rows[0];
  await t.test('old clients create without a link and linked creation returns the trimmed persisted URL',async()=>{
    for(const actionUrl of [undefined,null,'','   ']){
      const response=await api('POST','/api/admin/announcements',{...input,...(actionUrl===undefined?{}:{actionUrl})});
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.equal(response.body.announcement.actionUrl,undefined);
      assert.equal((await fixture.db.query('SELECT action_url FROM oaooao_announcements WHERE id=$1',[response.body.announcement.id])).rows[0].action_url,null);
    }
    const response=await api('POST','/api/admin/announcements',{...input,actionUrl:'  /plans?from=announcement#monthly  ',bannerTone:'violet',bannerEffect:'shimmer'});
    assert.equal(response.status,200,JSON.stringify(response.body));
    id=response.body.announcement.id;
    assert.equal(response.body.announcement.actionUrl,'/plans?from=announcement#monthly');
    assert.equal((await current()).action_url,'/plans?from=announcement#monthly');
  });
  await t.test('safe paths and complete HTTP URLs survive database, admin and public reads',async()=>{
    const targets=['/','/studio','/创作?keyword=场景#素材','/plans?next=%2Fstudio','https://example.com/offers?from=oao#learn','http://example.com:8080/offer','HTTPS://example.com/Case','https://例子.测试/活动','https://[2001:db8::1]/offers','/'+ 'a'.repeat(2047)];
    for(const actionUrl of targets){
      const response=await api('PATCH',`/api/admin/announcements/${id}`,{actionUrl});
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.equal(response.body.announcement.actionUrl,actionUrl);
      assert.equal((await current()).action_url,actionUrl);
      const admin=(await api('GET','/api/admin/announcements')).body.announcements.find((item:{id:string})=>item.id===id);
      const visible=(await api('GET','/api/announcements',undefined,'')).body.announcements.find((item:{id:string})=>item.id===id);
      assert.equal(admin.actionUrl,actionUrl);assert.equal(visible.actionUrl,actionUrl);
    }
  });
  await t.test('omitted URL preserves the saved link, styles and schedule; empty and null explicitly clear it',async()=>{
    await api('PATCH',`/api/admin/announcements/${id}`,{actionUrl:'/plans',endsAt:'2100-01-01T00:00:00Z'});
    const changed=await api('PATCH',`/api/admin/announcements/${id}`,{content:'只更新内容'});
    assert.equal(changed.status,200);
    assert.equal(changed.body.announcement.actionUrl,'/plans');
    assert.equal(changed.body.announcement.bannerTone,'violet');assert.equal(changed.body.announcement.bannerEffect,'shimmer');
    assert.equal(changed.body.announcement.endsAt,'2100-01-01T00:00:00.000Z');
    for(const actionUrl of ['',null,'   ']){
      await api('PATCH',`/api/admin/announcements/${id}`,{actionUrl:'/plans'});
      const cleared=await api('PATCH',`/api/admin/announcements/${id}`,{actionUrl});
      assert.equal(cleared.status,200);assert.equal(cleared.body.announcement.actionUrl,undefined);
      assert.equal((await current()).action_url,null);
      assert.equal((await api('GET','/api/announcements',undefined,'')).body.announcements.find((item:{id:string})=>item.id===id).actionUrl,undefined);
    }
  });
  await t.test('unsafe, incomplete and overlong targets return 400 without modifying content, rows or audit logs',async()=>{
    const before=await current(),count=(await fixture.db.query('SELECT count(*) FROM oaooao_announcements')).rows[0].count;
    const audits=(await fixture.db.query('SELECT count(*) FROM oaooao_audit_logs')).rows[0].count;
    const invalid:unknown[]=['//example.com','///example.com','/\\example.com','https://example.com\\@evil.test','/path\nmore','/path\rmore','/path\tmore','\thttps://example.com','/path\u0000more','/path\u007fmore','/path\u0085more','javascript:alert(1)','data:text/html,test','file:///tmp/example','mailto:help@example.com','ftp://example.com','https:example.com','https:/example.com','https:///example.com','http:////example.com','https://','relative/path','#section','https://user@example.com','https://user:secret@example.com','https://@example.com','https://:secret@example.com','/'+'a'.repeat(2048),'https://example.com/'+'字'.repeat(300),42,true,{},[]];
    for(const actionUrl of invalid){
      assert.equal((await api('POST','/api/admin/announcements',{...input,actionUrl})).status,400,JSON.stringify(actionUrl));
      assert.equal((await api('PATCH',`/api/admin/announcements/${id}`,{content:'不得保存',actionUrl})).status,400,JSON.stringify(actionUrl));
    }
    assert.deepEqual(await current(),before);
    assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_announcements')).rows[0].count,count);
    assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_audit_logs')).rows[0].count,audits);
  });
  await t.test('link changes require content permission and preserve the existing audit actions',async()=>{
    const before=await current();
    for(const [method,url,payload] of [['GET','/api/admin/announcements',undefined],['POST','/api/admin/announcements',{...input,actionUrl:'/plans'}],['PATCH',`/api/admin/announcements/${id}`,{actionUrl:'/plans'}],['DELETE',`/api/admin/announcements/${id}`,undefined]] as const){
      assert.equal((await api(method,url,payload,'')).status,401);
      assert.equal((await api(method,url,payload,ordinary)).status,403);
      assert.equal((await api(method,url,payload,system)).status,403);
    }
    assert.deepEqual(await current(),before);
    const saved=await api('PATCH',`/api/admin/announcements/${id}`,{actionUrl:'/plans'});
    assert.equal(saved.status,200);
    const audits=(await fixture.db.query("SELECT action,target_type,target_id,actor_id,status FROM oaooao_audit_logs WHERE target_id=$1 ORDER BY created_at",[id])).rows;
    assert.equal(audits[0].action,'announcement.create');
    assert.equal(audits.at(-1)?.action,'announcement.update');
    assert.ok(audits.every(row=>row.target_type==='announcement'&&row.target_id===id&&row.actor_id==='synthetic-action-1'&&row.status==='success'));
  });
  await t.test('editing a link does not revive expired announcements',async()=>{
    const response=await api('PATCH',`/api/admin/announcements/${id}`,{endsAt:'2000-01-01T00:00:00Z',actionUrl:'/plans'});
    assert.equal(response.status,200);
    assert.equal((await api('PATCH',`/api/admin/announcements/${id}`,{actionUrl:'/studio'})).status,200);
    assert.equal((await current()).action_url,'/studio');
    assert.ok(!(await api('GET','/api/announcements',undefined,'')).body.announcements.some((item:{id:string})=>item.id===id));
  });
});
