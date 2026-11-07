import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { ADMIN_PERMISSIONS, hashToken } from '../src/core.js';
import { invokeProvider } from '../src/providers.js';
import { processNextJob } from '../src/worker.js';
import { MAX_VIDEO_BYTES, ownedMedia } from '../src/media.js';
import { storageUsage } from '../src/storage-quota.js';
import { createTestDatabase } from './core-helpers.js';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=', 'base64');
const audio = Buffer.from('ID3 synthetic audio content');
const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(24)]);
type Actor = { id: string; headers: Record<string, string> };

async function fixture(t: any) {
  const f = await createTestDatabase(), app = await buildApp({ db: f.db, config: f.config });
  app.addHook('onError', async (_request, _reply, error) => { if (!('statusCode' in error) || Number(error.statusCode) >= 500) t.diagnostic(error.message) });
  await app.ready(); t.after(async () => { await app.close(); await f.cleanup() });
  const actors: Record<string, Actor> = {};
  for (const [name, role, permissions] of [
    ['admin', 'admin', ADMIN_PERMISSIONS], ['commerce', 'admin', ['commerce.manage']], ['billing', 'admin', ['billing.manage']],
    ['owner', 'user', []], ['creator', 'user', []], ['reviewer', 'user', []], ['outsider', 'user', []],
  ] as const) {
    const id = randomUUID(), token = randomBytes(32).toString('base64url');
    await f.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES($1,$1,'synthetic-unused',$2,$3)", [id, role, JSON.stringify(permissions)]);
    await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hashToken(token), id]);
    actors[name] = { id, headers: { origin: f.config.origin, cookie: `${f.config.sessionCookieName}=${token}` } };
  }
  const req = (actor: string, method: any, url: string, payload?: any, extra: Record<string, string> = {}) => app.inject({ method, url, headers: { ...actors[actor].headers, ...extra }, ...(payload === undefined ? {} : { payload }) });
  const created = await req('owner', 'POST', '/api/teams', { name: '隔离测试团队' });
  assert.equal(created.statusCode, 200, created.body); const team = created.json().team;
  for (const role of ['creator', 'reviewer']) await f.db.query('INSERT INTO oaooao_team_members(team_id,user_id,role) VALUES($1,$2,$3)', [team.id, actors[role].id, role]);
  const projectResponse = await req('owner', 'POST', `/api/teams/${team.id}/projects`, { title: '隔离测试项目', visibility: 'restricted', memberIds: [actors.creator.id, actors.reviewer.id] });
  assert.equal(projectResponse.statusCode, 200, projectResponse.body); const project = projectResponse.json().project;
  const channel = { id: 'synthetic', name: 'Synthetic only', enabled: true, baseUrl: 'https://provider.example/v1', apiFormat: 'openai', apiKey: app.ctx.encrypt('synthetic-unused'), storeGeneratedMedia: false };
  const models = ['image', 'video', 'audio', 'text'].map(kind => ({ id: kind, name: kind, capability: kind, enabled: true, bindings: [{ id: kind, channelId: channel.id, upstreamModel: kind, enabled: true, priority: 0 }] }));
  await f.db.query("UPDATE oaooao_settings SET value=value||$1 WHERE id='global'", [{ logicalModels: models, systemChannels: [channel], modelPointCosts: { image: 1, video: 1, audio: 1, text: 1 } }]);
  const root = `/api/teams/${team.id}/projects/${project.id}`;
  const raw = (kind = 'image', prompt = 'Synthetic local generation') => ({ kind, prompt, config: { model: kind, n: 1 }, references: [], approvedCost: 1 });
  const subscribe = (actor = 'admin', operationId = 'synthetic-subscription') => req(actor, 'POST', `/api/admin/teams/${team.id}/subscription`, { operationId, planId: 'team-standard', seats: 2, reason: '隔离测试人工开通', confirmManualGrant: true });
  const publish = () => req('commerce', 'PATCH', '/api/admin/team-plans/team-standard', { enabled: true, priceCents: 999, pointsPerSeat: 100, storageBytes: 1024 ** 3, modelIds: ['image', 'video', 'audio', 'text'] });
  return { ...f, app, ctx: app.ctx, actors, req, team, project, root, raw, publish, subscribe };
}

