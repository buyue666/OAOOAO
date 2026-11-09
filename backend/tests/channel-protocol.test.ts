import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveChannelProtocol } from '../src/channel-protocol.js';
import { resolveProvider } from '../src/providers.js';
import type { Context } from '../src/core.js';

test('automatic channels resolve the saved wire format and preserve explicit protocols', () => {
  assert.equal(effectiveChannelProtocol('auto', 'openai'), 'openai');
  assert.equal(effectiveChannelProtocol('auto', undefined), 'openai');
  assert.equal(effectiveChannelProtocol(undefined, 'auto'), 'openai');
  assert.equal(effectiveChannelProtocol('auto', 'ciyuan-async'), 'ciyuan-async');
  assert.equal(effectiveChannelProtocol('anthropic', 'openai'), 'anthropic');
});

test('automatic protocol works for an actual text provider selection without making upstream requests', async () => {
  const settings = { systemChannels: [{ id: 'synthetic', enabled: true, baseUrl: 'https://example.invalid/v1', apiKey: 'encrypted-fixture', apiFormat: 'openai', advancedConfig: { protocol: 'auto' } }], logicalModels: [{ id: 'writer', name: 'Writer', enabled: true, capability: 'text', bindings: [{ id: 'route', channelId: 'synthetic', upstreamModel: 'writer-wire', enabled: true, priority: 1 }] }], defaultModels: { textModel: 'writer' }, modelPointCosts: { writer: 3 } };
  const ctx = { db: { query: async () => ({ rows: [{ value: settings }] }) }, decrypt: () => 'synthetic-secret' } as unknown as Context;
  const selected = await resolveProvider(ctx, 'text', { config: { model: 'writer' } });
  assert.equal(selected.model, 'writer');
  assert.equal(selected.config.protocol, 'openai');
  assert.equal(selected.cost, '3.0000');
});
