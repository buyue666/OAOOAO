import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildApp} from '../src/app.js';
import {claimCheckIn,getCheckInStatus,normalizeCheckInSettings,validateCheckInSettings} from '../src/check-in.js';
import {createContext,hashToken,transaction} from '../src/core.js';
import {migrate} from '../src/migrate.js';
import {createJob} from '../src/creative.js';
import {processNextJob} from '../src/worker.js';
import {ProviderFailure} from '../src/providers.js';
import {adjustWallet,creditUnits,expireCreditBatches,getWallet,grantTimedCredits,importWallet,setPermanentBalance} from '../src/wallet.js';
import {createTestDatabase} from './core-helpers.js';

test('check-in validity and plan rules validate without silently changing invalid configuration',()=>{
  const base={enabled:true,rewardPoints:10,validityDays:0,planRewards:[]};
  assert.deepEqual(validateCheckInSettings({enabled:true,rewardPoints:10}),base);
  for(const validityDays of [-1,3651,0.5,'1',null])assert.throws(()=>validateCheckInSettings({...base,validityDays}),{statusCode:400});
  for(const planRewards of [null,{},[{planId:'x',rewardPoints:10,validityDays:1},{planId:'x',rewardPoints:20,validityDays:0}],[{planId:'x',rewardPoints:0,validityDays:0}],[{planId:' x ',rewardPoints:1,validityDays:0}],Array.from({length:101},(_,i)=>({planId:String(i),rewardPoints:1,validityDays:0}))])assert.throws(()=>validateCheckInSettings({...base,planRewards}),{statusCode:400});
  assert.throws(()=>validateCheckInSettings({...base,planRewards:[{planId:'unknown',rewardPoints:1,validityDays:1}]},new Set(['known'])),{statusCode:400});
  assert.equal(normalizeCheckInSettings({...base,validityDays:-1}).enabled,false);
  assert.equal(normalizeCheckInSettings({...base,planRewards:[{planId:'x'}]}).enabled,false);
});

test('isolated PostgreSQL: 012 preserves old permanent claims and old eleven checksums',async t=>{
  const f=await createTestDatabase();t.after(f.cleanup);
  await f.db.query('DROP TABLE oaooao_wallet_batch_allocations; DROP TABLE oaooao_credit_batches; ALTER TABLE oaooao_wallet_operations DROP COLUMN timed_delta,DROP COLUMN timed_after; ALTER TABLE oaooao_check_ins DROP CONSTRAINT oaooao_check_ins_validity,DROP COLUMN validity_days,DROP COLUMN expires_at,DROP COLUMN rule_plan_id,DROP COLUMN rule_plan_name');
  await f.db.query("DELETE FROM oaooao_migrations WHERE name='012-check-in-credit-validity.sql'");
  const id=randomUUID();await f.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,'synthetic')",[id]);
  await f.db.query('INSERT INTO oaooao_wallets(user_id,permanent_balance) VALUES($1,110)',[id]);
  await f.db.query("INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after,metadata) VALUES($1,$2,10,10,0,110,0,'{\"kind\":\"check_in\"}')",[id,id]);
  await f.db.query("INSERT INTO oaooao_check_ins(user_id,claim_date,reward_points,operation_id) VALUES($1,'2020-01-01',10,$1)",[id]);
  const before=(await f.db.query('SELECT name,checksum FROM oaooao_migrations ORDER BY name')).rows;assert.equal(before.length,11);
  const oldClaim=(await f.db.query('SELECT to_jsonb(c) AS row FROM oaooao_check_ins c WHERE user_id=$1',[id])).rows[0].row;
  await migrate(f.db);await migrate(f.db);
  assert.deepEqual((await f.db.query("SELECT name,checksum FROM oaooao_migrations WHERE name<'012' ORDER BY name")).rows,before);
  const row=(await f.db.query("SELECT to_jsonb(c)-'validity_days'-'expires_at'-'rule_plan_id'-'rule_plan_name' AS row,validity_days,expires_at FROM oaooao_check_ins c WHERE user_id=$1",[id])).rows[0];
  assert.deepEqual(row.row,oldClaim);assert.equal(row.validity_days,0);assert.equal(row.expires_at,null);
  assert.equal((await f.db.query('SELECT permanent_balance FROM oaooao_wallets WHERE user_id=$1',[id])).rows[0].permanent_balance,'110.0000');
  assert.equal((await f.db.query('SELECT count(*) FROM oaooao_credit_batches')).rows[0].count,'0');
  // Old SQL can omit the additive fields before any timed credits have been granted.
  await f.db.query("INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after) VALUES($1,$2,0,0,0,110,0)",[id+':old',id]);
  assert.equal((await f.db.query('SELECT timed_delta,timed_after FROM oaooao_wallet_operations WHERE operation_id=$1',[id+':old'])).rows[0].timed_delta,'0.0000');
});

