import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';
import { creativeReferencePath } from '../src/creative-reference-store.js';

test('catalog is authenticated, grouped, filtered and never exposes storage or private metadata',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});await app.ready();
  t.after(async()=>{await app.close();await fixture.cleanup();});
  const user=randomUUID(),token=randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,'catalog-fixture','unused')",[user]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),user]);
  const headers={cookie:`${fixture.config.sessionCookieName}=${token}`,origin:fixture.config.origin};
  for(const [id,role,group,category,style,angle,enabled] of [
    ['pose-one-front','pose','pose-one','站姿','单人','正面',true],['pose-one-side','pose','pose-one','站姿','单人','侧面',true],['pose-two-front','pose','pose-two','坐姿','单人','正面',true],['garment-one','garment','garment-one','春季','写实','',true],['pose-disabled','pose','pose-three','站姿','单人','正面',false]
  ] as const)await fixture.db.query(`INSERT INTO oaooao_creative_references(id,role,group_id,title,category,style,angle,enabled,tags,metadata,storage_location,thumbnail_location,mime_type,thumbnail_mime_type,byte_count,sha256,thumbnail_sha256) VALUES($1,$2,$3,$1,$4,$5,$6,$7,'["fixture-keyword"]','{"attribution":"Fixture artist","privateNote":"do-not-expose"}','{"bucket":"private-fixture-bucket"}','{}','image/png','image/webp',128,'hash','thumb-hash')`,[id,role,group,category,style,angle,enabled]);
  assert.equal((await app.inject({url:'/api/creative-references?role=pose'})).statusCode,401);
  assert.equal((await app.inject({url:'/api/creative-references/pose-one-front/content'})).statusCode,401);
  assert.equal((await app.inject({url:'/api/creative-references?role=video',headers})).statusCode,400);
  const result=await app.inject({url:'/api/creative-references?role=pose&pageSize=1',headers});assert.equal(result.statusCode,200,result.body);
  const data=result.json();assert.equal(data.total,2);assert.equal(data.items.length,1);assert.equal(data.items[0].id,'pose-one-front');assert.equal(data.items[0].variants.length,2);
  assert.equal(data.items[0].url,'/api/creative-references/pose-one-front/content');
  assert.ok(!result.body.includes('private-fixture-bucket'));assert.ok(!result.body.includes('do-not-expose'));assert.ok(!result.body.includes('pose-disabled'));
  const filtered=(await app.inject({url:'/api/creative-references?role=pose&angle='+encodeURIComponent('侧面'),headers})).json();assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,'pose-one-side');assert.equal(filtered.items[0].variants.length,2);
  assert.equal((await app.inject({url:'/api/creative-references?role=pose&keyword=fixture-keyword&grouped=false',headers})).json().total,3);
  assert.equal((await app.inject({url:'/api/creative-references?role=pose&keyword=%25',headers})).json().total,0);
  assert.equal((await app.inject({url:'/api/creative-references/pose-disabled/content',headers})).statusCode,404);
  assert.equal(creativeReferencePath('/api/creative-references/pose-one-front/content'),'pose-one-front');assert.equal(creativeReferencePath('/api/creative-references/../content'),undefined);

  const settings={systemChannels:[{id:'fixture',name:'fixture',enabled:true,baseUrl:'https://provider.example/v1',apiKey:app.ctx.encrypt('synthetic-key'),models:['fixture-image'],storeGeneratedMedia:false}],logicalModels:[{id:'fixture-image',name:'Fixture image',capability:'image',enabled:true,bindings:[{id:'fixture-binding',channelId:'fixture',upstreamModel:'fixture-image',enabled:true,priority:1,capabilityProfile:{supportsReferenceImage:true,maxReferenceImages:3,maxBatchSize:2,outputResolutions:['1K'],imageQualities:['auto'],aspectRatios:['2:3']}}]}],modelPointCosts:{'fixture-image':2},defaultModels:{imageModel:'fixture-image'}};
  await fixture.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[settings]);
  const input={prompt:'synthetic try-on',kind:'edit',config:{model:'fixture-image',size:'2:3',quality:'auto',resolution:'1K',n:2},references:[{type:'image',url:'/api/creative-references/garment-one/content'},{type:'image',url:'/api/creative-references/pose-one-side/content'}]};
  const quote=await app.inject({method:'POST',url:'/api/image-tasks/quote',headers,payload:input});assert.equal(quote.statusCode,200,quote.body);assert.equal(quote.json().points,2);
  const before=await fixture.db.query('SELECT count(*)::int n FROM oaooao_generation_jobs');assert.equal(before.rows[0].n,0);
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM oaooao_media WHERE user_id=$1',[user])).rows[0].n,0);
  const invalid=await app.inject({method:'POST',url:'/api/image-tasks/quote',headers,payload:{...input,references:[{url:'/api/creative-references/pose-disabled/content'}]}});assert.equal(invalid.statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/image-tasks/quote',headers,payload:{...input,config:{...input.config,n:3}}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/image-tasks/quote',headers,payload:{...input,references:[...input.references,...input.references]}})).statusCode,400);
  const foreignId=randomUUID();assert.equal((await app.inject({method:'POST',url:'/api/image-tasks/quote',headers,payload:{...input,references:[{url:`/api/reference-assets/${foreignId}`}]}})).statusCode,404);
});
