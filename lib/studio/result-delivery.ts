/**
 * 结果交付的共享逻辑：任务结果 → 舞台作品 → 下载。
 *
 * 背景（本轮复现的真实缺陷）：
 *  1. 结果舞台的 `isEmpty` 用的是**本地演示作品**（`state.works`）而不是真实来源。
 *     真实账号下 `state.works` 恒为空 → 无论后端已有结果、任务是否完成，
 *     舞台永远显示「还没有结果」，必须刷新页面才恢复。
 *  2. 下载把扩展名写死：所有图片 `.png`、所有视频 `.mp4`，
 *     与真实 MIME 不符（后端可能返回 webp/jpeg/mov）。
 *  3. 视频工作台的结果与参考素材仍直接读 `state.works` / `state.assets`。
 *
 * 这里把「任务结果」「后端作品」「下载」三件事收敛成纯函数，供图片/视频工作台
 * 与作品页共用，避免每条路径各写一套判断。
 */

/** 下载/展示需要的媒体信息；与 `MediaResult` 形状兼容。 */
export type DeliverableMedia = {
  url: string
  poster?: string
  width?: number
  height?: number
  mimeType?: string
  kind: 'image' | 'video' | 'audio'
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
}

/** 已知的扩展名集合（用于判断 URL 里的后缀是否可信）。 */
const KNOWN_EXTENSIONS = new Set(Object.values(EXTENSION_BY_MIME).concat(['jpeg', 'tif', 'tiff', 'bmp', 'm4a', 'm4v', '3gp']))

/**
 * 从 URL 路径里取扩展名。
 *
 * 必须去掉 query/hash，并且忽略后端常见的「无扩展名」路径
 * （例如 `/api/generation-log-assets/permanent/2026/09/22/images/20260922-20020`），
 * 否则会把 ID 里的点号当成扩展名。
 */
