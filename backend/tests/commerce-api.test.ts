import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify, { type HTTPMethods } from 'fastify';
import cookie from '@fastify/cookie';
import { ADMIN_PERMISSIONS, createContext, hashToken } from '../src/core.js';
import { registerCommerce, recordReferral, runCommerceMaintenance, settleReferralRewards } from '../src/commerce.js';
import { adjustWallet, assignAdminPlan, getWallet, importWallet } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

test('isolated PostgreSQL commerce HTTP, financial state transitions and client envelopes',async t=>{
  const fixture=await createTestDatabase();const ctx=createContext(fixture.db,fixture.config);const app=Fastify();
  await app.register(cookie);await registerCommerce(app,ctx);
  app.setErrorHandler((error,_request,reply)=>{const err=error as Error&{statusCode?:number};reply.code(err.statusCode ?? 500).send({msg:err.message});});
  await app.ready();t.after(async()=>{await app.close();await fixture.cleanup();});
  let sequence=0;
  async function user(role='user',permissions:readonly string[]=[]){const id=`commerce-synthetic-${++sequence}`;const token=randomBytes(32).toString('base64url');await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,$2,$3,$4)',[id,'synthetic-hash-unused',role,JSON.stringify(permissions)]);await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);return {id,token};}
  const admin=await user('admin',ADMIN_PERMISSIONS);const reader=await user('admin',['billing.read']);const buyer=await user();const other=await user();
  async function api(method:HTTPMethods,url:string,payload?:object,actor=admin,headers:Record<string,string>={}){const response=await app.inject({method,url,payload,headers:{cookie:`${ctx.config.sessionCookieName}=${actor.token}`,...headers}});return {status:response.statusCode,body:response.json()};}
  async function product(input:Record<string,unknown>={}){const result=await api('POST','/api/admin/billing/products',{name:'Synthetic credit package',amountCents:1000,pointsAmount:10,enabled:true,...input});assert.equal(result.status,200,JSON.stringify(result.body));return result.body.product;}
  async function order(productId:string,actor=buyer,extra:Record<string,unknown>={}){const result=await api('POST','/api/billing/orders',{productId,quantity:1,provider:'manual',...extra},actor);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.order;}
  const policy={status:'published',version:'synthetic-1',refundPolicy:'Synthetic manual refund confirmation required',pointsExpiryPolicy:'Permanent balance does not expire; daily points expire at midnight UTC',renewalPolicy:'Manual renewal only',invoicePolicy:'Synthetic test only',supportEmail:'support@example.invalid'};
  const configuration={operationMode:'commercial',site:{commercePolicy:policy,termsUrl:'/terms',termsVersion:'v1',termsContent:'Synthetic terms',privacyUrl:'/privacy',privacyVersion:'v1',privacyContent:'Synthetic privacy'}};
  await t.test('public catalog is closed until commercial policy and payment readiness exist',async()=>{
    const response=await app.inject({method:'GET',url:'/api/billing/products'});assert.equal(response.statusCode,200);assert.equal(response.json().billing.rechargeEnabled,false);assert.deepEqual(response.json().paymentProviders,[]);
    const item=await product();const failed=await api('POST','/api/billing/orders',{productId:item.id,provider:'manual'},buyer);assert.equal(failed.status,409);
    await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[configuration]);
    assert.equal((await api('POST','/api/billing/orders',{productId:item.id,provider:'manual'},buyer)).status,503);
    const enabled=await api('PATCH','/api/admin/billing/payment-config',{providerId:'manual',enabled:true,values:{instructions:'Synthetic test: administrator must verify external receipt.'}});assert.equal(enabled.status,200);
    assert.equal((await app.inject({method:'GET',url:'/api/billing/products'})).json().billing.rechargeEnabled,true);
  });
  await t.test('authorization isolates financial records and granular administrator roles',async()=>{
    assert.equal((await app.inject({method:'GET',url:'/api/billing/orders'})).statusCode,401);
    assert.equal((await api('GET','/api/admin/billing/orders',undefined,buyer)).status,403);
    assert.equal((await api('GET','/api/admin/billing/orders',undefined,reader)).status,200);
    assert.equal((await api('POST','/api/admin/billing/products',{name:'Forbidden',amountCents:1},reader)).status,403);
    const item=await product();const created=await order(item.id);
    assert.equal((await api('GET',`/api/billing/orders/${created.id}`,undefined,other)).status,404);
    assert.equal((await api('POST',`/api/billing/orders/${created.id}/checkout`,{provider:'manual'},other)).status,404);
    assert.equal((await api('POST',`/api/billing/orders/${created.id}/cancel`,{},other)).status,404);
    const own=await api('GET','/api/billing/orders?page=1&pageSize=1',undefined,buyer);assert.equal(own.body.pageSize,1);assert.equal(own.body.orders.length,1);assert.ok(own.body.orders.every((row:any)=>row.userId===buyer.id));
  });
  await t.test('product validation and optimistic conflict protect concurrent editors',async()=>{
    assert.equal((await api('POST','/api/admin/billing/products',{name:'Invalid',amountCents:-1})).status,400);
    const item=await product();const updated=await api('PATCH',`/api/admin/billing/products/${item.id}`,{name:'First edit',expectedUpdatedAt:item.updatedAt});assert.equal(updated.status,200);
    assert.notEqual(updated.body.product.updatedAt,item.updatedAt);
    assert.equal((await api('PATCH',`/api/admin/billing/products/${item.id}`,{name:'Stale edit',expectedUpdatedAt:item.updatedAt})).status,409);
    const rows=(await api('GET','/api/admin/billing/products')).body.products;assert.equal(rows.find((entry:any)=>entry.id===item.id).name,'First edit');
  });
  await t.test('configured unsupported payment protocols stay unavailable and secrets are never returned',async()=>{
    const result=await api('PATCH','/api/admin/billing/payment-config',{providerId:'stripe',enabled:true,values:{secretKey:'synthetic-only-sensitive-value',webhookSecret:'synthetic-only-webhook'}});assert.equal(result.status,200);
    assert.ok(!JSON.stringify(result.body).includes('synthetic-only-sensitive-value'));
    const provider=result.body.paymentConfig.providers.find((entry:any)=>entry.id==='stripe');assert.equal(provider.enabled,true);assert.equal(provider.ready,false);assert.equal(provider.fields[0].configured,true);assert.equal(provider.fields[0].value,undefined);
    const persisted=(await ctx.db.query("SELECT encrypted_secrets FROM oaooao_payment_configs WHERE provider_id='stripe'")).rows[0];assert.ok(!persisted.encrypted_secrets.includes('synthetic-only-sensitive-value'));
    await api('PATCH','/api/admin/billing/payment-config',{providerId:'stripe',enabled:true,values:{secretKey:''}});
    assert.equal((await api('GET','/api/admin/billing/payment-config')).body.paymentConfig.providers.find((entry:any)=>entry.id==='stripe').fields[0].configured,true);
    const item=await product();assert.equal((await api('POST','/api/billing/orders',{productId:item.id,provider:'stripe'},buyer)).status,503);
    assert.equal((await app.inject({method:'POST',url:'/api/billing/webhooks/stripe',payload:{paid:true}})).statusCode,404);
  });
  await t.test('create retries produce one order and checkout never settles it',async()=>{
    const actor=await user();const item=await product();
    const calls=await Promise.all(Array.from({length:12},()=>api('POST','/api/billing/orders',{productId:item.id,provider:'manual'},actor,{'idempotency-key':'synthetic-order-retry'})));
    assert.ok(calls.every(call=>call.status===200),JSON.stringify(calls));assert.equal(new Set(calls.map(call=>call.body.order.id)).size,1);
    const created=calls[0]!.body.order;const checkout=await api('POST',`/api/billing/orders/${created.id}/checkout`,{provider:'manual'},actor);
    assert.equal(checkout.body.data.checkout.kind,'manual');assert.equal(checkout.body.data.checkout.orderId,created.id);assert.equal((await getWallet(ctx,actor.id)).pointsBalance,0);
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_payments WHERE order_id=$1',[created.id])).rows[0].count,'0');
    assert.equal((await api('POST','/api/billing/orders',{productId:item.id,provider:'manual',quantity:2},actor,{'idempotency-key':'synthetic-order-retry'})).status,409);
  });
  await t.test('repeated confirmed manual completion credits once and cannot be canceled',async()=>{
    const actor=await user();const created=await order((await product({pointsAmount:12.3456})).id,actor);
    const calls=await Promise.all(Array.from({length:12},()=>api('POST',`/api/admin/billing/orders/${created.id}/complete`,{reason:'Synthetic external receipt verified'})));
    assert.ok(calls.every(call=>call.status===200),JSON.stringify(calls));assert.equal((await getWallet(ctx,actor.id)).exact.pointsBalance,'12.3456');
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_payments WHERE order_id=$1',[created.id])).rows[0].count,'1');
    assert.equal((await api('POST',`/api/billing/orders/${created.id}/cancel`,{},actor)).status,409);
  });
  await t.test('completion/cancellation race has exactly one economic outcome',async()=>{
    const actor=await user();const created=await order((await product()).id,actor);
    const results=await Promise.all([api('POST',`/api/admin/billing/orders/${created.id}/complete`,{reason:'Synthetic receipt verified'}),api('POST',`/api/billing/orders/${created.id}/cancel`,{reason:'Synthetic cancellation'},actor)]);
    assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    const stored=(await api('GET',`/api/billing/orders/${created.id}`,undefined,actor)).body.order;
    assert.equal((await getWallet(ctx,actor.id)).pointsBalance,stored.status==='paid'?10:0);
    assert.ok(['paid','canceled'].includes(stored.status));
  });
  await t.test('cash refund needs explicit attestation; confirmed retries revoke credit once',async()=>{
    const actor=await user();const created=await order((await product()).id,actor);await api('POST',`/api/admin/billing/orders/${created.id}/complete`,{reason:'Synthetic receipt'});
    assert.equal((await api('POST',`/api/admin/billing/orders/${created.id}/refund`,{reason:'User requested refund'})).status,409);
    assert.equal((await getWallet(ctx,actor.id)).pointsBalance,10);
    assert.equal((await api('POST',`/api/admin/billing/orders/${created.id}/refund`,{reason:'Cannot skip preparation',confirmExternalRefund:true})).status,409);
    const prepared=await api('POST',`/api/admin/billing/orders/${created.id}/refund/prepare`,{reason:'Synthetic refund preparation'});assert.equal(prepared.status,200);
    const results=await Promise.all(Array.from({length:10},()=>api('POST',`/api/admin/billing/orders/${created.id}/refund`,{reason:'Synthetic external cash refund verified',confirmExternalRefund:true,reservationId:prepared.body.reservation.id})));
    assert.ok(results.every(result=>result.status===200),JSON.stringify(results));assert.equal((await getWallet(ctx,actor.id)).pointsBalance,0);
    assert.equal((await ctx.db.query('SELECT status FROM oaooao_payments WHERE order_id=$1',[created.id])).rows[0].status,'refunded');
    assert.equal((await ctx.db.query("SELECT count(*) FROM oaooao_wallet_operations WHERE user_id=$1 AND metadata->>'kind'='order_refund_reserve'",[actor.id])).rows[0].count,'1');
  });
  await t.test('spent purchased credits block refund without altering paid state',async()=>{
    const actor=await user();const created=await order((await product()).id,actor);await api('POST',`/api/admin/billing/orders/${created.id}/complete`,{reason:'Synthetic receipt'});await adjustWallet(ctx,actor.id,`${actor.id}:consume`,-8,{kind:'generation'});
    assert.equal((await api('POST',`/api/admin/billing/orders/${created.id}/refund/prepare`,{reason:'Synthetic refund preflight'})).status,402);
    assert.equal((await getWallet(ctx,actor.id)).pointsBalance,2);assert.equal((await ctx.db.query('SELECT status FROM oaooao_orders WHERE id=$1',[created.id])).rows[0].status,'paid');
    assert.equal((await ctx.db.query('SELECT status FROM oaooao_payments WHERE order_id=$1',[created.id])).rows[0].status,'succeeded');
  });
  await t.test('promotion pricing, coupon caps, per-user grants and reservations are atomic',async()=>{
    const actor=await user();const item=await product();const campaign=await api('POST','/api/admin/billing/promotions',{name:'Synthetic campaign',enabled:true,products:[{productId:item.id,promotionalAmountCents:800}]});assert.equal(campaign.status,200);
    const catalog=(await app.inject({method:'GET',url:'/api/billing/products'})).json();assert.equal(catalog.products.find((entry:any)=>entry.id===item.id).pricing.saleUnitAmountCents,800);
    const template=await api('POST','/api/admin/billing/coupon-templates',{name:'Synthetic 25% off',discountType:'percentage',discountValue:25,maxDiscountCents:150,totalQuantity:1,perUserLimit:1,enabled:true,productIds:[item.id]});assert.equal(template.status,200);const templateId=template.body.data.template.id;
    const grants=await Promise.all(Array.from({length:8},()=>api('POST','/api/admin/billing/coupons/grant',{templateId,userId:actor.id})));
    assert.equal(grants.filter(call=>call.status===200).length,1);assert.equal(grants.filter(call=>call.status===409).length,7);
    const coupon=grants.find(call=>call.status===200)!.body.data.coupons[0];
    const created=await order(item.id,actor,{couponId:coupon.id});assert.equal(created.listAmountCents,1000);assert.equal(created.promotionDiscountCents,200);assert.equal(created.couponDiscountCents,150);assert.equal(created.amountCents,650);
    assert.equal((await api('POST','/api/billing/orders',{productId:item.id,provider:'manual',couponId:coupon.id},actor)).status,409);
    assert.equal((await api('POST','/api/billing/orders',{productId:item.id,provider:'manual',couponId:coupon.id},other)).status,409);
    await api('POST',`/api/billing/orders/${created.id}/cancel`,{},actor);const retry=await order(item.id,actor,{couponId:coupon.id});assert.equal(retry.amountCents,650);
    const changed=await api('PATCH',`/api/admin/billing/promotions/${campaign.body.data.campaign.id}`,{label:'Updated label'});assert.equal(changed.body.data.campaign.label,'Updated label');
    assert.equal((await api('DELETE',`/api/admin/billing/promotions/${campaign.body.data.campaign.id}`)).status,200);
  });
  await t.test('plan settlement grants today once, renewal starts after existing term and refund revokes daily balance',async()=>{
    await ctx.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({entitlements:{enabled:true,plans:[{id:'synthetic-paid-plan',enabled:true,dailyPoints:5}]}})]);
    const actor=await user();const item=await product({productKind:'plan',planId:'synthetic-paid-plan',dailyPoints:5,periodDays:30,pointsAmount:2});const first=await order(item.id,actor);
    assert.equal((await api('POST',`/api/admin/billing/orders/${first.id}/complete`,{reason:'Synthetic receipt'})).status,200);
    assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,5);await adjustWallet(ctx,actor.id,`${actor.id}:daily-consume`,-2,{kind:'generation'});
    const second=await order(item.id,actor);await api('POST',`/api/admin/billing/orders/${second.id}/complete`,{reason:'Synthetic renewal'});assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,3);
    const grants=(await ctx.db.query('SELECT * FROM oaooao_plan_grants WHERE user_id=$1 ORDER BY starts_at',[actor.id])).rows;assert.equal(grants.length,2);assert.equal(grants[0].expires_at.getTime(),grants[1].starts_at.getTime());
    const reserved=await api('POST',`/api/admin/billing/orders/${first.id}/refund/prepare`,{reason:'Synthetic refund preparation'});
    assert.equal((await api('POST',`/api/admin/billing/orders/${first.id}/refund`,{reason:'Synthetic external cash refund verified',confirmExternalRefund:true,reservationId:reserved.body.reservation.id})).status,200);
    assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,0);
  });
  await t.test('administrative plan changes never regrant spent daily credits or activate imported plan labels',async()=>{
    const actor=await user();await ctx.db.query('UPDATE oaooao_users SET plan_id=$2 WHERE id=$1',[actor.id,'converted-legacy-plan']);assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,0);
    await ctx.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({entitlements:{enabled:true,plans:[{id:'synthetic-admin-plan',enabled:true,dailyPoints:7}]}})]);
    await assignAdminPlan(ctx,actor.id,`${actor.id}:assign`,'synthetic-admin-plan');assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,7);await adjustWallet(ctx,actor.id,`${actor.id}:spend`,-2);
    await assignAdminPlan(ctx,actor.id,`${actor.id}:repeat`,'synthetic-admin-plan');assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,5);
    await assignAdminPlan(ctx,actor.id,`${actor.id}:revoke`,null);assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,0);
    await assignAdminPlan(ctx,actor.id,`${actor.id}:reassign`,'synthetic-admin-plan');assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,5);
    await adjustWallet(ctx,actor.id,`${actor.id}:spend-rest`,-5);await assignAdminPlan(ctx,actor.id,`${actor.id}:revoke-again`,null);
    await assignAdminPlan(ctx,actor.id,`${actor.id}:reassign-again`,'synthetic-admin-plan');assert.equal((await getWallet(ctx,actor.id)).dailyPointsBalance,0);
  });
  await t.test('referral rewards survive cooling-off, settle once and revoke with confirmed order refund',async()=>{
    const inviter=await user();const invitee=await user();
    const updated=await api('PATCH','/api/admin/referrals',{enabled:true,inviterPoints:3,inviteePoints:2,coolingOffDays:0,minimumPaidCents:500});assert.equal(updated.status,200);
    const center=await api('GET','/api/referrals',undefined,inviter);assert.ok(center.body.data.code);assert.equal(center.body.data.referralsTotal,0);
    const invitation=new URL(center.body.data.link);assert.equal(invitation.pathname,'/register');assert.equal(invitation.searchParams.get('ref'),center.body.data.code);assert.equal(invitation.searchParams.has('referralCode'),false);
    await recordReferral(ctx,invitee.id,center.body.data.code);const created=await order((await product()).id,invitee);
    await api('POST',`/api/admin/billing/orders/${created.id}/complete`,{reason:'Synthetic referral purchase'});
    assert.equal((await getWallet(ctx,inviter.id)).pointsBalance,0);
    await Promise.all(Array.from({length:6},()=>settleReferralRewards(ctx)));
    assert.equal((await getWallet(ctx,inviter.id)).pointsBalance,3);assert.equal((await getWallet(ctx,invitee.id)).pointsBalance,12);
    assert.equal((await api('GET','/api/referrals',undefined,inviter)).body.data.stats.settled,1);
    const reserved=await api('POST',`/api/admin/billing/orders/${created.id}/refund/prepare`,{reason:'Synthetic referral refund preparation'});
    const refunded=await api('POST',`/api/admin/billing/orders/${created.id}/refund`,{reason:'Synthetic external refund verified',confirmExternalRefund:true,reservationId:reserved.body.reservation.id});assert.equal(refunded.status,200,JSON.stringify(refunded.body));
    assert.equal((await getWallet(ctx,inviter.id)).pointsBalance,0);assert.equal((await getWallet(ctx,invitee.id)).pointsBalance,0);
    assert.equal((await api('GET','/api/admin/referrals/rewards?page=1&pageSize=1')).body.data.total,2);
  });
  await t.test('cooling-off prevents premature referral settlement',async()=>{
    const inviter=await user();const invitee=await user();await api('PATCH','/api/admin/referrals',{coolingOffDays:7});
    const code=(await api('GET','/api/referrals',undefined,inviter)).body.data.code;await recordReferral(ctx,invitee.id,code);
    const created=await order((await product()).id,invitee);await api('POST',`/api/admin/billing/orders/${created.id}/complete`,{reason:'Synthetic purchase'});await settleReferralRewards(ctx);
    assert.equal((await getWallet(ctx,inviter.id)).pointsBalance,0);assert.equal((await api('GET','/api/referrals',undefined,inviter)).body.data.stats.pending,1);
    assert.equal((await api('PATCH','/api/admin/referrals',{autoFreezeRisk:true})).status,503);
  });
  await t.test('ledger preserves the frontend signed amounts, categories and pagination without import duplicates',async()=>{
    const actor=await user();await importWallet(ctx,actor.id,'synthetic-ledger-transfer',{permanentPointsBalance:'10.0001'});
    await adjustWallet(ctx,actor.id,`${actor.id}:consume`,'-0.0001',{kind:'generation',model:'synthetic-model'});await adjustWallet(ctx,actor.id,`${actor.id}:refund`,'0.0001',{kind:'generation_refund',refundOf:`${actor.id}:consume`});
    const ledger=await api('GET','/api/points?page=1&pageSize=1',undefined,actor);assert.equal(ledger.body.total,2);assert.equal(ledger.body.records.length,1);assert.equal(ledger.body.records[0].type,'refund');assert.equal(ledger.body.records[0].amount,0.0001);
    const debit=(await api('GET','/api/points?direction=debit',undefined,actor)).body;assert.equal(debit.total,1);assert.equal(debit.records[0].type,'consume');assert.equal(debit.records[0].amount,-0.0001);assert.equal(debit.records[0].model,'synthetic-model');assert.equal(debit.records[0].balanceAfter,10);
    assert.equal((await api('GET','/api/points?direction=bogus',undefined,actor)).status,400);
  });
  await t.test('finance and audit reconcile confirmed operations',async()=>{
    const summary=(await api('GET','/api/admin/billing/summary',undefined,reader)).body.summary;
    assert.deepEqual(summary.reconciliation,{paidOrdersWithoutSucceededPayment:0,succeededPaymentsWithoutPaidOrder:0,amountMismatchPayments:0});
    assert.ok(summary.orders.total>0);assert.ok(summary.orders.paidAmountCents>0);assert.ok(summary.payments.refunded>0);assert.ok(Array.isArray(summary.providers));
    const audits=(await ctx.db.query("SELECT action,metadata FROM oaooao_audit_logs WHERE action LIKE 'billing.order.confirm_external_%'")).rows;assert.ok(audits.length>0);assert.ok(audits.every(row=>row.metadata.reason));
  });
  await t.test('expired orders cannot settle and maintenance releases their reserved coupons',async()=>{
    const actor=await user();const item=await product();const template=(await api('POST','/api/admin/billing/coupon-templates',{name:'Synthetic expiry coupon',discountType:'fixed',discountValue:100,enabled:true})).body.data.template;
    const coupon=(await api('POST','/api/admin/billing/coupons/grant',{templateId:template.id,userId:actor.id})).body.data.coupons[0];const created=await order(item.id,actor,{couponId:coupon.id});
    await ctx.db.query("UPDATE oaooao_orders SET expires_at=now()-interval '1 minute' WHERE id=$1",[created.id]);
    assert.equal((await api('POST',`/api/admin/billing/orders/${created.id}/complete`,{reason:'Synthetic late receipt'})).status,409);
    assert.equal((await api('POST',`/api/billing/orders/${created.id}/checkout`,{provider:'manual'},actor)).status,409);
    await runCommerceMaintenance(ctx);assert.equal((await ctx.db.query('SELECT status FROM oaooao_orders WHERE id=$1',[created.id])).rows[0].status,'closed');
    const retry=await order(item.id,actor,{couponId:coupon.id});assert.equal(retry.couponDiscountCents,100);
  });
  await t.test('disabled or undefined entitlement plans cannot be enabled or purchased',async()=>{
    await ctx.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({entitlements:{enabled:false,plans:[{id:'synthetic-inactive-plan',enabled:true,dailyPoints:5}]}})]);
    const input={name:'Synthetic unavailable plan',productKind:'plan',planId:'synthetic-inactive-plan',periodDays:30,dailyPoints:5,pointsAmount:0,amountCents:100,enabled:true};
    assert.equal((await api('POST','/api/admin/billing/products',input)).status,503);
    const draft=(await api('POST','/api/admin/billing/products',{...input,enabled:false})).body.product;
    // Imported historical flags are retained; purchase checks cannot rely only on product.enabled.
    await ctx.db.query('UPDATE oaooao_products SET enabled=true WHERE id=$1',[draft.id]);
    assert.equal((await api('POST','/api/billing/orders',{productId:draft.id,provider:'manual'},buyer)).status,503);
    await ctx.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({entitlements:{enabled:true,plans:[]}})]);
    assert.equal((await api('POST','/api/billing/orders',{productId:draft.id,provider:'manual'},buyer)).status,503);
    assert.equal((await api('POST','/api/admin/billing/products',{name:'Synthetic permanent credits',amountCents:100,pointsAmount:1,enabled:true})).status,200);
  });
});
