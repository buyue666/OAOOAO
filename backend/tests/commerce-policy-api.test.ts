import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { HTTPMethods } from 'fastify';
import { buildApp } from '../src/app.js';
import { ADMIN_PERMISSIONS,hashToken } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';

test('frontend site-policy settings save flows through session, catalog, and order creation',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});await app.ready();
  t.after(async()=>{await app.close();await fixture.cleanup();});
  const token=randomBytes(32).toString('base64url'),id='synthetic-policy-admin';
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)",[id,JSON.stringify(ADMIN_PERMISSIONS)]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
  async function api(method:HTTPMethods,url:string,payload?:object){const response=await app.inject({method,url,payload,headers:{origin:fixture.config.origin,cookie:`${fixture.config.sessionCookieName}=${token}`}});return {status:response.statusCode,body:response.json()};}
  const policy={status:'published',version:'synthetic-site-v1',refundPolicy:'Synthetic manual refunds',pointsExpiryPolicy:'Permanent credits do not expire',renewalPolicy:'Manual renewal',invoicePolicy:'Synthetic invoices',supportEmail:'support@example.invalid',supportUrl:''};
  const legal={termsUrl:'/terms',termsVersion:'terms-v1',termsContent:'Synthetic terms',privacyUrl:'/privacy',privacyVersion:'privacy-v1',privacyContent:'Synthetic privacy'};
  // The same shape as updateSiteSettings / updateAdminSettings, without a direct SQL settings fixture.
  const saved=await api('PATCH','/api/admin/settings',{operationMode:'commercial',site:{...legal,commercePolicy:policy}});
  assert.equal(saved.status,200,JSON.stringify(saved.body));assert.deepEqual(saved.body.settings.site.commercePolicy,policy);
  const read=await api('GET','/api/admin/settings');assert.deepEqual(read.body.settings.site.commercePolicy,policy);
  const session=await app.inject({method:'GET',url:'/api/auth/session'});assert.equal(session.statusCode,200);assert.deepEqual(session.json().settings.site.commercePolicy,policy);
  const catalog=(await app.inject({method:'GET',url:'/api/billing/products'})).json();
  assert.deepEqual(catalog.commercePolicy,policy);assert.deepEqual(catalog.billing.purchaseReadiness,{ready:true,missing:[]});
  assert.deepEqual(catalog.paymentProviders,[]);assert.equal(catalog.billing.rechargeEnabled,false);
  const createdProduct=await api('POST','/api/admin/billing/products',{name:'Synthetic policy credits',productKind:'points',amountCents:1000,pointsAmount:5,enabled:true});assert.equal(createdProduct.status,200);
  const orderInput={productId:createdProduct.body.product.id,provider:'manual'};
  assert.equal((await api('POST','/api/billing/orders',orderInput)).status,503,'Valid policy alone must not enable an unconfigured payment provider');
  assert.equal((await api('PATCH','/api/admin/billing/payment-config',{providerId:'manual',enabled:true,values:{instructions:'Synthetic only: independently verified receipt'}})).status,200);
  const available=(await app.inject({method:'GET',url:'/api/billing/products'})).json();assert.equal(available.billing.rechargeEnabled,true);
  const order=await api('POST','/api/billing/orders',orderInput);assert.equal(order.status,200,JSON.stringify(order.body));assert.equal(order.body.order.pricingSnapshot.policyVersion,policy.version);
  // Ambiguous dual-location writes are rejected before either policy is changed.
  const draft={...policy,status:'draft'};
  assert.equal((await api('PATCH','/api/admin/settings',{site:{commercePolicy:draft},commercePolicy:{...policy,version:'stale-top-level'}})).status,400);
  assert.deepEqual((await api('GET','/api/admin/settings')).body.settings.commercePolicy,policy);
  assert.equal((await api('PATCH','/api/admin/settings',{site:{commercePolicy:draft}})).status,200);
  const unpublished=(await app.inject({method:'GET',url:'/api/billing/products'})).json();assert.equal(unpublished.commercePolicy.status,'draft');assert.equal(unpublished.billing.purchaseReadiness.ready,false);assert.equal(unpublished.billing.rechargeEnabled,false);
  assert.equal((await api('POST','/api/billing/orders',orderInput)).status,409);
  // Partial settings saves retain legal text and publish the new site version consistently.
  const next={...policy,version:'synthetic-site-v2'};
  assert.equal((await api('PATCH','/api/admin/settings',{site:{commercePolicy:next}})).status,200);
  assert.equal((await api('GET','/api/admin/settings')).body.settings.site.termsContent,legal.termsContent);
  const nextOrder=await api('POST','/api/billing/orders',orderInput);assert.equal(nextOrder.status,200);assert.equal(nextOrder.body.order.pricingSnapshot.policyVersion,next.version);
  const clear=await api('PATCH','/api/admin/settings',{site:{commercePolicy:null}});assert.equal(clear.status,200);
  const cleared=(await app.inject({method:'GET',url:'/api/billing/products'})).json();assert.equal(cleared.commercePolicy,null);assert.equal(cleared.billing.purchaseReadiness.ready,false);
  assert.equal((await api('POST','/api/billing/orders',orderInput)).status,409);
});
