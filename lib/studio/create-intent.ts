/**
 * 首页 → 工作台的创作意图传递。
 *
 * 背景（本轮复现的真实缺陷）：
 * 首页输入了提示词、选了参考文件与创作模式，点「开始创作」后
 * `router.push('/image')` —— **什么都没有带过去**。
 * 用户到工作台看到的是写死的示例提示词「极夜小镇的女孩站在雪地里……」，
 * 自己刚输入的内容被静默替换；参考文件也完全没有传过去。
 *
 * 这里用 sessionStorage 传一次性意图：
 *  - 不放进 URL：参考文件可能很大，且提示词出现在地址栏并不合适；
 *  - 一次性消费：工作台读取后立即清除，避免「上一次的输入」污染下一次进入；
 *  - 带时间戳：超过有效期视为过期，不使用陈旧意图。
 */

const KEY = 'oaooao-create-intent'
/** 意图有效期：超过后视为用户已经放弃，不再套用。 */
const MAX_AGE_MS = 10 * 60 * 1000

export type CreateMode = 'agent' | 'image' | 'video' | 'drama'

/** 首页选中的参考文件（已读取为可传输形式）。 */
export type IntentFile = {
  name: string
  type: string
  /** data URL：工作台可直接用于预览与上传，不需要再让用户重选一次。 */
  dataUrl: string
}

export type CreateIntent = {
  mode: CreateMode
  prompt: string
  files: IntentFile[]
  createdAt: number
  /** 目标团队（团队创作空间内跳转时携带，避免跨空间误消费）。 */
  teamId?: string
  /** 目标项目（短剧或团队项目等需要项目上下文的模式）。 */
  projectId?: string
  /** 首页就地编辑的生成参数，进入工作台后继续沿用。 */
  settings?: {
    model?: string
    ratio?: string
    resolution?: string
    quality?: string
    seconds?: number
  }
}

/** 原子保存所有参考；空间不足时留在首页，不能默默丢弃文件。 */
export function saveCreateIntent(intent: Omit<CreateIntent, 'createdAt'>): { saved: boolean; droppedFiles: number } {
  if (typeof window === 'undefined') return { saved: false, droppedFiles: 0 }
  try {
    const payload: CreateIntent = { ...intent, createdAt: Date.now() }
    window.sessionStorage.setItem(KEY, JSON.stringify(payload))
    return { saved: true, droppedFiles: 0 }
  } catch {
    return { saved: false, droppedFiles: 0 }
  }
}

/**
 * 读取并**消费**创作意图。
 *
 * 读取即删除：这样刷新工作台不会重复套用，用户手动清空提示词后刷新
 * 也不会被「复活」的旧意图覆盖。
 */
export function consumeCreateIntent(mode?: CreateMode, scope?: { teamId?: string }): CreateIntent | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CreateIntent
    if (!parsed || typeof parsed !== 'object') {
      window.sessionStorage.removeItem(KEY)
      return null
    }
    if (!parsed.createdAt || Date.now() - parsed.createdAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(KEY)
      return null
    }
    if (mode && parsed.mode !== mode) {
      return null
    }
    if (scope && (parsed.teamId ?? '') !== (scope.teamId ?? '')) return null
    window.sessionStorage.removeItem(KEY)
    return {
      mode: parsed.mode,
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      files: Array.isArray(parsed.files) ? parsed.files.filter((file) => file && typeof file.dataUrl === 'string') : [],
      createdAt: parsed.createdAt,
      teamId: typeof parsed.teamId === 'string' ? parsed.teamId : undefined,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : undefined,
      settings: parsed.settings && typeof parsed.settings === 'object' ? {
        model: typeof parsed.settings.model === 'string' ? parsed.settings.model : undefined,
        ratio: typeof parsed.settings.ratio === 'string' ? parsed.settings.ratio : undefined,
        resolution: typeof parsed.settings.resolution === 'string' ? parsed.settings.resolution : undefined,
        quality: typeof parsed.settings.quality === 'string' ? parsed.settings.quality : undefined,
        seconds: Number.isFinite(Number(parsed.settings.seconds)) ? Number(parsed.settings.seconds) : undefined,
      } : undefined,
    }
  } catch {
    window.sessionStorage.removeItem(KEY)
    return null
  }
}

/** 把 File 读成 data URL（首页选完文件后立即读取，避免跨页丢引用）。 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsDataURL(file)
  })
}

/** 一次性把多个文件读成意图文件；单个失败不影响其它文件。 */
export async function readIntentFiles(files: File[]): Promise<{ files: IntentFile[]; failed: string[] }> {
  const converted: IntentFile[] = []
  const failed: string[] = []
  for (const file of files) {
    try {
      converted.push({ name: file.name, type: file.type, dataUrl: await readFileAsDataUrl(file) })
    } catch {
      failed.push(file.name)
    }
  }
  return { files: converted, failed }
}

/** 由 data URL 还原一个 File，供工作台的上传流程复用。 */
export function dataUrlToFile(file: IntentFile): File | null {
  const match = file.dataUrl.match(/^data:([^;,]*)(;base64)?,(.*)$/)
  if (!match) return null
  try {
    const mime = match[1] || 'application/octet-stream'
    const isBase64 = Boolean(match[2])
    const data = isBase64 ? atob(match[3]) : decodeURIComponent(match[3])
    const bytes = new Uint8Array(data.length)
    for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index)
    return new File([bytes], file.name || 'reference', { type: file.type || mime })
  } catch {
    return null
  }
}
