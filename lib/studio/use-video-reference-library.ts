'use client'

import { useRef } from 'react'
import { useLibraryAssets } from './use-account-data'
import { mediaLibrarySummary } from './use-media-library'
import { scopedEvidence, unavailableEvidence, type LiveSourceEvidence } from './reference-selection'

/** Candidate modes never change the evidence scope for the four saved selection groups. */
export function mergeVideoReferenceEvidence(ids: readonly string[], sources: readonly LiveSourceEvidence[]): LiveSourceEvidence {
  if (sources.some((source) => source.status === 'unavailable')) return unavailableEvidence()
  const found = new Set(sources.flatMap((source) => [...source.ids]))
  return scopedEvidence(ids, ids.filter((id) => found.has(id)))
}

export function useVideoReferenceLibrary(mode: string, keyword: string) {
  // Keep both hooks mounted and their kind stable when switching modes. Their
  // unfiltered verification queries can still prove either kind exists.
  const images = useLibraryAssets({ kind: 'image', pageSize: 60, keyword })
  const videos = useLibraryAssets({ kind: 'video', pageSize: 60, keyword })
  const sources = mode === 'edit' ? [videos] : mode === 'references' ? [images, videos] : [images]
  const pending = useRef(false)
  const verify = async (ids: readonly string[]) => {
    if (!ids.length) return scopedEvidence([], [])
    try {
      return mergeVideoReferenceEvidence(ids, await Promise.all([images.verifyLibraryIds(ids), videos.verifyLibraryIds(ids)]))
    } catch { return unavailableEvidence() }
  }
  return {
    ...mediaLibrarySummary(sources),
    remaining: sources.reduce((sum, source) => sum + Math.max(0, source.total - source.assets.length), 0),
    liveVerifyTick: images.liveVerifyTick + videos.liveVerifyTick,
    verifyLibraryIds: verify,
    reloadForLiveness: verify,
    reload: () => Promise.all(sources.map((source) => source.reload())),
    loadMore: async () => {
      if (pending.current || sources.some((source) => source.loadingMore || source.state === 'loading')) return
      pending.current = true
      try { await Promise.all(sources.filter((source) => source.hasMore).map((source) => source.loadMore())) }
      finally { pending.current = false }
    },
  }
}
