import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';
import { migrate } from '../src/migrate.js';

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
  assert.deepEqual((await call(0, 'GET')).json().installedPlugins, ['agent', 'canvas']);
  for (const payload of [{ pluginId: 'unknown', installed: true }, { pluginId: 'canvas', installed: 'true' }, { pluginId: 'canvas', installed: true, userId: accounts[1].id }])
    assert.equal((await call(0, 'PATCH', payload)).statusCode, 400);

  const created = await app.inject({ method: 'POST', url: '/api/canvas/projects', headers: accounts[0].headers, payload: { title: 'Synthetic retained canvas' } });
  assert.equal(created.statusCode, 200, created.body);
  const projectId = created.json().data.project.id;
  const before = await fixture.db.query('SELECT * FROM oaooao_projects WHERE id=$1', [projectId]);
  for (let retry = 0; retry < 2; retry++) {
    const result = await call(0, 'PATCH', { pluginId: 'director', installed: true });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json().installedPlugins, ['agent', 'canvas', 'director']);
  }
  assert.deepEqual((await call(1, 'GET')).json().installedPlugins, ['agent', 'canvas']);
  const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: accounts[0].headers });
  assert.deepEqual(session.json().settings.installedPlugins, ['agent', 'canvas', 'director']);
  assert.deepEqual((await call(0, 'PATCH', { pluginId: 'director', installed: false })).json().installedPlugins, ['agent', 'canvas']);
  await call(0, 'PATCH', { pluginId: 'director', installed: true });
  assert.deepEqual((await call(0, 'PATCH', { pluginId: 'canvas', installed: false })).json().installedPlugins, ['agent']);
  assert.deepEqual((await call(0, 'PATCH', { pluginId: 'agent', installed: false })).json().installedPlugins, []);
  await migrate(fixture.db);
  assert.deepEqual((await call(0, 'GET')).json().installedPlugins, []);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/auth/session', headers: accounts[0].headers })).json().settings.installedPlugins, []);
  assert.deepEqual((await fixture.db.query('SELECT * FROM oaooao_projects WHERE id=$1', [projectId])).rows, before.rows);

  await Promise.all(['remix', 'tryon', 'agent', 'drama'].map(pluginId => call(0, 'PATCH', { pluginId, installed: true })));
  assert.deepEqual((await call(0, 'GET')).json().installedPlugins, ['agent', 'drama', 'remix', 'tryon']);
  assert.deepEqual((await call(1, 'GET')).json().installedPlugins, ['agent', 'canvas']);
});

test('default plugin migration backfills legacy accounts once and preserves existing installations', async t => {
  const fixture = await createTestDatabase();
  t.after(fixture.cleanup);
  // Recreate the pre-019 schema only inside this disposable synthetic fixture.
  await fixture.db.query(`
    DROP TRIGGER oaooao_users_install_default_creative_plugins ON oaooao_users;
    DROP FUNCTION oaooao_install_default_creative_plugins();
    DELETE FROM oaooao_migrations WHERE name='019-default-creative-plugins.sql';
  `);
  const legacy = randomUUID(), partial = randomUUID();
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,'legacy','synthetic-unused'),($2,'partial','synthetic-unused')", [legacy, partial]);
  await fixture.db.query("INSERT INTO oaooao_account_plugins(user_id,plugin_id,installed_at) VALUES($1,'canvas','2026-01-01T00:00:00Z'),($1,'tryon','2026-01-01T00:00:00Z')", [partial]);
  const list = async (userId: string) => (await fixture.db.query('SELECT plugin_id FROM oaooao_account_plugins WHERE user_id=$1 ORDER BY plugin_id', [userId])).rows.map(row => row.plugin_id);
  await migrate(fixture.db);
  assert.deepEqual(await list(legacy), ['agent', 'canvas']);
  assert.deepEqual(await list(partial), ['agent', 'canvas', 'tryon']);
  assert.equal((await fixture.db.query("SELECT installed_at FROM oaooao_account_plugins WHERE user_id=$1 AND plugin_id='canvas'", [partial])).rows[0].installed_at.toISOString(), '2026-01-01T00:00:00.000Z');

  await fixture.db.query("DELETE FROM oaooao_account_plugins WHERE user_id=$1 AND plugin_id IN ('agent','canvas')", [partial]);
  await fixture.db.query("UPDATE oaooao_users SET display_name='Updated profile' WHERE id=$1", [partial]);
  await migrate(fixture.db);
  assert.deepEqual(await list(partial), ['tryon']);
  assert.deepEqual(await list(legacy), ['agent', 'canvas']);

  const newcomer = randomUUID();
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role) VALUES($1,'new-admin','synthetic-unused','admin')", [newcomer]);
  assert.deepEqual(await list(newcomer), ['agent', 'canvas']);
});
