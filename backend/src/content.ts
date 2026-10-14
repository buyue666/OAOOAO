import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { type Context, httpError, iso, object, pagination, string, transaction } from './core.js';
import { ownedMedia } from './media.js';

type Row = Record<string, any>;
const selectWork = `SELECT w.*,u.username AS author_username,
 v.title,v.summary,v.cover_url,v.preview_url,v.status AS version_status
 FROM oaooao_works w JOIN oaooao_users u ON u.id=w.author_user_id
 LEFT JOIN oaooao_work_versions v ON v.work_id=w.id AND v.id=w.current_version_id`;
const touched = "greatest(updated_at+interval '1 millisecond',date_trunc('milliseconds',clock_timestamp()))";
const publicMediaPattern = '^/api/(media|reference-assets|generation-log-assets)/[a-f0-9-]{36}$';
const publicImages = ['image/png','image/jpeg','image/gif','image/webp'];
const publicPreviews = [...publicImages,'video/mp4','video/webm'];
const publishedState = "w.moderation_status='approved' AND w.lifecycle_status='published' AND v.status='approved' AND v.reviewed_by IS NOT NULL AND v.reviewed_at IS NOT NULL AND u.enabled=true";
// Publication is bound to an approved version's two explicit media slots, never to a project body.
const publicGalleryRows = `WITH published AS (
 SELECT w.id,w.current_version_id,w.author_user_id,w.featured,v.title,v.summary,v.reviewed_at,
 CASE WHEN left(v.cover_url,length($1))=$1 THEN substr(v.cover_url,length($1)+1) ELSE v.cover_url END cover_path,
 CASE WHEN left(v.preview_url,length($1))=$1 THEN substr(v.preview_url,length($1)+1) ELSE v.preview_url END preview_path
 FROM oaooao_works w JOIN oaooao_work_versions v ON v.work_id=w.id AND v.id=w.current_version_id
 JOIN oaooao_users u ON u.id=w.author_user_id WHERE ${publishedState}
), visible AS (
 SELECT p.id,p.current_version_id,p.featured,p.title,p.summary,p.reviewed_at,
 cover.id AS cover_id,preview.id AS preview_id,
 CASE WHEN preview.mime_type LIKE 'video/%' THEN 'video' ELSE 'image' END kind
 FROM published p
 LEFT JOIN oaooao_media cover ON p.cover_path~$2 AND cover.id=substring(p.cover_path from '[^/]+$')
 AND cover.user_id=p.author_user_id AND cover.persistent=true AND cover.mime_type=ANY($3::text[])
 LEFT JOIN oaooao_media preview ON p.preview_path~$2 AND preview.id=substring(p.preview_path from '[^/]+$')
 AND preview.user_id=p.author_user_id AND preview.persistent=true AND preview.mime_type=ANY($4::text[])
 WHERE cover.id IS NOT NULL OR preview.id IS NOT NULL
)`;
function publicSlotUrl(workId:string,versionId:string,slot:'cover'|'preview') {
  return `/api/public/works/${encodeURIComponent(workId)}/versions/${encodeURIComponent(versionId)}/media/${slot}`;
}
function publishedMediaId(raw:string,origin:string) {
  const base=new URL(origin).origin;
  const path=raw.startsWith(base)?raw.slice(base.length):raw;
  return new RegExp(publicMediaPattern).test(path)?path.slice(path.lastIndexOf('/')+1):null;
}

