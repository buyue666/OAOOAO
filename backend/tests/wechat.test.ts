import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';
import {createContext,hashToken,ADMIN_PERMISSIONS} from '../src/core.js';
import {assertCsrfOrigin} from '../src/app.js';
import {registerAuth} from '../src/auth.js';
import {DEFAULT_SETTINGS,registerSettings,publicSettings,sanitizedSettings,validateSettingsPatch} from '../src/settings.js';
import {validateWechatConfig,WECHAT_CALLBACK_PATH} from '../src/wechat-config.js';
import {createWechatQrProvider,decryptWechatMessage,readWechatXml,verifyWechatSignature} from '../src/wechat-protocol.js';
import {wechatReturnTo} from '../src/wechat.js';
import {createTestDatabase} from './core-helpers.js';

const appId='wx1234567890abcdef',appSecret='syntheticAppSecret1234567890',token='SyntheticWechatToken',aes='A'.repeat(43);
const password='synthetic-password-123456';
function sign(parts:string[]){return createHash('sha1').update(parts.sort().join('')).digest('hex');}
function encrypt(xml:string,id=appId,key=aes){const bytes=Buffer.from(xml),length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);const input=Buffer.concat([randomBytes(16),length,bytes,Buffer.from(id)]),pad=32-input.length%32,keyBytes=Buffer.from(key+'=','base64'),cipher=createCipheriv('aes-256-cbc',keyBytes,keyBytes.subarray(0,16));cipher.setAutoPadding(false);return Buffer.concat([cipher.update(Buffer.concat([input,Buffer.alloc(pad,pad)])),cipher.final()]).toString('base64');}
function xml(fields:Record<string,string>){return '<xml>'+Object.entries(fields).map(([k,v])=>`<${k}><![CDATA[${v}]]></${k}>`).join('')+'</xml>';}

