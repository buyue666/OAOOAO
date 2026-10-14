import { pbkdf2, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { type AppUser, type Context, ADMIN_PERMISSIONS, codeHash, hashToken, hasPermission, httpError, object, pagination, rateLimit, string, transaction, userFromRow } from './core.js';
import { getSettings, publicSettings, sendMail } from './settings.js';
import { getWallet, setPermanentBalance, assignAdminPlan, getPlanSummary } from './wallet.js';
import { recordReferral } from './commerce.js';
import { registerWechatOfficial } from './wechat.js';
import type {WechatQrProvider} from './wechat-protocol.js';

export function normalizeEmail(value:unknown, optional=false): string | null {
  if(optional&&(value===undefined||value===''))return null;
  const email=string(value,'email',320).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw httpError(400,'Invalid email address');return email;
}
export function validatePassword(value:unknown):string {
  if(typeof value!=='string'||value.length<12||Buffer.byteLength(value,'utf8')>72)throw httpError(400,'Password must contain at least 12 characters and at most 72 UTF-8 bytes');return value;
}
const derivePbkdf2=promisify(pbkdf2);
/** Legacy serialization supplied as an interoperability fact by the migration coordinator. */
export async function verifyPassword(password:string,encoded:string):Promise<boolean>{
  if(Buffer.byteLength(password,'utf8')>4096)return false;
  if(/^\$2[aby]\$\d\d\$/.test(encoded))return Buffer.byteLength(password,'utf8')<=72&&bcrypt.compare(password,encoded);
  const fields=encoded.split('$');
  if(fields.length!==4||fields[0]!=='pbkdf2_sha256'||!/^\d{1,7}$/.test(fields[1])||fields[2].length!==22||!/^[A-Za-z0-9_-]{43}$/.test(fields[3]))return false;
  const iterations=Number(fields[1]);if(iterations<10000||iterations>2000000)return false;
  const expected=Buffer.from(fields[3],'base64url');if(expected.length!==32)return false;
  const actual=await derivePbkdf2(password,fields[2],iterations,32,'sha256');
  return timingSafeEqual(actual,expected);
}
export function validateUsername(value:unknown):string {const name=string(value,'username',64);if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(name))throw httpError(400,'Username must contain 3–64 letters, digits, dots, hyphens or underscores');return name;}
function permissions(value:unknown):string[]{if(!Array.isArray(value)||value.some(p=>!ADMIN_PERMISSIONS.includes(p)))throw httpError(400,'Invalid administrator permissions');return [...new Set(value)] as string[];}
function cookieOptions(ctx:Context){return {httpOnly:true,secure:ctx.config.production,sameSite:'lax' as const,path:'/',maxAge:ctx.config.sessionTtlSeconds};}
async function createSession(ctx:Context,userId:string,reply:FastifyReply,expectedPasswordHash:string){
  const token=randomBytes(32).toString('base64url');
  await transaction(ctx.db,async client=>{
    const {rows}=await client.query('SELECT enabled,password_hash FROM oaooao_users WHERE id=$1 FOR UPDATE',[userId]);
    if(!rows[0]?.enabled||rows[0].password_hash!==expectedPasswordHash)throw httpError(401,'Account access changed; sign in again');
    await client.query('INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+make_interval(secs=>$3))',[hashToken(token),userId,ctx.config.sessionTtlSeconds]);
    await client.query('UPDATE oaooao_users SET last_login_at=now() WHERE id=$1',[userId]);
  });reply.setCookie(ctx.config.sessionCookieName,token,cookieOptions(ctx));
}
async function viewUser(ctx:Context,user:AppUser){return {...user,accountId:user.id,status:user.enabled?'active':'disabled',...await getWallet(ctx,user.id),...await getPlanSummary(ctx,user.id)};}
async function consumeCode(ctx:Context,client:PoolClient,email:string,purpose:string,code:unknown,userId?:string){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))throw httpError(400,'Invalid verification code');
  const result=await client.query(`UPDATE oaooao_email_codes SET consumed_at=now() WHERE id=(SELECT id FROM oaooao_email_codes WHERE email=$1 AND purpose=$2 AND user_id IS NOT DISTINCT FROM $3 AND consumed_at IS NULL AND sent_at IS NOT NULL ORDER BY created_at DESC LIMIT 1) AND code_hash=$4 AND expires_at>now() AND attempts<10 AND consumed_at IS NULL RETURNING id`,[email,purpose,userId||null,codeHash(ctx,`${email}:${purpose}:${code}`)]);
  if(!result.rowCount)throw httpError(400,'Verification code is invalid or expired');
}
async function codeAttempt(ctx:Context,email:string,purpose:string,ip:string){await rateLimit(ctx,`code:${email}:${purpose}`,10,600);await rateLimit(ctx,`code-ip:${ip}`,60,600);}