test('isolated PostgreSQL: actual timed check-in batches spend, expire and refund atomically',async t=>{
  const f=await createTestDatabase();t.after(f.cleanup);const ctx=createContext(f.db,f.config);
  const base=new Date('2030-01-01T12:00:00.000Z');const clock=(ms=0)=>()=>new Date(base.getTime()+ms);
  const day=86_400_000;
  const user=async()=>{const id=randomUUID();await f.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,'synthetic')",[id]);return id;};
  const config=async(validityDays=0,rewardPoints=10)=>f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{checkIn:{enabled:true,rewardPoints,validityDays}}]);
  await t.test('permanent default and configured one/multiple days use their own immutable claim snapshots',async()=>{
    const id=await user();await config();const permanent=await claimCheckIn(ctx,id,clock());assert.equal(permanent.expiresAt,null);assert.equal(permanent.claimedValidityDays,0);
    await config(1,20);const same=await getCheckInStatus(ctx,id,clock());assert.equal(same.rewardPoints,20);assert.equal(same.claimedRewardPoints,10);assert.equal(same.claimedValidityDays,0);assert.equal(same.expiresAt,null);
    assert.equal((await claimCheckIn(ctx,id,clock())).balance,10);
    const next=await claimCheckIn(ctx,id,clock(day));assert.equal(next.expiresAt,clock(day*2)().toISOString());assert.equal(next.balance,30);
    await config(7,30);const later=await claimCheckIn(ctx,id,clock(day*2));assert.equal(later.claimedValidityDays,7);assert.equal(later.expiresAt,clock(day*9)().toISOString());assert.equal(later.balance,40);
    const wallet=await getWallet(ctx,id,undefined,clock(day*2));assert.equal(wallet.permanentPointsBalance,10);assert.equal(wallet.timedPointsBalance,30);
  });
  await t.test('exact boundary expires remaining only, once, preserving imported permanent credit',async()=>{
    await config(1);const id=await user();await importWallet(ctx,id,'synthetic-'+id,{permanentPointsBalance:100});
    await claimCheckIn(ctx,id,clock());await adjustWallet(ctx,id,id+':spend',-4,{},undefined,clock());
    assert.equal((await getWallet(ctx,id,undefined,clock(day-1))).pointsBalance,106);
    const states=await Promise.all(Array.from({length:15},()=>getWallet(ctx,id,undefined,clock(day))));assert.ok(states.every(w=>w.pointsBalance===100 && w.timedPointsBalance===0));
    const expired=(await f.db.query("SELECT * FROM oaooao_wallet_operations WHERE user_id=$1 AND metadata->>'kind'='timed_expiration'",[id])).rows;
    assert.equal(expired.length,1);assert.equal(expired[0].timed_delta,'-6.0000');assert.equal(expired[0].permanent_delta,'0.0000');
  });
  await t.test('concurrent same-day claims and competing spends cannot duplicate or overspend a batch',async()=>{
    await config(3);const id=await user();const claims=await Promise.all(Array.from({length:24},()=>claimCheckIn(ctx,id,clock())));assert.ok(claims.every(c=>c.claimed && c.balance===10));
    assert.equal((await f.db.query('SELECT count(*) FROM oaooao_credit_batches WHERE user_id=$1',[id])).rows[0].count,'1');
    const spent=await Promise.allSettled(Array.from({length:20},(_,i)=>adjustWallet(ctx,id,id+':'+i,-1,{},undefined,clock())));assert.equal(spent.filter(x=>x.status==='fulfilled').length,10);assert.equal(spent.filter(x=>x.status==='rejected' && x.reason.statusCode===402).length,10);
    assert.equal((await getWallet(ctx,id,undefined,clock())).pointsBalance,0);
  });
  await t.test('daily and batches are jointly ordered by nearest expiry, permanent last',async()=>{
    await config(1);const id=await user();await adjustWallet(ctx,id,id+':fund',20,{},undefined,clock());
    // Daily expires in 12h, early batch 1h, later batch 24h.
    await f.db.query('UPDATE oaooao_wallets SET daily_balance=5,daily_allowance=5,daily_spent=0,daily_expires_at=$2 WHERE user_id=$1',[id,clock(day/2)()]);
    await grantTimedCredits(ctx,id,id+':early',3,clock(3_600_000)(),{},undefined,clock());
    await grantTimedCredits(ctx,id,id+':late',7,clock(day)(),{},undefined,clock());
    const a=await adjustWallet(ctx,id,id+':a',-4,{},undefined,clock());assert.equal(a.timedPointsBalance,7);assert.equal(a.dailyPointsBalance,4);assert.equal(a.permanentPointsBalance,20);
    const b=await adjustWallet(ctx,id,id+':b',-12,{},undefined,clock());assert.equal(b.timedPointsBalance,0);assert.equal(b.dailyPointsBalance,0);assert.equal(b.permanentPointsBalance,19);
    const ledger=(await f.db.query('SELECT permanent_delta,daily_delta,timed_delta FROM oaooao_wallet_operations WHERE operation_id=$1',[id+':b'])).rows[0];assert.deepEqual(ledger,{permanent_delta:'-1.0000',daily_delta:'-4.0000',timed_delta:'-7.0000'});
  });
  await t.test('simultaneous daily and multiple batch expiries preserve every ledger balance and chronological order',async()=>{
    await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{freeDailyPointsEnabled:true,freeDailyPoints:5}]);
    const id=await user();await adjustWallet(ctx,id,id+':fund',20,{},undefined,clock());
    await grantTimedCredits(ctx,id,id+':early-a',3,clock(day/2)(),{},undefined,clock());
    await grantTimedCredits(ctx,id,id+':early-b',4,clock(day/2)(),{},undefined,clock());
    await grantTimedCredits(ctx,id,id+':late',7,clock(day*2)(),{},undefined,clock());
    const result=await adjustWallet(ctx,id,id+':debit',-6,{kind:'generation'},undefined,clock(day/2));assert.equal(result.pointsBalance,26);
    const rows=(await f.db.query('SELECT permanent_delta,daily_delta,timed_delta,permanent_after,daily_after,timed_after,metadata FROM oaooao_wallet_operations WHERE user_id=$1 ORDER BY created_at,operation_id',[id])).rows;
    const running={permanent:0n,daily:0n,timed:0n};
    for(const row of rows)for(const bucket of ['permanent','daily','timed'] as const){running[bucket]+=creditUnits(row[`${bucket}_delta`]);assert.equal(creditUnits(row[`${bucket}_after`]),running[bucket],`${bucket} ledger discontinuity at ${row.metadata.kind}`);}
    assert.deepEqual(rows.slice(-5).map(row=>row.metadata.kind),['timed_expiration','timed_expiration','daily_expiration','daily_grant','generation']);
    assert.equal((await f.db.query('SELECT count(*)=count(DISTINCT created_at) AS distinct_times FROM oaooao_wallet_operations WHERE user_id=$1',[id])).rows[0].distinct_times,true);
  });
  await t.test('refund restores original live batches only; expired part never becomes permanent or extends expiry',async()=>{
    await config(1);const id=await user();await adjustWallet(ctx,id,id+':fund',10,{},undefined,clock());
    await grantTimedCredits(ctx,id,id+':early',3,clock(3_600_000)(),{},undefined,clock());
    await grantTimedCredits(ctx,id,id+':late',7,clock(day)(),{},undefined,clock());
    await adjustWallet(ctx,id,id+':debit',-12,{},undefined,clock());
    const replies=await Promise.all(Array.from({length:12},(_,i)=>adjustWallet(ctx,id,id+':refund:'+i,12,{refundOf:id+':debit'},undefined,clock(7_200_000))));
    assert.ok(replies.every(w=>w.permanentPointsBalance===10 && w.timedPointsBalance===7));
    const rows=(await f.db.query('SELECT timed_delta,permanent_delta,metadata FROM oaooao_wallet_operations WHERE refund_of=$1',[id+':debit'])).rows;assert.equal(rows.length,1);assert.equal(rows[0].timed_delta,'7.0000');assert.equal(rows[0].permanent_delta,'2.0000');assert.equal(rows[0].metadata.expiredRefundPoints,'3.0000');
    const batch=(await f.db.query('SELECT expires_at FROM oaooao_credit_batches WHERE grant_operation_id=$1',[id+':late'])).rows[0];assert.equal(batch.expires_at.toISOString(),clock(day)().toISOString());
    assert.equal((await getWallet(ctx,id,undefined,clock(day))).pointsBalance,10);
    await assert.rejects(adjustWallet(ctx,id,id+':bad-refund',11,{refundOf:id+':debit'},undefined,clock()),{statusCode:409});
  });
  await t.test('unexpired full refunds restore every original bucket and transaction failures leave no partial movement',async()=>{
    await config(5);const id=await user();await claimCheckIn(ctx,id,clock());await adjustWallet(ctx,id,id+':fund',3,{},undefined,clock());
    await adjustWallet(ctx,id,id+':debit',-12,{},undefined,clock());
    await assert.rejects(transaction(f.db,async db=>{await adjustWallet(ctx,id,id+':refund',12,{refundOf:id+':debit'},db,clock());throw new Error('synthetic rollback');}),/synthetic rollback/);
    assert.equal((await getWallet(ctx,id,undefined,clock())).pointsBalance,1);
    const refund=await adjustWallet(ctx,id,id+':refund',12,{refundOf:id+':debit'},undefined,clock());assert.equal(refund.pointsBalance,13);assert.equal(refund.permanentPointsBalance,3);assert.equal(refund.timedPointsBalance,10);
    const other=await user();const failing={...ctx,audit:async()=>{throw new Error('synthetic audit');}};
    await assert.rejects(claimCheckIn(failing,other,clock()),/synthetic audit/);
    for(const table of ['oaooao_check_ins','oaooao_credit_batches','oaooao_wallet_operations'])assert.equal((await f.db.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[other])).rowCount,0);
    await claimCheckIn(ctx,other,clock());assert.equal((await getWallet(ctx,other,undefined,clock())).pointsBalance,10);
  });
  await t.test('permanent-only cash refund reservations/admin adjustments cannot spend timed balances',async()=>{
    await config(2);const id=await user();await claimCheckIn(ctx,id,clock());
    await assert.rejects(adjustWallet(ctx,id,id+':hold',-1,{bucket:'permanent'},undefined,clock()),{statusCode:402});
    await setPermanentBalance(ctx,id,id+':set',5);const after=await getWallet(ctx,id,undefined,clock());assert.equal(after.permanentPointsBalance,5);assert.equal(after.timedPointsBalance,10);
    await setPermanentBalance(ctx,id,id+':set-zero',0);assert.equal((await getWallet(ctx,id,undefined,clock())).timedPointsBalance,10);
    await assert.rejects(importWallet(ctx,id,'overwrite',{permanentPointsBalance:1000}),{statusCode:409});
  });
  await t.test('bounded maintenance settles past batches with one expiry ledger',async()=>{
    const id=await user();const old=()=>new Date(Date.now()-day*3);await grantTimedCredits(ctx,id,id+':grant',5,new Date(Date.now()-day),{},undefined,old);
    await expireCreditBatches(ctx,1);await expireCreditBatches(ctx,1);
    assert.equal((await getWallet(ctx,id)).timedPointsBalance,0);assert.equal((await f.db.query("SELECT 1 FROM oaooao_wallet_operations WHERE user_id=$1 AND metadata->>'kind'='timed_expiration'",[id])).rowCount,1);
  });
});

