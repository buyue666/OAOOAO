import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { assertStorageConfigured, downloadObjectUrl, objectLocation, type StorageConfig } from '../src/object-storage.js';
import { readMigrations } from '../src/migration-files.js';
import type { Context } from '../src/core.js';
import Fastify from 'fastify';
import { registerSettings } from '../src/settings.js';

test('托管 Blob 检测不要求 S3 密钥，缺失集成令牌时返回明确提示', async () => {
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  const app = Fastify();
  try {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const ctx = {
      config: { origin: 'https://studio.test' },
      db: { query: async () => ({ rows: [{ value: { enabled: true, provider: 'vercel-blob', endpoint: '', bucket: '', prefix: 'oaooao', region: 'auto', forcePathStyle: true } }] }) },
      requireUser: async () => ({ id: 'test-admin' }),
      audit: async () => {},
    } as unknown as Context;
    await registerSettings(app, ctx);
    await app.ready();
    const response = await app.inject({ method: 'POST', url: '/api/admin/object-storage' });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().message, /私有文件存储尚未连接/);
  } finally {
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous;
    await app.close();
  }
});

const base: StorageConfig = { enabled: true, endpoint: 'https://storage.example.com', region: 'auto', bucket: 'assets', prefix: '/oaooao/', forcePathStyle: true };

test('私有 Blob 位置保留所有者隔离，旧 S3 位置结构不变', () => {
  const s3 = objectLocation(base, 'user-1', 'asset-1');
  assert.equal(s3.key, 'oaooao/user-1/asset-1');
  assert.equal(s3.provider, undefined);
  const blob = objectLocation({ ...base, provider: 'vercel-blob' }, 'user/2', 'asset-2');
  assert.equal(blob.provider, 'vercel-blob');
  assert.equal(blob.key, 'oaooao/user%2F2/asset-2');
});

test('Blob 未配置时明确拒绝，不回退至临时本地磁盘', () => {
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    assert.throws(() => assertStorageConfigured({ ...base, provider: 'vercel-blob' }), /尚未连接/);
    process.env.BLOB_READ_WRITE_TOKEN = 'unit-test-only';
    assert.doesNotThrow(() => assertStorageConfigured({ ...base, provider: 'vercel-blob', endpoint: '', bucket: '' }));
    assert.throws(() => assertStorageConfigured({ ...base, accessKeyId: undefined }), /配置不完整/);
  } finally {
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous;
  }
});

test('私有 Blob 不生成可泄露的直链', async () => {
  await assert.rejects(downloadObjectUrl({} as Context, objectLocation({ ...base, provider: 'vercel-blob' }, 'user-1', 'asset-1')), /鉴权接口/);
});

test('从根目录运行时可以验证全部原有迁移及其校验和', async () => {
  const migrations = await readMigrations();
  assert.equal(migrations.length, 17);
  for (const migration of migrations) assert.equal(migration.checksum, createHash('sha256').update(migration.sql).digest('hex'));
  assert.equal(migrations[0].name, '001-core.sql');
  assert.equal(migrations.at(-1)?.name, '017-team-plan-display.sql');
});
