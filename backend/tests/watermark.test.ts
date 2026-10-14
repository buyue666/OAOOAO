import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {mediaPath,saveMedia} from '../src/media.js';
import {isGeneratedMedia,WATERMARK_POLICY_VERSION,labelMedia} from '../src/watermark.js';
import {createTestDatabase} from './core-helpers.js';

const run=promisify(execFile),ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',ffprobe=process.env.FFPROBE_PATH||'ffprobe';
async function fixture(){
  const database=await createTestDatabase(),app=await buildApp({db:database.db,config:database.config});
  const headers:Record<string,Record<string,string>>={};
  for(const user of ['synthetic-export-owner','synthetic-export-other']){const token=randomBytes(32).toString('base64url');await database.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,'synthetic-unused')",[user]);await database.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),user]);headers[user]={cookie:`oaooao_session=${token}`,origin:database.config.origin};}
  return {...database,app,owner:'synthetic-export-owner',headers:headers['synthetic-export-owner'],otherHeaders:headers['synthetic-export-other'],async close(){await app.close();await database.cleanup();}};
}
async function job(f:Awaited<ReturnType<typeof fixture>>,url:string,kind='image',status='success'){
  const id=randomUUID();await f.db.query("INSERT INTO oaooao_generation_jobs(id,user_id,kind,client_request_id,input_hash,input,model,status,phase,cost,result) VALUES($1,$2,$3,$1,'synthetic','{}','synthetic',$4,'complete',0,$5)",[id,f.owner,kind,status,JSON.stringify({results:[{url}]})]);return id;
}
function pngText(bytes:Buffer,text:string){
  const content=Buffer.from(`Comment\0${text}`,'utf8'),type=Buffer.from('tEXt'),raw=Buffer.concat([type,content]);let crc=0xffffffff;for(const byte of raw){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const chunk=Buffer.alloc(content.length+12);chunk.writeUInt32BE(content.length,0);raw.copy(chunk,4);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);return Buffer.concat([bytes.subarray(0,bytes.length-12),chunk,bytes.subarray(bytes.length-12)]);
}
async function createPng(root:string){
  const path=join(root,'synthetic.png');await run(ffmpeg,['-nostdin','-y','-f','lavfi','-i','color=c=red:s=320x180','-vf',"drawtext=text='UPSTREAM AI':fontcolor=white:fontsize=18:x=12:y=12",'-frames:v','1','-threads','1',path],{windowsHide:true,timeout:30000});return pngText(await readFile(path),'upstream AI metadata retained');
}

