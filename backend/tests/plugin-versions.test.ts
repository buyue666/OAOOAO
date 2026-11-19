import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { createTestDatabase } from './core-helpers.js';
import { migrate } from '../src/migrate.js';

test('director version pinning is durable, authenticated, isolated and defaults to manual updates', async t => {
  const fixture = await createTestDatabase(), app = await buildApp({ db: fixture.db, config: fixture.config });
  await app.ready(); t.after(async () => { await app.close(); await fixture.cleanup(); });
  const users = await Promise.all(['version-one','version-two'].map(async username => {
    const id = randomUUID(), token = randomBytes(32).toString('base64url');
    await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$2,'synthetic-unused')", [id, username]);
    await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hashToken(token),id]);
    return { id, headers: { origin: fixture.config.origin, cookie: `${fixture.config.sessionCookieName}=${token}` } };
  }));
  const call = (i: number, payload?: unknown) => app.inject({ method: payload ? 'PATCH' : 'GET', url: '/api/account/plugins', headers: users[i].headers, ...(payload ? { payload } : {}) });
  assert.equal((await app.inject({ method:'PATCH', url:'/api/account/plugins', payload:{pluginId:'director',version:'0.1.0'} })).statusCode,401);
  assert.equal((await call(0,{pluginId:'director',version:'0.1.0'})).statusCode,409);
  const installed = await call(0,{pluginId:'director',installed:true});
  assert.deepEqual(installed.json().pluginPreferences,{director:{version:'0.1.0',autoUpdate:false}});
  await call(1,{pluginId:'director',installed:true});
  for (const version of ['0.1.0']) {
    const response = await call(0,{pluginId:'director',version});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual((await call(0)).json().pluginPreferences.director,{version,autoUpdate:false});
  }
  for (const payload of [
    {pluginId:'director',version:'https://untrusted.example/index.html'},
    {pluginId:'director',version:'9.9.9'}, {pluginId:'director',version:'0.1.0',userId:users[1].id},
    {pluginId:'canvas',version:'0.1.0'}, {pluginId:'director',autoUpdate:'true'},
    {pluginId:'director',version:'0.1.0',installed:true},
  ]) assert.equal((await call(0,payload)).statusCode,400);
  assert.deepEqual((await call(0)).json().pluginPreferences.director,{version:'0.1.0',autoUpdate:false});
  assert.deepEqual((await call(1)).json().pluginPreferences.director,{version:'0.1.0',autoUpdate:false});
  assert.deepEqual((await call(0,{pluginId:'director',autoUpdate:true})).json().pluginPreferences.director,{version:'0.1.0',autoUpdate:true});
  assert.deepEqual((await call(0,{pluginId:'director',autoUpdate:false})).json().pluginPreferences.director,{version:'0.1.0',autoUpdate:false});
  await call(0,{pluginId:'director',version:'0.1.0'});
  const session = await app.inject({method:'GET',url:'/api/auth/session',headers:users[0].headers});
  assert.deepEqual(session.json().settings.pluginPreferences.director,{version:'0.1.0',autoUpdate:false});
  await call(0,{pluginId:'canvas',installed:false});
  assert.deepEqual((await call(0)).json().installedPlugins,['agent']);
  assert.equal((await call(0,{pluginId:'director',version:'0.1.0'})).statusCode,409);
  await call(0,{pluginId:'director',installed:true});
  assert.deepEqual((await call(0)).json().pluginPreferences.director,{version:'0.1.0',autoUpdate:false});
  assert.deepEqual((await call(0)).json().installedPlugins,['agent','canvas','director']);
  await migrate(fixture.db);
  assert.deepEqual((await call(0)).json().pluginPreferences.director,{version:'0.1.0',autoUpdate:false});
});

test('version migration preserves existing director 0.1.0 without changing scene documents', async t => {
  const fixture = await createTestDatabase(); t.after(fixture.cleanup);
  const id = randomUUID();
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,'legacy-version','synthetic-unused')",[id]);
  await fixture.db.query("INSERT INTO oaooao_account_plugins(user_id,plugin_id) VALUES($1,'director')",[id]);
  await fixture.db.query("ALTER TABLE oaooao_account_plugins DROP COLUMN plugin_version, DROP COLUMN auto_update; DELETE FROM oaooao_migrations WHERE name='023-plugin-versions.sql'");
  await migrate(fixture.db);
  assert.deepEqual((await fixture.db.query("SELECT plugin_version,auto_update FROM oaooao_account_plugins WHERE user_id=$1 AND plugin_id='director'",[id])).rows,[{plugin_version:'0.1.0',auto_update:false}]);
});
