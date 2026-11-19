import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {ADMIN_PERMISSIONS,hashToken} from '../src/core.js';
import {getWallet,adjustWallet,assignAdminPlan,getPlanSummary} from '../src/wallet.js';
import {balanceAction,balanceCheckout,balanceConfig,balanceSign,balanceCallbackFields,verifyBalanceCallback,BALANCE_NOTIFY_PATH} from '../src/payment-balance.js';
import {createTestDatabase} from './core-helpers.js';

const config={gatewayUrl:'https://gateway.example/',merchantId:'luna-art',secret:'test-secret-that-is-at-least-32-characters',nonce:'0123456789abcdef'};

test('plan identifier renames atomically preserve member entitlements and product references',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});
  await app.ready();t.after(async()=>{await app.close();await fixture.cleanup();});
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)",[id,JSON.stringify(ADMIN_PERMISSIONS)]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
  const headers={cookie:`${fixture.config.sessionCookieName}=${token}`,origin:fixture.config.origin};
  const request=(method:'GET'|'POST'|'PATCH',url:string,payload?:object)=>app.inject({method,url,payload,headers});
  const original={id:'old-plan',name:'Synthetic plan',enabled:true,dailyPoints:0,limits:{},allowedModelIds:['synthetic-model']};
  assert.equal((await request('PATCH','/api/admin/settings',{entitlements:{enabled:true,defaultPlanId:original.id,plans:[original]},checkIn:{enabled:true,rewardPoints:1,validityDays:0,planRewards:[{planId:original.id,rewardPoints:2,validityDays:0}]}})).statusCode,200);
  await assignAdminPlan(app.ctx,id,'synthetic-assignment',original.id);
  const created=await request('POST','/api/admin/billing/products',{name:'Synthetic plan',productKind:'plan',planId:original.id,amountCents:100,pointsAmount:50,periodDays:30,enabled:true});
  assert.equal(created.statusCode,200,created.body);
  const grant=randomUUID();await fixture.db.query("INSERT INTO oaooao_plan_grants(id,user_id,plan_id,daily_points,starts_at,expires_at) VALUES($1,$2,$3,0,now(),now()+interval '30 days')",[grant,id,original.id]);
  const before=(await fixture.db.query('SELECT expires_at FROM oaooao_plan_grants WHERE id=$1',[grant])).rows[0].expires_at;
  const renamed={...original,id:'new-plan'};
  const result=await request('PATCH','/api/admin/settings',{entitlements:{enabled:true,defaultPlanId:'new-plan',plans:[renamed]},entitlementPlanRenames:[{from:'old-plan',to:'new-plan'}]});
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().settings.entitlements.defaultPlanId,'new-plan');
  assert.equal(result.json().settings.checkIn.planRewards[0].planId,'new-plan');
  assert.equal(result.json().settings.entitlementPlanRenames,undefined);
  assert.equal((await getPlanSummary(app.ctx,id)).planId,'new-plan');
  assert.equal((await request('GET','/api/admin/billing/products')).json().products[0].planId,'new-plan');
  assert.equal((await fixture.db.query('SELECT plan_id FROM oaooao_plan_grants WHERE id=$1',[grant])).rows[0].plan_id,'new-plan');
  assert.deepEqual((await fixture.db.query('SELECT expires_at FROM oaooao_plan_grants WHERE id=$1',[grant])).rows[0].expires_at,before);
  const duplicate=await request('PATCH','/api/admin/settings',{entitlements:{enabled:true,defaultPlanId:'new-plan',plans:[renamed]},entitlementPlanRenames:[{from:'new-plan',to:'new-plan'}]});
  assert.equal(duplicate.statusCode,400);
  assert.equal((await getPlanSummary(app.ctx,id)).planId,'new-plan');
  assert.equal((await getWallet(app.ctx,id)).pointsBalance,0);
});

