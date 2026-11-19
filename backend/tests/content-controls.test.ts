import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {hashToken,ADMIN_PERMISSIONS} from '../src/core.js';
import {createTestDatabase} from './core-helpers.js';
import {ADULT_CONTENT_POLICY_VERSION,adultContentPreference} from '../src/content-policy.js';
import {creativeReferenceRow} from '../src/creative-reference-store.js';
import {getSettings,validateSettingsPatch} from '../src/settings.js';
import {resolveProvider} from '../src/providers.js';
import {watermarkPreference,WATERMARK_POLICY_VERSION} from '../src/watermark.js';
import {saveMedia,ownedMedia,readReference} from '../src/media.js';
import {createJob} from '../src/creative.js';

async function fixture(t:any){
 const f=await createTestDatabase(),app=await buildApp({db:f.db,config:f.config});t.after(async()=>{await app.close();await f.cleanup();});
 const users=[];
 for(const role of ['admin','user','user']){const id=randomUUID(),token=randomBytes(32).toString('base64url');await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role) VALUES($1,$1,'synthetic-unused',$2)",[id,role]);await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);users.push({id,headers:{origin:f.config.origin,cookie:`${f.config.sessionCookieName}=${token}`}});}
 const [admin,a,b]=users;
 await f.db.query('UPDATE oaooao_users SET admin_permissions=$2::jsonb WHERE id=$1',[admin.id,JSON.stringify(ADMIN_PERMISSIONS)]);
 return {...f,app,ctx:app.ctx,admin,a,b};
}
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64');

test('adult content is opt-in, requires both age declaration and current agreement, and isolates accounts',async t=>{
 const f=await fixture(t),url='/api/account/content-preference';
 assert.equal((await f.app.inject({url})).statusCode,401);
 assert.equal((await adultContentPreference(f.ctx,f.a.id)).enabled,false);
 for(const payload of [{enabled:true},{enabled:true,adultConfirmed:true},{enabled:true,adultConfirmed:false,acknowledgedPolicyVersion:ADULT_CONTENT_POLICY_VERSION},{enabled:true,adultConfirmed:true,acknowledgedPolicyVersion:'old'},{enabled:'true'},{enabled:false,userId:f.b.id}])assert.equal((await f.app.inject({method:'PATCH',url,headers:f.a.headers,payload})).statusCode,400);
 const enable=()=>f.app.inject({method:'PATCH',url,headers:f.a.headers,payload:{enabled:true,adultConfirmed:true,acknowledgedPolicyVersion:ADULT_CONTENT_POLICY_VERSION}});
 assert.equal((await enable()).statusCode,200);
 assert.equal((await adultContentPreference(f.ctx,f.a.id)).enabled,true);assert.equal((await adultContentPreference(f.ctx,f.b.id)).enabled,false);
 const response=(await f.app.inject({url,headers:f.a.headers})).json();assert.ok(response.adultContent.acknowledgedAt);assert.match(JSON.stringify(response.agreement),/平台会记录生成操作.*保留不少于六个月/);assert.ok(!JSON.stringify(response.agreement).includes('兽交'));assert.match(JSON.stringify(response.agreement),/未成年人|未经同意|18 周岁/);
 const previous=f.ctx.audit;f.ctx.audit=async()=>{throw Error('synthetic audit failure');};
 assert.equal((await f.app.inject({method:'PATCH',url,headers:f.a.headers,payload:{enabled:false}})).statusCode,500);f.ctx.audit=previous;assert.equal((await adultContentPreference(f.ctx,f.a.id)).enabled,true);
 assert.equal((await f.app.inject({method:'PATCH',url,headers:f.a.headers,payload:{enabled:false}})).statusCode,200);assert.equal((await adultContentPreference(f.ctx,f.a.id)).enabled,false);
 assert.equal((await enable()).statusCode,200);
 await f.db.query("UPDATE oaooao_content_preferences SET acknowledged_policy_version='old' WHERE user_id=$1",[f.a.id]);assert.equal((await adultContentPreference(f.ctx,f.a.id)).enabled,false);
});

