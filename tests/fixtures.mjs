/**
 * 隔离测试夹具：为本轮验收准备可用的本地模拟上游与多张生图模型。
 *
 * 背景与边界：
 * - 本地 `e2e-primary` 渠道指向 `http://127.0.0.1:4021/v1`，该模拟上游当前未运行；
 *   没有它就无法验证「批量生图」「部分失败」「失败退款」等真实任务路径。
 * - 本脚本只做两件事：① 启动一个**本地**模拟上游（仅在 4021 端口，不外联）；
 *   ② 在数据库里增删一个**隔离测试模型**，用来验证批量能力（maxBatchSize > 1）。
 * - 全程只改本地数据库；不触碰生产配置、不调用付费上游、不发起真实支付。
 * - 所有写入都有对应的 `revert` 动作，验收结束后必须还原。
 *
 * 用法：
 *   node tests/fixtures.mjs upstream        启动本地模拟上游（前台运行）
 *   node tests/fixtures.mjs add-batch-model 添加支持 4 张的隔离测试模型
 *   node tests/fixtures.mjs revert-models   从备份还原 logical_models
 */
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const PSQL = 'D:/Project/ciyuan-API-snapshot/.codex-tmp/pgsql/pgsql/bin/psql.exe'
function testDatabaseUrl() {
  const value = process.env.OAOAO_TEST_DATABASE_URL
  if (!value) throw new Error('Set OAOAO_TEST_DATABASE_URL to an isolated local test database.')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Database fixtures are restricted to local PostgreSQL instances.')
  }
  return value
}
const FIXTURE_DIR = resolve(import.meta.dirname ?? '.', '.fixtures')
const MODELS_BACKUP = resolve(FIXTURE_DIR, 'logical-models.backup.json')
/** 后端依赖目录：模拟上游复用后端的 sharp，避免给前端加依赖。 */
const BACKEND_NODE_MODULES = 'D:/Project/ciyuan-API-snapshot/backups/vozeb-pro-v007-points-loop-20260910/VOZEB-PRO-ciyuan-v007-20260824/web/node_modules'
/** 隔离测试模型 ID：带 batch- 前缀，便于识别与清理。 */
export const BATCH_MODEL_ID = 'batch-4-image'

