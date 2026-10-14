import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { createContext,hashToken } from '../src/core.js';
import { cancelManualRefund,completeManualOrder,prepareManualRefund,refundManualOrder,registerCommerce,settleReferralRewards } from '../src/commerce.js';
import { adjustWallet,getWallet } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

test('manual refund reservations secure credits before any external transfer',async t=>{
  const fixture=await createTestDatabase(),ctx=createContext(fixture.db,fixture.config),app=Fastify();await app.register(cookie);await registerCommerce(app,ctx);
  app.setErrorHandler((error,_request,reply)=>reply.code((error as any).statusCode||500).send({msg:(error as Error).message}));await app.ready();
  t.after(async()=>{await app.close();await fixture.cleanup();});
  async function user(){const id=randomUUID();await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,$2)',[id,'synthetic-unused']);return id;}
  const admin=await user(),token=randomBytes(32).toString('base64url');
  await ctx.db.query("UPDATE oaooao_users SET role='admin',admin_permissions=$2 WHERE id=$1",[admin,JSON.stringify(['billing.manage','billing.read'])]);
  await ctx.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),admin]);
  await ctx.db.query("INSERT INTO oaooao_products(id,product_kind,name,amount_cents,points_amount) VALUES('refund-synthetic-product','points','Synthetic refund product',1000,10)");
  async function paid(){const buyer=await user(),id=randomUUID();await ctx.db.query("INSERT INTO oaooao_orders(id,order_no,user_id,product_id,product_kind,subject,quantity,list_amount_cents,amount_cents,currency,points_amount,daily_points,period_days,provider,expires_at) VALUES($1,$1,$2,'refund-synthetic-product','points','Synthetic refund',1,1000,1000,'CNY',10,0,0,'manual',now()+interval '1 hour')",[id,buyer]);await completeManualOrder(ctx,id,admin,'Synthetic receipt');return {id,buyer};}
  async function stored(id:string){return(await ctx.db.query('SELECT * FROM oaooao_orders WHERE id=$1',[id])).rows[0];}
  async function addReward(order:{id:string;buyer:string},settled=true){const inviter=await user(),relation=randomUUID(),reward=randomUUID();await ctx.db.query("INSERT INTO oaooao_referrals(id,inviter_user_id,invitee_user_id,status,qualifying_order_id,qualified_at) VALUES($1,$2,$3,$4,$5,now())",[relation,inviter,order.buyer,settled?'settled':'qualified',order.id]);await ctx.db.query("INSERT INTO oaooao_referral_rewards(id,relationship_id,user_id,role,points,status,due_at) VALUES($1,$2,$3,'inviter',3,$4,now())",[reward,relation,inviter,settled?'settled':'pending']);if(settled)await adjustWallet(ctx,inviter,`referral:${reward}:settle`,3,{kind:'referral_reward'});return {inviter,reward};}

  await t.test('concurrent preparation reserves once, survives restart reads, and prevents spend before confirmation',async()=>{
    const order=await paid();const prepared=await Promise.all(Array.from({length:10},()=>prepareManualRefund(ctx,order.id,admin,'Synthetic prepare')));
    const id=prepared[0]!.reservation.id;assert.equal(new Set(prepared.map(item=>item.reservation.id)).size,1);assert.equal((await getWallet(ctx,order.buyer)).permanentPointsBalance,0);
    const resumed=await stored(order.id);assert.equal(resumed.status,'refunding');assert.equal(resumed.metadata.refundReservation.id,id);
    await assert.rejects(adjustWallet(ctx,order.buyer,'synthetic:spend-reserved',-1),{statusCode:402});
    const finance=await app.inject({method:'GET',url:'/api/admin/billing/summary',headers:{cookie:`${ctx.config.sessionCookieName}=${token}`}});
    assert.equal(finance.statusCode,200);assert.equal(finance.json().summary.reconciliation.succeededPaymentsWithoutPaidOrder,0);assert.equal(finance.json().summary.orders.paidAmountCents,1000);
    const results=await Promise.all(Array.from({length:10},()=>refundManualOrder(ctx,order.id,admin,'Synthetic verified transfer',true,id)));
    assert.ok(results.every(row=>row.status==='refunded'));assert.equal((await getWallet(ctx,order.buyer)).permanentPointsBalance,0);
    assert.equal((await ctx.db.query("SELECT count(*) FROM oaooao_wallet_operations WHERE metadata->>'reservationId'=$1",[id])).rows[0].count,'1');
  });
  await t.test('cancellation needs an explicit no-transfer attestation and stale reservation IDs cannot confirm a new attempt',async()=>{
    const order=await paid(),first=await prepareManualRefund(ctx,order.id,admin,'Synthetic prepare');
    await assert.rejects(cancelManualRefund(ctx,order.id,admin,'Synthetic cancel',first.reservation.id),{statusCode:409});
    await Promise.all(Array.from({length:8},()=>cancelManualRefund(ctx,order.id,admin,'Verified no money sent',first.reservation.id,true)));
    assert.equal((await getWallet(ctx,order.buyer)).permanentPointsBalance,10);assert.equal((await stored(order.id)).status,'paid');
    const second=await prepareManualRefund(ctx,order.id,admin,'New synthetic attempt');assert.notEqual(second.reservation.id,first.reservation.id);
    await assert.rejects(refundManualOrder(ctx,order.id,admin,'Stale synthetic confirmation',true,first.reservation.id),{statusCode:409});
    await cancelManualRefund(ctx,order.id,admin,'Old repeated cancellation',first.reservation.id,true);assert.equal((await getWallet(ctx,order.buyer)).permanentPointsBalance,0);
    await refundManualOrder(ctx,order.id,admin,'Verified synthetic transfer',true,second.reservation.id);
    await assert.rejects(cancelManualRefund(ctx,order.id,admin,'Late cancellation',second.reservation.id,true),{statusCode:409});
  });
  await t.test('prepare versus spend serializes: either a complete reservation or an unchanged paid order',async()=>{
    const order=await paid();const results=await Promise.allSettled([prepareManualRefund(ctx,order.id,admin,'Synthetic prepare race'),adjustWallet(ctx,order.buyer,'synthetic:competing-spend',-1)]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    const state=await stored(order.id),balance=(await getWallet(ctx,order.buyer)).permanentPointsBalance;
    assert.ok((state.status==='refunding'&&balance===0)||(state.status==='paid'&&balance===9));
  });
  await t.test('insufficient referral clawback fails before external transfer and rolls back all buyer holds',async()=>{
    const order=await paid(),referral=await addReward(order);await adjustWallet(ctx,referral.inviter,'synthetic:spent-reward',-3);
    await assert.rejects(prepareManualRefund(ctx,order.id,admin,'Synthetic insufficient reward'),{statusCode:402});
    assert.equal((await getWallet(ctx,order.buyer)).permanentPointsBalance,10);assert.equal((await stored(order.id)).status,'paid');
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_refund_reservations WHERE order_id=$1',[order.id])).rows[0].count,'0');
    await adjustWallet(ctx,referral.inviter,'synthetic:restore-reward',3);const prepared=await prepareManualRefund(ctx,order.id,admin,'Synthetic recovered reward');
    assert.equal((await getWallet(ctx,referral.inviter)).permanentPointsBalance,0);
    await cancelManualRefund(ctx,order.id,admin,'Synthetic no transfer',prepared.reservation.id,true);assert.equal((await getWallet(ctx,referral.inviter)).permanentPointsBalance,3);
    const retry=await prepareManualRefund(ctx,order.id,admin,'Synthetic final preparation');await refundManualOrder(ctx,order.id,admin,'Synthetic verified transfer',true,retry.reservation.id);
    assert.equal((await ctx.db.query('SELECT status FROM oaooao_referral_rewards WHERE id=$1',[referral.reward])).rows[0].status,'revoked');assert.equal((await getWallet(ctx,referral.inviter)).permanentPointsBalance,0);
  });
  await t.test('pending referral rewards cannot settle while money refund is reserved, but cancellation permits settlement',async()=>{
    const order=await paid(),referral=await addReward(order,false),prepared=await prepareManualRefund(ctx,order.id,admin,'Synthetic prepare');
    await settleReferralRewards(ctx);assert.equal((await getWallet(ctx,referral.inviter)).permanentPointsBalance,0);
    await cancelManualRefund(ctx,order.id,admin,'Synthetic no money sent',prepared.reservation.id,true);await settleReferralRewards(ctx);assert.equal((await getWallet(ctx,referral.inviter)).permanentPointsBalance,3);
  });
  await t.test('confirmation/cancellation conflict chooses one terminal state without double balance changes',async()=>{
    const order=await paid(),prepared=await prepareManualRefund(ctx,order.id,admin,'Synthetic race prepare');
    const results=await Promise.allSettled([refundManualOrder(ctx,order.id,admin,'Synthetic transfer verified',true,prepared.reservation.id),cancelManualRefund(ctx,order.id,admin,'Synthetic no transfer assertion',prepared.reservation.id,true)]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);const state=await stored(order.id);
    assert.equal((await getWallet(ctx,order.buyer)).permanentPointsBalance,state.status==='refunded'?0:10);
  });
  await t.test('authorization and failed audit prevent a partial reservation',async()=>{
    const order=await paid();assert.equal((await app.inject({method:'POST',url:`/api/admin/billing/orders/${order.id}/refund/prepare`,payload:{reason:'Unauthorized'}})).statusCode,401);
    const audit=ctx.audit;ctx.audit=async()=>{throw new Error('Synthetic audit failure');};
    try{await assert.rejects(prepareManualRefund(ctx,order.id,admin,'Synthetic rollback'));}finally{ctx.audit=audit;}
    assert.equal((await getWallet(ctx,order.buyer)).permanentPointsBalance,10);assert.equal((await stored(order.id)).status,'paid');
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_refund_reservations WHERE order_id=$1',[order.id])).rows[0].count,'0');
  });
});
