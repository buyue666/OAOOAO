import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { claimCheckIn, getCheckInStatus, normalizeCheckInSettings, validateCheckInSettings } from '../src/check-in.js';
import { createContext, hashToken } from '../src/core.js';
import { getWallet } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

test('check-in settings default to disabled and reject malformed grants', () => {
  assert.deepEqual(normalizeCheckInSettings(undefined), { enabled: false, rewardPoints: 10,validityDays:0,planRewards:[] });
  assert.deepEqual(normalizeCheckInSettings({ enabled: true, rewardPoints: -1 }), { enabled: false, rewardPoints: 10,validityDays:0,planRewards:[] });
  assert.deepEqual(validateCheckInSettings({ enabled: true, rewardPoints: 10 }), { enabled: true, rewardPoints: 10,validityDays:0,planRewards:[] });
  for (const bad of [null, [], { enabled: 1, rewardPoints: 10 }, { enabled: true, rewardPoints: 0 }, { enabled: true, rewardPoints: 0.1 }, { enabled: true, rewardPoints: 1_000_001 }, { enabled: true, rewardPoints: '10' }, { enabled: true, rewardPoints: 10, date: '2026-10-14' }]) {
    assert.throws(() => validateCheckInSettings(bad), { statusCode: 400 });
  }
});

test('isolated PostgreSQL: manual check-in is permanent, atomic and once per Shanghai day', async t => {
  const fixture = await createTestDatabase(); t.after(fixture.cleanup);
  const ctx = createContext(fixture.db, fixture.config);
  async function user() { const id = randomUUID(); await ctx.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$1,$2)', [id, 'synthetic-unused']); return id; }
  async function config(enabled: boolean, rewardPoints = 10, daily = 0) {
    await ctx.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'", [{ checkIn: { enabled, rewardPoints }, freeDailyPointsEnabled: daily > 0, freeDailyPoints: daily }]);
  }
  const clock = () => new Date('2026-10-14T12:00:00Z');
  await t.test('disabled and status-only requests never create claims or credits', async () => {
    const id = await user(); const state = await getCheckInStatus(ctx, id, clock);
    assert.deepEqual(state, { enabled: false, rewardPoints: 10,validityDays:0,rulePlanId:null,rulePlanName:null, claimed: false, date: '2026-10-14', timeZone: 'Asia/Shanghai',claimedRewardPoints:null,claimedValidityDays:null,claimedPlanId:null,claimedPlanName:null,expiresAt:null });
    await assert.rejects(claimCheckIn(ctx, id, clock), { statusCode: 409, outcome: 'rejected' });
    assert.equal((await ctx.db.query('SELECT 1 FROM oaooao_wallets WHERE user_id=$1', [id])).rowCount, 0);
    assert.equal((await ctx.db.query('SELECT 1 FROM oaooao_check_ins WHERE user_id=$1', [id])).rowCount, 0);
  });
  await t.test('24 simultaneous requests produce one permanent grant and audit; daily allowance is independent', async () => {
    await config(true, 10, 3); const id = await user();
    const responses = await Promise.all(Array.from({ length: 24 }, () => claimCheckIn(ctx, id, clock)));
    assert.ok(responses.every(item => item.claimed && item.balance === 13));
    const wallet = await getWallet(ctx, id); assert.equal(wallet.permanentPointsBalance, 10); assert.equal(wallet.dailyPointsBalance, 3);
    const claims = await ctx.db.query('SELECT * FROM oaooao_check_ins WHERE user_id=$1', [id]); assert.equal(claims.rowCount, 1);
    const ledger = await ctx.db.query("SELECT * FROM oaooao_wallet_operations WHERE user_id=$1 AND metadata->>'kind'='check_in'", [id]);
    assert.equal(ledger.rowCount, 1); assert.equal(ledger.rows[0].permanent_delta, '10.0000'); assert.equal(ledger.rows[0].daily_delta, '0.0000'); assert.equal(ledger.rows[0].metadata.type, 'grant');
    assert.equal((await ctx.db.query("SELECT 1 FROM oaooao_audit_logs WHERE actor_id=$1 AND action='account.check_in'", [id])).rowCount, 1);
    await config(true, 99); assert.equal((await claimCheckIn(ctx, id, clock)).balance, 13);
    await config(false); const repeat = await claimCheckIn(ctx, id, clock); assert.equal(repeat.enabled, false); assert.equal(repeat.claimed, true); assert.equal(repeat.balance, 13);
  });
  await t.test('Shanghai midnight opens a new claim while UTC midnight alone does not', async () => {
    await config(true); const id = await user();
    const before = () => new Date('2026-10-14T15:59:59.999Z');
    const after = () => new Date('2026-10-14T16:00:00.000Z');
    assert.equal((await claimCheckIn(ctx, id, before)).date, '2026-10-14');
    assert.equal((await getCheckInStatus(ctx, id, after)).claimed, false);
    const tomorrow = await claimCheckIn(ctx, id, after); assert.equal(tomorrow.date, '2026-10-15'); assert.equal(tomorrow.balance, 20);
    assert.equal((await claimCheckIn(ctx, id, () => new Date('2026-10-15T00:00:00Z'))).balance, 20);
    const other = await user(); assert.equal((await getCheckInStatus(ctx, other, after)).claimed, false); assert.equal((await claimCheckIn(ctx, other, after)).balance, 10);
  });
  await t.test('a downstream failure rolls back claim, wallet credit, ledger and audit together', async () => {
    await config(true); const id = await user();
    const failing = { ...ctx, audit: async () => { throw new Error('Synthetic audit failure'); } };
    await assert.rejects(claimCheckIn(failing, id, clock), /Synthetic audit failure/);
    for (const table of ['oaooao_check_ins', 'oaooao_wallet_operations', 'oaooao_wallets']) assert.equal((await ctx.db.query(`SELECT 1 FROM ${table} WHERE user_id=$1`, [id])).rowCount, 0);
    assert.equal((await claimCheckIn(ctx, id, clock)).balance, 10);
  });
});

