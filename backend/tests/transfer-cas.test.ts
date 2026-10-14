import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {importTransfer,verifyTransfer,type TransferBundle} from '../src/transfer.js';
import {createTestDatabase} from './core-helpers.js';

test('transferred microsecond timestamps remain writable through the project HTTP contract',async()=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});
  try{
    const userId=randomUUID(),projectId=randomUUID(),timestamp='2026-10-01T12:13:14.567891Z';
    const bundle:TransferBundle={format:'oaooao-normalized-transfer-v1',id:'synthetic-microseconds',sourceDigest:'c'.repeat(64),capturedAt:timestamp,
      records:{users:[{id:userId,username:'microsecond-fixture',password_hash:'synthetic-unused-hash',created_at:timestamp}],
        projects:[{id:projectId,user_id:userId,kind:'canvas',title:'Imported synthetic project',document:{nodes:[],connections:[]},created_at:timestamp,updated_at:timestamp}]},
      archive:[{entityType:'project',entityId:projectId,document:{updatedAt:timestamp}}]};
    await importTransfer(fixture.db,bundle);await verifyTransfer(fixture.db,bundle);
    const token=randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),userId]);
    const headers={cookie:`${fixture.config.sessionCookieName}=${token}`,origin:fixture.config.origin};
    const read=await app.inject({url:`/api/canvas/projects/${projectId}`,headers});assert.equal(read.statusCode,200,read.body);
    const project=read.json().data.project;assert.equal(project.updatedAt,'2026-10-01T12:13:14.567Z');
    const saved=await app.inject({method:'PATCH',url:`/api/canvas/projects/${projectId}`,headers,payload:{project:{...project,title:'Saved synthetic project'},expectedUpdatedAt:project.updatedAt}});
    assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().data.project.title,'Saved synthetic project');
    const replay=await app.inject({method:'PATCH',url:`/api/canvas/projects/${projectId}`,headers,payload:{project:{...project,title:'Stale overwrite'},expectedUpdatedAt:project.updatedAt}});assert.equal(replay.statusCode,409);
    const archive=(await fixture.db.query('SELECT document FROM oaooao_transfer_archive WHERE transfer_id=$1',[bundle.id])).rows[0].document;assert.equal(archive.updatedAt,timestamp);
  }finally{await app.close();await fixture.cleanup();}
});
