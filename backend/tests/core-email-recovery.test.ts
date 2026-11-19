import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import {buildApp} from '../src/app.js';
import {createTestDatabase,testDatabaseUrl} from './core-helpers.js';

test('legacy email accounts receive recovery codes; valid ownership proof verifies email, revokes sessions and remains one-use',{skip:!await testDatabaseUrl()},async()=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config,coreOnly:true});
  const original=nodemailer.createTransport,sent:Array<{to:string;text:string}>=[];
  nodemailer.createTransport=(()=>({sendMail:async(message:any)=>{sent.push(message);return {accepted:[message.to]};},close(){}})) as typeof nodemailer.createTransport;
  try{
    const email='legacy@example.invalid',id=randomUUID(),disabledEmail='disabled@example.invalid',hash=await bcrypt.hash('synthetic-old-password',4);
    await fixture.db.query("INSERT INTO oaooao_users(id,username,email,email_verified,password_hash,enabled) VALUES($1,'legacy_email',$2,false,$3,true),($4,'disabled_email',$5,false,$3,false)",[id,email,hash,randomUUID(),disabledEmail]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",['a'.repeat(64),id]);
    await fixture.db.query("UPDATE oaooao_settings SET value=$1::jsonb WHERE id='global'",[JSON.stringify({registrationEnabled:true,mail:{host:'8.8.8.8',fromEmail:'fixture@example.invalid',port:465,secure:true}})]);
    const headers={origin:fixture.config.origin},requestCode=(address:string,purpose='password-reset')=>app.inject({method:'POST',url:'/api/auth/email-code',headers,payload:{email:address,purpose}});
    for(const address of ['unknown@example.invalid',disabledEmail])assert.equal((await requestCode(address)).statusCode,200);
    assert.equal(sent.length,0,'Unknown and disabled accounts must not create recovery emails');
    for(const address of [email,disabledEmail]){
      const duplicate=await requestCode(address,'register');assert.equal(duplicate.statusCode,409);assert.match(duplicate.json().msg,/邮箱已注册/);
    }
    assert.equal(sent.length,0,'Existing registration emails must return a clear error without sending a code');
    assert.equal((await requestCode(email)).statusCode,200);assert.equal(sent.length,1);assert.equal(sent[0].to,email);
    const code=sent[0].text.match(/\b\d{6}\b/)?.[0];assert.ok(code);
    const reset=(value:string,purposeEmail=email)=>app.inject({method:'POST',url:'/api/auth/password/reset',headers,payload:{email:purposeEmail,code:value,newPassword:'synthetic-new-password'}});
    assert.equal((await reset(code==='000000'?'111111':'000000')).statusCode,400);
    assert.equal((await reset(code,'unknown@example.invalid')).statusCode,400);
    const before=(await fixture.db.query('SELECT email_verified,password_hash FROM oaooao_users WHERE id=$1',[id])).rows[0];assert.equal(before.email_verified,false);assert.equal(before.password_hash,hash);
    const result=await reset(code);assert.equal(result.statusCode,200,result.body);
    const after=(await fixture.db.query('SELECT email_verified,password_hash FROM oaooao_users WHERE id=$1',[id])).rows[0];assert.equal(after.email_verified,true);assert.ok(await bcrypt.compare('synthetic-new-password',after.password_hash));
    assert.equal(Number((await fixture.db.query('SELECT count(*) FROM oaooao_sessions WHERE user_id=$1',[id])).rows[0].count),0);
    assert.equal((await reset(code)).statusCode,400,'Consumed codes cannot be replayed');
    assert.equal((await requestCode(email,'register')).statusCode,409);assert.equal(sent.length,1,'Existing accounts do not receive new registration codes');
    const en=await app.inject({method:'POST',url:'/api/auth/email-code',headers:{...headers,'accept-language':'en-US'},payload:{email,purpose:'register'}});assert.equal(en.statusCode,409);assert.match(en.json().msg,/already registered/);
  }finally{nodemailer.createTransport=original;await app.close();await fixture.cleanup();}
});
