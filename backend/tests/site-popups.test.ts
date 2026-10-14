import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {HTTPMethods} from 'fastify';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {migrate} from '../src/migrate.js';
import {createTestDatabase} from './core-helpers.js';

const migration='009-site-popups.sql';
const input={title:'合成推广弹窗',content:'隔离测试中的文字内容。'};

test('site popup migration adds an empty independent resource without changing old data or migrations',async t=>{
  const fixture=await createTestDatabase();
  t.after(()=>fixture.cleanup());
  assert.match(fixture.schema,/^test_[a-f0-9]{32}$/);
  await fixture.db.query('DROP TABLE oaooao_site_popups');
  await fixture.db.query('DELETE FROM oaooao_migrations WHERE name=$1',[migration]);
  const previous=(await fixture.db.query('SELECT name,checksum FROM oaooao_migrations ORDER BY name')).rows;
  assert.equal(previous.filter(row=>row.name<migration).length,8);
  await fixture.db.query("INSERT INTO oaooao_announcements(id,title,content,enabled,popup_home,popup_after_login,action_url) VALUES('unchanged-announcement','合成旧公告','独立保留公告',true,true,true,'/plans')");
  const before=(await fixture.db.query('SELECT to_jsonb(a) AS value FROM oaooao_announcements a')).rows;
  await migrate(fixture.db);await migrate(fixture.db);
  assert.deepEqual((await fixture.db.query('SELECT name,checksum FROM oaooao_migrations WHERE name<>$1 ORDER BY name',[migration])).rows,previous);
  assert.deepEqual((await fixture.db.query('SELECT to_jsonb(a) AS value FROM oaooao_announcements a')).rows,before);
  assert.equal((await fixture.db.query('SELECT count(*)::int AS total FROM oaooao_site_popups')).rows[0].total,0);
  const app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    const response=await app.inject({url:'/api/site-popups'});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(response.json(),{popups:[],total:0,page:1,pageSize:20});
    const notices=(await app.inject({url:'/api/announcements'})).json().announcements;
    assert.equal(notices.length,1);assert.equal(notices[0].popupAfterLogin,true);assert.equal(notices[0].actionUrl,'/plans');
  }finally{await app.close();}
});

