import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { encoderAvailable, mediaPath, renderSubtitles, saveMedia } from '../src/media.js';
import { processNextJob } from '../src/worker.js';
import { createTestDatabase } from './core-helpers.js';

const run=promisify(execFile);
test('subtitle generation uses bounded plain text and cumulative shot timing',()=>{
  const text=renderSubtitles([{mediaId:'fixture',audioMode:'source',subtitle:'<b>English</b> {override} \\path',duration:1.5},{mediaId:'fixture',audioMode:'mute',subtitle:'合成字幕',duration:0.75}]);
  assert.match(text,/00:00:00,000 --> 00:00:01,500/);assert.match(text,/00:00:01,500 --> 00:00:02,250/);assert.ok(!/[<>\\{}]/.test(text.replaceAll('-->','')));
});
test('actual FFmpeg render combines source audio, voiceover, mute and burned subtitles',async t=>{
  try{await encoderAvailable();}catch{t.skip('Installed FFmpeg + FFprobe + subtitles filter required for real encoding test');return;}
  const database=await createTestDatabase();const app=await buildApp({db:database.db,config:database.config});await app.ready();const ctx=app.ctx;
  try{
    const userId=randomUUID(),token=randomBytes(32).toString('base64url');await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$2,$3)',[userId,`render-${userId}`,'synthetic-unused']);await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),userId]);const headers={cookie:`oaooao_session=${token}`,origin:database.config.origin};
    const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';const clip=join(database.config.mediaRoot,'synthetic-source.mp4'),voice=join(database.config.mediaRoot,'synthetic-voice.wav');
    await run(ffmpeg,['-nostdin','-y','-f','lavfi','-i','color=c=red:s=96x96:r=30:d=1','-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',clip],{windowsHide:true,timeout:30000});
    await run(ffmpeg,['-nostdin','-y','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=1','-c:a','pcm_s16le',voice],{windowsHide:true,timeout:30000});
    const videoAsset=await saveMedia(ctx,userId,await readFile(clip));const audioAsset=await saveMedia(ctx,userId,await readFile(voice));
    const project=(await app.inject({method:'POST',url:'/api/drama/projects',headers,payload:{title:'Synthetic render project'}})).json().data.project;
    const body={projectId:project.id,ratio:'1:1',shots:[{videoUrl:videoAsset.url,audioMode:'source',subtitle:'Synthetic source subtitle',duration:0.6},{videoUrl:videoAsset.url,audioMode:'voiceover',audioUrl:audioAsset.url,subtitle:'合成配音字幕',duration:0.6},{videoUrl:videoAsset.url,audioMode:'mute',subtitle:'Silent fixture',duration:0.6}]};
    const response=await app.inject({method:'POST',url:'/api/drama/render',headers,payload:body});assert.equal(response.statusCode,202,response.body);const taskId=response.json().data.id;
    const repeat=await app.inject({method:'POST',url:'/api/drama/render',headers,payload:body});assert.equal(repeat.json().data.id,taskId);
    await processNextJob(ctx);const query=await app.inject({url:`/api/drama/render/${taskId}`,headers});const task=query.json().data;assert.equal(task.status,'success',JSON.stringify(task));
    const resultUrl=task.result.url;const key=resultUrl.split('/').pop();const output=mediaPath(database.config.mediaRoot,key);
    const probe=await run(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{windowsHide:true,timeout:10000});const metadata=JSON.parse(probe.stdout);assert.equal(metadata.streams.find((s:any)=>s.codec_type==='video').width,720);assert.equal(metadata.streams.find((s:any)=>s.codec_type==='video').height,720);assert.ok(Math.abs(Number(metadata.format.duration)-1.8)<0.2);
    const audio=await run(ffmpeg,['-v','error','-i',output,'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],{windowsHide:true,timeout:10000,encoding:'buffer',maxBuffer:1024*1024});
    const samples=audio.stdout;const region=(start:number,end:number)=>{const values=[];for(let i=Math.floor(start*8000);i<Math.floor(end*8000);i++)values.push(samples.readInt16LE(i*2));return values;};const rms=(v:number[])=>Math.sqrt(v.reduce((n,s)=>n+s*s,0)/v.length);const crossings=(v:number[])=>v.slice(1).filter((s,i)=>(s>=0)!==(v[i]>=0)).length;
    const source=region(0.15,0.45),overdub=region(0.75,1.05),muted=region(1.4,1.65);assert.ok(rms(source)>100);assert.ok(rms(overdub)>100);assert.ok(crossings(overdub)>crossings(source)*2,'Voiceover must replace the source audio');assert.ok(rms(muted)<10,'Muted shot must contain silence');
    const frame=await run(ffmpeg,['-v','error','-ss','0.3','-i',output,'-frames:v','1','-vf','crop=iw:ih/3:0:2*ih/3','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,timeout:10000,encoding:'buffer',maxBuffer:4*1024*1024});let white=0;for(let i=0;i<frame.stdout.length;i+=3)if(frame.stdout[i]>210&&frame.stdout[i+1]>210&&frame.stdout[i+2]>210)white++;assert.ok(white>20,'Subtitles must be burned into the red fixture video');
    assert.equal((await app.inject({url:resultUrl,headers})).statusCode,200);assert.equal(Number((await ctx.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count),1);
  }finally{await app.close();await database.cleanup();}
});
