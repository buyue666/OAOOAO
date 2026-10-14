import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, mkdtemp, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, safeFetch, type Context } from './core.js';

export const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function mediaPath(root: string, id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw httpError(400, 'Invalid media identifier');
  const base = resolve(root); const file = resolve(base, id);
  if (!file.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) throw httpError(400, 'Invalid media path');
  return file;
}
export function sniffMedia(data: Buffer): string {
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0]===255 && data[1]===216 && data[2]===255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(data.subarray(0,6).toString())) return 'image/gif';
  if (data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP') return 'image/webp';
  if (data.subarray(4,8).toString()==='ftyp') return 'video/mp4';
  if (data.subarray(0,4).equals(Buffer.from([26,69,223,163]))) return 'video/webm';
  if (data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WAVE') return 'audio/wav';
  if (data.subarray(0,4).toString()==='OggS') return 'audio/ogg';
  if (data.subarray(0,4).toString()==='fLaC') return 'audio/flac';
  if (data[0]===255 && (data[1]&246)===240) return 'audio/aac';
  if (data.subarray(0,3).toString()==='ID3' || (data[0]===255 && (data[1]&224)===224)) return 'audio/mpeg';
  throw httpError(415, 'Unsupported media content');
}
export function decodeDataUrl(value: string): Buffer {
  const match = /^data:(?:image|audio|video)\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[1].length > Math.ceil(MAX_MEDIA_BYTES/3)*4) throw httpError(400, 'Invalid or oversized media data URL');
  const data = Buffer.from(match[1], 'base64');
  if (!data.length || data.length > MAX_MEDIA_BYTES || data.toString('base64') !== match[1]) throw httpError(400, 'Invalid media encoding');
  sniffMedia(data); return data;
}
export async function saveMedia(ctx: Context, userId: string, bytes: Buffer, persistent = true) {
  const storage=(await ctx.db.query("SELECT value FROM oaooao_settings WHERE id='object-storage'")).rows[0]?.value;
  if(storage?.enabled)throw httpError(503,'Configured object storage is not supported by the creative media adapter');
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw httpError(413, 'Media exceeds storage limit');
  const mimeType = sniffMedia(bytes); const id = randomUUID(); const token = randomBytes(32).toString('base64url');
  await mkdir(ctx.config.mediaRoot, { recursive: true });
  const target = mediaPath(ctx.config.mediaRoot,id); const temp = target + '.tmp';
  await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp,target);
  try {
    await ctx.db.query('INSERT INTO oaooao_media(id,user_id,mime_type,byte_count,sha256,persistent,access_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'1 hour\')',[id,userId,mimeType,bytes.length,digest(bytes),persistent,digest(token)]);
  } catch (error) { await rm(target,{force:true}); throw error; }
  const url = `/api/reference-assets/${id}`;
  return { key:id, url, upstreamUrl:`${ctx.config.origin}${url}?token=${encodeURIComponent(token)}`, bytes:bytes.length, mimeType };
}
export async function ownedMedia(ctx: Context, userId: string, id: string, client?:PoolClient): Promise<{bytes:Buffer; mimeType:string}> {
  const result = await (client||ctx.db).query('SELECT * FROM oaooao_media WHERE id=$1 AND user_id=$2 AND (persistent OR expires_at>now())',[id,userId]);
  if (!result.rowCount) throw httpError(404,'Media not found');
  return {bytes:await readFile(mediaPath(ctx.config.mediaRoot,id)),mimeType:result.rows[0].mime_type};
}
export async function readReference(ctx: Context, userId: string, reference: Record<string,unknown>) {
  if (typeof reference.dataUrl==='string') { const bytes=decodeDataUrl(reference.dataUrl); return {bytes,mimeType:sniffMedia(bytes)}; }
  const raw = String(reference.url || '');
  const url = new URL(raw,ctx.config.origin);
  if (url.origin === new URL(ctx.config.origin).origin && /^\/api\/(?:media|reference-assets|generation-log-assets)\//.test(url.pathname)) return ownedMedia(ctx,userId,url.pathname.split('/').pop()!);
  if (!/^https?:$/.test(url.protocol) || !/^https?:\/\//.test(raw)) throw httpError(400,'Reference must be an owned asset or public HTTPS URL');
  const response = await safeFetch(url.toString(), {maxBytes:MAX_MEDIA_BYTES, timeoutMs:30000});
  if (!response.ok) throw httpError(400,'Reference could not be downloaded');
  const bytes = Buffer.from(await response.arrayBuffer()); return {bytes,mimeType:sniffMedia(bytes)};
}
export async function validateLibraryMedia(ctx: Context, userId: string, input: Record<string,any>) {
  if (input.kind==='text') return;
  const data=input.data||{}; const id=String(data.storageKey||data.key||'');
  const raw=String(data.serverUrl||data.url||data.remoteUrl||data.dataUrl||'');
  let parsed:URL;try{parsed=new URL(raw||`/api/reference-assets/${id}`,ctx.config.origin);}catch{throw httpError(400,'Invalid library media URL');}
  if(parsed.origin!==new URL(ctx.config.origin).origin || !/^\/api\/(?:media|reference-assets|generation-log-assets)\/[a-f0-9-]{36}$/i.test(parsed.pathname)) throw httpError(400,'Library media must be uploaded to this account first');
  const mediaId=parsed.pathname.split('/').pop()!;
  const found=await ctx.db.query('SELECT mime_type FROM oaooao_media WHERE id=$1 AND user_id=$2 AND persistent=true',[mediaId,userId]);
  if(!found.rowCount) throw httpError(404,'Persistent media not found');
  if(!String(found.rows[0].mime_type).startsWith(input.kind+'/')) throw httpError(400,'Asset kind does not match media');
  input.data={...data,storageKey:mediaId,url:`/api/reference-assets/${mediaId}`,serverUrl:`/api/reference-assets/${mediaId}`};
}
function encoder(args:string[], timeout=120000,cwd?:string):Promise<void>{
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(process.env.FFMPEG_PATH||'ffmpeg',args,{windowsHide:true,stdio:'ignore',shell:false,cwd});
    const timer=setTimeout(()=>{child.kill();reject(httpError(504,'Video render timed out'));},timeout);
    child.once('error',()=>{clearTimeout(timer);reject(httpError(503,'FFmpeg encoder is unavailable'));});
    child.once('exit',code=>{clearTimeout(timer);if(code===0)resolvePromise();else reject(httpError(422,'FFmpeg could not render these clips'));});
  });
}
async function inspectTool(binary:string,args:string[],cwd?:string):Promise<string>{
  return new Promise((done,reject)=>{const child=spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','ignore'],shell:false,cwd});const chunks:Buffer[]=[];let size=0;const timer=setTimeout(()=>{child.kill();reject(httpError(503,'Media inspection timed out'));},10000);child.stdout.on('data',(part:Buffer)=>{size+=part.length;if(size>1024*1024){child.kill();reject(httpError(503,'Media inspection output exceeded limit'));}else chunks.push(part);});child.once('error',()=>{clearTimeout(timer);reject(httpError(503,'Required media tool is unavailable'));});child.once('exit',code=>{clearTimeout(timer);if(code===0)done(Buffer.concat(chunks).toString('utf8'));else reject(httpError(422,'Media could not be inspected'));});});
}
const ffprobePath=()=>process.env.FFPROBE_PATH||(process.env.FFMPEG_PATH?join(dirname(process.env.FFMPEG_PATH),process.platform==='win32'?'ffprobe.exe':'ffprobe'):'ffprobe');
export async function encoderAvailable(){
  const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';const filters=await inspectTool(ffmpeg,['-hide_banner','-filters']);if(!/\bsubtitles\b/.test(filters))throw httpError(503,'FFmpeg subtitle filter is unavailable');const encoders=await inspectTool(ffmpeg,['-hide_banner','-encoders']);if(!/\blibx264\b/.test(encoders)||!/\baac\b/.test(encoders))throw httpError(503,'FFmpeg H.264/AAC encoders are unavailable');await inspectTool(ffprobePath(),['-version']);
}
export type RenderShot={mediaId:string;audioMediaId?:string;audioMode:'source'|'voiceover'|'mute';subtitle:string;duration:number};
function subtitleTime(seconds:number){const ms=Math.round(seconds*1000);const h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}
export function renderSubtitles(shots:RenderShot[]){let elapsed=0,index=1;const lines=[];for(const shot of shots){const text=shot.subtitle.replace(/[<>\\{}]/g,'').replace(/[\u0000-\u0008\u000b-\u001f]/g,'').replace(/-->/g,'→').replace(/\r?\n\s*\r?\n/g,'\n').slice(0,2000);if(text.trim())lines.push(`${index++}\n${subtitleTime(elapsed)} --> ${subtitleTime(elapsed+shot.duration)}\n${text}\n`);elapsed+=shot.duration;}return lines.join('\n');}
export async function renderShots(ctx:Context,userId:string,shots:RenderShot[],ratio:string){
  if(!shots.length||shots.length>100||shots.some(s=>!Number.isFinite(s.duration)||s.duration<0.1||s.duration>120)||shots.reduce((n,s)=>n+s.duration,0)>600)throw httpError(400,'Render duration or shot count exceeds the limit');
  const dimensions:Record<string,[number,number]>={'9:16':[720,1280],'16:9':[1280,720],'1:1':[720,720],'4:3':[960,720],'3:4':[720,960]};const size=dimensions[ratio];if(!size)throw httpError(400,'Unsupported render aspect ratio');
  await encoderAvailable();const directory=await mkdtemp(join(tmpdir(),'oaooao-render-'));let sourceBytes=0,workingBytes=0;
  try{
    const files=[];
    for(let i=0;i<shots.length;i++){
      const shot=shots[i],source=await ownedMedia(ctx,userId,shot.mediaId);sourceBytes+=source.bytes.length;if(sourceBytes>100*1024*1024)throw httpError(413,'Render sources exceed 100 MiB');if(!source.mimeType.startsWith('video/'))throw httpError(400,'Render source must be video');
      const video=`video-${i}.media`;await writeFile(join(directory,video),source.bytes);
      const metadata=JSON.parse(await inspectTool(ffprobePath(),['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',video],directory));
      if(!metadata.streams?.some((s:any)=>s.codec_type==='video'))throw httpError(422,'Source contains no usable video stream');
      const args=['-nostdin','-y','-threads','2','-protocol_whitelist','file,pipe','-i',video];let audio='0:a:0';
      if(shot.audioMode==='voiceover'){
        if(!shot.audioMediaId)throw httpError(400,'Voiceover audio is required');const voice=await ownedMedia(ctx,userId,shot.audioMediaId);sourceBytes+=voice.bytes.length;if(sourceBytes>100*1024*1024)throw httpError(413,'Render sources exceed 100 MiB');if(!voice.mimeType.startsWith('audio/'))throw httpError(400,'Voiceover source must be audio');const audioFile=`audio-${i}.media`;await writeFile(join(directory,audioFile),voice.bytes);args.push('-protocol_whitelist','file,pipe','-i',audioFile);audio='1:a:0';
      }else if(shot.audioMode==='mute'||!metadata.streams.some((s:any)=>s.codec_type==='audio')){args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');audio='1:a:0';}
      const normalized=`normalized-${i}.mp4`;
      args.push('-map','0:v:0','-map',audio,'-vf',`scale=${size[0]}:${size[1]}:force_original_aspect_ratio=decrease,pad=${size[0]}:${size[1]}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${shot.duration}`,'-af','apad','-t',String(shot.duration),'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-ar','48000','-fs',String(MAX_MEDIA_BYTES+1),normalized);
      await encoder(args,120000,directory);const outputSize=(await stat(join(directory,normalized))).size;if(outputSize>MAX_MEDIA_BYTES)throw httpError(413,'Rendered clip exceeds size limit');workingBytes+=outputSize;if(workingBytes>200*1024*1024)throw httpError(413,'Render working set exceeds size limit');files.push(`file '${normalized}'`);
    }
    await writeFile(join(directory,'clips.txt'),files.join('\n'));const subtitles=renderSubtitles(shots);if(subtitles)await writeFile(join(directory,'captions.srt'),subtitles,'utf8');
    const args=['-nostdin','-y','-threads','2','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i','clips.txt','-map','0:v:0','-map','0:a:0'];
    if(subtitles)args.push('-vf','subtitles=filename=captions.srt','-c:v','libx264','-preset','veryfast','-crf','23');else args.push('-c:v','copy');
    args.push('-c:a','copy','-t',String(shots.reduce((n,s)=>n+s.duration,0)),'-movflags','+faststart','-fs',String(MAX_MEDIA_BYTES+1),'output.mp4');await encoder(args,120000,directory);
    const file=join(directory,'output.mp4');if((await stat(file)).size>MAX_MEDIA_BYTES)throw httpError(413,'Rendered video exceeds size limit');
    const completed=JSON.parse(await inspectTool(ffprobePath(),['-v','error','-show_format','-of','json','output.mp4'],directory));if(!Number.isFinite(Number(completed.format?.duration))||Number(completed.format.duration)<shots.reduce((n,s)=>n+s.duration,0)-0.2)throw httpError(422,'Encoder output is shorter than the requested timeline');
    return await saveMedia(ctx,userId,await readFile(file));
  }finally{const root=resolve(tmpdir()),target=resolve(directory);if(!target.startsWith(root+(process.platform==='win32'?'\\':'/'))||!target.includes('oaooao-render-'))throw Error('Unsafe render temporary path');await rm(target,{recursive:true,force:true});}
}
export async function registerMedia(app: FastifyInstance, ctx: Context) {
  app.post('/api/reference-assets',{bodyLimit:34*1024*1024},async request=>{
    const user=await ctx.requireUser(request); let bytes:Buffer; let persistent=false; let expected='';
    if(request.isMultipart()){
      let file:Buffer|undefined;
      for await(const part of request.parts({limits:{fileSize:MAX_MEDIA_BYTES,files:1,fields:3}})){
        if(part.type==='file') file=await part.toBuffer();
        else if(part.fieldname==='persistent')persistent=part.value==='true';
        else if(part.fieldname==='type')expected=String(part.value);
      }
      if(!file)throw httpError(400,'File is required'); bytes=file;
    }else{const body=request.body as any;bytes=decodeDataUrl(String(body?.dataUrl||''));persistent=body?.persistent===true;expected=String(body?.type||'');}
    const mime=sniffMedia(bytes);if(expected&&!mime.startsWith(expected+'/'))throw httpError(400,'Media type does not match file');
    return saveMedia(ctx,user.id,bytes,persistent);
  });
  for(const route of ['/api/media/:id','/api/reference-assets/:id','/api/generation-log-assets/:id'])app.get(route,async(request,reply)=>{
    const {id}=request.params as {id:string};mediaPath(ctx.config.mediaRoot,id);
    const row=(await ctx.db.query('SELECT *,expires_at>now() token_valid FROM oaooao_media WHERE id=$1',[id])).rows[0];
    if(!row)throw httpError(404,'Media not found');
    const token=String((request.query as any).token||'');
    const valid=token.length>0&&token.length<256&&row.access_token_hash&&row.token_valid&&timingSafeEqual(Buffer.from(digest(token)),Buffer.from(row.access_token_hash));
    if(!valid){const user=await ctx.requireUser(request);if(user.id!==row.user_id||(!row.persistent&&!row.token_valid))throw httpError(404,'Media not found');}
    reply.header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store').type(row.mime_type);
    return reply.send(await readFile(mediaPath(ctx.config.mediaRoot,id)));
  });
}
