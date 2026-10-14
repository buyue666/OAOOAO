import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken, ADMIN_PERMISSIONS } from '../src/core.js';
import { adjustWallet, getWallet } from '../src/wallet.js';
import { EPAY_NOTIFY_PATH, EPAY_RETURN_PATH, epayCanonical, epayCheckout, epayGateway, epayMoneyCents, epaySign, epayVerify, parseEpayNotification, validateEpayValues, type EpayConfig } from '../src/payment-epay.js';
import { createTestDatabase } from './core-helpers.js';

const merchant=generateKeyPairSync('rsa',{modulusLength:2048});
const platform=generateKeyPairSync('rsa',{modulusLength:2048});
const merchantPrivateKey=merchant.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const platformPublicKey=platform.publicKey.export({format:'pem',type:'spki'}).toString();
const v1:EpayConfig={gatewayUrl:'https://gateway.example.com/',pid:'10001',protocol:'v1_md5',paymentType:'cashier',key:'synthetic-only-merchant-md5-key'};
const v2:EpayConfig={gatewayUrl:'https://gateway.example.com/',pid:'20001',protocol:'v2_rsa',paymentType:'cashier',merchantPrivateKey,platformPublicKey};
function providerSignature(fields:Record<string,string>,config:EpayConfig):string {
  const canonical=Object.entries(fields).filter(([key,value])=>!['sign','sign_type'].includes(key)&&value!=='').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>`${key}=${value}`).join('&');
  return config.protocol==='v1_md5'?createHash('md5').update(canonical+config.key).digest('hex'):sign('RSA-SHA256',Buffer.from(canonical),platform.privateKey).toString('base64');
}
test('EPay protocol primitives reject ambiguous fields, unsafe gateways and imprecise amounts',()=>{
  assert.equal(epayCanonical({b:'2',a:'1',empty:'',sign:'secret',sign_type:'MD5'}),'a=1&b=2');
  assert.equal(epaySign({b:'2',a:'1'},v1),createHash('md5').update('a=1&b=2'+v1.key).digest('hex'));
  for(const url of ['http://example.com','https://user:pass@example.com','https://localhost/','https://127.0.0.1/','https://[::1]/','https://10.0.0.1/','https://example.com/?token=x','https://example.com/#x','https://example.com/submit.php','https://example.com\\@evil.com'])assert.throws(()=>epayGateway(url));
  assert.equal(epayGateway('https://gateway.example.com/prefix'),'https://gateway.example.com/prefix/');
  for(const amount of ['1e2','NaN','0.001','+1','-1','1.00 ','01.00'])assert.throws(()=>epayMoneyCents(amount));
  assert.equal(epayMoneyCents('9999999999.99'),999999999999n);assert.equal(epayMoneyCents('0.1'),10n);
  for(const raw of ['pid=1&pid=2','pid[]=1','money=1%26pid%3D9','sign=%00','pid=a&__proto__=x'])assert.throws(()=>parseEpayNotification(raw));
  assert.throws(()=>validateEpayValues({...v2},{merchantPrivateKey,platformPublicKey:merchantPrivateKey},true));
  const order={id:'synthetic-order',order_no:'SYNTHETIC100',subject:'Unused arbitrary title',amount_cents:'101',currency:'CNY',expires_at:new Date(Date.now()+60000)};
  assert.throws(()=>epayCheckout(v1,'https://studio.example.com',{...order,amount_cents:'0'}),{statusCode:400});
  assert.throws(()=>epayCheckout(v2,'https://studio.example.com',{...order,currency:'USD'}),{statusCode:400});
  const form=epayCheckout(v2,'https://studio.example.com',order).form,fields=Object.fromEntries(form.fields.map(field=>[field.name,field.value]));
  assert.equal(form.method,'POST');assert.equal(form.action,'https://gateway.example.com/api/pay/submit');assert.equal(fields.money,'1.01');
  assert.ok(verify('RSA-SHA256',Buffer.from(epayCanonical(fields)),merchant.publicKey,Buffer.from(fields.sign,'base64')));
  assert.ok(!JSON.stringify(form).includes('PRIVATE KEY'));
  const response={pid:v2.pid,money:'1.01',sign_type:'RSA',sign:''};response.sign=providerSignature(response,v2);assert.equal(epayVerify(response,v2),true);response.money='2.01';assert.equal(epayVerify(response,v2),false);
});

