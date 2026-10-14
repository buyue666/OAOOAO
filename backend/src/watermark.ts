import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import type {FastifyInstance} from 'fastify';
import {httpError,iso,object,rateLimit,transaction,type Context} from './core.js';
import {MAX_MEDIA_BYTES,ownedMedia,mediaPath} from './media.js';

export const WATERMARK_POLICY_VERSION='ai-watermark-v1';
const LABEL='OAOOAO | AI generated';
const MAX_EXPORT_BYTES=48*1024*1024;
type Preference={enabled:boolean;policyVersion:string;acknowledgedPolicyVersion:string|null;acknowledgedAt:string|null};
export async function watermarkPreference(ctx:Context,userId:string):Promise<Preference>{
  const row=(await ctx.db.query('SELECT enabled,acknowledged_policy_version,acknowledged_at FROM oaooao_watermark_preferences WHERE user_id=$1',[userId])).rows[0];
  return {enabled:row?.enabled!==false||row.acknowledged_policy_version!==WATERMARK_POLICY_VERSION,policyVersion:WATERMARK_POLICY_VERSION,acknowledgedPolicyVersion:row?.acknowledged_policy_version??null,acknowledgedAt:iso(row?.acknowledged_at)??null};
}
/** Only server-owned successful job/history outputs establish AI provenance. */
export async function isGeneratedMedia(ctx:Context,userId:string,id:string):Promise<boolean>{
  const pending=[id],seen=new Set<string>();
  while(pending.length){
    const mediaId=pending.shift()!;if(seen.has(mediaId))continue;seen.add(mediaId);if(seen.size>256)throw httpError(422,'The export provenance chain is too large to verify');
    const urls=['reference-assets','media','generation-log-assets'].flatMap(route=>{const path=`/api/${route}/${mediaId}`;return[path,`${ctx.config.origin}${path}`];});
    const result=await ctx.db.query(`SELECT kind,input FROM oaooao_generation_jobs j WHERE user_id=$1 AND kind IN ('image','video','render') AND status='success'
      AND EXISTS (SELECT 1 FROM unnest($2::text[]) url WHERE j.result @> jsonb_build_object('url',url) OR j.result @> jsonb_build_object('remoteUrl',url) OR j.result @> jsonb_build_object('results',jsonb_build_array(jsonb_build_object('url',url))))
    UNION ALL SELECT document->>'kind' kind,'{}'::jsonb input FROM oaooao_generation_history h WHERE user_id=$1 AND document->>'kind' IN ('image','video') AND document->>'status'='success'
      AND EXISTS (SELECT 1 FROM unnest($2::text[]) url WHERE h.document->'assets' @> jsonb_build_array(jsonb_build_object('url',url)))
    `,[userId,urls]);
    if(result.rows.some(row=>row.kind==='image'||row.kind==='video'))return true;
    for(const row of result.rows)if(row.kind==='render'&&Array.isArray(row.input?.shots))for(const shot of row.input.shots){const source=shot?.mediaId;if(typeof source==='string'&&/^[a-f0-9-]{36}$/i.test(source)&&!seen.has(source))pending.push(source);}
  }
  return false;
}
function tool(binary:string,args:string[],cwd:string,timeout:number,maxOutput=1024*1024):Promise<Buffer>{
  return new Promise((done,reject)=>{
    const child=spawn(binary,args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});let settled=false,size=0;const chunks:Buffer[]=[];
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else done(Buffer.concat(chunks));};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(httpError(504,'Media export timed out'));},timeout);
    child.stdout.on('data',(part:Buffer)=>{size+=part.length;if(size>maxOutput){child.kill('SIGKILL');finish(httpError(422,'Media inspection exceeded limit'));}else chunks.push(part);});
    child.once('error',()=>finish(httpError(503,'Required media export tool is unavailable')));
    child.once('exit',code=>finish(code===0?undefined:httpError(422,'Media could not be exported with an AI label')));
  });
}
const ffmpeg=()=>process.env.FFMPEG_PATH||'ffmpeg';
const ffprobe=()=>process.env.FFPROBE_PATH||(process.env.FFMPEG_PATH?join(dirname(process.env.FFMPEG_PATH),process.platform==='win32'?'ffprobe.exe':'ffprobe'):'ffprobe');
function chunksPng(bytes:Buffer){const parts:{type:string;raw:Buffer}[]=[];let offset=8;while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset);if(length>bytes.length-offset-12)throw httpError(422,'Invalid PNG metadata');const raw=bytes.subarray(offset,offset+length+12);parts.push({type:raw.subarray(4,8).toString('ascii'),raw});offset+=length+12;}if(offset!==bytes.length||parts.at(-1)?.type!=='IEND')throw httpError(422,'Invalid PNG structure');return parts;}
function jpegMetadata(bytes:Buffer){const parts:Buffer[]=[];let offset=2;while(offset+4<=bytes.length){if(bytes[offset]!==255)throw httpError(422,'Invalid JPEG metadata');const marker=bytes[offset+1];if(marker===218||marker===217)break;const length=bytes.readUInt16BE(offset+2);if(length<2||offset+length+2>bytes.length)throw httpError(422,'Invalid JPEG structure');if([225,226,227,228,229,230,231,232,233,234,235,236,237,239,254].includes(marker))parts.push(bytes.subarray(offset,offset+length+2));offset+=length+2;}return parts;}
function chunksWebp(bytes:Buffer){const parts:{type:string;raw:Buffer}[]=[];let offset=12;while(offset+8<=bytes.length){const size=bytes.readUInt32LE(offset+4),length=8+size+(size%2);if(length>bytes.length-offset)throw httpError(422,'Invalid WebP metadata');parts.push({type:bytes.subarray(offset,offset+4).toString('ascii'),raw:bytes.subarray(offset,offset+length)});offset+=length;}if(offset!==bytes.length)throw httpError(422,'Invalid WebP structure');return parts;}
function exifOrientation(bytes:Buffer,start=0):{offset:number;little:boolean;value:number}|undefined {
  if(bytes.subarray(start,start+6).equals(Buffer.from('Exif\0\0')))start+=6;
  const marker=bytes.subarray(start,start+2).toString('ascii'),little=marker==='II';if(!little&&marker!=='MM'||start+8>bytes.length)return;
  const u16=(offset:number)=>little?bytes.readUInt16LE(offset):bytes.readUInt16BE(offset),u32=(offset:number)=>little?bytes.readUInt32LE(offset):bytes.readUInt32BE(offset);
  if(u16(start+2)!==42)return;const ifd=start+u32(start+4);if(ifd+2>bytes.length)return;const count=u16(ifd);if(count>1024||ifd+2+count*12>bytes.length)return;
  for(let i=0;i<count;i++){const entry=ifd+2+i*12;if(u16(entry)===0x112&&u16(entry+2)===3&&u32(entry+4)===1){const value=u16(entry+8);if(value>=1&&value<=8)return {offset:entry+8,little,value};}}
}
function normalizeOrientation(bytes:Buffer,start:number){const orientation=exifOrientation(bytes,start);if(!orientation||orientation.value===1)return bytes;const output=Buffer.from(bytes);if(orientation.little)output.writeUInt16LE(1,orientation.offset);else output.writeUInt16BE(1,orientation.offset);return output;}
function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function imageOrientation(bytes:Buffer,mime:string):number {
  const candidates=mime==='image/jpeg'?jpegMetadata(bytes).filter(part=>part[1]===225).map(part=>part.subarray(4)):mime==='image/png'?chunksPng(bytes).filter(part=>part.type==='eXIf').map(part=>part.raw.subarray(8,part.raw.length-4)):mime==='image/webp'?chunksWebp(bytes).filter(part=>part.type==='EXIF').map(part=>part.raw.subarray(8)):[];
  return candidates.map(part=>exifOrientation(part)?.value).find(value=>value!==undefined)??1;
}
/** Retain original EXIF/XMP/ICC/text metadata where the image container permits it. */
export function retainImageMetadata(source:Buffer,output:Buffer,mime:string):Buffer {
  if(mime==='image/png'){
    const types=new Set(['eXIf','iCCP','tEXt','zTXt','iTXt']);const original=chunksPng(source).filter(part=>types.has(part.type)).map(part=>{if(part.type!=='eXIf')return part.raw;const raw=normalizeOrientation(part.raw,8);if(raw!==part.raw)raw.writeUInt32BE(crc32(raw.subarray(4,raw.length-4)),raw.length-4);return raw;});const encoded=chunksPng(output).filter(part=>!types.has(part.type));return Buffer.concat([output.subarray(0,8),...encoded.flatMap(part=>part.type==='IHDR'?[part.raw,...original]:[part.raw])]);
  }
  if(mime==='image/jpeg'){
    const original=jpegMetadata(source).map(part=>part[1]===225?normalizeOrientation(part,4):part);const encoded=jpegMetadata(output);let retained=output;for(const part of encoded){const position=retained.indexOf(part,2);if(position>=0)retained=Buffer.concat([retained.subarray(0,position),retained.subarray(position+part.length)]);}return Buffer.concat([retained.subarray(0,2),...original,retained.subarray(2)]);
  }
  if(mime==='image/webp'){
    const original=chunksWebp(source).filter(part=>['EXIF','XMP ','ICCP'].includes(part.type)).map(part=>part.type==='EXIF'?{...part,raw:normalizeOrientation(part.raw,8)}:part);if(!original.length)return output;
    const encoded=chunksWebp(output).filter(part=>!['EXIF','XMP ','ICCP'].includes(part.type));let extended=encoded.find(part=>part.type==='VP8X');
    if(!extended){const lossless=encoded.find(part=>part.type==='VP8L');if(!lossless||lossless.raw.length<13||lossless.raw[8]!==0x2f)throw httpError(422,'Cannot preserve the source WebP metadata in this export');const dimensions=lossless.raw.readUInt32LE(9),header=Buffer.alloc(18);header.write('VP8X',0,'ascii');header.writeUInt32LE(10,4);header[8]=(dimensions>>>28)&1?0x10:0;header.writeUIntLE(dimensions&0x3fff,12,3);header.writeUIntLE((dimensions>>>14)&0x3fff,15,3);extended={type:'VP8X',raw:header};encoded.unshift(extended);}
    const header=Buffer.from(extended.raw);header[8]|=original.reduce((bits,part)=>bits|(part.type==='EXIF'?8:part.type==='XMP '?4:32),0);extended.raw=header;
    const bytes=Buffer.concat([output.subarray(0,12),...encoded.flatMap(part=>part.type==='VP8X'?[part.raw,...original.filter(item=>item.type==='ICCP').map(item=>item.raw)]:[part.raw]),...original.filter(part=>part.type!=='ICCP').map(part=>part.raw)]);bytes.writeUInt32LE(bytes.length-8,4);return bytes;
  }
  return output;
}
export async function labelMedia(bytes:Buffer,mimeType:string):Promise<{bytes:Buffer;mimeType:string;extension:string}> {
  const image=['image/png','image/jpeg','image/webp'].includes(mimeType),video=['video/mp4','video/webm'].includes(mimeType);
  if(!image&&!video)throw httpError(415,'AI-labelled export supports PNG, JPEG, static WebP, MP4 and WebM sources');
  // Signed provenance cannot simply be copied to altered pixels and remain valid.
  if(/c2pa|jumbf/iu.test(bytes.toString('latin1')))throw httpError(422,'This file contains signed provenance. Labelled export cannot preserve its signature; the original remains unchanged.');
  if(mimeType==='image/webp'&&chunksWebp(bytes).some(part=>['ANIM','ANMF'].includes(part.type)))throw httpError(415,'Animated WebP labelled export is not supported');
  const directory=await mkdtemp(join(tmpdir(),'oaooao-export-'));
  try{
    await writeFile(join(directory,'source.media'),bytes);
    const metadata=JSON.parse((await tool(ffprobe(),['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json','source.media'],directory,10000)).toString('utf8'));
    const stream=metadata.streams?.find((item:any)=>item.codec_type==='video');let width=Number(stream?.width),height=Number(stream?.height);
    const orientation=image?imageOrientation(bytes,mimeType):1,rotation=Number(stream?.side_data_list?.find((item:any)=>item.rotation!==undefined)?.rotation||0);
    if(orientation>=5||video&&Math.abs(rotation)%180===90)[width,height]=[height,width];
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<160||height<16||width*height>40_000_000||width>8192||height>8192)throw httpError(422,'Labelled export requires a displayed width of at least 160 pixels and dimensions within 8192 pixels / 40 megapixels');
    if(video&&(!Number.isFinite(Number(metadata.format?.duration))||Number(metadata.format.duration)>600||metadata.streams.some((item:any)=>!['video','audio'].includes(item.codec_type))))throw httpError(422,'Video duration or extra streams cannot be safely preserved by this exporter');
    const fontSize=Math.max(10,Math.min(28,Math.floor(width/25))),strip=Math.max(28,fontSize+16);
    // A separate footer never covers or crops an existing provider label.
    const transforms:Record<number,string>={2:'hflip,',3:'hflip,vflip,',4:'vflip,',5:'transpose=clock,hflip,',6:'transpose=clock,',7:'transpose=clock,vflip,',8:'transpose=cclock,'};
    const filter=`${transforms[orientation]||''}pad=ceil(iw/2)*2:ceil((ih+${strip})/2)*2:0:0:color=0x101619,drawtext=textfile=label.txt:fontcolor=white:fontsize=${fontSize}:x=(w-tw)/2:y=${height}+(${strip}-th)/2`;
    await writeFile(join(directory,'label.txt'),LABEL,'utf8');
    const extension=video?'mp4':mimeType==='image/jpeg'?'jpg':mimeType==='image/webp'?'webp':'png',output=`output.${extension}`;
    const args=['-nostdin','-y','-threads','2','-protocol_whitelist','file,pipe',...(image?['-noautorotate']:[]),'-i','source.media','-map','0:v:0','-map_metadata','0','-vf',filter];
    if(video)args.push('-map','0:a?','-map_chapters','0','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart+use_metadata_tags');
    else args.push('-frames:v','1',...(mimeType==='image/jpeg'?['-q:v','2']:mimeType==='image/webp'?['-c:v','libwebp','-lossless','1']:['-c:v','png']));
    args.push('-fs',String(MAX_EXPORT_BYTES+1),output);await tool(ffmpeg(),args,directory,120000);
    if((await stat(join(directory,output))).size>MAX_EXPORT_BYTES)throw httpError(413,'Labelled export exceeds output size limit');
    let encoded:Buffer=await readFile(join(directory,output));if(image)encoded=retainImageMetadata(bytes,encoded,mimeType);
    if(encoded.length>MAX_EXPORT_BYTES)throw httpError(413,'Labelled export exceeds output size limit');
    return {bytes:encoded,mimeType:video?'video/mp4':mimeType,extension};
  }finally{const target=resolve(directory),root=resolve(tmpdir());if(!target.startsWith(root+sep)||!target.includes('oaooao-export-'))throw new Error('Unsafe export temporary directory');await rm(target,{recursive:true,force:true});}
}
const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','audio/wav':'wav','audio/ogg':'ogg','audio/flac':'flac','audio/aac':'aac','audio/mpeg':'mp3'};
export async function registerWatermark(app:FastifyInstance,ctx:Context){
  const active=new Set<string>();
  app.get('/api/account/watermark-preference',async request=>{const user=await ctx.requireUser(request);return {watermark:await watermarkPreference(ctx,user.id)};});
  app.patch('/api/account/watermark-preference',async request=>{
    const user=await ctx.requireUser(request),body=object(request.body);
    if(Object.keys(body).some(key=>!['enabled','acknowledgedPolicyVersion'].includes(key))||typeof body.enabled!=='boolean')throw httpError(400,'Invalid watermark preference');
    if(body.enabled===false&&body.acknowledgedPolicyVersion!==WATERMARK_POLICY_VERSION)throw httpError(400,'Read and acknowledge the current AI labelling policy before disabling the label');
    await transaction(ctx.db,async client=>{
      await client.query('SELECT id FROM oaooao_users WHERE id=$1 FOR UPDATE',[user.id]);
      await client.query(`INSERT INTO oaooao_watermark_preferences(user_id,enabled,acknowledged_policy_version,acknowledged_at) VALUES($1,$2,$3,CASE WHEN $2=false THEN now() ELSE NULL END)
        ON CONFLICT(user_id) DO UPDATE SET enabled=$2,acknowledged_policy_version=CASE WHEN $2=false THEN $3 ELSE oaooao_watermark_preferences.acknowledged_policy_version END,acknowledged_at=CASE WHEN $2=false THEN now() ELSE oaooao_watermark_preferences.acknowledged_at END,updated_at=now()`,[user.id,body.enabled,body.enabled?null:WATERMARK_POLICY_VERSION]);
      await client.query('INSERT INTO oaooao_watermark_events(id,user_id,event_type,policy_version) VALUES($1,$2,$3,$4)',[randomUUID(),user.id,body.enabled?'preference_enabled':'preference_disabled',WATERMARK_POLICY_VERSION]);
      await ctx.audit({actorId:user.id,action:'watermark.preference',targetType:'user',targetId:user.id,metadata:{enabled:body.enabled,policyVersion:WATERMARK_POLICY_VERSION}},client);
    });
    return {watermark:await watermarkPreference(ctx,user.id)};
  });
  app.post('/api/media/:id/export',async(request,reply)=>{
    const user=await ctx.requireUser(request),id=String((request.params as any).id);mediaPath(ctx.config.mediaRoot,id);
    if(request.body!==undefined&&request.body!==null&&Object.keys(object(request.body)).length)throw httpError(400,'Export uses the saved account preference and accepts no overrides');
    await rateLimit(ctx,`media-export:${user.id}`,20,60);
    if(active.has(user.id)||active.size>=2)throw httpError(429,'Another media export is in progress; retry shortly');
    active.add(user.id);
    try{
      const source=await ownedMedia(ctx,user.id,id);if(source.bytes.length>MAX_MEDIA_BYTES)throw httpError(413,'Source media exceeds export limit');
      const generated=await isGeneratedMedia(ctx,user.id,id),preference=await watermarkPreference(ctx,user.id),applied=generated&&preference.enabled;
      const output=applied?await labelMedia(source.bytes,source.mimeType):{...source,extension:extensions[source.mimeType]||'bin'};
      if(generated)await ctx.db.query('INSERT INTO oaooao_watermark_events(id,user_id,event_type,media_id,policy_version) VALUES($1,$2,$3,$4,$5)',[randomUUID(),user.id,applied?'export_with_label':'export_without_label',id,WATERMARK_POLICY_VERSION]);
      return reply.type(output.mimeType).header('Content-Disposition',`attachment; filename="OAOOAO-${id}.${output.extension}"`).header('X-OAO-AI-Generated',String(generated)).header('X-OAO-Watermark-Applied',String(applied)).header('Cache-Control','private, no-store').send(output.bytes);
    }finally{active.delete(user.id);}
  });
}
