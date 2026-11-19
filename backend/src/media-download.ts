import {createHash,randomUUID} from 'node:crypto';
import {httpError,rateLimit,type Context} from './core.js';
import {ownedMedia,mediaPath,MAX_MEDIA_BYTES,MAX_VIDEO_BYTES} from './media.js';
import {deleteObject,downloadObjectUrl,headObject,putObject,storageConfig,type ObjectLocation} from './object-storage.js';

const LINK_SECONDS=3600;
type Dependencies={
  policyVersion:string;
  isGeneratedMedia(ctx:Context,userId:string,id:string):Promise<boolean>;
  watermarkPreference(ctx:Context,userId:string):Promise<{enabled:boolean}>;
  labelMedia(bytes:Buffer,mime:string):Promise<{bytes:Buffer;mimeType:string;extension:string}>;
};
const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','audio/wav':'wav','audio/ogg':'ogg','audio/flac':'flac','audio/aac':'aac','audio/mpeg':'mp3'};
export function attachmentDisposition(filename:string){
  const cleaned=filename.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120)||'OAOOAO-download';
  const ascii=cleaned.replace(/[^\x20-\x7e]/g,'_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`;
}

/** Short authenticated preparation requests; file bytes go from R2 to the browser. */
export function createDirectDownloads(ctx:Context,deps:Dependencies){
  const running=new Map<string,Promise<void>>();
  const reserving=new Set<string>();
  async function ready(location:ObjectLocation,mimeType:string,bytes:number,filename:string){
    const info=await headObject(ctx,location);
    if(Number(info.ContentLength)!==bytes)throw httpError(502,'下载文件校验失败，请稍后重试');
    const extension=extensions[mimeType]||'bin';
    const base=filename.replace(/\.[a-z0-9]{1,8}$/i,'')||'OAOOAO-download';
    const name=`${base}.${extension}`;
    const url=await downloadObjectUrl(ctx,location,LINK_SECONDS,{contentDisposition:attachmentDisposition(name),contentType:mimeType});
    return {status:'ready' as const,url,filename:name,mimeType,bytes,expiresAt:new Date(Date.now()+LINK_SECONDS*1000).toISOString()};
  }
  async function prepare(userId:string,id:string,filename:string){
    mediaPath(ctx.config.mediaRoot,id);
    const source=(await ctx.db.query('SELECT * FROM oaooao_media WHERE id=$1 AND user_id=$2 AND delete_requested_at IS NULL AND (persistent OR expires_at>now())',[id,userId])).rows[0];
    if(!source)throw httpError(404,'素材不存在或无权下载');
    if(source.storage_backend!=='s3'||source.storage_location.provider==='vercel-blob')return null;
    await rateLimit(ctx,`direct-download:${userId}`,120,60);
    const generated=await deps.isGeneratedMedia(ctx,userId,id),applied=generated&&(await deps.watermarkPreference(ctx,userId)).enabled;
    if(!applied){
      const result=await ready(source.storage_location,source.mime_type,Number(source.byte_count),filename);
      if(generated)await ctx.db.query('INSERT INTO oaooao_watermark_events(id,user_id,event_type,media_id,policy_version) VALUES($1,$2,$3,$4,$5)',[randomUUID(),userId,'export_without_label',id,deps.policyVersion]);
      return result;
    }
    if(Number(source.byte_count)>(source.mime_type.startsWith('video/')?MAX_VIDEO_BYTES:MAX_MEDIA_BYTES))throw httpError(413,'文件超过带水印导出的大小限制');
    const cacheKey=createHash('sha256').update(JSON.stringify([id,source.sha256,deps.policyVersion,'r2-export-v1',Math.floor(Date.now()/86400000)])).digest('hex');
    let row=(await ctx.db.query('SELECT * FROM oaooao_media_downloads WHERE cache_key=$1',[cacheKey])).rows[0];
    if(row?.status==='ready'&&new Date(row.expires_at).getTime()>Date.now()){
      await ctx.db.query("UPDATE oaooao_media_downloads SET expires_at=greatest(expires_at,now()+interval '65 minutes') WHERE id=$1 AND status='ready'",[row.id]);
      return ready(row.storage_location,row.mime_type,Number(row.byte_count),filename);
    }
    if(row?.status==='deleting')throw httpError(409,'临时下载文件正在更新，请稍后重试');
    if(row?.status==='failed'&&new Date(row.lease_until).getTime()>Date.now())throw httpError(503,'下载文件准备失败，请稍后重试');
    if(row?.status==='preparing'&&new Date(row.lease_until).getTime()>Date.now())return {status:'preparing' as const,retryAfterMs:1500};
    if(running.has(userId)||reserving.has(userId)||running.size+reserving.size>=2)throw httpError(429,'正在准备其他下载文件，请稍后重试');
    reserving.add(userId);
    try{
    if(!row){
      const exportId=randomUUID(),location={...source.storage_location,key:[source.storage_location.key.split('/').slice(0,-2).join('/'),'exports',encodeURIComponent(userId),exportId].filter(Boolean).join('/')};
      row=(await ctx.db.query("INSERT INTO oaooao_media_downloads(id,cache_key,user_id,media_id,storage_location,status,mime_type,lease_until) VALUES($1,$2,$3,$4,$5,'preparing',$6,now()+interval '5 minutes') ON CONFLICT(cache_key) DO NOTHING RETURNING *",[exportId,cacheKey,userId,id,location,source.mime_type])).rows[0];
    }else{
      row=(await ctx.db.query("UPDATE oaooao_media_downloads SET status='preparing',lease_until=now()+interval '5 minutes',expires_at=now()+interval '24 hours' WHERE id=$1 AND status IN ('failed','preparing') AND lease_until<=now() RETURNING *",[row.id])).rows[0];
    }
    if(row){
      const record=row;
      const work=(async()=>{
        try{
          const sourceBytes=await ownedMedia(ctx,userId,id),output=await deps.labelMedia(sourceBytes.bytes,sourceBytes.mimeType),storage=await storageConfig(ctx);
          await putObject(ctx,storage,record.storage_location,output.bytes,output.mimeType);
          await ctx.db.query("UPDATE oaooao_media_downloads SET status='ready',mime_type=$2,byte_count=$3,lease_until=now() WHERE id=$1",[record.id,output.mimeType,output.bytes.length]);
          await ctx.db.query('INSERT INTO oaooao_watermark_events(id,user_id,event_type,media_id,policy_version) VALUES($1,$2,$3,$4,$5)',[randomUUID(),userId,'export_with_label',id,deps.policyVersion]);
        }catch{
          await ctx.db.query("UPDATE oaooao_media_downloads SET status='failed',lease_until=now()+interval '30 seconds',expires_at=now()+interval '1 hour' WHERE id=$1",[record.id]).catch(()=>undefined);
        }
      })();
      running.set(userId,work);void work.finally(()=>{if(running.get(userId)===work)running.delete(userId);});
    }
    return {status:'preparing' as const,retryAfterMs:1500};
    }finally{reserving.delete(userId);}
  }
  return {prepare,close:async()=>{await Promise.allSettled(running.values());}};
}

/** Always clean export cache, independently of user temporary-upload retention. */
export async function cleanupDirectDownloads(ctx:Context,limit=20){
  const rows=await ctx.db.query(`UPDATE oaooao_media_downloads SET status='deleting' WHERE id IN (
    SELECT e.id FROM oaooao_media_downloads e LEFT JOIN oaooao_media m ON m.id=e.media_id LEFT JOIN oaooao_users u ON u.id=e.user_id
    WHERE (e.expires_at<=now() OR m.id IS NULL OR m.delete_requested_at IS NOT NULL OR u.id IS NULL)
      AND (e.status<>'preparing' OR e.lease_until<=now()) ORDER BY e.expires_at LIMIT $1 FOR UPDATE OF e SKIP LOCKED
  ) RETURNING *`,[limit]);
  let deleted=0;
  for(const row of rows.rows)try{await deleteObject(ctx,row.storage_location);await ctx.db.query('DELETE FROM oaooao_media_downloads WHERE id=$1 AND status=$2',[row.id,'deleting']);deleted++;}catch{/* Keep the durable cleanup record for the next maintenance tick. */}
  return {deleted};
}
