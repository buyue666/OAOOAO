import { httpError, publicAddress, safeFetch, type Context } from './core.js';
import { saveMedia, sniffMedia, ownedExternalResult, MAX_MEDIA_BYTES, MAX_VIDEO_BYTES } from './media.js';
import { saveTeamAsset } from './team-assets.js';

/** URL-only output never requires a download or consumes this account's quota. */
export async function publicMediaUrl(raw:string):Promise<string> {
  let url:URL;
  try { url=new URL(raw); } catch { throw httpError(502,'渠道返回了无效的媒体链接'); }
  if(url.protocol!=='https:'||url.username||url.password||url.hash||raw.length>16000)
    throw httpError(502,'渠道媒体链接必须是公开的 HTTPS 地址');
  await publicAddress(url.hostname);
  return url.toString();
}

/** Fetch only a verified completed output; no persistent copy or quota charge. */
export async function readExternalResult(ctx:Context,userId:string,url:string,transport:typeof safeFetch=safeFetch){
  const output=await ownedExternalResult(ctx,userId,url);
  const response=await transport(url,{maxBytes:output.kind==='video'?MAX_VIDEO_BYTES:MAX_MEDIA_BYTES,timeoutMs:120000,publicRedirects:3});
  if(!response.ok)throw httpError(502,'上游结果暂时无法下载，请稍后重试');
  const bytes=Buffer.from(await response.arrayBuffer()),mimeType=sniffMedia(bytes);
  if(!mimeType.startsWith(output.kind+'/'))throw httpError(502,'上游结果内容与任务类型不符');
  return {bytes,mimeType,jobId:output.id};
}

/** Use the job's channel snapshot, including during asynchronous recovery. */
export async function saveGeneratedMedia(
  ctx:Context,userId:string,config:Record<string,any>,kind:'image'|'video'|'audio',
  source:{url?:string;b64_json?:string;bytes?:Buffer},transport:typeof safeFetch=safeFetch,
):Promise<{url:string;mimeType?:string}> {
  if(!ctx.workspace&&config.storeGeneratedMedia===false&&source.url?.trim()&&!source.url.startsWith('data:'))
    return {url:await publicMediaUrl(source.url)};
  let bytes=source.bytes;
  const limit=kind==='video'?MAX_VIDEO_BYTES:MAX_MEDIA_BYTES;
  if(!bytes&&source.b64_json?.trim()){
    const value=source.b64_json;
    if(value.length>Math.ceil(limit/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))
      throw httpError(502,'渠道返回的媒体数据无效或过大');
    bytes=Buffer.from(value,'base64');
    if(bytes.toString('base64')!==value)throw httpError(502,'渠道返回的媒体编码无效');
  }
  if(!bytes&&source.url){
    const response=await transport(source.url,{maxBytes:limit,timeoutMs:kind==='video'?120000:30000,publicRedirects:3});
    if(!response.ok)throw httpError(502,'生成结果暂时无法保存，请稍后重新检查');
    bytes=Buffer.from(await response.arrayBuffer());
  }
  if(!bytes?.length||!sniffMedia(bytes).startsWith(kind+'/'))throw httpError(502,'渠道返回的媒体类型与任务不符');
  if(ctx.workspace){
    const asset=await saveTeamAsset(ctx,ctx.workspace,userId,{title:kind==='image'?'团队生成图片':kind==='video'?'团队生成视频':'团队生成音频',bytes},true);
    return {url:asset.url,mimeType:sniffMedia(bytes)};
  }
  const stored=await saveMedia(ctx,userId,bytes);
  return {url:stored.url,mimeType:stored.mimeType};
}
