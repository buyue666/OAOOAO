import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { ADMIN_PERMISSIONS, hashToken } from '../src/core.js';
import { createJob } from '../src/creative.js';
import { assertPlanGenerationAllowed, GENERATION_KINDS, validatePlanGenerationKinds } from '../src/entitlements.js';
import { adjustWallet, assignAdminPlan, getWallet } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';

test('generation permissions preserve old plans and reject malformed or unsupported choices', () => {
  for (const kind of GENERATION_KINDS) {
    assert.doesNotThrow(() => assertPlanGenerationAllowed({ features: ['legacy-label'] }, kind));
    assert.throws(() => assertPlanGenerationAllowed({ allowedGenerationKinds: [] }, kind), { statusCode: 403 });
    assert.doesNotThrow(() => assertPlanGenerationAllowed({ allowedGenerationKinds: [kind] }, kind));
  }
  for (const value of [null, 'image', ['canvas'], ['image', 'image'], [1], {}]) {
    assert.throws(() => validatePlanGenerationKinds({ allowedGenerationKinds: value }), { statusCode: 400 });
  }
});

test('saved plan capabilities enforce generation and Agent calls before debit, with legacy defaults and idempotent retries', async t => {
  const fixture = await createTestDatabase();
  const app = await buildApp({ db: fixture.db, config: fixture.config });
  await app.ready();
  t.after(async () => { await app.close(); await fixture.cleanup(); });
  const userId = randomUUID(), token = randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused','admin',$2)", [userId, JSON.stringify(ADMIN_PERMISSIONS)]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hashToken(token), userId]);
  const headers = { origin: fixture.config.origin, cookie: `${fixture.config.sessionCookieName}=${token}` };
  const models = ['text', 'image', 'video', 'audio'].map(kind => ({ id: `fixture-${kind}`, name: kind, enabled: true, capability: kind, bindings: [{ id: kind, channelId: 'fixture', upstreamModel: kind, enabled: true, priority: 1 }] }));
  const initial = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: {
    systemChannels: [{ id: 'fixture', name: 'Synthetic provider', baseUrl: 'https://provider.example/v1', apiFormat: 'openai', apiKey: 'synthetic-only', enabled: true, models: models.map(m => m.id) }],
    logicalModels: models, defaultModels: Object.fromEntries(models.map(m => [m.capability + 'Model', m.id])),
    modelPointCosts: Object.fromEntries(models.map(m => [m.id, 2])),
  } });
  assert.equal(initial.statusCode, 200, initial.body);
  await adjustWallet(app.ctx, userId, 'fixture-credit', 100);
  const free = { id: 'free', name: '基础方案', enabled: true, dailyPoints: 0, limits: {}, features: ['legacy-label'], allowedGenerationKinds: ['text'] };
  const pro = { ...free, id: 'pro', name: '视频方案', allowedGenerationKinds: ['video'] };
  const save = async (plans: object[], enabled = true) => app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: { entitlements: { enabled, defaultPlanId: 'free', plans } } });
  let saved = await save([free, pro]);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json().settings.entitlements.plans[0].allowedGenerationKinds, ['text']);
  assert.deepEqual(saved.json().settings.entitlements.plans[0].features, ['legacy-label']);
  assert.equal((await save([{ ...free, allowedGenerationKinds: ['unsupported'] }, pro])).statusCode, 400);
  // A stale imported plan label is not an active assignment and cannot bypass the default plan.
  await fixture.db.query('UPDATE oaooao_users SET plan_id=$2 WHERE id=$1', [userId, 'pro']);
  const blocked = await app.inject({ method: 'POST', url: '/api/video-tasks', headers, payload: { prompt: 'fixture video', config: { model: 'fixture-video' } } });
  assert.equal(blocked.statusCode, 403, blocked.body);
  assert.match(blocked.json().error, /视频生成/);
  assert.equal((await getWallet(app.ctx, userId)).pointsBalance, 100);
  const input = { prompt: 'fixture text', config: { model: 'fixture-text' }, context: {}, source: 'test' };
  const first = await createJob(app.ctx, userId, 'text', input, 'same-request');
  assert.equal((await getWallet(app.ctx, userId)).pointsBalance, 98);
  saved = await save([{ ...free, allowedGenerationKinds: [] }, pro]);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await createJob(app.ctx, userId, 'text', input, 'same-request')).id, first.id, 'Retry only returns the existing task');
  const agent = await app.inject({ method: 'POST', url: '/api/agent/runs', headers, payload: { clientRequestId: 'blocked-agent', prompt: 'fixture plan', surface: 'chat', modelIds: ['fixture-text'] } });
  assert.equal(agent.statusCode, 403, agent.body);
  assert.equal(Number((await fixture.db.query('SELECT count(*) FROM oaooao_agent_runs')).rows[0].count), 0);
  assert.equal((await getWallet(app.ctx, userId)).pointsBalance, 98);
  await assignAdminPlan(app.ctx, userId, 'fixture-assign', 'pro');
  await createJob(app.ctx, userId, 'video', { ...input, config: { model: 'fixture-video' } }, 'allowed-video');
  await assert.rejects(createJob(app.ctx, userId, 'text', input, 'blocked-new-text'), { statusCode: 403 });
  await assert.rejects(createJob(app.ctx, userId, 'render', { shots: [], config: {}, context: {} }, 'blocked-render'), { statusCode: 403 });
  assert.equal((await getWallet(app.ctx, userId)).pointsBalance, 96);
  // Global disable restores prior availability. No permission update changes balances or old jobs.
  assert.equal((await save([free, pro], false)).statusCode, 200);
  await createJob(app.ctx, userId, 'image', { ...input, config: { model: 'fixture-image' } }, 'unrestricted-image');
  assert.equal((await getWallet(app.ctx, userId)).pointsBalance, 94);

  await t.test('paid and free submissions wait for plan revocation before authorizing', async () => {
    for (const cost of [2, 0]) {
      const saved = await save([{ ...free, allowedGenerationKinds: [] }, pro]);
      assert.equal(saved.statusCode, 200, saved.body);
      await fixture.db.query("UPDATE oaooao_settings SET value=jsonb_set(value,'{modelPointCosts,fixture-video}',$1::jsonb) WHERE id='global'", [JSON.stringify(cost)]);
      await assignAdminPlan(app.ctx, userId, `fixture-concurrent-assign-${cost}`, 'pro');
      const beforeBalance = (await getWallet(app.ctx, userId)).pointsBalance;
      const beforeJobs = (await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs WHERE user_id=$1', [userId])).rows[0].count;
      const revoke = await fixture.db.connect(), submission = await fixture.db.connect();
      let pending: Promise<{ error?: unknown; value?: unknown }> | undefined;
      try {
        await revoke.query('BEGIN');
        await revoke.query('SELECT id FROM oaooao_users WHERE id=$1 FOR NO KEY UPDATE', [userId]);
        await revoke.query('DELETE FROM oaooao_admin_plan_assignments WHERE user_id=$1', [userId]);
        await revoke.query('UPDATE oaooao_users SET plan_id=NULL WHERE id=$1', [userId]);
        await submission.query('BEGIN');
        const pid = (await submission.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        pending = createJob(app.ctx, userId, 'video', { ...input, config: { model: 'fixture-video' } }, `revoked-${cost}`, 1, submission)
          .then(value => ({ value }), error => ({ error }));
        let blocked = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          const state = (await fixture.db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
          if (state?.wait_event_type === 'Lock') { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(blocked, true, `Cost ${cost} submission waits on the revocation transaction`);
        await revoke.query('COMMIT');
        const result = await pending;
        assert.equal((result.error as { statusCode?: number } | undefined)?.statusCode, 403);
        await submission.query('ROLLBACK');
      } finally {
        await revoke.query('ROLLBACK');
        if (pending) await pending;
        await submission.query('ROLLBACK');
        revoke.release(); submission.release();
      }
      assert.equal((await getWallet(app.ctx, userId)).pointsBalance, beforeBalance);
      assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs WHERE user_id=$1', [userId])).rows[0].count, beforeJobs);
    }
  });
  await t.test('disabled accounts cannot submit even a free task', async () => {
    await fixture.db.query('UPDATE oaooao_users SET enabled=false WHERE id=$1', [userId]);
    const beforeJobs = (await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs WHERE user_id=$1', [userId])).rows[0].count;
    await assert.rejects(createJob(app.ctx, userId, 'video', { ...input, config: { model: 'fixture-video' } }, 'disabled-free'), { statusCode: 403 });
    assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs WHERE user_id=$1', [userId])).rows[0].count, beforeJobs);
  });
});
