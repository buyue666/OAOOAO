import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify, { type HTTPMethods } from 'fastify';
import cookie from '@fastify/cookie';
import { createContext, hashToken } from '../src/core.js';
import { openWorkCase, registerContent, submitWorkVersion } from '../src/content.js';
import { createTestDatabase } from './core-helpers.js';

test('persistent work moderation and governance client contracts on isolated PostgreSQL',async t=>{
  const fixture=await createTestDatabase(),ctx=createContext(fixture.db,fixture.config),app=Fastify();
  await app.register(cookie);await registerContent(app,ctx);
  app.setErrorHandler((error,_request,reply)=>{const err=error as Error&{statusCode?:number};reply.code(err.statusCode??500).send({msg:err.message});});
  await app.ready();t.after(async()=>{await app.close();await fixture.cleanup();});
  let sequence=0;
  async function user(role='user',permissions:string[]=[]){
    const id=`content-synthetic-${++sequence}`,token=randomBytes(32).toString('base64url');
    await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,$2,$3,$4)',[id,'synthetic-unused',role,JSON.stringify(permissions)]);
    await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);return {id,token};
  }
  const admin=await user('admin',['content.manage']),author=await user(),other=await user(),reader=await user('admin',['billing.read']);
  async function api(method:HTTPMethods,url:string,payload?:object,actor=admin){const response=await app.inject({method,url,payload,headers:{cookie:`${ctx.config.sessionCookieName}=${actor.token}`}});return {status:response.statusCode,body:response.json()};}
  const makeWork=(title:string)=>submitWorkVersion(ctx,author.id,{title,summary:'Synthetic moderation evidence',previewUrl:'/synthetic/preview.jpg'});

  await t.test('lists require the content permission and author submission preserves ownership',async()=>{
    assert.equal((await app.inject({method:'GET',url:'/api/admin/works'})).statusCode,401);
    assert.equal((await api('GET','/api/admin/works',undefined,reader)).status,403);
    assert.equal((await api('GET','/api/admin/work-cases',undefined,author)).status,403);
    const work=await makeWork('Synthetic ownership');
    await assert.rejects(submitWorkVersion(ctx,other.id,{title:'Cross-user edit'},work.id),{statusCode:404});
    await assert.rejects(submitWorkVersion(ctx,author.id,{title:'Unsafe metadata',previewUrl:'javascript:alert(1)'}),{statusCode:400});
    const denied=await api('POST',`/api/admin/works/${work.id}/review`,{decision:'approved'},author);assert.equal(denied.status,403);
    assert.equal((await api('POST',`/api/admin/works/${work.id}/feature`,{featured:true},reader)).status,403);
    assert.equal((await api('DELETE',`/api/admin/works/${work.id}`,undefined,author)).status,403);
  });
  await t.test('listing reads persisted version metadata, filters it, and counts past the last page',async()=>{
    const work=await makeWork('Unique synthetic keyword');
    const listing=await api('GET','/api/admin/works?status=pending&lifecycleStatus=draft&keyword=Unique&pageSize=1');
    assert.equal(listing.status,200);assert.equal(listing.body.total,1);assert.equal(listing.body.items[0].id,work.id);
    assert.equal(listing.body.items[0].currentVersion.title,'Unique synthetic keyword');assert.equal(listing.body.items[0].currentPreview.previewUrl,'/synthetic/preview.jpg');
    assert.equal(listing.body.items[0].authorUserId,author.id);assert.equal(listing.body.pageSize,1);
    const emptyPage=await api('GET','/api/admin/works?keyword=Unique&page=50&pageSize=1');assert.equal(emptyPage.body.total,1);assert.deepEqual(emptyPage.body.items,[]);
  });
  await t.test('review targets only the current version and repeated approval has one decision record',async()=>{
    const before=await makeWork('Synthetic version one'),after=await submitWorkVersion(ctx,author.id,{title:'Synthetic version two',expectedVersionId:before.currentVersion!.id},before.id);
    assert.equal((await api('POST',`/api/admin/works/${before.id}/review`,{decision:'approved',versionId:before.currentVersion!.id})).status,409);
    assert.equal((await api('POST',`/api/admin/works/${before.id}/review`,{decision:'unverified'})).status,400);
    const decisions=await Promise.all(Array.from({length:8},()=>api('POST',`/api/admin/works/${before.id}/review`,{decision:'approved',versionId:after.currentVersion!.id,reason:'Synthetic inspected preview'})));
    assert.ok(decisions.every(result=>result.status===200),JSON.stringify(decisions));
    assert.ok(decisions.every(result=>result.body.work.lifecycleStatus==='published'&&result.body.work.moderationStatus==='approved'));
    assert.equal((await ctx.db.query("SELECT count(*) FROM oaooao_work_cases WHERE work_id=$1 AND kind='review'",[before.id])).rows[0].count,'1');
    assert.equal((await ctx.db.query('SELECT status FROM oaooao_work_versions WHERE id=$1',[before.currentVersion!.id])).rows[0].status,'pending');
    await assert.rejects(submitWorkVersion(ctx,author.id,{title:'Stale submission',expectedVersionId:before.currentVersion!.id},before.id),{statusCode:409});
  });
  await t.test('feature and takedown races cannot expose a taken-down or unapproved work',async()=>{
    const work=await makeWork('Synthetic race');
    assert.equal((await api('POST',`/api/admin/works/${work.id}/feature`,{featured:true})).status,409);
    await api('POST',`/api/admin/works/${work.id}/review`,{decision:'approved'});
    const results=await Promise.all(Array.from({length:8},(_,i)=>i%2?api('POST',`/api/admin/works/${work.id}/feature`,{featured:true}):api('POST',`/api/admin/works/${work.id}/take-down`,{reason:'Synthetic documented reason'})));
    assert.ok(results.every(result=>[200,409].includes(result.status)),JSON.stringify(results));
    const persisted=(await ctx.db.query('SELECT * FROM oaooao_works WHERE id=$1',[work.id])).rows[0];assert.equal(persisted.lifecycle_status,'taken_down');assert.equal(persisted.featured,false);
    assert.equal((await ctx.db.query("SELECT count(*) FROM oaooao_work_cases WHERE work_id=$1 AND kind='take_down'",[work.id])).rows[0].count,'1');
    const next=await submitWorkVersion(ctx,author.id,{title:'Synthetic resubmission'},work.id);
    const approved=await api('POST',`/api/admin/works/${work.id}/review`,{decision:'approved',versionId:next.currentVersion!.id});
    assert.equal(approved.body.work.lifecycleStatus,'taken_down');assert.equal(approved.body.work.featured,false);
  });
  await t.test('case resolution is durable, idempotent, and detects competing decisions',async()=>{
    const work=await makeWork('Synthetic report'),report=await openWorkCase(ctx,author.id,work.id,{kind:'report',reason:'Synthetic report evidence'});
    assert.equal((await api('POST',`/api/admin/work-cases/${report.id}/resolve`,{decision:'dismissed'},other)).status,403);
    const results=await Promise.all(['dismissed','upheld'].map(decision=>api('POST',`/api/admin/work-cases/${report.id}/resolve`,{decision,resolution:'Synthetic evaluated evidence'})));
    assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    const resolution=results.find(result=>result.status===200)!.body.case;
    const retry=await api('POST',`/api/admin/work-cases/${report.id}/resolve`,{decision:resolution.decision,resolution:resolution.resolution});assert.equal(retry.status,200);assert.equal(retry.body.case.resolvedAt,resolution.resolvedAt);
    const listed=await api('GET','/api/admin/work-cases?pageSize=100');assert.ok(listed.body.items.some((row:any)=>row.id===report.id&&row.status==='resolved'));
    assert.equal((await ctx.db.query("SELECT count(*) FROM oaooao_audit_logs WHERE target_id=$1 AND action='work.case.resolve'",[report.id])).rows[0].count,'1');
    const last=await api('GET','/api/admin/work-cases?page=999&pageSize=1');assert.equal(last.body.total,listed.body.total);assert.deepEqual(last.body.items,[]);
  });
  await t.test('deletion removes discovery but preserves decision evidence and prevents revival',async()=>{
    const work=await makeWork('Synthetic deleted title'),report=await openWorkCase(ctx,author.id,work.id,{kind:'appeal',reason:'Synthetic appeal'});
    assert.equal((await api('DELETE',`/api/admin/works/${work.id}`)).status,200);assert.equal((await api('DELETE',`/api/admin/works/${work.id}`)).status,200);
    assert.equal((await api('GET','/api/admin/works?keyword=Synthetic%20deleted%20title')).body.total,0);
    assert.equal((await api('POST',`/api/admin/works/${work.id}/review`,{decision:'approved'})).status,409);
    await assert.rejects(submitWorkVersion(ctx,author.id,{title:'Attempted revival'},work.id),{statusCode:409});
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_work_versions WHERE work_id=$1',[work.id])).rows[0].count,'1');
    assert.equal((await ctx.db.query('SELECT work_id FROM oaooao_work_cases WHERE id=$1',[report.id])).rows[0].work_id,work.id);
  });
  await t.test('failed audit rolls back the associated moderation mutation',async()=>{
    const work=await makeWork('Synthetic rollback'),audit=ctx.audit;
    ctx.audit=async()=>{throw new Error('Synthetic audit failure');};
    try{assert.equal((await api('POST',`/api/admin/works/${work.id}/review`,{decision:'approved'})).status,500);}finally{ctx.audit=audit;}
    const row=(await ctx.db.query('SELECT moderation_status,lifecycle_status FROM oaooao_works WHERE id=$1',[work.id])).rows[0];
    assert.equal(row.moderation_status,'pending');assert.equal(row.lifecycle_status,'draft');
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_work_cases WHERE work_id=$1',[work.id])).rows[0].count,'0');
  });
});
