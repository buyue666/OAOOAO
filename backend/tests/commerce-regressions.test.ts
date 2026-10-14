import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createContext } from '../src/core.js';
import { adjustWallet, assignAdminPlan, getWallet, setPermanentBalance } from '../src/wallet.js';
import { completeManualOrder, prepareManualRefund, refundManualOrder } from '../src/commerce.js';
import { createTestDatabase } from './core-helpers.js';

test('daily consumption survives allowance revocation, reassignment, and generation refund',async t=>{
  const fixture=await createTestDatabase();t.after(fixture.cleanup);const ctx=createContext(fixture.db,fixture.config);const user='synthetic-regression-daily';
  await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,$2)',[user,'synthetic-unused']);
  await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{entitlements:{enabled:true,plans:[{id:'synthetic-plan',enabled:true,dailyPoints:100}]}}]);
  await assignAdminPlan(ctx,user,'daily:assign','synthetic-plan');await adjustWallet(ctx,user,'daily:spend',-100,{kind:'generation'});
  await assignAdminPlan(ctx,user,'daily:revoke',null);await assignAdminPlan(ctx,user,'daily:reassign','synthetic-plan');assert.equal((await getWallet(ctx,user)).dailyPointsBalance,0);
  await assignAdminPlan(ctx,user,'daily:revoke-2',null);
  await adjustWallet(ctx,user,'daily:refund',100,{refundOf:'daily:spend'});assert.equal((await getWallet(ctx,user)).dailyPointsBalance,0);
  await assignAdminPlan(ctx,user,'daily:reassign-after-refund','synthetic-plan');assert.equal((await getWallet(ctx,user)).dailyPointsBalance,100);
  await adjustWallet(ctx,user,'daily:spend-again',-100);await adjustWallet(ctx,user,'daily:duplicate-refund',100,{refundOf:'daily:spend'});assert.equal((await getWallet(ctx,user)).dailyPointsBalance,0);
});

test('user edits and plan settlement use a consistent user-before-wallet lock order',async t=>{
  const fixture=await createTestDatabase();t.after(fixture.cleanup);const ctx=createContext(fixture.db,fixture.config);const user='synthetic-regression-lock';
  await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,$2)',[user,'synthetic-unused']);
  await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{entitlements:{enabled:true,plans:[{id:'synthetic-plan',enabled:true,dailyPoints:5}]}}]);
  await ctx.db.query("INSERT INTO oaooao_products(id,product_kind,plan_id,name,amount_cents,points_amount,daily_points,period_days) VALUES('synthetic-product','plan','synthetic-plan','Synthetic plan',1000,10,5,30)");
  const id=randomUUID();await ctx.db.query("INSERT INTO oaooao_orders(id,order_no,user_id,product_id,product_kind,plan_id,subject,quantity,list_amount_cents,amount_cents,currency,points_amount,daily_points,period_days,provider,expires_at) VALUES($1,$1,$2,'synthetic-product','plan','synthetic-plan','Synthetic plan',1,1000,1000,'CNY',10,5,30,'manual',now()+interval '1 hour')",[id,user]);
  const admin=await ctx.db.connect();try{
    await admin.query('BEGIN');await admin.query('SELECT id FROM oaooao_users WHERE id=$1 FOR UPDATE',[user]);
    const payment=completeManualOrder(ctx,id,user,'Synthetic receipt');
    // The administrator already owns the user lock. A competing settlement must wait before taking the wallet lock.
    await setPermanentBalance(ctx,user,'synthetic:admin-set',20,{},admin);await admin.query('COMMIT');
    await payment;
  }catch(error){await admin.query('ROLLBACK');throw error;}finally{admin.release();}
  const wallet=await getWallet(ctx,user);assert.equal(wallet.permanentPointsBalance,30);assert.equal(wallet.dailyPointsBalance,5);
  const prepared=await prepareManualRefund(ctx,id,user,'Synthetic preparation');
  await refundManualOrder(ctx,id,user,'Synthetic verified external refund',true,prepared.reservation.id);assert.equal((await getWallet(ctx,user)).permanentPointsBalance,20);
});
