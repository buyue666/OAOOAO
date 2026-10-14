import {randomBytes,randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {type Context,hashToken,httpError,object,rateLimit,transaction,userFromRow} from './core.js';
import {getSettings} from './settings.js';
import {getWallet,getPlanSummary} from './wallet.js';
import {wechatConfig,wechatConfigured,WECHAT_CALLBACK_PATH,type WechatConfig} from './wechat-config.js';
import {createWechatQrProvider,decryptWechatMessage,readWechatXml,verifyWechatSignature,type WechatQrProvider} from './wechat-protocol.js';

const TTL=300;
function fingerprint(c:WechatConfig){return hashToken([c.appId,c.appSecret,c.token,c.encodingAESKey].join('\0'));}
function browserCookie(ctx:Context){return ctx.config.production?'__Host-oaooao_wechat_browser':'oaooao_wechat_browser';}
function options(ctx:Context,maxAge:number){return {httpOnly:true,secure:ctx.config.production,sameSite:'lax' as const,path:'/',maxAge};}
function browserHash(ctx:Context,request:FastifyRequest){const value=request.cookies[browserCookie(ctx)];return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)?hashToken(value):'';}
function sessionId(request:FastifyRequest){const id=(request.params as any)?.id;if(typeof id!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(id))throw httpError(404,'微信二维码不存在或已过期');return id;}
export function wechatReturnTo(value:unknown){
  if(value===undefined)return '/studio';
  if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))throw httpError(400,'登录后的返回地址无效');
  let decoded:string;try{decoded=decodeURIComponent(value);}catch{throw httpError(400,'登录后的返回地址无效');}
  if(decoded.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(decoded))throw httpError(400,'登录后的返回地址无效');
  return value;
}
async function config(ctx:Context,client?:PoolClient,requireEnabled=true){
  const settings=await getSettings(ctx,client),c=wechatConfig(settings.wechatOfficial);
  if(!wechatConfigured(c)||(requireEnabled&&!c.enabled))throw httpError(503,'微信扫码登录尚未开启或配置不完整');
  return {settings,c};
}
async function account(ctx:Context,id:string){const row=(await ctx.db.query('SELECT * FROM oaooao_users WHERE id=$1 AND enabled=true',[id])).rows[0];if(!row)throw httpError(401,'账户已停用');return {...userFromRow(row),accountId:row.id,status:'active',...await getWallet(ctx,id),...await getPlanSummary(ctx,id)};}
function missing(){return httpError(404,'微信二维码不存在或已过期');}
async function boundSession(ctx:Context,request:FastifyRequest,client?:PoolClient){
  const hash=browserHash(ctx,request);if(!hash)throw missing();
  const row=(await (client||ctx.db).query('SELECT *,expires_at<=clock_timestamp() AS expired FROM oaooao_wechat_login_sessions WHERE id=$1 AND browser_hash=$2',[sessionId(request),hash])).rows[0];
  if(!row)throw missing();
  if(row.purpose==='binding'){
    const auth=request.cookies[ctx.config.sessionCookieName];if(!auth||hashToken(auth)!==row.owner_auth_hash)throw missing();
    const live=await (client||ctx.db).query('SELECT 1 FROM oaooao_sessions s JOIN oaooao_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND u.enabled=true AND u.password_hash=$3',[row.owner_auth_hash,row.user_id,row.owner_password_hash]);
    if(!live.rowCount)throw missing();
  }
  return row;
}

