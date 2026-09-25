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

/** 文件名清洗：去掉路径分隔符与后端不允许的字符，避免下载被浏览器改名。 */
export function safeDownloadName(title: string, extension: string): string {
  const base = String(title || 'oaooao-result')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'oaooao-result'}.${extension}`
}

export type DownloadResult = { ok: true; filename: string } | { ok: false; message: string }

/**
 * 真实下载一个结果文件。
 *
 * 关键：**必须取到实际文件内容**再触发保存，而不是给 `<a href>` 加 `download` 属性。
 * 原因是跨源（后端媒体域名与前端不同源）时 `download` 属性会被浏览器忽略，
 * 点击只会导航到文件；而且不 fetch 就无法知道真实 MIME 与大小。
 *
 * 失败时返回结构化原因，由调用方提示，不静默失败。
 */
export async function downloadMedia(media: DeliverableMedia, title: string): Promise<DownloadResult> {
  if (!media?.url) return { ok: false, message: '该结果没有可下载的文件地址' }
  const filename = safeDownloadName(title, resolveDownloadExtension(media))
  try {
    const response = await fetch(media.url, { credentials: 'include', cache: 'no-store' })
    if (!response.ok) return { ok: false, message: `下载失败（HTTP ${response.status}）` }
    const blob = await response.blob()
    if (!blob.size) return { ok: false, message: '下载到的文件为空' }
    /**
     * 服务端返回的 MIME 是权威值：URL 后缀可能缺失或错误
     * （后端结果路径常常没有扩展名），这里以响应头为准重新算一次扩展名。
     */
    const serverMime = blob.type || media.mimeType
    const finalName = serverMime && blob.type
      ? safeDownloadName(title, resolveDownloadExtension({ ...media, mimeType: serverMime }))
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
    return { ok: false, message: reason instanceof Error ? `下载失败：${reason.message}` : '下载失败' }
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
