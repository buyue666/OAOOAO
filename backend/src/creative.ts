import { registerAgentRoutes as registerAgents } from './agents.js';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { httpError, object, string, pagination, transaction, hasPermission, type Context } from './core.js';
import { adjustWallet, getWallet, getPlanSummary, creditUnits } from './wallet.js';
import { getSettings } from './settings.js';
import { assertPlanGenerationAllowed } from './entitlements.js';
import { resolveProvider, type GenerationKind, type Json } from './providers.js';
import { registerMedia, validateLibraryMedia, encoderAvailable, ownedMedia, decodeDataUrl } from './media.js';
import { cancelJob, finishJob, jobEvent, startWorker } from './worker.js';

const ok=(data:unknown)=>({code:0,data});
const iso=(v:unknown)=>new Date(v as string).toISOString();
function stable(value:any):string{return JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,JSON.parse(stable(value[k]))])):value??null);}
export const inputHash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
export function taskView(row:Json){return{id:row.id,kind:row.kind,status:row.status,model:row.model,result:row.result||undefined,error:row.error||undefined,pointsCost:Number(row.cost),pointsRefunded:['error','cancelled'].includes(row.status)&&Number(row.cost)>0,needsReview:row.needs_review,reviewReason:row.needs_review?row.error:undefined,executionPhase:row.phase,upstreamId:row.upstream_id||undefined,canRetry:row.status==='error',createdAt:new Date(row.created_at).getTime(),updatedAt:new Date(row.updated_at).getTime(),prompt:row.input.prompt,clientRequestId:row.client_request_id,cancelRequested:row.cancel_requested};}
function projectView(row:Json){return{...row.document,id:row.id,title:row.title,sourceHandoffId:row.source_handoff_id||undefined,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};}
function assetView(row:Json){return{...row.document,id:row.id,kind:row.kind,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};}
function textMessageContent(value:unknown){
  if(typeof value==='string')return value.slice(0,32000);
  if(!Array.isArray(value)||value.length<1||value.length>12)throw httpError(400,'Invalid multimodal message content');
  return value.map((part:unknown)=>{
    const item=object(part);const type=String(item.type||'');
    if(type==='text')return {type:'text',text:string(item.text,'message text',32000)};
    if(type==='image_url'){
      const image=object(item.image_url);const url=string(image.url,'image URL',2000);
      if(!/^\/api\/(?:media|reference-assets|generation-log-assets)\/[a-f0-9-]{36}$/i.test(url))throw httpError(400,'Image analysis only accepts an owned media URL');
      return {type:'image_url',image_url:{url}};
    }
    throw httpError(400,'Unsupported multimodal message part');
  });
}
function generationInput(kind:GenerationKind,raw:unknown):Json{
  const body=object(raw);const config=body.config?object(body.config):{};let prompt=body.prompt;
  let messages;
  if(kind==='text'&&Array.isArray(body.messages)){messages=body.messages.map((m:unknown)=>{const v=object(m);if(!['user','assistant','system','developer'].includes(v.role))throw httpError(400,'Invalid text message role');return{role:v.role,content:textMessageContent(v.content)};});if(!messages.length||messages.length>100)throw httpError(400,'Invalid messages');prompt=messages.map((m:any)=>typeof m.content==='string'?m.content:m.content.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join(' ')).join('\n');}
  const input:Json={prompt:kind==='render'?'Render clips':string(prompt,'prompt',64000),config:{...config},context:body.context?object(body.context):{},source:typeof body.source==='string'?body.source:'workbench'};
  if(messages)input.messages=messages;
  if(body.kind)input.kind=body.kind;
  if(body.references){if(!Array.isArray(body.references)||body.references.length>16)throw httpError(400,'Invalid references');input.references=body.references.map((r:unknown)=>{const ref=object(r);if(typeof ref.url!=='string'&&typeof ref.dataUrl!=='string')throw httpError(400,'Invalid reference');return{...ref};});}
  if(kind==='image'&&body.edit!==undefined){
    const edit=object(body.edit);
    const allowed=['inpaint','remove-background','erase','outpaint','enhance','layers'];
    const operation=edit.operation===undefined?undefined:string(edit.operation,'edit operation',40);
    if(operation!==undefined&&!allowed.includes(operation))throw httpError(400,'Unsupported image edit operation');
    let mask:Json|undefined;
    if(edit.mask!==undefined){
      const candidate=object(edit.mask);
      if(typeof candidate.url!=='string'&&typeof candidate.dataUrl!=='string')throw httpError(400,'Invalid edit mask');
      mask={...candidate};
    }
    if(operation!==undefined||mask)input.edit={...(operation?{operation}:{}),...(mask?{mask}: {})};
    if(input.edit&&!input.kind)input.kind='edit';
  }
  if(kind==='render'){input.shots=body.shots;input.ratio=body.ratio;}
  if(Buffer.byteLength(JSON.stringify(input))>32*1024*1024)throw httpError(413,'Generation request is too large');
  return input;
}
async function verifyContext(ctx:Context,client:PoolClient,userId:string,input:Json){
  if(input.context?.projectId){const row=await client.query('SELECT id FROM oaooao_projects WHERE id=$1 AND user_id=$2',[input.context.projectId,userId]);if(!row.rowCount)throw httpError(404,'Project not found');}
  if(input.context?.parentTaskId){const row=await client.query('SELECT id FROM oaooao_generation_jobs WHERE id=$1 AND user_id=$2',[input.context.parentTaskId,userId]);if(!row.rowCount)throw httpError(404,'Parent task not found');}
  for(const ref of input.references||[]){if(typeof ref.url!=='string')continue;let url:URL;try{url=new URL(ref.url,ctx.config.origin);}catch{throw httpError(400,'Invalid reference URL');}if(url.origin===new URL(ctx.config.origin).origin){const match=/^\/api\/(?:media|reference-assets|generation-log-assets)\/([a-f0-9-]{36})$/i.exec(url.pathname);if(!match)throw httpError(400,'Unsupported local reference');await ownedMedia(ctx,userId,match[1],client);}}
  const mask=input.edit?.mask;
  if(mask&&typeof mask.url==='string'){
    let url:URL;try{url=new URL(mask.url,ctx.config.origin);}catch{throw httpError(400,'Invalid edit mask URL');}
    if(url.origin!==new URL(ctx.config.origin).origin)throw httpError(400,'Edit mask must be an owned media asset or data URL');
    const match=/^\/api\/(?:media|reference-assets|generation-log-assets)\/([a-f0-9-]{36})$/i.exec(url.pathname);
    if(!match||url.search)throw httpError(400,'Unsupported edit mask asset');
    const owned=await ownedMedia(ctx,userId,match[1],client);
    if(!owned.mimeType.startsWith('image/'))throw httpError(400,'Edit mask must be an image');
  }
  if(mask&&typeof mask.dataUrl==='string'){
    const bytes=decodeDataUrl(mask.dataUrl);
    if(!bytes.length)throw httpError(400,'Edit mask must be an image');
    // decodeDataUrl performs signature validation; image formats are the only
    // mask inputs accepted by the image-edit adapter.
    const signature=bytes.subarray(0,8);
    const image=signature.equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216&&bytes[2]===255||/^GIF8[79]a/.test(bytes.subarray(0,6).toString())||(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP');
    if(!image)throw httpError(400,'Edit mask must be an image');
  }
  for(const message of input.messages||[]){if(typeof message.content==='string')continue;for(const part of message.content){if(part.type!=='image_url')continue;const parsed=new URL(part.image_url.url,ctx.config.origin);if(parsed.origin!==new URL(ctx.config.origin).origin)throw httpError(400,'Image analysis only accepts an owned media URL');const match=/^\/api\/(?:media|reference-assets|generation-log-assets)\/([a-f0-9-]{36})$/i.exec(parsed.pathname);if(!match||parsed.search)throw httpError(400,'Unsupported image analysis asset');await ownedMedia(ctx,userId,match[1],client);}}
}
export async function createJob(ctx:Context,userId:string,kind:GenerationKind,input:Json,requestId:string,attemptNo=1,providedClient?:PoolClient):Promise<Json>{
  if(!requestId||requestId.length>200||!Number.isSafeInteger(attemptNo)||attemptNo<1||attemptNo>1000)throw httpError(400,'Invalid submission identity');
  const execute=async(client:PoolClient)=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`generation:${userId}`]);
    const hash=inputHash(input);const existing=(await client.query('SELECT * FROM oaooao_generation_jobs WHERE user_id=$1 AND kind=$2 AND client_request_id=$3 AND attempt_no=$4',[userId,kind,requestId,attemptNo])).rows[0];
    if(existing){if(existing.input_hash!==hash)throw httpError(409,'Submission identity was already used for different input');return existing;}
    // Serialize entitlement changes with new submissions, including free jobs.
    // Read the current plan only after this lock: a transaction that waited for
    // an assignment/revocation must not authorize against the former plan.
    const account=(await client.query('SELECT id,enabled FROM oaooao_users WHERE id=$1 FOR NO KEY UPDATE',[userId])).rows[0];
    if(!account?.enabled)throw httpError(403,'�˺Ų����ڻ���ͣ�ã��޷�������������');
    await verifyContext(ctx,client,userId,input);
    const settings=await getSettings(ctx,client);
    let plan:Json|undefined;
    if(settings.entitlements?.enabled){
      const summary=await getPlanSummary(ctx,userId,client);const planId=summary.hasActivePlan?summary.planId:settings.entitlements.defaultPlanId;
      plan=settings.entitlements.plans?.find((p:Json)=>p.id===planId&&p.enabled);
      if(!plan)throw httpError(403,'û�п��õĴ���Ȩ�淽��������ϵ����Ա');
      assertPlanGenerationAllowed(plan,kind);
    }
    const provider=await resolveProvider(ctx,kind,input,client);
    if(input.context?.approvedCost!==undefined&&creditUnits(provider.cost)>creditUnits(input.context.approvedCost))throw httpError(409,'Model pricing increased after plan approval; create a new plan before continuing');
    const totalLimit=settings.generationCostControl?.dailyTotalPointSpend;
    if(Number(totalLimit)>0){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('generation:global-budget',0))");const total=(await client.query("SELECT coalesce(sum(cost),0)::text amount FROM oaooao_generation_jobs WHERE created_at>=date_trunc('day',now()) AND status NOT IN ('error','cancelled')")).rows[0].amount;if(creditUnits(total)+creditUnits(provider.cost)>creditUnits(totalLimit))throw httpError(429,'Global daily generation spending limit reached');}
    if(plan){
      const counts=(await client.query("SELECT count(*) calls,count(*) FILTER(WHERE kind=$2) count,coalesce(sum(cost) FILTER(WHERE status NOT IN ('error','cancelled')),0)::text spend FROM oaooao_generation_jobs WHERE user_id=$1 AND created_at>=date_trunc('day',now())",[userId,kind])).rows[0];
      const key:Record<string,string>={text:'dailyText',image:'dailyImages',video:'dailyVideos',audio:'dailyAudio'};const limits=plan.limits||{};
      if((Number(limits.dailyApiCalls)>0&&Number(counts.calls)>=Number(limits.dailyApiCalls))||(Number(limits[key[kind]])>0&&Number(counts.count)>=Number(limits[key[kind]])))throw httpError(429,'Daily plan generation limit reached');
      if(Number(limits.dailyPointSpend)>0&&creditUnits(counts.spend)+creditUnits(provider.cost)>creditUnits(limits.dailyPointSpend))throw httpError(429,'Daily plan spending limit reached');
    }
    const active=Number((await client.query("SELECT count(*) FROM oaooao_generation_jobs WHERE user_id=$1 AND kind=$2 AND status IN ('pending','running','paused')",[userId,kind])).rows[0].count);
    const limit=Math.max(1,Number(settings.generationConcurrency?.[kind]||3));if(active>=limit)throw httpError(429,'Generation concurrency limit reached');
    const dayLimit=settings.generationCostControl?.dailyUserPointSpend;
    if(Number(dayLimit)>0){const spent=(await client.query("SELECT coalesce(sum(cost),0)::text amount FROM oaooao_generation_jobs WHERE user_id=$1 AND created_at>=date_trunc('day',now()) AND status NOT IN ('error','cancelled')",[userId])).rows[0].amount;if(creditUnits(spent)+creditUnits(provider.cost)>creditUnits(dayLimit))throw httpError(429,'Daily generation spending limit reached');}
    const id=randomUUID();
    if(Number(provider.cost)>0)await adjustWallet(ctx,userId,`generation:${id}:debit`,'-'+provider.cost,{kind:'generation',taskId:id,model:provider.model},client);
    return(await client.query('INSERT INTO oaooao_generation_jobs(id,user_id,kind,client_request_id,attempt_no,input_hash,input,model,channel_id,upstream_model,provider_config,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[id,userId,kind,requestId,attemptNo,hash,input,provider.model,provider.channelId,provider.upstreamModel,provider.config,provider.cost])).rows[0];
  };
  return providedClient?execute(providedClient):transaction(ctx.db,execute);
}
async function points(ctx:Context,userId:string,reply:FastifyReply){const w=await getWallet(ctx,userId);reply.header('x-vozeb-pro-points-remaining',w.pointsBalance).header('x-vozeb-pro-points-permanent',w.permanentPointsBalance).header('x-vozeb-pro-points-daily',w.dailyPointsBalance).header('x-oao-points-timed',w.timedPointsBalance);if(w.dailyPointsExpiresAt)reply.header('x-vozeb-pro-points-daily-expires-at',w.dailyPointsExpiresAt);if(w.timedPointsExpiresAt)reply.header('x-oao-points-timed-expires-at',w.timedPointsExpiresAt);}
async function ownedJob(ctx:Context,request:FastifyRequest,id:string,manage=false){
  const user=await ctx.requireUser(request);const elevated=hasPermission(user,manage?'generation.manage':'generation.read');
  const row=(await ctx.db.query(`SELECT * FROM oaooao_generation_jobs WHERE id=$1 AND (user_id=$2 OR $3)`,[id,user.id,elevated])).rows[0];if(!row)throw httpError(404,'Task not found');return{user,row};
}
function normalizeProject(kind:string,raw:Json,create=false){
  const doc={...raw};delete doc.id;delete doc.createdAt;delete doc.updatedAt;delete doc.userId;
  if(Buffer.byteLength(JSON.stringify(doc))>2*1024*1024)throw httpError(413,'Project exceeds 2 MiB');
  if(kind==='canvas'){if(create){doc.nodes??=[];doc.connections??=[];}if(!Array.isArray(doc.nodes)||!Array.isArray(doc.connections))throw httpError(400,'Canvas nodes and connections are required');}
  else{if(!Array.isArray(doc.episodes)||!doc.episodes.length)throw httpError(400,'Drama project requires at least one episode');for(const ep of doc.episodes)if(!ep||!Array.isArray(ep.shots))throw httpError(400,'Episode shots must be an array');if(doc.status&&!['active','archived'].includes(doc.status))throw httpError(400,'Invalid project status');}
  return doc;
}
async function registerProjects(app:FastifyInstance,ctx:Context){
  for(const kind of ['canvas','drama']){
    const root=`/api/${kind}/projects`;
    app.get(root,async request=>{const user=await ctx.requireUser(request);const page=pagination(request.query);const found=await ctx.db.query('SELECT *,count(*) OVER() total FROM oaooao_projects WHERE user_id=$1 AND kind=$2 ORDER BY updated_at DESC,id LIMIT $3 OFFSET $4',[user.id,kind,page.pageSize,page.offset]);return ok({projects:found.rows.map(row=>{const p=projectView(row);return{id:p.id,title:p.title,sourceHandoffId:p.sourceHandoffId,status:p.status,createdAt:p.createdAt,updatedAt:p.updatedAt,nodeCount:p.nodes?.length||0,connectionCount:p.connections?.length||0,shotCount:p.episodes?.reduce((n:number,e:Json)=>n+(e.shots?.length||0),0)||0};}),total:Number(found.rows[0]?.total||0),...page});});
    app.post(root,{bodyLimit:3*1024*1024},async request=>{const user=await ctx.requireUser(request);const body=object(request.body);const title=string(body.title,'title',250);const handoff=body.sourceHandoffId?string(body.sourceHandoffId,'sourceHandoffId',200):null;
      let document:Json;
      if(kind==='canvas')document=normalizeProject(kind,body.project?object(body.project):{},true);
      else{const episodeId=randomUUID();document=normalizeProject(kind,{summary:body.summary||'',style:body.style||'',ratio:body.ratio||'9:16',status:'active',characters:[],scenes:[],props:[],clues:[],defaultVideoMode:'storyboard',activeEpisodeId:episodeId,sourceAssets:body.sourceAssets||[],episodes:[{id:episodeId,title:'�� 1 ��',script:body.initialScript||'',outline:'',hook:'',nextPreview:'',sourceRange:'',reviewStatus:'draft',shots:[]}]});}
      const project=await transaction(ctx.db,async client=>{if(handoff){await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`handoff:${user.id}:${kind}:${handoff}`]);const found=(await client.query('SELECT * FROM oaooao_projects WHERE user_id=$1 AND kind=$2 AND source_handoff_id=$3',[user.id,kind,handoff])).rows[0];if(found)return found;}const id=kind==='drama'?`drama-${randomUUID()}`:randomUUID();return(await client.query('INSERT INTO oaooao_projects(id,user_id,kind,title,source_handoff_id,document) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,user.id,kind,title,handoff,document])).rows[0];});return ok({project:projectView(project)});
    });
    app.get(root+'/:id',async request=>{const user=await ctx.requireUser(request);const row=(await ctx.db.query('SELECT * FROM oaooao_projects WHERE id=$1 AND user_id=$2 AND kind=$3',[(request.params as any).id,user.id,kind])).rows[0];if(!row)throw httpError(404,'Project not found');return ok({project:projectView(row)});});
    app.patch(root+'/:id',{bodyLimit:3*1024*1024},async request=>{const user=await ctx.requireUser(request);const body=object(request.body);const raw=kind==='canvas'?object(body.project):body;const version=body.expectedUpdatedAt||raw.updatedAt;if(typeof version!=='string'||!Number.isFinite(Date.parse(version)))throw httpError(428,'Project version is required');const document=normalizeProject(kind,raw);const title=string(raw.title,'title',250);const id=(request.params as any).id;const changed=await ctx.db.query(`UPDATE oaooao_projects SET title=$4,document=$5,updated_at=greatest(updated_at+interval '1 millisecond',date_trunc('milliseconds',clock_timestamp())) WHERE id=$1 AND user_id=$2 AND kind=$3 AND updated_at=$6::timestamptz RETURNING *`,[id,user.id,kind,title,document,version]);if(!changed.rowCount){const found=await ctx.db.query('SELECT id FROM oaooao_projects WHERE id=$1 AND user_id=$2 AND kind=$3',[id,user.id,kind]);throw httpError(found.rowCount?409:404,found.rowCount?'Project was updated elsewhere; reload before saving':'Project not found');}return ok({project:projectView(changed.rows[0])});});
    app.delete(root+'/:id',async request=>{const user=await ctx.requireUser(request);const deleted=await ctx.db.query('DELETE FROM oaooao_projects WHERE id=$1 AND user_id=$2 AND kind=$3',[(request.params as any).id,user.id,kind]);return ok({deleted:Boolean(deleted.rowCount)});});
    if(kind==='canvas')app.delete(root,async request=>{const user=await ctx.requireUser(request);const ids=object(request.body).ids;if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'))throw httpError(400,'Invalid project identifiers');const deleted=await ctx.db.query("DELETE FROM oaooao_projects WHERE id=ANY($1::text[]) AND user_id=$2 AND kind='canvas' RETURNING id",[ids,user.id]);return ok({deleted:deleted.rows.map(r=>r.id)});});
  }
}
async function registerLibrary(app:FastifyInstance,ctx:Context){
  app.get('/api/library-assets',async request=>{const user=await ctx.requireUser(request);const q=request.query as Json;const page=pagination(q);const where='user_id=$1 AND ($2=\'\' OR kind=$2) AND ($3=\'\' OR document->>\'title\' ILIKE \'%\'||$3||\'%\')';const values=[user.id,q.kind||'',q.keyword||''];const found=await ctx.db.query(`SELECT *,count(*) OVER() total FROM oaooao_library_assets WHERE ${where} ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`,[...values,page.pageSize,page.offset]);return ok({assets:found.rows.map(assetView),total:Number(found.rows[0]?.total||0),page:page.page,pageSize:page.pageSize});});
  app.post('/api/library-assets',async request=>{const user=await ctx.requireUser(request);const body=object(request.body);if(!['text','image','video','audio'].includes(body.kind))throw httpError(400,'Invalid asset kind');const input={kind:body.kind,title:string(body.title,'title',250),coverUrl:body.coverUrl,tags:Array.isArray(body.tags)?body.tags.slice(0,30):[],source:body.source,note:body.note,data:object(body.data),metadata:body.metadata};await validateLibraryMedia(ctx,user.id,input);if(input.coverUrl){const url=new URL(input.coverUrl,ctx.config.origin);if(url.origin!==new URL(ctx.config.origin).origin)throw httpError(400,'Cover must be an owned media asset');await ownedMedia(ctx,user.id,url.pathname.split('/').pop()!);}
    const asset=await transaction(ctx.db,async client=>{const candidate=input.metadata?.creativeCandidate;if(candidate){await verifyContext(ctx,client,user.id,{context:{projectId:candidate.projectId}});if(typeof candidate.key!=='string')throw httpError(400,'Invalid candidate provenance');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`candidate:${user.id}:${candidate.key}`]);const existing=(await client.query("SELECT * FROM oaooao_library_assets WHERE user_id=$1 AND document->'metadata'->'creativeCandidate'->>'key'=$2",[user.id,candidate.key])).rows[0];if(existing)return existing;}return(await client.query('INSERT INTO oaooao_library_assets(id,user_id,kind,document) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),user.id,body.kind,input])).rows[0];});return ok({asset:assetView(asset)});});
  app.delete('/api/library-assets/:id',async request=>{const user=await ctx.requireUser(request);await ctx.db.query('DELETE FROM oaooao_library_assets WHERE id=$1 AND user_id=$2',[(request.params as any).id,user.id]);return ok({deleted:true});});
}
async function agentOperations(ctx:Context,q:Json){
  const page=pagination(q);const args=[q.status||'',q.surface||'',q.userId||'',q.search||''];
  const source=`SELECT r.*,CASE r.state WHEN 'planning' THEN 'pending' WHEN 'awaiting_approval' THEN 'paused' WHEN 'completed' THEN 'success' WHEN 'failed' THEN 'error' ELSE r.state END status,p.model,p.channel_id,p.phase,u.username,u.display_name,
    (SELECT coalesce(sum(j.cost),0) FROM oaooao_generation_jobs j WHERE j.input->'context'->>'runId'=r.id AND j.status NOT IN ('error','cancelled')) cost,
    (SELECT j.id FROM oaooao_generation_jobs j WHERE (j.id=r.job_id OR j.id IN (SELECT s.job_id FROM oaooao_agent_steps s WHERE s.run_id=r.id)) AND j.status='error' ORDER BY j.updated_at DESC LIMIT 1) retry_task_id,
    EXISTS(SELECT 1 FROM oaooao_generation_jobs j WHERE (j.id=r.job_id OR j.id IN (SELECT s.job_id FROM oaooao_agent_steps s WHERE s.run_id=r.id)) AND j.needs_review) needs_review
    FROM oaooao_agent_runs r JOIN oaooao_generation_jobs p ON p.id=r.job_id JOIN oaooao_users u ON u.id=r.user_id`;
  const filtered=`SELECT * FROM (${source}) a WHERE ($1='' OR status=$1) AND ($2='' OR input->>'surface'=$2) AND ($3='' OR user_id=$3) AND ($4='' OR input->>'prompt' ILIKE '%'||$4||'%' OR id=$4)`;
  const rows=(await ctx.db.query(`SELECT * FROM (${filtered}) selected ORDER BY created_at DESC,id LIMIT $5 OFFSET $6`,[...args,page.pageSize,page.offset])).rows;
  const summary=(await ctx.db.query(`SELECT count(*) total,count(*) FILTER(WHERE status IN ('pending','running','paused')) active,count(*) FILTER(WHERE status='success') success,count(*) FILTER(WHERE status='error') failed,coalesce(sum(cost),0) cost,coalesce(avg(extract(epoch FROM (updated_at-created_at))*1000) FILTER(WHERE status IN ('success','error','cancelled')),0) duration FROM (${filtered}) selected`,args)).rows[0];
  const counts=(await ctx.db.query(`SELECT status,count(*) n FROM (${filtered}) selected GROUP BY status`,args)).rows;
  return{items:rows.map(r=>({id:r.id,type:'agent',userId:r.user_id,username:r.username,displayName:r.display_name,status:r.status,surface:r.input.surface,runId:r.id,model:r.model,channelId:r.channel_id,prompt:r.input.prompt,error:r.failure||undefined,executionPhase:r.state,leaseExpired:false,durationMs:new Date(r.updated_at).getTime()-new Date(r.created_at).getTime(),pointsCost:Number(r.cost),createdAt:new Date(r.created_at).getTime(),updatedAt:new Date(r.updated_at).getTime(),canCancel:!['completed','cancelled','failed'].includes(r.state),canReview:r.needs_review,retryTaskId:r.retry_task_id||undefined})),total:Number(summary.total),page:page.page,pageSize:page.pageSize,summary:{total:Number(summary.total),active:Number(summary.active),success:Number(summary.success),failed:Number(summary.failed),averageDurationMs:Number(summary.duration),totalPointsCost:Number(summary.cost),byType:{agent:Number(summary.total)},byStatus:Object.fromEntries(counts.map(r=>[r.status,Number(r.n)]))}};
}
async function registerAdmin(app:FastifyInstance,ctx:Context){
  app.get('/api/admin/generation-operations',async request=>{
    await ctx.requireUser(request,'generation.read');const q=request.query as Json;if(q.type==='agent')return agentOperations(ctx,q);const page=pagination(q);const params=[q.type||'',q.status||'',q.surface||'',q.userId||'',q.search||''];
    const where="($1='' OR j.kind=$1) AND ($2='' OR j.status=$2) AND ($3='' OR j.input->>'source'=$3) AND ($4='' OR j.user_id=$4) AND ($5='' OR j.input->>'prompt' ILIKE '%'||$5||'%' OR j.id=$5)";
    const rows=await ctx.db.query(`SELECT j.*,j.lease_until<now() lease_expired,u.username,u.display_name,count(*) OVER() total FROM oaooao_generation_jobs j JOIN oaooao_users u ON u.id=j.user_id WHERE ${where} ORDER BY j.created_at DESC LIMIT $6 OFFSET $7`,[...params,page.pageSize,page.offset]);
    const aggregate=(await ctx.db.query(`SELECT count(*) total,count(*) FILTER(WHERE status IN ('pending','running','paused')) active,count(*) FILTER(WHERE status='success') success,count(*) FILTER(WHERE status='error') failed,coalesce(avg(extract(epoch FROM (finished_at-created_at))*1000),0) duration,coalesce(sum(cost),0) cost FROM oaooao_generation_jobs j WHERE ${where}`,params)).rows[0];
    const groups=await ctx.db.query(`SELECT kind,status,count(*) count FROM oaooao_generation_jobs j WHERE ${where} GROUP BY kind,status`,params);const byType:Json={},byStatus:Json={};for(const row of groups.rows){byType[row.kind]=(byType[row.kind]||0)+Number(row.count);byStatus[row.status]=(byStatus[row.status]||0)+Number(row.count);}
    const settings=await getSettings(ctx);const channels=[];
    for(const model of settings.logicalModels||[])for(const binding of model.bindings||[]){const channel=settings.systemChannels?.find((c:Json)=>c.id===binding.channelId);if(!channel)continue;const recent=(await ctx.db.query('SELECT status,error,extract(epoch FROM (finished_at-started_at))*1000 duration FROM oaooao_generation_jobs WHERE channel_id=$1 AND model=$2 ORDER BY created_at DESC LIMIT 20',[channel.id,model.id])).rows;let failures=0;for(const item of recent){if(item.status!=='error')break;failures++;}channels.push({id:binding.id,name:channel.name,capability:model.capability,logicalModelId:model.id,logicalModelName:model.name,upstreamModel:binding.upstreamModel,enabled:Boolean(channel.enabled&&model.enabled&&binding.enabled),runtimeHealth:{status:'healthy',consecutiveFailures:failures,lastError:recent.find(r=>r.error)?.error||undefined},planningRuntime:{protocol:channel.apiFormat,successCount:recent.filter(r=>r.status==='success').length,failureCount:recent.filter(r=>r.status==='error').length,averageLatencyMs:recent.filter(r=>r.duration!==null).length?recent.reduce((n,r)=>n+Number(r.duration||0),0)/recent.filter(r=>r.duration!==null).length:undefined}});}
    const metrics=(await ctx.db.query(`WITH timings AS (SELECT extract(epoch FROM (p.finished_at-r.created_at))*1000 planning,extract(epoch FROM (p.started_at-p.created_at))*1000 queue,extract(epoch FROM (p.finished_at-p.started_at))*1000 upstream,extract(epoch FROM (r.approved_at-p.finished_at))*1000 review,extract(epoch FROM ((SELECT min(j.finished_at) FROM oaooao_agent_steps s JOIN oaooao_generation_jobs j ON j.id=s.job_id WHERE s.run_id=r.id AND j.status='success')-r.created_at))*1000 first_result FROM oaooao_agent_runs r JOIN oaooao_generation_jobs p ON p.id=r.job_id) SELECT count(planning) sample,percentile_cont(0.5) WITHIN GROUP(ORDER BY planning) p50,percentile_cont(0.95) WITHIN GROUP(ORDER BY planning) p95,percentile_cont(0.5) WITHIN GROUP(ORDER BY first_result) f50,percentile_cont(0.95) WITHIN GROUP(ORDER BY first_result) f95,avg(queue) queue,avg(upstream) upstream,avg(review) review FROM timings`)).rows[0];
    return{items:rows.rows.map(row=>({...taskView(row),userId:row.user_id,username:row.username,displayName:row.display_name,type:row.kind,channelId:row.channel_id,provider:row.provider_config.protocol,surface:row.input.source,workerId:row.lease_owner,leaseUntil:row.lease_until?new Date(row.lease_until).getTime():undefined,leaseExpired:Boolean(row.lease_expired),upstreamTaskId:row.upstream_id,durationMs:row.finished_at?new Date(row.finished_at).getTime()-new Date(row.created_at).getTime():0,canCancel:['pending','running','paused'].includes(row.status),canReview:row.needs_review})),total:Number(aggregate.total),page:page.page,pageSize:page.pageSize,summary:{total:Number(aggregate.total),active:Number(aggregate.active),success:Number(aggregate.success),failed:Number(aggregate.failed),averageDurationMs:Number(aggregate.duration),totalPointsCost:Number(aggregate.cost),byType,byStatus},channels,agentPerformance:{sampleSize:Number(metrics.sample),planningP50Ms:Number(metrics.p50||0),planningP95Ms:Number(metrics.p95||0),firstResultP50Ms:Number(metrics.f50||0),firstResultP95Ms:Number(metrics.f95||0),queueAverageMs:Number(metrics.queue||0),upstreamAverageMs:Number(metrics.upstream||0),reviewAverageMs:Number(metrics.review||0)}};
  });
  app.get('/api/admin/generation-overview',async request=>{
    await ctx.requireUser(request,'analytics.read');
    const days=Math.min(365,Math.max(1,Math.trunc(Number((request.query as any).windowDays)||7)));
    // The consumer defines today and its trend dates in Asia/Shanghai.
    const bounds=(await ctx.db.query("SELECT (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')-($1::integer-1)*interval '1 day') AT TIME ZONE 'Asia/Shanghai' start_at,(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 day') AT TIME ZONE 'Asia/Shanghai' end_at",[days])).rows[0];
    const range=[bounds.start_at,bounds.end_at];
    const where='created_at >= $1::timestamptz AND created_at < $2::timestamptz';
    const aggregate=(await ctx.db.query(`SELECT count(*) total,count(*) FILTER(WHERE status='success') success,count(*) FILTER(WHERE status='error') failed,count(DISTINCT user_id) users FROM oaooao_generation_jobs WHERE ${where}`,range)).rows[0];
    const daily=(await ctx.db.query(`WITH days AS (SELECT ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')+i*interval '1 day' AS report_day FROM generate_series(0,$3::integer-1) i),counts AS (SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') date,count(*) value FROM oaooao_generation_jobs WHERE ${where} GROUP BY 1) SELECT to_char(days.report_day,'YYYY-MM-DD') date,coalesce(counts.value,0) value FROM days LEFT JOIN counts ON counts.date=to_char(days.report_day,'YYYY-MM-DD') ORDER BY days.report_day`,[...range,days])).rows;
    const distribution=async(field:string)=>{const rows=await ctx.db.query(`SELECT ${field} label,count(*) value FROM oaooao_generation_jobs WHERE ${where} GROUP BY 1 ORDER BY 1`,range);return rows.rows.map(r=>({label:r.label,value:Number(r.value)}));};
    return{windowDays:days,totalCalls:Number(aggregate.total),successCalls:Number(aggregate.success),failedCalls:Number(aggregate.failed),activeUsers:Number(aggregate.users),successRate:Number(aggregate.total)?Number(aggregate.success)/Number(aggregate.total)*100:0,dailyCalls:daily.map(row=>({date:row.date,label:row.date,value:Number(row.value)})),modelDistribution:await distribution('model'),sourceDistribution:await distribution("coalesce(input->>'source','unknown')"),kindDistribution:await distribution('kind')};
  });
  app.post('/api/admin/generation-operations/:kind/:id/review',async request=>{
    const user=await ctx.requireUser(request,'generation.manage');const{id,kind}=request.params as any;const body=object(request.body);
    return transaction(ctx.db,async client=>{let row=kind==='agent'?(await client.query('SELECT j.* FROM oaooao_generation_jobs j WHERE (j.id=(SELECT job_id FROM oaooao_agent_runs WHERE id=$1) OR j.id IN (SELECT job_id FROM oaooao_agent_steps WHERE run_id=$1)) AND j.needs_review ORDER BY j.created_at DESC LIMIT 1 FOR UPDATE',[id])).rows[0]:(await client.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];if(!row)throw httpError(404,'Task not found');if(!row.needs_review||row.lease_owner)throw httpError(409,'Task is not awaiting manual review');
      if(body.action==='confirm_failed'){const reason=string(body.reason,'verification reason',2000);row=await finishJob(ctx,client,row,'error',null,reason);}
      else if(body.action==='resume_upstream'){if(row.kind!=='video')throw httpError(400,'Only video supports asynchronous upstream recovery');const upstream=string(body.upstreamTaskId,'upstreamTaskId',200);row=(await client.query("UPDATE oaooao_generation_jobs SET upstream_id=$2,phase='polling',needs_review=false,next_poll_at=now(),error=null,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[row.id,upstream])).rows[0];}
      else if(body.action==='provide_result'){
        const supplied=string(body.result,'result',64000);let result:Json;
        if(row.kind==='text')result={content:supplied};else{const parsed=new URL(supplied,ctx.config.origin);if(parsed.origin!==new URL(ctx.config.origin).origin)throw httpError(400,'Reviewed media result must be uploaded to the task owner first');const media=await ownedMedia(ctx,row.user_id,parsed.pathname.split('/').pop()!,client);if(!media.mimeType.startsWith(row.kind+'/'))throw httpError(400,'Reviewed media type mismatch');result={url:parsed.pathname};}
        row=await finishJob(ctx,client,row,'success',result,null);
      }else throw httpError(400,'Unknown review action');
      await ctx.audit({actorId:user.id,action:`generation.review.${body.action}`,targetType:kind,targetId:id,metadata:{reason:body.reason,upstreamTaskId:body.upstreamTaskId}},client);return{task:taskView(row)};
    });
  });
}
async function registerRenderAndVersions(app:FastifyInstance,ctx:Context){
  app.get('/api/drama/render-capability',async request=>{await ctx.requireUser(request);try{await encoderAvailable();return ok({available:true,features:{sourceAudio:true,voiceover:true,subtitles:true,mute:true}});}catch{return ok({available:false,reason:'Required FFmpeg encoder, subtitle filter or FFprobe is unavailable'});}});
  app.post('/api/drama/render',async(request,reply)=>{
    const user=await ctx.requireUser(request);const body=object(request.body);await encoderAvailable();
    if(!Array.isArray(body.shots)||!body.shots.length||body.shots.length>100)throw httpError(400,'Render requires 1 to 100 video shots');
    const mediaId=async(raw:unknown,kind:string)=>{let url:URL;try{url=new URL(String(raw||''),ctx.config.origin);}catch{throw httpError(400,'Invalid render source URL');}if(url.origin!==new URL(ctx.config.origin).origin||!/^\/api\/(?:media|reference-assets|generation-log-assets)\/[a-f0-9-]{36}$/i.test(url.pathname))throw httpError(400,'Render sources must be owned local assets');const id=url.pathname.split('/').pop()!;const media=await ownedMedia(ctx,user.id,id);if(!media.mimeType.startsWith(kind+'/'))throw httpError(400,`Render requires ${kind} assets`);return id;};
    const shots=[];for(const shot of body.shots){const audioMode=shot.audioMode||'source';if(!['source','voiceover','mute'].includes(audioMode))throw httpError(400,'Invalid audio mode');const duration=Number(shot.duration);if(!Number.isFinite(duration)||duration<0.1||duration>120)throw httpError(400,'Each shot duration must be 0.1 to 120 seconds');shots.push({mediaId:await mediaId(shot.videoUrl,'video'),audioMediaId:audioMode==='voiceover'?await mediaId(shot.audioUrl,'audio'):undefined,audioMode,subtitle:typeof shot.subtitle==='string'?shot.subtitle.slice(0,2000):'',duration});}
    if(shots.reduce((n,s)=>n+s.duration,0)>600)throw httpError(400,'Rendered duration must not exceed 10 minutes');
    const ratio=body.ratio||'9:16';if(!['9:16','16:9','1:1','4:3','3:4'].includes(ratio))throw httpError(400,'Unsupported render ratio');
    const input=generationInput('render',{shots,ratio,context:{projectId:body.projectId},source:'drama'});const row=await createJob(ctx,user.id,'render',input,String(request.headers['x-vozeb-pro-client-request-id']||`render:${inputHash(body)}`));reply.code(202);return ok(taskView(row));
  });
  app.get('/api/drama/render/:id',async request=>{const{row}=await ownedJob(ctx,request,(request.params as any).id);if(row.kind!=='render')throw httpError(404,'Render not found');return ok(taskView(row));});
  app.get('/api/drama/projects/:id/versions',async request=>{const user=await ctx.requireUser(request);const id=(request.params as any).id;const owner=await ctx.db.query("SELECT id FROM oaooao_projects WHERE id=$1 AND user_id=$2 AND kind='drama'",[id,user.id]);if(!owner.rowCount)throw httpError(404,'Project not found');const rows=await ctx.db.query('SELECT id,project_id,version,reason,created_at FROM oaooao_project_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 100',[id]);return ok({versions:rows.rows.map(r=>({id:r.id,projectId:r.project_id,version:r.version,reason:r.reason,createdAt:iso(r.created_at)}))});});
  app.post('/api/drama/projects/:id/versions',{bodyLimit:3*1024*1024},async request=>{const user=await ctx.requireUser(request);const id=(request.params as any).id;const body=object(request.body);return transaction(ctx.db,async client=>{const project=(await client.query("SELECT * FROM oaooao_projects WHERE id=$1 AND user_id=$2 AND kind='drama' FOR UPDATE",[id,user.id])).rows[0];if(!project)throw httpError(404,'Project not found');const snapshot=object(body.snapshot);if(snapshot.id!==id||snapshot.updatedAt!==iso(project.updated_at))throw httpError(409,'Version snapshot must match the current saved project');const document=normalizeProject('drama',snapshot);const next=Number((await client.query('SELECT coalesce(max(version),0)+1 number FROM oaooao_project_versions WHERE project_id=$1',[id])).rows[0].number);const reason=string(body.reason,'reason',1000);const row=(await client.query('INSERT INTO oaooao_project_versions(id,project_id,version,reason,document) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),id,next,reason,{...document,title:project.title}])).rows[0];return ok({version:{id:row.id,projectId:id,version:next,reason,createdAt:iso(row.created_at)}});});});
  app.post('/api/drama/projects/:id/versions/:versionId',async request=>{const user=await ctx.requireUser(request);const{id,versionId}=request.params as any;return transaction(ctx.db,async client=>{const row=(await client.query("SELECT * FROM oaooao_projects WHERE id=$1 AND user_id=$2 AND kind='drama' FOR UPDATE",[id,user.id])).rows[0];if(!row)throw httpError(404,'Project not found');const version=(await client.query('SELECT document FROM oaooao_project_versions WHERE id=$1 AND project_id=$2',[versionId,id])).rows[0];if(!version)throw httpError(404,'Version not found');const updated=(await client.query("UPDATE oaooao_projects SET document=$2,title=$3,updated_at=greatest(updated_at+interval '1 millisecond',date_trunc('milliseconds',clock_timestamp())) WHERE id=$1 RETURNING *",[id,version.document,version.document.title||row.title])).rows[0];return ok({project:projectView(updated)});});});
  app.post('/api/drama/projects/:id/export-jianying',async request=>{const user=await ctx.requireUser(request);const found=await ctx.db.query("SELECT id FROM oaooao_projects WHERE id=$1 AND user_id=$2 AND kind='drama'",[(request.params as any).id,user.id]);if(!found.rowCount)throw httpError(404,'Project not found');throw httpError(503,'Jianying export format is not configured in this independent backend');});
}
export async function registerCreative(app:FastifyInstance,ctx:Context){
  await registerMedia(app,ctx);await registerProjects(app,ctx);await registerLibrary(app,ctx);await registerAgents(app,ctx);await registerAdmin(app,ctx);await registerRenderAndVersions(app,ctx);
  for(const kind of ['text','image','video','audio'] as GenerationKind[]){
    const prefix=kind==='video'?'video-tasks':`${kind}-tasks`;
    const create=async(request:FastifyRequest,reply:FastifyReply)=>{const user=await ctx.requireUser(request);const input=generationInput(kind,request.body);const requestId=String(request.headers['x-vozeb-pro-client-request-id']||input.context.clientRequestId||randomUUID());const attempt=Number(request.headers['x-vozeb-pro-attempt-no']||input.context.attemptNo||1);const row=await createJob(ctx,user.id,kind,input,requestId,attempt);await points(ctx,user.id,reply);reply.code(202);return{task:taskView(row)};};
    app.post(`/api/${prefix}`,{bodyLimit:34*1024*1024},create);if(kind==='video')app.post('/api/video-generation-tasks',{bodyLimit:34*1024*1024},create);
    app.get(`/api/${prefix}/:id`,async(request,reply)=>{const{row}=await ownedJob(ctx,request,(request.params as any).id);if(row.kind!==kind)throw httpError(404,'Task not found');await points(ctx,row.user_id,reply);return{task:taskView(row)};});
    app.patch(`/api/${prefix}/:id`,async(request,reply)=>{if(object(request.body).status!=='cancelled')throw httpError(400,'Only cancellation is supported');const{user,row}=await ownedJob(ctx,request,(request.params as any).id,true);if(row.kind!==kind)throw httpError(404,'Task not found');const task=await transaction(ctx.db,async client=>{const result=await cancelJob(ctx,client,row.id,row.user_id);if(user.id!==row.user_id)await ctx.audit({actorId:user.id,action:'generation.cancel',targetType:kind,targetId:row.id},client);return result;});await points(ctx,row.user_id,reply);return{task:taskView(task)};});
    app.post(`/api/${prefix}/:id`,async request=>{if(object(request.body).action!=='recover')throw httpError(400,'Unknown task action');const{row}=await ownedJob(ctx,request,(request.params as any).id,true);if(row.kind!==kind)throw httpError(404,'Task not found');if(row.status==='running'&&row.upstream_id)await ctx.db.query("UPDATE oaooao_generation_jobs SET phase='polling',needs_review=false,next_poll_at=now() WHERE id=$1 AND status='running' AND lease_owner IS NULL",[row.id]);const updated=(await ctx.db.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1',[row.id])).rows[0];return{task:taskView(updated)};});
  }
  app.get('/api/generation-logs',async request=>{
    const user=await ctx.requireUser(request);const q=request.query as Json;const page=pagination(q);const values=[user.id,q.kind||'',q.status||''];
    const selection=`SELECT id,created_at,to_jsonb(j) job,null::jsonb document FROM oaooao_generation_jobs j WHERE user_id=$1 AND ($2='' OR kind=$2) AND ($3='' OR status=$3)
      UNION ALL SELECT id,created_at,null::jsonb job,document FROM oaooao_generation_history WHERE user_id=$1 AND ($2='' OR document->>'kind'=$2) AND ($3='' OR document->>'status'=$3)`;
    const rows=await ctx.db.query(`SELECT * FROM (${selection}) combined ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`,[...values,page.pageSize,page.offset]);
    const total=Number((await ctx.db.query(`SELECT count(*) total FROM (${selection}) combined`,values)).rows[0].total);
    return{items:rows.rows.map(entry=>{if(entry.document)return{...entry.document,id:entry.id,createdAt:iso(entry.created_at)};const row=entry.job;return{...taskView(row),source:row.input.source,title:row.input.title||row.input.prompt.slice(0,80),summary:row.result?.content,assets:row.result?.results?.map((r:Json)=>({type:row.kind,...r}))||(row.result?.url?[{type:row.kind,url:row.result.url}]:[]),durationMs:row.finished_at?new Date(row.finished_at).getTime()-new Date(row.created_at).getTime():0,createdAt:iso(row.created_at)};}),total,page:page.page,pageSize:page.pageSize};
  });
  if(ctx.config.workerEnabled){let stop:(()=>Promise<void>)|undefined;app.addHook('onReady',async()=>{stop=startWorker(ctx);});app.addHook('onClose',async()=>{await stop?.();});}
}

