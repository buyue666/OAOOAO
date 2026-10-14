import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import pg, { type Pool } from 'pg';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { type AppConfig, type Context, createContext, httpError } from './core.js';
import { registerAuth } from './auth.js';
import { registerSettings } from './settings.js';
import { registerSitePopups } from './site-popups.js';
import { registerWatermark } from './watermark.js';
import { registerCheckIn } from './check-in.js';
import { registerCommerce } from './commerce.js';
import { registerContent } from './content.js';
import { readMigrations } from './migrate.js';

export function loadConfig(env:NodeJS.ProcessEnv=process.env):AppConfig {
  const origin=env.PUBLIC_ORIGIN||'http://localhost:3000';const production=env.NODE_ENV==='production';
  const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||url.pathname!=='/'||url.username||url.password)throw new Error('PUBLIC_ORIGIN must contain only an HTTP(S) origin');
  if(production&&url.protocol!=='https:')throw new Error('PUBLIC_ORIGIN must use HTTPS in production');
  if(!env.DATABASE_URL)throw new Error('DATABASE_URL is required');
  if(!env.ENCRYPTION_KEY)throw new Error('ENCRYPTION_KEY is required');
  const port=Number(env.PORT||3001);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const trustedProxies=(env.TRUSTED_PROXY_CIDRS||'').split(',').map(value=>value.trim()).filter(Boolean);
  for(const proxy of trustedProxies){
    const [address,prefix,...extra]=proxy.split('/'),family=isIP(address);
    if(!family||extra.length||(prefix!==undefined&&(!/^\d+$/.test(prefix)||Number(prefix)<1||Number(prefix)>(family===4?32:128))))throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IP addresses or bounded CIDR ranges');
  }
  return {databaseUrl:env.DATABASE_URL,origin:url.origin,allowedOrigins:[url.origin,...(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean).map(value=>new URL(value.trim()).origin)],production,
    sessionCookieName:production?'__Host-oaooao_session':'oaooao_session',sessionTtlSeconds:7*86400,encryptionKey:env.ENCRYPTION_KEY,
    mediaRoot:resolve(env.MEDIA_ROOT||'media'),host:env.HOST||'127.0.0.1',port,workerEnabled:env.WORKER_ENABLED!=='false',trustedProxies};
}
export function assertCsrfOrigin(ctx:Context,method:string,origin:string|undefined,fetchSite:string|undefined,hasSession:boolean,url:string) {
  if(['GET','HEAD','OPTIONS'].includes(method))return;
  if(!hasSession&&!url.startsWith('/api/auth/'))return;
  if(origin){if(!ctx.config.allowedOrigins.includes(origin))throw httpError(403,'Request origin is not allowed');}
  else if(fetchSite!=='same-origin')throw httpError(403,'An allowed Origin header is required');
  if(fetchSite==='cross-site')throw httpError(403,'Cross-site requests are not allowed');
}
export interface BuildOptions { db?:Pool; config?:AppConfig; logger?:boolean; coreOnly?:boolean; }
export async function buildApp(options:BuildOptions={}):Promise<FastifyInstance & {ctx:Context}> {
  const config=options.config||loadConfig();const ownedPool=!options.db;const db=options.db||new pg.Pool({connectionString:config.databaseUrl,max:20});
  const ctx=createContext(db,config),app=Fastify({bodyLimit:8*1024*1024,logger:options.logger?{
    redact:['req.headers.authorization','req.headers.cookie','res.headers["set-cookie"]','password','apiKey','secret','token'],
    serializers:{req(request){return {method:request.method,url:String(request.url||'').split('?')[0],hostname:request.hostname,remoteAddress:request.ip};}},
  }:false,trustProxy:config.trustedProxies?.length?config.trustedProxies:false});
  app.decorate('ctx',ctx);
  await app.register(cookie);
  await app.register(multipart,{limits:{fileSize:50*1024*1024,files:4,fields:20,parts:24}});
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');reply.header('Referrer-Policy','same-origin');
    if(config.production)reply.header('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    assertCsrfOrigin(ctx,request.method,request.headers.origin,request.headers['sec-fetch-site'] as string|undefined,Boolean(request.cookies[config.sessionCookieName]),request.url);
  });
  app.setErrorHandler((error,request,reply)=>{
    const err=error as Error&{statusCode?:number;code?:string;outcome?:string;expose?:boolean};let status=err.statusCode&&err.statusCode>=400&&err.statusCode<=599?err.statusCode:500;
    if(err.code==='23505')status=409;
    const message=err.code==='23505'?'A record with this identifier already exists':status>=500&&!err.expose?'The requested service is unavailable':err.message;
    if(status>=500)request.log.error({errorType:err.name,errorCode:err.code},'Request failed');
    reply.code(status).send({code:status,msg:message,error:message,outcome:err.outcome||(status>=500||status===429?'unavailable':status===401||status===403?'expired':status===404?'not-found':status===409?'rejected':'failed')});
  });
  const expectedMigrations=await readMigrations();
  const live=async()=>({ok:true});
  const ready=async()=>{
    try{
      const applied=new Map((await db.query('SELECT name,checksum FROM oaooao_migrations')).rows.map(row=>[row.name,row.checksum]));
      if(expectedMigrations.some(item=>applied.get(item.name)!==item.checksum))throw new Error('Incomplete migration manifest');
      await db.query('SELECT id FROM oaooao_users LIMIT 0');await db.query('SELECT id FROM oaooao_settings LIMIT 0');
    }catch{throw httpError(503,'Database schema is not ready');}
    return {ok:true};
  };
  app.get('/health',live);app.get('/api/health/live',live);
  app.get('/ready',ready);app.get('/api/health/ready',ready);
  await registerAuth(app,ctx);await registerSettings(app,ctx);await registerSitePopups(app,ctx);await registerWatermark(app,ctx);await registerCheckIn(app,ctx);
  if(!options.coreOnly){await registerCommerce(app,ctx);await registerContent(app,ctx);const {registerCreative}=await import('./creative.js');await registerCreative(app,ctx);}
  if(ownedPool)app.addHook('onClose',async()=>{await db.end();});
  return app as unknown as FastifyInstance & {ctx:Context};
}
