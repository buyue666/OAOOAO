import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../src/core.js';
import { adjustWallet, creditDecimal, creditUnits, getWallet, importWallet, setPermanentBalance } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

test('credit arithmetic accepts exact four-decimal amounts and rejects truncation',()=>{
  assert.equal(creditUnits('10.0001')-creditUnits('0.0002'),99999n);
  assert.equal(creditDecimal(-1n),'-0.0001');
  assert.equal(creditDecimal(creditUnits('123456789.1234')),'123456789.1234');
  for(const bad of ['1e2','0.00001','NaN','Infinity','1.1.1','','-','900719925474.0992']) assert.throws(()=>creditUnits(bad));
});

test('isolated PostgreSQL wallet transactions, spending races, refunds and transfers',async t=>{
  const fixture=await createTestDatabase();t.after(fixture.cleanup);
  const ctx=createContext(fixture.db,fixture.config);
  let counter=0;
  async function user(){const id=`wallet-synthetic-${++counter}`;await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,$2)',[id,'synthetic-hash-unused']);return id;}
  await t.test('parallel repeated credit writes grant once',async()=>{
    const id=await user();await Promise.all(Array.from({length:30},()=>adjustWallet(ctx,id,'same-credit','12.3456')));
    assert.equal((await getWallet(ctx,id)).exact.permanentPointsBalance,'12.3456');
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_wallet_operations WHERE user_id=$1',[id])).rows[0].count,'1');
    await assert.rejects(adjustWallet(ctx,id,'same-credit','12.3457'),{statusCode:409});
    const other=await user();await assert.rejects(adjustWallet(ctx,other,'same-credit','12.3456'),{statusCode:409});
    assert.equal((await getWallet(ctx,other)).pointsBalance,0);
  });
  await t.test('concurrent competing debits cannot overspend',async()=>{
    const id=await user();await adjustWallet(ctx,id,`${id}:fund`,10);
    const results=await Promise.allSettled(Array.from({length:25},(_,n)=>adjustWallet(ctx,id,`${id}:spend:${n}`,-1)));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,10);
    assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.statusCode===402).length,15);
    assert.equal((await getWallet(ctx,id)).exact.pointsBalance,'0.0000');
  });
  await t.test('retries of the same debit are not charged twice',async()=>{
    const id=await user();await adjustWallet(ctx,id,`${id}:fund`,10);
    await Promise.all(Array.from({length:20},()=>adjustWallet(ctx,id,`${id}:spend`,'-0.0001')));
    assert.equal((await getWallet(ctx,id)).exact.pointsBalance,'9.9999');
  });
  await t.test('caller transaction rollback rolls back credit and operation',async()=>{
    const id=await user();const db=await ctx.db.connect();try{await db.query('BEGIN');await adjustWallet(ctx,id,`${id}:rolled-back`,100,{},db);await db.query('ROLLBACK');}finally{db.release();}
    assert.equal((await getWallet(ctx,id)).pointsBalance,0);
    assert.equal((await ctx.db.query('SELECT 1 FROM oaooao_wallet_operations WHERE operation_id=$1',[`${id}:rolled-back`])).rowCount,0);
    await adjustWallet(ctx,id,`${id}:rolled-back`,100);assert.equal((await getWallet(ctx,id)).pointsBalance,100);
  });
  await t.test('daily credits spend first; a refund restores each original bucket once',async()=>{
    const id=await user();await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{freeDailyPointsEnabled:true,freeDailyPoints:5}]);
    await adjustWallet(ctx,id,`${id}:fund`,10);const spent=await adjustWallet(ctx,id,`${id}:consume`,-7);
    assert.equal(spent.permanentPointsBalance,8);assert.equal(spent.dailyPointsBalance,0);
    await Promise.all(Array.from({length:20},(_,n)=>adjustWallet(ctx,id,`${id}:refund:${n}`,7,{refundOf:`${id}:consume`})));
    const refunded=await getWallet(ctx,id);assert.equal(refunded.permanentPointsBalance,10);assert.equal(refunded.dailyPointsBalance,5);
    assert.equal((await ctx.db.query('SELECT count(*) FROM oaooao_wallet_operations WHERE refund_of=$1',[`${id}:consume`])).rows[0].count,'1');
    await assert.rejects(adjustWallet(ctx,id,`${id}:wrong-refund`,6,{refundOf:`${id}:consume`}),{statusCode:409});
  });
  await t.test('expired daily debit refund never creates permanent credits',async()=>{
    const id=await user();await adjustWallet(ctx,id,`${id}:fund`,10);await adjustWallet(ctx,id,`${id}:consume`,-7);
    await ctx.db.query("UPDATE oaooao_wallets SET daily_expires_at=now()-interval '1 day',daily_refresh_date=current_date-1 WHERE user_id=$1",[id]);
    // Original debit expiry represents a previous day, as it would after a real day boundary.
    await ctx.db.query("UPDATE oaooao_wallet_operations SET daily_expires_at=now()-interval '1 day' WHERE operation_id=$1",[`${id}:consume`]);
    const result=await adjustWallet(ctx,id,`${id}:refund`,7,{refundOf:`${id}:consume`});
    assert.equal(result.permanentPointsBalance,10);assert.equal(result.dailyPointsBalance,5);
    const record=(await ctx.db.query('SELECT permanent_delta,daily_delta FROM oaooao_wallet_operations WHERE operation_id=$1',[`${id}:refund`])).rows[0];
    assert.equal(record.permanent_delta,'2.0000');assert.equal(record.daily_delta,'0.0000');
  });
  await t.test('daily refresh happens once per day despite simultaneous reads',async()=>{
    const id=await user();const results=await Promise.all(Array.from({length:15},()=>getWallet(ctx,id)));assert.ok(results.every(wallet=>wallet.dailyPointsBalance===5));
    await adjustWallet(ctx,id,`${id}:consume`,-2);await Promise.all(Array.from({length:15},()=>getWallet(ctx,id)));
    assert.equal((await getWallet(ctx,id)).dailyPointsBalance,3);
    assert.equal((await ctx.db.query("SELECT count(*) FROM oaooao_wallet_operations WHERE user_id=$1 AND metadata->>'kind'='daily_grant'",[id])).rows[0].count,'1');
  });
  await t.test('permanent adjustment cannot consume daily credit and stays idempotent',async()=>{
    const id=await user();await setPermanentBalance(ctx,id,`${id}:set`,8);await adjustWallet(ctx,id,`${id}:consume`,-6);
    await setPermanentBalance(ctx,id,`${id}:set`,8);assert.equal((await getWallet(ctx,id)).permanentPointsBalance,7);
    await assert.rejects(setPermanentBalance(ctx,id,`${id}:set`,9),{statusCode:409});
    await assert.rejects(adjustWallet(ctx,id,`${id}:permanent-only`,-8,{bucket:'permanent'}),{statusCode:402});
  });
  await t.test('normalized import preserves exact balances and rejects overwriting economic history',async()=>{
    await ctx.db.query("UPDATE oaooao_settings SET value='{}' WHERE id='global'");
    const id=await user();const expiry=new Date(Date.now()+3600000).toISOString();const input={permanentPointsBalance:'102.1234',dailyPointsBalance:'3.0001',dailyPointsExpiresAt:expiry};
    const result=await importWallet(ctx,id,'synthetic-transfer',input);assert.equal(result.exact.pointsBalance,'105.1235');
    await Promise.all(Array.from({length:10},()=>importWallet(ctx,id,'synthetic-transfer',input)));
    assert.equal((await getWallet(ctx,id)).exact.pointsBalance,'105.1235');
    await assert.rejects(importWallet(ctx,id,'synthetic-transfer',{...input,permanentPointsBalance:0}),{statusCode:409});
    await assert.rejects(importWallet(ctx,id,'different-transfer',input),{statusCode:409});
    const other=await user();await adjustWallet(ctx,other,`${other}:fund`,1);await assert.rejects(importWallet(ctx,other,'synthetic-transfer',input),{statusCode:409});
  });
});