test('isolated PostgreSQL: plan reward matching uses locked live eligibility and claim snapshots',async t=>{
  const f=await createTestDatabase();t.after(f.cleanup);const ctx=createContext(f.db,f.config);const at=new Date('2030-02-01T12:00:00Z');
  const plans=[{id:'basic',name:'Basic',enabled:true,dailyPoints:0,limits:{}},{id:'pro',name:'Pro',enabled:true,dailyPoints:0,limits:{}},{id:'disabled',name:'Disabled',enabled:false,dailyPoints:0,limits:{}}];
  const value={entitlements:{enabled:true,defaultPlanId:'basic',plans},checkIn:{enabled:true,rewardPoints:5,validityDays:0,planRewards:[{planId:'basic',rewardPoints:10,validityDays:1},{planId:'pro',rewardPoints:20,validityDays:3},{planId:'disabled',rewardPoints:99,validityDays:7}]}};
  await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[value]);
  const user=async(label?:string)=>{const id=randomUUID();await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,plan_id) VALUES($1,$1,'synthetic',$2)",[id,label ?? null]);return id;};
  const grant=async(id:string,plan:string,expires:Date,starts=new Date(at.getTime()-1000))=>{
    // Grants reference orders; synthetic rows satisfy the real foreign keys.
    const product=randomUUID(),order=randomUUID();
    await f.db.query("INSERT INTO oaooao_products(id,product_kind,plan_id,name,amount_cents,period_days) VALUES($1,'plan',$2,'synthetic',1,1)",[product,plan]);
    await f.db.query("INSERT INTO oaooao_orders(id,order_no,user_id,product_id,product_kind,plan_id,subject,quantity,list_amount_cents,promotion_discount_cents,coupon_discount_cents,amount_cents,currency,points_amount,daily_points,period_days,provider,status,expires_at) VALUES($1,$1,$2,$3,'plan',$4,'synthetic',1,1,0,0,1,'CNY',0,0,1,'manual','paid',$5)",[order,id,product,plan,expires]);
    await f.db.query('INSERT INTO oaooao_plan_grants(id,user_id,order_id,plan_id,daily_points,starts_at,expires_at) VALUES($1,$2,$3,$4,0,$5,$6)',[randomUUID(),id,order,plan,starts,expires]);
  };
  await t.test('legacy labels/expired/future/revoked grants do not qualify; live purchase does',async()=>{
    const label=await user('pro');assert.equal((await getCheckInStatus(ctx,label,()=>at)).rewardPoints,5);
    const expired=await user('pro');await grant(expired,'pro',at);assert.equal((await getCheckInStatus(ctx,expired,()=>at)).rewardPoints,5);
    const future=await user();await grant(future,'pro',new Date(+at+86400000),new Date(+at+1));assert.equal((await getCheckInStatus(ctx,future,()=>at)).rewardPoints,5);
    const revoked=await user();await grant(revoked,'pro',new Date(+at+86400000));await f.db.query('UPDATE oaooao_plan_grants SET revoked_at=$2 WHERE user_id=$1',[revoked,at]);assert.equal((await getCheckInStatus(ctx,revoked,()=>at)).rewardPoints,5);
    const live=await user();await grant(live,'pro',new Date(+at+86400000));const state=await claimCheckIn(ctx,live,()=>at);assert.equal(state.claimedRewardPoints,20);assert.equal(state.claimedValidityDays,3);assert.equal(state.claimedPlanId,'pro');assert.equal(state.claimedPlanName,'Pro');
    await f.db.query('UPDATE oaooao_plan_grants SET revoked_at=$2 WHERE user_id=$1',[live,at]);const repeat=await claimCheckIn(ctx,live,()=>at);assert.equal(repeat.rewardPoints,5);assert.equal(repeat.claimedRewardPoints,20);assert.equal(repeat.balance,20);
  });
  await t.test('enabled administrative assignment overrides a purchase; disabled assignment does not',async()=>{
    const id=await user();await grant(id,'pro',new Date(+at+86400000));await f.db.query("INSERT INTO oaooao_admin_plan_assignments(user_id,plan_id) VALUES($1,'basic')",[id]);
    assert.equal((await getCheckInStatus(ctx,id,()=>at)).rulePlanId,'basic');
    await f.db.query("UPDATE oaooao_admin_plan_assignments SET plan_id='disabled' WHERE user_id=$1",[id]);assert.equal((await getCheckInStatus(ctx,id,()=>at)).rulePlanId,'pro');
  });
  await t.test('waiting for a plan change reads eligibility and Shanghai day only after acquiring the user lock',async()=>{
    const id=await user();await grant(id,'pro',new Date(+at+86400000));const client=await f.db.connect();
    let release!:()=>void;let lockReady!:()=>void;const locked=new Promise<void>(resolve=>lockReady=resolve);const unblock=new Promise<void>(resolve=>release=resolve);
    const modification=(async()=>{try{await client.query('BEGIN');await client.query('SELECT id FROM oaooao_users WHERE id=$1 FOR NO KEY UPDATE',[id]);lockReady();await unblock;await client.query('UPDATE oaooao_plan_grants SET revoked_at=$2 WHERE user_id=$1',[id,at]);await client.query('COMMIT');}finally{client.release();}})();
    await locked;let now=new Date('2030-02-01T15:59:59Z');const pending=claimCheckIn(ctx,id,()=>now);await new Promise(resolve=>setTimeout(resolve,30));now=new Date('2030-02-01T16:00:01Z');release();await modification;
    const response=await pending;assert.equal(response.date,'2030-02-02');assert.equal(response.claimedRewardPoints,5);assert.equal(response.claimedPlanId,null);
  });
});