test('administrators can save plan products before enabling entitlements, while purchases remain closed',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});
  await app.ready();t.after(async()=>{await app.close();await fixture.cleanup();});
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)",[id,JSON.stringify(ADMIN_PERMISSIONS)]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
  const headers={cookie:`${fixture.config.sessionCookieName}=${token}`,origin:fixture.config.origin};
  const request=(method:'GET'|'POST'|'PATCH',url:string,payload?:object)=>app.inject({method,url,payload,headers});
  const policy={status:'published',version:'synthetic-v1',refundPolicy:'Synthetic',pointsExpiryPolicy:'Permanent',renewalPolicy:'Manual',invoicePolicy:'Synthetic',supportEmail:'support@example.com'};
  await fixture.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{operationMode:'commercial',site:{commercePolicy:policy,termsUrl:'/terms',termsVersion:'v1',termsContent:'Synthetic',privacyUrl:'/privacy',privacyVersion:'v1',privacyContent:'Synthetic'},entitlements:{enabled:false,plans:[{id:'synthetic-plan',enabled:false}]}}]);
  const {nonce,...fields}=config;
  assert.equal((await request('PATCH','/api/admin/billing/payment-config',{providerId:'ciyuan_balance',enabled:true,values:fields})).statusCode,200);
  const created=await request('POST','/api/admin/billing/products',{name:'Synthetic plan',productKind:'plan',planId:'synthetic-plan',amountCents:990,pointsAmount:500,periodDays:30,enabled:true});
  assert.equal(created.statusCode,200,created.body);const product=created.json().product;
  const saved=await request('PATCH',`/api/admin/billing/products/${product.id}`,{amountCents:880,expectedUpdatedAt:product.updatedAt});
  assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().product.amountCents,880);
  assert.ok((await request('GET','/api/admin/billing/products')).json().products.some((p:any)=>p.id===product.id));
  assert.ok(!(await request('GET','/api/billing/products')).json().products.some((p:any)=>p.id===product.id));
  const rejected=await request('POST','/api/billing/orders',{productId:product.id,provider:'ciyuan_balance'});assert.equal(rejected.statusCode,503);
  assert.match(rejected.body,/套餐权益.*未开启/);
  assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_orders')).rows[0].count,'0');
  await fixture.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{entitlements}',$1::jsonb) WHERE id='global'",[JSON.stringify({enabled:true,plans:[{id:'synthetic-plan',enabled:true}]})]);
  assert.ok((await request('GET','/api/billing/products')).json().products.some((p:any)=>p.id===product.id));
  assert.equal((await request('POST','/api/billing/orders',{productId:product.id,provider:'ciyuan_balance'})).statusCode,200);
  assert.equal((await getWallet(app.ctx,id)).pointsBalance,0);
});
test('New API protocol vectors, amount limits and authoritative action receipts',async()=>{
  const order={id:'order-id',order_no:'LUNA202608240001',subject:'Luna Art points',amount_cents:1200,currency:'CNY',expires_at:new Date(1787529600000)};
  assert.equal(new URL(balanceCheckout(config,order).url).searchParams.get('signature'),'37d6da1c7c7dd249288145b3a8eb9407214b606c12facb466857a7d938120d0c');
  for(const amount_cents of [0,-1,1.5,10000001,Number.MAX_SAFE_INTEGER])assert.throws(()=>balanceCheckout(config,{...order,amount_cents}));
  assert.throws(()=>balanceConfig({...config,merchantId:'other\nmerchant'},config));
  assert.throws(()=>balanceConfig({...config,gatewayUrl:'https://user:password@gateway.example/'},config));
  const body={event_id:'ciyuan_balance:CYB1:paid',event_type:'payment.succeeded',merchant_id:'luna-art',order_id:'order-id',order_no:'order-no',transaction_id:'CYB1',amount_cents:1200,currency:'CNY',status:'succeeded',paid_at:'2026-08-24T00:00:00Z'};
  const signature=balanceSign(config.secret,balanceCallbackFields(body));
  assert.equal(signature,'b0255d24718072e2a0b51183fa6ea2c8221f68e21004da67bf72fcaab07841c2');
  assert.equal(verifyBalanceCallback(config,body,signature).amount_cents,1200);
  assert.throws(()=>verifyBalanceCallback(config,{...body,amount_cents:1201},signature));
  for(const status of ['paid','refunded']){
    const result=await balanceAction(config,'query',order,'',async(_url,input)=>{
      const data=JSON.parse(input!.body as string);assert.equal(data.merchant_id,config.merchantId);
      assert.equal(data.signature,balanceSign(config.secret,['v1','query',config.merchantId,order.order_no,'',0,'',data.timestamp,data.nonce]));
      return new Response(JSON.stringify({success:true,data:{merchant_id:config.merchantId,order_id:order.id,order_no:order.order_no,transaction_id:'CYB1',amount_cents:1200,currency:'CNY',status}}),{status:200});
    });assert.equal(result?.status,status);
  }
  await assert.rejects(balanceAction(config,'refund',order,'CYB1',async()=>new Response(JSON.stringify({success:true,data:{merchant_id:config.merchantId,order_id:order.id,order_no:order.order_no,transaction_id:'CYB1',amount_cents:1200,currency:'CNY',status:'paid'}}),{status:200})));
  await assert.rejects(balanceAction(config,'query',order,'',async()=>new Response(JSON.stringify({success:true,data:{merchant_id:'other',order_id:order.id,order_no:order.order_no,transaction_id:'CYB1',amount_cents:1200,currency:'CNY',status:'paid'}}),{status:200})));
});

