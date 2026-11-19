'use client'

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import useSWRInfinite from 'swr/infinite'
import type { LibraryAssetView, StudioWork } from './account-api'
import { request } from './api'
import { normalizeTaskResult, newClientRequestId } from './generation-api'
import { ProjectGenerationProvider, type GenerationContextValue } from './generation-store'
import type { GenerationTask, GenerationTaskView, ImageGenerationInput, RetryInput, VideoGenerationInput } from './generation-types'
import { scopedEvidence, unavailableEvidence } from './reference-selection'
import { useStudio } from './store'
import { useTeamQuery } from './team-api'
import { teamSubmissionUncertain } from './team-generation'
import type { TeamAsset, TeamProject, TeamSummary } from './team-types'
import type { LoadState } from './use-account-data'

type TeamTask = GenerationTask & { actorId?: string }
type MediaPayload = ReturnType<typeof teamImagePayload> | ReturnType<typeof teamVideoPayload>
type MediaRetry = Extract<RetryInput, { kind: 'image' | 'video' }>
type TeamMedia = { team: TeamSummary; project: TeamProject; root: string; balance: number | null; tasks: GenerationTaskView[]; loadState: LoadState; refresh: () => Promise<void> }
const TeamMediaContext = createContext<TeamMedia | null>(null)
export const useTeamMedia = () => useContext(TeamMediaContext)

function teamImagePayload(input: ImageGenerationInput) {
  const references = input.references ?? input.referenceUrls?.filter(Boolean).map(url => url.startsWith('data:') ? { dataUrl: url, type: 'image' } : { url, type: 'image' }) ?? []
  return { kind: 'image' as const, prompt: input.prompt, title: input.title, imageMode: input.kind ?? (references.length ? 'edit' : 'generation'), config: { model: input.model, size: input.ratio, resolution: input.resolution, quality: input.quality, n: input.count ?? 1 }, references, edit: input.edit }
}

function teamVideoPayload(input: VideoGenerationInput) {
  return { kind: 'video' as const, prompt: input.prompt, config: { model: input.model, size: input.ratio, vquality: input.quality, videoSeconds: input.seconds,
    }, references: input.references ?? [] }
}

export function quoteTeamVideo(root: string, input: VideoGenerationInput, signal?: AbortSignal) {
  return quoteTeamMedia(root, teamVideoPayload(input), signal)
}

export function quoteTeamImage(root: string, input: ImageGenerationInput, signal?: AbortSignal) {
  return quoteTeamMedia(root, teamImagePayload(input), signal)
}

async function quoteTeamMedia(root: string, payload: MediaPayload, signal?: AbortSignal) {
  const quote = await request<{ points: number }>(`${root}/generations/quote`, { method: 'POST', body: JSON.stringify(payload), signal })
  if (!Number.isFinite(quote.points) || quote.points < 0) throw new Error('服务器报价无效，请重试。')
  return quote
}

function taskView(raw: TeamTask, retryInput?: MediaRetry): GenerationTaskView {
  return { ...raw, ...normalizeTaskResult(raw.kind, raw.result), title: raw.title || (raw.kind === 'video' ? '团队视频生成' : '团队图片生成'), prompt: raw.prompt || '', createdAt: raw.createdAt ?? Date.now(), updatedAt: raw.updatedAt ?? Date.now(), canRetry: raw.status === 'error' && !!retryInput, retryInput }
}

