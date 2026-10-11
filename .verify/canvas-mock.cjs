const http = require('http');

const PORT = 3200;
const now = () => new Date().toISOString();
let sequence = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(sequence++).toString(36)}`;

const user = { id: 'u_1', accountId: 'a_1', username: 'tester', email: 'tester@example.com', displayName: '测试用户', role: 'user', adminPermissions: [], planId: 'pro', planName: '专业版', pointsBalance: 1280, permanentPointsBalance: 800, dailyPointsBalance: 480 };
const settings = {
  site: { title: 'OAO' },
  operationMode: 'self_use',
  wechatLoginEnabled: false,
  defaultModels: { textModel: 'text-main', imageModel: 'image-main', videoModel: 'video-main', audioModel: 'audio-main' },
  modelPointCosts: { 'image-main': 6, 'video-main': 30, 'text-main': 2, 'audio-main': 4 },
  generationPointMultipliers: { imageQuality: { auto: 1, high: 2 }, videoQuality: { '720p': 1, '1080p': 1.5 }, videoSeconds: { 5: 1, 8: 1.6, 10: 2 } },
  generationDefaults: { canvasImageCount: 1, imageSize: '1:1', imageQuality: 'auto', imageCount: 1, videoQuality: '720p', videoSeconds: 8, audioVoice: 'alloy', audioFormat: 'mp3' },
  logicalModels: [
    { id: 'image-main', name: 'OAO 图像 Pro', capability: 'image', enabled: true, bindings: [{ id: 'b1', channelId: 'c1', upstreamModel: 'img-1', enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: true, maxReferenceImages: 4, aspectRatios: ['1:1', '16:9', '9:16'], resolutions: ['1k', '2k'], maxBatchSize: 4 } }] },
    { id: 'video-main', name: 'OAO 视频 Pro', capability: 'video', enabled: true, bindings: [{ id: 'b2', channelId: 'c1', upstreamModel: 'vid-1', enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: true, maxReferenceImages: 2, aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'], durationSeconds: [5, 8, 10] } }] },
    { id: 'text-main', name: 'OAO 文本', capability: 'text', enabled: true, bindings: [{ id: 'b3', channelId: 'c1', upstreamModel: 'txt-1', enabled: true, priority: 1 }] },
    { id: 'audio-main', name: 'OAO 音频', capability: 'audio', enabled: true, bindings: [{ id: 'b4', channelId: 'c1', upstreamModel: 'aud-1', enabled: true, priority: 1 }] },
  ],
  systemChannels: [{ id: 'c1', name: '主渠道', baseUrl: 'https://upstream.example', apiFormat: 'openai', models: ['img-1', 'vid-1', 'txt-1', 'aud-1'], enabled: true, hasApiKey: true }],
};

const canvases = new Map();
const generationTasks = new Map();
const agentRuns = new Map();
const libraryAssets = [];

const TASK_PATHS = { 'image-tasks': 'image', 'video-generation-tasks': 'video', 'audio-tasks': 'audio', 'text-tasks': 'text' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function ok(data) {
  return { code: 0, data };
}

function svgDataUrl(label, tone) {
  const fill = tone === 'dark' ? '#111' : '#f4f4f4';
  const ink = tone === 'dark' ? '#f4f4f4' : '#111';
  const safeLabel = label.replace(/[<&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="${fill}"/><rect x="48" y="48" width="544" height="544" fill="none" stroke="${ink}" stroke-width="2"/><text x="320" y="330" text-anchor="middle" font-family="sans-serif" font-size="30" fill="${ink}">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function wavDataUrl() {
  const sampleRate = 8000;
  const samples = sampleRate / 2;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

function resultFor(kind, prompt) {
  const label = (prompt || kind).slice(0, 18);
  if (kind === 'text') return { content: `模拟文本结果：${(prompt || '').slice(0, 80)}` };
  if (kind === 'audio') return { url: wavDataUrl() };
  if (kind === 'video') return { url: svgDataUrl(label, 'dark'), poster: svgDataUrl(label, 'dark') };
  return { url: svgDataUrl(label, 'light') };
}

function taskView(kind, task) {
  const age = Date.now() - task.createdAt;
  if (task.status === 'pending' || task.status === 'running') {
    if (/失败/.test(task.prompt)) {
      if (age > 1600) {
        task.status = 'error';
        task.error = '上游模型暂时不可用，请重试';
        task.canRetry = true;
      } else {
        task.status = age > 400 ? 'running' : 'pending';
      }
    } else if (age > 3000) {
      task.status = 'success';
      task.result = resultFor(kind, task.prompt);
    } else {
      task.status = age > 400 ? 'running' : 'pending';
    }
  }
  return { id: task.id, kind, status: task.status, model: task.model, result: task.result, error: task.error, canRetry: task.canRetry, pointsCost: task.pointsCost, executionPhase: task.status === 'success' ? 'completed' : 'polling' };
}

function promptOf(body) {
  if (typeof body.prompt === 'string') return body.prompt;
  if (Array.isArray(body.messages)) return body.messages.map((message) => (typeof message.content === 'string' ? message.content : '')).join('\n');
  return '';
}

function createGenerationTask(kind, body) {
  const id = newId(kind);
  const model = body.model || (body.config && body.config.model) || `${kind}-main`;
  const task = { id, createdAt: Date.now(), status: 'pending', model, prompt: promptOf(body), pointsCost: 6 };
  generationTasks.set(`${kind}:${id}`, task);
  return task;
}

function applyAgentCanvasEdit(run) {
  const project = canvases.get(run.projectId);
  if (!project || run.canvasEdited) return;
  run.canvasEdited = true;
  const index = project.nodes.length;
  project.nodes.push({ id: `agent_result_${run.id}`, type: 'text', position: { x: 80 + index * 40, y: 900 }, data: { kind: 'text', title: 'Agent 整理结果', detail: `Agent 根据提示词“${run.prompt.slice(0, 40)}”生成`, content: `已读取 ${index} 个画布对象` }, metadata: {} });
  project.updatedAt = now();
}

function agentRunView(run) {
  const age = Date.now() - run.createdAt;
  if (run.status === 'planning' && age > 500) run.status = 'running';
  if (run.status === 'running' && age > 2500) {
    run.status = 'completed';
    run.tasks = [{ id: `${run.id}_t1`, title: '整理当前画布节点', type: 'text', status: 'success' }];
    run.pointsCost = 2;
    applyAgentCanvasEdit(run);
  }
  return { ...run, updatedAt: Date.now() };
}

function canvasSummary(project) {
  const cover = project.nodes.find((node) => node.data && node.data.kind === 'image' && node.data.src);
  return { id: project.id, title: project.title, nodeCount: project.nodes.length, connectionCount: project.connections.length, createdAt: project.createdAt, updatedAt: project.updatedAt, ...(cover ? { cover: { kind: 'image', url: cover.data.src } } : {}) };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const loggedIn = /(^|;\s*)oao_mock=1/.test(req.headers.cookie || '');
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    let body = {};
    const contentType = String(req.headers['content-type'] || '');
    if (raw.length && contentType.includes('application/json')) {
      try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { code: 400, msg: 'bad json' }); }
    }
    const path = url.pathname;
    const method = req.method;

    if (path === '/api/auth/session') return send(res, 200, { user: loggedIn ? user : null, settings, install: { ready: true } });
    if (path === '/api/auth/login' && method === 'POST') return send(res, 200, { user }, { 'set-cookie': 'oao_mock=1; Path=/; HttpOnly; SameSite=Lax' });
    if (path === '/api/auth/logout') return send(res, 200, ok({}), { 'set-cookie': 'oao_mock=; Path=/; Max-Age=0' });
    if (!loggedIn) return send(res, 401, { code: 401, msg: '请先登录' });

    if (path === '/api/canvas/projects' && method === 'GET') {
      const projects = [...canvases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(canvasSummary);
      return send(res, 200, ok({ projects, total: projects.length }));
    }
    if (path === '/api/canvas/projects' && method === 'POST') {
      const created = now();
      const incoming = body.project || {};
      const project = { id: newId('canvas'), title: String(body.title || '未命名画布'), createdAt: created, updatedAt: created, nodes: incoming.nodes || [], connections: incoming.connections || [], viewport: incoming.viewport };
      canvases.set(project.id, project);
      return send(res, 200, ok({ project }));
    }
    if (path === '/api/canvas/projects' && method === 'DELETE') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const deleted = ids.filter((id) => canvases.delete(id));
      return send(res, 200, ok({ deleted }));
    }
    const canvasMatch = path.match(/^\/api\/canvas\/projects\/([^/]+)$/);
    if (canvasMatch) {
      const id = decodeURIComponent(canvasMatch[1]);
      const project = canvases.get(id);
      if (!project) return send(res, 404, { code: 404, msg: '画布不存在' });
      if (method === 'GET') return send(res, 200, ok({ project }));
      if (method === 'PATCH') {
        if (body.expectedUpdatedAt && body.expectedUpdatedAt !== project.updatedAt) return send(res, 409, { code: 409, msg: '画布已在其他地方更新' });
        const incoming = body.project || {};
        if (Array.isArray(incoming.nodes)) project.nodes = incoming.nodes;
        if (Array.isArray(incoming.connections)) project.connections = incoming.connections;
        if (incoming.viewport) project.viewport = incoming.viewport;
        if (typeof incoming.title === 'string' && incoming.title.trim()) project.title = incoming.title;
        project.updatedAt = now();
        return send(res, 200, ok({ ack: { updatedAt: project.updatedAt } }));
      }
    }

    const taskMatch = path.match(/^\/api\/(image-tasks|video-generation-tasks|audio-tasks|text-tasks)(?:\/([^/]+))?$/);
    if (taskMatch) {
      const kind = TASK_PATHS[taskMatch[1]];
      const taskId = taskMatch[2] ? decodeURIComponent(taskMatch[2]) : null;
      if (!taskId && method === 'POST') {
        const task = createGenerationTask(kind, body);
        return send(res, 200, ok({ task: taskView(kind, task) }));
      }
      const task = generationTasks.get(`${kind}:${taskId}`);
      if (!task) return send(res, 404, { code: 404, msg: '任务不存在' });
      if (method === 'GET') return send(res, 200, ok({ task: taskView(kind, task) }));
      if (method === 'PATCH' && body.status === 'cancelled') {
        if (task.status !== 'pending' && task.status !== 'running') return send(res, 409, { code: 409, msg: '任务已结束，无法取消' });
        task.status = 'cancelled';
        task.error = '已取消';
        return send(res, 200, ok({ task: taskView(kind, task) }));
      }
      return send(res, 400, { code: 400, msg: '不支持的操作' });
    }

    if (path === '/api/agent/runs' && method === 'POST') {
      const id = newId('run');
      const run = { id, surface: body.surface || 'canvas', projectId: body.projectId, status: 'planning', prompt: String(body.prompt || ''), referencedAssetIds: [], selectedSkillIds: [], assetIds: body.assetIds || [], tasks: [], createdAt: Date.now() };
      agentRuns.set(id, run);
      return send(res, 200, ok({ run: agentRunView(run), conversation: { id: `conv_${id}` }, created: true }));
    }
    if (path === '/api/agent/runs' && method === 'GET') {
      return send(res, 200, ok({ runs: [...agentRuns.values()].map(agentRunView) }));
    }
    const runMatch = path.match(/^\/api\/agent\/runs\/([^/]+)(?:\/(events|cancel|approve))?$/);
    if (runMatch) {
      const run = agentRuns.get(decodeURIComponent(runMatch[1]));
      if (!run) return send(res, 404, { code: 404, msg: 'Agent 运行不存在' });
      const action = runMatch[2];
      if (action === 'events') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(': connected\n\n');
      }
      if (action === 'cancel' && method === 'POST') {
        run.status = 'cancelled';
        return send(res, 200, ok({ run: agentRunView(run) }));
      }
      if (action === 'approve' && method === 'POST') {
        run.status = 'running';
        return send(res, 200, ok({ run: agentRunView(run) }));
      }
      if (!action && method === 'GET') return send(res, 200, ok({ run: agentRunView(run) }));
    }

    if (path === '/api/library-assets' && method === 'GET') {
      const kind = url.searchParams.get('kind');
      const keyword = url.searchParams.get('keyword');
      const filtered = libraryAssets.filter((asset) => (!kind || asset.kind === kind) && (!keyword || asset.title.includes(keyword)));
      return send(res, 200, ok({ assets: filtered, total: filtered.length, page: 1, pageSize: 60 }));
    }
    if (path === '/api/library-assets' && method === 'POST') {
      const created = now();
      const asset = { id: newId('asset'), kind: body.kind || 'image', title: String(body.title || '未命名素材'), coverUrl: body.coverUrl, tags: body.tags || [], source: body.source, note: body.note, data: body.data || {}, createdAt: created, updatedAt: created };
      libraryAssets.unshift(asset);
      return send(res, 200, ok({ asset }));
    }
    const assetMatch = path.match(/^\/api\/library-assets\/([^/]+)$/);
    if (assetMatch && method === 'DELETE') {
      const index = libraryAssets.findIndex((asset) => asset.id === decodeURIComponent(assetMatch[1]));
      if (index >= 0) libraryAssets.splice(index, 1);
      return send(res, 200, ok({}));
    }

    if (path === '/api/reference-assets' && method === 'POST') {
      return send(res, 200, { key: newId('ref'), url: svgDataUrl('参考素材', 'light'), bytes: raw.length, mimeType: 'image/svg+xml' });
    }
    if (path === '/api/generation-logs') return send(res, 200, ok({ items: [], total: 0, page: 1, pageSize: 20 }));
    if (path === '/api/points') return send(res, 200, ok({ records: [], total: 0, page: 1, pageSize: 20 }));
    return send(res, 200, ok({ items: [], total: 0, page: 1, pageSize: 20 }));
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`canvas mock backend on ${PORT}`));
