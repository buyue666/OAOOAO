import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {buildApp} from '../src/app.js';
import {createContext,hashToken,type AppConfig} from '../src/core.js';
import {DEFAULT_SETTINGS,publicSettings,settingsPermission,validateSettingsPatch} from '../src/settings.js';
import {createTestDatabase,testDatabaseUrl} from './core-helpers.js';

test('registration frequency policy is private, disabled by default and restricted to system administrators',()=>{
  const ctx=createContext({} as Pool,{encryptionKey:randomBytes(32).toString('base64')} as AppConfig);
  assert.equal(DEFAULT_SETTINGS.registrationRateLimit.enabled,false);
  assert.equal(settingsPermission('registrationRateLimit'),'system.manage');
  const next=validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{registrationRateLimit:{enabled:true,maxAttempts:12,windowSeconds:600}});
  assert.deepEqual(next.registrationRateLimit,{enabled:true,maxAttempts:12,windowSeconds:600});
  assert.equal(publicSettings(next).registrationRateLimit,undefined);
  for(const rule of [{enabled:'false'},{maxAttempts:0},{maxAttempts:1.5},{windowSeconds:0},{windowSeconds:61},{windowSeconds:86460},{unknown:true}])assert.throws(()=>validateSettingsPatch(ctx,structuredClone(DEFAULT_SETTINGS),{registrationRateLimit:rule}));
});

test('registration retries ignore old blocked buckets while disabled; enabled limits use configured windows and expose retry time',{skip:!await testDatabaseUrl()},async()=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  try{
    await fixture.db.query("UPDATE oaooao_settings SET value=$1::jsonb WHERE id='global'",[JSON.stringify({registrationEnabled:true,registrationRateLimit:{enabled:false,maxAttempts:2,windowSeconds:60}})]);
    await fixture.db.query("INSERT INTO oaooao_rate_limits(key,count,expires_at) VALUES($1,100,now()+interval '1 hour')",[hashToken('register-ip:127.0.0.1')]);
    const request={method:'POST' as const,url:'/api/auth/register',headers:{origin:fixture.config.origin},payload:{policyAccepted:false}};
    for(let i=0;i<8;i++)assert.equal((await app.inject(request)).statusCode,400,'Disabled policy must not consume the historical five-attempt bucket');
    await fixture.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{registrationRateLimit,enabled}','true') WHERE id='global'");
    for(let i=0;i<2;i++)assert.equal((await app.inject(request)).statusCode,400);
    const blocked=await app.inject(request);assert.equal(blocked.statusCode,429);assert.match(blocked.json().msg,/操作过于频繁/);
    assert.ok(blocked.json().retryAfterSeconds>0&&blocked.json().retryAfterSeconds<=60);assert.equal(Number(blocked.headers['retry-after']),blocked.json().retryAfterSeconds);
    const english=await app.inject({...request,headers:{...request.headers,'accept-language':'en-US'}});assert.equal(english.statusCode,429);assert.match(english.json().msg,/Too many requests/);
    await fixture.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{registrationRateLimit,enabled}','false') WHERE id='global'");
    assert.equal((await app.inject(request)).statusCode,400,'Turning off the saved switch must take effect immediately');
    assert.equal(Number((await fixture.db.query('SELECT count(*) FROM oaooao_users')).rows[0].count),0);
  }finally{await app.close();await fixture.cleanup();}
});