test('isolated PostgreSQL: check-in HTTP route authenticates, checks CSRF, ignores client grant instructions, and gates configuration', async t => {
  const fixture = await createTestDatabase(); const app = await buildApp({ db: fixture.db, config: fixture.config, coreOnly: true });
  t.after(async () => { await app.close(); await fixture.cleanup(); });
  async function actor(permissions?: string[]) {
    const id = randomUUID(), token = randomBytes(32).toString('base64url');
    await fixture.db.query('INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,$2,$3,$4)', [id, 'synthetic-unused', permissions ? 'admin' : 'user', JSON.stringify(permissions ?? [])]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hashToken(token), id]);
    return { id, headers: { cookie: `${fixture.config.sessionCookieName}=${token}`, origin: fixture.config.origin } };
  }
  const buyer = await actor(), commerce = await actor(['commerce.manage']), system = await actor(['system.manage']);
  assert.equal((await app.inject({ url: '/api/account/check-in' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/account/check-in', headers: { ...buyer.headers, origin: 'https://untrusted.invalid' } })).statusCode, 403);
  const disabled = await app.inject({ method: 'POST', url: '/api/account/check-in', headers: buyer.headers }); assert.equal(disabled.statusCode, 409);
  const patch = { checkIn: { enabled: true, rewardPoints: 17 } };
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: system.headers, payload: patch })).statusCode, 403);
  const enabled = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: commerce.headers, payload: patch }); assert.equal(enabled.statusCode, 200, enabled.body);
  const invalid = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: commerce.headers, payload: { checkIn: { rewardPoints: -1 } } }); assert.equal(invalid.statusCode, 400);
  const session = await app.inject({ url: '/api/auth/session', headers: buyer.headers }); assert.deepEqual(session.json().settings.checkIn, {...patch.checkIn,validityDays:0,planRewards:[]});
  const replies = await Promise.all(Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: '/api/account/check-in', headers: buyer.headers, payload: { userId: commerce.id, rewardPoints: 999999, date: '2000-01-01' } })));
  assert.ok(replies.every(reply => reply.statusCode === 200), replies.map(reply => reply.body).join('\n'));
  assert.ok(replies.every(reply => reply.json().balance === 17));
  assert.equal((await app.inject({ url: '/api/account/check-in', headers: buyer.headers })).json().claimed, true);
  assert.equal((await app.inject({ url: '/api/account/check-in', headers: commerce.headers })).json().claimed, false);
  assert.equal((await fixture.db.query('SELECT 1 FROM oaooao_check_ins WHERE user_id=$1', [commerce.id])).rowCount, 0);
});