export function TeamMediaProvider({ team, project, children }: { team: TeamSummary; project: TeamProject; children: ReactNode }) {
  const { state } = useStudio()
  const teamRoot = `/api/teams/${team.id}`, root = `${teamRoot}/projects/${project.id}`
  const query = useTeamQuery<{ tasks: TeamTask[] }>(`${root}/generations`, 4000)
  const wallet = useTeamQuery<{ balance: number }>(`${teamRoot}/usage`, 15000)
  const submitted = useRef(new Map<string, MediaRetry>())
  const pending = useRef(new Map<string, Promise<GenerationTaskView>>())
  const [operations, setOperations] = useState(0)
  const [lastError, setLastError] = useState<GenerationContextValue['lastError']>(null)
  const [lastNotice, setNotice] = useState<string | null>(null)
  const tasks = query.data?.tasks.map(raw => taskView(raw, raw.actorId === state.user.id ? submitted.current.get(raw.id) : undefined)) ?? []
  const balance = wallet.data?.balance ?? null
  const refresh = async () => { await Promise.allSettled([query.mutate(), wallet.mutate()]) }

  function submit(retry: MediaRetry) {
    const payload = retry.kind === 'image' ? teamImagePayload(retry.input) : teamVideoPayload(retry.input)
    const fingerprint = JSON.stringify(payload)
    const already = pending.current.get(fingerprint)
    if (already) return already
    setOperations(n => n + 1)
    setLastError(null)
    const work = (async () => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
      const digestHex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const key = `oao:team-media:${state.user.id}:${team.id}:${project.id}:${digestHex}`
      let requestId = retry.input.clientRequestId ?? newClientRequestId('team')
      let previouslySubmitted = false
      let approvedCost: number | undefined
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
        if (saved && /^[\w-]{8,100}$/.test(saved.requestId) && Number.isFinite(saved.points) && saved.points >= 0) { requestId = saved.requestId; approvedCost = saved.points; previouslySubmitted = true }
      } catch { /* A stable request keeps the scope in memory until the operation settles. */ }
      try {
        if (approvedCost === undefined) {
          const quote = await quoteTeamMedia(root, payload)
          if (retry.input.approvedCost !== undefined && quote.points > retry.input.approvedCost) throw new Error(`团队报价已变更为 ${quote.points} 积分，请重新核对参数。`)
          approvedCost = quote.points
        }
        try { sessionStorage.setItem(key, JSON.stringify({ requestId, points: approvedCost })) } catch {}
        previouslySubmitted = true
        const { task } = await request<{ task: TeamTask }>(`${root}/generations`, { method: 'POST', headers: { 'idempotency-key': requestId }, body: JSON.stringify({ ...payload, approvedCost }) })
        if (!task?.id) throw new Error('提交响应没有任务标识。')
        try { sessionStorage.removeItem(key) } catch {}
        submitted.current.set(task.id, retry)
        const taskWithOwner = { ...task, actorId: state.user.id }
        await query.mutate(current => ({ tasks: [taskWithOwner, ...(current?.tasks ?? []).filter(item => item.id !== task.id)] }), { revalidate: false })
        void refresh()
        return taskView(task, retry)
      } catch (reason) {
        const uncertain = previouslySubmitted && teamSubmissionUncertain(reason)
        if (!uncertain) try { sessionStorage.removeItem(key) } catch {}
        const message = uncertain ? '还无法确认团队任务是否已提交。可以查看任务列表，或用相同参数重新确认。' : reason instanceof Error ? reason.message : '团队任务提交失败。'
        setLastError({ message, indeterminate: uncertain })
        if (uncertain) void refresh()
        throw new Error(message)
      }
    })().finally(() => { pending.current.delete(fingerprint); setOperations(n => n - 1) })
    pending.current.set(fingerprint, work)
    return work
  }

  const unsupported = async (): Promise<never> => { throw new Error('此工作台只支持团队图片和视频任务。') }
  const value: GenerationContextValue = {
    tasks, activeCount: tasks.filter(task => ['pending', 'running', 'paused'].includes(task.status)).length,
    loading: query.isLoading, lastError, lastNotice, points: null, localOnly: false, running: operations > 0, queryUnavailable: !!query.error,
    createImage: input => submit({ kind: 'image', input }), createVideo: input => submit({ kind: 'video', input }), createAudio: unsupported, createText: unsupported,
    runAgent: unsupported, getAgent: unsupported, cancelAgent: unsupported, retryAgentTask: unsupported,
    cancelTask: async task => { const result = await request<{ task: TeamTask }>(`${root}/generations/${encodeURIComponent(task.id)}/cancel`, { method: 'POST' }); await refresh(); return taskView(result.task) },
    retryTask: async task => { const retry = submitted.current.get(task.id); if (task.status === 'error' && retry) await submit(retry).catch(() => undefined) },
    recoverTask: refresh, refresh, dismissError: () => setLastError(null), setNotice, resubmit: unsupported, canResubmit: () => false,
  }
  const loadState: LoadState = query.error ? 'error' : query.isLoading ? 'loading' : 'ready'
  return <TeamMediaContext.Provider value={{ team, project, root, balance, tasks, loadState, refresh }}><ProjectGenerationProvider value={value}>{children}</ProjectGenerationProvider></TeamMediaContext.Provider>
}