test('isolated PostgreSQL: APIs expose real timed totals, actual ledger deltas and replaceable plan rules',async t=>{
  const f=await createTestDatabase();const app=await buildApp({db:f.db,config:f.config});t.after(async()=>{await app.close();await f.cleanup();});const ctx=createContext(f.db,f.config);
  async function actor(permissions:string[]=[]){const id=randomUUID(),token=randomBytes(32).toString('base64url');await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic',$2,$3)",[id,permissions.length?'admin':'user',JSON.stringify(permissions)]);await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);return {id,headers:{cookie:`${f.config.sessionCookieName}=${token}`,origin:f.config.origin}};}
  const admin=await actor(['commerce.manage','users.read']),member=await actor();
  const entitlement={enabled:true,defaultPlanId:'pro',plans:[{id:'pro',name:'Pro',enabled:true,dailyPoints:0,limits:{}}]};
  const configuration={enabled:true,rewardPoints:10,validityDays:2,planRewards:[{planId:'pro',rewardPoints:20,validityDays:7}]};
  const patch=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:admin.headers,payload:{checkIn:configuration,entitlements:entitlement}});assert.equal(patch.statusCode,200,patch.body);
  const invalid=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:admin.headers,payload:{checkIn:{planRewards:[{planId:'missing',rewardPoints:10,validityDays:0}]}}});assert.equal(invalid.statusCode,400);
  const clear=await app.inject({method:'PATCH',url:'/api/admin/settings',headers:admin.headers,payload:{checkIn:{planRewards:[]}}});assert.equal(clear.statusCode,200,clear.body);
  assert.deepEqual((await f.db.query("SELECT value->'checkIn'->'planRewards' AS rules FROM oaooao_settings WHERE id='global'")).rows[0].rules,[]);
  assert.equal((await app.inject({method:'PATCH',url:'/api/admin/settings',headers:member.headers,payload:{checkIn:configuration}})).statusCode,403);
  const claim=await app.inject({method:'POST',url:'/api/account/check-in',headers:member.headers});assert.equal(claim.statusCode,200,claim.body);assert.equal(claim.json().claimedValidityDays,2);
  const session=(await app.inject({url:'/api/auth/session',headers:member.headers})).json();assert.equal(session.user.pointsBalance,10);assert.equal(session.user.permanentPointsBalance,0);assert.equal(session.user.timedPointsBalance,10);assert.equal(session.user.exact.timedPointsBalance,'10.0000');
  const users=(await app.inject({url:'/api/admin/users',headers:admin.headers})).json();assert.equal(users.summary.totalPointsBalance,10);
  const points=(await app.inject({url:'/api/points?direction=credit',headers:member.headers})).json().records;const reward=points.find((item:any)=>item.kind==='check_in');assert.equal(reward.amount,10);assert.equal(reward.timedAmount,10);assert.equal(reward.balanceAfter,10);assert.equal(reward.expiresAt,claim.json().expiresAt);
  await adjustWallet(ctx,member.id,'synthetic-live-debit',-4);
  const debit=(await app.inject({url:'/api/points?direction=debit',headers:member.headers})).json().records.find((item:any)=>item.id==='synthetic-live-debit');assert.equal(debit.amount,-4);assert.equal(debit.timedAmount,-4);assert.equal(debit.balanceAfter,6);
});