test('account preference defaults on, requires current acknowledgment, persists across sessions, and rolls back its durable evidence',async t=>{
  const f=await fixture();t.after(()=>f.close());
  assert.equal((await f.app.inject({url:'/api/account/watermark-preference'})).statusCode,401);
  const read=()=>f.app.inject({url:'/api/account/watermark-preference',headers:f.headers});
  assert.deepEqual((await read()).json().watermark,{enabled:true,policyVersion:WATERMARK_POLICY_VERSION,acknowledgedPolicyVersion:null,acknowledgedAt:null});
  for(const payload of [{enabled:false},{enabled:false,acknowledgedPolicyVersion:'old'},{enabled:'false'},{enabled:true,userId:'synthetic-export-other'}])assert.equal((await f.app.inject({method:'PATCH',url:'/api/account/watermark-preference',headers:f.headers,payload})).statusCode,400);
  const saved=await f.app.inject({method:'PATCH',url:'/api/account/watermark-preference',headers:f.headers,payload:{enabled:false,acknowledgedPolicyVersion:WATERMARK_POLICY_VERSION}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().watermark.enabled,false);assert.ok(saved.json().watermark.acknowledgedAt);
  const second=await buildApp({db:f.db,config:f.config,coreOnly:true});try{assert.equal((await second.inject({url:'/api/account/watermark-preference',headers:f.headers})).json().watermark.enabled,false);}finally{await second.close();}
  assert.equal((await f.app.inject({url:'/api/account/watermark-preference',headers:f.otherHeaders})).json().watermark.enabled,true);
  const events=await f.db.query("SELECT event_type,policy_version,retain_until>=created_at+interval '6 months' retained FROM oaooao_watermark_events");assert.deepEqual(events.rows,[{event_type:'preference_disabled',policy_version:WATERMARK_POLICY_VERSION,retained:true}]);
  await assert.rejects(f.db.query("UPDATE oaooao_watermark_events SET retain_until=created_at+interval '30 days'"),{code:'23514'});
  const originalAudit=f.app.ctx.audit;f.app.ctx.audit=async()=>{throw new Error('Synthetic transaction rollback');};
  assert.equal((await f.app.inject({method:'PATCH',url:'/api/account/watermark-preference',headers:f.headers,payload:{enabled:true}})).statusCode,500);f.app.ctx.audit=originalAudit;
  assert.equal((await read()).json().watermark.enabled,false);assert.equal((await f.db.query('SELECT count(*) FROM oaooao_watermark_events')).rows[0].count,'1');
  assert.equal((await f.app.inject({method:'PATCH',url:'/api/account/watermark-preference',headers:f.headers,payload:{enabled:true}})).statusCode,200);assert.equal((await read()).json().watermark.enabled,true);
  await f.db.query("UPDATE oaooao_watermark_preferences SET enabled=false,acknowledged_policy_version='old-version' WHERE user_id=$1",[f.owner]);
  assert.equal((await read()).json().watermark.enabled,true,'An old policy acknowledgment cannot disable the current label');
});

test('real image export burns the label outside original pixels, preserves metadata, respects ownership and keeps ordinary uploads untouched',async t=>{
  const f=await fixture();t.after(()=>f.close());const bytes=await createPng(f.config.mediaRoot),media=await saveMedia(f.app.ctx,f.owner,bytes);const url=`/api/media/${media.key}/export`;
  assert.equal((await f.app.inject({method:'POST',url,headers:{origin:f.config.origin}})).statusCode,401);
  assert.equal((await f.app.inject({method:'POST',url,headers:f.otherHeaders})).statusCode,404);
  const uploaded=await f.app.inject({method:'POST',url,headers:f.headers});assert.equal(uploaded.statusCode,200,uploaded.body);assert.deepEqual(uploaded.rawPayload,bytes);assert.equal(uploaded.headers['x-oao-ai-generated'],'false');assert.equal(uploaded.headers['x-oao-watermark-applied'],'false');
  const pending=await job(f,media.url,'image','pending');assert.equal(await isGeneratedMedia(f.app.ctx,f.owner,media.key),false);await f.db.query("UPDATE oaooao_generation_jobs SET status='success' WHERE id=$1",[pending]);
  const exported=await f.app.inject({method:'POST',url,headers:f.headers});assert.equal(exported.statusCode,200,exported.body.slice(0,200));assert.equal(exported.headers['x-oao-watermark-applied'],'true');assert.match(String(exported.headers['content-disposition']),/\.png/);assert.ok(exported.rawPayload.includes(Buffer.from('upstream AI metadata retained')));
  const output=join(f.config.mediaRoot,'exported.png');await writeFile(output,exported.rawPayload);
  const probe=JSON.parse((await run(ffprobe,['-v','error','-show_streams','-of','json',output],{windowsHide:true,timeout:10000})).stdout);assert.equal(probe.streams[0].width,320);assert.ok(probe.streams[0].height>180);
  const decode=async(path:string,filter:string)=>{const result=await run(ffmpeg,['-v','error','-i',path,'-vf',filter,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,timeout:10000,encoding:'buffer',maxBuffer:4*1024*1024});return result.stdout;};
  const originalPixels=await decode(mediaPath(f.config.mediaRoot,media.key),'crop=320:180:0:0'),exportedPixels=await decode(output,'crop=320:180:0:0');assert.deepEqual(exportedPixels,originalPixels,'Original pixels and upstream visible label must be unchanged');
  const strip=await decode(output,'crop=320:28:0:180');let white=0;for(let index=0;index<strip.length;index+=3)if(strip[index]>210&&strip[index+1]>210&&strip[index+2]>210)white++;assert.ok(white>20,'AI text must be encoded in the footer, not merely returned in headers');
  assert.deepEqual(await readFile(mediaPath(f.config.mediaRoot,media.key)),bytes,'No source rewriting');
  assert.equal((await f.app.inject({method:'POST',url,headers:f.headers,payload:{enabled:false}})).statusCode,400);
  await f.app.inject({method:'PATCH',url:'/api/account/watermark-preference',headers:f.headers,payload:{enabled:false,acknowledgedPolicyVersion:WATERMARK_POLICY_VERSION}});
  const original=await f.app.inject({method:'POST',url,headers:f.headers});assert.equal(original.statusCode,200);assert.deepEqual(original.rawPayload,bytes);assert.equal(original.headers['x-oao-watermark-applied'],'false');
  const evidence=(await f.db.query("SELECT event_type,media_id,policy_version,retain_until>=created_at+interval '6 months' retained FROM oaooao_watermark_events WHERE event_type='export_without_label'")).rows;assert.deepEqual(evidence,[{event_type:'export_without_label',media_id:media.key,policy_version:WATERMARK_POLICY_VERSION,retained:true}]);
  await f.db.query("UPDATE oaooao_watermark_preferences SET acknowledged_policy_version='old-version' WHERE user_id=$1",[f.owner]);
  const newPolicy=await f.app.inject({method:'POST',url,headers:f.headers});assert.equal(newPolicy.statusCode,200,newPolicy.body.slice(0,200));assert.equal(newPolicy.headers['x-oao-watermark-applied'],'true');
});

test('real video export preserves duration, audio and upstream metadata while encoding an AI label',async t=>{
  const f=await fixture();t.after(()=>f.close());const source=join(f.config.mediaRoot,'synthetic.mp4');
  await run(ffmpeg,['-nostdin','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=0.5','-f','lavfi','-i','sine=frequency=440:duration=0.5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-metadata','comment=upstream AI metadata','-shortest',source],{windowsHide:true,timeout:30000});
  const original=await readFile(source),media=await saveMedia(f.app.ctx,f.owner,original);await job(f,media.url,'video');
  const response=await f.app.inject({method:'POST',url:`/api/media/${media.key}/export`,headers:f.headers});assert.equal(response.statusCode,200,response.body.slice(0,200));assert.equal(response.headers['x-oao-watermark-applied'],'true');
  const output=join(f.config.mediaRoot,'exported.mp4');await writeFile(output,response.rawPayload);
  const metadata=JSON.parse((await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',output],{windowsHide:true,timeout:10000})).stdout);assert.ok(metadata.streams.some((item:any)=>item.codec_type==='audio'));assert.ok(metadata.streams.find((item:any)=>item.codec_type==='video').height>180);assert.ok(Math.abs(Number(metadata.format.duration)-0.5)<0.15);assert.equal(metadata.format.tags.comment,'upstream AI metadata');
  const frame=await run(ffmpeg,['-v','error','-i',output,'-vf','crop=320:28:0:180','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,timeout:10000,encoding:'buffer',maxBuffer:4*1024*1024});let white=0;for(let i=0;i<frame.stdout.length;i+=3)if(frame.stdout[i]>190&&frame.stdout[i+1]>190&&frame.stdout[i+2]>190)white++;assert.ok(white>20);assert.deepEqual(await readFile(mediaPath(f.config.mediaRoot,media.key)),original);
});

test('unsupported signed provenance and unavailable encoders fail honestly without returning an unlabelled generated export',async t=>{
  const f=await fixture();t.after(()=>f.close());const source=await createPng(f.config.mediaRoot);
  await assert.rejects(labelMedia(pngText(source,'c2pa signed synthetic provenance'),'image/png'),{statusCode:422});
  await assert.rejects(labelMedia(Buffer.from('GIF89a'),'image/gif'),{statusCode:415});
  const tiny=join(f.config.mediaRoot,'tiny.png');await run(ffmpeg,['-nostdin','-y','-f','lavfi','-i','color=c=red:s=16x16','-frames:v','1','-threads','1',tiny],{windowsHide:true,timeout:10000});await assert.rejects(labelMedia(await readFile(tiny),'image/png'),{statusCode:422});
  const media=await saveMedia(f.app.ctx,f.owner,source);await job(f,media.url);
  const previous=process.env.FFMPEG_PATH;process.env.FFMPEG_PATH=join(f.config.mediaRoot,'nonexistent-export-tool');
  try{const response=await f.app.inject({method:'POST',url:`/api/media/${media.key}/export`,headers:f.headers});assert.equal(response.statusCode,503,response.body);assert.equal(response.headers['content-type'],'application/json; charset=utf-8');assert.equal((await f.db.query('SELECT count(*) FROM oaooao_watermark_events')).rows[0].count,'0');}finally{if(previous===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=previous;}
});

test('EXIF-rotated JPEG exports normalize orientation before adding a legible bottom label',async t=>{
  const f=await fixture();t.after(()=>f.close());const source=join(f.config.mediaRoot,'orientation.jpg');
  await run(ffmpeg,['-nostdin','-y','-f','lavfi','-i','color=c=red:s=320x180','-vf','drawbox=x=0:y=0:w=80:h=180:color=blue:t=fill','-frames:v','1','-q:v','2','-threads','1',source],{windowsHide:true,timeout:10000});
  const original=await readFile(source),tiff=Buffer.alloc(26);tiff.write('II',0,'ascii');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(6,18);
  const app1=Buffer.concat([Buffer.from([255,225,0,34]),Buffer.from('Exif\0\0'),tiff]);const rotated=Buffer.concat([original.subarray(0,2),app1,original.subarray(2)]);await writeFile(source,rotated);
  const result=await labelMedia(rotated,'image/jpeg'),output=join(f.config.mediaRoot,'oriented-export.jpg');await writeFile(output,result.bytes);
  const meta=JSON.parse((await run(ffprobe,['-v','error','-show_streams','-of','json',output],{windowsHide:true,timeout:10000})).stdout);assert.equal(meta.streams[0].width,180);assert.ok(meta.streams[0].height>320);
  const exif=result.bytes.indexOf(Buffer.from('Exif\0\0'));assert.ok(exif>0);assert.equal(result.bytes.readUInt16LE(exif+6+18),1,'Do not rotate the finished label a second time');
  const frame=await run(ffmpeg,['-v','error','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,timeout:10000,encoding:'buffer',maxBuffer:4*1024*1024});const rgb=(x:number,y:number)=>[...frame.stdout.subarray((y*180+x)*3,(y*180+x)*3+3)];
  assert.ok(rgb(90,30)[2]>180,'Blue source strip becomes the top after clockwise rotation');assert.ok(rgb(90,200)[0]>180,'Red source remains below the blue region');let white=0;for(let i=320*180*3;i<frame.stdout.length;i+=3)if(frame.stdout[i]>200&&frame.stdout[i+1]>200&&frame.stdout[i+2]>200)white++;assert.ok(white>20,'The label stays below the displayed image');assert.deepEqual(await readFile(source),rotated);
});

test('render provenance follows successful source jobs and never labels ordinary uploaded clips as AI',async t=>{
  const f=await fixture();t.after(()=>f.close());const source=randomUUID(),rendered=randomUUID(),nested=randomUUID();
  const render=await job(f,`/api/reference-assets/${rendered}`,'render');await f.db.query('UPDATE oaooao_generation_jobs SET input=$2 WHERE id=$1',[render,{shots:[{mediaId:source}]}]);
  assert.equal(await isGeneratedMedia(f.app.ctx,f.owner,rendered),false);
  await job(f,`/api/reference-assets/${source}`,'video');assert.equal(await isGeneratedMedia(f.app.ctx,f.owner,rendered),true);
  const outer=await job(f,`/api/reference-assets/${nested}`,'render');await f.db.query('UPDATE oaooao_generation_jobs SET input=$2 WHERE id=$1',[outer,{shots:[{mediaId:rendered}]}]);assert.equal(await isGeneratedMedia(f.app.ctx,f.owner,nested),true);
  assert.equal(await isGeneratedMedia(f.app.ctx,'synthetic-export-other',nested),false);
});
