import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/core.js';
import { adjustWallet, getWallet } from '../src/wallet.js';
import { createTestDatabase } from './core-helpers.js';
import { applyDramaProposal, parseDramaProposal } from '../src/drama-production.js';
import { saveMedia } from '../src/media.js';

const base = () => ({ summary: '合成故事', characters: [{ id: 'c1', name: '人物甲', description: '保留的用户设定', referenceImageUrl: '/owned-original', profile: { consistencyRules: '保留规则' } }], scenes: [{ id: 's1', name: '场景甲' }], props: [], episodes: [{ id: 'e1', title: '第一集', outline: '合成大纲', script: '旧剧本', shots: [{ id: 'shot1', title: '旧镜头', videoUrl: '/owned-video', storyboardTaskId: 'existing-task' }] }] });
const storyboard = { shots: [{ title: '合成镜头', description: '人物甲走进房间', shotSize: '中景', cameraAngle: '平视', cameraMotion: '缓慢推进', duration: 5, imagePrompt: 'Synthetic static frame', videoPrompt: 'Synthetic camera movement', characterIds: ['c1'], sceneId: 's1', propIds: [], videoUrl: 'https://untrusted.invalid/forged.mp4', id: 'forged', generationStatus: 'success' }] };

test('editorial proposals validate references and discard model-supplied state, IDs and URLs', () => {
  const result = parseDramaProposal('storyboard', JSON.stringify(storyboard), base());
  assert.equal(result.shots[0].duration, 5); assert.deepEqual(result.shots[0].characterIds, ['c1']);
  for (const field of ['videoUrl', 'id', 'generationStatus']) assert.equal(result.shots[0][field], undefined);
  for (const content of ['not-json', 'null', '[]', '{}']) assert.throws(() => parseDramaProposal('storyboard', content, base()));
  for (const duration of [0, -1, 121, 'NaN']) assert.throws(() => parseDramaProposal('storyboard', JSON.stringify({ shots: [{ ...storyboard.shots[0], duration }] }), base()));
  assert.throws(() => parseDramaProposal('storyboard', JSON.stringify({ shots: [{ ...storyboard.shots[0], characterIds: ['foreign'] }] }), base()));
  assert.throws(() => parseDramaProposal('storyboard', JSON.stringify({ shots: [{ ...storyboard.shots[0], sceneId: 'foreign' }] }), base()));
});

test('adoption preserves authored entity settings, existing episodes and media; destructive replacements are rejected', () => {
  const original = base();
  const assets = parseDramaProposal('assets', JSON.stringify({ characters: [{ name: '人物甲', description: 'AI 改写', prompt: 'different', visualIdentity: 'new' }, { name: '人物乙', description: '新人物', prompt: 'new' }], scenes: [], props: [] }), original);
  const next = applyDramaProposal(original, 'assets', assets, 'task-a', 'e1');
  assert.equal(next.characters.length, 2); assert.deepEqual(next.characters[0], original.characters[0]); assert.deepEqual(original, base());
  const shots = parseDramaProposal('storyboard', JSON.stringify(storyboard), original);
  const withShots = applyDramaProposal(original, 'storyboard', shots, 'task-b', 'e1');
  assert.equal(withShots.episodes[0].shots.length, 2); assert.equal(withShots.episodes[0].shots[0].videoUrl, '/owned-video');
  assert.notEqual(withShots.episodes[0].shots[1].id, 'forged');
  assert.throws(() => applyDramaProposal(original, 'storyboard', shots, 'task-b', 'e1', true));
  const outline = parseDramaProposal('outline', JSON.stringify({ episodes: [{ title: '下一集', outline: '新大纲', hook: '新钩子' }] }), original);
  assert.equal(applyDramaProposal(original, 'outline', outline, 'task-c', 'e1').episodes[0].script, '旧剧本');
  assert.throws(() => applyDramaProposal(original, 'outline', outline, 'task-c', 'e1', true));
});

