import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {type Context,httpError,iso,object,pagination,string,transaction} from './core.js';

const writable=new Set(['title','content','imageUrl','actionUrl','buttonText','enabled','pages','frequency','startsAt','endsAt']);
const controls=/[\\\u0000-\u001f\u007f-\u009f]/u;
const defaults={title:'',content:'',imageUrl:null,actionUrl:null,buttonText:'查看详情',enabled:false,pages:['home','studio'],frequency:'session',startsAt:null,endsAt:null};

function optionalUrl(value:unknown):string|null {
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||controls.test(value))throw httpError(400,'Invalid popup URL');
  const target=value.trim();
  if(!target)return null;
  if(target.length>2048)throw httpError(400,'Popup URL is too long');
  if(target.startsWith('/')&&!target.startsWith('//'))return target;
  if(!/^https?:\/\//i.test(target))throw httpError(400,'Invalid popup URL');
  let url:URL;
  try{url=new URL(target);}catch{throw httpError(400,'Invalid popup URL');}
  const authority=target.slice(target.indexOf('://')+3).split(/[/?#]/,1)[0];
  if(!authority||!url.hostname||url.username||url.password||authority.includes('@')||url.href.length>2048)throw httpError(400,'Invalid popup URL');
  return target;
}

function imageUrl(value:unknown):string|null {
  const target=optionalUrl(value);
  if(!target)return null;
  const local=target.startsWith('/'),url=new URL(target,'https://popup.invalid');
  let path:string;
  try{path=decodeURIComponent(url.pathname);}catch{throw httpError(400,'Invalid popup image URL');}
  if(controls.test(path)||/\.svgz?(?:$|\/)/i.test(path))throw httpError(400,'SVG popup images are not supported');
  if(local){
    if(!target.startsWith('/media/')||!url.pathname.startsWith('/media/')||!path.startsWith('/media/')||path.split('/').some(part=>part==='.'||part==='..'))throw httpError(400,'Popup image must use a public /media/ path');
  }else if(url.protocol!=='https:')throw httpError(400,'Popup image must use HTTPS');
  return target;
}

function date(value:unknown):string|null {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw httpError(400,'Invalid popup date; include its time zone');
  const [year,month,day]=value.slice(0,10).split('-').map(Number);
  if(year<1||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())throw httpError(400,'Invalid popup date');
  return new Date(value).toISOString();
}

function view(row:Record<string,any>){
  return {id:row.id,title:row.title,content:row.content,imageUrl:row.image_url??undefined,actionUrl:row.action_url??undefined,buttonText:row.button_text,enabled:row.enabled,pages:row.pages,frequency:row.frequency,startsAt:iso(row.starts_at),endsAt:iso(row.ends_at),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
}

function validate(input:Record<string,any>){
  const title=string(input.title,'popup title',120),content=string(input.content,'popup content',10000,true);
  const image=imageUrl(input.imageUrl),action=optionalUrl(input.actionUrl),buttonText=string(input.buttonText,'popup button text',24);
  if(!content&&!image)throw httpError(400,'Popup requires content or an image');
  if(typeof input.enabled!=='boolean')throw httpError(400,'Invalid popup enabled flag');
  if(!Array.isArray(input.pages)||input.pages.length<1||input.pages.length>2||input.pages.some((page:unknown)=>page!=='home'&&page!=='studio')||new Set(input.pages).size!==input.pages.length)throw httpError(400,'Popup pages must contain home and/or studio without duplicates');
  if(input.frequency!=='session'&&input.frequency!=='daily')throw httpError(400,'Invalid popup frequency');
  const startsAt=date(input.startsAt),endsAt=date(input.endsAt);
  if(startsAt&&endsAt&&Date.parse(startsAt)>=Date.parse(endsAt))throw httpError(400,'Popup end must follow its start');
  return {title,content,imageUrl:image,actionUrl:action,buttonText,enabled:input.enabled,pages:input.pages as string[],frequency:input.frequency,startsAt,endsAt};
}

export async function registerSitePopups(app:FastifyInstance,ctx:Context){
  async function list(request:FastifyRequest,admin:boolean){
    if(admin)await ctx.requireUser(request,'content.manage');
    const {page,pageSize,offset}=pagination(request.query);
    const where=admin?'':'WHERE enabled=true AND (starts_at IS NULL OR starts_at<=statement_timestamp()) AND (ends_at IS NULL OR ends_at>statement_timestamp())';
    const result=await ctx.db.query(`WITH matching AS MATERIALIZED (SELECT * FROM oaooao_site_popups ${where}), listed AS (SELECT * FROM matching ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT $1 OFFSET $2)
      SELECT (SELECT count(*)::int FROM matching) AS total,coalesce((SELECT json_agg(listed ORDER BY updated_at DESC,created_at DESC,id DESC) FROM listed),'[]'::json) AS items`,[pageSize,offset]);
    return {popups:result.rows[0].items.map(view),total:result.rows[0].total,page,pageSize};
  }
  async function save(request:FastifyRequest,isNew:boolean){
    const user=await ctx.requireUser(request,'content.manage'),body=object(request.body);
    for(const key of Object.keys(body))if(!writable.has(key))throw httpError(400,'Unknown popup field');
    const id=isNew?randomUUID():string((request.params as Record<string,unknown>).id,'popup ID',200);
    return transaction(ctx.db,async client=>{
      const current=isNew?null:(await client.query('SELECT * FROM oaooao_site_popups WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!isNew&&!current)throw httpError(404,'Popup not found');
      const next=validate({...defaults,...(current?view(current):{}),...body});
      const values=[id,next.title,next.content,next.imageUrl,next.actionUrl,next.buttonText,next.enabled,next.pages,next.frequency,next.startsAt,next.endsAt];
      const result=isNew
        ?await client.query(`INSERT INTO oaooao_site_popups(id,title,content,image_url,action_url,button_text,enabled,pages,frequency,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,values)
        :await client.query(`UPDATE oaooao_site_popups SET title=$2,content=$3,image_url=$4,action_url=$5,button_text=$6,enabled=$7,pages=$8,frequency=$9,starts_at=$10,ends_at=$11,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,values);
      await ctx.audit({actorId:user.id,action:isNew?'site_popup.create':'site_popup.update',targetType:'site_popup',targetId:id,metadata:{fields:Object.keys(body)}},client);
      return {popup:view(result.rows[0])};
    });
  }
  app.get('/api/site-popups',request=>list(request,false));
  app.get('/api/admin/site-popups',request=>list(request,true));
  app.post('/api/admin/site-popups',request=>save(request,true));
  app.patch('/api/admin/site-popups/:id',request=>save(request,false));
  app.delete('/api/admin/site-popups/:id',async request=>{
    const user=await ctx.requireUser(request,'content.manage'),id=string((request.params as Record<string,unknown>).id,'popup ID',200);
    await transaction(ctx.db,async client=>{
      const result=await client.query('DELETE FROM oaooao_site_popups WHERE id=$1',[id]);
      if(!result.rowCount)throw httpError(404,'Popup not found');
      await ctx.audit({actorId:user.id,action:'site_popup.delete',targetType:'site_popup',targetId:id},client);
    });
    return {ok:true};
  });
}
