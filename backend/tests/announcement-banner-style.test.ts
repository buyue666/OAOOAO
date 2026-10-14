import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {HTTPMethods} from 'fastify';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {migrate} from '../src/migrate.js';
import {createTestDatabase} from './core-helpers.js';

const tones=['promo','info','warning','violet','rose','slate'];
const effects=['none','glow','shimmer'];
const input={title:'合成公告',content:'本公告仅用于隔离测试。',enabled:true,popupHome:true,popupAfterLogin:false};

test('banner migration preserves historical content, flags, timestamps and inactive schedules',async t=>{
  const fixture=await createTestDatabase();
  t.after(()=>fixture.cleanup());
  // Recreate the previous revision only inside this newly created disposable test schema.
  assert.match(fixture.schema,/^test_[a-f0-9]{32}$/);
  await fixture.db.query('ALTER TABLE oaooao_announcements DROP COLUMN banner_tone, DROP COLUMN banner_effect');
  await fixture.db.query("DELETE FROM oaooao_migrations WHERE name='007-announcement-banner-style.sql'");
  await fixture.db.query(`INSERT INTO oaooao_announcements(id,title,content,enabled,popup_home,popup_after_login,starts_at,ends_at,created_at,updated_at)
    VALUES ('historic-active','历史有效合成公告','保留原文与换行\n第二行',true,true,false,NULL,NULL,'2020-01-01T08:12:13.123456+08:00','2020-01-02T08:12:13.654321+08:00'),
    ('historic-expired','历史过期合成公告','不延长有效期',true,true,true,'1999-01-01T00:00:00Z','2000-01-01T00:00:00Z','1999-01-01T00:00:00Z','2000-01-01T00:00:00Z'),
    ('historic-future','历史未来合成公告','不提前展示',true,true,false,'2100-01-01T00:00:00Z',NULL,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'),
    ('historic-disabled','历史关闭合成公告','不自动发布',false,true,false,NULL,NULL,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`);
  const preservedColumns='id,title,content,enabled,popup_home,popup_after_login,starts_at::text,ends_at::text,created_at::text,updated_at::text';
  const before=(await fixture.db.query(`SELECT ${preservedColumns} FROM oaooao_announcements ORDER BY id`)).rows;
  await migrate(fixture.db);
  await migrate(fixture.db);
  assert.deepEqual((await fixture.db.query(`SELECT ${preservedColumns} FROM oaooao_announcements ORDER BY id`)).rows,before);
  assert.ok((await fixture.db.query('SELECT banner_tone,banner_effect FROM oaooao_announcements')).rows.every(row=>row.banner_tone==='promo'&&row.banner_effect==='glow'));
  assert.equal((await fixture.db.query("SELECT count(*) FROM oaooao_migrations WHERE name='007-announcement-banner-style.sql'")).rows[0].count,'1');
  const oldInsert=await fixture.db.query("INSERT INTO oaooao_announcements(id,title,content,enabled,popup_home,popup_after_login,starts_at,ends_at) VALUES('old-sql-client','旧版合成写入','SQL未包含样式列',false,true,false,NULL,NULL) RETURNING banner_tone,banner_effect");
  assert.deepEqual(oldInsert.rows[0],{banner_tone:'promo',banner_effect:'glow'});
  for(const [column,value,code] of [['banner_tone','custom-css','23514'],['banner_effect','flash','23514'],['banner_tone',null,'23502'],['banner_effect',null,'23502']] as const){
    await assert.rejects(fixture.db.query(`UPDATE oaooao_announcements SET ${column}=$1 WHERE id='historic-active'`,[value]),{code});
  }
  const app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    const response=await app.inject({url:'/api/announcements'});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(response.json().announcements.map((item:{id:string})=>item.id),['historic-active']);
    assert.equal(response.json().announcements[0].bannerTone,'promo');
    assert.equal(response.json().announcements[0].bannerEffect,'glow');
  }finally{await app.close();}
});