test('team and project APIs enforce current membership, project ACLs and optimistic versions', async t => {
  const f = await fixture(t), root = `/api/teams/${f.team.id}`;
  for (const name of ['outsider', 'admin']) {
    assert.equal((await f.req(name, 'GET', root)).statusCode, 404, 'Site administration does not grant ordinary team membership');
    assert.equal((await f.req(name, 'GET', f.root)).statusCode, 404);
  }
  assert.equal((await f.req('reviewer', 'PATCH', f.root, { version: 1, title: 'Forbidden' })).statusCode, 403);
  assert.equal((await f.req('creator', 'PATCH', f.root, { version: 1, visibility: 'team' })).statusCode, 403);
  const changed = await f.req('creator', 'PATCH', f.root, { version: 1, title: '新的项目名称' });
  assert.equal(changed.statusCode, 200, changed.body); assert.equal(changed.json().project.version, 2);
  assert.equal((await f.req('owner', 'PATCH', f.root, { version: 1, title: 'Stale update' })).statusCode, 409);
  await f.req('owner', 'DELETE', `${root}/members/${f.actors.creator.id}`);
  assert.equal((await f.req('creator', 'GET', f.root)).statusCode, 404);
  const assignments = await f.db.query('SELECT 1 FROM oaooao_team_project_members WHERE project_id=$1 AND user_id=$2', [f.project.id, f.actors.creator.id]);
  assert.equal(assignments.rowCount, 0);
});

test('team administration separates commerce and billing permissions and keeps manual grants idempotent', async t => {
  const f = await fixture(t);
  assert.equal((await f.req('billing', 'GET', '/api/admin/team-plans')).statusCode, 403);
  assert.equal((await f.req('commerce', 'GET', '/api/admin/teams')).statusCode, 403);
  assert.equal((await f.req('commerce', 'GET', '/api/admin/team-plans')).statusCode, 200);
  assert.equal((await f.publish()).statusCode, 200);
  assert.equal((await f.subscribe('commerce')).statusCode, 403);
  for (let n = 0; n < 2; n++) { const result = await f.subscribe('billing'); assert.equal(result.statusCode, 200, result.body) }
  const usage = await f.req('owner', 'GET', `/api/teams/${f.team.id}/usage`);
  assert.equal(usage.statusCode, 200, usage.body); assert.equal(usage.json().balance, 200);
  assert.equal((await f.subscribe('billing', 'another-subscription')).statusCode, 409, 'Active periods cannot be re-granted');
  const credits = { operationId: 'synthetic-extra-credits', amount: '3.0001', expiresAt: null, reason: '隔离测试额外积分' };
  for (let n = 0; n < 2; n++) assert.equal((await f.req('billing', 'POST', `/api/admin/teams/${f.team.id}/credits`, credits)).statusCode, 200);
  assert.equal((await f.req('billing', 'POST', `/api/admin/teams/${f.team.id}/credits`, { ...credits, amount: 4 })).statusCode, 409);
  assert.equal((await f.req('owner', 'GET', `/api/teams/${f.team.id}/usage`)).json().balance, 203.0001);
  const search = await f.req('billing', 'GET', '/api/admin/teams?page=1&pageSize=1&keyword=' + encodeURIComponent('隔离测试'));
  assert.equal(search.statusCode, 200, search.body); assert.equal(search.json().total, 1); assert.equal(search.json().teams.length, 1);
  assert.equal((await f.req('billing', 'GET', '/api/admin/teams?keyword=no-match')).json().total, 0);
  const detail = (await f.req('owner', 'GET', `/api/teams/${f.team.id}`)).json().team;
  assert.deepEqual(detail.modelIds, ['image', 'video', 'audio', 'text']);
});

test('quotes never debit; simultaneous retries charge once and cancellation restores the original team budget', async t => {
  const f = await fixture(t); await f.publish(); await f.subscribe();
  const quote = await f.req('creator', 'POST', f.root + '/generations/quote', f.raw());
  assert.equal(quote.statusCode, 200, quote.body); assert.equal(quote.json().points, 1);
  assert.equal((await f.db.query('SELECT count(*) n FROM oaooao_generation_jobs')).rows[0].n, '0');
  const key = { 'idempotency-key': 'synthetic-double-submit' };
  const [a, b] = await Promise.all([f.req('creator', 'POST', f.root + '/generations', f.raw(), key), f.req('creator', 'POST', f.root + '/generations', f.raw(), key)]);
  assert.equal(a.statusCode, 202, a.body); assert.equal(b.statusCode, 202, b.body); assert.equal(a.json().task.id, b.json().task.id);
  assert.equal((await f.req('creator', 'POST', f.root + '/generations', f.raw('image', 'Changed prompt'), key)).statusCode, 409);
  const usage = () => f.req('owner', 'GET', `/api/teams/${f.team.id}/usage`);
  assert.equal((await usage()).json().balance, 199);
  const tasks = (await f.req('owner', 'GET', f.root + '/generations')).json().tasks;
  assert.equal(tasks[0].actorId, f.actors.creator.id);
  assert.equal((await f.req('reviewer', 'POST', f.root + '/generations', f.raw(), { 'idempotency-key': 'reviewer-forbidden' })).statusCode, 403);
  for (let n = 0; n < 2; n++) assert.equal((await f.req('creator', 'POST', `${f.root}/generations/${a.json().task.id}/cancel`)).statusCode, 200);
  assert.equal((await usage()).json().balance, 200);
  const memberUsage = (await f.req('creator', 'GET', `/api/teams/${f.team.id}/usage`)).json(); assert.equal(memberUsage.mySpent, 0);
  assert.equal((await f.db.query('SELECT count(*) n FROM oaooao_wallet_operations WHERE user_id=$1', [f.actors.creator.id])).rows[0].n, '0');
  await f.db.query('UPDATE oaooao_team_members SET monthly_limit=1 WHERE team_id=$1 AND user_id=$2', [f.team.id, f.actors.creator.id]);
  await f.db.query('UPDATE oaooao_teams SET member_concurrency=2 WHERE id=$1', [f.team.id]);
  const limited = await Promise.all(['budget-a', 'budget-b'].map(key => f.req('creator', 'POST', f.root + '/generations', f.raw(), { 'idempotency-key': 'synthetic-' + key })));
  assert.deepEqual(limited.map(result => result.statusCode).sort(), [202, 402]);
});

