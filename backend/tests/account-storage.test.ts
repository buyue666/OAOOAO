import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {access,readFile} from 'node:fs/promises';
import {S3Client} from '@aws-sdk/client-s3';
import {buildApp} from '../src/app.js';
import {ADMIN_PERMISSIONS,hashToken} from '../src/core.js';
import {saveMedia,ownedMedia,ownedMediaInfo,mediaPath} from '../src/media.js';
import {storageUsage} from '../src/storage-quota.js';
import {cleanupStoredMedia} from '../src/account-storage.js';
import {resolveProvider} from '../src/providers.js';
import {assignAdminPlan} from '../src/wallet.js';
import {createTestDatabase} from './core-helpers.js';

const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64');
async function fixture(t:any){
  const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config});await app.ready();
  t.after(async()=>{await app.close();await f.cleanup();});
  const users=[];
  for(let i=0;i<2;i++){
    const id=randomUUID(),token=randomBytes(32).toString('base64url');
    await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)",[id,JSON.stringify(ADMIN_PERMISSIONS)]);
    await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    users.push({id,headers:{origin:f.config.origin,cookie:`${f.config.sessionCookieName}=${token}`}});
  }
  const ctx=app.ctx;
  return {...f,app,ctx,users};
}
test('account defaults persist per user, accept only live matching models and drive provider selection',async t=>{
  const f=await fixture(t),[a,b]=f.users;
  const models=['image','text'].flatMap(kind=>[0,1].map(n=>({id:`${kind}-${n}`,name:`Model ${n}`,capability:kind,enabled:true,bindings:[{id:`binding-${kind}-${n}`,channelId:'synthetic',upstreamModel:'model',requestAlias:`alias-${kind}-${n}`,enabled:true,priority:0}]})));
  await f.db.query("UPDATE oaooao_settings SET value=value||$1 WHERE id='global'",[{logicalModels:models,systemChannels:[{id:'synthetic',name:'Synthetic',enabled:true,baseUrl:'https://provider.example/v1',apiFormat:'openai',apiKey:f.ctx.encrypt('not-a-real-key')}],defaultModels:{imageModel:'image-0',textModel:'text-0',videoModel:'',audioModel:''},modelPointCosts:{'image-0':1,'image-1':2,'text-0':1,'text-1':2}}]);
  const select=await f.app.inject({method:'PATCH',url:'/api/account/model-defaults',headers:a.headers,payload:{imageModel:'alias-image-1',textModel:'text-1'}});assert.equal(select.statusCode,200,select.body);
  const session=await f.app.inject({url:'/api/auth/session',headers:a.headers});assert.equal(session.json().settings.defaultModels.imageModel,'alias-image-1');
  const other=await f.app.inject({url:'/api/auth/session',headers:b.headers});assert.equal(other.json().settings.defaultModels.imageModel,'image-0');
  assert.equal((await resolveProvider(f.ctx,'image',{prompt:'synthetic',config:{}},undefined,a.id)).model,'image-1');
  for(const patch of [{textModel:'image-1'},{imageModel:'missing'},{videoModel:12},{admin:true}])assert.equal((await f.app.inject({method:'PATCH',url:'/api/account/model-defaults',headers:a.headers,payload:patch})).statusCode,400);
  await f.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{systemChannels,0,enabled}','false') WHERE id='global'");
  assert.equal((await f.app.inject({method:'PATCH',url:'/api/account/model-defaults',headers:a.headers,payload:{imageModel:'image-1'}})).statusCode,400);
  assert.equal((await f.app.inject({url:'/api/account/model-defaults'})).statusCode,401);
});
test('concurrent uploads honor real-byte quota; plan changes and expiry fallback never erase files',async t=>{
  const f=await fixture(t),a=f.users[0];
  await f.db.query("UPDATE oaooao_settings SET value=value||$1 WHERE id='global'",[{entitlements:{enabled:true,defaultPlanId:'basic',defaultStorageQuotaBytes:pixel.length*2,plans:[{id:'basic',enabled:true,name:'Basic',dailyPoints:0,features:[],limits:{},storageQuotaBytes:pixel.length*2},{id:'small',enabled:true,name:'Small',dailyPoints:0,features:[],limits:{},storageQuotaBytes:pixel.length},{id:'unlimited',enabled:true,name:'Unlimited',dailyPoints:0,features:[],limits:{},storageQuotaBytes:0}]}}]);
  const all=await Promise.allSettled([1,2,3].map(()=>saveMedia(f.ctx,a.id,pixel,true)));
  assert.equal(all.filter(x=>x.status==='fulfilled').length,2);assert.equal(all.filter(x=>x.status==='rejected').length,1);
  assert.equal((await storageUsage(f.ctx,a.id)).usedBytes,pixel.length*2);
  await assignAdminPlan(f.ctx,a.id,'small-assignment','small');const reduced=await storageUsage(f.ctx,a.id);assert.equal(reduced.quotaBytes,pixel.length);assert.equal(reduced.files,2);
  await assert.rejects(saveMedia(f.ctx,a.id,pixel),{statusCode:413});
  await assignAdminPlan(f.ctx,a.id,'unlimited-assignment','unlimited');await saveMedia(f.ctx,a.id,pixel);assert.equal((await storageUsage(f.ctx,a.id)).unlimited,true);
  await assignAdminPlan(f.ctx,a.id,'clear-assignment',null);assert.equal((await storageUsage(f.ctx,a.id)).quotaBytes,pixel.length*2);
  await f.db.query("UPDATE oaooao_users SET plan_id='unlimited' WHERE id=$1",[a.id]);assert.equal((await storageUsage(f.ctx,a.id)).unlimited,false,'A stale membership label cannot grant unlimited storage');
  const override=await f.app.inject({method:'PATCH',url:`/api/admin/users/${a.id}`,headers:f.users[1].headers,payload:{storageQuotaBytes:1024}});assert.equal(override.statusCode,200,override.body);assert.equal((await storageUsage(f.ctx,a.id)).quotaBytes,1024);
  assert.equal((await f.app.inject({method:'PATCH',url:`/api/admin/users/${a.id}`,headers:f.users[1].headers,payload:{storageQuotaBytes:-1}})).statusCode,400);
  assert.equal((await f.app.inject({method:'PATCH',url:'/api/auth/profile',headers:a.headers,payload:{storageQuotaBytes:0}})).statusCode,400);
  await f.app.inject({method:'PATCH',url:`/api/admin/users/${a.id}`,headers:f.users[1].headers,payload:{storageQuotaBytes:null}});assert.equal((await storageUsage(f.ctx,a.id)).quotaBytes,pixel.length*2);
  assert.equal((await f.app.inject({url:'/api/account/storage',headers:f.users[1].headers})).json().usedBytes,0);
});
test('batch deletion releases real files, removes duplicate asset records, protects active project references and isolates accounts',async t=>{
  const f=await fixture(t),[a,b]=f.users,first=await saveMedia(f.ctx,a.id,pixel),second=await saveMedia(f.ctx,a.id,pixel),foreign=await saveMedia(f.ctx,b.id,pixel);
  for(let n=0;n<2;n++)await f.db.query("INSERT INTO oaooao_library_assets(id,user_id,kind,document) VALUES($1,$2,'image',$3)",[randomUUID(),a.id,{title:'Duplicate',data:{url:second.url}}]);
  const projectId=randomUUID();await f.db.query("INSERT INTO oaooao_projects(id,user_id,kind,title,document) VALUES($1,$2,'canvas','Synthetic board',$3)",[projectId,a.id,{nodes:[{src:first.url}],connections:[]}]);
  await f.db.query("INSERT INTO oaooao_generation_history(id,user_id,document,created_at) VALUES($1,$2,$3,now())",[randomUUID(),a.id,{kind:'image',status:'success',assets:[{url:second.url}]}]);
  const call=(ids:string[])=>f.app.inject({method:'POST',url:'/api/account/assets/batch-delete',headers:a.headers,payload:{mediaIds:ids}});
  assert.equal((await call([second.key,foreign.key])).statusCode,404);assert.deepEqual((await ownedMedia(f.ctx,a.id,second.key)).bytes,pixel);
  const deleted=await call([first.key,second.key]);assert.equal(deleted.statusCode,200,deleted.body);assert.equal(deleted.json().freedBytes,pixel.length);assert.equal(deleted.json().skipped[0].id,first.key);
  assert.equal(Number((await f.db.query('SELECT count(*) n FROM oaooao_library_assets WHERE user_id=$1',[a.id])).rows[0].n),0);
  await assert.rejects(access(mediaPath(f.config.mediaRoot,second.key)));assert.deepEqual(await readFile(mediaPath(f.config.mediaRoot,first.key)),pixel);
  const history=(await f.db.query('SELECT document FROM oaooao_generation_history WHERE user_id=$1',[a.id])).rows[0].document;assert.deepEqual(history.assets,[]);
  assert.equal((await storageUsage(f.ctx,a.id)).usedBytes,pixel.length);
});
test('R2 adapter stores no local copy, authorizes signed downloads, verifies content and retries failed deletion',async t=>{
  const f=await fixture(t),a=f.users[0],objects=new Map<string,Buffer>();let failDelete=false;
  t.mock.method(S3Client.prototype,'send',async function(command:any){
    const key=command.input.Key,name=command.constructor.name;
    if(name==='PutObjectCommand'){objects.set(key,Buffer.from(command.input.Body));return {ETag:'synthetic-etag'};}
    if(name==='HeadBucketCommand')return {};
    if(name==='GetObjectCommand'){const bytes=objects.get(key);if(!bytes)throw {$metadata:{httpStatusCode:404}};return {Body:{transformToByteArray:async()=>bytes}};}
    if(name==='HeadObjectCommand'){const bytes=objects.get(key);if(!bytes)throw {$metadata:{httpStatusCode:404}};return {ContentLength:bytes.length,ETag:'synthetic-etag',LastModified:new Date(0)};}
    if(name==='DeleteObjectCommand'){if(failDelete)throw Error('synthetic unavailable');objects.delete(key);return {};}
    throw Error(`Unexpected ${name}`);
  });
  const config={provider:'r2',enabled:true,endpoint:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',region:'auto',bucket:'synthetic-test-only',prefix:'media',forcePathStyle:true,accessKeyId:f.ctx.encrypt('synthetic-key-id'),secretAccessKey:f.ctx.encrypt('synthetic-secret-key')};
  await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='object-storage'",[config]);
  const saved=await saveMedia(f.ctx,a.id,pixel);assert.equal(objects.size,1);await assert.rejects(access(mediaPath(f.config.mediaRoot,saved.key)));
  assert.deepEqual((await ownedMedia(f.ctx,a.id,saved.key)).bytes,pixel);assert.equal((await ownedMediaInfo(f.ctx,a.id,saved.key)).bytes,pixel.length);
  assert.equal((await f.app.inject({url:saved.url})).statusCode,401);
  assert.equal((await f.app.inject({url:saved.url,headers:f.users[1].headers})).statusCode,404);
  const download=await f.app.inject({url:saved.url,headers:a.headers});assert.equal(download.statusCode,302);const url=new URL(download.headers.location!);assert.equal(url.searchParams.get('X-Amz-Expires'),'300');assert.equal(url.hostname,new URL(config.endpoint).hostname);
  const canvasRead=await f.app.inject({url:saved.url,headers:{...a.headers,'sec-fetch-dest':'empty','sec-fetch-mode':'cors'}});assert.equal(canvasRead.statusCode,200);assert.deepEqual(canvasRead.rawPayload,pixel);
  const check=await f.app.inject({method:'POST',url:'/api/admin/object-storage',headers:a.headers});assert.equal(check.statusCode,200,check.body);assert.equal(check.json().data.deleteVerified,true);assert.equal(objects.size,1);
  const publicSettings=await f.app.inject({url:'/api/admin/object-storage',headers:a.headers});assert.ok(!publicSettings.body.includes('synthetic-secret-key'));assert.ok(!publicSettings.body.includes('synthetic-key-id'));
  const changeBucket=await f.app.inject({method:'PATCH',url:'/api/admin/object-storage',headers:a.headers,payload:{...config,accessKeyId:undefined,secretAccessKey:undefined,bucket:'different-bucket'}});assert.equal(changeBucket.statusCode,409);
  await f.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{enabled}','false') WHERE id='object-storage'");assert.deepEqual((await ownedMedia(f.ctx,a.id,saved.key)).bytes,pixel,'Disabling new object writes preserves existing remote media reads');
  failDelete=true;const removed=await f.app.inject({method:'POST',url:'/api/account/assets/batch-delete',headers:a.headers,payload:{mediaIds:[saved.key]}});assert.equal(removed.statusCode,200);assert.equal(removed.json().freedBytes,0);assert.equal(removed.json().storage.pendingDeletionBytes,pixel.length);
  failDelete=false;await cleanupStoredMedia(f.ctx);assert.equal(objects.size,0);assert.equal((await storageUsage(f.ctx,a.id)).usedBytes,0);
});
test('expired temporary local files are cleaned while persistent media is retained',async t=>{
  const f=await fixture(t),a=f.users[0],temp=await saveMedia(f.ctx,a.id,pixel,false),permanent=await saveMedia(f.ctx,a.id,pixel,true);
  await f.db.query("UPDATE oaooao_media SET expires_at=now()-interval '1 minute' WHERE user_id=$1",[a.id]);
  await cleanupStoredMedia(f.ctx);assert.equal((await storageUsage(f.ctx,a.id)).files,2,'Automatic expiry deletion honors the administrator switch');
  await f.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{dataLifecycle,cleanupExpiredTemporaryMedia}','true') WHERE id='global'");
  await cleanupStoredMedia(f.ctx);await assert.rejects(ownedMedia(f.ctx,a.id,temp.key),{statusCode:404});assert.deepEqual((await ownedMedia(f.ctx,a.id,permanent.key)).bytes,pixel);
});
