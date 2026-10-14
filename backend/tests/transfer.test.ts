import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestDatabase} from './core-helpers.js';
import {importTransfer,verifyTransfer,type TransferBundle} from '../src/transfer.js';

function fixture():TransferBundle {
  const id=randomUUID(),timestamp='2026-10-01T12:13:14.567Z';
  return {format:'oaooao-normalized-transfer-v1',id:'synthetic-transfer',sourceDigest:'a'.repeat(64),capturedAt:timestamp,records:{
    users:[{id,username:'transfer-user',email:null,display_name:'Synthetic transfer',password_hash:'test-only-not-a-usable-hash',created_at:timestamp,admin_permissions:[]}],
    wallets:[{user_id:id,permanent_balance:'123.4567',daily_balance:'0.0000',daily_allowance:'0.0000',daily_expires_at:null,daily_refresh_date:null,updated_at:timestamp}],
    ledger:[{operation_id:'history:one',user_id:id,requested_delta:'-10.0000',permanent_delta:'-10.0000',daily_delta:'0.0000',permanent_after:'23.4500',daily_after:'0.0000',refund_of:null,metadata:{kind:'imported_history',description:'A historical debit; never apply again'},created_at:timestamp}],
    history:[{id:'historic-job',user_id:id,document:{id:'historic-job',status:'success',prompt:'Synthetic prompt'},created_at:timestamp}],
    settings:[{id:'global',value:{operationMode:'commercial',freeDailyPointsEnabled:false},updated_at:timestamp}],
  },archive:[{entityType:'plan_assignments',entityId:'past-plan',document:{status:'expired',convertedToPermanentPoints:true}}]};
}

test('initial transfer is atomic and concurrent retries never regrant historical credits',async()=>{
  const env=await createTestDatabase();
  try{
    const bundle=fixture();
    const outcomes=await Promise.all([importTransfer(env.db,bundle),importTransfer(env.db,bundle)]);
    assert.deepEqual(outcomes.map(r=>r.replayed).sort(),[false,true]);
    const summary=await verifyTransfer(env.db,bundle);
    assert.equal(summary.permanentPoints,'123.4567');assert.equal(summary.counts.ledger,1);assert.equal(summary.counts.history,1);assert.equal(summary.counts.announcements,0);
    assert.equal((await env.db.query('SELECT permanent_balance FROM oaooao_wallets')).rows[0].permanent_balance,'123.4567');
    assert.equal((await env.db.query('SELECT count(*)::int AS n FROM oaooao_plan_grants')).rows[0].n,0);
    const changed=structuredClone(bundle);changed.records.wallets![0].permanent_balance='200.0000';
    await assert.rejects(importTransfer(env.db,changed),/already has different data/);
    await env.db.query("UPDATE oaooao_wallets SET permanent_balance=124 WHERE user_id=$1",[bundle.records.users![0].id]);
    await assert.rejects(verifyTransfer(env.db,bundle),/wallets.permanent_balance differs/);
    assert.equal((await importTransfer(env.db,bundle)).replayed,true);
    assert.equal((await env.db.query('SELECT permanent_balance FROM oaooao_wallets')).rows[0].permanent_balance,'124.0000');
  }finally{await env.cleanup();}
});

test('invalid foreign references roll back users, wallets, history, archive and transfer marker',async()=>{
  const env=await createTestDatabase();
  try{
    const bundle=fixture();bundle.records.history![0].user_id='missing-account';
    await assert.rejects(importTransfer(env.db,bundle));
    for(const table of ['oaooao_users','oaooao_wallets','oaooao_wallet_operations','oaooao_transfer_runs','oaooao_transfer_archive'])assert.equal((await env.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
    assert.deepEqual((await env.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value,{});
    await importTransfer(env.db,fixture());
  }finally{await env.cleanup();}
});

test('transfer rejects unknown columns and a populated destination',async()=>{
  const env=await createTestDatabase();
  try{
    const bundle=fixture();bundle.records.users![0]['id) VALUES(1); --']='invalid';
    await assert.rejects(importTransfer(env.db,bundle),/Invalid users/);
    await env.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES('existing','existing','test')");
    await assert.rejects(importTransfer(env.db,fixture()),/fresh destination/);
    assert.equal((await env.db.query('SELECT count(*)::int AS n FROM oaooao_users')).rows[0].n,1);
  }finally{await env.cleanup();}
});