test('isolated PostgreSQL: confirmed generation failure refunds live allocations but never revives an expired reward',async t=>{
  const f=await createTestDatabase();t.after(f.cleanup);const ctx=createContext(f.db,f.config);const id=randomUUID();
  await f.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,'synthetic')",[id]);
  const config={systemChannels:[{id:'synthetic',name:'Synthetic no-network',baseUrl:'https://provider.example/v1',apiFormat:'openai',apiKey:ctx.encrypt('synthetic-unused'),enabled:true,models:['test']}],logicalModels:[{id:'synthetic-text',name:'Synthetic',capability:'text',enabled:true,bindings:[{id:'test',channelId:'synthetic',upstreamModel:'test',enabled:true,priority:1}]}],modelPointCosts:{'synthetic-text':22},generationConcurrency:{text:10,agent:10}};
  await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[config]);
  await adjustWallet(ctx,id,id+':permanent',5);await grantTimedCredits(ctx,id,id+':timed',20,new Date(Date.now()+86400000));
  const input={prompt:'Synthetic test',config:{model:'synthetic-text'},context:{},source:'chat'};
  const first=await createJob(ctx,id,'text',input,id+':first');assert.equal((await getWallet(ctx,id)).pointsBalance,3);
  await processNextJob(ctx,async()=>{throw new ProviderFailure('Synthetic definitive failure',true);});
  assert.equal((await getWallet(ctx,id)).pointsBalance,25);assert.equal((await f.db.query('SELECT status FROM oaooao_generation_jobs WHERE id=$1',[first.id])).rows[0].status,'error');
  const second=await createJob(ctx,id,'text',input,id+':second');
  // Only in this synthetic schema, advance the stored clock boundary for the worker's real clock.
  await f.db.query("UPDATE oaooao_credit_batches SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1",[id]);
  await processNextJob(ctx,async()=>{throw new ProviderFailure('Synthetic definitive failure after expiry',true);});
  const wallet=await getWallet(ctx,id);assert.equal(wallet.permanentPointsBalance,5);assert.equal(wallet.timedPointsBalance,0);
  const refund=(await f.db.query('SELECT permanent_delta,timed_delta,metadata FROM oaooao_wallet_operations WHERE refund_of=$1',[`generation:${second.id}:debit`])).rows[0];assert.equal(refund.permanent_delta,'2.0000');assert.equal(refund.timed_delta,'0.0000');assert.equal(refund.metadata.expiredRefundPoints,'20.0000');
  await processNextJob(ctx,async()=>{throw Error('No remaining job may execute');});assert.equal((await getWallet(ctx,id)).pointsBalance,5);
});