async function fixture() {
  const f = await createTestDatabase(), app = await buildApp({ db: f.db, config: f.config }); await app.ready();
  const users: Array<{ id: string; headers: { cookie: string; origin: string } }> = [];
  for (let i = 0; i < 2; i++) { const id = randomUUID(), token = randomBytes(32).toString('base64url'); await f.db.query('INSERT INTO oaooao_users(id,username,password_hash) VALUES($1,$2,$3)', [id, `drama-${id}`, 'synthetic-unused']); await f.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hashToken(token), id]); await adjustWallet(app.ctx, id, `fixture:${id}`, 100); users.push({ id, headers: { cookie: `${f.config.sessionCookieName}=${token}`, origin: f.config.origin } }); }
  const models = ['text', 'image', 'video', 'audio'].map(kind => ({ id: `fixture-${kind}`, name: `Synthetic ${kind}`, enabled: true, capability: kind, bindings: [{ id: `binding-${kind}`, channelId: 'fixture', upstreamModel: `fixture-${kind}`, enabled: true, priority: 1 }] }));
  await f.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'", [{ systemChannels: [{ id: 'fixture', name: 'Synthetic protocol fixture', enabled: true, apiFormat: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: app.ctx.encrypt('synthetic-never-sent'), models: models.map(model => model.id) }], logicalModels: models, modelPointCosts: Object.fromEntries(models.map(model => [model.id, 3])), defaultModels: { textModel: 'fixture-text' }, generationConcurrency: { text: 20, image: 20, video: 20, audio: 20 } }]);
  const response = await app.inject({ method: 'POST', url: '/api/drama/projects', headers: users[0].headers, payload: { title: '合成测试短剧', summary: '一段合成故事', brief: { sourceText: '合成故事原文', targetEpisodes: 3, episodeSeconds: 45 } } });
  assert.equal(response.statusCode, 200, response.body);
  let project = response.json().data.project;
  const root = `/api/drama/projects/${project.id}/production`;
  const invoke = (suffix: string, payload?: Record<string, unknown>, owner = users[0], method: 'POST' | 'GET' = 'POST') => app.inject({ method, url: root + suffix, headers: owner.headers, ...(payload === undefined ? {} : { payload }) });
  const submit = (extra = {}) => invoke('', { stage: 'analysis', model: 'fixture-text', expectedUpdatedAt: project.updatedAt, clientRequestId: randomUUID(), approvedCost: 3, ...extra });
  const finish = async (id: string, content: unknown) => { await f.db.query("UPDATE oaooao_generation_jobs SET status='success',result=$2 WHERE id=$1", [id, { content: JSON.stringify(content) }]); };
  return { ...f, app, users, root, project, invoke, submit, finish, cleanup: async () => { await app.close(); await f.cleanup(); } };
}

