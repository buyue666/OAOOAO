/**
 * Isolated HTTP contract fixture for the creative-workspace browser checks.
 *
 * Run: node tests/creative-fixture-server.mjs (127.0.0.1:3461 by default).
 * Point a LOCAL frontend's OAOAO_BACKEND_URL at that address. Do not use a
 * production frontend or database. Everything is held in this process's memory;
 * frontend reloads retain it, restarting the fixture resets it.
 *
 * This is not the business backend. Shapes were checked against api.ts,
 * account-api.ts, generation-api.ts and backend drama-project-contract.ts,
 * drama/projects routes and drama/render route. It verifies frontend contracts,
 * conflict handling and UI transitions, not backend authentication or billing.
 * It never makes an outbound request and always reports zero points cost.
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const clone = (value) => JSON.parse(JSON.stringify(value))
const message = (status, msg) => ({ status, body: { code: status, data: null, msg } })
const ok = (data, msg = 'OK') => ({ status: 200, body: { code: 0, data, msg } })

function pagination(items, search) {
  const page = Math.max(1, Number(search.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(search.get('pageSize')) || 24))
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}

function fixtureShot(id, order, title) {
  return { id, order, title, description: title, sourceText: '', shotBoundary: '', dialogue: '', narration: '', utterances: [], imagePrompt: `${title}，米白咖啡杯，自然光`, videoPrompt: `${title}，缓慢推进`, cameraMotion: '缓慢推进', duration: 5, characterIds: [], propIds: ['fixture-cup'], clueIds: [], videoMode: 'storyboard', storyboardStatus: 'idle', generationStatus: 'idle' }
}

// Relevant normalization from the inspected library-asset-service contract:
// stable URLs plus a storage key are required; arbitrary data keys do not survive.
function libraryAsset(input, id, time) {
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const stable = (value) => { const url = clean(value, 4000); return /^(data:|blob:)/.test(url) ? '' : url }
  const title = clean(input.title, 160)
  if (!title) throw Object.assign(new Error('素材名称不能为空'), { status: 400 })
  const kind = ['image', 'video', 'audio'].includes(input.kind) ? input.kind : 'text'
  const data = input.data || {}
  const common = { id, kind, title, coverUrl: stable(input.coverUrl), tags: (Array.isArray(input.tags) ? input.tags : []).map((tag) => clean(tag, 50)).filter(Boolean).slice(0, 30), source: clean(input.source, 160) || undefined, note: clean(input.note, 2000) || undefined, metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : {}, createdAt: time, updatedAt: time }
  if (kind === 'text') return { ...common, data: { content: clean(data.content, 100000) } }
  const storageKey = clean(data.storageKey, 500)
  const serverUrl = stable(data.serverUrl) || stable(kind === 'image' ? data.dataUrl : data.url)
  if (!storageKey || !serverUrl) throw Object.assign(new Error('媒体素材必须先保存到服务器'), { status: 400 })
  const media = { storageKey, serverUrl, remoteUrl: stable(data.remoteUrl) || undefined, bytes: Math.max(0, Math.floor(Number(data.bytes) || 0)), mimeType: clean(data.mimeType, 120) }
  return { ...common, data: { ...media, ...(kind === 'image' ? { dataUrl: serverUrl } : { url: serverUrl }), ...(kind === 'audio' ? { durationMs: Number(data.durationMs) || undefined } : { width: Math.max(0, Math.floor(Number(data.width) || 0)), height: Math.max(0, Math.floor(Number(data.height) || 0)) }) } }
}

function svg(name) {
  const dark = name.includes('dark') || name.includes('2')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="${dark ? '#344440' : '#cbd0c3'}"/><path d="M0 380L220 160 400 350 660 100 960 360V540H0Z" fill="${dark ? '#52655a' : '#91a496'}"/><ellipse cx="482" cy="451" rx="124" ry="22" fill="#15221c" opacity=".18"/><path d="M390 252H570L556 424Q482 456 406 424Z" fill="${dark ? '#c0b49f' : '#f7efdc'}"/><path d="M570 282C662 266 662 382 562 369" fill="none" stroke="${dark ? '#c0b49f' : '#f7efdc'}" stroke-width="24"/><ellipse cx="480" cy="251" rx="90" ry="20" fill="#f9f3e5"/><ellipse cx="480" cy="252" rx="70" ry="12" fill="#735b43"/><text x="36" y="50" fill="white" font-family="sans-serif" font-size="20">LOCAL CONTRACT FIXTURE · NO GENERATION</text></svg>`
}

export function createCreativeFixture({ seed = true } = {}) {
  const projects = new Map()
  const canvases = new Map()
  const library = new Map()
  const tasks = new Map()
  const idempotency = new Map()
  const requests = []
  let sequence = 0
  let clock = Date.now()
  let authenticated = true
  const stamp = () => new Date(clock = Math.max(Date.now(), clock + 1)).toISOString()
  const nextId = (prefix) => `${prefix}-fixture-${++sequence}`
  const media = (name = 'cup') => `/api/generation-log-assets/fixture/${name}.svg`
  const taskView = (task) => {
    const { polls, input, clientRequestId, ...publicTask } = task
    return clone(publicTask)
  }

  const addProject = (input) => {
    // This fixture has one fixed account (fixture-user). Within that account,
    // sourceHandoffId is a stable creation identity, including response-loss retries.
    const id = input.sourceHandoffId ? `drama-${input.sourceHandoffId}` : nextId('drama')
    if (projects.has(id)) return projects.get(id)
    const time = stamp()
    const episodeId = `${id}-episode-1`
    const project = { id, ...(input.sourceHandoffId ? { sourceHandoffId: input.sourceHandoffId } : {}), title: String(input.title || '未命名创作'), summary: String(input.summary || ''), style: String(input.style || ''), ratio: String(input.ratio || '16:9'), status: 'active', activeEpisodeId: episodeId, characters: [], scenes: [], props: [], clues: [], defaultVideoMode: 'storyboard', episodes: [{ id: episodeId, episodeNumber: 1, title: '第 1 集', script: String(input.initialScript || ''), outline: '', hook: '', nextPreview: '', sourceRange: '', reviewStatus: 'draft', shots: [] }], sourceAssets: clone(input.sourceAssets || []), createdAt: time, updatedAt: time }
    projects.set(id, project)
    return project
  }

  if (seed) {
    const time = stamp()
    library.set('fixture-cup', { id: 'fixture-cup', kind: 'image', title: '米白咖啡杯 · 本地验收素材', coverUrl: media(), tags: ['产品', '本地验收'], source: 'upload', note: '本地 SVG 夹具，没有使用 AI 生成或外部素材。', data: { url: media(), serverUrl: media(), width: 960, height: 540, mimeType: 'image/svg+xml', storageKey: 'fixture/cup.svg' }, createdAt: time, updatedAt: time })
    const project = addProject({ title: '山野之间 · 本地验收项目', summary: '15 秒咖啡品牌短片。这是隔离验收数据。', initialScript: '山野里的第一杯。晨光落在杯沿。把片刻留给自己。' })
    project.props = [{ id: 'fixture-cup', name: '米白咖啡杯', description: '保持杯形与米白色釉面', referenceImageUrl: media(), references: [{ id: 'fixture-cup-reference', url: media(), source: 'library', label: '米白咖啡杯', createdAt: time }], primaryReferenceId: 'fixture-cup-reference' }]
    project.sourceAssets = [{ id: 'fixture-cup', type: 'image', title: '米白咖啡杯', serverUrl: media(), remoteUrl: media(), storageKey: 'fixture/cup.svg', width: 960, height: 540 }]
    project.episodes[0].shots = ['山野里的第一杯', '晨光落在杯沿', '把片刻留给自己'].map((title, index) => fixtureShot(`fixture-shot-${index + 1}`, index + 1, title))
  }

  const settings = () => ({
    site: { title: 'OAOOAO · 本地验收', announcementBar: { enabled: false } }, operationMode: 'self_use',
    logicalModels: ['image', 'video'].map((kind) => ({ id: `fixture-${kind}`, name: `本地验收${kind === 'image' ? '图片' : '视频'}（不扣费）`, capability: kind, enabled: true, bindings: [{ id: `fixture-${kind}-binding`, channelId: 'fixture-local', upstreamModel: `fixture-${kind}`, enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: true, maxReferenceImages: 5, aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['standard'], durationSeconds: [5, 10], maxBatchSize: 1, supportsAsync: true, supportsCancel: true } }] })),
    defaultModels: { textModel: '', imageModel: 'fixture-image', videoModel: 'fixture-video', audioModel: '' },
    modelPointCosts: { 'fixture-image': 0, 'fixture-video': 0 },
    generationPointMultipliers: { imageQuality: { standard: 1, auto: 1 }, videoQuality: { standard: 1 }, videoSeconds: { 5: 1, 10: 1 } },
    generationConcurrency: { image: 4, video: 4, text: 1, audio: 1 },
    generationDefaults: { canvasImageCount: 1, imageSize: '16:9', imageQuality: 'standard', imageCount: 1, videoQuality: 'standard', videoSeconds: 5, audioVoice: '', audioFormat: 'mp3' },
    systemChannels: [{ id: 'fixture-local', name: '本地内存夹具', enabled: true, models: ['fixture-image', 'fixture-video'], hasApiKey: false }],
  })

  async function route(req, url, body) {
    const path = url.pathname
    const method = req.method || 'GET'
    if ((path.startsWith('/api/generation-log-assets/fixture/') || path.startsWith('/api/reference-assets/fixture/')) && method === 'GET') return { status: 200, text: svg(path), type: 'image/svg+xml' }
    if (path === '/api/health/live') return { status: 200, body: { status: 'ok', fixture: true } }
    if (path === '/api/auth/session') return { status: 200, body: { user: authenticated ? { id: 'fixture-user', username: 'fixture-user', displayName: '验收账号', role: 'user', pointsBalance: 0, permanentPointsBalance: 0, dailyPointsBalance: 0, planName: '隔离验收 · 不扣费' } : null, settings: settings(), install: { ready: true } } }
    if (path === '/api/auth/login' && method === 'POST') { authenticated = true; return { status: 200, body: { success: true } } }
    if (path === '/api/auth/logout' && method === 'POST') { authenticated = false; return { status: 200, body: { success: true } } }
    if (!authenticated) return message(401, '请先登录（本地验收账号）')
    if (path === '/api/fixture/state') return { status: 200, body: { fixture: true, projectCount: projects.size, taskCount: tasks.size, chargedPoints: 0, requests: clone(requests), projects: [...projects.values()].map(clone) } }
    if (path === '/api/drama/projects') {
      if (method === 'GET') {
        const listed = pagination([...projects.values()].map((p) => ({ id: p.id, title: p.title, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, shotCount: p.episodes.reduce((sum, ep) => sum + ep.shots.length, 0), coverUrl: p.episodes.flatMap((ep) => ep.shots).find((shot) => shot.storyboardImageUrl)?.storyboardImageUrl })), url.searchParams)
        const { items, ...rest } = listed
        return ok({ projects: items, ...rest })
      }
      if (method === 'POST') return ok({ project: addProject(body) }, '短剧项目已创建')
    }
    const projectMatch = path.match(/^\/api\/drama\/projects\/([^/]+)$/)
    if (projectMatch) {
      const id = decodeURIComponent(projectMatch[1])
      const project = projects.get(id)
      if (!project) return message(404, '短剧项目不存在')
      if (method === 'GET') return ok({ project })
      if (method === 'DELETE') { projects.delete(id); return ok({ deleted: id }) }
      if (method === 'PATCH') {
        if (body.updatedAt && body.updatedAt !== project.updatedAt) return message(409, '项目已在其他页面更新，请保留草稿并重新读取')
        if (!Array.isArray(body.episodes) || !body.episodes.length) return message(400, '短剧项目至少需要一集')
        const saved = { ...clone(body), id, createdAt: project.createdAt, updatedAt: stamp() }
        projects.set(id, saved)
        return ok({ project: saved }, '已保存')
      }
    }
    if (path === '/api/canvas/projects') {
      if (method === 'GET') return ok({ projects: [...canvases.values()].map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt, nodeCount: p.nodes.length })), total: canvases.size })
      if (method === 'POST') {
        const id = body.sourceHandoffId ? `canvas-${body.sourceHandoffId}` : nextId('canvas')
        const project = { ...(body.project || {}), id, title: body.title || '未命名画布', sourceHandoffId: body.sourceHandoffId, nodes: body.project?.nodes || [], connections: body.project?.connections || [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: stamp(), updatedAt: stamp() }
        canvases.set(id, project)
        return ok({ project })
      }
      if (method === 'DELETE') { for (const id of body.ids || []) canvases.delete(id); return ok({ deleted: body.ids || [] }) }
    }
    const canvasMatch = path.match(/^\/api\/canvas\/projects\/([^/]+)$/)
    if (canvasMatch) {
      const id = decodeURIComponent(canvasMatch[1]); const project = canvases.get(id)
      if (!project) return message(404, '画布项目不存在')
      if (method === 'GET') return ok({ project })
      if (method === 'PATCH') {
        if (body.expectedUpdatedAt !== project.updatedAt) return message(409, '画布已在别处更新')
        const saved = { ...project, ...clone(body.project), id, updatedAt: stamp() }; canvases.set(id, saved)
        return ok({ project: saved })
      }
    }
    if (path === '/api/library-assets') {
      if (method === 'GET') {
        const filtered = [...library.values()].filter((asset) => (!url.searchParams.get('kind') || asset.kind === url.searchParams.get('kind')) && (!url.searchParams.get('keyword') || asset.title.includes(url.searchParams.get('keyword'))))
        const { items, ...rest } = pagination(filtered, url.searchParams)
        return ok({ assets: items, ...rest })
      }
      if (method === 'POST') { const asset = libraryAsset(body, nextId('asset'), stamp()); library.set(asset.id, asset); return ok({ asset }) }
    }
    if (path === '/api/reference-assets' && method === 'POST') return { status: 200, body: { key: 'fixture/upload.svg', url: media(), upstreamUrl: media(), bytes: 1000, mimeType: 'image/svg+xml' } }
    if (path === '/api/drama/render-capability' && method === 'GET') return ok({ available: false }, '本地验收环境未提供 FFmpeg')
    if (path === '/api/drama/render') return message(503, '本地验收环境未提供 FFmpeg 合成，不会生成或扣费')
    const createKind = path === '/api/image-tasks' ? 'image' : path === '/api/video-generation-tasks' ? 'video' : null
    if (createKind && method === 'POST') {
      const clientRequestId = String(req.headers['x-vozeb-pro-client-request-id'] || body.context?.clientRequestId || '')
      const key = `${createKind}:${clientRequestId}:${req.headers['x-vozeb-pro-attempt-no'] || 0}`
      if (clientRequestId && idempotency.has(key)) return { status: 200, body: { task: taskView(tasks.get(idempotency.get(key))) } }
      const id = nextId(createKind)
      const task = { id, kind: createKind, status: 'pending', model: body.config?.model || `fixture-${createKind}`, prompt: String(body.prompt || ''), title: String(body.title || body.prompt || '本地验收任务'), source: body.source || 'drama', context: clone(body.context || {}), createdAt: stamp(), updatedAt: stamp(), pointsCost: 0, executionPhase: 'created', input: clone(body), clientRequestId, polls: 0 }
      tasks.set(id, task); if (clientRequestId) idempotency.set(key, id)
      return { status: 200, body: { task: taskView(task) } }
    }
    const taskMatch = path.match(/^\/api\/(image|video|video-generation)-tasks\/([^/]+)$/)
    if (taskMatch) {
      const task = tasks.get(decodeURIComponent(taskMatch[2]))
      if (!task) return message(404, '任务不存在')
      if (method === 'PATCH') { task.status = 'cancelled'; task.updatedAt = stamp() }
      if (method === 'GET' && ['pending', 'running'].includes(task.status)) {
        task.polls += 1
        task.status = task.polls >= 2 ? (task.kind === 'video' ? 'error' : 'success') : 'running'
        task.executionPhase = task.status === 'success' ? 'completed' : task.status === 'error' ? 'completed' : 'polling'
        if (task.status === 'success') task.result = { remoteUrl: media(`${task.id.includes('2') ? 'dark-' : ''}${task.id}`), width: 960, height: 540, mimeType: 'image/svg+xml' }
        if (task.status === 'error') task.error = '本地验收环境没有视频编码器；此失败用于核对真实错误展示，不扣费'
        task.updatedAt = stamp()
      }
      return { status: 200, body: { task: taskView(task) } }
    }
    if (path === '/api/generation-logs') {
      const filtered = [...tasks.values()].filter((task) => (!url.searchParams.get('kind') || task.kind === url.searchParams.get('kind')) && (!url.searchParams.get('status') || task.status === url.searchParams.get('status'))).map((task) => ({ id: `log-${task.id}`, taskId: task.id, kind: task.kind, status: task.status, title: task.title, prompt: task.prompt, model: task.model, source: task.source, context: task.context, pointsCost: 0, createdAt: task.createdAt, error: task.error, assets: task.result?.remoteUrl ? [{ type: task.kind, url: task.result.remoteUrl, width: 960, height: 540 }] : [] }))
      return { status: 200, body: pagination(filtered, url.searchParams) }
    }
    if (path === '/api/points') return { status: 200, body: { records: [], total: 0, page: 1, pageSize: 20 } }
    if (path === '/api/agent/runs') return method === 'GET' ? ok({ runs: [] }) : message(503, '本地验收环境未配置 Agent，不会执行或扣费')
    if (path === '/api/billing/products') return { status: 200, body: { products: [], paymentProviders: [], purchaseReadiness: { ready: false, reasons: ['隔离验收不提供支付'] } } }
    return message(404, `本地夹具未实现 ${method} ${path}`)
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Object.assign(new Error('Fixture accepts loopback hosts only'), { status: 403 })
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) {
        for (const header of ['origin', 'referer']) {
          const value = req.headers[header]
          if (value && new URL(value).origin !== url.origin) throw Object.assign(new Error('跨站请求已被拦截'), { status: 403 })
        }
      }
      let text = ''
      for await (const part of req) { text += part; if (text.length > 2 * 1024 * 1024) throw Object.assign(new Error('Fixture body too large'), { status: 413 }) }
      const body = text && req.headers['content-type']?.includes('application/json') ? JSON.parse(text) : {}
      if (!url.pathname.startsWith('/api/fixture/')) requests.push({ method: req.method, path: url.pathname, ...(req.method !== 'GET' ? { body: clone(body), clientRequestId: req.headers['x-vozeb-pro-client-request-id'] } : {}) })
      const response = await route(req, url, body)
      res.writeHead(response.status, { 'content-type': response.type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-oao-fixture': 'local-no-charges', 'x-vozeb-pro-points-remaining': '0', 'x-vozeb-pro-points-permanent': '0', 'x-vozeb-pro-points-daily': '0' })
      res.end(response.text ?? JSON.stringify(response.body))
    } catch (error) {
      res.writeHead(error.status || (error instanceof SyntaxError ? 400 : 500), { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
  })
  return { server, listen: (port = 3461) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)) }), close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()) }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = createCreativeFixture()
  const url = await fixture.listen(Number(process.env.OAOAO_FIXTURE_PORT || 3461))
  console.log(`Local contract fixture: ${url} (memory only; 验收账号; no outbound calls or charges)`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void fixture.close().then(() => process.exit(0)))
}
