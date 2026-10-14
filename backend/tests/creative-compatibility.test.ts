import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';

async function fixture() {
  const database=await createTestDatabase();
  const app=await buildApp({db:database.db,config:database.config});
  await app.ready();
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await database.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$2,$3,$4,$5)',[id,`compat-${id}`,'synthetic-unused-hash','admin',JSON.stringify(['analytics.read'])]);
  await database.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
  return {app,db:database.db,id,headers:{cookie:`oaooao_session=${token}`,origin:database.config.origin},cleanup:async()=>{await app.close();await database.cleanup();}};
}

test('new project IDs select the correct frontend workspace and survive API reads, saves and handoff retries',async()=>{
  const f=await fixture();try{
    for(const kind of ['drama','canvas']){
      const root=`/api/${kind}/projects`;
      const payload={title:`Synthetic ${kind}`,sourceHandoffId:`compat-${kind}`,project:{nodes:[],connections:[]},initialScript:'Synthetic script'};
      const created=await f.app.inject({method:'POST',url:root,headers:f.headers,payload});
      assert.equal(created.statusCode,200,created.body);
      const project=created.json().data.project;
      assert.equal(project.id.startsWith('drama-'),kind==='drama','Client project routes select CreativeWorkspace only for drama- IDs');
      const repeated=await f.app.inject({method:'POST',url:root,headers:f.headers,payload});
      assert.equal(repeated.json().data.project.id,project.id);
      const listed=await f.app.inject({url:root,headers:f.headers});
      assert.equal(listed.statusCode,200,listed.body);
      assert.equal(listed.json().data.projects.find((item:any)=>item.id===project.id).sourceHandoffId,payload.sourceHandoffId);
      const loaded=await f.app.inject({url:`${root}/${encodeURIComponent(project.id)}`,headers:f.headers});
      assert.equal(loaded.statusCode,200,loaded.body);
      assert.equal(loaded.json().data.project.id,project.id);
      const updated={...loaded.json().data.project,title:`Saved ${kind}`};
      const saved=await f.app.inject({method:'PATCH',url:`${root}/${encodeURIComponent(project.id)}`,headers:f.headers,payload:kind==='canvas'?{project:updated,expectedUpdatedAt:updated.updatedAt}:updated});
      assert.equal(saved.statusCode,200,saved.body);
      assert.equal(saved.json().data.project.id,project.id);
      assert.equal(saved.json().data.project.title,`Saved ${kind}`);
      assert.equal((await f.app.inject({url:`${root}/${project.id}`,headers:f.headers})).json().data.project.title,`Saved ${kind}`);
    }
    const legacyId='legacy-project:opaque-id';
    await f.db.query('INSERT INTO oaooao_projects(id,user_id,kind,title,document) VALUES($1,$2,$3,$4,$5)',[legacyId,f.id,'canvas','Imported fixture',{nodes:[],connections:[]}]);
    const legacy=await f.app.inject({url:`/api/canvas/projects/${encodeURIComponent(legacyId)}`,headers:f.headers});
    assert.equal(legacy.statusCode,200,legacy.body);
    const saved=await f.app.inject({method:'PATCH',url:`/api/canvas/projects/${encodeURIComponent(legacyId)}`,headers:f.headers,payload:{project:{...legacy.json().data.project,title:'Saved legacy'},expectedUpdatedAt:legacy.json().data.project.updatedAt}});
    assert.equal(saved.statusCode,200,saved.body);
    assert.equal(saved.json().data.project.id,legacyId,'Legacy opaque IDs must never be rewritten');
  }finally{await f.cleanup();}
});

test('generation overview returns contiguous zero-filled Beijing dates and uses the same calendar window for totals',async()=>{
  const f=await fixture();try{
    const expected=(await f.db.query("SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date - i,'YYYY-MM-DD') label FROM generate_series(6,0,-1) i")).rows.map(row=>row.label);
    const empty=await f.app.inject({url:'/api/admin/generation-overview',headers:f.headers});
    assert.equal(empty.statusCode,200,empty.body);
    assert.deepEqual(empty.json().dailyCalls,expected.map(date=>({date,label:date,value:0})));
    assert.equal(empty.json().totalCalls,0);
    for(const age of [0,6,7])await f.db.query("INSERT INTO oaooao_generation_jobs(id,user_id,kind,client_request_id,attempt_no,input_hash,input,model,cost,created_at) VALUES($1,$2,'text',$1,1,'synthetic',$3,'synthetic-model',0,((now() AT TIME ZONE 'Asia/Shanghai')::date-$4::integer) AT TIME ZONE 'Asia/Shanghai')",[randomUUID(),f.id,{prompt:'Synthetic historical timing',source:'chat'},age]);
    const populated=await f.app.inject({url:'/api/admin/generation-overview?windowDays=7',headers:f.headers});
    assert.equal(populated.statusCode,200,populated.body);
    assert.equal(populated.json().totalCalls,2);
    assert.deepEqual(populated.json().dailyCalls,expected.map((date,index)=>({date,label:date,value:index===0||index===6?1:0})));
    const today=await f.app.inject({url:'/api/admin/generation-overview?windowDays=1',headers:f.headers});
    assert.equal(today.statusCode,200,today.body);
    assert.equal(today.json().totalCalls,1);
    assert.deepEqual(today.json().dailyCalls,[{date:expected.at(-1),label:expected.at(-1),value:1}]);
  }finally{await f.cleanup();}
});
