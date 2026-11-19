import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {S3Client} from '@aws-sdk/client-s3';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {saveMedia} from '../src/media.js';
import {createDirectDownloads,cleanupDirectDownloads,attachmentDisposition} from '../src/media-download.js';
import {storageUsage} from '../src/storage-quota.js';
import {WATERMARK_POLICY_VERSION} from '../src/watermark.js';
import {createTestDatabase} from './core-helpers.js';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64');
async function fixture(t:any){
  const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config}),objects=new Map<string,{bytes:Buffer;mime:string}>(),calls:string[]=[];
  t.after(async()=>{await app.close();await f.cleanup();});
  t.mock.method(S3Client.prototype,'send',async function(command:any){
    const key=command.input.Key,name=command.constructor.name;calls.push(name);
    if(name==='PutObjectCommand'){objects.set(key,{bytes:Buffer.from(command.input.Body),mime:command.input.ContentType});return {};}
    if(name==='HeadObjectCommand'){const value=objects.get(key);if(!value)throw {$metadata:{httpStatusCode:404}};return {ContentLength:value.bytes.length,ContentType:value.mime};}
    if(name==='GetObjectCommand'){const value=objects.get(key);if(!value)throw {$metadata:{httpStatusCode:404}};return {Body:{transformToByteArray:async()=>value.bytes}};}
    if(name==='DeleteObjectCommand'){objects.delete(key);return {};}
    throw Error('Unexpected synthetic S3 command');
  });
  const users=[];
  for(let n=0;n<2;n++){const id=randomUUID(),token=randomBytes(32).toString('base64url');await f.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,'synthetic-unused')",[id]);await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);users.push({id,headers:{origin:f.config.origin,cookie:`${f.config.sessionCookieName}=${token}`}});}
  const config={provider:'r2',enabled:true,endpoint:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',region:'auto',bucket:'synthetic-download-only',prefix:'media',forcePathStyle:true,accessKeyId:app.ctx.encrypt('synthetic-key-id'),secretAccessKey:app.ctx.encrypt('synthetic-secret-key')};
  await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='object-storage'",[config]);
  return {...f,app,ctx:app.ctx,users,objects,calls};
}

test('R2 export returns an attachment capability after owner checks without proxying bytes',async t=>{
  const f=await fixture(t),[a,b]=f.users,media=await saveMedia(f.ctx,a.id,image),url=`/api/media/${media.key}/export`;
  const headers={...a.headers,accept:'application/json','x-oao-download-name':encodeURIComponent('测试视频.png')};
  assert.equal((await f.app.inject({method:'POST',url,headers:{accept:'application/json'}})).statusCode,200);
  assert.equal((await f.app.inject({method:'POST',url,headers:{...b.headers,accept:'application/json'}})).statusCode,200);
  f.calls.length=0;
  const response=await f.app.inject({method:'POST',url,headers});assert.equal(response.statusCode,200,response.body);
  const result=response.json(),signed=new URL(result.url);
  assert.equal(result.status,'ready');assert.equal(result.filename,'测试视频.png');assert.equal(result.bytes,image.length);
  assert.equal(signed.hostname,'a'.repeat(32)+'.r2.cloudflarestorage.com');assert.equal(signed.searchParams.get('X-Amz-Expires'),'3600');
  assert.match(signed.searchParams.get('response-content-disposition')!,/^attachment;/);assert.ok(signed.searchParams.get('response-content-disposition')!.includes("filename*=UTF-8''"));
  assert.equal(signed.searchParams.get('response-content-type'),'image/png');assert.ok(!f.calls.includes('GetObjectCommand'));
  assert.equal((await storageUsage(f.ctx,a.id)).usedBytes,image.length);
  const legacy=await f.app.inject({method:'POST',url,headers:a.headers});assert.equal(legacy.statusCode,200);assert.deepEqual(legacy.rawPayload,image);
  await f.db.query('UPDATE oaooao_media SET delete_requested_at=now() WHERE id=$1',[media.key]);assert.equal((await f.app.inject({method:'POST',url,headers})).statusCode,404);
});

