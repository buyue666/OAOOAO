import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import type {Pool} from 'pg';
import { createContext, isPublicAddress, redact, safeFetch, type AppConfig } from '../src/core.js';
import { DEFAULT_SETTINGS, publicSettings, sanitizedSettings, validateSettingsPatch } from '../src/settings.js';
import { validatePassword, normalizeEmail, verifyPassword } from '../src/auth.js';
import {buildApp,loadConfig} from '../src/app.js';

const ctx=createContext({} as Pool,{encryptionKey:randomBytes(32).toString('base64')} as AppConfig);
test('AES-GCM randomizes ciphertext and detects tampering',()=>{const a=ctx.encrypt('fixture-secret'),b=ctx.encrypt('fixture-secret');assert.notEqual(a,b);assert.equal(ctx.decrypt(a),'fixture-secret');const raw=Buffer.from(a.slice(7),'base64');raw[30]^=1;assert.throws(()=>ctx.decrypt(`enc:v1:${raw.toString('base64')}`));assert.throws(()=>ctx.decrypt('plain-secret'));});
test('secret redaction is recursive',()=>{assert.deepEqual(redact({apiKey:'secret',nested:[{password:'p',count:2}]}),{apiKey:'[redacted]',nested:[{password:'[redacted]',count:2}]});});
test('private/reserved IPs including mapped IPv6 never qualify as public',async()=>{for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(isPublicAddress(ip),false,ip);assert.equal(isPublicAddress('8.8.8.8'),true);await assert.rejects(safeFetch('http://127.0.0.1/private'),/Private or reserved/);});
test('public/admin settings never disclose server credentials; empty secrets preserve saved secrets',()=>{const saved=validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{systemChannels:[{id:'channel-1',name:'Provider',baseUrl:'https://api.example.com/v1',models:['model-1'],enabled:true,apiKey:'provider-secret'}],mail:{password:'smtp-secret'}});const patched=validateSettingsPatch(ctx,saved,{systemChannels:[{...saved.systemChannels[0],apiKey:''}],mail:{password:''}});assert.equal(ctx.decrypt(patched.systemChannels[0].apiKey),'provider-secret');assert.equal(ctx.decrypt(patched.mail.password),'smtp-secret');assert.equal(sanitizedSettings(patched).mail.password,'');assert.equal(sanitizedSettings(patched).systemChannels[0].apiKey,'');const publicJson=JSON.stringify(publicSettings(patched));assert.ok(!publicJson.includes('enc:v1:'));assert.ok(!publicJson.includes('smtp-secret'));assert.ok(!publicJson.includes('provider-secret'));});
test('password byte limit prevents silent bcrypt truncation',()=>{assert.throws(()=>validatePassword('short'));assert.throws(()=>validatePassword('界'.repeat(25)));assert.equal(validatePassword('long-enough-password'),'long-enough-password');assert.equal(normalizeEmail('Test@Example.COM'),'test@example.com');});
test('legacy PBKDF2 serialization uses literal UTF-8 salt and timing-safe verification',async()=>{
  const salt='abcdefghijklmnopqrstuv',password='Synthetic legacy password!';
  const digest=pbkdf2Sync(password,salt,210000,32,'sha256').toString('base64url');
  const encoded=`pbkdf2_sha256$210000$${salt}$${digest}`;
  assert.equal(await verifyPassword(password,encoded),true);
  assert.equal(await verifyPassword('incorrect password',encoded),false);
  const incorrectlyDecoded=pbkdf2Sync(password,Buffer.from(salt,'base64url'),210000,32,'sha256').toString('base64url');
  assert.equal(await verifyPassword(password,`pbkdf2_sha256$210000$${salt}$${incorrectlyDecoded}`),false);
  assert.equal(await verifyPassword(password,encoded.replace('$210000$','$9999999$')),false);
  const long='界'.repeat(30);const longDigest=pbkdf2Sync(long,salt,210000,32,'sha256').toString('base64url');
  assert.equal(await verifyPassword(long,`pbkdf2_sha256$210000$${salt}$${longDigest}`),true);
});
test('settings cannot persist credits that wallet precision rejects or ambiguous entitlement definitions',()=>{
  assert.throws(()=>validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{freeDailyPoints:0.00001}),/four decimal/);
  const plan={id:'basic',name:'Basic',enabled:true,dailyPoints:1,limits:{dailyPointSpend:0,dailyApiCalls:0,dailyImages:0,dailyVideos:0,dailyAudio:0,dailyText:0},features:[]};
  assert.throws(()=>validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{entitlements:{enabled:true,defaultPlanId:'basic',plans:[{...plan,dailyPoints:0.00001}]}}),/four decimal/);
  assert.throws(()=>validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{entitlements:{enabled:true,defaultPlanId:'basic',plans:[plan,plan]}}),/unique/);
  assert.throws(()=>validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{entitlements:{enabled:true,defaultPlanId:'missing',plans:[plan]}}),/default entitlement/);
  assert.throws(()=>validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{entitlements:{enabled:'true',plans:[plan]}}),/Invalid entitlement/);
});
test('channel origin change never forwards a retained saved secret to a new provider',()=>{
  const channel={id:'origin-channel',name:'Synthetic',baseUrl:'https://original.example.invalid/v1',apiKey:'synthetic-secret',models:[],enabled:true};
  const saved=validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{systemChannels:[channel]});
  assert.throws(()=>validateSettingsPatch(ctx,saved,{systemChannels:[{...channel,baseUrl:'https://different.example.invalid/v1',apiKey:''}]}),/new API key/);
  const cleared=validateSettingsPatch(ctx,saved,{systemChannels:[{...channel,baseUrl:'https://different.example.invalid/v1',apiKey:'',clearApiKey:true}]});assert.equal(cleared.systemChannels[0].apiKey,'');
});
test('forwarded client IPs are honored only through explicitly trusted proxies',async()=>{
  const env={DATABASE_URL:'postgresql://fixture.invalid/unused',ENCRYPTION_KEY:randomBytes(32).toString('base64'),TRUSTED_PROXY_CIDRS:'127.0.0.1/32, ::1/128'};
  for(const invalid of ['true','*','example.com','0.0.0.0/0','::/0','127.0.0.1/33','::1/129','127.0.0.1/32/1'])assert.throws(()=>loadConfig({...env,TRUSTED_PROXY_CIDRS:invalid}),/TRUSTED_PROXY_CIDRS/);
  const config=loadConfig(env),app=await buildApp({db:{} as Pool,config,coreOnly:true});
  app.get('/fixture-ip',request=>({ip:request.ip}));
  try{
    const trusted=await app.inject({url:'/fixture-ip',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':'198.51.100.17'}});assert.equal(trusted.json().ip,'198.51.100.17');
    const untrusted=await app.inject({url:'/fixture-ip',remoteAddress:'198.51.100.18',headers:{'x-forwarded-for':'198.51.100.17'}});assert.equal(untrusted.json().ip,'198.51.100.18');
  }finally{await app.close();}
  const direct=await buildApp({db:{} as Pool,config:{...config,trustedProxies:[]},coreOnly:true});direct.get('/fixture-ip',request=>({ip:request.ip}));
  try{const reply=await direct.inject({url:'/fixture-ip',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':'198.51.100.17'}});assert.equal(reply.json().ip,'127.0.0.1');}finally{await direct.close();}
});
test('SMTP host changes cannot send a saved password to a new server',()=>{
  const saved=validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{mail:{host:'smtp.original.example.invalid',password:'synthetic-password'}});
  assert.throws(()=>validateSettingsPatch(ctx,saved,{mail:{host:'smtp.changed.example.invalid',password:''}}),/new password/);
  assert.equal(validateSettingsPatch(ctx,saved,{mail:{host:'smtp.changed.example.invalid',clearPassword:true}}).mail.password,'');
  assert.equal(ctx.decrypt(validateSettingsPatch(ctx,saved,{mail:{host:'smtp.changed.example.invalid',password:'new-synthetic-password'}}).mail.password),'new-synthetic-password');
});
