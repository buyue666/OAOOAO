'use client'

import { useRef } from 'react'
import { useLibraryAssets } from './use-account-data'

type LibraryPage = ReturnType<typeof useLibraryAssets>

/** Query each media kind at the server so text skills never consume a media page or its total. */
export function mediaLibrarySummary(sources: readonly LibraryPage[]) {
  const assets = sources.flatMap((source) => source.assets)
    .filter((asset) => asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  const state: LibraryPage['state'] = sources.some((source) => source.state === 'unauthenticated') ? 'unauthenticated'
    : sources.some((source) => source.state === 'error') ? 'error'
      : sources.some((source) => source.state === 'loading' || source.state === 'idle') ? 'loading' : 'ready'
  return {
    assets,
    state,
    total: sources.reduce((sum, source) => sum + source.total, 0),
    totalKnown: sources.every((source) => source.state === 'ready'),
    hasMore: sources.some((source) => source.hasMore),
    loadingMore: sources.some((source) => source.loadingMore),
    message: [...new Set(sources.map((source) => source.message).filter(Boolean))].join('；'),
  }
}

export function useMediaLibrary() {
  const images = useLibraryAssets({ kind: 'image', pageSize: 60 })
  const videos = useLibraryAssets({ kind: 'video', pageSize: 60 })
  const audio = useLibraryAssets({ kind: 'audio', pageSize: 60 })
  const sources = [images, videos, audio]
  const pending = useRef(false)
  return {
    ...mediaLibrarySummary(sources),
    reload: () => Promise.all(sources.map((source) => source.reload())),
    loadMore: async () => {
      if (pending.current || sources.some((source) => source.loadingMore || source.state === 'loading')) return
      pending.current = true
      try { await Promise.all(sources.filter((source) => source.hasMore).map((source) => source.loadMore())) }
      finally { pending.current = false }
    },
  }
}