test('site popup administration, visibility, URL safety and transactions are persisted in isolated PostgreSQL',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  t.after(async()=>{await app.close();await fixture.cleanup();});
  let actorIndex=0;
  async function actor(role:string,permissions:string[]){
    const id=`synthetic-popup-${++actorIndex}`,token=randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused',$2,$3)",[id,role,JSON.stringify(permissions)]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    return token;
  }
  const manager=await actor('admin',['content.manage']),system=await actor('admin',['system.manage']),ordinary=await actor('user',[]);
  async function api(method:HTTPMethods,url:string,payload?:object,token=manager,origin=fixture.config.origin){
    const result=await app.inject({method,url,payload,headers:{origin,...(token?{cookie:`${fixture.config.sessionCookieName}=${token}`}:{})}});
    return {status:result.statusCode,body:result.json()};
  }
  let id='';
  const row=async()=>(await fixture.db.query('SELECT * FROM oaooao_site_popups WHERE id=$1',[id])).rows[0];
  const counts=async()=>(await fixture.db.query('SELECT (SELECT count(*)::int FROM oaooao_site_popups) AS popups,(SELECT count(*)::int FROM oaooao_audit_logs) AS audits')).rows[0];

  await t.test('create uses safe defaults, persists its fields and stays hidden until enabled',async()=>{
    const created=await api('POST','/api/admin/site-popups',input);
    assert.equal(created.status,200,JSON.stringify(created.body));
    const popup=created.body.popup;id=popup.id;
    assert.equal(popup.title,input.title);assert.equal(popup.content,input.content);
    assert.equal(popup.enabled,false);assert.deepEqual(popup.pages,['home','studio']);assert.equal(popup.frequency,'session');assert.equal(popup.buttonText,'查看详情');
    assert.equal(popup.imageUrl,undefined);assert.equal(popup.actionUrl,undefined);assert.equal(popup.startsAt,undefined);assert.equal(popup.endsAt,undefined);
    assert.ok(Number.isFinite(Date.parse(popup.createdAt))&&Number.isFinite(Date.parse(popup.updatedAt)));
    assert.equal((await row()).title,input.title);
    assert.equal((await api('GET','/api/site-popups',undefined,'')).body.total,0);
    const changed=await api('PATCH',`/api/admin/site-popups/${id}`,{enabled:true,pages:['studio'],frequency:'daily',actionUrl:'  /plans  ',buttonText:'查看优惠'});
    assert.equal(changed.status,200);assert.equal(changed.body.popup.actionUrl,'/plans');
    assert.equal((await row()).frequency,'daily');
    const visible=(await api('GET','/api/site-popups',undefined,'')).body.popups[0];
    assert.equal(visible.id,id);assert.deepEqual(visible.pages,['studio']);assert.equal(visible.buttonText,'查看优惠');
  });

  await t.test('image-only and text-only popups are supported; clearing the last content is rejected',async()=>{
    const imageOnly=await api('POST','/api/admin/site-popups',{title:'图片推广',imageUrl:'/media/promotion/poster.webp'});
    assert.equal(imageOnly.status,200);assert.equal(imageOnly.body.popup.content,'');
    assert.equal(imageOnly.body.popup.imageUrl,'/media/promotion/poster.webp');
    assert.equal((await api('PATCH',`/api/admin/site-popups/${imageOnly.body.popup.id}`,{imageUrl:null})).status,400);
    const cleared=await api('PATCH',`/api/admin/site-popups/${imageOnly.body.popup.id}`,{content:'已切换文字',imageUrl:''});
    assert.equal(cleared.status,200);assert.equal(cleared.body.popup.imageUrl,undefined);
    assert.equal((await api('POST','/api/admin/site-popups',{title:'没有展示内容'})).status,400);
  });

  await t.test('partial edits retain other fields; empty values clear optional URLs and dates',async()=>{
    const configured={imageUrl:'https://images.example/promotion.png',actionUrl:'https://example.com/offers',startsAt:'2020-01-01T08:00:00+08:00',endsAt:'2100-01-01T00:00:00Z'};
    assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,configured)).status,200);
    const changed=await api('PATCH',`/api/admin/site-popups/${id}`,{title:'只修改标题'});
    assert.equal(changed.body.popup.imageUrl,configured.imageUrl);assert.equal(changed.body.popup.actionUrl,configured.actionUrl);
    assert.equal(changed.body.popup.startsAt,'2020-01-01T00:00:00.000Z');assert.equal(changed.body.popup.endsAt,'2100-01-01T00:00:00.000Z');
    assert.deepEqual(changed.body.popup.pages,['studio']);assert.equal(changed.body.popup.frequency,'daily');
    const cleared=await api('PATCH',`/api/admin/site-popups/${id}`,{imageUrl:'',actionUrl:null,startsAt:null,endsAt:''});
    assert.equal(cleared.status,200);
    for(const key of ['imageUrl','actionUrl','startsAt','endsAt'])assert.equal(cleared.body.popup[key],undefined);
    const stored=await row();for(const key of ['image_url','action_url','starts_at','ends_at'])assert.equal(stored[key],null);
  });

  await t.test('safe image and action URLs remain available in admin and public reads',async()=>{
    for(const imageUrl of ['/media/banner.png','/media/品牌/海报.webp','https://images.example/poster.jpg?version=2','https://cdn.example/image?id=123']){
      const response=await api('PATCH',`/api/admin/site-popups/${id}`,{imageUrl});
      assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.popup.imageUrl,imageUrl);
    }
    for(const actionUrl of ['/studio?entry=popup#start','https://example.com/offer','http://example.com/offer','/'+'a'.repeat(2047)]){
      assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,{actionUrl})).status,200);
      assert.equal((await row()).action_url,actionUrl);
    }
    const admin=(await api('GET','/api/admin/site-popups')).body.popups.find((popup:{id:string})=>popup.id===id);
    const visible=(await api('GET','/api/site-popups',undefined,'')).body.popups.find((popup:{id:string})=>popup.id===id);
    assert.equal(admin.imageUrl,'https://cdn.example/image?id=123');assert.equal(visible.actionUrl,admin.actionUrl);
  });

  await t.test('injected, unsafe or overlong URLs are rejected atomically',async()=>{
    const before=await row(),beforeCounts=await counts();
    const unsafe=['//evil.example','/\\evil.example','javascript:alert(1)','data:image/svg+xml,<svg/>','https:evil.example','https:///evil.example','https://user:secret@example.com','https://@example.com','https://example.com/\nimage.png','\thttps://example.com','/path\u0000x','/path\u0085x','https://example.com\\@evil.example','/'+'a'.repeat(2048),'https://example.com/'+'字'.repeat(300)];
    for(const actionUrl of unsafe){
      assert.equal((await api('POST','/api/admin/site-popups',{...input,actionUrl})).status,400,JSON.stringify(actionUrl));
      assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,{title:'不得写入',actionUrl})).status,400,JSON.stringify(actionUrl));
    }
    for(const imageUrl of [...unsafe,'http://images.example/photo.png','/api/reference-assets/synthetic','/media/../private.png','/media/%2e%2e/private.png','/media/a%2f..%2f..%2fprivate.png','/media/x.svg','/media/x.SVGZ','https://cdn.example/poster.svg?download=1','https://cdn.example/%70oster%2esvg']){
      assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,{imageUrl})).status,400,JSON.stringify(imageUrl));
    }
    assert.deepEqual(await row(),before);assert.deepEqual(await counts(),beforeCounts);
  });

  await t.test('field lengths, types, pages, frequency and scheduled dates are validated without partial saves',async()=>{
    const before=await row(),beforeCounts=await counts();
    const patches=[{title:''},{title:'x'.repeat(121)},{content:'x'.repeat(10001)},{content:null},{imageUrl:4},{actionUrl:{}},{enabled:'true'},{pages:[]},{pages:['home','home']},{pages:['image']},{pages:['home',null]},{pages:'home'},{frequency:'always'},{buttonText:''},{buttonText:'x'.repeat(25)},{startsAt:'invalid'},{endsAt:0},{startsAt:'2026-02-31T00:00:00Z'},{startsAt:'2026-10-14T08:00:00'},{startsAt:'2026-10-14T00:00:00Z',endsAt:'2026-10-14T00:00:00Z'},{startsAt:'2026-10-15T00:00:00Z',endsAt:'2026-10-14T00:00:00Z'},{unexpected:true}];
    for(const patch of patches)assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,patch)).status,400,JSON.stringify(patch));
    assert.deepEqual(await row(),before);assert.deepEqual(await counts(),beforeCounts);
  });

  await t.test('only content managers can read or change administration; public reads need no session',async()=>{
    const before=await row();
    for(const [method,url,payload] of [['GET','/api/admin/site-popups',undefined],['POST','/api/admin/site-popups',input],['PATCH',`/api/admin/site-popups/${id}`,{enabled:false}],['DELETE',`/api/admin/site-popups/${id}`,undefined]] as const){
      assert.equal((await api(method,url,payload,'')).status,401);
      assert.equal((await api(method,url,payload,ordinary)).status,403);
      assert.equal((await api(method,url,payload,system)).status,403);
    }
    assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,{enabled:false},manager,'https://evil.example')).status,403);
    assert.equal((await api('GET','/api/site-popups',undefined,'')).status,200);
    assert.deepEqual(await row(),before);
  });

  await t.test('audit failure rolls back create, update and delete; successful changes retain audit attribution',async()=>{
    const before=await row(),beforeCounts=await counts(),audit=app.ctx.audit;
    app.ctx.audit=async()=>{throw new Error('Synthetic audit failure');};
    try{
      assert.equal((await api('POST','/api/admin/site-popups',input)).status,500);
      assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,{title:'Must roll back'})).status,500);
      assert.equal((await api('DELETE',`/api/admin/site-popups/${id}`)).status,500);
    }finally{app.ctx.audit=audit;}
    assert.deepEqual(await row(),before);assert.deepEqual(await counts(),beforeCounts);
    const audits=(await fixture.db.query('SELECT action,actor_id,target_type,status FROM oaooao_audit_logs WHERE target_id=$1 ORDER BY created_at',[id])).rows;
    assert.equal(audits[0].action,'site_popup.create');assert.equal(audits.at(-1)?.action,'site_popup.update');
    assert.ok(audits.every(record=>record.actor_id==='synthetic-popup-1'&&record.target_type==='site_popup'&&record.status==='success'));
  });

  await t.test('concurrent partial updates preserve both changes through row locking',async()=>{
    const results=await Promise.all([api('PATCH',`/api/admin/site-popups/${id}`,{title:'并发修改标题'}),api('PATCH',`/api/admin/site-popups/${id}`,{frequency:'session'})]);
    assert.ok(results.every(result=>result.status===200));assert.equal((await row()).title,'并发修改标题');assert.equal((await row()).frequency,'session');
  });

  await t.test('active filtering, deterministic ordering and empty-page totals match the database',async()=>{
    await fixture.db.query('UPDATE oaooao_site_popups SET enabled=false');
    await fixture.db.query(`INSERT INTO oaooao_site_popups(id,title,content,enabled,starts_at,ends_at,updated_at,created_at) VALUES
      ('order-a','A','A',true,'2000-01-01T00:00:00Z',NULL,'2026-01-01T00:00:00Z','2025-01-01T00:00:00Z'),
      ('order-b','B','B',true,NULL,'2100-01-01T00:00:00Z','2026-01-01T00:00:00Z','2025-01-01T00:00:00Z'),
      ('order-new','New','New',true,NULL,NULL,'2026-02-01T00:00:00Z','2025-01-01T00:00:00Z'),
      ('inactive-future','Future','Future',true,'2100-01-01T00:00:00Z',NULL,now(),now()),
      ('inactive-expired','Expired','Expired',true,NULL,'2000-01-01T00:00:00Z',now(),now())`);
    const first=await api('GET','/api/site-popups?page=1&pageSize=2',undefined,'');
    assert.equal(first.status,200);assert.equal(first.body.total,3);assert.deepEqual(first.body.popups.map((popup:{id:string})=>popup.id),['order-new','order-b']);
    const second=await api('GET','/api/site-popups?page=2&pageSize=2',undefined,'');
    assert.deepEqual(second.body.popups.map((popup:{id:string})=>popup.id),['order-a']);
    assert.deepEqual((await api('GET','/api/site-popups?page=10&pageSize=2',undefined,'')).body,{popups:[],total:3,page:10,pageSize:2});
    assert.equal((await api('GET','/api/admin/site-popups?page=10&pageSize=2')).body.total,(await counts()).popups);
    assert.equal((await api('GET','/api/site-popups?page=1.5',undefined,'')).status,400);
  });

  await t.test('an exact start is active and an exact end is excluded in the query time boundary',async()=>{
    const client=await fixture.db.connect(),originalQuery=fixture.db.query;
    try{
      await client.query('BEGIN');
      await client.query('UPDATE oaooao_site_popups SET enabled=false');
      await client.query("INSERT INTO oaooao_site_popups(id,title,content,enabled,starts_at,ends_at) VALUES('boundary-start','Start','Start',true,transaction_timestamp(),NULL),('boundary-end','End','End',true,NULL,transaction_timestamp())");
      // Pin statement time to this synthetic transaction's clock while exercising the real list query.
      fixture.db.query=((sql:string,parameters:unknown[])=>client.query(sql.replaceAll('statement_timestamp()','transaction_timestamp()'),parameters)) as typeof fixture.db.query;
      const result=await api('GET','/api/site-popups',undefined,'');
      assert.equal(result.status,200);assert.deepEqual(result.body.popups.map((popup:{id:string})=>popup.id),['boundary-start']);
    }finally{fixture.db.query=originalQuery;await client.query('ROLLBACK');client.release();}
  });

  await t.test('database constraints and deletion protect resource integrity',async()=>{
    for(const [column,value] of [['frequency','always'],['pages',[]],['pages',['home','home']],['pages',['image']],['pages',[null]],['title',''],['button_text',''],['content','x'.repeat(10001)]] as const){
      await assert.rejects(fixture.db.query(`UPDATE oaooao_site_popups SET ${column}=$1 WHERE id=$2`,[value,id]),{code:'23514'});
    }
    assert.equal((await api('DELETE',`/api/admin/site-popups/${id}`)).status,200);
    assert.equal(await row(),undefined);
    assert.equal((await api('DELETE',`/api/admin/site-popups/${id}`)).status,404);
    assert.equal((await api('PATCH',`/api/admin/site-popups/${id}`,{title:'Missing'})).status,404);
    assert.equal((await fixture.db.query("SELECT count(*)::int AS n FROM oaooao_audit_logs WHERE target_id=$1 AND action='site_popup.delete'",[id])).rows[0].n,1);
  });
});
