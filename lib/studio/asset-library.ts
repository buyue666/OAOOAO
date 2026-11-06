import type { Asset, AssetCategory } from './types'

export type AssetMediaFilter = 'all' | 'image' | 'video' | 'audio'
export type AssetCategoryFilter = 'all' | AssetCategory
export type AssetSort = 'newest' | 'oldest' | 'name'

export function assetMediaKind(asset: Pick<Asset, 'kind'>): Exclude<AssetMediaFilter, 'all'> {
  return asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image'
}

export function assetUsageCategory(asset: Pick<Asset, 'kind' | 'category'>): AssetCategory {
  return asset.category ?? (asset.kind === 'character' || asset.kind === 'scene' ? asset.kind : 'general')
}

export function filterAssetLibrary(assets: Asset[], { media = 'all', category = 'all', search = '', sort = 'newest' }: {
  media?: AssetMediaFilter; category?: AssetCategoryFilter; search?: string; sort?: AssetSort
} = {}): Asset[] {
  const query = search.trim().toLocaleLowerCase()
  const timestamp = (asset: Asset) => new Date(asset.createdAt).getTime() || 0
  return assets.filter(asset => (media === 'all' || assetMediaKind(asset) === media)
    && (category === 'all' || assetUsageCategory(asset) === category)
    && (!query || [asset.title, ...asset.tags, ...asset.referencedBy].join(' ').toLocaleLowerCase().includes(query)))
    .sort((left, right) => sort === 'name'
      ? left.title.localeCompare(right.title, 'zh-CN', { numeric: true })
      : (sort === 'oldest' ? 1 : -1) * (timestamp(left) - timestamp(right)))
}

export function assetLibraryCounts(assets: Asset[]) {
  const media = { all: assets.length, image: 0, video: 0, audio: 0 }
  const categories = { all: assets.length, general: 0, character: 0, scene: 0, prop: 0, style: 0, garment: 0 }
  for (const asset of assets) {
    media[assetMediaKind(asset)]++
    categories[assetUsageCategory(asset)]++
  }
  return { media, categories }
}

/** Selecting another filtered set must keep earlier selections within the 100-item limit. */
export function selectVisibleAssets(current: string[], visible: string[], checked: boolean): string[] {
  return checked ? [...new Set([...current, ...visible])].slice(0, 100) : current.filter(id => !visible.includes(id))
}