export function extensionFromUrl(url: string): string | null {
  const withoutQuery = String(url || '').split(/[?#]/)[0]
  const lastSegment = withoutQuery.split('/').filter(Boolean).pop() ?? ''
  const match = lastSegment.match(/\.([a-z0-9]+)$/i)
  if (!match) return null
  const extension = match[1].toLowerCase()
  return KNOWN_EXTENSIONS.has(extension) ? (extension === 'jpeg' ? 'jpg' : extension) : null
}

/**
 * 推断下载扩展名：**优先真实 MIME**，其次 URL 后缀，最后按类型兜底。
 *
 * 早先固定 `.png` / `.mp4` 会让 webp 图片、mov 视频下载后无法被本地播放器识别。
 */
export function resolveDownloadExtension(media: Pick<DeliverableMedia, 'kind' | 'mimeType' | 'url'>): string {
  const mime = String(media.mimeType || '').split(';')[0].trim().toLowerCase()
  if (mime && EXTENSION_BY_MIME[mime]) return EXTENSION_BY_MIME[mime]
  const fromUrl = extensionFromUrl(media.url)
  if (fromUrl) return fromUrl
  // 兜底：图片默认 png（后端真实产物就是 png），视频默认 mp4，音频默认 mp3。
  return media.kind === 'video' ? 'mp4' : media.kind === 'audio' ? 'mp3' : 'png'
}

/** 下载文件名的主体上限；过长标题使用任务 ID，避免浏览器截断或拒绝保存。 */
export const MAX_DOWNLOAD_TITLE_LENGTH = 80

function cleanDownloadBase(value: string) {
  return String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 文件名清洗：去掉路径分隔符与后端不允许的字符，避免下载被浏览器改名。 */
export function safeDownloadName(title: string, extension: string, fallbackName?: string): string {
  const base = cleanDownloadBase(title)
  const fallback = cleanDownloadBase(fallbackName || '')
  const chosen = base.length > MAX_DOWNLOAD_TITLE_LENGTH
    ? fallback || 'oaooao-result'
    : base || fallback || 'oaooao-result'
  return `${chosen}.${extension}`
}

export type DownloadResult = { ok: true; filename: string; directUrl?: string; expiresAt?: string } | { ok: false; message: string }
export type DownloadOptions = { accountId?: string; signal?: AbortSignal; taskId?: string; prompt?: string }

/** Only canonical, same-origin owned media may be submitted to the export service. */
export function mediaExportPath(value: string, origin: string): string | null {
  try {
    if (!value || /[\\\u0000-\u0020]/u.test(value)) return null
    const url = new URL(value, origin)
    if (url.origin !== origin || url.username || url.password) return null
    const match = url.pathname.match(/^\/api\/(?:media|reference-assets|generation-log-assets)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    return match ? `/api/media/${match[1]}/export` : null
  } catch { return null }
}

/**
 * 真实下载一个结果文件。
 *
 * R2 文件先用短请求完成权限/水印检查，再用带 attachment 响应头的临时地址
 * 交给浏览器下载，避免整段视频经过站点代理和浏览器内存。其他存储保留字节导出。
 */
export async function downloadMedia(media: DeliverableMedia, title: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  if (!media?.url) return { ok: false, message: '该结果没有可下载的文件地址' }
  // 提示词可能比展示标题更长：一旦任一来源超过上限，就让 safeDownloadName
  // 使用任务 ID，保证下载名短且可追溯，而不是只截断成一段难以识别的文本。
  const nameSource = options.prompt && options.prompt.length > MAX_DOWNLOAD_TITLE_LENGTH ? options.prompt : title
  const fallbackName = options.taskId?.trim() || undefined
  const filename = safeDownloadName(nameSource, resolveDownloadExtension(media), fallbackName)
  try {
    const exportPath = mediaExportPath(media.url, window.location.origin)
    let externalExport = false
    try { const url = new URL(media.url); externalExport = !exportPath && url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.origin !== window.location.origin } catch {}
    if (!exportPath && !externalExport && media.kind !== 'audio') return { ok: false, message: '此历史文件尚无可验证的导出来源，请联系站点客服核对媒体迁移。' }
    const assertActive = () => { if (options.signal?.aborted) throw new Error('导出已取消') }
    const currentAccount = async () => {
      assertActive()
      const session = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store', signal: options.signal })
      if (!session.ok) throw new Error('无法确认当前账户，请稍后重试')
      const payload = await session.json()
      assertActive()
      if (typeof payload?.user?.id !== 'string' || !payload.user.id) throw new Error('登录状态已失效，请重新登录后导出')
      return payload.user.id as string
    }
    // Cookies can change in another tab without this component knowing. Check both sides
    // of a potentially long export and never hand an old account's bytes to the browser.
    const accountId = exportPath ? undefined : await currentAccount()
    if (!exportPath && options.accountId !== undefined && options.accountId !== accountId) return { ok: false, message: '账户已切换，请刷新当前页面后重新下载。' }
    const requestExport = () => fetch(exportPath || (externalExport ? '/api/account/media/export' : media.url), { method: exportPath || externalExport ? 'POST' : 'GET', credentials: exportPath || externalExport ? 'include' : 'same-origin', ...(exportPath ? { headers: { Accept: 'application/json', 'X-OAO-Download-Name': encodeURIComponent(filename) } } : externalExport ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: media.url }) } : {}), cache: 'no-store', signal: options.signal })
    let response = await requestExport()
    const preparationStarted = Date.now()
    while (response.status === 202 && response.headers.get('content-type')?.includes('application/json')) {
      assertActive()
      const pending = await response.json()
      if (pending?.status !== 'preparing') throw new Error('下载准备状态无效，请重试')
      if (Date.now() - preparationStarted > 5 * 60_000) throw new Error('下载准备时间较长，请稍后重试')
      const delay = Math.max(1000, Math.min(3000, Number(pending.retryAfterMs) || 1500))
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { window.clearTimeout(timer); reject(new Error('导出已取消')) }
        const timer = window.setTimeout(() => { options.signal?.removeEventListener('abort', cancel); resolve() }, delay)
        options.signal?.addEventListener('abort', cancel, { once: true })
      })
      assertActive()
      response = await requestExport()
    }
    assertActive()
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      return { ok: false, message: typeof payload?.error === 'string' ? payload.error : typeof payload?.message === 'string' ? payload.message : `下载失败（HTTP ${response.status}）` }
    }
    if (response.headers.get('content-type')?.includes('application/json')) {
      const ticket = await response.json()
      if (ticket?.status !== 'ready' || typeof ticket.url !== 'string' || typeof ticket.filename !== 'string' || !ticket.filename || !/^(?:image|video|audio)\//.test(ticket.mimeType || '') || !(ticket.bytes > 0)) throw new Error('下载服务没有返回有效文件')
      const direct = new URL(ticket.url)
      if (direct.protocol !== 'https:' || direct.username || direct.password || direct.hash || direct.searchParams.get('response-content-disposition')?.startsWith('attachment;') !== true) throw new Error('下载服务返回的地址无效')
      if (!exportPath && await currentAccount() !== accountId) return { ok: false, message: '账户已切换，本次导出已取消，请重新下载。' }
      assertActive()
      const anchor = document.createElement('a')
      anchor.href = direct.toString(); anchor.download = ticket.filename; anchor.rel = 'noopener noreferrer'; anchor.referrerPolicy = 'no-referrer'
      document.body.appendChild(anchor)
      try { anchor.click() } finally { anchor.remove() }
      return { ok: true, filename: ticket.filename, directUrl: direct.toString(), expiresAt: ticket.expiresAt }
    }
    const blob = await response.blob()
    assertActive()
    if (!blob.size) return { ok: false, message: '下载到的文件为空' }
    const actualMime = blob.type.split(';')[0].trim().toLowerCase()
    if (!/^(?:image|video|audio)\//.test(actualMime)) return { ok: false, message: '导出服务未返回有效的媒体文件，请稍后重试。' }
    if (!exportPath && await currentAccount() !== accountId) return { ok: false, message: '账户已切换，本次导出已取消，请重新下载。' }
    assertActive()
    /**
     * 服务端返回的 MIME 是权威值：URL 后缀可能缺失或错误
     * （后端结果路径常常没有扩展名），这里以响应头为准重新算一次扩展名。
     */
    const serverMime = blob.type || media.mimeType
    const finalName = serverMime && blob.type
      ? safeDownloadName(nameSource, resolveDownloadExtension({ ...media, mimeType: serverMime }), fallbackName)
      : filename
    const objectUrl = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = finalName
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      // 立即释放会让部分浏览器来不及开始下载，因此留出一个事件循环。
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
    }
    return { ok: true, filename: finalName }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : ''
    return { ok: false, message: /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message) ? '无法连接下载服务，请检查网络后重试；已生成下载链接时也可点击直接下载。' : message ? `下载失败：${message}` : '下载失败' }
  }
}

/** 任务当前是否已经产出可交付结果。 */
export function hasDeliverable(task: { status?: string; media?: DeliverableMedia[] }): boolean {
  return Boolean(task?.media?.length) && task?.status === 'success'
}

/**
 * 结果舞台的「空」判定。
 *
 * 真实来源 = 后端作品 + 已完成且带媒体的任务，**不再**用本地演示数据。
 * 只要有任一来源有内容就不算空，避免「任务已完成但舞台仍显示空态」。
 */
export function stageIsEmpty(input: {
  /** 后端返回的作品（真实来源）。 */
  serverWorks: number
  /** 已完成且带媒体的任务数量。 */
  completedTasks: number
  /** 未登录时的本地预览条目。 */
  localPreview: number
  /** 是否已连接后端；未连接时才允许用本地预览判断。 */
  connected: boolean
}): boolean {
  if (input.connected) return input.serverWorks === 0 && input.completedTasks === 0
  return input.localPreview === 0
}
