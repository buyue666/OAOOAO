import type {FastifyInstance} from 'fastify';
import {type Context} from './core.js';
import {registerCreativeToolMedia} from './creative-tool-media.js';
import {getSettings} from './settings.js';
import {assertToolEnabled,type ToolId} from './creative-tool-settings.js';

/** Existing task polling, downloads and cancellation remain available when a tool closes. */
export function requestTools(route:string,method:string,raw:unknown):ToolId[] {
  if(!['POST','PATCH','PUT'].includes(method))return [];
  const body=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,any>:{};
  const tools=new Set<ToolId>();
  if(route==='/api/agent/runs'){
    tools.add('agent');if(body.surface==='canvas')tools.add('canvas');if(body.surface==='drama')tools.add('drama');
  }
  if(route==='/api/drama/projects'||/\/drama\/projects\/:id\/production(?:\/quote)?$/.test(route))tools.add('drama');
  if(route==='/api/canvas/projects'||route==='/api/teams/:teamId/projects/:projectId/canvas')tools.add('canvas');
  if(/^\/api\/(?:image-tasks|video-generation-tasks|video-tasks|audio-tasks|text-tasks|render-tasks)(?:\/quote)?$/.test(route)||/^\/api\/teams\/.*\/generations(?:\/quote)?$/.test(route)){
    const input=body.input&&typeof body.input==='object'?body.input:body, context=input.context||{};
    if(context.tool==='ai-tryon'||input.tool==='ai-tryon')tools.add('tryon');
    if(['image-remix','remix'].includes(context.tool)||['image-remix','remix'].includes(input.tool))tools.add('remix');
    if(input.source==='canvas'||input.surface==='canvas')tools.add('canvas');
    if(input.source==='drama'||input.surface==='drama')tools.add('drama');
    if(context.directorNodeId||context.directorProjectId||context.tool==='director')tools.add('director');
  }
  return [...tools];
}
export async function registerCreativeToolAccess(app:FastifyInstance,ctx:Context) {
  await registerCreativeToolMedia(app,ctx);
  app.get('/api/creative-tools',async(request,reply)=>{
    await ctx.requireUser(request);reply.header('Cache-Control','private, no-store');
    const settings=await getSettings(ctx);return {creativeTools:settings.creativeTools||{}};
  });
  app.addHook('preHandler',async request=>{
    const tools=requestTools(request.routeOptions.url||'',request.method,request.body);
    if(!tools.length)return;
    await ctx.requireUser(request);const settings=await getSettings(ctx);
    for(const id of tools)assertToolEnabled(settings,id);
  });
}
