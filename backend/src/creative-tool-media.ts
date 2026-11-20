import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {type Context,httpError} from './core.js';
import {sniffMedia} from './media.js';
import {storageConfig,assertStorageConfigured,objectLocation,putObject,getObject,deleteObject,downloadObjectUrl} from './object-storage.js';
import {getSettings} from './settings.js';

const types=new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']);
export async function registerCreativeToolMedia(app:FastifyInstance,ctx:Context){
  app.post('/api/admin/creative-tools/media',{bodyLimit:26*1024*1024},async(request,reply)=>{
    const user=await ctx.requireUser(request,'system.manage');
    const file=await request.file({limits:{fileSize:25*1024*1024,files:1,fields:0}});
    if(!file)throw httpError(400,'请选择图片或视频');
    const bytes=await file.toBuffer();
    if(file.file.truncated)throw httpError(413,'展示视频不得超过 25 MiB');
    const mime=sniffMedia(bytes);
    if(!types.has(mime))throw httpError(415,'仅支持 JPG、PNG、WebP、GIF、MP4 和 WebM');
    if(mime.startsWith('image/')&&bytes.length>6*1024*1024)throw httpError(413,'展示图片不得超过 6 MiB，请先压缩');
    const storage=await storageConfig(ctx);if(!storage.enabled)throw httpError(503,'请先启用对象存储，再上传展示素材');assertStorageConfigured(storage);
    const id=randomUUID(),location=objectLocation(storage,'creative-tools',id);
    await putObject(ctx,storage,location,bytes,mime);
    try{
      await ctx.db.query('INSERT INTO oaooao_settings(id,value) VALUES($1,$2::jsonb)',[`tool-showcase-media:${id}`,JSON.stringify({location,mime,bytes:bytes.length,createdBy:user.id,createdAt:new Date().toISOString()})]);
    }catch(error){await deleteObject(ctx,location).catch(()=>{});throw error;}
    await ctx.audit({actorId:user.id,action:'creative-tools.media.upload',targetType:'creative-tool-media',targetId:id,metadata:{mime,bytes:bytes.length}});
    reply.header('Cache-Control','no-store');return {media:{type:mime.startsWith('video/')?'video':'image',url:`/api/creative-tools/media/${id}`}};
  });
  app.get('/api/creative-tools/media/:id',async(request,reply)=>{
    const {id}=request.params as {id:string};if(!/^[a-f0-9-]{36}$/i.test(id))throw httpError(404,'展示素材不存在');
    const settings=await getSettings(ctx),path=`/api/creative-tools/media/${id}`;
    const published=Object.values(settings.creativeTools||{}).some((tool:any)=>(tool.media||[]).some((media:any)=>media.url===path||media.poster===path));
    if(!published)await ctx.requireUser(request,'system.manage');
    const media=(await ctx.db.query('SELECT value FROM oaooao_settings WHERE id=$1',[`tool-showcase-media:${id}`])).rows[0]?.value;
    if(!media)throw httpError(404,'展示素材不存在');
    reply.header('Cache-Control',published?'public, max-age=180':'private, no-store').header('X-Content-Type-Options','nosniff');
    if(media.location.provider==='vercel-blob')return reply.type(media.mime).send(await getObject(ctx,media.location));
    return reply.redirect(await downloadObjectUrl(ctx,media.location,3600,{contentType:media.mime}));
  });
}
