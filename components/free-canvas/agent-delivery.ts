import type { LibraryAssetView } from '@/lib/studio/account-api'
import { referenceOf } from './asset-reference'
import { createGenerationNode, createMediaNode } from './node-factory'
import type { FreeCanvasNode } from './types'

/** Resolve the owned asset IDs returned by the run; never substitute unrelated results. */
export async function loadAgentResultAssets(ids: readonly string[], loadPage: (page: number) => Promise<{ assets: LibraryAssetView[]; total: number }>, current: () => boolean) {
  const wanted = [...new Set(ids)]
  if (!wanted.length) return []
  const found = new Map<string, LibraryAssetView>()
  let scanned = 0
  for (let page = 1; page <= 50; page++) {
    if (!current()) return null
    const result = await loadPage(page)
    if (!current()) return null
    for (const asset of result.assets) if (wanted.includes(asset.id)) found.set(asset.id, asset)
    if (wanted.every((id) => found.has(id))) return wanted.map((id) => found.get(id)!)
    scanned += result.assets.length
    if (!result.assets.length || scanned >= result.total) throw new Error('部分运行结果已不可读取，请重试或到资产库核对。')
  }
  throw new Error('资产库尚未读取完整，结果仍保留在服务端，请重试接收。')
}

/** Stable IDs make repeated delivery and save recovery idempotent across reloads. */
export function buildAgentResultNodes(runId: string, assets: readonly LibraryAssetView[], existing: readonly FreeCanvasNode[]): FreeCanvasNode[] {
  const known = new Set(existing.map((node) => node.id))
  const libraryIds = new Set(existing.flatMap((node) => node.type === 'media' && node.data.media?.libraryAssetId ? [node.data.media.libraryAssetId] : []))
  const left = Math.max(0, ...existing.map((node) => node.position.x + Number(node.width || 360))) + 100
  const defaults = { imageSize: '1:1', imageQuality: 'auto', imageCount: 1, videoQuality: '720', videoSeconds: 5, audioVoice: 'alloy', audioFormat: 'mp3' }
  const output: FreeCanvasNode[] = []
  for (const asset of assets) {
    const id = `agent-output:${runId}:${asset.id}`
    if (known.has(id) || libraryIds.has(asset.id)) continue
    const position = { x: left + (output.length % 3) * 380, y: Math.floor(output.length / 3) * 320 }
    if (asset.kind === 'text') {
      const text = [asset.data.content, asset.data.textContent, asset.data.text].find((value) => typeof value === 'string' && value.trim())
      if (typeof text !== 'string') throw new Error('文本结果缺少正文，请重试接收或到资产库核对。')
      const node = createGenerationNode('text', position, defaults, id)
      node.data = { ...node.data, title: asset.title || 'Agent 文本结果', text,
        task: { id: typeof asset.metadata?.taskId === 'string' ? asset.metadata.taskId : '', phase: 'success', startedAt: Date.parse(asset.createdAt) || 0 },
        resultSource: { runId, assetId: asset.id } }
      output.push(node)
    } else {
      const reference = referenceOf(asset)
      if (!reference) throw new Error('媒体结果缺少可用地址，请重试接收或到资产库核对。')
      output.push(createMediaNode('asset', position, reference, id))
    }
    known.add(id)
    libraryIds.add(asset.id)
  }
  return output
}
