import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { ADMIN_PERMISSIONS, hashToken } from '../src/core.js';
import { claimCheckIn, getCheckInStatus } from '../src/check-in.js';
import { assignAdminPlan, getWallet, grantTimedCredits, revokeMembershipCheckIn, walletTransaction } from '../src/wallet.js';
import { migrate } from '../src/migrate.js';
import { createTestDatabase } from './core-helpers.js';

async function fixture(t: import('node:test').TestContext) {
  const f=await createTestDatabase(), app=await buildApp({db:f.db,config:f.config});
  t.after(async()=>{await app.close();await f.cleanup();});
  await app.ready();
  async function account(admin=false) {
    const id=randomUUID(), token=randomBytes(32).toString('base64url');
    await f.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,$2,$3,$4)',[id,'synthetic-unused',admin?'admin':'user',JSON.stringify(admin?ADMIN_PERMISSIONS:[])]);
    await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),id]);
    return { id, headers:{origin:f.config.origin,cookie:`${f.config.sessionCookieName}=${token}`} };
  }
  return {...f,app,account};
}

const plan=(id:string)=>({id,name:id,enabled:true,dailyPoints:0,limits:{dailyText:0,dailyAudio:0,dailyVideos:0,dailyImages:0,dailyApiCalls:0,dailyPointSpend:0},features:[]});
const entitlement=(...ids:string[])=>({enabled:true,defaultPlanId:'free',plans:['free',...ids].map(plan)});
async function product(db: Awaited<ReturnType<typeof fixture>>['db'],planId:string) {
  const id=randomUUID();
  await db.query("INSERT INTO oaooao_products(id,name,product_kind,plan_id,amount_cents,currency,points_amount,daily_points,period_days,enabled) VALUES($1,$2,'plan',$2,1000,'CNY',500,20.25,30,true)",[id,planId]);
  return id;
}

async function membership(f: Awaited<ReturnType<typeof fixture>>,userId:string,starts:string,expires:string,period=30) {
  const id=await product(f.db,'member'),order=randomUUID();
  await f.db.query("UPDATE oaooao_settings SET value=value||$1 WHERE id='global'",[{entitlements:entitlement('member'),checkIn:{enabled:false,rewardPoints:5,validityDays:0,planRewards:[]}}]);
  await f.db.query("INSERT INTO oaooao_orders(id,order_no,user_id,product_id,product_kind,plan_id,subject,status,quantity,list_amount_cents,amount_cents,currency,points_amount,daily_points,period_days,provider,expires_at) VALUES($1,$1,$2,$3,'plan','member','Synthetic','paid',1,1000,1000,'CNY',500,20.25,$4,'manual','2030-01-01')",[order,userId,id,period]);
  await f.db.query("INSERT INTO oaooao_plan_grants(id,user_id,order_id,plan_id,daily_points,starts_at,expires_at) VALUES($1,$2,$1,'member',20.25,$3,$4)",[order,userId,starts,expires]);
  return order;
}