test('adult mode blocks unapproved models and aliases before job creation or debit, across personal and team contexts',async t=>{
 const f=await fixture(t),models=[false,true].map((allowAdultContent,n)=>({id:'image-'+n,name:'Image '+n,enabled:true,capability:'image',allowAdultContent,aliases:['alias-'+n],bindings:[{id:'bind-'+n,channelId:'fixture',upstreamModel:'upstream-'+n,requestAlias:'request-'+n,enabled:true,priority:1}]}));
 await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{systemChannels:[{id:'fixture',name:'fixture',baseUrl:'https://provider.example/v1',enabled:true,apiKey:f.ctx.encrypt('synthetic'),storeGeneratedMedia:false,advancedConfig:{protocol:'openai'}}],logicalModels:models,defaultModels:{imageModel:'image-0'},modelPointCosts:{'image-0':1,'image-1':1}}]);
 await f.app.inject({method:'PATCH',url:'/api/account/content-preference',headers:f.a.headers,payload:{enabled:true,adultConfirmed:true,acknowledgedPolicyVersion:ADULT_CONTENT_POLICY_VERSION}});
 const input=(model?:string)=>({prompt:'synthetic',config:{...(model?{model}:{})}});
 for(const model of ['image-0','alias-0','request-0']){
  await assert.rejects(resolveProvider(f.ctx,'image',input(model),undefined,f.a.id),error=>{assert.equal((error as any).statusCode,403);assert.match((error as Error).message,/成人内容/);return true;});
  await assert.rejects(createJob(f.ctx,f.a.id,'image',input(model),'synthetic-'+model),{statusCode:403});
  await assert.rejects(resolveProvider({...f.ctx,workspace:{teamId:randomUUID(),projectId:randomUUID()}},'image',input(model),undefined,f.a.id),{statusCode:403});
 }
 assert.equal((await f.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count,'0');
 assert.equal((await resolveProvider(f.ctx,'image',input('image-1'),undefined,f.a.id)).model,'image-1');
 assert.equal((await resolveProvider(f.ctx,'image',input(),undefined,f.a.id)).model,'image-1');
 assert.equal((await resolveProvider(f.ctx,'image',input('image-0'),undefined,f.b.id)).model,'image-0');
 let settings=(await f.app.inject({url:'/api/auth/session',headers:f.a.headers})).json().settings;assert.deepEqual(settings.logicalModels.map((m:any)=>m.id),['image-1']);assert.equal(settings.defaultModels.imageModel,'image-1');assert.equal(settings.adultContent.enabled,true);
 assert.equal((await f.app.inject({method:'PATCH',url:'/api/account/model-defaults',headers:f.a.headers,payload:{imageModel:'image-0'}})).statusCode,403);
 await f.app.inject({method:'PATCH',url:'/api/account/content-preference',headers:f.a.headers,payload:{enabled:false}});
 settings=(await f.app.inject({url:'/api/auth/session',headers:f.a.headers})).json().settings;assert.equal(settings.logicalModels.length,2);assert.equal(settings.adultContent.enabled,false);
 const current=await getSettings(f.ctx);assert.throws(()=>validateSettingsPatch(f.ctx,current,{logicalModels:[{...models[0],allowAdultContent:'true'}]}),{statusCode:400});
});

test('administrator watermark switches control export and acknowledgment without pretending consent',async t=>{
 const f=await fixture(t),url='/api/admin/settings',preference='/api/account/watermark-preference';
 const patch=(payload:any,headers=f.admin.headers)=>f.app.inject({method:'PATCH',url,headers,payload});
 assert.equal((await patch({watermarkPolicy:{enabled:false}},f.a.headers)).statusCode,403);
 for(const value of [null,false,{enabled:'false'},{enabled:true,confirmationRequired:0},{enabled:true,extra:true}])assert.equal((await patch({watermarkPolicy:value})).statusCode,400);
 assert.equal((await patch({watermarkPolicy:{enabled:true,confirmationRequired:false}})).statusCode,200);
 const saved=await f.app.inject({method:'PATCH',url:preference,headers:f.a.headers,payload:{enabled:false}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().watermark.enabled,false);assert.equal(saved.json().watermark.acknowledgedAt,null);
 assert.equal((await patch({watermarkPolicy:{enabled:true,confirmationRequired:true}})).statusCode,200);assert.equal((await watermarkPreference(f.ctx,f.a.id)).enabled,true,'Requiring confirmation restores watermarks for unconfirmed opt-outs');
 assert.equal((await f.app.inject({method:'PATCH',url:preference,headers:f.a.headers,payload:{enabled:false,acknowledgedPolicyVersion:WATERMARK_POLICY_VERSION}})).statusCode,200);
 assert.equal((await patch({watermarkPolicy:{enabled:false}})).statusCode,200);const p=await watermarkPreference(f.ctx,f.b.id);assert.equal(p.enabled,false);assert.equal(p.preferenceEnabled,true);assert.equal(p.globallyEnabled,false);
 const media=await saveMedia(f.ctx,f.a.id,image);await f.db.query("INSERT INTO oaooao_generation_history(id,user_id,document,created_at) VALUES($1,$2,$3,now())",[randomUUID(),f.a.id,{kind:'image',status:'success',assets:[{url:media.url}]}]);
 const exported=await f.app.inject({method:'POST',url:`/api/media/${media.key}/export`});assert.equal(exported.statusCode,200,exported.body);assert.deepEqual(exported.rawPayload,image);assert.equal(exported.headers['x-oao-watermark-applied'],'false');
});

test('existing opaque media links and exports are public, while lists, writes, deletion, expiry and reference ownership remain enforced',async t=>{
 const f=await fixture(t),media=await saveMedia(f.ctx,f.a.id,image,false);
 for(const route of ['media','reference-assets','generation-log-assets']){
  assert.equal((await f.app.inject({url:`/api/${route}/${media.key}`})).statusCode,200);
  assert.equal((await f.app.inject({url:`/api/${route}/${media.key}`,headers:f.b.headers})).statusCode,200);
 }
 assert.equal((await f.app.inject({method:'POST',url:`/api/media/${media.key}/export`})).statusCode,200);
 for(const url of ['/api/library-assets','/api/admin/settings','/api/account/content-preference'])assert.equal((await f.app.inject({url})).statusCode,401);
 assert.equal((await f.app.inject({method:'POST',url:'/api/reference-assets',payload:{}})).statusCode,401);
 await assert.rejects(ownedMedia(f.ctx,f.b.id,media.key),{statusCode:404});
 await f.db.query("UPDATE oaooao_media SET expires_at=now()-interval '1 second' WHERE id=$1",[media.key]);assert.equal((await f.app.inject({url:media.url})).statusCode,404);
 await f.db.query('UPDATE oaooao_media SET persistent=true WHERE id=$1',[media.key]);assert.equal((await f.app.inject({url:media.url})).statusCode,200);
 await f.db.query('UPDATE oaooao_media SET delete_requested_at=now() WHERE id=$1',[media.key]);assert.equal((await f.app.inject({url:media.url})).statusCode,404);assert.equal((await f.app.inject({method:'POST',url:`/api/media/${media.key}/export`})).statusCode,404);
});
