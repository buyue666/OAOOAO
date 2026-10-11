'use client'

import { useState, type ChangeEvent, type DragEvent } from 'react'
import { AudioLines, FileText, Upload, X } from 'lucide-react'
import { createLibraryAsset, readImageSize, uploadPersistentAsset, type LibraryAssetView } from '@/lib/studio/account-api'
import { libraryAssetMediaUrl } from '@/lib/studio/reference-assets'
import { useLibraryAssets } from '@/lib/studio/use-account-data'
import { cn } from '@/lib/utils'
import { ASSET_DRAG_TYPE, categoryOf, referenceOf } from './asset-reference'
import { errorMessageOf } from './use-generation-actions'

type TabId = 'all' | 'character' | 'scene' | 'prop' | 'style' | 'image' | 'video' | 'upload' | 'favorite' | 'skill'

const TABS: { id: TabId; label: string; match: (asset: LibraryAssetView) => boolean }[] = [
  { id: 'all', label: '全部', match: () => true },
  { id: 'character', label: '人物', match: (asset) => categoryOf(asset) === 'character' },
  { id: 'scene', label: '场景', match: (asset) => categoryOf(asset) === 'scene' },
  { id: 'prop', label: '道具', match: (asset) => categoryOf(asset) === 'prop' },
  { id: 'style', label: '风格', match: (asset) => categoryOf(asset) === 'style' },
  { id: 'image', label: '参考图片', match: (asset) => asset.kind === 'image' },
  { id: 'video', label: '参考视频', match: (asset) => asset.kind === 'video' },
  { id: 'upload', label: '上传文件', match: (asset) => asset.source === 'user-upload' },
  { id: 'favorite', label: '生成收藏', match: (asset) => asset.tags.includes('收藏') },
  { id: 'skill', label: '技能', match: (asset) => asset.kind === 'text' },
]

type CanvasAssetLibraryProps = {
  targetNodeId: string | null
  onPick: (asset: LibraryAssetView) => void
  onClose: () => void
}

export function CanvasAssetLibrary({ targetNodeId, onPick, onClose }: CanvasAssetLibraryProps) {
  const [tab, setTab] = useState<TabId>('all')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const library = useLibraryAssets({ pageSize: 60 })
  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0]
  const visible = library.assets.filter(activeTab.match)

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    setNotice(`正在上传 ${files.length} 个文件`)
    try {
      for (const file of files) {
        const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image'
        const stored = await uploadPersistentAsset(file, kind)
        const size = kind === 'image' ? await readImageSize(file).catch(() => null) : null
        const asset = await createLibraryAsset({
          kind,
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || '未命名素材',
          tags: ['上传'],
          source: 'user-upload',
          data: {
            storageKey: stored.key,
            serverUrl: stored.url,
            dataUrl: kind === 'image' ? stored.url : undefined,
            url: kind === 'image' ? undefined : stored.url,
            bytes: stored.bytes,
            mimeType: stored.mimeType || file.type,
            ...(size ? { width: size.width, height: size.height } : {}),
            assetRole: 'general',
          },
        })
        if (targetNodeId) onPick(asset)
      }
      await library.reload()
      setNotice(null)
    } catch (error) {
      setNotice(errorMessageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="资产库" className="flex max-h-[min(72dvh,600px)] flex-col gap-3 rounded-2xl border border-white/15 bg-neutral-950 p-3.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.8)]">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">资产库</h2>
          <p className="text-[11px] text-neutral-500">{targetNodeId ? '点选即加入当前节点，也可拖到画布' : '拖拽素材到画布即可创建节点'}</p>
        </div>
        <button type="button" aria-label="关闭资产库" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white">
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div role="tablist" aria-label="资产分类" className="flex flex-wrap gap-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === tab}
            onClick={() => setTab(item.id)}
            className={cn(
              'h-7 rounded-full border px-2.5 text-[11px] transition-colors',
              item.id === tab ? 'border-white bg-white text-black' : 'border-white/15 text-neutral-300 hover:border-white/40 hover:text-white',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className={cn('flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/25 text-xs text-neutral-200 transition-colors hover:border-white/60', busy && 'pointer-events-none opacity-50')}>
        <Upload className="size-3.5" aria-hidden="true" />
        上传图片、视频或音频
        <input type="file" multiple accept="image/*,video/*,audio/*" className="sr-only" onChange={handleUpload} />
      </label>
      {notice ? <p role="status" className="text-[11px] text-neutral-400">{notice}</p> : null}
      {library.state === 'unauthenticated' ? <p className="text-xs text-neutral-400">登录后可以使用资产库。</p> : null}
      {library.state === 'error' ? <p role="alert" className="text-xs text-neutral-400">{library.message || '资产读取失败，请稍后重试'}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length ? (
          <ul className="grid grid-cols-3 gap-2">
            {visible.map((asset) => (
              <li key={asset.id}>
                <AssetItem asset={asset} onPick={() => onPick(asset)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-xs text-neutral-500">
            {library.state === 'loading' || library.state === 'idle' ? '正在读取资产' : '这个分类还没有素材'}
          </p>
        )}
      </div>

      {library.hasMore ? (
        <button type="button" onClick={() => void library.loadMore()} disabled={library.loadingMore} className="h-8 rounded-lg border border-white/15 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40">
          加载更多
        </button>
      ) : null}
    </section>
  )
}

function AssetItem({ asset, onPick }: { asset: LibraryAssetView; onPick: () => void }) {
  const reference = referenceOf(asset)
  const url = libraryAssetMediaUrl(asset)

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    if (!reference) return
    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify({ reference, category: categoryOf(asset) }))
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <button
      type="button"
      draggable={Boolean(reference)}
      onDragStart={handleDragStart}
      onClick={onPick}
      title={asset.title}
      aria-label={`选择素材 ${asset.title}`}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black text-left transition-colors hover:border-white/50 focus-visible:outline-2 focus-visible:outline-white"
    >
      <span className="flex aspect-square w-full items-center justify-center overflow-hidden bg-white/[0.04]">
        {asset.kind === 'image' && url ? (
          <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
        ) : asset.kind === 'video' && url ? (
          <video src={url} muted preload="metadata" className="size-full object-cover" />
        ) : asset.kind === 'audio' ? (
          <AudioLines className="size-5 text-neutral-400" aria-hidden="true" />
        ) : (
          <span className="line-clamp-4 px-2 text-[10px] leading-snug text-neutral-400">
            {String(asset.data.prompt ?? asset.data.text ?? asset.title)}
          </span>
        )}
      </span>
      <span className="flex items-center gap-1 px-1.5 py-1">
        {asset.kind === 'text' ? <FileText className="size-3 shrink-0 text-neutral-500" aria-hidden="true" /> : null}
        <span className="min-w-0 truncate text-[11px] text-neutral-200">{asset.title}</span>
      </span>
    </button>
  )
}
