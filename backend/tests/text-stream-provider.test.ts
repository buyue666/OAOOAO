import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeProvider } from '../src/providers.js';
import type { Context } from '../src/core.js';

test('text generation always requests and parses a streamed completion', async () => {
  const settings = {
    systemChannels: [{ id: 'stream-fixture', enabled: true, apiKey: 'encrypted-fixture', apiFormat: 'openai' }],
  };
  const ctx = {
    db: { query: async () => ({ rows: [{ value: settings }] }) },
    decrypt: () => 'synthetic-key',
  } as unknown as Context;
  const job = {
    id: 'stream-fixture-job',
    user_id: 'stream-fixture-user',
    kind: 'text',
    channel_id: 'stream-fixture',
    upstream_model: 'fixture-model',
    input: { prompt: 'synthetic prompt', config: { stream: false } },
    provider_config: { protocol: 'openai', apiKey: 'encrypted-fixture', baseUrl: 'https://provider.example/v1' },
  };
  let body: Record<string, unknown> | undefined;
  const result = await invokeProvider(ctx, job, false, async (url, options) => {
    assert.equal(url, 'https://provider.example/v1/chat/completions');
    assert.equal(options?.headers?.accept, 'text/event-stream');
    body = JSON.parse(String(options?.body));
    options?.onChunk?.(Buffer.from('data: {"choices":[{"delta":{"content":"流式文本"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    return new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });

  assert.equal(body?.stream, true);
  assert.equal(result.type, 'complete');
  if (result.type === 'complete') assert.equal(result.result.content, '流式文本');
});