test('isolated New API orders enforce identity, signed settlement, retry and refund safety',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config}),ctx=app.ctx;
  await app.ready();t.after(async()=>{await app.close();await fixture.cleanup();});
  const actors=await Promise.all(['admin','buyer','other'].map(async(role)=>{
    const id=randomUUID(),token=randomBytes(32).toString('base64url');
    await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,\'synthetic-unused\',$2,$3)',[id,role==='admin'?'admin':'user',JSON.stringify(role==='admin'?ADMIN_PERMISSIONS:[])]);
    await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    return {id,headers:{cookie:`${ctx.config.sessionCookieName}=${token}`,origin:ctx.config.origin}};
  }));const [admin,buyer,other]=actors;
  const api=(method:'GET'|'POST'|'PATCH',url:string,payload?:object,actor=admin)=>app.inject({method,url,payload,headers:actor.headers});
  const policy={status:'published',version:'synthetic-v1',refundPolicy:'Synthetic',pointsExpiryPolicy:'Permanent',renewalPolicy:'Manual',invoicePolicy:'Synthetic',supportEmail:'support@example.com'};
  await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{operationMode:'commercial',site:{commercePolicy:policy,termsUrl:'/terms',termsVersion:'v1',termsContent:'Synthetic',privacyUrl:'/privacy',privacyVersion:'v1',privacyContent:'Synthetic'}}]);
  const product=(await api('POST','/api/admin/billing/products',{name:'Synthetic points',amountCents:1200,pointsAmount:123.45,enabled:true})).json().product;
  assert.equal((await api('POST','/api/billing/orders',{productId:product.id,provider:'ciyuan_balance'},buyer)).statusCode,503);
  const saved=await api('PATCH','/api/admin/billing/payment-config',{providerId:'ciyuan_balance',enabled:true,values:config});
  // The nonce is never an administrative configuration field.
  assert.equal(saved.statusCode,400);
  const {nonce,...fields}=config;
  const ready=await api('PATCH','/api/admin/billing/payment-config',{providerId:'ciyuan_balance',enabled:true,values:fields});
  assert.equal(ready.statusCode,200,ready.body);assert.ok(!ready.body.includes(config.secret));
  assert.ok(!ready.json().paymentConfig.providers.some((p:any)=>p.id==='manual'));
  assert.equal((await api('PATCH','/api/admin/billing/payment-config',{providerId:'manual',enabled:true,values:{instructions:'Retired'}})).statusCode,400);
  assert.equal((await api('POST','/api/billing/orders',{productId:product.id,provider:'manual'},buyer)).statusCode,503);
  assert.equal((await api('PATCH','/api/admin/billing/payment-config',{providerId:'ciyuan_balance',enabled:false,values:{}},buyer)).statusCode,403);
  const created=await api('POST','/api/billing/orders',{productId:product.id,provider:'ciyuan_balance'},buyer);assert.equal(created.statusCode,200,created.body);
  const order=created.json().order;
  assert.equal((await api('POST',`/api/billing/orders/${order.id}/checkout`,{},other)).statusCode,404);
  const checkouts=await Promise.all([api('POST',`/api/billing/orders/${order.id}/checkout`,{},buyer),api('POST',`/api/billing/orders/${order.id}/checkout`,{},buyer)]);
  assert.ok(checkouts.every(r=>r.statusCode===200));assert.equal(checkouts[0].json().checkout.url,checkouts[1].json().checkout.url);
  assert.equal((await getWallet(ctx,buyer.id)).pointsBalance,0);
  assert.equal((await api('POST',`/api/billing/orders/${order.id}/cancel`,{},buyer)).statusCode,409);
  const receipt={event_id:'ciyuan_balance:synthetic-tx:paid',event_type:'payment.succeeded',merchant_id:config.merchantId,order_id:order.id,order_no:order.orderNo,transaction_id:'synthetic-tx',amount_cents:1200,currency:'CNY',status:'succeeded',paid_at:new Date().toISOString()};
  const notify=(data:Record<string,unknown>,signature=balanceSign(config.secret,balanceCallbackFields(data)))=>app.inject({method:'POST',url:BALANCE_NOTIFY_PATH,headers:{'x-ciyuan-signature':signature},payload:data});
  assert.equal((await notify(receipt,'0'.repeat(64))).statusCode,400);
  for(const patch of [{amount_cents:1201},{currency:'USD'},{order_no:'wrong'},{paid_at:new Date(Date.now()+3600000).toISOString()}])assert.ok((await notify({...receipt,...patch})).statusCode>=400);
  assert.equal((await getWallet(ctx,buyer.id)).pointsBalance,0);
  // A disabled provider and rotated current credential still accept the original signed checkout receipt.
  await api('PATCH','/api/admin/billing/payment-config',{providerId:'ciyuan_balance',enabled:false,values:{secret:'rotated-synthetic-secret-with-at-least-32-characters'}});
  const notifications=await Promise.all(Array.from({length:8},()=>notify(receipt)));
  assert.ok(notifications.every(r=>r.statusCode===200),notifications.map(r=>r.body).join('\n'));
  assert.equal((await getWallet(ctx,buyer.id)).exact.pointsBalance,'123.4500');assert.equal((await getWallet(ctx,other.id)).pointsBalance,0);
  assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_payments WHERE order_id=$1',[order.id])).rows[0].count,'1');
  assert.equal((await notify({...receipt,transaction_id:'different-tx'})).statusCode,409);
  assert.equal((await api('POST',`/api/admin/billing/orders/${order.id}/complete`,{reason:'Must not bypass provider'})).statusCode,200); // Already paid is idempotent, never an extra credit.
  await adjustWallet(ctx,buyer.id,'synthetic-spend',-120,{kind:'generation'});
  assert.equal((await api('POST',`/api/admin/billing/orders/${order.id}/refund/prepare`,{reason:'Synthetic'})).statusCode,402);
  await adjustWallet(ctx,buyer.id,'synthetic-restore',120);
  const prepared=await api('POST',`/api/admin/billing/orders/${order.id}/refund/prepare`,{reason:'Synthetic refund'});assert.equal(prepared.statusCode,200,prepared.body);
  const reservationId=prepared.json().reservation.id;
  const attempt=(await ctx.db.query('SELECT encrypted_config FROM oaooao_payment_attempts WHERE order_id=$1',[order.id])).rows[0];const snapshot=JSON.parse(ctx.decrypt(attempt.encrypted_config));
  // Deterministically simulate an unavailable provider without sending any financial request.
  await ctx.db.query('UPDATE oaooao_payment_attempts SET encrypted_config=$2 WHERE order_id=$1',[order.id,ctx.encrypt(JSON.stringify({...snapshot,gatewayUrl:'https://127.0.0.1/'}))]);
  assert.ok((await api('POST',`/api/admin/billing/orders/${order.id}/refund`,{reason:'Synthetic refund',reservationId,confirmExternalRefund:true})).statusCode>=400);
  assert.equal((await api('POST',`/api/admin/billing/orders/${order.id}/refund/cancel`,{reason:'Cannot release uncertain refund',reservationId,confirmExternalRefundNotSent:true})).statusCode,409);
  assert.equal((await ctx.db.query('SELECT status FROM oaooao_refund_reservations WHERE id=$1',[reservationId])).rows[0].status,'prepared');
  assert.equal((await ctx.db.query('SELECT status FROM oaooao_orders WHERE id=$1',[order.id])).rows[0].status,'refunding');
});
