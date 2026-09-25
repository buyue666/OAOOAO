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
  /** 目标项目（短剧等需要项目上下文的模式）。 */
  projectId?: string
}

/** 保存创作意图。文件过大时截断并如实记录，避免超出 sessionStorage 配额。 */
export function saveCreateIntent(intent: Omit<CreateIntent, 'createdAt'>): { saved: boolean; droppedFiles: number } {
  if (typeof window === 'undefined') return { saved: false, droppedFiles: 0 }
  let files = intent.files.slice(0, 6)
  let dropped = intent.files.length - files.length
  const write = () => {
    const payload: CreateIntent = { ...intent, files, createdAt: Date.now() }
    window.sessionStorage.setItem(KEY, JSON.stringify(payload))
  }
  try {
    write()
    return { saved: true, droppedFiles: dropped }
  } catch {
    // 配额不足：逐个丢弃文件后重试，仍然保留提示词与模式（它们才是关键）。
    while (files.length) {
      files = files.slice(0, -1)
      dropped += 1
      try {
        write()
        return { saved: true, droppedFiles: dropped }
      } catch {
        // 继续丢弃
      }
    }
    try {
      write()
      return { saved: true, droppedFiles: dropped }
    } catch {
      return { saved: false, droppedFiles: dropped }
    }
  }
}

/**
 * 读取并**消费**创作意图。
 *
 * 读取即删除：这样刷新工作台不会重复套用，用户手动清空提示词后刷新
 * 也不会被「复活」的旧意图覆盖。
 */
export function consumeCreateIntent(mode?: CreateMode): CreateIntent | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(KEY)
  if (!raw) return null
  window.sessionStorage.removeItem(KEY)
  try {
    const parsed = JSON.parse(raw) as CreateIntent
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.createdAt || Date.now() - parsed.createdAt > MAX_AGE_MS) return null
    if (mode && parsed.mode !== mode) return null
    return {
      mode: parsed.mode,
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      files: Array.isArray(parsed.files) ? parsed.files.filter((file) => file && typeof file.dataUrl === 'string') : [],
      createdAt: parsed.createdAt,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : undefined,
    }
  } catch {
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
  for (const file of files.slice(0, 6)) {
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