test('isolated PostgreSQL EPay configuration, checkout and signed settlement',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config}),ctx=app.ctx;
  await app.ready();t.after(async()=>{await app.close();await fixture.cleanup();});
  let sequence=0;
  async function user(role='user',permissions:readonly string[]=[]){const id=`epay-synthetic-${++sequence}`,token=randomBytes(32).toString('base64url');await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,$2,$3,$4)',[id,'synthetic-unused-hash',role,JSON.stringify(permissions)]);await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);return {id,token};}
  const admin=await user('admin',ADMIN_PERMISSIONS),buyer=await user(),reader=await user('admin',['billing.read']),other=await user();
  async function api(method:'GET'|'POST'|'PATCH',url:string,payload?:object,actor=admin){const response=await app.inject({method,url,payload,headers:{cookie:`${ctx.config.sessionCookieName}=${actor.token}`,origin:ctx.config.origin}});return {status:response.statusCode,body:response.json()};}
  async function configure(config:EpayConfig,enabled=true){const result=await api('PATCH','/api/admin/billing/payment-config',{providerId:'epay',enabled,values:config});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
  const policy={status:'published',version:'synthetic-v1',refundPolicy:'Synthetic policy',pointsExpiryPolicy:'Permanent',renewalPolicy:'No automatic renewals',invoicePolicy:'Synthetic invoices',supportEmail:'support@example.com'};
  await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{operationMode:'commercial',site:{commercePolicy:policy,termsUrl:'/terms',termsVersion:'v1',termsContent:'Synthetic terms',privacyUrl:'/privacy',privacyVersion:'v1',privacyContent:'Synthetic privacy'}}]);
  const created=await api('POST','/api/admin/billing/products',{name:'Synthetic credits',amountCents:1000,pointsAmount:123.45,enabled:true});assert.equal(created.status,200);const product=created.body.product;
  async function order(actor=buyer){const result=await api('POST','/api/billing/orders',{productId:product.id,provider:'epay'},actor);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.order;}
  async function checkout(orderId:string,actor=buyer){const result=await api('POST',`/api/billing/orders/${orderId}/checkout`,{provider:'epay'},actor);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.checkout;}
  function notifyFields(orderNo:string,config:EpayConfig,extra:Record<string,string>={}){const fields={pid:config.pid,trade_no:`SYNTHETIC${++sequence}`,out_trade_no:orderNo,type:'alipay',name:'Synthetic',money:'10.00',trade_status:'TRADE_SUCCESS',...(config.protocol==='v2_rsa'?{timestamp:String(Math.floor(Date.now()/1000))}:{}),...extra,sign_type:config.protocol==='v1_md5'?'MD5':'RSA'} as Record<string,string>;fields.sign=providerSignature(fields,config);return fields;}
  async function notify(fields:Record<string,string>,method:'GET'|'POST'='GET'){const encoded=new URLSearchParams(fields).toString();return app.inject(method==='GET'?{method,url:EPAY_NOTIFY_PATH+'?'+encoded}:{method,url:EPAY_NOTIFY_PATH,headers:{'content-type':'application/x-www-form-urlencoded'},payload:encoded});}
  await t.test('unconfigured channels stay closed; API permissions, CSRF and secret masking',async()=>{
    assert.equal((await api('POST','/api/billing/orders',{productId:product.id,provider:'epay'},buyer)).status,503);
    assert.equal((await api('PATCH','/api/admin/billing/payment-config',{providerId:'epay',enabled:true,values:v1},reader)).status,403);
    assert.equal((await app.inject({method:'PATCH',url:'/api/admin/billing/payment-config',headers:{cookie:`${ctx.config.sessionCookieName}=${admin.token}`,origin:'https://evil.example'},payload:{providerId:'epay',enabled:true,values:v1}})).statusCode,403);
    assert.equal((await api('PATCH','/api/admin/billing/payment-config',{providerId:'epay',enabled:true,values:{pid:'10001'}})).status,400);
    const result=await configure(v1);assert.ok(!JSON.stringify(result).includes(v1.key!));const config=result.paymentConfig.providers.find((item:any)=>item.id==='epay');assert.equal(config.ready,true);assert.equal(config.webhookReady,true);assert.equal(config.checkoutKind,'form');
    const row=(await ctx.db.query("SELECT * FROM oaooao_payment_configs WHERE provider_id='epay'")).rows[0];assert.ok(!JSON.stringify(row).includes(v1.key!));assert.equal(JSON.parse(ctx.decrypt(row.encrypted_secrets)).key,v1.key);
    assert.equal((await api('PATCH','/api/admin/billing/payment-config',{providerId:'epay',enabled:true,values:{key:''}})).status,200);
    assert.equal((await app.inject({method:'GET',url:'/api/billing/products'})).json().paymentProviders.includes('epay'),true);
  });
  await t.test('checkout freezes provider identity, returns signed form and never awards credits',async()=>{
    const item=await order();assert.equal((await api('POST',`/api/billing/orders/${item.id}/checkout`,{},other)).status,404);
    const result=await checkout(item.id),fields=Object.fromEntries(result.form.fields.map((field:any)=>[field.name,field.value]));assert.equal(result.kind,'form');assert.equal(result.form.action,'https://gateway.example.com/submit.php');assert.equal(fields.money,'10.00');assert.equal(epayVerify(fields,v1),true);
    const row=(await ctx.db.query('SELECT * FROM oaooao_payment_attempts WHERE order_id=$1',[item.id])).rows[0];assert.ok(!JSON.stringify(row).includes(v1.key!));assert.equal((await getWallet(ctx,buyer.id)).pointsBalance,0);
    const returned=await app.inject({method:'GET',url:EPAY_RETURN_PATH+'?'+new URLSearchParams(notifyFields(item.orderNo,v1))});assert.equal(returned.statusCode,303);assert.equal((await getWallet(ctx,buyer.id)).pointsBalance,0);
    assert.ok(!JSON.stringify((await api('GET',`/api/billing/orders/${item.id}`,undefined,buyer)).body).includes('encrypted_config'));
  });
  await t.test('wrong signature/merchant/order/amount/currency/status/type cannot settle',async()=>{
    const item=await order();await checkout(item.id);
    const mismatches:Record<string,string>[]=[{pid:'999'},{money:'10.01'},{money:'1e1'},{currency:'USD'},{trade_status:'WAIT_BUYER_PAY'},{type:'unrecognized'},{out_trade_no:'missing-order'},{trade_no:'bad trade'}];
    for(const extra of mismatches)assert.equal((await notify(notifyFields(item.orderNo,v1,extra))).statusCode,400);
    const tampered=notifyFields(item.orderNo,v1);tampered.money='20.00';assert.equal((await notify(tampered)).statusCode,400);
    const duplicate=new URLSearchParams(notifyFields(item.orderNo,v1)).toString()+'&money=10.00';assert.equal((await app.inject({method:'GET',url:EPAY_NOTIFY_PATH+'?'+duplicate})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:EPAY_NOTIFY_PATH,payload:notifyFields(item.orderNo,v1)})).statusCode,400);
    assert.equal((await getWallet(ctx,buyer.id)).pointsBalance,0);
  });
  await t.test('concurrent notification retries settle exactly once; transaction cannot be reused',async()=>{
    const actor=await user(),item=await order(actor);await checkout(item.id,actor);const fields=notifyFields(item.orderNo,v1);
    const results=await Promise.all(Array.from({length:12},(_,index)=>notify(fields,index%2?'POST':'GET')));assert.ok(results.every(result=>result.statusCode===200&&result.body==='success'),results.map(row=>row.body).join('\n'));
    assert.equal((await getWallet(ctx,actor.id)).exact.pointsBalance,'123.4500');assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_payments WHERE order_id=$1',[item.id])).rows[0].count,'1');
    assert.equal((await notify(notifyFields(item.orderNo,v1))).statusCode,409);
    const second=await order(actor);await checkout(second.id,actor);assert.equal((await notify(notifyFields(second.orderNo,v1,{trade_no:fields.trade_no}))).statusCode,409);assert.equal((await getWallet(ctx,actor.id)).exact.pointsBalance,'123.4500');
  });
  await t.test('in-flight merchant binding survives key rotation/disable without accepting new identity',async()=>{
    const actor=await user(),item=await order(actor);await checkout(item.id,actor);
    const rotated={...v1,pid:'99999',key:'synthetic-rotated-key'};await configure(rotated,false);
    assert.equal((await api('POST',`/api/billing/orders/${item.id}/checkout`,{},actor)).status,503);
    assert.equal((await notify(notifyFields(item.orderNo,rotated))).statusCode,400);
    assert.equal((await notify(notifyFields(item.orderNo,v1))).statusCode,200);assert.equal((await getWallet(ctx,actor.id)).exact.pointsBalance,'123.4500');await configure(v1);
  });
  await t.test('closed/expired/non-initiated orders reject fulfillment and no partial credit survives audit failure',async()=>{
    const actor=await user(),unstarted=await order(actor);assert.equal((await notify(notifyFields(unstarted.orderNo,v1))).statusCode,400);
    const expired=await order(actor);await checkout(expired.id,actor);await ctx.db.query("UPDATE oaooao_orders SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);assert.equal((await notify(notifyFields(expired.orderNo,v1))).statusCode,409);
    const canceled=await order(actor);await checkout(canceled.id,actor);await api('POST',`/api/billing/orders/${canceled.id}/cancel`,{},actor);assert.equal((await notify(notifyFields(canceled.orderNo,v1))).statusCode,409);
    const failing=await order(actor);await checkout(failing.id,actor);const audit=ctx.audit;ctx.audit=async()=>{throw new Error('synthetic rollback');};try{assert.equal((await notify(notifyFields(failing.orderNo,v1))).statusCode,500);}finally{ctx.audit=audit;}
    assert.equal((await getWallet(ctx,actor.id)).pointsBalance,0);assert.equal((await ctx.db.query('SELECT status FROM oaooao_orders WHERE id=$1',[failing.id])).rows[0].status,'pending');assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_payments WHERE order_id=$1',[failing.id])).rows[0].count,'0');
  });
  await t.test('V2 RSA validates platform key, protocol and timestamp; distinct merchant key signs checkout',async()=>{
    await configure(v2);const actor=await user(),item=await order(actor);const result=await checkout(item.id,actor),fields=Object.fromEntries(result.form.fields.map((field:any)=>[field.name,field.value]));assert.equal(fields.sign_type,'RSA');assert.ok(verify('RSA-SHA256',Buffer.from(epayCanonical(fields)),merchant.publicKey,Buffer.from(fields.sign,'base64')));
    const wrong=notifyFields(item.orderNo,v2);wrong.sign=sign('RSA-SHA256',Buffer.from(epayCanonical(wrong)),merchant.privateKey).toString('base64');assert.equal((await notify(wrong)).statusCode,400);
    assert.equal((await notify(notifyFields(item.orderNo,v2,{timestamp:'1'}))).statusCode,400);assert.equal((await notify(notifyFields(item.orderNo,v2,{timestamp:String(Math.floor(Date.now()/1000)+600)}))).statusCode,400);
    assert.equal((await notify(notifyFields(item.orderNo,v1))).statusCode,400);
    assert.equal((await notify(notifyFields(item.orderNo,v2),'POST')).statusCode,200);assert.equal((await getWallet(ctx,actor.id)).exact.pointsBalance,'123.4500');
    const exposed=JSON.stringify((await api('GET','/api/admin/billing/payment-config')).body);assert.ok(!exposed.includes('PRIVATE KEY'));assert.ok(!exposed.includes('PUBLIC KEY'));assert.ok(!exposed.includes(v1.key!));
  });
  await t.test('EPay external refund reserves credits first, requires attestation and never regrants on callback',async()=>{
    const actor=await user(),item=await order(actor);await checkout(item.id,actor);const fields=notifyFields(item.orderNo,v2);assert.equal((await notify(fields)).statusCode,200);
    assert.equal((await api('POST',`/api/admin/billing/orders/${item.id}/refund`,{reason:'Synthetic external refund',confirmExternalRefund:true})).status,409);
    const prepared=await api('POST',`/api/admin/billing/orders/${item.id}/refund/prepare`,{reason:'Synthetic reservation before external transfer'});assert.equal(prepared.status,200,JSON.stringify(prepared.body));assert.equal((await getWallet(ctx,actor.id)).pointsBalance,0);
    assert.equal((await notify(fields)).statusCode,200);assert.equal((await getWallet(ctx,actor.id)).pointsBalance,0);
    assert.equal((await api('POST',`/api/admin/billing/orders/${item.id}/refund/cancel`,{reason:'No transfer',reservationId:prepared.body.reservation.id})).status,409);
    assert.equal((await api('POST',`/api/admin/billing/orders/${item.id}/refund/cancel`,{reason:'Synthetic verified no transfer',reservationId:prepared.body.reservation.id,confirmExternalRefundNotSent:true})).status,200);assert.equal((await getWallet(ctx,actor.id)).exact.pointsBalance,'123.4500');
    const second=await api('POST',`/api/admin/billing/orders/${item.id}/refund/prepare`,{reason:'Prepare verified transfer'});assert.equal(second.status,200);
    assert.equal((await api('POST',`/api/admin/billing/orders/${item.id}/refund`,{reason:'Synthetic platform refund verified',reservationId:second.body.reservation.id,confirmExternalRefund:true})).status,200);
    assert.equal((await notify(fields)).statusCode,200);assert.equal((await getWallet(ctx,actor.id)).pointsBalance,0);
    assert.equal((await notify(notifyFields(item.orderNo,v2))).statusCode,409);
    assert.equal((await ctx.db.query('SELECT status FROM oaooao_payments WHERE order_id=$1',[item.id])).rows[0].status,'refunded');
  });
  await t.test('EPay spent credits block external refund reservation atomically',async()=>{
    const actor=await user(),item=await order(actor);await checkout(item.id,actor);await notify(notifyFields(item.orderNo,v2));
    await adjustWallet(ctx,actor.id,'synthetic-epay-spend',-1,{kind:'generation'});
    assert.equal((await api('POST',`/api/admin/billing/orders/${item.id}/refund/prepare`,{reason:'Synthetic spent balance'})).status,402);
    assert.equal((await getWallet(ctx,actor.id)).exact.pointsBalance,'122.4500');assert.equal((await ctx.db.query('SELECT status FROM oaooao_orders WHERE id=$1',[item.id])).rows[0].status,'paid');
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_refund_reservations WHERE order_id=$1',[item.id])).rows[0].count,'0');
  });
});