test('WeChat cryptography validates the official AES example independently of the test encryptor',()=>{
  const encrypted='+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=';
  verifyWechatSignature('AAAAA',{timestamp:'1714112445',nonce:'415670741',msg_signature:'046e02f8204d34f8ba5fa3b1db94908f3df2e9b3'},encrypted,1714112445000);
  const value=JSON.parse(decryptWechatMessage(encrypted,aes,'wxba5fad812f8e6fb9'));assert.equal(value.debug_str,'hello world');
  assert.throws(()=>decryptWechatMessage(encrypted,aes,appId),{statusCode:403});
  assert.throws(()=>verifyWechatSignature('wrong',{timestamp:'1714112445',nonce:'415670741',msg_signature:'046e02f8204d34f8ba5fa3b1db94908f3df2e9b3'},encrypted,1714112445000),{statusCode:403});
  assert.throws(()=>verifyWechatSignature('AAAAA',{timestamp:'1714112445',nonce:'415670741',msg_signature:'046e02f8204d34f8ba5fa3b1db94908f3df2e9b3'},encrypted,1714112746000),{statusCode:403});
});
test('WeChat flat XML rejects duplicate fields, entities, DTD, nested nodes and invalid envelopes',()=>{
  assert.deepEqual({...readWechatXml('<xml><Event><![CDATA[SCAN]]></Event><CreateTime>123</CreateTime></xml>')},{Event:'SCAN',CreateTime:'123'});
  for(const bad of ['<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///secret">]><xml><Event>&x;</Event></xml>','<xml><Event>a</Event><Event>b</Event></xml>','<xml><Event><x>a</x></Event></xml>','<xml><Event>&amp;</Event></xml>','<xml/><xml/>'])assert.throws(()=>readWechatXml(bad),{statusCode:400});
});
test('WeChat return paths reject external and ambiguous redirect targets',()=>{
  assert.equal(wechatReturnTo('/studio?tab=mine'),'/studio?tab=mine');assert.equal(wechatReturnTo(undefined),'/studio');
  for(const bad of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/%2fevil.invalid','/%5cevil.invalid','/\nfoo','/%00foo'])assert.throws(()=>wechatReturnTo(bad),{statusCode:400});
});
test('WeChat provider uses documented stable token and QR requests, caches token and never exposes upstream error contents',async()=>{
  const calls:{url:string;body:any}[]=[];
  const provider=createWechatQrProvider(async(input,init)=>{const url=String(input);calls.push({url,body:JSON.parse(String(init?.body))});return new Response(JSON.stringify(url.includes('stable_token')?{access_token:'synthetic-token',expires_in:7200}:{ticket:'ticket+/=',expire_seconds:300}),{status:200});});
  const values=await Promise.all([provider({appId,appSecret},'scene1',300),provider({appId,appSecret},'scene2',300)]);
  assert.equal(calls.filter(c=>c.url.includes('stable_token')).length,1);assert.deepEqual(calls[0].body,{grant_type:'client_credential',appid:appId,secret:appSecret,force_refresh:false});
  assert.equal(calls[1].body.action_name,'QR_STR_SCENE');assert.equal(values[0].ticket,'ticket+/=');
  const invalid=createWechatQrProvider(async()=>new Response(JSON.stringify({errcode:40013,errmsg:appSecret}),{status:200}));
  await assert.rejects(invalid({appId,appSecret},'scene',300),e=>e instanceof Error&&!e.message.includes(appSecret));
});

test('isolated PostgreSQL WeChat: secure binding, login, registration gates, replay and encrypted settings',async t=>{
  const fixture=await createTestDatabase(),ctx=createContext(fixture.db,fixture.config),app=Fastify();
  t.after(async()=>{await app.close();await fixture.cleanup();});await app.register(cookie);
  app.addHook('onRequest',async req=>assertCsrfOrigin(ctx,req.method,req.headers.origin,req.headers['sec-fetch-site'] as string|undefined,Boolean(req.cookies[fixture.config.sessionCookieName]),req.url));
  app.setErrorHandler((error,_req,reply)=>{const e=error as any;reply.code(e.statusCode||500).send({message:e.message});});
  let issueFailure=false;
  await registerAuth(app,ctx,{wechatProvider:async()=>{if(issueFailure)throw new Error('Synthetic provider unavailable');return {ticket:'synthetic-ticket',expiresIn:300};}});await registerSettings(app,ctx);
  const passwordHash=await bcrypt.hash(password,12),adminId=randomUUID(),otherId=randomUUID();
  for(const [id,name] of [[adminId,'wechat_fixture_admin'],[otherId,'wechat_fixture_other']])await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$2,$3,$4,$5)',[id,name,passwordHash,id===adminId?'admin':'user',JSON.stringify(id===adminId?ADMIN_PERMISSIONS:[])]);
  async function auth(id:string){const value=randomBytes(32).toString('base64url');await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(value),id]);return 'oaooao_session='+value;}
  const adminCookie=await auth(adminId),otherCookie=await auth(otherId);let ip=1;
  function headers(c=''){return {origin:fixture.config.origin,...(c?{cookie:c}:{})};}
  async function configure(patch:any={}){
    const result=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers(adminCookie),payload:patch});assert.equal(result.statusCode,200,result.body);return result;
  }
  async function begin(purpose:'login'|'binding'='login',cookieValue='',policyAccepted=false){
    const result=await app.inject({method:'POST',url:purpose==='binding'?'/api/account/wechat-official/bind-sessions':'/api/auth/wechat-official/sessions',remoteAddress:'192.0.2.'+(ip++),headers:headers(cookieValue),payload:purpose==='binding'?{password}:{returnTo:'/studio',policyAccepted}});
    assert.equal(result.statusCode,200,result.body);const body=result.json();const browser=result.cookies.find(c=>c.name==='oaooao_wechat_browser')!;assert.equal(browser.httpOnly,true);
    const cookies=[cookieValue,browser.name+'='+browser.value].filter(Boolean).join('; ');const row=(await ctx.db.query('SELECT scene_key FROM oaooao_wechat_login_sessions WHERE id=$1',[body.sessionId])).rows[0];return {...body,cookies,scene:row.scene_key};
  }
  async function callback(scene:string,openid:string,event='SCAN',changes:Record<string,string>={}){
    const stamp=String(Math.floor(Date.now()/1000)),nonce='syntheticNonce';const fields={ToUserName:'gh_synthetic',FromUserName:openid,CreateTime:stamp,MsgType:'event',Event:event,EventKey:event==='subscribe'?'qrscene_'+scene:scene,...changes};
    const encrypted=encrypt(xml(fields));return app.inject({method:'POST',url:WECHAT_CALLBACK_PATH+'?'+new URLSearchParams({timestamp:stamp,nonce,encrypt_type:'aes',msg_signature:sign([token,stamp,nonce,encrypted])}),headers:{'content-type':'application/xml'},payload:xml({ToUserName:'gh_synthetic',Encrypt:encrypted})});
  }
  const consume=(s:any,c=s.cookies)=>app.inject({method:'POST',url:`/api/auth/wechat-official/sessions/${s.sessionId}/consume`,headers:headers(c)});
  const status=(s:any,c=s.cookies)=>app.inject({url:`/api/auth/wechat-official/sessions/${s.sessionId}`,headers:headers(c)});
  await t.test('disabled default creates neither QR nor account; privileged encrypted configuration roundtrips without secrets',async()=>{
    assert.equal((await app.inject({method:'POST',url:'/api/auth/wechat-official/sessions',headers:headers(),payload:{}})).statusCode,503);
    const r=await configure({wechatOfficial:{enabled:true,autoRegister:false,appId,appSecret,token,encodingAESKey:aes}});const out=r.json().settings.wechatOfficial;
    assert.equal(out.configured,true);assert.equal(out.callbackUrl,fixture.config.origin+WECHAT_CALLBACK_PATH);
    for(const secret of [appSecret,token,aes,'enc:v1:'])assert.ok(!JSON.stringify(out).includes(secret));
    const saved=(await ctx.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
    assert.equal(ctx.decrypt(saved.wechatOfficial.appSecret),appSecret);assert.equal(publicSettings(saved).wechatLoginEnabled,true);assert.equal(publicSettings(saved).wechatRegistrationEnabled,false);
    const next=validateSettingsPatch(ctx,saved,{wechatOfficial:{appSecret:'',token:'',encodingAESKey:''}});assert.equal(next.wechatOfficial.appSecret,saved.wechatOfficial.appSecret);assert.ok(!JSON.stringify(sanitizedSettings(next)).includes(appSecret));
    assert.throws(()=>validateWechatConfig(ctx,saved.wechatOfficial,{appId:'wxabcdef1234567890'}),{statusCode:400});
    assert.throws(()=>validateWechatConfig(ctx,saved.wechatOfficial,{encodingAESKey:'invalid'}),{statusCode:400});
    assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers(otherCookie),payload:{wechatOfficial:{enabled:false}}})).statusCode,403);
    assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers:{cookie:adminCookie,origin:'https://evil.invalid'},payload:{wechatOfficial:{enabled:false}}})).statusCode,403);
  });
  await t.test('URL handshake accepts valid signature and encrypted challenge, rejects invalid body/signature and plaintext POST',async()=>{
    const stamp=String(Math.floor(Date.now()/1000)),nonce='challenge';const base={timestamp:stamp,nonce};
    const plain=await app.inject({url:WECHAT_CALLBACK_PATH+'?'+new URLSearchParams({...base,signature:sign([token,stamp,nonce]),echostr:'challenge-response'})});assert.equal(plain.body,'challenge-response');
    const encrypted=encrypt('secret-echo');const secure=await app.inject({url:WECHAT_CALLBACK_PATH+'?'+new URLSearchParams({...base,msg_signature:sign([token,stamp,nonce,encrypted]),echostr:encrypted})});assert.equal(secure.body,'secret-echo');
    assert.equal((await app.inject({url:WECHAT_CALLBACK_PATH+'?'+new URLSearchParams({...base,signature:'a'.repeat(40),echostr:'test'})})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:WECHAT_CALLBACK_PATH,headers:{'content-type':'application/xml'},payload:'<xml/>'})).statusCode,403);
  });
  await t.test('unknown identity remains unlinked and cross-browser status/consume is denied',async()=>{
    const s=await begin();assert.equal((await callback(s.scene,'synthetic_unknown')).statusCode,200);assert.equal((await status(s)).json().status,'unlinked');
    assert.equal((await status(s,'')).statusCode,404);assert.equal((await consume(s,'')).statusCode,404);assert.equal((await consume(s)).statusCode,409);
    assert.equal((await ctx.db.query('SELECT 1 FROM oaooao_users')).rowCount,2);
  });
  await t.test('password-verified binding is browser and authenticated-session bound, and does not switch login cookies',async()=>{
    const bad=await app.inject({method:'POST',url:'/api/account/wechat-official/bind-sessions',headers:headers(adminCookie),payload:{password:'bad'}});assert.equal(bad.statusCode,400);
    const s=await begin('binding',adminCookie);assert.equal((await callback(s.scene,'synthetic_owner','subscribe')).statusCode,200);
    const stolen=s.cookies.replace(adminCookie,otherCookie);assert.equal((await consume(s,stolen)).statusCode,404);
    const results=await Promise.all([consume(s),consume(s)]);assert.ok(results.every(r=>r.statusCode===200&&r.json().bound===true&&r.cookies.length===0));
    assert.equal((await ctx.db.query('SELECT user_id FROM oaooao_wechat_identities WHERE open_id=$1',['synthetic_owner'])).rows[0].user_id,adminId);
    const state=await app.inject({url:'/api/account/wechat-official',headers:headers(adminCookie)});assert.deepEqual(state.json(),{bound:true,available:true,appId,canBind:false});
    assert.ok(!state.body.includes('synthetic_owner'));
  });
  await t.test('openid cannot be merged into a different account and AppID change is blocked with any binding',async()=>{
    const s=await begin('binding',otherCookie);await callback(s.scene,'synthetic_owner');assert.equal((await consume(s)).statusCode,409);
    const changed=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:headers(adminCookie),payload:{wechatOfficial:{appId:'wxabcdef1234567890',appSecret,token,encodingAESKey:aes}}});assert.equal(changed.statusCode,409);
    assert.equal((await ctx.db.query('SELECT 1 FROM oaooao_wechat_identities')).rowCount,1);
  });
  await t.test('20 concurrent login consumers receive one opaque cookie and one audit; repeat scan never overwrites authorization',async()=>{
    const s=await begin();await callback(s.scene,'synthetic_owner');await callback(s.scene,'synthetic_unknown');
    const results=await Promise.all(Array.from({length:20},()=>consume(s)));assert.ok(results.every(r=>r.statusCode===200),results.map(r=>r.body).join('\n'));
    assert.ok(results.every(r=>r.json().user.id===adminId));const tokens=new Set(results.map(r=>r.cookies.find(c=>c.name==='oaooao_session')!.value));assert.equal(tokens.size,1);
    assert.equal((await ctx.db.query("SELECT 1 FROM oaooao_audit_logs WHERE action='auth.wechat.login'")).rowCount,1);
    const stored=(await ctx.db.query('SELECT login_token_ciphertext FROM oaooao_wechat_login_sessions WHERE id=$1',[s.sessionId])).rows[0];assert.ok(stored.login_token_ciphertext.startsWith('enc:v1:'));assert.ok(!stored.login_token_ciphertext.includes([...tokens][0]));
    const session=await app.inject({url:'/api/auth/session',headers:headers('oaooao_session='+[...tokens][0])});assert.equal(session.json().user.id,adminId);
  });
  await t.test('disabled accounts, expired QR and changed provider settings cannot produce sessions',async()=>{
    await ctx.db.query('DELETE FROM oaooao_rate_limits');const s=await begin();await callback(s.scene,'synthetic_owner');await ctx.db.query('UPDATE oaooao_users SET enabled=false WHERE id=$1',[adminId]);assert.equal((await consume(s)).statusCode,401);await ctx.db.query('UPDATE oaooao_users SET enabled=true WHERE id=$1',[adminId]);
    const expired=await begin();await ctx.db.query("UPDATE oaooao_wechat_login_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.sessionId]);await callback(expired.scene,'synthetic_owner');assert.equal((await status(expired)).json().status,'expired');assert.equal((await consume(expired)).statusCode,409);
    const rotated=await begin();await callback(rotated.scene,'synthetic_owner');await configure({wechatOfficial:{token:'RotatedSyntheticToken'}});assert.equal((await consume(rotated)).statusCode,409);await configure({wechatOfficial:{token}});
  });
  await t.test('unfollow revokes pending/login tokens but preserves ownership and later resubscribe returns original user',async()=>{
    const s=await begin();await callback(s.scene,'synthetic_owner');const first=await consume(s);assert.equal(first.statusCode,200);const loginCookie='oaooao_session='+first.cookies[0].value;
    assert.equal((await callback('','synthetic_owner','unsubscribe')).statusCode,200);assert.equal((await ctx.db.query('SELECT user_id FROM oaooao_wechat_identities WHERE open_id=$1',['synthetic_owner'])).rows[0].user_id,adminId);
    assert.equal((await app.inject({url:'/api/auth/session',headers:headers(loginCookie)})).json().user,null);
    const again=await begin();await callback(again.scene,'synthetic_owner','subscribe');assert.equal((await consume(again)).json().user.id,adminId);
  });
  await t.test('registration requires both switches and explicit policy acceptance, and concurrent consume creates exactly one user',async()=>{
    await ctx.db.query('DELETE FROM oaooao_rate_limits');await configure({registrationEnabled:true,wechatOfficial:{autoRegister:true}});
    const noConsent=await begin();await callback(noConsent.scene,'synthetic_new');assert.equal((await status(noConsent)).json().status,'unlinked');
    const s=await begin('login','',true);await callback(s.scene,'synthetic_new');const responses=await Promise.all([consume(s),consume(s)]);assert.ok(responses.every(r=>r.statusCode===200),responses.map(r=>r.body).join('\n'));assert.equal(responses[0].json().user.id,responses[1].json().user.id);assert.notEqual(responses[0].json().user.id,adminId);
    assert.equal((await ctx.db.query('SELECT 1 FROM oaooao_users')).rowCount,3);assert.equal((await ctx.db.query("SELECT 1 FROM oaooao_audit_logs WHERE action='auth.wechat.register'")).rowCount,1);
    const switched=await begin('login','',true);await callback(switched.scene,'synthetic_later');await configure({registrationEnabled:false});assert.equal((await consume(switched)).statusCode,409);
  });
  await t.test('required verified email cannot be bypassed by auto-registration, including after scan authorization',async()=>{
    await configure({registrationEnabled:true,emailRegistrationEnabled:false,wechatOfficial:{autoRegister:true}});
    const inFlight=await begin('login','',true);await callback(inFlight.scene,'synthetic_email_gate');
    await configure({emailRegistrationEnabled:true});assert.equal((await consume(inFlight)).statusCode,409);
    const missingEmail=await begin('login','',true);await callback(missingEmail.scene,'synthetic_email_gate');assert.equal((await status(missingEmail)).json().status,'unlinked');
    const publicState=await app.inject({url:'/api/auth/session'});assert.equal(publicState.json().settings.wechatRegistrationEnabled,false);
    const known=await begin();await callback(known.scene,'synthetic_owner');assert.equal((await consume(known)).json().user.id,adminId);
    assert.equal((await ctx.db.query('SELECT 1 FROM oaooao_users')).rowCount,3);
  });
  await t.test('audit failure rolls back consume and auth-session creation; retry works without a second identity',async()=>{
    await ctx.db.query('DELETE FROM oaooao_rate_limits');const s=await begin();await callback(s.scene,'synthetic_owner');
    const before=(await ctx.db.query('SELECT count(*) FROM oaooao_sessions')).rows[0].count,original=ctx.audit;
    ctx.audit=async()=>{throw new Error('Synthetic audit unavailable');};
    try{assert.equal((await consume(s)).statusCode,500);}finally{ctx.audit=original;}
    assert.equal((await status(s)).json().status,'authorized');assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_sessions')).rows[0].count,before);
    assert.equal((await consume(s)).statusCode,200);
  });
  await t.test('failed provider calls and explicit secret clearing leave capability unavailable without creating sessions',async()=>{
    const before=(await ctx.db.query('SELECT count(*) FROM oaooao_wechat_login_sessions')).rows[0].count;issueFailure=true;
    const result=await app.inject({method:'POST',url:'/api/auth/wechat-official/sessions',remoteAddress:'192.0.2.200',headers:headers(),payload:{}});assert.equal(result.statusCode,500);assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_wechat_login_sessions')).rows[0].count,before);
    await configure({wechatOfficial:{clearAppSecret:true}});const publicResult=await app.inject({url:'/api/auth/session'});assert.equal(publicResult.json().settings.wechatLoginEnabled,false);assert.equal(publicResult.json().settings.wechatRegistrationEnabled,false);
  });
});
