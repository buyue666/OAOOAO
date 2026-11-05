/** Reuse verified metadata, never client durations or cached prices. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {httpError,type Context} from './core.js';
import {ownedMediaInfo,readReference,sniffMedia,MAX_MEDIA_BYTES} from './media.js';

type Probe=(bytes:Buffer)=>Promise<{duration:number;streams:Array<{codec_type?:string}>}>;
export type ReferenceInspection={type:string;duration:number;bytes:number};
type Entry={expires:number;value:Promise<ReferenceInspection>};
type Cache={entries:Map<string,Entry>;running:number;waiting:Array<()=>void>};
const caches=new WeakMap<Context,Cache>();
const ttl=10*60*1000,maxEntries=256,parallel=2;
function cacheFor(ctx:Context){let cache=caches.get(ctx);if(!cache){cache={entries:new Map(),running:0,waiting:[]};caches.set(ctx,cache);}return cache;}
async function limited<T>(cache:Cache,work:()=>Promise<T>):Promise<T>{
  if(cache.running>=parallel&&cache.waiting.length>=32)throw httpError(503,'参考素材检查繁忙，请稍后重试');
  if(cache.running>=parallel)await new Promise<void>(done=>cache.waiting.push(done));else cache.running++;
  try{return await work();}finally{const next=cache.waiting.shift();if(next)next();else cache.running--;}
}
function remember(cache:Cache,key:string,work:()=>Promise<ReferenceInspection>,schedule=true){
  const now=Date.now(),known=cache.entries.get(key);
  if(known&&known.expires>now)return known.value;
  for(const [id,entry] of cache.entries)if(entry.expires<=now)cache.entries.delete(id);
  while(cache.entries.size>=maxEntries)cache.entries.delete(cache.entries.keys().next().value!);
  const entry:Entry={expires:now+ttl,value:schedule?limited(cache,work):work()};
  cache.entries.set(key,entry);
  entry.value.catch(()=>{if(cache.entries.get(key)===entry)cache.entries.delete(key);});
  return entry.value;
}
export async function inspectReference(ctx:Context,userId:string,reference:Record<string,any>,probe:Probe):Promise<ReferenceInspection>{
  const cache=cacheFor(ctx);
  const inspect=async(bytes:Buffer,mimeType:string)=>{
    const type=mimeType.split('/')[0];
    let duration=0;
    if(type!=='image'){
      const info=await probe(bytes);
      if(!info.streams.some(stream=>stream.codec_type===type))throw httpError(400,'参考素材没有可用的媒体流');
      duration=info.duration;
      if(!Number.isFinite(duration)||duration<=0)throw httpError(422,'无法确定参考视频或音频时长');
    }
    return {type,duration,bytes:bytes.length};
  };
  let url:URL|undefined;
  if(typeof reference.dataUrl!=='string')try{url=new URL(String(reference.url||''),ctx.config.origin);}catch{}
  const id=url?.origin===new URL(ctx.config.origin).origin?/^\/api\/(?:media|reference-assets|generation-log-assets)\/([a-f0-9-]{36})$/i.exec(url.pathname)?.[1]:undefined;
  if(id){
    // Ownership, expiry and file identity are checked even on a cache hit.
    const media=await ownedMediaInfo(ctx,userId,id);
    if(media.bytes>MAX_MEDIA_BYTES)throw httpError(400,'单个参考素材不得超过 24 MiB');
    const key=JSON.stringify([userId,id,media.sha256,media.mimeType,media.fingerprint]);
    return remember(cache,key,async()=>{
      const bytes=await readFile(media.file);
      if(bytes.length!==media.bytes||createHash('sha256').update(bytes).digest('hex')!==media.sha256)throw httpError(422,'参考素材已变化，请重新上传');
      const mimeType=sniffMedia(bytes);
      if(mimeType!==media.mimeType)throw httpError(400,'参考素材类型与实际文件不一致');
      return inspect(bytes,mimeType);
    });
  }
  // Remote URLs are fetched and validated again. A mutable URL is never a key.
  return limited(cache,async()=>{
    const media=await readReference(ctx,userId,reference);
    const key=JSON.stringify([userId,createHash('sha256').update(media.bytes).digest('hex'),media.mimeType]);
    return remember(cache,key,()=>inspect(media.bytes,media.mimeType),false);
  });
}