test('announcement style API persists compatible defaults, authorized edits and bounded choices',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  t.after(async()=>{await app.close();await fixture.cleanup();});
  let sequence=0;
  async function actor(role:string,permissions:string[]){
    const id=`synthetic-banner-${++sequence}`,token=randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused',$2,$3)",[id,role,JSON.stringify(permissions)]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    return token;
  }
  const content=await actor('admin',['content.manage']),system=await actor('admin',['system.manage']),ordinary=await actor('user',[]);
  async function api(method:HTTPMethods,url:string,payload?:object,token:string|undefined=content){
    const response=await app.inject({method,url,payload,headers:{origin:fixture.config.origin,...(token?{cookie:`${fixture.config.sessionCookieName}=${token}`}:{})}});
    return {status:response.statusCode,body:response.json()};
  }
  let id='';
  await t.test('old create clients receive durable promo/glow defaults',async()=>{
    const created=await api('POST','/api/admin/announcements',input);
    assert.equal(created.status,200,JSON.stringify(created.body));
    id=created.body.announcement.id;
    assert.equal(created.body.announcement.bannerTone,'promo');assert.equal(created.body.announcement.bannerEffect,'glow');
    assert.deepEqual((await fixture.db.query('SELECT banner_tone,banner_effect FROM oaooao_announcements WHERE id=$1',[id])).rows[0],{banner_tone:'promo',banner_effect:'glow'});
    assert.equal((await api('GET','/api/admin/announcements')).body.announcements.find((item:{id:string})=>item.id===id).bannerEffect,'glow');
  });
  await t.test('all allowed tones and effects persist and appear in the public API',async()=>{
    for(const bannerTone of tones){
      const saved=await api('PATCH',`/api/admin/announcements/${id}`,{bannerTone,bannerEffect:'shimmer'});
      assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.announcement.bannerTone,bannerTone);
      assert.equal((await fixture.db.query('SELECT banner_tone FROM oaooao_announcements WHERE id=$1',[id])).rows[0].banner_tone,bannerTone);
    }
    for(const bannerEffect of effects){
      const saved=await api('PATCH',`/api/admin/announcements/${id}`,{bannerTone:'violet',bannerEffect});
      assert.equal(saved.status,200);assert.equal(saved.body.announcement.bannerEffect,bannerEffect);
      const visible=(await api('GET','/api/announcements',undefined,'')).body.announcements.find((item:{id:string})=>item.id===id);
      assert.equal(visible.bannerTone,'violet');assert.equal(visible.bannerEffect,bannerEffect);
    }
  });
  await t.test('legacy partial updates retain style and schedules; expired notices stay hidden',async()=>{
    const expired=await api('PATCH',`/api/admin/announcements/${id}`,{title:'合成过期公告',endsAt:'2000-01-01T00:00:00Z'});
    assert.equal(expired.status,200);assert.equal(expired.body.announcement.bannerTone,'violet');assert.equal(expired.body.announcement.bannerEffect,'shimmer');
    const updated=await api('PATCH',`/api/admin/announcements/${id}`,{content:'只修改正文',bannerTone:'rose'});
    assert.equal(updated.body.announcement.bannerEffect,'shimmer');assert.equal(updated.body.announcement.endsAt,'2000-01-01T00:00:00.000Z');
    assert.ok(!(await api('GET','/api/announcements',undefined,'')).body.announcements.some((item:{id:string})=>item.id===id));
    const legacy=await api('PATCH',`/api/admin/announcements/${id}`,{enabled:true,popupHome:false});
    assert.equal(legacy.body.announcement.bannerTone,'rose');assert.equal(legacy.body.announcement.bannerEffect,'shimmer');assert.equal(legacy.body.announcement.popupHome,false);
  });
  await t.test('invalid styles return 400 before changing content or creating rows',async()=>{
    const before=(await fixture.db.query('SELECT * FROM oaooao_announcements WHERE id=$1',[id])).rows[0];
    const count=(await fixture.db.query('SELECT count(*) FROM oaooao_announcements')).rows[0].count;
    for(const field of ['bannerTone','bannerEffect'])for(const value of ['invalid','',null,4,true,{}]){
      assert.equal((await api('POST','/api/admin/announcements',{...input,[field]:value})).status,400);
      assert.equal((await api('PATCH',`/api/admin/announcements/${id}`,{content:'Must not persist',[field]:value})).status,400);
    }
    assert.deepEqual((await fixture.db.query('SELECT * FROM oaooao_announcements WHERE id=$1',[id])).rows[0],before);
    assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_announcements')).rows[0].count,count);
  });
  await t.test('announcement changes require content permission and settings require system permission',async()=>{
    for(const [method,url,payload] of [['GET','/api/admin/announcements',undefined],['POST','/api/admin/announcements',input],['PATCH',`/api/admin/announcements/${id}`,{bannerTone:'info'}],['DELETE',`/api/admin/announcements/${id}`,undefined]] as const){
      assert.equal((await api(method,url,payload,'')).status,401);
      assert.equal((await api(method,url,payload,ordinary)).status,403);
      assert.equal((await api(method,url,payload,system)).status,403);
    }
    assert.equal((await api('PATCH','/api/admin/settings',{site:{announcementBar:{tone:'info'}}},content)).status,403);
    assert.equal((await api('PATCH','/api/admin/settings',{site:{announcementBar:{effect:'none'}}},ordinary)).status,403);
  });
  await t.test('retired fallback settings reject writes and are omitted from public and administrator reads',async()=>{
    const legacy=await api('PATCH','/api/admin/settings',{site:{announcementBar:{enabled:true,text:'合成备用横幅'}}},system);
    assert.equal(legacy.status,400);
    await fixture.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{site}','{\"announcementBar\":{\"enabled\":true,\"text\":\"旧备用横幅\",\"tone\":\"slate\",\"effect\":\"shimmer\"}}') WHERE id='global'");
    const before=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
    for(const field of ['tone','effect'])for(const value of ['invalid','',null,4,true,{}])assert.equal((await api('PATCH','/api/admin/settings',{site:{announcementBar:{[field]:value}}},system)).status,400);
    assert.deepEqual((await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value,before);
    const publicSession=await app.inject({url:'/api/auth/session'});
    assert.equal(publicSession.json().settings.site.announcementBar,undefined);
    assert.equal((await api('GET','/api/admin/settings',undefined,system)).body.settings.site.announcementBar,undefined);
  });
  await t.test('delete removes the persisted announcement',async()=>{
    assert.equal((await api('DELETE',`/api/admin/announcements/${id}`)).status,200);
    assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_announcements WHERE id=$1',[id])).rows[0].count,'0');
    assert.equal((await api('PATCH',`/api/admin/announcements/${id}`,{bannerTone:'info'})).status,404);
  });
});
