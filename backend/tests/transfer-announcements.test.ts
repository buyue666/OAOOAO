import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {importTransfer,verifyTransfer,type TransferBundle} from '../src/transfer.js';
import {createTestDatabase} from './core-helpers.js';

function fixture():TransferBundle {
  const timestamp='2026-10-01T20:13:14.567891+08:00';
  const announcement={title:'合成公告：服务说明',content:'第一行\n第二行 <strong>合成内容</strong> & "原文"',enabled:true,popup_home:true,popup_after_login:false,starts_at:null,ends_at:null,created_at:timestamp,updated_at:timestamp};
  return {format:'oaooao-normalized-transfer-v1',id:'synthetic-announcements',sourceDigest:'d'.repeat(64),capturedAt:timestamp,
    records:{announcements:[
      {id:'unbounded',...announcement},
      {id:'active',...announcement,popup_home:false,popup_after_login:true,starts_at:'2000-01-01T08:00:00.123456+08:00',ends_at:'2100-01-01T08:00:00.456789+08:00'},
      {id:'future',...announcement,starts_at:'2100-01-01T00:00:00.000Z'},
      {id:'expired',...announcement,ends_at:'2000-01-01T00:00:00.000Z'},
      {id:'disabled',...announcement,enabled:false,popup_after_login:true},
    ]},archive:[]};
}

test('announcement transfer preserves content, popup flags, time instants and public visibility; counts include every row',async()=>{
  const env=await createTestDatabase(),app=await buildApp({db:env.db,config:env.config,coreOnly:true});
  try{
    const bundle=fixture(),imported=await importTransfer(env.db,bundle);
    assert.equal(imported.replayed,false);assert.equal(imported.summary.counts.announcements,5);
    const verified=await verifyTransfer(env.db,bundle);assert.deepEqual(verified,imported.summary);
    assert.equal((await env.db.query('SELECT summary FROM oaooao_transfer_runs WHERE id=$1',[bundle.id])).rows[0].summary.counts.announcements,5);
    const rows=(await env.db.query('SELECT * FROM oaooao_announcements')).rows;
    for(const source of bundle.records.announcements!){
      const row=rows.find(item=>item.id===source.id);assert.ok(row);
      for(const key of ['title','content','enabled','popup_home','popup_after_login'])assert.equal(row[key],source[key]);
      for(const key of ['starts_at','ends_at','created_at','updated_at'])assert.equal(row[key]?.toISOString()??null,source[key]===null?null:new Date(String(source[key])).toISOString());
    }
    const response=await app.inject({url:'/api/announcements'});assert.equal(response.statusCode,200,response.body);
    const announcements=response.json().announcements;
    assert.deepEqual(announcements.map((item:{id:string})=>item.id).sort(),['active','unbounded']);
    const active=announcements.find((item:{id:string})=>item.id==='active');
    assert.equal(active.content,bundle.records.announcements![1].content);
    assert.equal(active.popupHome,false);assert.equal(active.popupAfterLogin,true);
    assert.equal(active.startsAt,'2000-01-01T00:00:00.123Z');assert.equal(active.endsAt,'2100-01-01T00:00:00.456Z');
    assert.equal(active.updatedAt,'2026-10-01T12:13:14.567Z');
    const unbounded=announcements.find((item:{id:string})=>item.id==='unbounded');
    assert.equal(unbounded.startsAt,undefined);assert.equal(unbounded.endsAt,undefined);
    assert.deepEqual(await importTransfer(env.db,bundle),{replayed:true,summary:imported.summary});
    assert.equal((await env.db.query('SELECT count(*)::int AS n FROM oaooao_announcements')).rows[0].n,5);
  }finally{await app.close();await env.cleanup();}
});

test('announcement reconciliation detects changed content, popup flags, schedule and unexpected rows',async()=>{
  const env=await createTestDatabase();
  try{
    const bundle=fixture();await importTransfer(env.db,bundle);
    const mutations:[string,unknown][]=[['content','Changed synthetic content'],['popup_home',false],['popup_after_login',true],['starts_at','2001-01-01T00:00:00.000Z'],['ends_at','2101-01-01T00:00:00.000Z']];
    for(const [column,value] of mutations){
      await env.db.query(`UPDATE oaooao_announcements SET ${column}=$1 WHERE id='unbounded'`,[value]);
      await assert.rejects(verifyTransfer(env.db,bundle),new RegExp(`announcements\\.${column} differs`));
      await env.db.query(`UPDATE oaooao_announcements SET ${column}=$1 WHERE id='unbounded'`,[bundle.records.announcements![0][column]]);
    }
    await verifyTransfer(env.db,bundle);
    await env.db.query("INSERT INTO oaooao_announcements(id,title,content) VALUES('extra','Synthetic extra','Synthetic content')");
    await assert.rejects(verifyTransfer(env.db,bundle),/announcements count differs/);
  }finally{await env.cleanup();}
});

test('a destination containing only an announcement is not fresh even when the bundle omits announcements',async()=>{
  const env=await createTestDatabase();
  try{
    await env.db.query("INSERT INTO oaooao_announcements(id,title,content,enabled,popup_home) VALUES('existing','Existing synthetic announcement','Preserve me',true,true)");
    for(const includeAnnouncements of [true,false]){
      const bundle=fixture();if(!includeAnnouncements)delete bundle.records.announcements;
      bundle.records.users=[{id:'new-user',username:'synthetic-freshness-user',password_hash:'synthetic-unusable-hash'}];
      await assert.rejects(importTransfer(env.db,bundle),/fresh destination/);
      assert.equal((await env.db.query('SELECT count(*)::int AS n FROM oaooao_users')).rows[0].n,0);
      assert.equal((await env.db.query('SELECT count(*)::int AS n FROM oaooao_transfer_runs')).rows[0].n,0);
    }
    assert.deepEqual((await env.db.query('SELECT id,title,content,enabled,popup_home FROM oaooao_announcements')).rows,[{id:'existing',title:'Existing synthetic announcement',content:'Preserve me',enabled:true,popup_home:true}]);
  }finally{await env.cleanup();}
});