export async function registerAuth(app:FastifyInstance,ctx:Context,options:{wechatProvider?:WechatQrProvider}={}){
  const dummyHash=await bcrypt.hash(randomBytes(24).toString('base64'),12);
  app.get('/api/auth/session',async request=>{
    const settings=publicSettings(await getSettings(ctx));let user:AppUser|null=null;
    if(request.cookies[ctx.config.sessionCookieName]){try{user=await ctx.requireUser(request);}catch(error){if((error as any).statusCode!==401)throw error;}}
    return {user:user?await viewUser(ctx,user):null,settings,install:{ready:true}};
  });
  app.post('/api/auth/login',async(request,reply)=>{
    const body=object(request.body),username=string(body.username,'username or email',320);const password=typeof body.password==='string'?body.password:'';
    if(Buffer.byteLength(password)>4096)throw httpError(401,'Invalid username or password');
    await rateLimit(ctx,`login-ip:${request.ip}`,30,900);await rateLimit(ctx,`login-user:${username.toLowerCase()}`,10,900);
    const {rows}=await ctx.db.query('SELECT * FROM oaooao_users WHERE lower(username)=lower($1) OR lower(email)=lower($1) LIMIT 1',[username]);const row=rows[0];
    const valid=await verifyPassword(password,row?.password_hash||dummyHash);
    if(!row||!valid||!row.enabled){await ctx.audit({action:'auth.login',status:'failure',metadata:{identityHash:hashToken(username.toLowerCase())}});throw httpError(401,'Invalid username or password');}
    await createSession(ctx,row.id,reply,row.password_hash);
    await ctx.audit({actorId:row.id,action:'auth.login',targetType:'user',targetId:row.id});return {user:await viewUser(ctx,userFromRow(row))};
  });
  app.post('/api/auth/logout',async(request,reply)=>{const token=request.cookies[ctx.config.sessionCookieName];if(token)await ctx.db.query('DELETE FROM oaooao_sessions WHERE token_hash=$1',[hashToken(token)]);reply.clearCookie(ctx.config.sessionCookieName,{path:'/'});return {ok:true};});
  app.post('/api/auth/register',async(request,reply)=>{
    await rateLimit(ctx,`register-ip:${request.ip}`,5,3600);const settings=await getSettings(ctx);if(!settings.registrationEnabled)throw httpError(403,'Registration is disabled');
    const body=object(request.body);if(body.policyAccepted!==true)throw httpError(400,'Terms and privacy acceptance is required');
    const username=validateUsername(body.username),password=validatePassword(body.password),email=normalizeEmail(body.email,true);
    if(settings.emailRegistrationEnabled&&!email)throw httpError(400,'A verified email is required');
    if(email)await codeAttempt(ctx,email,'register',request.ip);
    const passwordHash=await bcrypt.hash(password,12),id=randomUUID();
    const user=await transaction(ctx.db,async client=>{
      if(email)await consumeCode(ctx,client,email,'register',body.emailCode);
      const {rows}=await client.query('INSERT INTO oaooao_users(id,username,email,display_name,password_hash,email_verified,policy_accepted_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING *',[id,username,email,body.displayName===undefined?username:string(body.displayName,'display name',120),passwordHash,Boolean(email)]);
      if(body.referralCode)await recordReferral(ctx,id,string(body.referralCode,'referral code',100),client);
      await ctx.audit({actorId:id,action:'auth.register',targetType:'user',targetId:id},client);return userFromRow(rows[0]);
    });await createSession(ctx,id,reply,passwordHash);return {user:await viewUser(ctx,user)};
  });
  app.patch('/api/auth/profile',async request=>{
    const user=await ctx.requireUser(request),body=object(request.body);for(const key of Object.keys(body))if(!['displayName','bio','email','emailCode'].includes(key))throw httpError(400,'Unknown profile field');
    const email=body.email===undefined?user.email:normalizeEmail(body.email);const emailChanged=email!==user.email;
    if(emailChanged)await codeAttempt(ctx,email!,'email-change',request.ip);
    const updated=await transaction(ctx.db,async client=>{
      const current=(await client.query('SELECT * FROM oaooao_users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
      const finalEmail=body.email===undefined?current.email:email;
      const changed=finalEmail!==current.email;
      if(changed)await consumeCode(ctx,client,finalEmail!,'email-change',body.emailCode,user.id);
      const {rows}=await client.query('UPDATE oaooao_users SET display_name=$2,bio=$3,email=$4,email_verified=CASE WHEN $5 THEN true ELSE email_verified END,updated_at=now() WHERE id=$1 RETURNING *',[user.id,body.displayName===undefined?current.display_name:string(body.displayName,'display name',120),body.bio===undefined?current.bio:string(body.bio,'bio',2000,true),finalEmail,changed]);
      await ctx.audit({actorId:user.id,action:'auth.profile',targetType:'user',targetId:user.id,metadata:{fields:Object.keys(body).filter(k=>k!=='emailCode')}},client);return userFromRow(rows[0]);
    });return {user:await viewUser(ctx,updated)};
  });
  app.patch('/api/auth/password',async(request,reply)=>{
    const user=await ctx.requireUser(request),body=object(request.body);await rateLimit(ctx,`password:${user.id}`,5,900);const next=validatePassword(body.newPassword);
    const {rows}=await ctx.db.query('SELECT password_hash FROM oaooao_users WHERE id=$1',[user.id]);if(typeof body.currentPassword!=='string'||!await verifyPassword(body.currentPassword,rows[0].password_hash))throw httpError(400,'Current password is incorrect');
    const hash=await bcrypt.hash(next,12);await transaction(ctx.db,async client=>{const updated=await client.query('UPDATE oaooao_users SET password_hash=$2,updated_at=now() WHERE id=$1 AND password_hash=$3',[user.id,hash,rows[0].password_hash]);if(!updated.rowCount)throw httpError(409,'Password changed concurrently; sign in again');await client.query('DELETE FROM oaooao_sessions WHERE user_id=$1',[user.id]);await ctx.audit({actorId:user.id,action:'auth.password',targetType:'user',targetId:user.id},client);});reply.clearCookie(ctx.config.sessionCookieName,{path:'/'});return {ok:true};
  });
  app.post('/api/auth/email-code',async request=>{
    const body=object(request.body),email=normalizeEmail(body.email)!,purpose=string(body.purpose,'purpose',30);
    if(!['register','email-change','password-reset'].includes(purpose))throw httpError(400,'Invalid verification purpose');
    const settings=await getSettings(ctx);if(!settings.mail.host||!settings.mail.fromEmail)throw httpError(503,'Email delivery is not configured');
    if(purpose==='register'&&!settings.registrationEnabled)throw httpError(403,'Registration is disabled');
    const user=purpose==='email-change'?await ctx.requireUser(request):null;
    await rateLimit(ctx,`email-code-ip:${request.ip}`,10,3600);await rateLimit(ctx,`email-code:${email}:${purpose}`,1,60);await rateLimit(ctx,`email-code-day:${email}`,10,86400);
    const exists=(await ctx.db.query('SELECT id FROM oaooao_users WHERE lower(email)=$1 AND email_verified=true AND enabled=true',[email])).rowCount;
    if((purpose==='password-reset'&&!exists)||(purpose==='register'&&exists))return {ok:true,expiresInSeconds:600};
    const code=String(randomInt(0,1000000)).padStart(6,'0'),id=randomUUID();await ctx.db.query('INSERT INTO oaooao_email_codes(id,email,purpose,user_id,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'10 minutes\')',[id,email,purpose,user?.id||null,codeHash(ctx,`${email}:${purpose}:${code}`)]);
    try{await sendMail(ctx,settings.mail,email,'OAOOAO verification code',`Your verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this message.`);await ctx.db.query('UPDATE oaooao_email_codes SET sent_at=now() WHERE id=$1',[id]);}
    catch(error){await ctx.db.query('DELETE FROM oaooao_email_codes WHERE id=$1',[id]);throw error;}
    return {ok:true,expiresInSeconds:600};
  });
  app.post('/api/auth/password/reset',async(request,reply)=>{
    const body=object(request.body),email=normalizeEmail(body.email)!,password=validatePassword(body.newPassword);await codeAttempt(ctx,email,'password-reset',request.ip);const hash=await bcrypt.hash(password,12);
    await transaction(ctx.db,async client=>{await consumeCode(ctx,client,email,'password-reset',body.code);const {rows}=await client.query('UPDATE oaooao_users SET password_hash=$2,updated_at=now() WHERE lower(email)=$1 AND email_verified=true AND enabled=true RETURNING id',[email,hash]);if(!rows[0])throw httpError(400,'Verification code is invalid or expired');await client.query('DELETE FROM oaooao_sessions WHERE user_id=$1',[rows[0].id]);await ctx.audit({actorId:rows[0].id,action:'auth.password.reset',targetType:'user',targetId:rows[0].id},client);});reply.clearCookie(ctx.config.sessionCookieName,{path:'/'});return {ok:true};
  });
  await registerWechatOfficial(app,ctx,verifyPassword,options.wechatProvider);

  app.get('/api/admin/users',async request=>{
    await ctx.requireUser(request,'users.read');const q=(request.query||{})as any,{page,pageSize,offset}=pagination(q),params:any[]=[],filters:string[]=[];
    if(q.keyword){params.push(`%${string(q.keyword,'keyword',200)}%`);filters.push(`(username ILIKE $${params.length} OR email ILIKE $${params.length} OR display_name ILIKE $${params.length})`);}
    if(q.role){if(!['admin','user'].includes(q.role))throw httpError(400,'Invalid role');params.push(q.role);filters.push(`role=$${params.length}`);}
    if(q.status){if(!['active','disabled'].includes(q.status))throw httpError(400,'Invalid status');params.push(q.status==='active');filters.push(`enabled=$${params.length}`);}
    const where=filters.length?`WHERE ${filters.join(' AND ')}`:'';
    const count=await ctx.db.query(`SELECT count(*) FROM oaooao_users ${where}`,params);params.push(pageSize,offset);
    const {rows}=await ctx.db.query(`SELECT * FROM oaooao_users ${where} ORDER BY created_at DESC,id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    const summary=(await ctx.db.query("SELECT count(*) AS total,count(*) FILTER(WHERE enabled) AS active,count(*) FILTER(WHERE NOT enabled) AS disabled,count(*) FILTER(WHERE role='admin') AS admins,count(*) FILTER(WHERE role='admin' AND enabled) AS active_admins,count(*) FILTER(WHERE plan_id IS NOT NULL) AS users_with_plan FROM oaooao_users")).rows[0];
    const balance=(await ctx.db.query('SELECT (SELECT coalesce(sum(permanent_balance+CASE WHEN daily_expires_at>clock_timestamp() THEN daily_balance ELSE 0 END),0) FROM oaooao_wallets)+(SELECT coalesce(sum(remaining_amount),0) FROM oaooao_credit_batches WHERE expired_at IS NULL AND expires_at>clock_timestamp()) AS total')).rows[0];
    return {users:await Promise.all(rows.map(row=>viewUser(ctx,userFromRow(row)))),total:Number(count.rows[0].count),page,pageSize,summary:{total:Number(summary.total),active:Number(summary.active),disabled:Number(summary.disabled),admins:Number(summary.admins),activeAdmins:Number(summary.active_admins),usersWithPlan:Number(summary.users_with_plan),totalPointsBalance:Number(balance.total)}};
  });
  async function writeUser(request:any,isNew:boolean){
    const actor=await ctx.requireUser(request,'users.manage'),body=object(request.body),id=isNew?randomUUID():string(request.params.id,'user ID',200);
    const allowed=['username','displayName','email','password','role','adminPermissions','status','pointsBalance','planId'];for(const key of Object.keys(body))if(!allowed.includes(key))throw httpError(400,'Unknown user field');
    if(body.role!==undefined&&!['admin','user'].includes(body.role))throw httpError(400,'Invalid role');if(body.status!==undefined&&!['active','disabled'].includes(body.status))throw httpError(400,'Invalid status');if(body.adminPermissions!==undefined)permissions(body.adminPermissions);
    if(body.pointsBalance!==undefined&&(typeof body.pointsBalance!=='number'||!Number.isFinite(body.pointsBalance)||body.pointsBalance<0))throw httpError(400,'Invalid points balance');
    const passwordHash=body.password?await bcrypt.hash(validatePassword(body.password),12):null;if(isNew&&!passwordHash)throw httpError(400,'Password is required');
    const user=await transaction(ctx.db,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(193147,1)');
      const previous=isNew?null:(await client.query('SELECT * FROM oaooao_users WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!isNew&&!previous)throw httpError(404,'User not found');
      if((previous?.role==='admin'||body.role==='admin'||(Array.isArray(body.adminPermissions)&&body.adminPermissions.length>0)||(previous&&body.role!==undefined&&body.role!==previous.role))&&!hasPermission(actor,'administrators.manage'))throw httpError(403,'Administrator management permission required');
      const username=body.username===undefined?previous?.username:validateUsername(body.username);if(!username)throw httpError(400,'Username required');
      const role=body.role??previous?.role??'user',enabled=body.status===undefined?previous?.enabled??true:body.status==='active';
      const adminPermissions=role==='admin'?(body.adminPermissions===undefined?previous?.admin_permissions||[]:permissions(body.adminPermissions)):[];
      if(previous?.role==='admin'&&previous.enabled&&previous.admin_permissions.includes('administrators.manage')&&(!enabled||role!=='admin'||!adminPermissions.includes('administrators.manage'))){const other=await client.query("SELECT id FROM oaooao_users WHERE id<>$1 AND role='admin' AND enabled=true AND admin_permissions ? 'administrators.manage' LIMIT 1",[id]);if(!other.rowCount)throw httpError(409,'At least one active administrator with administrator-management permission is required');}
      const email=body.email===undefined?previous?.email||null:normalizeEmail(body.email,true);
      const {rows}=await client.query(`INSERT INTO oaooao_users(id,username,email,display_name,password_hash,role,admin_permissions,enabled,plan_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT(id) DO UPDATE SET username=$2,email=$3,display_name=$4,password_hash=$5,role=$6,admin_permissions=$7::jsonb,enabled=$8,plan_id=$9,email_verified=CASE WHEN oaooao_users.email IS DISTINCT FROM $3 THEN false ELSE oaooao_users.email_verified END,updated_at=now() RETURNING *`,[id,username,email,body.displayName===undefined?previous?.display_name||username:string(body.displayName,'display name',120),passwordHash||previous?.password_hash,role,JSON.stringify(adminPermissions),enabled,body.planId===undefined?previous?.plan_id||null:string(body.planId,'plan ID',100,true)||null]);
      if(passwordHash||!enabled||role!==previous?.role||body.adminPermissions!==undefined)await client.query('DELETE FROM oaooao_sessions WHERE user_id=$1',[id]);
      if(body.pointsBalance!==undefined)await setPermanentBalance(ctx,id,`admin:${randomUUID()}`,body.pointsBalance,{actorId:actor.id,kind:'admin_adjustment'},client);
      if(body.planId!==undefined&&body.planId!==(previous?.plan_id||''))await assignAdminPlan(ctx,id,`admin-plan:${randomUUID()}`,body.planId||null,client);
      await ctx.audit({actorId:actor.id,action:isNew?'user.create':'user.update',targetType:'user',targetId:id,metadata:{fields:Object.keys(body)}},client);return userFromRow(rows[0]);
    });return {user:await viewUser(ctx,user)};
  }
  app.post('/api/admin/users',request=>writeUser(request,true));app.patch('/api/admin/users/:id',request=>writeUser(request,false));
}