test('membership check-ins share the exact term expiry even when the next term is already paid',async t=>{
  const f=await fixture(t), user=await f.account();
  await membership(f,user.id,'2029-12-31T00:00:00Z','2030-01-30T00:00:00Z');
  await membership(f,user.id,'2030-01-30T00:00:00Z','2030-03-01T00:00:00Z');
  const clock=()=>new Date('2030-01-01T15:59:55Z');
  assert.equal((await getWallet(f.app.ctx,user.id,undefined,clock)).pointsBalance,0);
  const before=await getCheckInStatus(f.app.ctx,user.id,clock);
  assert.equal(before.enabled,true);assert.equal(before.claimed,false);assert.equal(before.rewardPoints,20.25);assert.equal(before.rewardExpiresAt,'2030-01-30T00:00:00.000Z');
  const claims=await Promise.all(Array.from({length:5},()=>claimCheckIn(f.app.ctx,user.id,clock)));
  for(const value of claims){assert.equal(value.balance,20.25);assert.equal(value.claimedRewardSource,'membership');assert.equal(value.expiresAt,'2030-01-30T00:00:00.000Z');}
  assert.equal((await f.db.query('SELECT 1 FROM oaooao_check_ins WHERE user_id=$1',[user.id])).rowCount,1);
  const next=()=>new Date('2030-01-01T16:00:01Z');
  assert.equal((await getWallet(f.app.ctx,user.id,undefined,next)).pointsBalance,20.25);
  assert.equal((await getCheckInStatus(f.app.ctx,user.id,next)).claimed,false);
  const second=await claimCheckIn(f.app.ctx,user.id,next);
  assert.equal(second.balance,40.5);assert.equal(second.expiresAt,'2030-01-30T00:00:00.000Z');
  const balance=async (at:string)=>(await getWallet(f.app.ctx,user.id,undefined,()=>new Date(at))).pointsBalance;
  const last=await claimCheckIn(f.app.ctx,user.id,()=>new Date('2030-01-29T15:59:55Z'));
  assert.equal(last.claimedValidityDays,1);assert.equal(last.balance,60.75);assert.equal(last.expiresAt,before.rewardExpiresAt);
  assert.equal(await balance('2030-01-29T23:59:59.999Z'),60.75);
  assert.equal(await balance('2030-01-30T00:00:00.000Z'),0);
  const nextTerm=await claimCheckIn(f.app.ctx,user.id,()=>new Date('2030-01-30T00:00:00Z'));
  assert.equal(nextTerm.balance,20.25);assert.equal(nextTerm.expiresAt,'2030-03-01T00:00:00.000Z');
});

test('a manually assigned membership holds its check-in credits only while the assignment is active',async t=>{
  const f=await fixture(t), user=await f.account();
  const entitlements=entitlement('member');entitlements.plans[1].dailyPoints=12;
  await f.db.query("UPDATE oaooao_settings SET value=value||$1 WHERE id='global'",[{entitlements}]);
  await assignAdminPlan(f.app.ctx,user.id,'synthetic-assign','member');
  const claimed=await claimCheckIn(f.app.ctx,user.id);
  assert.equal(claimed.balance,12);assert.equal(claimed.expiresAt,null);assert.equal(claimed.claimedRewardSource,'membership');
  assert.equal((await assignAdminPlan(f.app.ctx,user.id,'synthetic-assign-same','member')).pointsBalance,12);
  assert.equal((await assignAdminPlan(f.app.ctx,user.id,'synthetic-remove-assignment',null)).pointsBalance,0);
  assert.equal((await assignAdminPlan(f.app.ctx,user.id,'synthetic-assign-again','member')).pointsBalance,0);
});

test('the term migration updates live membership batches without changing ordinary or expired credits',async t=>{
  const f=await fixture(t), user=await f.account();
  const today=new Date(), start=new Date(+today-3*86_400_000), end=new Date(+today+27*86_400_000), oldEnd=new Date(+today+30*86_400_000);
  const order=await membership(f,user.id,start.toISOString(),end.toISOString());
  for (const [operationId,rewardSource,at,expiry] of [
    ['old-member','membership',today,oldEnd],['old-general','general',new Date(+today-86_400_000),oldEnd],['old-expired','membership',new Date(+today-2*86_400_000),new Date(+today-60000)],
  ] as const) {
    await grantTimedCredits(f.app.ctx,user.id,operationId,3,expiry,{rewardSource,...(rewardSource==='membership'?{membershipOrderId:order}:{})},undefined,()=>at);
    await f.db.query(`INSERT INTO oaooao_check_ins(user_id,claim_date,reward_points,operation_id,claimed_at,validity_days,expires_at) VALUES($1,($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date,3,$3,$2,30,$4)`,[user.id,at,operationId,expiry]);
  }
  await f.db.query('ALTER TABLE oaooao_credit_batches DROP CONSTRAINT oaooao_credit_batches_expiry_basis,DROP COLUMN membership_assignment_at');
  await f.db.query("DELETE FROM oaooao_migrations WHERE name='029-membership-term-check-in.sql'");
  await migrate(f.db);
  const {rows}=await f.db.query('SELECT b.grant_operation_id,b.expires_at,c.expires_at AS claim_expiry FROM oaooao_credit_batches b JOIN oaooao_check_ins c ON c.operation_id=b.grant_operation_id WHERE b.user_id=$1',[user.id]);
  const map=new Map(rows.map(row=>[row.grant_operation_id,row]));
  assert.equal(map.get('old-member').expires_at.toISOString(),end.toISOString());
  assert.equal(map.get('old-member').claim_expiry.toISOString(),end.toISOString());
  assert.equal(map.get('old-general').expires_at.toISOString(),oldEnd.toISOString());
  assert.equal(map.get('old-expired').expires_at.toISOString(),new Date(+today-60000).toISOString());
  const feed=await f.app.inject({url:'/api/points',headers:user.headers});assert.equal(feed.statusCode,200,feed.body);
  assert.equal(feed.json().records.find((row:any)=>row.id==='old-member').expiresAt,end.toISOString());
});

