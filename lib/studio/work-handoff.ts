export type WorkHandoffEntry = { id: string; kind: 'image' | 'video' | 'audio'; title: string; src: string }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const TTL = 15 * 60 * 1000
const keyFor = (accountId: string) => `oaooao-canvas-handoff:v1:${encodeURIComponent(accountId)}`

function valid(entry: unknown): entry is WorkHandoffEntry {
  if (!entry || typeof entry !== 'object') return false
  const value = entry as WorkHandoffEntry
  if (typeof value.id !== 'string' || !value.id || value.id.length > 200 || !['image', 'video', 'audio'].includes(value.kind) || typeof value.title !== 'string' || value.title.length > 250 || typeof value.src !== 'string' || value.src.length > 8192) return false
  try { const url = new URL(value.src, 'https://canvas.invalid'); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

function read(storage: StorageLike, accountId: string, now: number): WorkHandoffEntry[] {
  const parsed = JSON.parse(storage.getItem(keyFor(accountId)) || 'null')
  if (!parsed || parsed.version !== 1 || parsed.accountId !== accountId || !Number.isFinite(parsed.createdAt) || parsed.createdAt > now || now - parsed.createdAt > TTL || !Array.isArray(parsed.entries)) return []
  return parsed.entries.filter(valid).slice(0, 40)
}

export function writeWorkHandoff(storage: StorageLike, accountId: string, entry: WorkHandoffEntry, now = Date.now()) {
  if (!accountId || !valid(entry)) throw new Error('作品信息不可用，无法发送到画布')
  let existing: WorkHandoffEntry[] = []
  try { existing = read(storage, accountId, now) } catch { /* Invalid old entries cannot become another user's input. */ }
  storage.setItem(keyFor(accountId), JSON.stringify({ version: 1, accountId, createdAt: now, entries: [entry, ...existing.filter((item) => item.id !== entry.id)].slice(0, 40) }))
}

export function takeWorkHandoff(storage: StorageLike, accountId: string, now = Date.now()): WorkHandoffEntry[] {
  if (!accountId) return []
  try { const entries = read(storage, accountId, now); storage.removeItem(keyFor(accountId)); return entries } catch { return [] }
}
