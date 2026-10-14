import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify, { type HTTPMethods } from 'fastify';
import cookie from '@fastify/cookie';
import { createContext, hashToken } from '../src/core.js';
import { registerContent, submitWorkVersion } from '../src/content.js';
import { registerMedia, saveMedia } from '../src/media.js';
import { createTestDatabase } from './core-helpers.js';

test('public gallery and version-bound media use isolated synthetic PostgreSQL data',async t=>{
  const fixture=await createTestDatabase(),ctx=createContext(fixture.db,fixture.config),app=Fastify();
  await app.register(cookie);await registerContent(app,ctx);await registerMedia(app,ctx);
  app.setErrorHandler((error,_request,reply)=>{const err=error as Error&{statusCode?:number};reply.code(err.statusCode??500).send({msg:err.message});});
  await app.ready();t.after(async()=>{await app.close();await fixture.cleanup();});
  let sequence=0;
  async function user(role='user',permissions:string[]=[]){
    const id=`public-synthetic-${++sequence}`,token=randomBytes(32).toString('base64url');
    await ctx.db.query('INSERT INTO oaooao_users(id,username,email,password_hash,role,admin_permissions) VALUES($1,$1,$2,$3,$4,$5)',[id,`${id}@private.invalid`,'private-password-marker',role,JSON.stringify(permissions)]);
    await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);return {id,token};
  }
  const admin=await user('admin',['content.manage']),author=await user(),other=await user();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH0cAAAAASUVORK5CYII=','base64');
  const image=await saveMedia(ctx,author.id,png),foreign=await saveMedia(ctx,other.id,png),temporary=await saveMedia(ctx,author.id,png,false);
  const video=await saveMedia(ctx,author.id,Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]));
  async function api(method:HTTPMethods,url:string,payload?:object){return app.inject({method,url,payload,headers:{cookie:`${ctx.config.sessionCookieName}=${admin.token}`}});}
  async function make(title:string,previewUrl=image.url,coverUrl='',publish=true){
    const work=await submitWorkVersion(ctx,author.id,{title,summary:'Reviewed synthetic public summary',previewUrl,coverUrl});
    if(publish)assert.equal((await api('POST',`/api/admin/works/${work.id}/review`,{decision:'approved',versionId:work.currentVersion!.id})).statusCode,200);
    return work;
  }
  const gallery=async(query='')=>(await app.inject({url:`/api/public/gallery${query}`})).json();
  const path=(work:any,slot='preview')=>`/api/public/works/${work.id}/versions/${work.currentVersion.id}/media/${slot}`;

  await t.test('only explicitly approved current versions appear; public fields omit private rows and tokens',async()=>{
    const pending=await make('Pending',image.url,'',false),approved=await make('Approved public image');
    await ctx.db.query("INSERT INTO oaooao_projects(id,user_id,kind,title,document) VALUES('private-project',$1,'canvas','Private project',$2)",[author.id,{body:'private-project-body-marker',token:'private-project-token-marker'}]);
    await ctx.db.query("UPDATE oaooao_works SET source_project_id='private-project' WHERE id=$1",[approved.id]);
    const listing=await gallery('?limit=1&sort=latest');assert.equal(listing.enabled,true);assert.equal(listing.total,1);assert.equal(listing.items[0].id,approved.id);assert.equal(listing.items[0].kind,'image');
    assert.deepEqual(Object.keys(listing.items[0]).sort(),['featured','id','kind','mediaUrl','publishedAt','summary','title','versionId'].sort());
    const body=JSON.stringify(listing);for(const privateValue of [author.id,author.token,'private.invalid','private-password-marker','private-project','access_token_hash',image.key,image.upstreamUrl])assert.ok(!body.includes(privateValue),privateValue);
    assert.equal((await app.inject({url:path(pending)})).statusCode,404);
    const publicMedia=await app.inject({url:listing.items[0].mediaUrl});assert.equal(publicMedia.statusCode,200);assert.deepEqual(publicMedia.rawPayload,png);assert.equal(publicMedia.headers['content-type'],'image/png');assert.equal(publicMedia.headers['cache-control'],'no-store');
    assert.equal((await app.inject({url:image.url})).statusCode,401,'private endpoint remains authenticated');
  });
  await t.test('rejected, taken-down, deleted, unreviewed and disabled-author versions are not public',async()=>{
    const rejected=await make('Rejected',image.url,'',false);await api('POST',`/api/admin/works/${rejected.id}/review`,{decision:'rejected'});
    const down=await make('Taken down');await api('POST',`/api/admin/works/${down.id}/take-down`,{reason:'Synthetic withdrawal'});
    const deleted=await make('Deleted');await api('DELETE',`/api/admin/works/${deleted.id}`);
    const unstamped=await make('No review stamp');await ctx.db.query('UPDATE oaooao_work_versions SET reviewed_by=NULL,reviewed_at=NULL WHERE id=$1',[unstamped.currentVersion!.id]);
    const disabledAuthor=await user(),disabledMedia=await saveMedia(ctx,disabledAuthor.id,png),disabledWork=await submitWorkVersion(ctx,disabledAuthor.id,{title:'Disabled author',previewUrl:disabledMedia.url});await api('POST',`/api/admin/works/${disabledWork.id}/review`,{decision:'approved'});await ctx.db.query('UPDATE oaooao_users SET enabled=false WHERE id=$1',[disabledAuthor.id]);
    const ids=(await gallery()).items.map((item:any)=>item.id);
    for(const work of [rejected,down,deleted,unstamped,disabledWork]){assert.ok(!ids.includes(work.id));assert.equal((await app.inject({url:path(work)})).statusCode,404);}
  });
  await t.test('foreign, temporary, external, token-bearing and traversal media are never published or fetched',async()=>{
    for(const source of [foreign.url,temporary.url,'https://external.invalid/media?access_token=secret',`${image.url}?token=secret`,'/api/reference-assets/../../private','//external.invalid/image.png']){
      const work=await make('Unsafe media reference',source);
      assert.ok(!(await gallery()).items.some((item:any)=>item.id===work.id));assert.equal((await app.inject({url:path(work)})).statusCode,404);
    }
    const absolute=await make('Owned absolute reference',`${ctx.config.origin}${image.url}`);assert.equal((await app.inject({url:path(absolute)})).statusCode,200);
  });
  await t.test('featured and media filters paginate with accurate empty-page totals',async()=>{
    const featured=await make('Featured video',video.url,image.url);await api('POST',`/api/admin/works/${featured.id}/feature`,{featured:true});
    const listing=await gallery('?featured=true&kind=video&limit=1');assert.equal(listing.total,1);assert.equal(listing.items[0].id,featured.id);assert.equal(listing.items[0].coverUrl,path(featured,'cover'));assert.equal(listing.items[0].mediaUrl,path(featured));
    const past=await gallery('?featured=true&kind=video&limit=1&page=20');assert.equal(past.total,1);assert.deepEqual(past.items,[]);
    assert.equal((await gallery('?featured=true&kind=image')).total,0);
    for(const query of ['?kind=audio','?sort=invalid','?featured=maybe'])assert.equal((await app.inject({url:`/api/public/gallery${query}`})).statusCode,400);
  });
  await t.test('withdrawal and new submission revoke previously issued public media URLs',async()=>{
    const work=await make('Version one');const originalUrl=path(work);assert.equal((await app.inject({url:originalUrl})).statusCode,200);
    const next=await submitWorkVersion(ctx,author.id,{title:'Version two',previewUrl:image.url,expectedVersionId:work.currentVersion!.id},work.id);
    assert.equal((await app.inject({url:originalUrl})).statusCode,404);assert.equal((await app.inject({url:path(next)})).statusCode,404);
    await api('POST',`/api/admin/works/${work.id}/review`,{decision:'approved',versionId:next.currentVersion!.id});assert.equal((await app.inject({url:path(next)})).statusCode,200);assert.equal((await app.inject({url:originalUrl})).statusCode,404);
    await api('POST',`/api/admin/works/${work.id}/take-down`,{reason:'Synthetic withdrawal'});assert.equal((await app.inject({url:path(next)})).statusCode,404);
  });
  await t.test('public media supports bounded byte ranges without changing authorization',async()=>{
    const work=await make('Range image');const url=path(work);
    const first=await app.inject({url,headers:{range:'bytes=0-7'}});assert.equal(first.statusCode,206);assert.deepEqual(first.rawPayload,png.subarray(0,8));assert.equal(first.headers['content-range'],`bytes 0-7/${png.length}`);
    const suffix=await app.inject({url,headers:{range:'bytes=-4'}});assert.deepEqual(suffix.rawPayload,png.subarray(-4));
    for(const range of ['bytes=99999-','bytes=9-2','bytes=0-1,3-4','bytes=-0'])assert.equal((await app.inject({url,headers:{range}})).statusCode,416);
    assert.equal((await app.inject({url:path(work,'unknown')})).statusCode,404);
  });
});