test('rollout honors a legacy automatic reward and the last partial day cannot exceed an order quota',async t=>{
  const f=await fixture(t), legacy=await f.account(), capped=await f.account();
  await membership(f,legacy.id,'2029-12-31T00:00:00Z','2030-01-30T00:00:00Z');
  await f.db.query("UPDATE oaooao_migrations SET applied_at='2030-01-01T09:01:00Z' WHERE name='028-membership-check-in.sql'");
  await f.db.query("INSERT INTO oaooao_wallets(user_id,daily_balance,daily_allowance,daily_expires_at,daily_refresh_date) VALUES($1,20.25,20.25,'2030-01-02T00:00:00Z','2030-01-01')",[legacy.id]);
  await f.db.query(`INSERT INTO oaooao_wallet_operations(operation_id,user_id,requested_delta,permanent_delta,daily_delta,permanent_after,daily_after,daily_expires_at,metadata,created_at)
    VALUES($1,$2,20.25,0,20.25,0,20.25,'2030-01-02T00:00:00Z','{"kind":"daily_grant"}','2030-01-01T09:00:00Z')`,[`${legacy.id}:legacy`,legacy.id]);
  const cutover=await claimCheckIn(f.app.ctx,legacy.id,()=>new Date('2030-01-01T09:02:00Z'));
  assert.equal(cutover.balance,20.25);assert.equal(cutover.claimed,true);assert.equal(cutover.expiresAt,'2030-01-02T00:00:00.000Z');
  assert.equal((await f.db.query('SELECT 1 FROM oaooao_check_ins WHERE user_id=$1',[legacy.id])).rowCount,0);
  await membership(f,capped.id,'2030-01-01T12:00:00Z','2030-01-03T12:00:00Z',2);
  for(const date of ['2030-01-01T15:59:55Z','2030-01-01T16:00:01Z'])assert.equal((await claimCheckIn(f.app.ctx,capped.id,()=>new Date(date))).claimed,true);
  const finalPartial=()=>new Date('2030-01-02T16:15:00Z');
  assert.equal((await getCheckInStatus(f.app.ctx,capped.id,finalPartial)).enabled,false);
  await assert.rejects(claimCheckIn(f.app.ctx,capped.id,finalPartial),/签到奖励已领满/);
});

test('a refund clears unused 30-day check-in rewards for its order',async t=>{
  const f=await fixture(t), user=await f.account();
  const now=Date.now();
  const order=await membership(f,user.id,new Date(now-86_400_000).toISOString(),new Date(now+29*86_400_000).toISOString());
  const live=await claimCheckIn(f.app.ctx,user.id);assert.equal(live.balance,20.25);
  await walletTransaction(f.app.ctx,undefined,async db=>{await db.query('UPDATE oaooao_plan_grants SET revoked_at=now() WHERE id=$1',[order]);await revokeMembershipCheckIn(f.app.ctx,user.id,order,db);});
  assert.equal((await getWallet(f.app.ctx,user.id)).pointsBalance,0);
});