test('background labelled preparation is deduplicated, respects opt-out and never enters user quota',async t=>{
  const f=await fixture(t),a=f.users[0],media=await saveMedia(f.ctx,a.id,image),before=await storageUsage(f.ctx,a.id);
  let release!:()=>void,labelled=0,enabled=true;
  const wait=new Promise<void>(resolve=>{release=resolve;});
  const service=createDirectDownloads(f.ctx,{policyVersion:WATERMARK_POLICY_VERSION,isGeneratedMedia:async()=>true,watermarkPreference:async()=>({enabled}),labelMedia:async bytes=>{labelled++;await wait;return {bytes:Buffer.concat([bytes,Buffer.from('synthetic-label')]),mimeType:'image/png',extension:'png'};}});
  t.after(()=>service.close());
  assert.equal((await service.prepare(a.id,media.key,'作品.png'))?.status,'preparing');
  assert.equal((await service.prepare(a.id,media.key,'作品.png'))?.status,'preparing');assert.equal(labelled,1);
  release();await service.close();
  const first=await service.prepare(a.id,media.key,'作品.png'),again=await service.prepare(a.id,media.key,'另一个名称.jpg');
  assert.equal(first?.status,'ready');assert.equal(again?.status,'ready');if(first?.status!=='ready'||again?.status!=='ready')return;
  assert.equal(again.filename,'另一个名称.png');assert.equal(new URL(first.url).pathname,new URL(again.url).pathname);assert.equal(labelled,1);
  assert.ok(!new URL(first.url).pathname.endsWith(media.key));assert.equal(f.objects.size,2);assert.equal((await storageUsage(f.ctx,a.id)).usedBytes,before.usedBytes);
  enabled=false;const original=await service.prepare(a.id,media.key,'原图.png');assert.equal(original?.status,'ready');if(original?.status==='ready')assert.ok(new URL(original.url).pathname.endsWith(media.key));
  await f.db.query("UPDATE oaooao_media_downloads SET expires_at=now()-interval '1 minute'");
  assert.deepEqual(await cleanupDirectDownloads(f.ctx),{deleted:1});assert.equal(f.objects.size,1);assert.equal((await storageUsage(f.ctx,a.id)).usedBytes,before.usedBytes);
});

test('failed labels cannot silently provide the original, and orphan cache cleanup survives source removal',async t=>{
  const f=await fixture(t),a=f.users[0],media=await saveMedia(f.ctx,a.id,image);
  let broken=true;
  const service=createDirectDownloads(f.ctx,{policyVersion:WATERMARK_POLICY_VERSION,isGeneratedMedia:async()=>true,watermarkPreference:async()=>({enabled:true}),labelMedia:async bytes=>{if(broken)throw Error('synthetic-encoder-failure');return {bytes,mimeType:'image/png',extension:'png'};}});t.after(()=>service.close());
  await service.prepare(a.id,media.key,'作品');await service.close();
  await assert.rejects(service.prepare(a.id,media.key,'作品'),{statusCode:503});assert.equal(f.objects.size,1);
  broken=false;await f.db.query("UPDATE oaooao_media_downloads SET lease_until=now()-interval '1 second'");
  await service.prepare(a.id,media.key,'作品');await service.close();assert.equal(f.objects.size,2);
  await f.db.query('DELETE FROM oaooao_media WHERE id=$1',[media.key]);assert.deepEqual(await cleanupDirectDownloads(f.ctx),{deleted:1});assert.equal(f.objects.size,1);
});

test('download filenames cannot inject headers or retain path separators',()=>{
  const value=attachmentDisposition('中文"/\\\r\n恶意.mp4');
  assert.ok(!/[\r\n]/.test(value));assert.match(value,/^attachment; filename=/);assert.ok(value.includes("filename*=UTF-8''"));
});