async function sql(statement) {
  const { stdout } = await execFileAsync(PSQL, [testDatabaseUrl(), '-t', '-A', '-c', statement], { maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * 通过临时 SQL 文件写 JSONB。
 *
 * 直接把 JSON 拼进 `-c` 会被 shell/psql 多层引号转义破坏（实测失败），
 * 因此改用 `-f` 读取文件，JSON 本体只以单引号包裹，避免二次转义。
 */
async function sqlJson(statement, jsonText) {
  const file = resolve(FIXTURE_DIR, 'update.sql')
  writeFileSync(file, `${statement.replace('$JSON$', `'${jsonText.replace(/'/g, "''")}'::jsonb`)}\n`, 'utf8')
  const { stdout } = await execFileAsync(PSQL, [testDatabaseUrl(), '-t', '-A', '-f', file], { maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

function readModels() {
  if (!existsSync(MODELS_BACKUP)) throw new Error(`缺少备份文件 ${MODELS_BACKUP}，请先运行 backup-models`)
  const raw = readFileSync(MODELS_BACKUP, 'utf8').replace(/^\uFEFF/, '').trim()
  return JSON.parse(raw)
}

/** 固定基线默认模型：四个能力各指向本环境真实存在的逻辑模型。 */
const BASELINE_DEFAULT_MODELS = { textModel: 'e2e-text', audioModel: 'e2e-audio', imageModel: 'e2e-image', videoModel: 'e2e-video' }

/**
 * 写 `logical_models` 时**必须同时把 `default_models` 写回基线**。
 *
 * 为什么：这三个动作直接改数据库，绕过了后端的 `/api/admin/settings`。
 * 一旦 `logical_models` 变化，后端下一次读取设置时会重新规范化默认模型，
 * 解析不到的会被清空——实测：跑完 `revert-models`（或 `remove-batch-model`）后
 * `default_models.imageModel` 变成空字符串，随后 `generation-flow.test.mjs` 报
 * `FAIL 后端提供默认文本模型` / 视频与图片默认模型缺失，
 * 看起来像功能回归，实际是夹具把默认模型清掉了。
 * 因此这里在同一个事务里把两者一起写，保证夹具动作**不改变默认模型**。
 */
async function writeModels(models) {
  const file = resolve(FIXTURE_DIR, 'update.sql')
  const body = JSON.stringify(models).replace(/'/g, "''")
  const defaults = JSON.stringify(BASELINE_DEFAULT_MODELS).replace(/'/g, "''")
  writeFileSync(
    file,
    `UPDATE vozeb_pro_app_settings SET logical_models = '${body}'::jsonb, default_models = '${defaults}'::jsonb, updated_at = now();\n`,
    'utf8',
  )
  const { stdout } = await execFileAsync(PSQL, [testDatabaseUrl(), '-t', '-A', '-f', file], { maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * 模拟上游：实现后端 image-tasks 需要的 OpenAI 兼容最小接口。
 *
 * - `POST /v1/images/generations` 返回 data[0].url，指向本服务自身的图片端点；
 * - `GET /v1/images/:name` 返回一张最小的合法 PNG，避免结果落盘失败；
 * - `GET /v1/models` 供后台渠道探测。
 *
 * 为了可测「部分失败」，当 prompt 含 `FAIL` 时返回 500，让该批次真实失败。
 */
/**
 * 生成一张**真实可解码**的 PNG。
 *
 * 起初用 1×1 的内联 base64 常量，后端落盘时 vips 报
 * `libpng read error / unable to write to target`（实测），任务因此全部失败。
 * 这里改用后端自带的 sharp 生成合法图片，保证模拟的是「成功产出」路径。
 */
async function buildPng(width = 512, height = 512) {
  // 复用后端自带的 sharp（前端工程没有该依赖，且不允许改动 package.json）。
  // sharp 的 ESM 入口是 dist/index.mjs（可用文件形式的 require 更省事）。
  const { createRequire } = await import('node:module')
  const backendRequire = createRequire(`${BACKEND_NODE_MODULES}/sharp/package.json`)
  const sharp = backendRequire('sharp')
  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 200 } } }).png().toBuffer()
}

export function startMockUpstream(port = 4021) {
  let pngPromise = null
  const png = () => (pngPromise ??= buildPng())
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      return json(200, { object: 'list', data: [{ id: 'e2e-image', object: 'model' }, { id: BATCH_MODEL_ID, object: 'model' }, { id: 'e2e-text', object: 'model' }] })
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v1/images/')) {
      const buffer = await png()
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(buffer.length) })
      return response.end(buffer)
    }
    if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        let prompt = ''
        try { prompt = String(JSON.parse(body)?.prompt ?? '') } catch { prompt = body }
        // 供验收制造「真实失败」与「真实成功」两类结果。
        if (/FAIL/i.test(prompt)) return json(500, { error: { message: '模拟上游失败（prompt 含 FAIL）' } })
        const name = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
        return json(200, {
          created: Math.floor(Date.now() / 1000),
          data: [{ url: `http://127.0.0.1:${port}/v1/images/${name}`, revised_prompt: prompt }],
        })
      })
      return undefined
    }
    if (request.method === 'POST' && url.pathname === '/v1/images/edits') {
      const name = `mock-edit-${Date.now()}.png`
      return json(200, { created: Math.floor(Date.now() / 1000), data: [{ url: `http://127.0.0.1:${port}/v1/images/${name}` }] })
    }
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      return json(200, { choices: [{ message: { role: 'assistant', content: '模拟文本结果' } }] })
    }
    /**
     * 视频任务：创建 + 查询 + 取内容。
     *
     * 渠道 `e2e-primary` 的 `e2e-video` 配置是
     * `createPath=/videos`、`queryPath=/videos/:task_id`、`resultField=/videos/:task_id/content`，
     * 而本模拟上游此前**没有实现这三个端点**，于是视频任务创建直接 502
     * 「模拟上游未实现：POST /v1/videos」，`generation-flow.test.mjs` 的
     * 「创建视频任务」长期失败。这是**模拟上游的能力缺口**，不是产品缺陷。
     * 这里补齐，让视频链路也能在本地被真实验收。
     */
    if (request.method === 'POST' && url.pathname === '/v1/videos') {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        let prompt = ''
        try { prompt = String(JSON.parse(body)?.prompt ?? '') } catch { prompt = String(body) }
        // 与图片一致：prompt 含 FAIL 时返回 500，用于制造真实失败。
        if (/FAIL/i.test(prompt)) return json(500, { error: { message: '模拟上游失败（prompt 含 FAIL）' } })
        return json(200, { id: `mock-video-${Date.now()}`, status: 'completed', model: 'e2e-video' })
      })
      return undefined
    }
    if (request.method === 'GET' && /^\/v1\/videos\/[^/]+\/content$/.test(url.pathname)) {
      // 返回一段最小的 MP4 头，保证后端落盘时拿到的是「真实可取到的产物」。
      const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
      response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(mp4.length) })
      return response.end(mp4)
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v1/videos/')) {
      return json(200, { id: url.pathname.split('/').pop(), status: 'completed' })
    }
    return json(404, { error: { message: `模拟上游未实现：${request.method} ${url.pathname}` } })
  })
  return new Promise((resolvePromise) => {
    server.listen(port, '127.0.0.1', () => resolvePromise(server))
  })
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const action = process.argv[2]
  if (action === 'upstream') {
    await startMockUpstream(4021)
    console.log('本地模拟上游已启动：http://127.0.0.1:4021/v1 （仅监听 127.0.0.1）')
  } else if (action === 'add-batch-model') {
    const models = readModels()
    /**
     * 关键：后端的逻辑模型目录**由渠道 `models` 列表派生**。
     * 只写 logical_models 而渠道 models 里没有对应上游模型名，模型会被
     * `synchronizeLogicalModelsWithChannels` 过滤掉（实测：会话里看不到）。
     * 因此必须同时把上游模型名加进渠道，并保留 capabilityProfile。
     */
    await sql(`UPDATE vozeb_pro_system_model_channels
      SET models = (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(models || '["e2e-image-batch4"]'::jsonb) AS value),
          updated_at = now()
      WHERE id = 'e2e-primary';`)
    const without = models.filter((model) => model.id !== BATCH_MODEL_ID)
    const profile = { aspectRatios: ['1:1', '16:9', '9:16'], resolutions: ['1K'], maxBatchSize: 4, supportsReferenceImage: true, maxReferenceImages: 2, supportsAsync: true }
    without.push({
      id: BATCH_MODEL_ID,
      name: '批量测试模型（4 张）',
      enabled: true,
      capability: 'image',
      // upstreamModel 必须是渠道 models 里存在的名字，否则会被目录同步过滤。
      bindings: [{ id: `e2e-primary:${BATCH_MODEL_ID}`, enabled: true, priority: 1, channelId: 'e2e-primary', upstreamModel: 'e2e-image-batch4', capabilityProfile: profile }],
    })
    await writeModels(without)
    console.log(`已添加隔离测试模型 ${BATCH_MODEL_ID}（upstream=e2e-image-batch4, maxBatchSize=4）`)
  } else if (action === 'remove-batch-model') {
    const models = readModels()
    await sql(`UPDATE vozeb_pro_system_model_channels
      SET models = (SELECT jsonb_agg(value) FROM jsonb_array_elements_text(models) AS value WHERE value <> 'e2e-image-batch4'),
          updated_at = now()
      WHERE id = 'e2e-primary';`)
    await writeModels(models.filter((model) => model.id !== BATCH_MODEL_ID))
    console.log(`已移除隔离测试模型 ${BATCH_MODEL_ID}`)
  } else if (action === 'revert-models') {
    const models = readModels()
    await sql(`UPDATE vozeb_pro_system_model_channels
      SET models = (SELECT jsonb_agg(value) FROM jsonb_array_elements_text(models) AS value WHERE value <> 'e2e-image-batch4'),
          updated_at = now()
      WHERE id = 'e2e-primary';`)
    await writeModels(models)
    console.log('已从备份还原 logical_models 并清理渠道测试模型')
  } else {
    console.log('用法：node tests/fixtures.mjs <upstream|add-batch-model|remove-batch-model|revert-models>')
  }
}