test('worker stores every binary result in the original team after the actor leaves, with no personal storage fallback', async t => {
  const f = await fixture(t); await f.publish(); await f.subscribe();
  for (const kind of ['audio', 'video', 'image']) {
    const result = await f.req('creator', 'POST', f.root + '/generations', f.raw(kind), { 'idempotency-key': 'synthetic-media-' + kind });
    assert.equal(result.statusCode, 202, result.body);
    // Remove a prior queued job from concurrency counts while preparing this test.
    await f.db.query("UPDATE oaooao_teams SET member_concurrency=3 WHERE id=$1", [f.team.id]);
  }
  assert.equal((await f.req('owner', 'DELETE', `/api/teams/${f.team.id}/members/${f.actors.creator.id}`)).statusCode, 200);
  const transport = async (url: string | URL, options: any) => {
    const path = String(url);
    if (path.endsWith('/audio/speech')) return new Response(audio);
    if (path.endsWith('/content')) { assert.equal(options.maxBytes, MAX_VIDEO_BYTES); return new Response(video) }
    return new Response(JSON.stringify(path.endsWith('/videos') ? { id: 'synthetic-upstream', status: 'completed' } : { data: [{ b64_json: pixel.toString('base64') }] }), { headers: { 'content-type': 'application/json' } });
  };
  for (let n = 0; n < 3; n++) assert.equal(await processNextJob(f.ctx, (ctx, job, poll) => invokeProvider(ctx, job, poll, transport as any)), true);
  const rows = (await f.db.query('SELECT * FROM oaooao_team_assets WHERE team_id=$1 ORDER BY kind', [f.team.id])).rows;
  assert.deepEqual(rows.map(row => row.kind), ['audio', 'image', 'video']); assert.ok(rows.every(row => row.status === 'ready' && row.project_id === f.project.id));
  assert.equal((await f.db.query('SELECT count(*) n FROM oaooao_media')).rows[0].n, '0');
  assert.equal((await storageUsage(f.ctx, f.actors.creator.id)).usedBytes, 0);
  for (const row of rows) {
    const url = `/api/teams/${f.team.id}/assets/${row.id}/content`;
    assert.equal((await f.req('owner', 'GET', url)).statusCode, 200);
    assert.equal((await f.req('creator', 'GET', url)).statusCode, 404, 'Former members cannot read team assets');
    assert.equal((await f.req('outsider', 'GET', url)).statusCode, 404);
    assert.equal((await f.req('reviewer', 'GET', url)).statusCode, 200);
    assert.equal((await f.req('reviewer', 'GET', url + '?download=1')).statusCode, 403);
    await assert.rejects(ownedMedia(f.ctx, f.actors.creator.id, row.id), { statusCode: 404 });
  }
  const tasks = (await f.req('owner', 'GET', f.root + '/generations')).json().tasks;
  assert.ok(tasks.every((task: any) => task.status === 'success' && JSON.stringify(task.result).includes(`/api/teams/${f.team.id}/assets/`)));
});

test('insufficient team storage refuses generated audio rather than silently consuming personal capacity', async t => {
  const f = await fixture(t); await f.publish(); await f.subscribe();
  await f.db.query('UPDATE oaooao_teams SET storage_quota_bytes=1 WHERE id=$1', [f.team.id]);
  const job = { kind: 'audio', channel_id: 'synthetic', user_id: f.actors.creator.id, upstream_model: 'synthetic-audio', provider_config: { baseUrl: 'https://provider.example/v1', apiKey: f.ctx.encrypt('synthetic') }, input: { prompt: 'Synthetic speech', config: {} } };
  await assert.rejects(invokeProvider({ ...f.ctx, workspace: { teamId: f.team.id, projectId: f.project.id } }, job, false, async () => new Response(audio)), { statusCode: 413 });
  assert.equal((await f.db.query('SELECT count(*) n FROM oaooao_media')).rows[0].n, '0');
  assert.equal((await f.db.query('SELECT count(*) n FROM oaooao_team_assets')).rows[0].n, '0');
});
