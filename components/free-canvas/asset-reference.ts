import type { LibraryAssetView } from '@/lib/studio/account-api'
import { assetCategoryOf, isSubmittableReferenceUrl, libraryAssetMediaUrl } from '@/lib/studio/reference-assets'
import type { NodeReference } from './types'

export const ASSET_DRAG_TYPE = 'application/x-free-canvas-asset'

export type AssetDragPayload = { reference: NodeReference; category: string }

/** 资产库条目 → 画布引用。文本资产不是媒体，单独作为技能使用。 */
export function referenceOf(asset: LibraryAssetView): NodeReference | null {
  if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') return null
  const url = libraryAssetMediaUrl(asset)
  if (!isSubmittableReferenceUrl(url)) return null
  return { id: asset.id, title: asset.title, url, mediaKind: asset.kind }
}

export function categoryOf(asset: LibraryAssetView) {
  return assetCategoryOf(asset)
}

export function readAssetDrag(dataTransfer: DataTransfer): AssetDragPayload | null {
  const raw = dataTransfer.getData(ASSET_DRAG_TYPE)
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as Partial<AssetDragPayload>
    return payload.reference?.url ? { reference: payload.reference, category: payload.category ?? 'general' } : null
  } catch {
    return null
  }
}