export async function registerWechatOfficial(app:FastifyInstance,ctx:Context,verifyPassword:(password:string,encoded:string)=>Promise<boolean>,provider:WechatQrProvider=createWechatQrProvider()){
  async function create(request:FastifyRequest,reply:FastifyReply,purpose:'login'|'binding'){
    const body=object(request.body??{});for(const key of Object.keys(body))if(!(purpose==='login'?['returnTo','policyAccepted']:['password']).includes(key))throw httpError(400,'包含不支持的微信授权字段');
    if(body.policyAccepted!==undefined&&typeof body.policyAccepted!=='boolean')throw httpError(400,'请确认服务条款和隐私政策选项');
    await rateLimit(ctx,`wechat-create:${request.ip}`,12,600);
    const {c}=await config(ctx);let owner:any=null;
    if(purpose==='binding'){
      const user=await ctx.requireUser(request);await rateLimit(ctx,`wechat-bind:${user.id}`,5,900);
      owner=(await ctx.db.query('SELECT id,password_hash FROM oaooao_users WHERE id=$1 AND enabled=true',[user.id])).rows[0];
      if(!owner||typeof body.password!=='string'||Buffer.byteLength(body.password)>4096||!await verifyPassword(body.password,owner.password_hash))throw httpError(400,'当前密码不正确');
      if((await ctx.db.query('SELECT 1 FROM oaooao_wechat_identities WHERE app_id=$1 AND user_id=$2',[c.appId,user.id])).rowCount)throw httpError(409,'此账号已经绑定微信，不能直接替换');
    }
    const current=request.cookies[browserCookie(ctx)],browser=typeof current==='string'&&/^[A-Za-z0-9_-]{43}$/.test(current)?current:randomBytes(32).toString('base64url');
    await rateLimit(ctx,`wechat-browser:${hashToken(browser)}`,6,600);
    const returnTo=purpose==='binding'?'/settings':wechatReturnTo(body.returnTo);
    const id=randomBytes(24).toString('base64url'),scene=randomBytes(24).toString('base64url');
    const qr=await provider({appId:c.appId,appSecret:ctx.decrypt(c.appSecret)},scene,TTL);
    const expires=await transaction(ctx.db,async client=>{
      await client.query('SELECT id FROM oaooao_settings WHERE id=$1 FOR SHARE',['global']);const fresh=await config(ctx,client);
      if(fingerprint(c)!==fingerprint(fresh.c))throw httpError(409,'微信配置已更新，请重新获取二维码');
      const result=await client.query(`INSERT INTO oaooao_wechat_login_sessions(id,app_id,provider_fingerprint,scene_key,browser_hash,purpose,user_id,owner_auth_hash,owner_password_hash,policy_accepted,return_to,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()+make_interval(secs=>$12)) RETURNING expires_at`,
        [id,c.appId,fingerprint(c),scene,hashToken(browser),purpose,owner?.id||null,owner?hashToken(request.cookies[ctx.config.sessionCookieName]!):null,owner?.password_hash||null,body.policyAccepted===true,returnTo,Math.min(TTL,qr.expiresIn)]);
      await client.query('DELETE FROM oaooao_wechat_login_sessions WHERE id IN (SELECT id FROM oaooao_wechat_login_sessions WHERE expires_at<clock_timestamp()-interval \'1 day\' ORDER BY expires_at LIMIT 100)');
      return result.rows[0].expires_at.toISOString();
    });
    reply.setCookie(browserCookie(ctx),browser,options(ctx,3600));
    return {sessionId:id,qrCodeUrl:'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket='+encodeURIComponent(qr.ticket),expiresAt:expires};
  }
  app.post('/api/auth/wechat-official/sessions',(request,reply)=>create(request,reply,'login'));
  app.post('/api/account/wechat-official/bind-sessions',(request,reply)=>create(request,reply,'binding'));
  app.get('/api/account/wechat-official',async request=>{
    const user=await ctx.requireUser(request),settings=await getSettings(ctx),c=wechatConfig(settings.wechatOfficial);
    const bound=Boolean((await ctx.db.query('SELECT 1 FROM oaooao_wechat_identities WHERE app_id=$1 AND user_id=$2',[c.appId,user.id])).rowCount);
    const available=c.enabled&&wechatConfigured(c);return {bound,available,appId:c.appId,canBind:available&&!bound};
  });
  app.get('/api/auth/wechat-official/sessions/:id',async request=>{
    await rateLimit(ctx,`wechat-status:${request.ip}`,180,60);const row=await boundSession(ctx,request),settings=await getSettings(ctx),c=wechatConfig(settings.wechatOfficial);
    const status=row.expired||!c.enabled||fingerprint(c)!==row.provider_fingerprint?'expired':row.status;
    return {status,nickname:null,avatarUrl:null,returnTo:status==='authorized'||status==='consumed'?row.return_to:null};
  });
  app.post('/api/auth/wechat-official/sessions/:id/consume',async(request,reply)=>{
    await rateLimit(ctx,`wechat-consume:${request.ip}`,30,600);const initial=await boundSession(ctx,request);
    if(!initial.open_id||initial.expired)throw httpError(409,'微信授权尚未完成或二维码已过期');
    const result=await transaction(ctx.db,async client=>{
      // Lock order: configuration -> provider identity -> QR session -> account.
      await client.query('SELECT id FROM oaooao_settings WHERE id=$1 FOR SHARE',['global']);const {c,settings}=await config(ctx,client);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`wechat:${c.appId}:${initial.open_id}`]);
      await client.query('SELECT id FROM oaooao_wechat_login_sessions WHERE id=$1 FOR UPDATE',[initial.id]);
      const row=await boundSession(ctx,request,client);
      if(row.expired||row.provider_fingerprint!==fingerprint(c)||row.open_id!==initial.open_id||!['authorized','consumed'].includes(row.status))throw httpError(409,'微信授权已失效，请重新扫码');
      const identity=(await client.query('SELECT user_id FROM oaooao_wechat_identities WHERE app_id=$1 AND open_id=$2',[c.appId,row.open_id])).rows[0];
      let userId=identity?.user_id;
      if(row.purpose==='binding'){
        const user=(await client.query('SELECT id,password_hash,enabled FROM oaooao_users WHERE id=$1 FOR UPDATE',[row.user_id])).rows[0];
        if(!user?.enabled||user.password_hash!==row.owner_password_hash)throw httpError(401,'账户状态已变化，请重新登录');
        if(identity&&identity.user_id!==user.id)throw httpError(409,'此微信已绑定其他账号，不能合并账户');
        const another=(await client.query('SELECT open_id FROM oaooao_wechat_identities WHERE app_id=$1 AND user_id=$2',[c.appId,user.id])).rows[0];
        if(another&&another.open_id!==row.open_id)throw httpError(409,'此账号已绑定其他微信，不能直接替换');
        if(row.status!=='consumed'){
          await client.query('INSERT INTO oaooao_wechat_identities(app_id,open_id,user_id) VALUES($1,$2,$3) ON CONFLICT(app_id,open_id) DO NOTHING',[c.appId,row.open_id,user.id]);
          await client.query("UPDATE oaooao_wechat_login_sessions SET status='consumed',consumed_at=clock_timestamp() WHERE id=$1",[row.id]);
          await ctx.audit({actorId:user.id,action:'auth.wechat.bind',targetType:'user',targetId:user.id},client);
        }
        return {userId:user.id,returnTo:row.return_to,bound:true,token:null};
      }
      if(!userId){
        if(row.status==='consumed'||!c.autoRegister||!settings.registrationEnabled||settings.emailRegistrationEnabled||!row.policy_accepted)throw httpError(409,'此微信尚未绑定账户，请先完成账号注册并登录后绑定');
        userId=randomUUID();const passwordHash=await bcrypt.hash(randomBytes(48).toString('base64'),12);
        await client.query("INSERT INTO oaooao_users(id,username,display_name,password_hash,policy_accepted_at) VALUES($1,$2,'微信用户',$3,clock_timestamp())",[userId,'wx_'+randomBytes(16).toString('hex'),passwordHash]);
        await client.query('INSERT INTO oaooao_wechat_identities(app_id,open_id,user_id) VALUES($1,$2,$3)',[c.appId,row.open_id,userId]);
        await ctx.audit({actorId:userId,action:'auth.wechat.register',targetType:'user',targetId:userId,metadata:{policyAccepted:true}},client);
      }
      const user=(await client.query('SELECT enabled FROM oaooao_users WHERE id=$1 FOR UPDATE',[userId])).rows[0];if(!user?.enabled)throw httpError(401,'账户已停用');
      if(row.status==='consumed'){
        if(row.user_id!==userId||!row.login_token_ciphertext)throw httpError(409,'微信授权已失效');
        const token=ctx.decrypt(row.login_token_ciphertext);
        const existing=await client.query('SELECT 1 FROM oaooao_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp()',[hashToken(token),userId]);
        if(!existing.rowCount)throw httpError(409,'登录已退出或失效，请重新扫码');
        return {userId,returnTo:row.return_to,bound:false,token};
      }
      const token=randomBytes(32).toString('base64url');
      await client.query('INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+make_interval(secs=>$3))',[hashToken(token),userId,ctx.config.sessionTtlSeconds]);
      await client.query('UPDATE oaooao_users SET last_login_at=clock_timestamp() WHERE id=$1',[userId]);
      await client.query("UPDATE oaooao_wechat_login_sessions SET status='consumed',user_id=$2,consumed_at=clock_timestamp(),login_token_ciphertext=$3,login_token_hash=$4 WHERE id=$1",[row.id,userId,ctx.encrypt(token),hashToken(token)]);
      await ctx.audit({actorId:userId,action:'auth.wechat.login',targetType:'user',targetId:userId},client);
      return {userId,returnTo:row.return_to,bound:false,token};
    });
    if(result.token)reply.setCookie(ctx.config.sessionCookieName,result.token,options(ctx,ctx.config.sessionTtlSeconds));
    return {user:await account(ctx,result.userId),returnTo:result.returnTo,...(result.bound?{bound:true}:{})};
  });
  await app.register(async scope=>{
    scope.addContentTypeParser(['application/xml','text/xml'],{parseAs:'string',bodyLimit:65536},(_request,body,done)=>done(null,body));
    scope.get(WECHAT_CALLBACK_PATH,async(request,reply)=>{
      const {c}=await config(ctx,undefined,false),q=request.query as Record<string,unknown>;const echo=q.echostr;
      if(typeof echo!=='string'||!echo||echo.length>90000)throw httpError(400,'Invalid WeChat challenge');
      const token=ctx.decrypt(c.token);let answer=echo;
      if(q.msg_signature!==undefined){verifyWechatSignature(token,q,echo);answer=decryptWechatMessage(echo,ctx.decrypt(c.encodingAESKey),c.appId);}
      else verifyWechatSignature(token,q);
      return reply.type('text/plain').send(answer);
    });
    scope.post(WECHAT_CALLBACK_PATH,{bodyLimit:65536},async(request,reply)=>{
      const {c}=await config(ctx,undefined,false),q=request.query as Record<string,unknown>;
      if(q.encrypt_type!=='aes')throw httpError(403,'WeChat safe mode is required');
      const outer=readWechatXml(request.body),encrypted=outer.Encrypt;if(!encrypted)throw httpError(400,'Encrypted WeChat message required');
      verifyWechatSignature(ctx.decrypt(c.token),q,encrypted);
      const message=readWechatXml(decryptWechatMessage(encrypted,ctx.decrypt(c.encodingAESKey),c.appId));
      if(message.MsgType==='event'&&c.enabled){
        const openId=message.FromUserName;if(!/^[A-Za-z0-9_-]{1,128}$/.test(openId||''))throw httpError(400,'Invalid WeChat sender');
        if(!/^\d{10}$/.test(message.CreateTime||'')||Math.abs(Number(message.CreateTime)*1000-Date.now())>600000)throw httpError(400,'Expired WeChat event');
        if(['SCAN','subscribe','unsubscribe'].includes(message.Event))await transaction(ctx.db,async client=>{
          await client.query('SELECT id FROM oaooao_settings WHERE id=$1 FOR SHARE',['global']);const fresh=await config(ctx,client,false);
          if(!fresh.c.enabled||fingerprint(fresh.c)!==fingerprint(c))return;
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`wechat:${c.appId}:${openId}`]);
          if(message.Event==='unsubscribe'){
            await client.query('DELETE FROM oaooao_sessions WHERE token_hash IN (SELECT login_token_hash FROM oaooao_wechat_login_sessions WHERE app_id=$1 AND open_id=$2)',[c.appId,openId]);
            // Unfollowing cancels short-lived login authorizations, not account ownership.
            // Retaining the identity prevents a later subscription from creating a
            // different account with none of the original user's purchased credits.
            await client.query('DELETE FROM oaooao_wechat_login_sessions WHERE app_id=$1 AND open_id=$2',[c.appId,openId]);return;
          }
          const scene=message.Event==='subscribe'?(message.EventKey?.startsWith('qrscene_')?message.EventKey.slice(8):''):message.EventKey;
          if(!/^[A-Za-z0-9_-]{32}$/.test(scene||''))return;
          const row=(await client.query("SELECT * FROM oaooao_wechat_login_sessions WHERE scene_key=$1 AND app_id=$2 AND provider_fingerprint=$3 AND status='pending' AND expires_at>clock_timestamp() FOR UPDATE",[scene,c.appId,fingerprint(c)])).rows[0];if(!row)return;
          const identity=(await client.query('SELECT i.user_id,u.enabled FROM oaooao_wechat_identities i JOIN oaooao_users u ON u.id=i.user_id WHERE i.app_id=$1 AND i.open_id=$2',[c.appId,openId])).rows[0];
          const allowed=row.purpose==='binding'||identity?.enabled===true||(!identity&&fresh.c.autoRegister&&fresh.settings.registrationEnabled&&!fresh.settings.emailRegistrationEnabled&&row.policy_accepted);
          await client.query('UPDATE oaooao_wechat_login_sessions SET open_id=$2,status=$3 WHERE id=$1',[row.id,openId,allowed?'authorized':'unlinked']);
        });
      }
      return reply.type('text/plain').send('success');
    });
  });
}