export function useTeamMediaWorks(media: TeamMedia | null, kind: 'image' | 'video') {
  const works: StudioWork[] = (media?.tasks ?? []).filter(task => task.status === 'success' && task.kind === kind).flatMap(task => task.media.filter(item => item.kind === kind).map((item, idx) => ({
    id: `${task.id}#${idx}`, taskId: task.id, title: task.title, kind, src: item.url, poster: item.poster, fallback: item.poster || item.url,
    model: task.model, prompt: task.prompt, createdAt: new Date(task.createdAt).toISOString(), status: '已完成', taskStatus: task.status,
  })))
  return { works, state: media?.loadState ?? 'idle' as const, reload: media?.refresh ?? (async () => {}), verifyWorkIds: async (_ids: readonly string[]) => unavailableEvidence() }
}

const libraryPageSize = 60
export function useTeamMediaLibrary(media: TeamMedia | null, kind: string, keyword: string) {
  const { state } = useStudio()
  const base = media ? `/api/teams/${media.team.id}/assets` : ''
  const assetKind = ['image', 'video', 'audio'].includes(kind) ? kind : 'media'
  const pages = useSWRInfinite<{ assets: TeamAsset[]; total: number }>((index, previous) => {
    if (!media || (previous && previous.assets.length < libraryPageSize)) return null
    const search = new URLSearchParams({ page: String(index + 1), pageSize: String(libraryPageSize), projectId: media.project.id, kind: assetKind, keyword })
    return ['team-media-library', state.user.id, `${base}?${search}`]
  }, ([, , path]: [string, string, string]) => request(path), { shouldRetryOnError: false })
  const rows = pages.error ? [] : pages.data?.flatMap(page => page.assets) ?? []
  const assets: LibraryAssetView[] = rows.map(asset => ({ id: asset.id, title: asset.title, kind: asset.kind, tags: [], data: { url: asset.url }, createdAt: asset.createdAt, updatedAt: asset.createdAt }))
  const total = pages.data?.[0]?.total ?? 0
  const loadingMore = pages.size > (pages.data?.length ?? 0) && pages.isValidating
  const loadState: LoadState = pages.error ? 'error' : pages.isLoading ? 'loading' : 'ready'
  const verifyLibraryIds = async (ids: readonly string[] = []) => {
    if (!media || !ids.length) return scopedEvidence(ids, [])
    try {
      const { assets: current } = await request<{ assets: TeamAsset[] }>(`${base}?${new URLSearchParams({ projectId: media.project.id, ids: ids.join(','), pageSize: '100' })}`)
      return scopedEvidence(ids, current.map(asset => asset.id))
    } catch { return unavailableEvidence() }
  }
  return { assets, total, remaining: Math.max(0, total - assets.length), state: loadState, message: pages.error instanceof Error ? pages.error.message : '',
    liveVerifyTick: 0, hasMore: assets.length < total, loadingMore, reload: () => pages.mutate(), verifyLibraryIds, reloadForLiveness: verifyLibraryIds,
    loadMore: () => { if (!loadingMore && assets.length < total) return pages.setSize(count => count + 1) },
  }
}

export async function uploadTeamMedia(root: string, file: Blob | string, title: string) {
  let body: BodyInit
  if (typeof file === 'string') body = JSON.stringify({ title, dataUrl: file })
  else { const form = new FormData(); form.append('file', file, title); body = form }
  const { asset } = await request<{ asset: TeamAsset }>(`${root}/assets`, { method: 'POST', body })
  return asset.url
}
