/**
 * 图片/视频工作台「参考素材候选池」的纯函数。
 *
 * 抽出来的原因有两个，都是真实缺陷带来的：
 *  1. 候选池原先散落在组件里，只有跑起真实后端 + 浏览器才能验证，
 *     而「上传的素材选不到」恰恰出在这一层：图片工作台**只读生成结果**，
 *     从不读素材库，于是用户在 /assets 上传的图片永远进不了候选池；
 *  2. 素材库与生成记录是两套来源，同一个文件可能同时出现在两边，
 *     必须按媒体地址去重，否则选择器里会出现两张一模一样的缩略图。
 *
 * 这里只做**纯数据变换**（不依赖 React、不依赖网络），
 * 因此可以在 Node 里直接用真实接口返回的数据跑断言。
 */
import type { LibraryAssetView, StudioWork } from './account-api'
import type { Asset } from './types'

/** 参考素材候选池需要的字段；`Asset` 是最常见的来源，但生成结果做最小适配即可。 */
export type ReferenceCandidate = {
  id: string
  title: string
  src: string
  kind: string
  poster?: string
  fallback?: string
  tags?: string[]
}

/** 素材库条目的媒体地址。后端对图片把地址放在 `dataUrl`，视频/音频放在 `url`。 */
export function libraryAssetMediaUrl(asset: LibraryAssetView): string {
  const data = (asset.data ?? {}) as { serverUrl?: unknown; url?: unknown; dataUrl?: unknown }
  return String(data.serverUrl ?? data.url ?? data.dataUrl ?? asset.coverUrl ?? '').trim()
}

/** 素材库条目 → 参考素材候选。 */
export function libraryAssetToReferenceAsset(asset: LibraryAssetView): Asset {
  const src = libraryAssetMediaUrl(asset)
  return {
    id: asset.id,
    kind: asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image',
    title: asset.title || '未命名素材',
    src,
    poster: asset.coverUrl,
    fallback: asset.coverUrl || asset.title || '素材',
    tags: asset.tags ?? [],
    size: '',
    status: '可用',
    projectIds: [],
    referencedBy: [],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

/** 后端生成结果 → 参考素材候选。 */
export function workToReferenceAsset(work: StudioWork): Asset {
  const createdAt = work.createdAt ?? new Date().toISOString()
  return {
    id: `generated-${work.id}`,
    kind: work.kind === 'video' ? 'video' : 'image',
    title: work.title,
    src: work.src,
    poster: work.poster,
    fallback: work.fallback,
    tags: ['生成结果'],
    size: '',
    status: '可用',
    projectIds: [],
    referencedBy: [],
    createdAt,
    updatedAt: createdAt,
  }
}

/**
 * 合并候选池并按媒体地址去重。
 *
 * 同一个文件可能同时是「用户上传的素材」和「生成结果」（素材库与生成记录是两套来源），
 * 因此必须以 URL 为键去重，而不是只按 id —— 否则选择器里会出现两张一模一样的缩略图。
 * 没有任何可用地址（空串、`blob:` 等浏览器本地地址）的条目一律丢弃：
 * 选中也提交不出参考图，留在候选池里只会误导用户。
 */
export function mergeReferenceAssets(groups: ReferenceCandidate[][]): Asset[] {
  const seenUrl = new Set<string>()
  const seenId = new Set<string>()
  const merged: Asset[] = []
  for (const group of groups) {
    for (const asset of group) {
      const src = (asset.src || '').trim()
      if (!isSubmittableReferenceUrl(src)) continue
      if (seenUrl.has(src) || seenId.has(asset.id)) continue
      seenUrl.add(src)
      seenId.add(asset.id)
      merged.push(asset as Asset)
    }
  }
  return merged
}

/**
 * 该地址能否真的作为参考素材提交。
 *
 * `blob:` / `data:` 是**浏览器本地**地址：后端要求参考素材已经是可访问的服务器地址，
 * 直接把 blob 提交上去只会在上游取图失败。
 */
export function isSubmittableReferenceUrl(value: string): boolean {
  const url = (value || '').trim()
  if (!url) return false
  return !/^(blob|data):/i.test(url)
}

/**
 * 把已选 id 解析成提交给后端的参考素材列表。
 *
 * 关键点（本次缺陷的核心）：
 *  - 解析必须针对**合并后的候选池**，否则选中真实素材会被静默丢弃，
 *    提交出去的 `references` 变成空数组 —— 用户看到「已选 1/1」，请求体里却什么都没有；
 *  - 坏链素材不提交：宁可少一张，也不给后端一个取不到的地址；
 *  - 数量按模型能力上限截断，界面显示与实际提交保持一致。
 */
export function resolveReferenceSelections(
  selectedIds: string[],
  pools: ReferenceCandidate[][],
  options: { maxReferences: number; type?: string } = { maxReferences: 0 },
): Array<{ name: string; type: string; url: string }> {
  const max = Math.max(0, options.maxReferences)
  if (!max) return []
  const lookup = new Map<string, { title: string; src: string }>()
  for (const pool of pools) {
    for (const asset of pool) if (!lookup.has(asset.id)) lookup.set(asset.id, { title: asset.title, src: asset.src })
  }
  const references: Array<{ name: string; type: string; url: string }> = []
  for (const id of selectedIds) {
    if (references.length >= max) break
    const asset = lookup.get(id)
    if (!asset || !isSubmittableReferenceUrl(asset.src)) continue
    references.push({ name: asset.title, type: options.type ?? 'image', url: asset.src.trim() })
  }
  return references
}
