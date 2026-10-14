import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { HTTPMethods } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';

const published={status:'published',version:'synthetic-editor-v1',refundPolicy:'Synthetic refund terms',pointsExpiryPolicy:'Synthetic expiry terms',renewalPolicy:'Synthetic renewal terms',invoicePolicy:'Synthetic invoice terms',supportEmail:'support@example.invalid',supportUrl:''};
const site={title:'Synthetic unchanged title',termsUrl:'/terms',termsVersion:'terms-v1',termsContent:'Synthetic unchanged terms',privacyUrl:'/privacy',privacyVersion:'privacy-v1',privacyContent:'Synthetic unchanged privacy'};

test('flat editor policy reads and writes the same canonical policy as purchases with granular permissions',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});await app.ready();
  t.after(async()=>{await app.close();await fixture.cleanup();});
  async function account(id:string,permissions:string[]){
    const token=randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)",[id,JSON.stringify(permissions)]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    return async(method:HTTPMethods,url:string,payload?:object)=>{const response=await app.inject({method,url,payload,headers:{origin:fixture.config.origin,cookie:`${fixture.config.sessionCookieName}=${token}`}});return {status:response.statusCode,body:response.json()};};
  }
  const commerce=await account('synthetic-policy-commerce',['commerce.manage']);
  const system=await account('synthetic-policy-system',['system.manage']);
  const billing=await account('synthetic-policy-billing',['billing.manage']);
  const both=await account('synthetic-policy-both',['system.manage','commerce.manage']);
  await fixture.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({operationMode:'commercial',site:{...site,commercePolicy:published},commercePolicy:{...published,version:'stale-flat'}})]);
  await fixture.db.query("INSERT INTO oaooao_payment_configs(provider_id,enabled,public_values) VALUES('manual',true,$1)",[JSON.stringify({instructions:'Synthetic only, no payment request'})]);

  async function consistent(expected:typeof published|null,ready:boolean){
    const settings=(await commerce('GET','/api/admin/settings')).body.settings;
    assert.deepEqual(settings.commercePolicy,expected);assert.deepEqual(settings.site.commercePolicy,expected);
    for(const [key,value]of Object.entries(site))assert.equal(settings.site[key],value);
    const catalog=(await app.inject({method:'GET',url:'/api/billing/products'})).json();
    assert.deepEqual(catalog.commercePolicy,expected);assert.equal(catalog.billing.purchaseReadiness.ready,ready);assert.equal(catalog.billing.rechargeEnabled,ready);
    const stored=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
    assert.deepEqual(stored.site.commercePolicy,expected);
  }

  await t.test('nested imported policy appears in the flat administrator editor alias',async()=>{await consistent(published,true);});
  await t.test('commerce-only editor saves a draft and publishes it without permission to alter the site',async()=>{
    const draft={...published,status:'draft',version:'synthetic-editor-v2',refundPolicy:'Changed synthetic refund terms'};
    const saved=await commerce('PATCH','/api/admin/settings',{commercePolicy:draft});assert.equal(saved.status,200);assert.deepEqual(saved.body.settings.commercePolicy,draft);await consistent(draft,false);
    const republished={...draft,status:'published'};
    assert.equal((await commerce('PATCH','/api/admin/settings',{commercePolicy:republished})).status,200);await consistent(republished,true);
    const stored=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
    assert.equal(Object.hasOwn(stored,'commercePolicy'),false,'Only nested canonical policy is persisted after editing');
  });
  await t.test('withdrawal through a flat partial draft and explicit clear disables purchases',async()=>{
    const current=(await commerce('GET','/api/admin/settings')).body.settings.commercePolicy;
    assert.equal((await commerce('PATCH','/api/admin/settings',{commercePolicy:{status:'draft'}})).status,200);await consistent({...current,status:'draft'},false);
    assert.equal((await commerce('PATCH','/api/admin/settings',{commercePolicy:{status:'published'}})).status,200);await consistent(current,true);
    assert.equal((await commerce('PATCH','/api/admin/settings',{commercePolicy:null})).status,200);await consistent(null,false);
  });
  await t.test('flat and nested policies in one request are rejected atomically even if equal',async()=>{
    for(const nested of [published,{...published,status:'draft'}]){
      assert.equal((await both('PATCH','/api/admin/settings',{commercePolicy:published,site:{commercePolicy:nested,title:'must not persist'}})).status,400);
      await consistent(null,false);
    }
  });
  await t.test('commerce permission cannot change unrelated site fields; billing and system permissions cannot publish policy',async()=>{
    assert.equal((await commerce('PATCH','/api/admin/settings',{commercePolicy:published,site:{title:'not allowed'}})).status,403);
    assert.equal((await commerce('PATCH','/api/admin/settings',{site:{commercePolicy:published}})).status,403);
    for(const actor of [system,billing])assert.equal((await actor('PATCH','/api/admin/settings',{commercePolicy:published})).status,403);
    assert.equal((await system('PATCH','/api/admin/settings',{site:{commercePolicy:published}})).status,403);
    await consistent(null,false);
    assert.equal((await system('PATCH','/api/admin/settings',{site:{title:site.title}})).status,200);await consistent(null,false);
    assert.equal((await both('PATCH','/api/admin/settings',{site:{commercePolicy:published}})).status,200);await consistent(published,true);
  });
  await t.test('malformed policies fail without altering canonical content',async()=>{
    for(const commercePolicy of [false,[],42,'published'])assert.equal((await commerce('PATCH','/api/admin/settings',{commercePolicy})).status,400);
    await consistent(published,true);
  });
});
