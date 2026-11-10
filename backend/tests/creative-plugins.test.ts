import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';

test('plugin installations are durable, isolated, idempotent and preserve creative data', async t => {
  const fixture = await createTestDatabase(), app = await buildApp({ db: fixture.db, config: fixture.config });
  await app.ready();
  t.after(async () => { await app.close(); await fixture.cleanup(); });
  const accounts = await Promise.all(['one', 'two'].map(async name => {
    const id = randomUUID(), token = randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$2,'synthetic-unused')", [id, name]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hashToken(token), id]);
    return { id, headers: { origin: fixture.config.origin, cookie: `${fixture.config.sessionCookieName}=${token}` } };
  }));
  const call = (index: number, method: 'GET' | 'PATCH', payload?: unknown) => app.inject({ method, url: '/api/account/plugins', headers: accounts[index].headers, ...(payload ? { payload } : {}) });
  assert.equal((await app.inject({ method: 'GET', url: '/api/account/plugins' })).statusCode, 401);
  assert.deepEqual((await call(0, 'GET')).json().installedPlugins, []);
  for (const payload of [{ pluginId: 'unknown', installed: true }, { pluginId: 'canvas', installed: 'true' }, { pluginId: 'canvas', installed: true, userId: accounts[1].id }])
    assert.equal((await call(0, 'PATCH', payload)).statusCode, 400);

  const created = await app.inject({ method: 'POST', url: '/api/canvas/projects', headers: accounts[0].headers, payload: { title: 'Synthetic retained canvas' } });
  assert.equal(created.statusCode, 200, created.body);
  const projectId = created.json().data.project.id;
  const before = await fixture.db.query('SELECT * FROM oaooao_projects WHERE id=$1', [projectId]);
  for (let retry = 0; retry < 2; retry++) {
    const result = await call(0, 'PATCH', { pluginId: 'director', installed: true });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json().installedPlugins, ['canvas', 'director']);
  }
  assert.deepEqual((await call(1, 'GET')).json().installedPlugins, []);
  const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: accounts[0].headers });
  assert.deepEqual(session.json().settings.installedPlugins, ['canvas', 'director']);
  assert.deepEqual((await call(0, 'PATCH', { pluginId: 'director', installed: false })).json().installedPlugins, ['canvas']);
  await call(0, 'PATCH', { pluginId: 'director', installed: true });
  assert.deepEqual((await call(0, 'PATCH', { pluginId: 'canvas', installed: false })).json().installedPlugins, []);
  assert.deepEqual((await fixture.db.query('SELECT * FROM oaooao_projects WHERE id=$1', [projectId])).rows, before.rows);

  await Promise.all(['remix', 'tryon', 'agent', 'drama'].map(pluginId => call(0, 'PATCH', { pluginId, installed: true })));
  assert.deepEqual((await call(0, 'GET')).json().installedPlugins, ['agent', 'drama', 'remix', 'tryon']);
  assert.deepEqual((await call(1, 'GET')).json().installedPlugins, []);
});