test('unused entitlement plans can be deleted, referenced plans remain visible to administrators',async t=>{
  const f=await fixture(t), admin=await f.account(true), other=await f.account();
  const put=(actor:typeof admin,payload:object)=>f.app.inject({method:'PATCH',url:'/api/admin/settings',payload,headers:actor.headers});
  const initial=entitlement('used','unused');
  await f.db.query("UPDATE oaooao_settings SET value=value||$1 WHERE id='global'",[{entitlements:initial,checkIn:{enabled:true,rewardPoints:5,validityDays:0,planRewards:[{planId:'unused',rewardPoints:8,validityDays:0}]}}]);
  const linked=await product(f.db,'used'), missing=await product(f.db,'missing');
  const listing=await f.app.inject({url:'/api/admin/billing/products',headers:admin.headers});
  assert.ok(listing.json().products.find((p:any)=>p.id===missing).saleBlockers.some((reason:string)=>reason.includes('不存在')));
  assert.deepEqual(listing.json().products.find((p:any)=>p.id===linked).saleBlockers,[]);
  assert.ok(!(await f.app.inject({url:'/api/billing/products'})).json().products.some((p:any)=>p.id===missing));
  const stale=await put(admin,{entitlements:entitlement('used')});assert.equal(stale.statusCode,409,stale.body);assert.match(stale.body,/已变化/);
  const denied=await put(admin,{entitlements:entitlement('unused'),entitlementPlanRemovals:['used']});assert.equal(denied.statusCode,409,denied.body);assert.match(denied.body,/关联商品/);
  assert.equal((await put(other,{entitlements:entitlement('used'),entitlementPlanRemovals:['unused']})).statusCode,403);
  const saved=await put(admin,{entitlements:entitlement('used'),entitlementPlanRemovals:['unused']});assert.equal(saved.statusCode,200,saved.body);
  assert.deepEqual(saved.json().settings.entitlements.plans.map((p:any)=>p.id),['free','used']);
  assert.deepEqual(saved.json().settings.checkIn.planRewards,[]);
  assert.equal((await f.db.query('SELECT 1 FROM oaooao_products WHERE id=$1',[linked])).rowCount,1);
});

test('team manager creates a login-ready creator without email verification and cannot overbook seats',async t=>{
  const f=await fixture(t), owner=await f.account(), outsider=await f.account();
  const created=await f.app.inject({method:'POST',url:'/api/teams',payload:{name:'Synthetic team'},headers:owner.headers});
  assert.equal(created.statusCode,200,created.body);
  const team=created.json().team.id,path=`/api/teams/${team}/members`,password='Synthetic-local-pass-9035';
  await f.db.query('UPDATE oaooao_teams SET seat_limit=3 WHERE id=$1',[team]);
  const add=(headers:typeof owner.headers,username:string,email:string)=>f.app.inject({method:'POST',url:path,headers,payload:{username,email,password}});
  assert.equal((await add(outsider.headers,'outside-1','outside@example.invalid')).statusCode,404);
  const added=await add(owner.headers,'synthetic-creator','creator@example.invalid');assert.equal(added.statusCode,201,added.body);
  const id=added.json().member.userId;
  const row=(await f.db.query('SELECT email_verified,policy_accepted_at,password_hash FROM oaooao_users WHERE id=$1',[id])).rows[0];
  assert.equal(row.email_verified,false);assert.equal(row.policy_accepted_at,null);assert.notEqual(row.password_hash,password);
  assert.equal((await add(owner.headers,'synthetic-other','CREATOR@example.invalid')).statusCode,409);
  const login=await f.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:f.config.origin},payload:{username:'synthetic-creator',password}});
  assert.equal(login.statusCode,200,login.body);
  const wire=login.headers['set-cookie']; const cookie=(Array.isArray(wire)?wire[0]:wire)!.split(';')[0];
  assert.equal((await add({origin:f.config.origin,cookie},'another-creator','another@example.invalid')).statusCode,403);
  assert.equal((await add(owner.headers,'synthetic-extra','extra@example.invalid')).statusCode,201);
  assert.equal((await add(owner.headers,'synthetic-overbooked','overbooked@example.invalid')).statusCode,409);
  assert.equal((await f.db.query("SELECT 1 FROM oaooao_users WHERE username='synthetic-overbooked'")).rowCount,0);
});
