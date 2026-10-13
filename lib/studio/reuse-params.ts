export type ReuseParams = { kind: 'image' | 'video'; prompt?: string; model?: string; taskId?: string }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type ReuseResult = { status: 'empty' } | { status: 'ready'; params: ReuseParams } | { status: 'invalid'; message: string }
const lifetime = 30 * 60 * 1000
const keyFor = (accountId: string) => `oaooao-reuse-params-v1:${encodeURIComponent(accountId)}`

function validateParams(value: unknown): ReuseParams {
  if (!value || typeof value !== 'object') throw new Error('历史参数格式无效，请回到原记录重新选择。')
  const input = value as Record<string, unknown>
  if (input.kind !== 'image' && input.kind !== 'video') throw new Error('目前只支持复用图片或视频参数。')
  for (const [name, limit] of [['prompt', 20000], ['model', 256], ['taskId', 256]] as const) {
    if (input[name] !== undefined && (typeof input[name] !== 'string' || input[name].length > limit)) throw new Error('历史参数不完整或超出支持范围，请手动填写。')
  }
  const prompt = typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt : undefined
  const model = typeof input.model === 'string' && input.model.trim() ? input.model : undefined
  if (!prompt && !model) throw new Error('这条记录没有可复用的提示词或模型。')
  return { kind: input.kind, ...(prompt ? { prompt } : {}), ...(model ? { model } : {}), ...(typeof input.taskId === 'string' && input.taskId ? { taskId: input.taskId } : {}) }
}

/** A tab-local, account-scoped handoff; it never submits a generation request. */
export function writeReuseParams(storage: StorageLike, accountId: string, input: ReuseParams, now = Date.now()): void {
  if (!accountId.trim()) throw new Error('请登录后复用参数。')
  const params = validateParams(input)
  try { storage.setItem(keyFor(accountId), JSON.stringify({ version: 1, accountId, createdAt: now, params })) }
  catch { throw new Error('浏览器暂时无法保存待复用参数，请允许本站存储后重试。') }
}

export function consumeReuseParams(storage: StorageLike, accountId: string, kind: ReuseParams['kind'], now = Date.now()): ReuseResult {
  if (!accountId.trim()) return { status: 'empty' }
  const key = keyFor(accountId)
  try {
    const raw = storage.getItem(key)
    if (!raw) return { status: 'empty' }
    if (raw.length > 80000) throw new Error('待复用参数超出支持范围。')
    const saved = JSON.parse(raw)
    if (!saved || saved.version !== 1 || saved.accountId !== accountId || !Number.isFinite(saved.createdAt) || saved.createdAt > now + 60000 || now - saved.createdAt > lifetime) throw new Error('待复用参数已过期或不属于当前账号，请回到原记录重新选择。')
    const params = validateParams(saved.params)
    if (params.kind !== kind) return { status: 'empty' }
    storage.removeItem(key)
    return { status: 'ready', params }
  } catch (reason) {
    try { storage.removeItem(key) } catch { /* Retain an unreadable handoff without applying it. */ }
    return { status: 'invalid', message: reason instanceof Error ? reason.message : '待复用参数无法读取，请回到原记录重新选择。' }
  }
}
