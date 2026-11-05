import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {inspectReference} from '../src/reference-inspection.js';
import {saveMedia,mediaPath} from '../src/media.js';
import {createTestDatabase} from './core-helpers.js';

function audio(marker=0){const data=Buffer.alloc(64);data.write('RIFF');data.write('WAVE',8);data[63]=marker;return data;}
test('verified reference inspection reuses work without bypassing ownership, content identity or stream checks',async t=>{
  const fixture=await createTestDatabase(),ctx={db:fixture.db,config:fixture.config} as any;
  t.after(fixture.cleanup);
  for(const user of ['inspection-a','inspection-b'])await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,'synthetic-unused')",[user]);
  const media=await saveMedia(ctx,'inspection-a',audio()),ref={url:media.url,type:'audio',duration:0.001};
  let probes=0;
  const probe=async()=>{probes++;return{duration:10.25,streams:[{codec_type:'audio'}]};};
  await t.test('repeated quotes and concurrent callers share one verified probe',async()=>{
    const results=await Promise.all(Array.from({length:12},()=>inspectReference(ctx,'inspection-a',ref,probe)));
    assert.equal(probes,1);assert.ok(results.every(item=>item.duration===10.25));
    assert.equal((await inspectReference(ctx,'inspection-a',{...ref,role:'reference',duration:1},probe)).duration,10.25);
    assert.equal(probes,1,'client claims and roles cannot replace authoritative duration');
  });
  await t.test('ownership and expiry are checked even when metadata is cached',async()=>{
    await assert.rejects(inspectReference(ctx,'inspection-b',ref,probe),/Media not found/);
    await fixture.db.query("UPDATE oaooao_media SET persistent=false,expires_at=now()-interval '1 second' WHERE id=$1",[media.key]);
    await assert.rejects(inspectReference(ctx,'inspection-a',ref,probe),/Media not found/);
    await fixture.db.query('UPDATE oaooao_media SET persistent=true WHERE id=$1',[media.key]);
  });
  await t.test('changed or missing local bytes cannot use stale metadata',async()=>{
    await writeFile(mediaPath(fixture.config.mediaRoot,media.key),audio(9));
    await assert.rejects(inspectReference(ctx,'inspection-a',ref,probe),/已变化/);
    await unlink(mediaPath(fixture.config.mediaRoot,media.key));
    await assert.rejects(inspectReference(ctx,'inspection-a',ref,probe));
  });
  await t.test('matching bytes from another owner are inspected independently',async()=>{
    const own=await saveMedia(ctx,'inspection-b',audio());
    await inspectReference(ctx,'inspection-b',{url:own.url},probe);
    assert.equal(probes,2);
  });
  await t.test('failed probes are retryable and wrong media streams are rejected',async()=>{
    const input={dataUrl:`data:audio/wav;base64,${audio(2).toString('base64')}`};let attempt=0;
    const transient=async()=>{attempt++;if(attempt===1)throw Error('synthetic transient');return{duration:2,streams:[{codec_type:'audio'}]};};
    await assert.rejects(inspectReference(ctx,'inspection-a',input,transient),/synthetic transient/);
    assert.equal((await inspectReference(ctx,'inspection-a',input,transient)).duration,2);assert.equal(attempt,2);
    await assert.rejects(inspectReference(ctx,'inspection-a',{dataUrl:`data:audio/wav;base64,${audio(3).toString('base64')}`},async()=>({duration:2,streams:[{codec_type:'video'}]})),/没有可用/);
  });
  await t.test('cold references probe with bounded concurrency while preserving their order',async()=>{
    let active=0,max=0;const entered:number[]=[],finish:Array<()=>void>=[];
    const pending=Array.from({length:5},(_,i)=>inspectReference(ctx,'inspection-a',{dataUrl:`data:audio/wav;base64,${audio(10+i).toString('base64')}`},async()=>{const index=entered.length;entered.push(index);max=Math.max(max,++active);await new Promise<void>(done=>finish.push(done));active--;return{duration:index+1,streams:[{codec_type:'audio'}]};}));
    while(entered.length<2)await new Promise(done=>setTimeout(done,1));
    assert.equal(entered.length,2);
    for(let i=0;i<5;i++){while(!finish[i])await new Promise(done=>setTimeout(done,1));finish[i]();}
    const result=await Promise.all(pending);assert.equal(max,2);assert.deepEqual(result.map(item=>item.duration),[1,2,3,4,5]);
  });
});