test('quotes are read-only; approved requests are idempotent, owned and checked against the current project version', async () => {
  const f = await fixture(); try {
    assert.equal(f.project.brief.targetEpisodes, 3); assert.equal(f.project.episodes[0].title, '第 1 集');
    const before = await getWallet(f.app.ctx, f.users[0].id);
    const quote = await f.invoke('/quote', { stage: 'analysis', model: 'fixture-text' }); assert.equal(quote.statusCode, 200, quote.body); assert.equal(quote.json().data.points, 3);
    assert.equal((await getWallet(f.app.ctx, f.users[0].id)).pointsBalance, before.pointsBalance);
    assert.equal(Number((await f.db.query('SELECT count(*) n FROM oaooao_generation_jobs')).rows[0].n), 0);
    const clientRequestId = randomUUID(); const responses = await Promise.all(Array.from({ length: 5 }, () => f.submit({ clientRequestId })));
    for (const response of responses) assert.equal(response.statusCode, 202, response.body);
    const ids = new Set(responses.map(response => response.json().data.id)); assert.equal(ids.size, 1);
    assert.equal((await getWallet(f.app.ctx, f.users[0].id)).pointsBalance, 97);
    assert.equal((await f.submit({ clientRequestId, instructions: 'Changed' })).statusCode, 409);
    assert.equal((await f.submit({ expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).statusCode, 409);
    assert.equal((await f.invoke('/quote', { stage: 'analysis', model: 'fixture-text' }, f.users[1])).statusCode, 404);
    const job = (await f.db.query('SELECT input FROM oaooao_generation_jobs WHERE id=$1', [[...ids][0]])).rows[0].input;
    assert.equal(job.context.approvedCost, 3); assert.equal(job.context.dramaRevision, f.project.updatedAt);
    assert.equal(job.messages[0].role, 'system'); assert.ok(JSON.parse(job.messages[1].content).brief.sourceText.includes('合成故事原文'));
    assert.equal((await f.submit({ approvedCost: 2 })).statusCode, 409);
    assert.equal((await getWallet(f.app.ctx, f.users[0].id)).pointsBalance, 97);
  } finally { await f.cleanup(); }
});

test('proposal adoption checks ownership and optimistic versions, and replays without overwriting later user edits', async () => {
  const f = await fixture(); try {
    const submitted = await f.submit(); assert.equal(submitted.statusCode, 202, submitted.body); const id = submitted.json().data.id;
    await f.finish(id, { logline: '合成故事设定', world: '合成世界', risks: ['一条建议'], videoUrl: 'forged' });
    const list = await f.invoke('', undefined, f.users[0], 'GET'); assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().data.tasks[0].proposal.logline, '合成故事设定');
    assert.equal((await f.invoke(`/${id}/apply`, { expectedUpdatedAt: f.project.updatedAt }, f.users[1])).statusCode, 404);
    assert.equal((await f.invoke(`/${id}/apply`, { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).statusCode, 409);
    const applied = await f.invoke(`/${id}/apply`, { expectedUpdatedAt: f.project.updatedAt }); assert.equal(applied.statusCode, 200, applied.body);
    const project = applied.json().data.project; assert.equal(project.storyBible.logline, '合成故事设定'); assert.equal(project.storyBible.videoUrl, undefined);
    await f.db.query("UPDATE oaooao_projects SET document=jsonb_set(document,'{summary}','\"用户后续编辑\"'::jsonb) WHERE id=$1", [project.id]);
    const replay = await f.invoke(`/${id}/apply`, { expectedUpdatedAt: f.project.updatedAt }); assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().data.project.summary, '用户后续编辑');
    assert.equal(Number((await f.db.query('SELECT count(*) n FROM oaooao_generation_jobs')).rows[0].n), 1);
  } finally { await f.cleanup(); }
});

test('unfinished or malformed outputs cannot be adopted; cancellation refunds once', async () => {
  const f = await fixture(); try {
    const submitted = await f.submit(), id = submitted.json().data.id;
    assert.equal((await f.invoke(`/${id}/apply`, { expectedUpdatedAt: f.project.updatedAt })).statusCode, 409);
    const stopped = await f.invoke(`/${id}/cancel`, {}); assert.equal(stopped.statusCode, 200, stopped.body); assert.equal(stopped.json().data.status, 'cancelled');
    assert.equal((await getWallet(f.app.ctx, f.users[0].id)).pointsBalance, 100);
    await f.invoke(`/${id}/cancel`, {}); assert.equal((await getWallet(f.app.ctx, f.users[0].id)).pointsBalance, 100);
    const another = await f.submit(), anotherId = another.json().data.id; await f.finish(anotherId, {});
    const listing = await f.invoke('', undefined, f.users[0], 'GET'); assert.ok(listing.json().data.tasks.find((task: any) => task.id === anotherId).proposalError);
    assert.equal((await f.invoke(`/${anotherId}/apply`, { expectedUpdatedAt: f.project.updatedAt })).statusCode, 422);
  } finally { await f.cleanup(); }
});

test('image adoption requires persistent owned results and preserves each previous adopted image', async () => {
  const f = await fixture(); try {
    const episode = f.project.episodes[0], shotId = randomUUID();
    await f.db.query('UPDATE oaooao_projects SET document=$2 WHERE id=$1', [f.project.id, { ...f.project, episodes: [{ ...episode, script: '合成剧本', shots: [{ id: shotId, imagePrompt: 'Synthetic frame', duration: 5, characterIds: [], propIds: [] }] }] }]);
    const one = await f.submit({ stage: 'image', model: 'fixture-image', episodeId: episode.id, shotId }); assert.equal(one.statusCode, 202, one.body);
    const first = one.json().data.id, png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64');
    const foreign = await saveMedia(f.app.ctx, f.users[1].id, png, true);
    await f.db.query("UPDATE oaooao_generation_jobs SET status='success',result=$2 WHERE id=$1", [first, { url: foreign.url }]);
    assert.equal((await f.invoke(`/${first}/apply`, { expectedUpdatedAt: f.project.updatedAt })).statusCode, 422);
    const media = await saveMedia(f.app.ctx, f.users[0].id, png, true);
    await f.db.query('UPDATE oaooao_generation_jobs SET result=$2 WHERE id=$1', [first, { url: media.url }]);
    const applied = await f.invoke(`/${first}/apply`, { expectedUpdatedAt: f.project.updatedAt }); assert.equal(applied.statusCode, 200, applied.body);
    const project = applied.json().data.project; assert.equal(project.episodes[0].shots[0].storyboardImageUrl, media.url);
    const two = await f.submit({ stage: 'image', model: 'fixture-image', episodeId: episode.id, shotId, expectedUpdatedAt: project.updatedAt }); assert.equal(two.statusCode, 202, two.body);
    const secondMedia = await saveMedia(f.app.ctx, f.users[0].id, png, true), second = two.json().data.id;
    await f.db.query("UPDATE oaooao_generation_jobs SET status='success',result=$2 WHERE id=$1", [second, { url: secondMedia.url }]);
    const adopted = await f.invoke(`/${second}/apply`, { expectedUpdatedAt: project.updatedAt }); assert.equal(adopted.statusCode, 200, adopted.body);
    const shot = adopted.json().data.project.episodes[0].shots[0]; assert.equal(shot.storyboardImageUrl, secondMedia.url); assert.equal(shot.takes[0].url, media.url);
  } finally { await f.cleanup(); }
});