function workView(row: Row) {
  return {id:row.id,authorUserId:row.author_user_id,authorUsername:row.author_username,
    moderationStatus:row.moderation_status,lifecycleStatus:row.lifecycle_status,featured:row.featured,
    currentVersion:row.current_version_id?{id:row.current_version_id,title:row.title,summary:row.summary,
      coverUrl:row.cover_url,previewUrl:row.preview_url,status:row.version_status}:undefined,
    currentPreview:row.preview_url?{previewUrl:row.preview_url}:undefined,
    createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
}
function caseView(row: Row) {
  return {id:row.id,workId:row.work_id,versionId:row.version_id,kind:row.kind,status:row.status,
    reason:row.reason,decision:row.decision,resolution:row.resolution,
    createdAt:iso(row.created_at),resolvedAt:iso(row.resolved_at)};
}
function metadataUrl(value:unknown,name:string) {
  const text=string(value,name,2048,true);if(!text)return '';
  try {const url=new URL(text,'https://metadata.invalid');if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error();}
  catch {throw httpError(400,`Invalid ${name}`);}
  return text;
}
async function lockedWork(client:PoolClient,id:string) {
  const row=(await client.query('SELECT * FROM oaooao_works WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw httpError(404,'Work not found');return row;
}
async function fullWork(client:PoolClient,id:string) {return workView((await client.query(`${selectWork} WHERE w.id=$1`,[id])).rows[0]);}

/** Internal ingestion boundary. HTTP author submission requires its own reviewed client contract. */
export async function submitWorkVersion(ctx:Context,authorId:string,input:unknown,workId?:string) {
  const body=object(input),title=string(body.title,'title',250),summary=string(body.summary,'summary',10000,true);
  const coverUrl=metadataUrl(body.coverUrl,'coverUrl'),previewUrl=metadataUrl(body.previewUrl,'previewUrl');
  return transaction(ctx.db,async client=>{
    const author=(await client.query('SELECT id FROM oaooao_users WHERE id=$1 AND enabled=true',[authorId])).rows[0];
    if(!author)throw httpError(404,'Author not found');
    let id=workId;
    if(id){
      const work=await lockedWork(client,id);if(work.author_user_id!==authorId)throw httpError(404,'Work not found');
      if(work.lifecycle_status==='deleted')throw httpError(409,'Deleted work cannot accept another version');
      if(body.expectedVersionId!==undefined&&body.expectedVersionId!==work.current_version_id)throw httpError(409,'Work version changed; reload before submitting');
    }else{
      const projectId=body.sourceProjectId===undefined?null:string(body.sourceProjectId,'sourceProjectId',200);
      if(projectId&&!(await client.query('SELECT id FROM oaooao_projects WHERE id=$1 AND user_id=$2',[projectId,authorId])).rowCount)throw httpError(404,'Project not found');
      id=randomUUID();await client.query('INSERT INTO oaooao_works(id,author_user_id,source_project_id) VALUES($1,$2,$3)',[id,authorId,projectId]);
    }
    const versionId=randomUUID();await client.query('INSERT INTO oaooao_work_versions(id,work_id,title,summary,cover_url,preview_url) VALUES($1,$2,$3,$4,$5,$6)',[versionId,id,title,summary,coverUrl,previewUrl]);
    await client.query(`UPDATE oaooao_works SET current_version_id=$2,moderation_status='pending',lifecycle_status=CASE WHEN lifecycle_status='taken_down' THEN 'taken_down' ELSE 'draft' END,featured=false,updated_at=${touched} WHERE id=$1`,[id,versionId]);
    await ctx.audit({actorId:authorId,action:'work.submit',targetType:'work',targetId:id,metadata:{versionId}},client);
    return fullWork(client,id);
  });
}

/** Internal ingestion of a real report or appeal, not a fabricated list item. */
export async function openWorkCase(ctx:Context,actorId:string,workId:string,input:unknown) {
  const body=object(input),kind=string(body.kind,'kind',100),reason=string(body.reason,'reason',5000);
  return transaction(ctx.db,async client=>{
    const work=await lockedWork(client,workId);
    const versionId=body.versionId===undefined?work.current_version_id:string(body.versionId,'versionId',200);
    if(versionId&&!(await client.query('SELECT id FROM oaooao_work_versions WHERE id=$1 AND work_id=$2',[versionId,workId])).rowCount)throw httpError(404,'Version not found');
    const row=(await client.query('INSERT INTO oaooao_work_cases(id,work_id,version_id,kind,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),workId,versionId,kind,reason,actorId])).rows[0];
    await ctx.audit({actorId,action:'work.case.open',targetType:'work_case',targetId:row.id,metadata:{workId,versionId,kind}},client);
    return caseView(row);
  });
}

async function recordDecision(ctx:Context,client:PoolClient,actorId:string,work:Row,kind:string,decision:string,reason:string) {
  await client.query(`INSERT INTO oaooao_work_cases(id,work_id,version_id,kind,status,reason,decision,resolution,created_by,resolved_by,resolved_at)
    VALUES($1,$2,$3,$4,'resolved',$5,$6,$5,$7,$7,now())`,[randomUUID(),work.id,work.current_version_id,kind,reason,decision,actorId]);
  await ctx.audit({actorId,action:`work.${kind}`,targetType:'work',targetId:work.id,metadata:{versionId:work.current_version_id,decision,reason}},client);
}

export async function registerContent(app:FastifyInstance,ctx:Context) {
  app.get('/api/public/gallery',async(request,reply)=>{
    const q=(request.query||{}) as Row,{page,pageSize,offset}=pagination({...q,pageSize:q.limit??q.pageSize});
    const kind=string(q.kind,'kind',20,true),sort=string(q.sort,'sort',20,true)||'featured';
    if(kind&&!['image','video'].includes(kind))throw httpError(400,'Unsupported public media kind');
    if(!['featured','latest'].includes(sort))throw httpError(400,'Unsupported gallery sort');
    if(q.featured!==undefined&&!['true','false'].includes(q.featured))throw httpError(400,'Invalid featured filter');
    const values=[new URL(ctx.config.origin).origin,publicMediaPattern,publicImages,publicPreviews,kind,q.featured===undefined?null:q.featured==='true'];
    const where="($5='' OR kind=$5) AND ($6::boolean IS NULL OR featured=$6)";
    const ordering=sort==='featured'?'featured DESC,reviewed_at DESC,id':'reviewed_at DESC,id';
    const rows=await ctx.db.query(`${publicGalleryRows} SELECT * FROM visible WHERE ${where} ORDER BY ${ordering} LIMIT $7 OFFSET $8`,[...values,pageSize,offset]);
    const total=(await ctx.db.query(`${publicGalleryRows} SELECT count(*) AS total FROM visible WHERE ${where}`,values)).rows[0].total;
    reply.header('Cache-Control','no-store');
    return {enabled:true,items:rows.rows.map(row=>({id:row.id,versionId:row.current_version_id,title:row.title,summary:row.summary,
      kind:row.kind,featured:row.featured,publishedAt:iso(row.reviewed_at),
      ...(row.cover_id?{coverUrl:publicSlotUrl(row.id,row.current_version_id,'cover')}:{}),
      mediaUrl:publicSlotUrl(row.id,row.current_version_id,row.preview_id?'preview':'cover')})),total:Number(total),page,pageSize};
  });
  app.get('/api/public/works/:id/versions/:versionId/media/:slot',async(request,reply)=>{
    const params=request.params as Row,id=string(params.id,'id',200),versionId=string(params.versionId,'versionId',200),slot=string(params.slot,'slot',20);
    if(slot!=='cover'&&slot!=='preview')throw httpError(404,'Published media not found');
    const media=await transaction(ctx.db,async client=>{
      const row=(await client.query(`SELECT w.author_user_id,v.cover_url,v.preview_url FROM oaooao_works w
        JOIN oaooao_work_versions v ON v.work_id=w.id AND v.id=w.current_version_id JOIN oaooao_users u ON u.id=w.author_user_id
        WHERE w.id=$1 AND v.id=$2 AND ${publishedState} FOR SHARE OF w,v,u`,[id,versionId])).rows[0];
      if(!row)throw httpError(404,'Published media not found');
      const mediaId=publishedMediaId(slot==='cover'?row.cover_url:row.preview_url,ctx.config.origin);
      if(!mediaId)throw httpError(404,'Published media not found');
      const allowed=slot==='cover'?publicImages:publicPreviews;
      const owned=(await client.query('SELECT id FROM oaooao_media WHERE id=$1 AND user_id=$2 AND persistent=true AND mime_type=ANY($3::text[]) FOR SHARE',[mediaId,row.author_user_id,allowed])).rows[0];
      if(!owned)throw httpError(404,'Published media not found');
      try{return await ownedMedia(ctx,row.author_user_id,mediaId,client);}catch{throw httpError(404,'Published media not found');}
    });
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Accept-Ranges','bytes').type(media.mimeType);
    const range=request.headers.range;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      let start=0,end=media.bytes.length-1;
      if(match&&match[1]){start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);}
      else if(match&&match[2])start=Math.max(0,media.bytes.length-Number(match[2]));
      if(!match||(!match[1]&&!match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=media.bytes.length||end<start){reply.header('Content-Range',`bytes */${media.bytes.length}`);return reply.code(416).send();}
      reply.code(206).header('Content-Range',`bytes ${start}-${end}/${media.bytes.length}`);return reply.send(media.bytes.subarray(start,end+1));
    }
    return reply.send(media.bytes);
  });
  app.get('/api/admin/works',async request=>{
    await ctx.requireUser(request,'content.manage');const q=(request.query||{}) as Row,{page,pageSize,offset}=pagination(q);
    const status=string(q.status,'status',40,true),lifecycle=string(q.lifecycleStatus,'lifecycleStatus',40,true),keyword=string(q.keyword,'keyword',250,true);
    const where="w.lifecycle_status<>'deleted' AND ($1='' OR w.moderation_status=$1) AND ($2='' OR w.lifecycle_status=$2) AND ($3='' OR v.title ILIKE '%'||$3||'%' OR u.username ILIKE '%'||$3||'%')";
    const values=[status,lifecycle,keyword];
    const rows=await ctx.db.query(`${selectWork} WHERE ${where} ORDER BY w.updated_at DESC,w.id LIMIT $4 OFFSET $5`,[...values,pageSize,offset]);
    const total=(await ctx.db.query(`SELECT count(*) AS total FROM (${selectWork} WHERE ${where}) matches`,values)).rows[0].total;
    return {items:rows.rows.map(workView),total:Number(total),page,pageSize};
  });
  app.post('/api/admin/works/:id/review',async request=>{
    const actor=await ctx.requireUser(request,'content.manage'),body=object(request.body),id=string((request.params as Row).id,'id',200);
    if(!['approved','rejected'].includes(body.decision))throw httpError(400,'Decision must be approved or rejected');
    const reason=string(body.reason,'reason',5000,true);
    return transaction(ctx.db,async client=>{
      const work=await lockedWork(client,id);if(work.lifecycle_status==='deleted')throw httpError(409,'Deleted work cannot be reviewed');
      if(!work.current_version_id)throw httpError(409,'Work has no submitted version');
      if(body.versionId!==undefined&&body.versionId!==work.current_version_id)throw httpError(409,'Review targets an outdated work version');
      if(work.moderation_status===body.decision)return {work:await fullWork(client,id)};
      await client.query('UPDATE oaooao_work_versions SET status=$2,review_reason=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1',[work.current_version_id,body.decision,reason,actor.id]);
      // Reviewing a taken-down work does not override a separate takedown decision.
      await client.query(`UPDATE oaooao_works SET moderation_status=$2,lifecycle_status=CASE WHEN lifecycle_status='taken_down' THEN 'taken_down' WHEN $2='approved' THEN 'published' ELSE 'draft' END,featured=false,updated_at=${touched} WHERE id=$1`,[id,body.decision]);
      await recordDecision(ctx,client,actor.id,work,'review',body.decision,reason);
      return {work:await fullWork(client,id)};
    });
  });
  app.post('/api/admin/works/:id/take-down',async request=>{
    const actor=await ctx.requireUser(request,'content.manage'),body=object(request.body),id=string((request.params as Row).id,'id',200),reason=string(body.reason,'reason',5000);
    return transaction(ctx.db,async client=>{
      const work=await lockedWork(client,id);if(work.lifecycle_status==='deleted')throw httpError(409,'Deleted work cannot be taken down');
      if(work.lifecycle_status!=='taken_down'){
        await client.query(`UPDATE oaooao_works SET lifecycle_status='taken_down',featured=false,updated_at=${touched} WHERE id=$1`,[id]);
        await recordDecision(ctx,client,actor.id,work,'take_down','taken_down',reason);
      }
      return {work:await fullWork(client,id)};
    });
  });
  app.post('/api/admin/works/:id/feature',async request=>{
    const actor=await ctx.requireUser(request,'content.manage'),body=object(request.body),id=string((request.params as Row).id,'id',200);
    if(typeof body.featured!=='boolean')throw httpError(400,'featured must be a boolean');
    return transaction(ctx.db,async client=>{
      const work=await lockedWork(client,id);if(work.lifecycle_status==='deleted')throw httpError(409,'Deleted work cannot be featured');
      if(body.featured&&(work.moderation_status!=='approved'||work.lifecycle_status!=='published'))throw httpError(409,'Only approved, published works can be featured');
      if(work.featured!==body.featured){await client.query(`UPDATE oaooao_works SET featured=$2,updated_at=${touched} WHERE id=$1`,[id,body.featured]);await ctx.audit({actorId:actor.id,action:'work.feature',targetType:'work',targetId:id,metadata:{featured:body.featured}},client);}
      return {work:await fullWork(client,id)};
    });
  });
  app.delete('/api/admin/works/:id',async request=>{
    const actor=await ctx.requireUser(request,'content.manage'),id=string((request.params as Row).id,'id',200);
    return transaction(ctx.db,async client=>{const work=await lockedWork(client,id);if(work.lifecycle_status!=='deleted'){
      await client.query(`UPDATE oaooao_works SET lifecycle_status='deleted',featured=false,updated_at=${touched} WHERE id=$1`,[id]);
      await ctx.audit({actorId:actor.id,action:'work.delete',targetType:'work',targetId:id,metadata:{versionId:work.current_version_id}},client);
    }return {ok:true};});
  });
  app.get('/api/admin/work-cases',async request=>{
    await ctx.requireUser(request,'content.manage');const {page,pageSize,offset}=pagination(request.query);
    const rows=await ctx.db.query('SELECT * FROM oaooao_work_cases ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[pageSize,offset]);
    const total=(await ctx.db.query('SELECT count(*) AS total FROM oaooao_work_cases')).rows[0].total;
    return {items:rows.rows.map(caseView),total:Number(total),page,pageSize};
  });
  app.post('/api/admin/work-cases/:id/resolve',async request=>{
    const actor=await ctx.requireUser(request,'content.manage'),body=object(request.body),id=string((request.params as Row).id,'id',200);
    const decision=string(body.decision,'decision',100),resolution=string(body.resolution,'resolution',5000,true);
    return transaction(ctx.db,async client=>{
      const row=(await client.query('SELECT * FROM oaooao_work_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw httpError(404,'Work case not found');
      if(row.status==='resolved'){
        if(row.decision!==decision||(row.resolution||'')!==resolution)throw httpError(409,'Case has already been resolved with a different decision');
        return {case:caseView(row)};
      }
      const result=(await client.query("UPDATE oaooao_work_cases SET status='resolved',decision=$2,resolution=$3,resolved_by=$4,resolved_at=now() WHERE id=$1 RETURNING *",[id,decision,resolution,actor.id])).rows[0];
      await ctx.audit({actorId:actor.id,action:'work.case.resolve',targetType:'work_case',targetId:id,metadata:{workId:row.work_id,decision,resolution}},client);
      return {case:caseView(result)};
    });
  });
}
