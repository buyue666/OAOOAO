import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseReadiness,resolveCommercePolicy } from '../src/commerce.js';

const policy={status:'published',version:'synthetic-policy',refundPolicy:'Synthetic refunds',pointsExpiryPolicy:'Synthetic expiry',renewalPolicy:'Synthetic renewal',invoicePolicy:'Synthetic invoices',supportEmail:'support@example.invalid',supportUrl:''};
const legal={termsUrl:'/terms',termsVersion:'synthetic-terms',termsContent:'Synthetic terms',privacyUrl:'/privacy',privacyVersion:'synthetic-privacy',privacyContent:'Synthetic privacy'};

test('site policy determines readiness independently of payment availability',()=>{
  const config={operationMode:'commercial',site:{...legal,commercePolicy:policy}};
  assert.deepEqual(resolveCommercePolicy(config),policy);
  assert.deepEqual(purchaseReadiness(config.site,resolveCommercePolicy(config)??{}),{ready:true,missing:[]});
});
test('an explicit site draft or cleared policy cannot fall back to a published top-level copy',()=>{
  for(const nested of [{...policy,status:'draft'},null,{},[],false]){
    const config={site:{...legal,commercePolicy:nested},commercePolicy:policy};
    assert.equal(purchaseReadiness(config.site,resolveCommercePolicy(config)??{}).ready,false);
  }
});
test('top-level compatibility applies only when site.commercePolicy is absent',()=>{
  assert.deepEqual(resolveCommercePolicy({site:legal,commercePolicy:policy}),policy);
  const nested={...policy,version:'new-site-version'};
  assert.deepEqual(resolveCommercePolicy({site:{...legal,commercePolicy:nested},commercePolicy:policy}),nested);
  assert.equal(resolveCommercePolicy({site:legal}),null);
});
test('published booleans and malformed support objects never establish published readiness',()=>{
  assert.equal(purchaseReadiness(legal,{...policy,status:undefined,published:true}).ready,false);
  assert.equal(purchaseReadiness(legal,{...policy,supportEmail:undefined,supportUrl:undefined,support:{email:'support@example.invalid'}}).ready,false);
});
