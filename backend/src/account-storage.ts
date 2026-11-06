import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { httpError, object, pagination, transaction, type Context } from './core.js';
import { storageUsage, lockStorage } from './storage-quota.js';
import { deleteObject } from './object-storage.js';
import { mediaPath } from './media.js';

const uuid=/^[a-f0-9-]{36}$/i;
function ids(value:unknown):string[] {
  if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!uuid.test(id)))throw httpError(400,'每次最多选择 100 个素材');
  return [...new Set(value)];
}
function removeMedia(value:any,id:string,external=false):any {
  if(typeof value==='string') {
    if(external)return value===id?undefined:value;
    try { if(/^\/api\/(?:media|reference-assets|generation-log-assets)\//.test(new URL(value,'https://local.invalid').pathname)&&value.includes(id))return undefined; }catch{}
    return value;
  }
  if(Array.isArray(value))return value.map(v=>removeMedia(v,id,external)).filter(v=>v!==undefined);
  if(value&&typeof value==='object'){
    const matches=['url','serverUrl','remoteUrl','src','dataUrl'].filter(k=>typeof value[k]==='string'&&removeMedia(value[k],id,external)===undefined);
    const cleaned=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,removeMedia(v,id,external)]).filter(([,v])=>v!==undefined));
    if(matches.length){
      const remaining=(Array.isArray(cleaned.results)?cleaned.results:Array.isArray(cleaned.assets)?cleaned.assets:[]) as any[];
      if(!remaining.length)return undefined;
      for(const key of matches)cleaned[key]=remaining[0]?.url||remaining[0]?.remoteUrl;
    }
    return cleaned;
  }
  return value;
}
async function referenced(ctx:Context,db:any,userId:string,id:string) {
  const project=await db.query("SELECT title FROM oaooao_projects WHERE user_id=$1 AND position($2 in document::text)>0 LIMIT 1",[userId,id]);
  if(project.rowCount)return `项目「${project.rows[0].title}」正在使用`;
  const version=await db.query('SELECT p.title FROM oaooao_project_versions v JOIN oaooao_projects p ON p.id=v.project_id WHERE p.user_id=$1 AND position($2 in v.document::text)>0 LIMIT 1',[userId,id]);
  if(version.rowCount)return `项目「${version.rows[0].title}」的历史版本正在使用`;
  const job=await db.query("SELECT id FROM oaooao_generation_jobs WHERE user_id=$1 AND status IN ('pending','running','paused') AND (position($2 in input::text)>0 OR position($2 in result::text)>0) LIMIT 1",[userId,id]);
  if(job.rowCount)return '进行中的生成任务正在使用';
  return '';
}
export async function deleteStoredMedia(ctx:Context,row:Record<string,any>) {
  // A failed external deletion remains queued and continues to occupy the quota.
  try {
    if(row.storage_backend==='s3')await deleteObject(ctx,row.storage_location);
    else { await rm(mediaPath(ctx.config.mediaRoot,row.id),{force:true});await rm(mediaPath(ctx.config.mediaRoot,row.id)+'.tmp',{force:true}); }
    const deleted=await ctx.db.query('DELETE FROM oaooao_media WHERE id=$1 AND delete_requested_at<=now()',[row.id]);
    return deleted.rowCount?Number(row.byte_count):0;
  } catch { return 0; }
}
export async function cleanupStoredMedia(ctx:Context,limit=50) {
  const settings=(await ctx.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0]?.value;
  const cleanupTemporary=settings?.dataLifecycle?.cleanupExpiredTemporaryMedia===true;
  const expired=await ctx.db.query('SELECT * FROM oaooao_media WHERE (delete_requested_at<=now() OR ($2::boolean AND persistent=false AND expires_at<now())) ORDER BY coalesce(delete_requested_at,expires_at) LIMIT $1',[limit,cleanupTemporary]);
  let freedBytes=0;
  for(const row of expired.rows){
    const ready=await transaction(ctx.db,async client=>{
      await lockStorage(client,row.user_id);
      const current=(await client.query('SELECT * FROM oaooao_media WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
      if(!current)return null;
      if(current.delete_requested_at?new Date(current.delete_requested_at).getTime()>Date.now():!(cleanupTemporary&&!current.persistent&&new Date(current.expires_at).getTime()<Date.now()))return null;
      if(!current.delete_requested_at&&await referenced(ctx,client,row.user_id,row.id))return null;
      return (await client.query('UPDATE oaooao_media SET delete_requested_at=coalesce(delete_requested_at,now()) WHERE id=$1 RETURNING *',[row.id])).rows[0];
    });
    if(ready)freedBytes+=await deleteStoredMedia(ctx,ready);
  }
  return {freedBytes};
}
export async function registerAccountStorage(app:FastifyInstance,ctx:Context) {
  app.get('/api/account/storage',async request=>{const user=await ctx.requireUser(request);return storageUsage(ctx,user.id);});
  app.get('/api/account/stored-media',async request=>{
    const user=await ctx.requireUser(request),page=pagination(request.query as any);
    const rows=await ctx.db.query('SELECT id,mime_type,byte_count,created_at,persistent,expires_at,count(*) OVER() total FROM oaooao_media WHERE user_id=$1 AND delete_requested_at IS NULL ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[user.id,page.pageSize,page.offset]);
    return {media:rows.rows.map(row=>({id:row.id,url:`/api/reference-assets/${row.id}`,mimeType:row.mime_type,bytes:Number(row.byte_count),persistent:row.persistent,createdAt:row.created_at.toISOString(),expiresAt:row.expires_at?.toISOString()})),total:Number(rows.rows[0]?.total||0)};
  });
  app.post('/api/account/assets/batch-delete',async request=>{
    const user=await ctx.requireUser(request),body=object(request.body),mediaIds=ids(body.mediaIds||[]),libraryIds=ids(body.libraryIds||[]);
    if(body.externalUrls!==undefined&&(!Array.isArray(body.externalUrls)||body.externalUrls.length>100||body.externalUrls.some((value:any)=>typeof value!=='string'||value.length>16000)))throw httpError(400,'无效的生成结果链接列表');
    const externalUrls:string[]=[...new Set<string>(body.externalUrls||[])];
    if(!mediaIds.length&&!libraryIds.length&&!externalUrls.length)throw httpError(400,'请选择要删除的素材');
    const result=await transaction(ctx.db,async client=>{
      await lockStorage(client,user.id);
      const libraries=await client.query('SELECT * FROM oaooao_library_assets WHERE user_id=$1 AND id=ANY($2::text[])',[user.id,libraryIds]);
      if(libraries.rowCount!==libraryIds.length)throw httpError(404,'部分素材不存在或无权删除');
      const selected=new Set(mediaIds);
      for(const row of libraries.rows)for(const raw of [row.document?.data?.serverUrl,row.document?.data?.url,row.document?.data?.dataUrl]){
        try{const url=new URL(raw,ctx.config.origin),id=url.pathname.split('/').pop()!;if(url.origin===new URL(ctx.config.origin).origin&&uuid.test(id))selected.add(id);}catch{}
      }
      if(selected.size>100)throw httpError(400,'每次最多删除 100 个文件');
      const rows=await client.query('SELECT * FROM oaooao_media WHERE user_id=$1 AND id=ANY($2::text[]) FOR UPDATE',[user.id,[...selected]]);
      // Never delete another account's file, including a forged library document.
      const foreign=await client.query('SELECT id FROM oaooao_media WHERE user_id<>$1 AND id=ANY($2::text[])',[user.id,[...selected]]);
      if(foreign.rowCount)throw httpError(404,'部分素材不存在或无权删除');
      const queued:any[]=[],skipped:Array<{id:string;reason:string}>=[],deletedExternalUrls:string[]=[];
      // CDN files belong to the upstream. Delete only verified account records,
      // without contacting the CDN or reporting any storage bytes as freed.
      for(const row of libraries.rows)for(const raw of [row.document?.data?.serverUrl,row.document?.data?.url]){
        try{if(new URL(raw).protocol==='https:'&&new URL(raw).origin!==new URL(ctx.config.origin).origin&&!externalUrls.includes(raw))externalUrls.push(raw);}catch{}
      }
      if(externalUrls.length>100)throw httpError(400,'每次最多删除 100 个结果链接');
      for(const url of externalUrls){
        let parsed:URL;try{parsed=new URL(url);}catch{throw httpError(400,'无效的生成结果链接');}
        if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw httpError(400,'无效的生成结果链接');
        const own=await client.query("SELECT id FROM oaooao_generation_jobs WHERE user_id=$1 AND status='success' AND (result @> $2::jsonb OR result @> $3::jsonb OR result @> $4::jsonb) LIMIT 1",[user.id,JSON.stringify({url}),JSON.stringify({remoteUrl:url}),JSON.stringify({results:[{url}]})]);
        if(!own.rowCount)throw httpError(404,'部分结果不存在或无权删除');
      }
      for(const row of rows.rows){
        const reason=await referenced(ctx,client,user.id,row.id);
        if(reason){skipped.push({id:row.id,reason});continue;}
        await client.query("DELETE FROM oaooao_library_assets WHERE user_id=$1 AND (position($2 in document::text)>0)",[user.id,row.id]);
        for(const table of ['oaooao_generation_jobs','oaooao_generation_history']){
          const column=table==='oaooao_generation_jobs'?'result':'document';
          const sources=await client.query(`SELECT id,${column} value FROM ${table} WHERE user_id=$1 AND position($2 in ${column}::text)>0 FOR UPDATE`,[user.id,row.id]);
          for(const source of sources.rows)await client.query(`UPDATE ${table} SET ${column}=$2 WHERE id=$1`,[source.id,removeMedia(source.value,row.id)||{}]);
        }
        const pending=(await client.query('UPDATE oaooao_media SET delete_requested_at=now() WHERE id=$1 RETURNING *',[row.id])).rows[0];queued.push(pending);
      }
      for(const url of externalUrls){
        const reason=await referenced(ctx,client,user.id,url);
        if(reason){skipped.push({id:url,reason});continue;}
        await client.query("DELETE FROM oaooao_library_assets WHERE user_id=$1 AND (document->'data'->>'url'=$2 OR document->'data'->>'serverUrl'=$2)",[user.id,url]);
        for(const table of ['oaooao_generation_jobs','oaooao_generation_history']){
          const column=table==='oaooao_generation_jobs'?'result':'document';
          const sources=await client.query(`SELECT id,${column} value FROM ${table} WHERE user_id=$1 AND position($2 in ${column}::text)>0 FOR UPDATE`,[user.id,url]);
          for(const source of sources.rows)await client.query(`UPDATE ${table} SET ${column}=$2 WHERE id=$1`,[source.id,removeMedia(source.value,url,true)||{}]);
        }
        deletedExternalUrls.push(url);
      }
      const blocked=new Set(skipped.map(item=>item.id));
      for(const row of libraries.rows)if(![...blocked].some(id=>JSON.stringify(row.document).includes(id)))await client.query('DELETE FROM oaooao_library_assets WHERE user_id=$1 AND id=$2',[user.id,row.id]);
      await ctx.audit({actorId:user.id,action:'assets.batch-delete',targetType:'media',metadata:{requested:selected.size,queued:queued.length,skipped:skipped.length}},client);
      return {queued,skipped,deletedExternalUrls};
    });
    let freedBytes=0;for(const row of result.queued)freedBytes+=await deleteStoredMedia(ctx,row);
    return {deletedMediaIds:result.queued.map(row=>row.id),deletedExternalUrls:result.deletedExternalUrls,skipped:result.skipped,freedBytes,storage:await storageUsage(ctx,user.id)};
  });
}
